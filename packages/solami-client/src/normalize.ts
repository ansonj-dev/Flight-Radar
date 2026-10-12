import type { MarketEvent } from "../../shared-types/src/index.ts";
import { QUOTE_MINTS } from "./programs.ts";

/**
 * Blur / webhook payload normalizer.
 *
 * Solami's Blur message schema is not publicly documented, so this is a tolerant
 * adapter: it accepts several common field spellings and returns null when a message
 * is not recognizable. If your Blur payloads use different names, this is the ONLY
 * file you need to adjust. Run `npm run check` with a key to print sample payloads.
 */

type Raw = Record<string, any>;

const pick = (o: Raw, keys: string[]): any => {
  for (const k of keys) {
    const v = k.split(".").reduce<any>((a, p) => (a == null ? undefined : a[p]), o);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

function toMs(v: unknown): number {
  const n = num(v);
  if (n === undefined) {
    const d = typeof v === "string" ? Date.parse(v) : NaN;
    return Number.isFinite(d) ? d : Date.now();
  }
  return n > 1e12 ? n : n * 1000; // seconds -> ms
}

function typeOf(o: Raw): string {
  const t = pick(o, ["type", "event", "event_type", "kind", "channel", "topic", "stream", "data.type"]);
  return typeof t === "string" ? t.toLowerCase() : "";
}

/** Unwrap common envelopes: {data: {...}}, {payload: {...}}, [ {...}, ... ] */
function unwrap(raw: unknown): Raw[] {
  if (Array.isArray(raw)) return raw.flatMap(unwrap);
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Raw;
  for (const k of ["events", "trades", "batch", "rows"]) if (Array.isArray(o[k])) return o[k].flatMap(unwrap);
  for (const k of ["data", "payload", "event", "result"]) {
    if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && !pick(o, ["type"])) {
      return [{ ...o[k], __outerType: typeOf(o) }];
    }
    if (Array.isArray(o[k])) return o[k].flatMap(unwrap);
  }
  return [o];
}

export function normalizeBlur(raw: unknown, source: MarketEvent["source"] = "blur"): MarketEvent[] {
  const out: MarketEvent[] = [];
  for (const o of unwrap(raw)) {
    const t = typeOf(o) || String(o.__outerType ?? "");
    const ts = toMs(pick(o, ["timestamp", "ts", "time", "block_time", "blockTime", "created_at"]));
    const sig = pick(o, ["signature", "sig", "tx", "txid", "tx_hash"]);
    const dex = pick(o, ["dex", "protocol", "program_name", "venue"]);
    const pool = pick(o, ["pool", "pool_address", "poolAddress", "pair", "pair_address", "amm"]);
    const wallet = pick(o, ["wallet", "trader", "maker", "signer", "owner", "user", "sender"]) ?? "unknown";

    // token resolution: explicit token, else the non-quote side of a pair
    let token = pick(o, ["token", "token_mint", "mint", "base_mint", "baseMint", "token_address"]);
    const a = pick(o, ["token_in", "mint_in", "input_mint", "tokenIn.mint"]);
    const b = pick(o, ["token_out", "mint_out", "output_mint", "tokenOut.mint"]);
    if (!token && (a || b)) token = a && !QUOTE_MINTS.has(a) ? a : b;
    const symbol = pick(o, ["symbol", "token_symbol", "base_symbol", "token.symbol"]);
    const poolLiquidityUsd = num(pick(o, ["pool_liquidity_usd", "liquidity_usd", "tvl_usd", "tvl", "poolLiquidityUsd"]));
    const usd = num(pick(o, ["usd", "amount_usd", "value_usd", "volume_usd", "usd_value", "usdValue"])) ?? 0;

    const base = { ts, sig, dex, source } as const;

    if (/trade|swap/.test(t)) {
      if (!token) continue;
      let side = String(pick(o, ["side", "direction", "trade_type", "action"]) ?? "").toLowerCase();
      if (!side && a && b) side = token === b ? "buy" : "sell"; // buying the token = token on the out side
      out.push({
        kind: "trade", ...base, pool: pool ?? "unknown", token, symbol,
        side: /sell|short|out/.test(side) ? "sell" : "buy",
        wallet, usd, priceUsd: num(pick(o, ["price_usd", "priceUsd", "price"])), poolLiquidityUsd,
      });
    } else if (/graduat/.test(t)) {
      if (!token) continue;
      const liqUsd = usd || poolLiquidityUsd || 12000;
      out.push({ kind: "pool", ...base, pool: pool ?? "unknown", token, symbol, poolLiquidityUsd: liqUsd });
      out.push({
        kind: "liquidity", ...base, pool: pool ?? "unknown", token, symbol,
        action: "add", wallet, usd: liqUsd, poolLiquidityUsd: liqUsd,
      });
    } else if (/pool/.test(t)) {
      if (!token) continue;
      const initLiq = usd || poolLiquidityUsd || (pick(o, ["initial_liquidity", "initial_sol"]) ? num(pick(o, ["initial_liquidity", "initial_sol"]))! * 110 : 3500);
      out.push({ kind: "pool", ...base, pool: pool ?? "unknown", token, symbol, wallet: wallet === "unknown" ? undefined : wallet, poolLiquidityUsd: initLiq });
      out.push({
        kind: "liquidity", ...base, pool: pool ?? "unknown", token, symbol,
        action: "add", wallet, usd: initLiq, poolLiquidityUsd: initLiq,
      });
    } else if (/liquidity|lp_|add_liq|remove_liq|deposit|withdraw/.test(t)) {
      if (!token) continue;
      const act = String(pick(o, ["action", "side", "change_type", "liquidity_action"]) ?? t).toLowerCase();
      out.push({
        kind: "liquidity", ...base, pool: pool ?? "unknown", token, symbol,
        action: /remove|withdraw|burn|decrease/.test(act) ? "remove" : "add",
        wallet, usd: Math.abs(usd || 1000), poolLiquidityUsd,
      });
    } else if (/launch|mint_created|token_created|new_token/.test(t)) {
      if (!token) continue;
      out.push({ kind: "launch", ...base, token, symbol, creator: pick(o, ["creator", "deployer", "wallet"]) });
    }
  }
  return out;
}
