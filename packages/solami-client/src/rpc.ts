import { StreamMeter } from "./meter.ts";

export interface RpcOptions {
  url: string;
  headers?: Record<string, string>;
  rps?: number; // client-side rate limit (Pro plan allows 200 rps)
  meter?: StreamMeter;
}

/** Minimal JSON-RPC client with a token-bucket limiter and 429/5xx retry. */
export class SolamiRpc {
  private tokens: number;
  private last = Date.now();
  private id = 1;
  latencyMs: number | null = null;
  slot: number | null = null;

  constructor(private o: RpcOptions) {
    this.tokens = o.rps ?? 20;
  }

  private async take() {
    const rps = this.o.rps ?? 20;
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(rps, this.tokens + ((now - this.last) / 1000) * rps);
      this.last = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async call<T = any>(method: string, params: unknown[] = []): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.take();
      const t0 = Date.now();
      try {
        const res = await fetch(this.o.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...this.o.headers },
          body: JSON.stringify({ jsonrpc: "2.0", id: this.id++, method, params }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`RPC ${method} HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
        const json: any = await res.json();
        if (json.error) throw new Error(`RPC ${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
        this.latencyMs = Date.now() - t0;
        this.o.meter?.tick();
        return json.result as T;
      } catch (e) {
        lastErr = e;
        if (attempt === 3) break;
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
    this.o.meter?.setState("error", lastErr);
    throw lastErr;
  }

  /** Probe: current slot + round-trip latency. Drives the stream-health panel. */
  async probe() {
    const slot = await this.call<number>("getSlot", [{ commitment: "confirmed" }]);
    this.slot = slot;
    this.o.meter?.setState("live");
    return { slot, latencyMs: this.latencyMs };
  }

  /** Top-10 holder share of supply, a live concentration check for a token mint. */
  async holderConcentration(mint: string): Promise<{ top10Share: number; top1Share: number; supply: number } | null> {
    try {
      const [largest, supply] = await Promise.all([
        this.call<{ value: { uiAmount: number }[] }>("getTokenLargestAccounts", [mint]),
        this.call<{ value: { uiAmount: number } }>("getTokenSupply", [mint]),
      ]);
      const total = supply.value.uiAmount;
      if (!total) return null;
      const amounts = largest.value.map((v) => v.uiAmount).sort((a, b) => b - a);
      const top10 = amounts.slice(0, 10).reduce((a, b) => a + b, 0);
      return { top10Share: top10 / total, top1Share: (amounts[0] ?? 0) / total, supply: total };
    } catch {
      return null;
    }
  }
}
