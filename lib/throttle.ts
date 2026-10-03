// In-memory failure throttle. The app is a single Node process, so a Map is enough;
// it resets on restart, which is acceptable for a shop LAN.

export type ThrottleOptions = { maxFailures: number; windowMs: number; baseLockMs: number; maxLockMs: number };
export type ThrottleCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

type Entry = { failures: number; lastFailAt: number; lockedUntil: number; lockouts: number };

const PRUNE_ABOVE = 1000;

export function createThrottle(opts: ThrottleOptions) {
  const entries = new Map<string, Entry>();

  function prune(now: number) {
    for (const [key, e] of entries) {
      if (e.lockedUntil <= now && now - e.lastFailAt > opts.windowMs) entries.delete(key);
    }
  }

  return {
    check(key: string, now: number): ThrottleCheck {
      const e = entries.get(key);
      return e && e.lockedUntil > now ? { allowed: false, retryAfterMs: e.lockedUntil - now } : { allowed: true };
    },

    fail(key: string, now: number): void {
      if (entries.size > PRUNE_ABOVE) prune(now);
      const e = entries.get(key) ?? { failures: 0, lastFailAt: -Infinity, lockedUntil: 0, lockouts: 0 };
      // A quiet window wipes both the failure count and the lockout escalation.
      if (now - e.lastFailAt > opts.windowMs && e.lockedUntil <= now) {
        e.failures = 0;
        e.lockouts = 0;
      }
      e.failures++;
      e.lastFailAt = now;
      if (e.failures >= opts.maxFailures) {
        e.lockouts++;
        e.lockedUntil = now + Math.min(opts.baseLockMs * 2 ** (e.lockouts - 1), opts.maxLockMs);
        e.failures = 0;
      }
      entries.set(key, e);
    },

    succeed(key: string): void {
      entries.delete(key);
    },

    size(): number {
      return entries.size;
    },
  };
}
