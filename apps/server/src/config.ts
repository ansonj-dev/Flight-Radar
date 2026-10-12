import "dotenv/config";

const env = (k: string, d = ""): string => (process.env[k] ?? d).trim();
const int = (k: string, d: number) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && process.env[k] !== undefined && process.env[k] !== "" ? n : d;
};

function jsonList(k: string): unknown[] | undefined {
  const raw = env(k);
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [v];
  } catch {
    console.warn(`[config] ${k} is not valid JSON, ignoring`);
    return undefined;
  }
}

const apiKey = env("SOLAMI_API_KEY");
const authHeader = env("SOLAMI_AUTH_HEADER", "x-api-key");

export const config = {
  mode: env("MODE", "live") as "live" | "simulate",
  port: int("PORT", 8787),
  apiKey,
  /** Header attached to Solami HTTP/WebSocket requests. Set SOLAMI_AUTH_HEADER="" to disable. */
  authHeaders: (apiKey && authHeader ? { [authHeader]: apiKey } : {}) as Record<string, string>,

  rpcUrl: env("SOLAMI_RPC_URL"),
  rpcRps: int("SOLAMI_RPC_RPS", 50),
  grpcEndpoint: env("SOLAMI_GRPC_ENDPOINT"),
  grpcToken: env("SOLAMI_GRPC_TOKEN", apiKey),
  mirageUrl: env("SOLAMI_MIRAGE_WS_URL"),
  mirageSubscribe: jsonList("SOLAMI_MIRAGE_SUBSCRIBE"),
  blurWsUrl: env("SOLAMI_BLUR_WS_URL"),
  blurSubscribe: jsonList("SOLAMI_BLUR_SUBSCRIBE"),
  dataApiUrl: env("SOLAMI_DATA_API_URL", "https://api.solami.dev"),

  webhookSecret: env("SOLAMI_WEBHOOK_SECRET"),

  telegramToken: env("TELEGRAM_BOT_TOKEN"),
  telegramChatId: env("TELEGRAM_CHAT_ID"),
  discordWebhook: env("DISCORD_WEBHOOK_URL"),

  watchlist: env("WATCHLIST").split(",").map((s) => s.trim()).filter(Boolean),
  alertMinLiquidityChangePct: int("ALERT_MIN_LIQUIDITY_CHANGE_PCT", 20),
  alertWindowSec: int("ALERT_WINDOW_SECONDS", 300),
  alertMinScore: int("ALERT_MIN_SCORE", 60),
  alertCooldownSec: int("ALERT_COOLDOWN_SECONDS", 600),
  minVolumeUsd: int("MIN_VOLUME_USD", 2000),
  minLiquidityMoveUsd: int("MIN_LIQUIDITY_MOVE_USD", 2000),
  maxTrackedTokens: int("MAX_TRACKED_TOKENS", 800),

  beamEnabled: env("BEAM_ENABLED", "false") === "true",
};

export type Config = typeof config;
