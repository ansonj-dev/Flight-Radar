import bs58 from "bs58";
import type { ProgramActivity } from "../../shared-types/src/index.ts";
import { StreamMeter } from "./meter.ts";
import { WATCHED_PROGRAMS } from "./programs.ts";

// Lazy import to avoid native module loading on Windows when not needed
let Client: any;
let CommitmentLevel: any;
async function loadGrpcClient() {
  if (!Client) {
    const mod = await import("@triton-one/yellowstone-grpc");
    Client = mod.default;
    CommitmentLevel = mod.CommitmentLevel;
  }
}

export interface GrpcOptions {
  endpoint: string; // e.g. https://grpc.solami.dev:443
  token?: string; // x-token
  meter: StreamMeter;
  onActivity: (a: ProgramActivity) => void;
  onSlot?: (slot: number) => void;
  log?: (m: string) => void;
}

const idByB64 = new Map(
  WATCHED_PROGRAMS.map((p) => [Buffer.from(bs58.decode(p.id)).toString("base64"), p]),
);

/**
 * Yellowstone gRPC consumer with server-side filtering (only transactions that touch the
 * watched DEX/bridge programs), slot tracking, reconnect with backoff, and slot replay
 * (`fromSlot`) to close the gap after a disconnect.
 */
export class YellowstoneStream {
  private stopped = false;
  private lastSlot = 0;
  private attempt = 0;
  private useReplay = true;

  constructor(private o: GrpcOptions) {}

  start() {
    this.stopped = false;
    void this.loop();
  }

  stop() {
    this.stopped = true;
  }

  private async loop() {
    const { meter } = this.o;
    while (!this.stopped) {
      const startedAt = Date.now();
      try {
        meter.setState(this.attempt === 0 ? "connecting" : "reconnecting");
        await this.once();
      } catch (e) {
        meter.setState("error", e);
        this.o.log?.(`grpc: ${e instanceof Error ? e.message : e}`);
        // If the node rejected our replay slot, drop replay on the next attempt.
        if (Date.now() - startedAt < 3000 && this.lastSlot > 0 && /slot|replay|from_slot/i.test(String(e))) {
          this.useReplay = false;
        }
      }
      if (this.stopped) break;
      meter.reconnects++;
      this.attempt++;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt, 5)) * (0.75 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async once() {
    await loadGrpcClient(); // Load the native module only when actually used
    const { endpoint, token, meter, onActivity, onSlot } = this.o;
    const client = new Client(endpoint, token || undefined, undefined);
    await client.connect();

    const request = {
      accounts: {},
      slots: { slots: { filterByCommitment: true } },
      transactions: {
        dexAndBridge: {
          vote: false,
          failed: false,
          accountInclude: WATCHED_PROGRAMS.map((p) => p.id),
          accountExclude: [],
          accountRequired: [],
        },
      },
      transactionsStatus: {},
      blocks: {},
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
      commitment: CommitmentLevel.CONFIRMED,
      ...(this.useReplay && this.lastSlot > 0 ? { fromSlot: String(this.lastSlot - 5) } : {}),
    } as any;

    const stream = await client.subscribe(request);
    meter.setState("live");
    this.attempt = 0;
    this.o.log?.(`grpc: subscribed${request.fromSlot ? ` (replay from slot ${request.fromSlot})` : ""}`);

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (u: any) => {
        if (u.slot) {
          const s = Number(u.slot.slot);
          if (s > this.lastSlot) this.lastSlot = s;
          onSlot?.(s);
          meter.tick();
          return;
        }
        const tx = u.transaction;
        if (!tx?.transaction) return;
        meter.tick();
        const info = tx.transaction;
        const keys: Uint8Array[] = info.transaction?.message?.accountKeys ?? [];
        const seen = new Set<string>();
        const sig = info.signature ? bs58.encode(info.signature) : "";
        const slot = Number(tx.slot);
        if (slot > this.lastSlot) this.lastSlot = slot;
        for (const k of keys) {
          const p = idByB64.get(Buffer.from(k).toString("base64"));
          if (p && !seen.has(p.id)) {
            seen.add(p.id);
            onActivity({ ts: Date.now(), slot, program: p.id, label: p.label, category: p.category, sig });
          }
        }
      });
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.on("close", resolve);
    });
  }
}
