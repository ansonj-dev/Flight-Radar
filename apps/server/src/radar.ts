import { EventEmitter } from "node:events";
import { DEFAULT_CONFIG, TokenWindow, scoreToken, type ScoringConfig } from "../../../packages/scoring-engine/src/index.ts";
import type {
  Alert,
  BridgeContext,
  MarketEvent,
  ProgramActivity,
  TokenScore,
} from "../../../packages/shared-types/src/index.ts";
import { AlertEngine } from "./alerts.ts";
import type { Config } from "./config.ts";

interface Bucket {
  m: number; // minute index
  trades: number;
  volumeUsd: number;
  pools: number;
  launches: number;
  liqAdded: number;
  liqRemoved: number;
}

/** Central state: ingests events, keeps rolling windows, scores tokens, raises alerts. */
export class Radar extends EventEmitter {
  private windows = new Map<string, TokenWindow>();
  private touched = new Map<string, number>();
  private scores = new Map<string, TokenScore>();
  private buckets: Bucket[] = [];
  recentEvents: MarketEvent[] = [];
  alerts: Alert[] = [];
  private bridgeTimes: number[] = [];
  private dexTimes: number[] = [];
  private programCounts = new Map<string, { label: string; category: string; times: number[] }>();
  lastSlot = 0;
  private scoring: ScoringConfig;
  readonly alertEngine: AlertEngine;
  bridge: () => BridgeContext | null = () => null;
  private timer?: NodeJS.Timeout;

  constructor(private cfg: Config) {
    super();
    this.scoring = {
      ...DEFAULT_CONFIG,
      windowSec: cfg.alertWindowSec,
      minVolumeUsd: cfg.minVolumeUsd,
      minLiquidityMoveUsd: cfg.minLiquidityMoveUsd,
      alertLiquidityChangePct: cfg.alertMinLiquidityChangePct,
    };
    this.alertEngine = new AlertEngine(cfg, (a) => {
      this.alerts.unshift(a);
      this.alerts.length = Math.min(this.alerts.length, 200);
      this.emit("alert", a);
    });
  }

  start() {
    this.timer = setInterval(() => this.rescore(), 2000);
  }
  stop() {
    clearInterval(this.timer);
  }

  private bucket(ts: number): Bucket {
    const m = Math.floor(ts / 60_000);
    let b = this.buckets[this.buckets.length - 1];
    if (!b || b.m !== m) {
      b = { m, trades: 0, volumeUsd: 0, pools: 0, launches: 0, liqAdded: 0, liqRemoved: 0 };
      this.buckets.push(b);
      const cutoff = m - 1440;
      while (this.buckets.length && this.buckets[0].m < cutoff) this.buckets.shift();
    }
    return b;
  }

  private isPinned(token: string, symbol?: string) {
    return this.cfg.watchlist.some((w) => w === token || (symbol && w.toLowerCase() === symbol.toLowerCase()));
  }

  ingest(e: MarketEvent) {
    const now = e.ts || Date.now();
    let w = this.windows.get(e.token);
    if (!w) {
      if (this.windows.size >= this.cfg.maxTrackedTokens) this.evict();
      w = new TokenWindow(e.token, now);
      this.windows.set(e.token, w);
    }
    w.push(e, this.scoring.windowSec * 1000);
    this.touched.set(e.token, now);

    const b = this.bucket(now);
    if (e.kind === "trade") {
      b.trades++;
      b.volumeUsd += e.usd;
      // High-volume sell dumps extracting capital from the pool
      if (e.side === "sell" && e.usd >= 1500) {
        b.liqRemoved += e.usd;
      }
    } else if (e.kind === "liquidity") {
      if (e.action === "add") b.liqAdded += e.usd;
      else b.liqRemoved += e.usd;
    } else if (e.kind === "pool") {
      b.pools++;
      b.liqAdded += e.poolLiquidityUsd ?? 3500;
    } else if (e.kind === "launch") {
      b.launches++;
    }

    this.recentEvents.unshift(e);
    if (this.recentEvents.length > 300) this.recentEvents.length = 300;
    this.emit("event", e);
  }

  private evict() {
    let oldest: string | undefined;
    let t = Infinity;
    for (const [k, ts] of this.touched) {
      const w = this.windows.get(k);
      if (w && this.isPinned(k, w.symbol)) continue;
      if (ts < t) {
        t = ts;
        oldest = k;
      }
    }
    if (oldest) {
      this.windows.delete(oldest);
      this.touched.delete(oldest);
      this.scores.delete(oldest);
    }
  }

  activity(a: ProgramActivity) {
    this.lastSlot = Math.max(this.lastSlot, a.slot);
    const now = a.ts;
    (a.category === "bridge" ? this.bridgeTimes : this.dexTimes).push(now);
    let p = this.programCounts.get(a.program);
    if (!p) this.programCounts.set(a.program, (p = { label: a.label, category: a.category, times: [] }));
    p.times.push(now);
  }

  private prune(arr: number[], now: number, ms: number) {
    let i = 0;
    while (i < arr.length && arr[i] < now - ms) i++;
    if (i) arr.splice(0, i);
  }

  bridgeTxPerMin(): number {
    this.prune(this.bridgeTimes, Date.now(), 60_000);
    return this.bridgeTimes.length;
  }

  rescore() {
    const now = Date.now();
    const bridge = this.bridge();
    for (const [token, w] of this.windows) {
      if (w.events.length === 0 && !this.scores.has(token)) continue;
      const s = scoreToken(w, now, bridge, this.scoring);
      if (w.events.length === 0 && s.score === 0) {
        this.scores.delete(token);
        continue;
      }
      this.scores.set(token, s);
      this.alertEngine.evaluate(s, bridge, now);
    }
    this.emit("scores");
  }

  getScore(token: string): TokenScore | undefined {
    return this.scores.get(token);
  }

  topTokens(limit = 40): (TokenScore & { pinned: boolean })[] {
    return [...this.scores.values()]
      .sort((a, b) => b.score - a.score || b.metrics.volumeUsd - a.metrics.volumeUsd)
      .slice(0, limit)
      .map((s) => ({ ...s, pinned: this.isPinned(s.token, s.symbol) }));
  }

  metrics() {
    const nowM = Math.floor(Date.now() / 60_000);
    const sum = (minutes: number) => {
      const r = { trades: 0, volumeUsd: 0, pools: 0, launches: 0, liqAdded: 0, liqRemoved: 0 };
      for (const b of this.buckets) {
        if (b.m > nowM - minutes) {
          r.trades += b.trades;
          r.volumeUsd += b.volumeUsd;
          r.pools += b.pools;
          r.launches += b.launches;
          r.liqAdded += b.liqAdded;
          r.liqRemoved += b.liqRemoved;
        }
      }
      return r;
    };
    const now = Date.now();
    this.prune(this.dexTimes, now, 60_000);
    this.prune(this.bridgeTimes, now, 60_000);
    const programs = [...this.programCounts.values()]
      .map((p) => {
        this.prune(p.times, now, 60_000);
        return { label: p.label, category: p.category, perMin: p.times.length };
      })
      .sort((a, b) => b.perMin - a.perMin);
    return {
      last1h: sum(60),
      last24h: sum(1440),
      trackedTokens: this.windows.size,
      dexTxPerMin: this.dexTimes.length,
      bridgeTxPerMin: this.bridgeTimes.length,
      programs,
      slot: this.lastSlot,
      alertDelivery: this.alertEngine.delivery,
    };
  }
}
