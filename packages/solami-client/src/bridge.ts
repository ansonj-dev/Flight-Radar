import type { BridgeContext } from "../../shared-types/src/index.ts";
import { StreamMeter } from "./meter.ts";

/**
 * Cross-chain context: public DefiLlama bridge volume for Solana (daily deposits/withdrawals
 * across all bridges), combined at read time with LIVE Wormhole activity seen over Solami
 * Yellowstone. DefiLlama "depositUSD" = funds deposited into bridges on Solana (leaving),
 * "withdrawUSD" = funds withdrawn on Solana (arriving).
 */
export class BridgeMonitor {
  private daily: { netUsd: number; gross: number; asOf: number } | null = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private meter: StreamMeter,
    private liveTxPerMin: () => number,
    private url = "https://bridges.llama.fi/bridgevolume/Solana",
  ) {}

  start() {
    this.meter.setState("connecting");
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10 * 60_000);
  }

  stop() {
    clearInterval(this.timer);
  }

  async refresh() {
    try {
      const res = await fetch(this.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`bridges HTTP ${res.status}`);
      const rows: any[] = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) throw new Error("bridges: unexpected payload");
      // last complete day = second to last row if the final row is today's partial
      const row = rows.length > 1 ? rows[rows.length - 2] : rows[0];
      const dep = Number(row.depositUSD ?? 0);
      const wd = Number(row.withdrawUSD ?? 0);
      this.daily = { netUsd: wd - dep, gross: dep + wd, asOf: Date.now() };
      this.meter.setState("live");
      this.meter.tick();
    } catch (e) {
      this.meter.setState("error", e);
    }
  }

  context(): BridgeContext | null {
    const live = this.liveTxPerMin();
    if (!this.daily) {
      return live > 0
        ? { direction: "neutral", netUsd: 0, liveBridgeTxPerMin: live, strength: 0, asOf: Date.now() }
        : null;
    }
    const { netUsd, gross, asOf } = this.daily;
    const ratio = gross > 0 ? Math.abs(netUsd) / gross : 0;
    const strength = Math.min(1, ratio / 0.3);
    const direction = ratio < 0.05 ? "neutral" : netUsd > 0 ? "inflow" : "outflow";
    return { direction, netUsd, liveBridgeTxPerMin: live, strength, asOf };
  }
}
