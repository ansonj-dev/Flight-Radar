import { appendFile, mkdir } from "node:fs/promises";
import { fmt } from "../../../packages/scoring-engine/src/index.ts";
import type { Alert, BridgeContext, Severity, TokenScore } from "../../../packages/shared-types/src/index.ts";
import type { Config } from "./config.ts";

const sevRank: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export class AlertEngine {
  private cooldown = new Map<string, number>();
  private seq = 0;
  delivery = { sent: 0, failed: 0, lastError: "" };

  constructor(private cfg: Config, private onAlert: (a: Alert) => void) {}

  evaluate(s: TokenScore, bridge: BridgeContext | null, now: number) {
    const m = s.metrics;
    const out: Alert[] = [];
    const bridgeTxt = bridge
      ? `${bridge.direction}${bridge.direction !== "neutral" ? ` ($${fmt(Math.abs(bridge.netUsd))} net/day)` : ""}, ${bridge.liveBridgeTxPerMin.toFixed(0)} live bridge tx/min`
      : "no data";
    const mk = (type: Alert["type"], severity: Severity, title: string): Alert => ({
      id: `${now}-${++this.seq}`,
      ts: now,
      token: s.token,
      symbol: s.symbol,
      type,
      severity,
      title,
      windowSec: s.windowSec,
      score: s.score,
      liquidityChangePct: m.liquidityChangePct,
      liquidityNetUsd: m.liquidityNetUsd,
      sellPressure: m.sellPressure,
      top3Share: m.top3Share,
      bridge: bridgeTxt,
      actions: s.actions,
    });

    const label = s.symbol ?? s.token.slice(0, 6);
    const pct = m.liquidityChangePct;
    const outTotal = m.sellUsd + m.liquidityRemovedUsd;

    if (m.liquidityRemovedUsd >= this.cfg.minLiquidityMoveUsd) {
      if (pct !== null && pct <= -this.cfg.alertMinLiquidityChangePct) {
        const sev: Severity = pct <= -50 ? "critical" : pct <= -35 ? "high" : "medium";
        out.push(mk("rapid_liquidity_withdrawal", sev, `${label}: liquidity down ${Math.abs(pct).toFixed(0)}% in ${Math.round(s.windowSec / 60)} min`));
      } else if (pct === null && m.liquidityRemovedUsd >= 25_000 && m.liquidityNetUsd < 0 && m.liquidityRemovedUsd / (m.liquidityAddedUsd + m.liquidityRemovedUsd) >= 0.8) {
        out.push(mk("rapid_liquidity_withdrawal", "high", `${label}: $${fmt(m.liquidityRemovedUsd)} liquidity withdrawn, almost no adds`));
      }
    }
    if (outTotal >= 10_000 && m.top3Share >= 0.8 && m.sellPressure >= 0.6) {
      out.push(mk("concentrated_selling", s.score >= 50 ? "high" : "medium", `${label}: top 3 wallets drive ${(m.top3Share * 100).toFixed(0)}% of exits`));
    }
    if (m.volumeUsd >= 25_000 && 1 - m.sellPressure >= 0.85 && m.uniqueWallets > 0) {
      out.push(mk("abnormal_buy_pressure", "low", `${label}: ${((1 - m.sellPressure) * 100).toFixed(0)}% buy flow across ${m.uniqueWallets} wallets`));
    }
    if (s.score >= this.cfg.alertMinScore) {
      out.push(mk("high_flight_score", s.score >= 80 ? "critical" : "high", `${label}: Liquidity Flight Score ${s.score}/100`));
    }
    if (bridge && bridge.direction === "outflow" && bridge.strength >= 0.6 && s.score >= 25) {
      out.push(mk("cross_chain_outflow", "medium", `${label}: exit signals while bridges show net outflow`));
    }

    for (const a of out) {
      const key = `${a.token}:${a.type}`;
      const last = this.cooldown.get(key);
      if (last && now - last < this.cfg.alertCooldownSec * 1000) continue;
      this.cooldown.set(key, now);
      this.onAlert(a);
      void this.deliver(a);
    }
    if (this.cooldown.size > 5000) {
      for (const [k, t] of this.cooldown) if (now - t > this.cfg.alertCooldownSec * 1000) this.cooldown.delete(k);
    }
  }

  static text(a: Alert): string {
    const lines = [
      `[${a.severity.toUpperCase()}] ${a.title}`,
      `Token: ${a.symbol ?? ""} ${a.token}`,
      `Flight score: ${a.score}/100 (${a.windowSec / 60} min window)`,
      `Liquidity: ${a.liquidityChangePct !== null ? a.liquidityChangePct.toFixed(0) + "% | " : ""}net $${fmt(a.liquidityNetUsd)}`,
      `Sell pressure: ${(a.sellPressure * 100).toFixed(0)}% | Top-3 wallet share: ${(a.top3Share * 100).toFixed(0)}%`,
      `Bridge context: ${a.bridge}`,
      `Action: ${a.actions.join("; ")}`,
    ];
    return lines.join("\n");
  }

  private async deliver(a: Alert) {
    const text = AlertEngine.text(a);
    try {
      await mkdir("data", { recursive: true });
      await appendFile("data/alerts.jsonl", JSON.stringify(a) + "\n");
    } catch {
      /* best effort */
    }
    const jobs: Promise<Response>[] = [];
    if (this.cfg.telegramToken && this.cfg.telegramChatId) {
      jobs.push(
        fetch(`https://api.telegram.org/bot${this.cfg.telegramToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: this.cfg.telegramChatId, text }),
          signal: AbortSignal.timeout(10_000),
        }),
      );
    }
    if (this.cfg.discordWebhook) {
      jobs.push(
        fetch(this.cfg.discordWebhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "```\n" + text + "\n```" }),
          signal: AbortSignal.timeout(10_000),
        }),
      );
    }
    for (const j of jobs) {
      try {
        const r = await j;
        if (r.ok) this.delivery.sent++;
        else {
          this.delivery.failed++;
          this.delivery.lastError = `HTTP ${r.status}`;
        }
      } catch (e) {
        this.delivery.failed++;
        this.delivery.lastError = e instanceof Error ? e.message : String(e);
      }
    }
  }
}

export { sevRank };
