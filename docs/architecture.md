# Architecture

```text
 Solami Yellowstone gRPC ──┐  (filtered: DEX + Wormhole program txs, slots, fromSlot replay)
 Solami Mirage (WS) ───────┤──► ProgramActivity ──► Radar ─► DEX tx/min, bridge tx/min, slot
                           │
 Solami Blur (WS) ─────────┤
 Solami Webhooks (POST) ───┴──► normalizeBlur() ──► MarketEvent ──► TokenWindow (per token)
                                                                          │
 DefiLlama bridge volume ──► BridgeMonitor ──► BridgeContext ──┐          ▼
                                                               └─► scoreToken() ─► TokenScore
 Solami RPC ──► slot/latency probe, holder concentration                  │
                                                                          ▼
                                                    AlertEngine ─► dashboard / Telegram / Discord / alerts.jsonl
                                                                          │
                                                    HTTP + WebSocket ◄────┘ ─► web dashboard
```

## Packages

| Path | Responsibility |
|---|---|
| `packages/shared-types` | Event, score, alert and health types |
| `packages/scoring-engine` | Pure functions: rolling `TokenWindow`, `scoreToken`, `classifyFlow`. Unit-tested |
| `packages/solami-client` | Reconnecting WebSocket, Yellowstone stream, Mirage adapter, RPC client with rate limiting, Blur normalizer, bridge monitor |
| `apps/server` | Config, `Radar` state, `AlertEngine`, HTTP/WS server, simulator |
| `apps/web/public` | Single-file dashboard (no build step) |

## Scoring

Window defaults to 300 s. Points are capped per component and summed to 100.

| Component | Max | Trigger |
|---|---|---|
| Liquidity outflow | 35 | Net removal ratio, or pool-liquidity drop (full marks at -50%) |
| Sell pressure | 25 | Sell share of volume above 50% (full marks at 90%), minimum volume applies |
| Concentrated exits | 20 | Top-3 wallets' share of sells + withdrawals above 40% (full at 90%) |
| Bridge outflow | 10 | Daily bridge net outflow, only counted when exit signals exist |
| Young token | 10 | Launched under 1 h ago and liquidity is leaving |

Levels: low < 25 ≤ elevated < 50 ≤ high < 75 ≤ critical.

## Reliability

- WebSocket: exponential backoff with jitter, ping heartbeat, stale-stream watchdog (reconnects after 120 s silence).
- gRPC: reconnect loop with backoff; resubscribes with `fromSlot = lastSlot - 5` to replay the gap, and falls back to no replay if the node rejects it.
- RPC: client-side token bucket (`SOLAMI_RPC_RPS`), retry on 429/5xx with backoff.
- Dashboard WebSocket auto-reconnects; server caps tracked tokens (`MAX_TRACKED_TOKENS`) and evicts the least recently active unpinned token.
