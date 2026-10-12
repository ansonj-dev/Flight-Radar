export interface ProgramInfo {
  id: string;
  label: string;
  category: "dex" | "bridge";
}

/** Well-known Solana program IDs watched over Yellowstone gRPC / Mirage. */
export const WATCHED_PROGRAMS: ProgramInfo[] = [
  { id: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", label: "Raydium AMM v4", category: "dex" },
  { id: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", label: "Raydium CPMM", category: "dex" },
  { id: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", label: "Raydium CLMM", category: "dex" },
  { id: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", label: "Orca Whirlpool", category: "dex" },
  { id: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", label: "Meteora DLMM", category: "dex" },
  { id: "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB", label: "Meteora Pools", category: "dex" },
  { id: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", label: "Pump.fun", category: "dex" },
  { id: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", label: "PumpSwap", category: "dex" },
  { id: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", label: "Jupiter v6", category: "dex" },
  { id: "wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb", label: "Wormhole Token Bridge", category: "bridge" },
  { id: "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth", label: "Wormhole Core", category: "bridge" },
];

export const PROGRAM_BY_ID = new Map(WATCHED_PROGRAMS.map((p) => [p.id, p]));

export const MINTS = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
} as const;

export const QUOTE_MINTS = new Set<string>(Object.values(MINTS));
