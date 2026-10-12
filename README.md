# Flight Radar

Institutional-grade, real-time liquidity-flight intelligence for Solana, built on [Solami](https://solami.dev).

> **Built for the future:** *"Build something live on Solana data (Solami)"*

## Demo

[![Flight Radar Demo](https://img.youtube.com/vi/hgsjMPrYwXE/maxresdefault.jpg)](https://youtu.be/hgsjMPrYwXE?si=0J26nzu9Oumaw902)

> ▶️ **[Watch on YouTube](https://youtu.be/hgsjMPrYwXE?si=0J26nzu9Oumaw902)** — Live demo running on Solana mainnet

- **Execution:** Runs locally against live Solana mainnet via `npm start` (see [Quick Start](#quick-start))

---

## The Problem

Price charts show token collapse **after** the damage is already done. In Solana DeFi, liquidity leaves first:
1. LPs pull initial liquidity or dev teams drain pools.
2. Whales coordinate rapid exits across Raydium, Meteora, and Pump.fun.
3. Extracted capital frequently routes off-chain via cross-chain bridges.

Per-chain dashboards fail to detect these coordinated flight patterns in time. **Liquidity Flight Radar answers four critical questions in real time:**
1. **Is liquidity entering or exiting this token or pool?**
2. **Is sell pressure organic, or concentrated in a few whale wallets?**
3. **Is the outflow correlated with capital crossing bridges?**
4. **What action should a trader, LP, or treasury take right now?**

---

## Key Features

| Feature | Description | Powered By |
|---|---|---|
| **Live DEX Event Firehose** | Sub-second streaming of trades, LP adds/removes, new pool creations, and token launches across Raydium, Orca, Meteora, Pump.fun, and Moonshot. | **Solami Blur WebSocket** |
| **Token Metadata Registry** | Batch-resolves official token tickers, full titles, and logos. No generic "Unknown" placeholders. | **Solami Data API** |
| **Liquidity Flight Score (0–100)** | Real-time heuristic scoring: LP withdrawal pace (35 pts), sell pressure (25 pts), top-3 wallet sell concentration (20 pts), bridge outflow alignment (10 pts), and token age (10 pts). | Scoring Engine |
| **Flow Vector Classification** | Classifies market velocity into `outflow` (🚨), `inflow` (📥), `rotation` (🔄), or `neutral` (↔️). | Heuristics Engine |
| **Whale & Holder Analysis** | On-demand top-10 and top-1 whale holder share to confirm insider/dev concentration. | **Solami RPC** (`getTokenLargestAccounts`) |
| **Explainable Risk Alerts** | Automated multi-channel alerts (Dashboard chime, Telegram, Discord) with itemized score triggers and actionable recommendations. | Webhooks & Alert Engine |
| **Infrastructure Health Cockpit** | Live monitoring of Yellowstone gRPC, Blur WebSocket, slot latency, throughput (ev/sec), and per-program event breakdowns. | Solami Node Telemetry |
| **Adaptive Professional UI** | Dark institutional cockpit with sticky token column, collapsible activity drawer for laptops (1366×768), and responsive mobile card layout. | Native Web Stack |

---

## Solami Products Used

| Solami Product | Integration Role |
|---|---|
| **Blur (WebSocket)** | Real-time decoded DEX market stream: trades, pools, liquidity events, and launches without client-side parsing overhead. |
| **Data API (`api.solami.dev`)** | Live batch token metadata lookups (`/data/token/metadata`) resolving official symbols, titles, and logos. |
| **RPC** | Live slot tracking, latency health checks, and on-demand token supply / largest holder distribution. |
| **Yellowstone gRPC / Mirage** | Filtered transaction firehose with slot replay and bridge program monitoring (Wormhole). |
| **Webhooks** | Inbound endpoint (`POST /webhooks/solami`) for push notifications. |

---

## Bounty Metrics Coverage

This project surfaces all key metrics highlighted in the bounty criteria:
- **24h Volume & Trade Counts:** Sliding 1h and 24h volume and trade aggregates in the top KPI ribbon.
- **Unique Wallets:** Active buyer and seller wallet counts tracked per token.
- **New Token Launches & Pool Creations:** Dedicated live counters for DEX pool deployments and Pump.fun graduations.
- **Liquidity In & Out:** 1h and 24h LP Added vs. LP Removed tracking, plus net USD liquidity flow.
- **Per-Token Price & Price Changes:** Formatted real-time USD token pricing.
- **Holders & Buy vs. Sell Pressure:** Dynamic sell pressure percentage gauges and on-demand top-10 holder concentration.
- **Stream & Infrastructure Health:** Real-time event throughput (ev/sec), reconnect counters, and RPC slot latency.

---

## Quick Start

### Prerequisites
- Node.js 20+
- A Solami API key ([Sign up for free 7-day Pro access](https://solami.dev/signup?ref=st-earn-sep-26))

### 1. Clone & Install
```bash
git clone https://github.com/ansonj-dev/Flight-Radar.git
cd Flight-Radar
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your Solami credentials in `.env`:
```env
PORT=8787
SOLAMI_API_KEY=your_solami_api_key_here
SOLAMI_RPC_URL=https://api.mainnet-beta.solana.com
SOLAMI_BLUR_WS_URL=wss://ws.solami.dev/data/subscribe?chain=solana&api_key=your_solami_api_key_here
```

### 3. Verify Connection
Run the pre-flight check to verify endpoint reachability and inspect sample Blur frames:
```bash
npm run check
```

### 4. Start the Application
```bash
npm start
```
Open **[http://localhost:8787](http://localhost:8787)** in your browser.

> **Offline Testing Mode:** If you do not have an active Solami key, you can run `npm run simulate` to test the UI with synthetic events. A yellow `SIMULATION MODE ACTIVE` banner will indicate this mode.

---

## Project Architecture

```
solana-liquidity-flight-radar/
├── apps/
│   ├── server/           # Fastify backend, WebSocket server, alert engine, Solami ingestion
│   └── web/              # Institutional dark UI cockpit, live audio chimes, responsive table
├── packages/
│   ├── solami-client/    # Blur WS, Yellowstone gRPC, Mirage, Data API, and RPC adapters
│   └── scoring-engine/   # 0–100 Liquidity Flight heuristic model, signals, and actions
├── docs/
│   ├── architecture.md   # System design & data flow diagram
│   ├── demo.md           # 2–3 minute video presentation script for judges
│   └── solami-integration.md # Payload mappings and API details
└── docker-compose.yml    # Single-command production deployment
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Main institutional radar cockpit |
| `GET` | `/api/state` | Full state snapshot: scored tokens, KPIs, bridge status, health, and alerts |
| `GET` | `/api/tokens` | List of scored tokens with metrics and flight risk levels |
| `GET` | `/api/token/:mint` | Detailed token metrics and RPC top holder distribution |
| `GET` | `/api/alerts` | List of recent liquidity flight alerts |
| `GET` | `/api/health` | Live streaming infrastructure health metrics |
| `WS` | `/ws` | Real-time WebSocket connection streaming 1s snapshots and alert chimes |
| `POST`| `/webhooks/solami` | Inbound Solami webhook endpoint |

---

## Testing & Quality

Run the test suite and TypeScript validation:
```bash
npm test            # Runs Vitest unit tests for scoring engine
npm run typecheck   # Full TypeScript verification across monorepo
```

---

## Production Deployment

### Docker
```bash
docker compose up -d --build
```
Serves the radar dashboard on port `8787`.

### Cloud Hosting
Can be deployed to any Node.js container host (Railway, Render, Fly.io, or Ubuntu VPS). Configure environment variables in your provider's dashboard and point inbound webhooks to `https://your-domain.com/webhooks/solami`.

---

## License

MIT © 2026 Solana Liquidity Flight Radar Team
