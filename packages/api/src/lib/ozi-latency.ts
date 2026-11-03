/**
 * How long Ozi takes to answer (ruling 92, 3 November 2026), measured so it can be made faster:
 * for each exchange, the time waiting on the model, the time to the first spoken sentence, the
 * whole server time, and the delay the person actually felt on their phone, from finishing
 * speaking to the first word heard, sent back by the app afterwards.
 *
 * The felt delays of the last day are also kept here, in memory, so the health check can show
 * them without a database call.
 */

export interface LatencySummary {
  medianFeltMs: number;
  p90FeltMs: number;
  exchanges: number;
}

/** The value below which `fraction` of the sorted values lie (nearest rank). */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[rank]!;
}

/** Median and 90th percentile of the felt delays, or null when there are none. */
export function summarise(feltMs: number[]): LatencySummary | null {
  const sorted = feltMs.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    medianFeltMs: percentile(sorted, 0.5),
    p90FeltMs: percentile(sorted, 0.9),
    exchanges: sorted.length,
  };
}

const DAY_MS = 24 * 60 * 60_000;
/** The most felt delays kept in memory; a day of a busy service is far fewer. */
const KEEP_MOST = 20_000;

/** The felt delays reported in the last day, for the health check. */
export class FeltDelays {
  private readonly seen: Array<{ at: number; feltMs: number }> = [];

  record(feltMs: number, at: Date): void {
    this.seen.push({ at: at.getTime(), feltMs });
    if (this.seen.length > KEEP_MOST) this.seen.splice(0, this.seen.length - KEEP_MOST);
  }

  /** The last 24 hours, or null when nothing was reported. */
  last24h(now: Date): LatencySummary | null {
    const since = now.getTime() - DAY_MS;
    return summarise(this.seen.filter((one) => one.at >= since).map((one) => one.feltMs));
  }
}

const DELAYS = new WeakMap<object, FeltDelays>();
/** The one record of felt delays for a server. */
export function feltDelaysOf(ctx: object): FeltDelays {
  let found = DELAYS.get(ctx);
  if (!found) {
    found = new FeltDelays();
    DELAYS.set(ctx, found);
  }
  return found;
}
