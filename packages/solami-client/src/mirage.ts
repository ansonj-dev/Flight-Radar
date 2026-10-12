import type { ProgramActivity } from "../../shared-types/src/index.ts";
import { StreamMeter } from "./meter.ts";
import { WATCHED_PROGRAMS } from "./programs.ts";
import { ReconnectingWs } from "./ws.ts";

export interface MirageOptions {
  url: string;
  headers?: Record<string, string>;
  /** Optional subscribe message(s) as JSON, from SOLAMI_MIRAGE_SUBSCRIBE. */
  subscribe?: unknown[];
  meter: StreamMeter;
  onActivity: (a: ProgramActivity) => void;
  log?: (m: string) => void;
}

/**
 * Mirage = Yellowstone data over plain WebSocket. Because the exact frame layout depends on
 * the subscription you configure, this adapter is schema-agnostic: it scans each frame for
 * watched program IDs and extracts a signature/slot when present.
 */
export function startMirage(o: MirageOptions): ReconnectingWs {
  const ws = new ReconnectingWs({
    url: o.url,
    headers: o.headers,
    subscribe: o.subscribe,
    meter: o.meter,
    staleMs: 120_000,
    log: o.log,
    onMessage: (data, text) => {
      const d = data as Record<string, any> | null;
      const sig: string =
        (d && typeof d === "object" && (d.signature ?? d.transaction?.signature ?? d.params?.result?.signature)) || "";
      const slot = Number((d && typeof d === "object" && (d.slot ?? d.params?.result?.slot)) || 0);
      for (const p of WATCHED_PROGRAMS) {
        if (text.includes(p.id)) {
          o.onActivity({ ts: Date.now(), slot, program: p.id, label: p.label, category: p.category, sig: String(sig) });
        }
      }
    },
  });
  ws.start();
  return ws;
}
