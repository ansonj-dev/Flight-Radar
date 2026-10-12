import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { normalizeBlur } from "../../../packages/solami-client/src/normalize.ts";
import { BridgeMonitor } from "../../../packages/solami-client/src/bridge.ts";
import { YellowstoneStream } from "../../../packages/solami-client/src/grpc.ts";
import { StreamMeter } from "../../../packages/solami-client/src/meter.ts";
import { startMirage } from "../../../packages/solami-client/src/mirage.ts";
import { SolamiRpc } from "../../../packages/solami-client/src/rpc.ts";
import { ReconnectingWs } from "../../../packages/solami-client/src/ws.ts";
import { TokenMetadataRegistry } from "../../../packages/solami-client/src/metadata.ts";
import { config } from "./config.ts";
import { Radar } from "./radar.ts";
import { startSimulator } from "./sim.ts";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "../../web/public");
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const radar = new Radar(config);
export const metadataRegistry = new TokenMetadataRegistry(config.dataApiUrl, config.apiKey);

// ---- Stream meters (drive the Stream Health panel) ----
const meters = {
  blur: new StreamMeter("Blur (decoded DEX events)"),
  grpc: new StreamMeter("Yellowstone gRPC"),
  mirage: new StreamMeter("Mirage (WebSocket)"),
  rpc: new StreamMeter("RPC"),
  webhook: new StreamMeter("Webhooks (inbound)"),
  bridge: new StreamMeter("Bridge context (DefiLlama)"),
};
const webhookStats = { ok: 0, rejected: 0, unparsed: 0 };

let simulated = false;
let rpcRef: SolamiRpc | undefined;
const sources: string[] = [];

if (config.mode === "simulate") {
  simulated = true;
  startSimulator((e) => radar.ingest(e));
  log("MODE=simulate: synthetic data, NOT live mainnet");
} else {
  // Blur: decoded DEX trades, pools, liquidity, launches
  if (config.blurWsUrl) {
    sources.push("blur");
    new ReconnectingWs({
      url: config.blurWsUrl,
      headers: config.authHeaders,
      subscribe: config.blurSubscribe,
      meter: meters.blur,
      staleMs: 120_000,
      log,
      onMessage: (data) => {
        // Cache metadata from snapshot frames (trending, launches, graduating, movers)
        if (data && typeof data === "object") {
          const raw = data as Record<string, any>;
          const list = Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw.data) ? raw.data : [];
          for (const item of list) {
            if (item && item.mint && item.symbol) {
              metadataRegistry.set(item.mint, { symbol: item.symbol, name: item.name, image: item.image });
            }
          }
        }
        const events = normalizeBlur(data, "blur");
        if (events.length > 0) {
          meters.blur.detail = "Streaming live Solana DEX events";
        }
        for (const e of events) {
          if (!e.symbol && metadataRegistry.get(e.token)) {
            e.symbol = metadataRegistry.get(e.token)!.symbol;
          }
          radar.ingest(e);
        }
      },
    }).start();
  }

  // Yellowstone gRPC (primary) with Mirage as WebSocket alternative
  if (config.grpcEndpoint) {
    sources.push("grpc");
    new YellowstoneStream({
      endpoint: config.grpcEndpoint,
      token: config.grpcToken,
      meter: meters.grpc,
      log,
      onActivity: (a) => radar.activity(a),
      onSlot: (s) => (radar.lastSlot = Math.max(radar.lastSlot, s)),
    }).start();
  }
  if (config.mirageUrl) {
    sources.push("mirage");
    startMirage({
      url: config.mirageUrl,
      headers: config.authHeaders,
      subscribe: config.mirageSubscribe,
      meter: meters.mirage,
      log,
      onActivity: (a) => radar.activity(a),
    });
  }

  // RPC: health probe + holder-concentration enrichment
  if (config.rpcUrl) {
    sources.push("rpc");
    const rpc = new SolamiRpc({ url: config.rpcUrl, headers: config.authHeaders, rps: config.rpcRps, meter: meters.rpc });
    rpcRef = rpc;
    meters.rpc.setState("connecting");
    const probe = () =>
      rpc
        .probe()
        .then((p) => {
          radar.lastSlot = Math.max(radar.lastSlot, p.slot);
          meters.rpc.detail = `slot ${p.slot} · ${p.latencyMs} ms`;
        })
        .catch(() => {});
    void probe();
    setInterval(probe, 5000);
  }

  if (sources.length === 0) {
    log("WARNING: no Solami source configured. Copy .env.example to .env and add your keys, or run `npm run simulate`.");
  }
}

