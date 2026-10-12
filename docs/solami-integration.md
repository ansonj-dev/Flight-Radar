# Solami integration notes

## What is verified and what needs your key

| Piece | Status |
|---|---|
| Yellowstone gRPC client, filters, reconnect | Written against `@triton-one/yellowstone-grpc` v9 types; typechecks. **Needs a live key to confirm** |
| RPC JSON-RPC calls | Standard Solana methods; typechecks. **Needs a live key to confirm auth style** |
| Blur WebSocket, Mirage WebSocket | Transport is generic. **Message formats are not publicly documented**, so subscribe messages come from `.env` and parsing is tolerant |
| Webhooks | Receiver is generic (`POST /webhooks/solami`) and runs through the same normalizer |
| Scoring, alerts, dashboard, webhook receiver | Tested offline with the simulator and unit tests |

## Confirming Blur payloads (5 minutes)

1. Put `SOLAMI_BLUR_WS_URL` and `SOLAMI_BLUR_SUBSCRIBE` in `.env` as shown in the Solami docs.
2. Run `npm run check`. It prints up to three raw frames.
3. Compare to the fields read in `packages/solami-client/src/normalize.ts`:

| Meaning | Accepted field names |
|---|---|
| Event type | `type`, `event`, `event_type`, `kind`, `channel`, `topic`, `stream` (matched against trade/swap, liquidity, launch, pool) |
| Time | `timestamp`, `ts`, `time`, `block_time`, `blockTime`, `created_at` (seconds or ms) |
| Token | `token`, `token_mint`, `mint`, `base_mint`, or the non-USDC/USDT/SOL side of `token_in`/`token_out` |
| Wallet | `wallet`, `trader`, `maker`, `signer`, `owner`, `user`, `sender` |
| USD value | `usd`, `amount_usd`, `value_usd`, `volume_usd`, `usd_value` |
| Side / action | `side`, `direction`, `trade_type`, `action` |
| Pool liquidity | `pool_liquidity_usd`, `liquidity_usd`, `tvl_usd`, `tvl` |

4. If a name is missing, add it to the matching `pick([...])` list. The dashboard's Blur row shows "last frame not recognised" while frames cannot be parsed.

## Authentication

The key is sent as the header named by `SOLAMI_AUTH_HEADER` (default `x-api-key`) on RPC, Blur and Mirage requests, and as the gRPC `x-token`. If your endpoint URLs already embed the key, set `SOLAMI_AUTH_HEADER=` (empty). Adjust to whatever your Solami dashboard shows.

## Watched programs

Raydium AMM v4 / CPMM / CLMM, Orca Whirlpool, Meteora DLMM / Pools, Pump.fun, PumpSwap, Jupiter v6, Wormhole Token Bridge and Core. Edit `packages/solami-client/src/programs.ts` to add more; the gRPC filter and labels follow automatically.
