import WebSocket from "ws";
import { StreamMeter } from "./meter.ts";

export interface WsOptions {
  url: string;
  headers?: Record<string, string>;
  /** JSON messages sent right after the socket opens. */
  subscribe?: unknown[];
  onMessage: (data: unknown, rawText: string) => void;
  meter: StreamMeter;
  /** Reconnect if nothing arrives for this long (0 = disabled). */
  staleMs?: number;
  log?: (msg: string) => void;
}

/** WebSocket with exponential backoff, heartbeat and a stale-stream watchdog. */
export class ReconnectingWs {
  private ws?: WebSocket;
  private attempt = 0;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;

  constructor(private o: WsOptions) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.ws?.close();
  }

  private connect() {
    const { meter } = this.o;
    meter.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = new WebSocket(this.o.url, { headers: this.o.headers, handshakeTimeout: 15_000 });
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
      meter.setState("live");
      this.o.log?.(`${meter.name}: connected`);
      for (const m of this.o.subscribe ?? []) ws.send(typeof m === "string" ? m : JSON.stringify(m));
      clearInterval(this.watchdog);
      this.watchdog = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.ping();
        const stale = this.o.staleMs ?? 0;
        if (stale && meter.lastEventAt && Date.now() - meter.lastEventAt > stale) {
          this.o.log?.(`${meter.name}: stale for ${stale}ms, reconnecting`);
          ws.terminate();
        }
      }, 15_000);
    });

    ws.on("message", (buf) => {
      const text = buf.toString();
      meter.tick();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* non-JSON frame, pass through as text */
      }
      try {
        this.o.onMessage(parsed, text);
      } catch (e) {
        meter.lastError = e instanceof Error ? e.message : String(e);
      }
    });

    ws.on("unexpected-response", (_req, res) => {
      meter.setState("error", `HTTP ${res.statusCode} on WebSocket handshake (check API key and URL)`);
    });
    ws.on("error", (e) => meter.setState("error", e));
    ws.on("close", () => {
      clearInterval(this.watchdog);
      if (this.stopped) return;
      meter.reconnects++;
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5);
      if (meter.state !== "error") meter.setState("reconnecting");
      this.timer = setTimeout(() => this.connect(), delay);
    });
  }
}