// Cross-chain context
const bridgeMon = new BridgeMonitor(meters.bridge, () => radar.bridgeTxPerMin());
if (config.mode === "live") bridgeMon.start();
radar.bridge = () => bridgeMon.context();
radar.start();

// ---- HTTP ----
const holderCache = new Map<string, { at: number; v: unknown }>();
const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

function snapshot() {
  const top = radar.topTokens(40);
  metadataRegistry.queue(top.map((t) => t.token));
  const enrichedTokens = top.map((t) => {
    const meta = metadataRegistry.get(t.token);
    return {
      ...t,
      symbol: meta?.symbol || t.symbol || (t.token.slice(0, 4) + "…" + t.token.slice(-4)),
      name: meta?.name,
      image: meta?.image,
    };
  });

  return {
    now: Date.now(),
    mode: simulated ? "simulate" : "live",
    sources,
    tokens: enrichedTokens,
    metrics: radar.metrics(),
    bridge: bridgeMon.context(),
    health: [
      ...Object.values(meters).map((m) => m.snapshot()),
    ].filter((h) => h.state !== "disabled" || simulated === false),
    webhook: webhookStats,
    alerts: radar.alerts.slice(0, 30).map((a) => {
      const meta = metadataRegistry.get(a.token);
      return meta?.symbol ? { ...a, symbol: meta.symbol, title: a.title.replace(new RegExp(`^${a.token.slice(0, 6)}`), meta.symbol) } : a;
    }),
    events: radar.recentEvents.slice(0, 60).map((e) => {
      const meta = metadataRegistry.get(e.token);
      return meta?.symbol ? { ...e, symbol: meta.symbol } : e;
    }),
  };
}

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 2_000_000) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => resolve(b));
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(readFileSync(join(webDir, "index.html")));
    }
    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, snapshot());
    if (req.method === "GET" && url.pathname === "/api/tokens") return json(res, 200, radar.topTokens(100));
    if (req.method === "GET" && url.pathname === "/api/alerts") return json(res, 200, radar.alerts);
    if (req.method === "GET" && url.pathname === "/api/events") return json(res, 200, radar.recentEvents);
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, snapshot().health);
    if (req.method === "GET" && url.pathname.startsWith("/api/token/")) {
      const mint = decodeURIComponent(url.pathname.slice("/api/token/".length));
      const score = radar.getScore(mint);
      if (!score) return json(res, 404, { error: "token not tracked" });
      let holders: unknown = null;
      if (rpcRef) {
        const c = holderCache.get(mint);
        if (c && Date.now() - c.at < 5 * 60_000) holders = c.v;
        else {
          holders = await rpcRef.holderConcentration(mint);
          holderCache.set(mint, { at: Date.now(), v: holders });
        }
      }
      return json(res, 200, { score, holders });
    }
    if (req.method === "POST" && url.pathname === "/webhooks/solami") {
      if (config.webhookSecret) {
        const got = (req.headers["x-webhook-secret"] as string) || (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (got !== config.webhookSecret) {
          webhookStats.rejected++;
          return json(res, 401, { error: "bad secret" });
        }
      }
      const body = await readBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        webhookStats.unparsed++;
        return json(res, 400, { error: "invalid json" });
      }
      const events = normalizeBlur(parsed, "webhook");
      meters.webhook.setState("live");
      meters.webhook.tick();
      if (events.length === 0) webhookStats.unparsed++;
      else webhookStats.ok++;
      for (const e of events) radar.ingest(e);
      return json(res, 200, { accepted: events.length });
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : "error" });
  }
});

// ---- Live push to dashboard ----
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set<WebSocket>();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "snapshot", data: snapshot() }));
  ws.on("close", () => clients.delete(ws));
});
const send = (msg: unknown) => {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(s);
};
setInterval(() => clients.size && send({ type: "snapshot", data: snapshot() }), 1000);
radar.on("alert", (a) => send({ type: "alert", data: a }));

server.listen(config.port, () => {
  log(`Liquidity Flight Radar on http://localhost:${config.port}  (mode: ${config.mode}, sources: ${sources.join(", ") || "none"})`);
});

process.on("SIGINT", () => process.exit(0));
