import type {
  BridgeContext,
  FlowClass,
  MarketEvent,
  ScoreSignal,
  TokenScore,
} from "../../shared-types/src/index.ts";

export interface ScoringConfig {
  windowSec: number;
  minVolumeUsd: number; // below this, sell pressure is not meaningful
  minLiquidityMoveUsd: number; // below this, liquidity moves are ignored
  alertLiquidityChangePct: number;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  windowSec: 300,
  minVolumeUsd: 2_000,
  minLiquidityMoveUsd: 2_000,
  alertLiquidityChangePct: 20,
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Rolling per-token state. Events are pruned lazily to the window. */
export class TokenWindow {
  events: MarketEvent[] = [];
  symbol?: string;
  firstSeen: number;
  launchedAt?: number;
  lastPoolLiquidityUsd: number | null = null;
  lastPriceUsd: number | null = null;
  firstPoolLiquidityInWindow: number | null = null;

  constructor(public token: string, now: number) {
    this.firstSeen = now;
  }

  push(e: MarketEvent, windowMs: number) {
    if ("symbol" in e && e.symbol) this.symbol = e.symbol;
    if (e.kind === "launch") this.launchedAt = e.ts;
    if (e.kind === "pool" && this.launchedAt === undefined) this.launchedAt = e.ts;
    if ("poolLiquidityUsd" in e && typeof e.poolLiquidityUsd === "number") {
      this.lastPoolLiquidityUsd = e.poolLiquidityUsd;
    }
    if (e.kind === "trade" && typeof e.priceUsd === "number") this.lastPriceUsd = e.priceUsd;
    this.events.push(e);
    this.prune(e.ts, windowMs);
  }

