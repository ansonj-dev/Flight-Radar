# Demo script (2–3 minutes, live mainnet)

Before recording: `MODE=live`, keys set, `npm run check` all green, dashboard open for a few minutes so windows have data. Do not record in simulate mode.

1. **0:00** Show the header: `LIVE MAINNET`, slot ticking, bridge pill. Say the problem in one sentence: liquidity leaves before price does.
2. **0:20** Stream health panel: Blur, Yellowstone gRPC (and Mirage if on), RPC slot/latency, events per second. This shows Solami is the data path.
3. **0:40** Live event feed: point at a new pool, a trade burst, a liquidity removal as they arrive. Show DEX tx/min by program.
4. **1:10** Token table: sort is by Liquidity Flight Score. Click the top row: signals with points, recommended action, holder concentration from RPC.
5. **1:50** Alerts panel: show a fired alert and the same alert in Telegram or Discord.
6. **2:20** Bridge context: explain inflow/outflow/rotation/neutral and how bridge direction raises the score only alongside exit signals.
7. **2:40** Close on the GitHub repo and README (setup, `.env.example`, use-your-own-key).

Tip: if the market is calm, lower `ALERT_MIN_SCORE` and `ALERT_MIN_LIQUIDITY_CHANGE_PCT` slightly before recording so a real alert fires on real data.
