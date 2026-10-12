import { describe, expect, it } from "vitest";
import { TokenWindow, scoreToken, DEFAULT_CONFIG } from "../src/index.ts";
import type { BridgeContext, MarketEvent } from "../../shared-types/src/index.ts";

const T0 = 1_700_000_000_000;
const win = DEFAULT_CONFIG.windowSec * 1000;

function trade(i: number, wallet: string, side: "buy" | "sell", usd: number): MarketEvent {
  return { kind: "trade", ts: T0 + i * 1000, token: "TOK", pool: "P", side, wallet, usd, source: "sim" };
}
function liq(i: number, wallet: string, action: "add" | "remove", usd: number, poolLiquidityUsd?: number): MarketEvent {
  return { kind: "liquidity", ts: T0 + i * 1000, token: "TOK", pool: "P", action, wallet, usd, poolLiquidityUsd, source: "sim" };
}

describe("scoreToken", () => {
  it("scores quiet buy-side activity as low", () => {
    const w = new TokenWindow("TOK", T0);
    for (let i = 0; i < 30; i++) w.push(trade(i, `w${i}`, i % 5 === 0 ? "sell" : "buy", 500), win);
    const s = scoreToken(w, T0 + 60_000, null);
    expect(s.score).toBeLessThan(25);
    expect(s.level).toBe("low");
  });

  it("flags a concentrated liquidity exit as high or critical", () => {
    const w = new TokenWindow("TOK", T0);
    w.push({ kind: "pool", ts: T0, token: "TOK", pool: "P", source: "sim" }, win);
    w.push(liq(1, "a", "add", 20_000, 100_000), win);
    w.push(liq(100, "whale1", "remove", 40_000, 70_000), win);
    w.push(liq(110, "whale2", "remove", 30_000, 40_000), win);
    for (let i = 0; i < 20; i++) w.push(trade(120 + i, "whale1", "sell", 800), win);
    const s = scoreToken(w, T0 + 200_000, null);
    expect(s.score).toBeGreaterThanOrEqual(50);
    expect(s.metrics.liquidityChangePct!).toBeLessThan(-20);
    expect(s.metrics.top3Share).toBeGreaterThan(0.9);
    expect(s.signals.map((x) => x.label)).toContain("Concentrated exits");
  });

  it("adds bridge outflow points only alongside exit signals", () => {
    const bridge: BridgeContext = { direction: "outflow", netUsd: -5e7, liveBridgeTxPerMin: 12, strength: 1, asOf: T0 };
    const quiet = new TokenWindow("TOK", T0);
    quiet.push(trade(1, "a", "buy", 5000), win);
    expect(scoreToken(quiet, T0 + 10_000, bridge).signals.map((x) => x.label)).not.toContain("Bridge outflow context");

    const exit = new TokenWindow("TOK", T0);
    exit.push(liq(1, "a", "remove", 30_000), win);
    const s = scoreToken(exit, T0 + 10_000, bridge);
    expect(s.signals.map((x) => x.label)).toContain("Bridge outflow context");
    expect(s.flow).toBe("outflow");
  });

  it("prunes events outside the window", () => {
    const w = new TokenWindow("TOK", T0);
    w.push(liq(0, "a", "remove", 50_000), win);
    const s = scoreToken(w, T0 + win + 5_000, null);
    expect(s.metrics.liquidityRemovedUsd).toBe(0);
    expect(s.score).toBe(0);
  });
});
