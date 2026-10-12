import type { StreamHealth } from "../../shared-types/src/index.ts";

/** Tracks health and throughput for one Solami stream. */
export class StreamMeter {
  state: StreamHealth["state"] = "disabled";
  lastEventAt: number | null = null;
  events = 0;
  reconnects = 0;
  lastError?: string;
  detail?: string;
  private recent: number[] = [];

  constructor(public name: string) {}

  tick(n = 1) {
    const now = Date.now();
    this.events += n;
    this.lastEventAt = now;
    for (let i = 0; i < Math.min(n, 50); i++) this.recent.push(now);
    if (this.recent.length > 5000) this.recent.splice(0, this.recent.length - 5000);
  }

  setState(s: StreamHealth["state"], err?: unknown) {
    this.state = s;
    if (err !== undefined) this.lastError = err instanceof Error ? err.message : String(err);
  }

  snapshot(): StreamHealth {
    const now = Date.now();
    const cutoff = now - 10_000;
    while (this.recent.length && this.recent[0] < cutoff) this.recent.shift();
    return {
      name: this.name,
      state: this.state,
      lastEventAt: this.lastEventAt,
      events: this.events,
      reconnects: this.reconnects,
      eventsPerSec: Math.round((this.recent.length / 10) * 10) / 10,
      lastError: this.lastError,
      detail: this.detail,
    };
  }
}
