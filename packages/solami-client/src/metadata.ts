export interface TokenMetadata {
  symbol: string;
  name?: string;
  image?: string;
}

/** Pre-populated well-known Solana tokens to guarantee instant resolution */
const WELL_KNOWN_TOKENS: Record<string, TokenMetadata> = {
  "So11111111111111111111111111111111111111112": { symbol: "SOL", name: "Solana", image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": { symbol: "USDC", name: "USD Coin", image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png" },
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": { symbol: "USDT", name: "Tether USD", image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png" },
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo": { symbol: "PYUSD", name: "PayPal USD", image: "https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/PYUSDLOGO.png" },
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE": { symbol: "ORCA", name: "Orca", image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png" },
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": { symbol: "RAY", name: "Raydium", image: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png" },
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": { symbol: "PYTH", name: "Pyth Network", image: "https://pyth.network/token.svg" },
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": { symbol: "BONK", name: "Bonk", image: "https://arweave.net/QPC6FYdUn-3V8ytFNuoCS85S2tHAuiDblh6u3CIZLsw" },
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": { symbol: "WIF", name: "dogwifhat", image: "https://bafkreibk3yfvsf6vvcl6tv7ngvsj6d4gmgmzyf4f2qnnps2zvyomr3l5rq.ipfs.nftstorage.link" },
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": { symbol: "JUP", name: "Jupiter", image: "https://static.jup.ag/jup/icon.png" },
  "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof": { symbol: "RENDER", name: "Render Token" },
  "Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs": { symbol: "GRASS", name: "Grass" },
  "MEFNBXixkEbait3xn9bkm8FsBp2hDRMmP4QhXj5gED5": { symbol: "ME", name: "Magic Eden" },
  "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS": { symbol: "KMNO", name: "Kamino" },
};

export class TokenMetadataRegistry {
  private cache = new Map<string, TokenMetadata>();
  private pending = new Set<string>();
  private inFlight = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private dataApiUrl: string = "https://api.solami.dev",
    private apiKey?: string,
  ) {
    // Populate well-known mints
    for (const [mint, meta] of Object.entries(WELL_KNOWN_TOKENS)) {
      this.cache.set(mint, meta);
    }
  }

  get(mint: string): TokenMetadata | undefined {
    return this.cache.get(mint);
  }

  set(mint: string, meta: TokenMetadata) {
    if (!mint) return;
    const existing = this.cache.get(mint);
    this.cache.set(mint, {
      symbol: meta.symbol || existing?.symbol || mint.slice(0, 4).toUpperCase(),
      name: meta.name || existing?.name,
      image: meta.image || existing?.image,
    });
  }

  /** Request background resolution for a list of mints */
  queue(mints: string[]) {
    for (const m of mints) {
      if (m && !this.cache.has(m)) {
        this.pending.add(m);
      }
    }
    if (!this.timer && this.pending.size > 0) {
      this.timer = setTimeout(() => this.flush(), 400);
    }
  }

  private async flush() {
    this.timer = undefined;
    if (this.pending.size === 0 || this.inFlight) return;

    const batch = Array.from(this.pending).slice(0, 40);
    for (const m of batch) this.pending.delete(m);

    this.inFlight = true;
    try {
      const url = `${this.dataApiUrl}/data/token/metadata?chain=solana&address=${encodeURIComponent(batch.join(","))}`;
      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.value ?? [data]);
        for (const item of list) {
          if (item && item.address && item.symbol) {
            this.set(item.address, {
              symbol: item.symbol,
              name: item.name,
              image: item.image,
            });
          }
        }
      }
    } catch (err) {
      // Ignore network timeouts; tokens will retry or fallback
    } finally {
      this.inFlight = false;
      if (this.pending.size > 0) {
        this.timer = setTimeout(() => this.flush(), 1000);
      }
    }
  }
}