  prune(now: number, windowMs: number) {
    const cutoff = now - windowMs;
    let i = 0;
    while (i < this.events.length && this.events[i].ts < cutoff) i++;
    if (i > 0) this.events.splice(0, i);
    // oldest known pool liquidity inside window (for % change)
    this.firstPoolLiquidityInWindow = null;
    for (const e of this.events) {
      if ("poolLiquidityUsd" in e && typeof e.poolLiquidityUsd === "number") {
        this.firstPoolLiquidityInWindow = e.poolLiquidityUsd;
        break;
      }
    }
  }
}

export function classifyFlow(
  netUsd: number,
  tokenVolumeUsd: number,
  bridge: BridgeContext | null,
  cfg: ScoringConfig,
): FlowClass {
  if (tokenVolumeUsd < cfg.minVolumeUsd && Math.abs(netUsd) < cfg.minLiquidityMoveUsd) {
    return "neutral";
  }
  if (bridge && bridge.strength >= 0.3) {
    if (bridge.direction === "outflow" && netUsd < 0) return "outflow";
    if (bridge.direction === "inflow" && netUsd > 0) return "inflow";
  }
  if (Math.abs(netUsd) >= cfg.minLiquidityMoveUsd) return "rotation";
  return "neutral";
}

export function scoreToken(
  w: TokenWindow,
  now: number,
  bridge: BridgeContext | null,
  cfg: ScoringConfig = DEFAULT_CONFIG,
): TokenScore {
  w.prune(now, cfg.windowSec * 1000);

  let buyUsd = 0, sellUsd = 0, trades = 0, add = 0, remove = 0, newPools = 0;
  const wallets = new Set<string>();
  const sellers = new Set<string>();
  const outByWallet = new Map<string, number>();

  for (const e of w.events) {
    if (e.kind === "trade") {
      trades++;
      wallets.add(e.wallet);
      if (e.side === "buy") buyUsd += e.usd;
      else {
        sellUsd += e.usd;
        sellers.add(e.wallet);
        outByWallet.set(e.wallet, (outByWallet.get(e.wallet) ?? 0) + e.usd);
      }
    } else if (e.kind === "liquidity") {
      wallets.add(e.wallet);
      if (e.action === "add") add += e.usd;
      else {
        remove += e.usd;
        outByWallet.set(e.wallet, (outByWallet.get(e.wallet) ?? 0) + e.usd);
      }
    } else if (e.kind === "pool") {
      newPools++;
    }
  }

  const volumeUsd = buyUsd + sellUsd;
  const sellPressure = volumeUsd > 0 ? sellUsd / volumeUsd : 0;
  const outTotal = [...outByWallet.values()].reduce((a, b) => a + b, 0);
  const top3 = [...outByWallet.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  const top3Share = outTotal > 0 ? top3 / outTotal : 0;

  const liqMove = add + remove;
  const liquidityNetUsd = add - remove;

  let liqChangePct: number | null = null;
  const base = w.firstPoolLiquidityInWindow;
  if (base && base > 0 && w.lastPoolLiquidityUsd !== null) {
    liqChangePct = ((w.lastPoolLiquidityUsd - base) / base) * 100;
  } else if (w.lastPoolLiquidityUsd && w.lastPoolLiquidityUsd + remove > 0 && remove > 0) {
    liqChangePct = (liquidityNetUsd / (w.lastPoolLiquidityUsd + remove)) * 100;
  }

  const signals: ScoreSignal[] = [];
  const actions: string[] = [];
  let score = 0;

  // 1) liquidity outflow (max 35)
  let c1 = 0;
  if (liqMove >= cfg.minLiquidityMoveUsd) {
    const ratio = (remove - add) / liqMove; // -1..1
    c1 = Math.max(0, ratio) * 35;
  }
  if (liqChangePct !== null && liqChangePct < 0) {
    c1 = Math.max(c1, clamp(-liqChangePct / 50) * 35);
  }
  if (c1 >= 1) {
    const pctTxt = liqChangePct !== null ? `${liqChangePct.toFixed(0)}% pool liquidity, ` : "";
    signals.push({
      label: "Liquidity outflow",
      points: Math.round(c1),
      detail: `${pctTxt}$${fmt(remove)} removed vs $${fmt(add)} added in ${cfg.windowSec / 60} min`,
    });
    actions.push("Avoid providing new liquidity until withdrawals stop");
  }
  score += c1;

  // 2) sell pressure (max 25)
  let c2 = 0;
  if (volumeUsd >= cfg.minVolumeUsd) c2 = clamp((sellPressure - 0.5) / 0.4) * 25;
  if (c2 >= 1) {
    signals.push({
      label: "Sell pressure",
      points: Math.round(c2),
      detail: `${(sellPressure * 100).toFixed(0)}% of $${fmt(volumeUsd)} volume is selling by ${sellers.size} wallets`,
    });
    actions.push("Reduce exposure or tighten stops");
  }
  score += c2;

  // 3) concentrated exits (max 20)
  let c3 = 0;
  if (outTotal >= cfg.minLiquidityMoveUsd) c3 = clamp((top3Share - 0.4) / 0.5) * 20;
  if (c3 >= 1) {
    signals.push({
      label: "Concentrated exits",
      points: Math.round(c3),
      detail: `top 3 wallets account for ${(top3Share * 100).toFixed(0)}% of $${fmt(outTotal)} sold or withdrawn`,
    });
    actions.push("Treat as coordinated exit; check wallet funding links before trading");
  }
  score += c3;

  // 4) cross-chain outflow context (max 10)
  let c4 = 0;
  if (bridge && bridge.direction === "outflow") c4 = 10 * bridge.strength;
  if (c4 >= 1 && (c1 > 0 || c2 > 0)) {
    signals.push({
      label: "Bridge outflow context",
      points: Math.round(c4),
      detail: `net $${fmt(Math.abs(bridge!.netUsd))} left Solana via bridges (daily); ${bridge!.liveBridgeTxPerMin.toFixed(0)} live bridge tx/min`,
    });
    actions.push("Monitor bridge outflow; capital may be rotating off Solana");
  } else {
    c4 = 0;
  }
  score += c4;

  // 5) young token with exits (max 10)
  const ageSec = w.launchedAt !== undefined ? Math.max(0, (now - w.launchedAt) / 1000) : null;
  let c5 = 0;
  if (ageSec !== null && ageSec < 3600 && remove > 0 && c1 > 0) c5 = 10;
  if (c5 > 0) {
    signals.push({
      label: "Young token",
      points: c5,
      detail: `launched ${(ageSec! / 60).toFixed(0)} min ago and liquidity is already leaving`,
    });
  }
  score += c5;

  score = Math.round(clamp(score, 0, 100));
  const level = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "elevated" : "low";

  // positive-flow hints
  if (signals.length === 0 && volumeUsd >= cfg.minVolumeUsd && sellPressure < 0.4) {
    signals.push({
      label: "Buy-side flow",
      points: 0,
      detail: `${((1 - sellPressure) * 100).toFixed(0)}% buying across ${wallets.size} wallets, no exit signals`,
    });
  }
  if (actions.length === 0) actions.push("No action needed; keep monitoring");

  const flow = classifyFlow(liquidityNetUsd + (buyUsd - sellUsd), volumeUsd + liqMove, bridge, cfg);

  return {
    token: w.token,
    symbol: w.symbol,
    score,
    level,
    flow,
    windowSec: cfg.windowSec,
    metrics: {
      trades,
      volumeUsd,
      buyUsd,
      sellUsd,
      sellPressure,
      uniqueWallets: wallets.size,
      uniqueSellers: sellers.size,
      top3Share,
      liquidityAddedUsd: add,
      liquidityRemovedUsd: remove,
      liquidityNetUsd,
      liquidityChangePct: liqChangePct,
      poolLiquidityUsd: w.lastPoolLiquidityUsd,
      priceUsd: w.lastPriceUsd,
      newPools,
      ageSec,
    },
    signals,
    actions: [...new Set(actions)],
    updatedAt: now,
  };
}

export function fmt(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}
