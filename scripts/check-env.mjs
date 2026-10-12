// Connectivity self-test: `npm run check`
// Verifies each configured Solami endpoint with your key and prints a few raw Blur frames so you
// can confirm the payload field names match packages/solami-client/src/normalize.ts.
import "dotenv/config";
import WebSocket from "ws";

const env = (k, d = "") => (process.env[k] ?? d).trim();
const apiKey = env("SOLAMI_API_KEY");
const header = env("SOLAMI_AUTH_HEADER", "x-api-key");
const headers = apiKey && header ? { [header]: apiKey } : {};
const ok = (m) => console.log("  \x1b[32m✔\x1b[0m " + m);
const bad = (m) => console.log("  \x1b[31m✘\x1b[0m " + m);
const skip = (m) => console.log("  - " + m);

console.log("Solami connectivity check\n");

console.log("RPC");
if (!env("SOLAMI_RPC_URL")) skip("SOLAMI_RPC_URL not set");
else {
  try {
    const t0 = Date.now();
    const r = await fetch(env("SOLAMI_RPC_URL"), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    j.result ? ok(`getSlot = ${j.result} (${Date.now() - t0} ms)`) : bad(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  } catch (e) { bad(String(e)); }
}

console.log("gRPC (Yellowstone)");
if (!env("SOLAMI_GRPC_ENDPOINT")) skip("SOLAMI_GRPC_ENDPOINT not set");
else {
  try {
    const { default: Client } = await import("@triton-one/yellowstone-grpc");
    const c = new Client(env("SOLAMI_GRPC_ENDPOINT"), env("SOLAMI_GRPC_TOKEN", apiKey) || undefined, undefined);
    await c.connect();
    const v = await c.getVersion();
    ok(`connected, server version ${v.version}`);
  } catch (e) { bad(String(e)); }
}

async function sampleWs(name, urlKey, subKey) {
  console.log(name);
  const url = env(urlKey);
  if (!url) return skip(`${urlKey} not set`);
  let subs = [];
  try { subs = env(subKey) ? [].concat(JSON.parse(env(subKey))) : []; } catch { bad(`${subKey} is not valid JSON`); }
  await new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let n = 0;
    const done = () => { try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(() => { n ? ok(`${n} frame(s) in 15 s`) : bad("connected but no frames in 15 s (check subscribe message)"); done(); }, 15000);
    ws.on("open", () => { ok("connected"); subs.forEach((m) => ws.send(typeof m === "string" ? m : JSON.stringify(m))); });
    ws.on("message", (d) => { if (n++ < 3) console.log("    sample frame: " + d.toString().slice(0, 400)); if (n >= 3) { clearTimeout(timer); ok("receiving frames"); done(); } });
    ws.on("unexpected-response", (_q, r) => { bad(`handshake HTTP ${r.statusCode}`); clearTimeout(timer); done(); });
    ws.on("error", (e) => { bad(String(e.message)); clearTimeout(timer); done(); });
  });
}
await sampleWs("Blur (WebSocket)", "SOLAMI_BLUR_WS_URL", "SOLAMI_BLUR_SUBSCRIBE");
await sampleWs("Mirage (WebSocket)", "SOLAMI_MIRAGE_WS_URL", "SOLAMI_MIRAGE_SUBSCRIBE");

console.log("Data API");
try {
  const r = await fetch(env("SOLAMI_DATA_API_URL", "https://api.solami.dev") + "/pricing", { signal: AbortSignal.timeout(10000) });
  r.ok ? ok(`api.solami.dev reachable (HTTP ${r.status})`) : bad(`HTTP ${r.status}`);
} catch (e) { bad(String(e)); }

console.log("\nDone. Frames printed above should map to fields read in packages/solami-client/src/normalize.ts");
process.exit(0);
