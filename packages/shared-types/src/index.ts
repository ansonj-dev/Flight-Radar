export type Side = "buy" | "sell";

interface Base {
  ts: number; // epoch ms
  sig?: string;
  dex?: string;
  source: "blur" | "webhook" | "mirage" | "grpc" | "sim";
}

export interface TradeEvent extends Base {
  kind: "trade";
  pool: string;
  token: string;
  symbol?: string;
  side: Side;
  wallet: string;
  usd: number;
  priceUsd?: number;
  poolLiquidityUsd?: number;
}

export interface LiquidityEvent extends Base {
  kind: "liquidity";
  action: "add" | "remove";
  pool: string;
  token: string;
  symbol?: string;
  wallet: string;
  usd: number;
  poolLiquidityUsd?: number;
}

export interface PoolEvent extends Base {
  kind: "pool";
  pool: string;
  token: string;
  symbol?: string;
  wallet?: string;
  poolLiquidityUsd?: number;
}

export interface LaunchEvent extends Base {
  kind: "launch";
  token: string;
  symbol?: string;
  creator?: string;
}

export type MarketEvent = TradeEvent | LiquidityEvent | PoolEvent | LaunchEvent;

/** Raw program activity observed on Yellowstone gRPC / Mirage. */
export interface ProgramActivity {
  ts: number;
  slot: number;
  program: string;
  label: string;
  category: "dex" | "bridge" | "other";
  sig: string;
}

export type Severity = "low" | "medium" | "high" | "critical";
export type FlowClass = "inflow" | "outflow" | "rotation" | "neutral";

export interface BridgeContext {
  direction: FlowClass; // inflow = capital entering Solana, outflow = leaving
  netUsd: number; // + into Solana, - out of Solana (daily, from public bridge data)
  liveBridgeTxPerMin: number; // live Wormhole-class activity seen on Yellowstone
  strength: number; // 0..1
  asOf: number;
}

export interface ScoreSignal {
  label: string;
  points: number;
  detail: string;
}

export interface TokenScore {
  token: string;
  symbol?: string;
  score: number; // 0..100 Liquidity Flight Score
  level: "low" | "elevated" | "high" | "critical";
  flow: FlowClass;
  windowSec: number;
  metrics: {
    trades: number;
    volumeUsd: number;
    buyUsd: number;
    sellUsd: number;
    sellPressure: number; // 0..1
    uniqueWallets: number;
    uniqueSellers: number;
    top3Share: number; // 0..1 share of sell+removal USD from top 3 wallets
    liquidityAddedUsd: number;
    liquidityRemovedUsd: number;
    liquidityNetUsd: number;
    liquidityChangePct: number | null;
    poolLiquidityUsd: number | null;
    priceUsd: number | null;
    newPools: number;
    ageSec: number | null;
  };
  signals: ScoreSignal[];
  actions: string[];
  updatedAt: number;
}

export interface Alert {
  id: string;
  ts: number;
  token: string;
  symbol?: string;
  type:
    | "rapid_liquidity_withdrawal"
    | "concentrated_selling"
    | "abnormal_buy_pressure"
    | "high_flight_score"
    | "cross_chain_outflow";
  severity: Severity;
  title: string;
  windowSec: number;
  score: number;
  liquidityChangePct: number | null;
  liquidityNetUsd: number;
  sellPressure: number;
  top3Share: number;
  bridge: string;
  actions: string[];
}

export interface StreamHealth {
  name: string;
  state: "disabled" | "connecting" | "live" | "reconnecting" | "error";
  lastEventAt: number | null;
  events: number;
  reconnects: number;
  eventsPerSec: number;
  lastError?: string;
  detail?: string;
}
