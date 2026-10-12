import type { MarketEvent } from "../../../packages/shared-types/src/index.ts";

/**
 * Synthetic feed for UI development and offline tests ONLY (MODE=simulate).
 * Everything it emits is tagged source:"sim" and the dashboard shows a SIMULATED banner.
 * Do NOT use it for the bounty demo: that must run against live mainnet.
 */
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const rid = (n = 44) => Array.from({ length: n }, () => B58[Math.floor(Math.random() * B58.length)]).join("");
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickOne = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

interface SimToken {
  token: string;
  symbol: string;
  pool: string;
  liq: number;
  price: number;
}

export function startSimulator(emit: (e: MarketEvent) => void): () => void {
  const symbols = ["BONKX", "WIFHAT", "MOONCAT", "SOLPEPE", "JUPY", "DRIFTR", "NOVA", "ZEBEC2", "RAYX", "PUMPD"];
  const tokens: SimToken[] = symbols.map((symbol) => ({
    token: rid(),
    symbol,
    pool: rid(),
    liq: rnd(60_000, 900_000),
    price: rnd(0.0001, 3),
  }));
  const wallets = Array.from({ length: 120 }, () => rid());
  const dexes = ["raydium", "orca", "meteora", "pumpswap"];

  const base = (t: SimToken) => ({ ts: Date.now(), token: t.token, symbol: t.symbol, pool: t.pool, dex: pickOne(dexes), source: "sim" as const });

  const trade = (t: SimToken, wallet = pickOne(wallets), side?: "buy" | "sell", usd = rnd(50, 2500)) => {
    const s = side ?? (Math.random() < 0.52 ? "buy" : "sell");
    t.price *= 1 + (s === "buy" ? 1 : -1) * rnd(0, 0.002);
    emit({ kind: "trade", ...base(t), side: s, wallet, usd, priceUsd: t.price, poolLiquidityUsd: t.liq });
  };

  const timers: NodeJS.Timeout[] = [];

  timers.push(setInterval(() => trade(pickOne(tokens)), 120));
  timers.push(
    setInterval(() => {
      const t = pickOne(tokens);
      const usd = rnd(500, 8000);
      const add = Math.random() < 0.6;
      t.liq += add ? usd : -usd;
      emit({ kind: "liquidity", ...base(t), action: add ? "add" : "remove", wallet: pickOne(wallets), usd, poolLiquidityUsd: t.liq });
    }, 1500),
  );
  timers.push(
    setInterval(() => {
      const t: SimToken = { token: rid(), symbol: "NEW" + Math.floor(rnd(100, 999)), pool: rid(), liq: rnd(8_000, 60_000), price: rnd(0.00001, 0.01) };
      tokens.push(t);
      if (tokens.length > 25) tokens.splice(0, 1);
      emit({ kind: "launch", ts: Date.now(), token: t.token, symbol: t.symbol, source: "sim" });
      emit({ kind: "pool", ...base(t), poolLiquidityUsd: t.liq });
    }, 20_000),
  );

  // Scripted rug-style exit so alerts and the score are visible during UI work.
  const rug = () => {
    const t = pickOne(tokens);
    const whales = [pickOne(wallets), pickOne(wallets)];
    let i = 0;
    const iv = setInterval(() => {
      const w = whales[i % 2];
      const usd = t.liq * rnd(0.08, 0.16);
      t.liq -= usd;
      emit({ kind: "liquidity", ...base(t), action: "remove", wallet: w, usd, poolLiquidityUsd: t.liq });
      for (let k = 0; k < 3; k++) trade(t, w, "sell", rnd(800, 3000));
      if (++i > 6) clearInterval(iv);
    }, 2500);
  };
  timers.push(setTimeout(rug, 12_000));
  timers.push(setInterval(rug, 100_000));

  return () => timers.forEach((t) => clearTimeout(t));
}
