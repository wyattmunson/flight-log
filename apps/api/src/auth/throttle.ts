/**
 * In-memory sliding-window limiter. Per process only, which matches the single API replica
 * (import previews are in memory too). `hit()` records an attempt and `check()` says how long to
 * wait; recording the attempt *before* the slow password check means a burst of parallel requests
 * cannot all slip under the limit.
 */
export interface Throttle {
  /** Seconds until another attempt is allowed for `key`; 0 when it is allowed now. */
  check(key: string): number;
  hit(key: string): void;
  reset(key: string): void;
}

export function createThrottle(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): Throttle {
  const { limit, windowMs, now = Date.now, maxKeys = 10_000 } = opts;
  const attempts = new Map<string, number[]>();

  const live = (key: string) => {
    const cutoff = now() - windowMs;
    const kept = (attempts.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) attempts.set(key, kept);
    else attempts.delete(key);
    return kept;
  };

  return {
    check(key) {
      const times = live(key);
      if (times.length < limit) return 0;
      // The oldest attempt that still counts frees a slot once it leaves the window.
      const frees = (times[times.length - limit] ?? now()) + windowMs;
      return Math.max(1, Math.ceil((frees - now()) / 1000));
    },
    hit(key) {
      if (attempts.size >= maxKeys && !attempts.has(key)) {
        for (const k of attempts.keys()) live(k);
        // Still full of live keys (an attack on many identifiers): drop the oldest.
        if (attempts.size >= maxKeys) attempts.delete(attempts.keys().next().value as string);
      }
      live(key);
      attempts.set(key, [...(attempts.get(key) ?? []), now()]);
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
