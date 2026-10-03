import { createThrottle, type ThrottleCheck } from './throttle';

const MIN = 60_000;
const ALL = '*';

function waitText(ms: number): string {
  if (ms >= MIN) {
    const m = Math.ceil(ms / MIN);
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const s = Math.max(1, Math.ceil(ms / 1000));
  return `${s} second${s === 1 ? '' : 's'}`;
}

const waitOf = (c: ThrottleCheck) => (c.allowed ? 0 : c.retryAfterMs);

// Two layers: per client (5 wrong → 1 min, doubling to 15 min), and shop-wide (100 wrong in 15 min →
// all logins paused 5 min). The shop-wide layer matters because the client address can be faked.
export function createLoginGate() {
  const perClient = createThrottle({ maxFailures: 5, windowMs: 15 * MIN, baseLockMs: MIN, maxLockMs: 15 * MIN });
  const shopWide = createThrottle({ maxFailures: 100, windowMs: 15 * MIN, baseLockMs: 5 * MIN, maxLockMs: 5 * MIN });

  return {
    // Returns a message to show instead of checking the password, or null when the attempt may go ahead.
    check(client: string, now: number): string | null {
      const wait = Math.max(waitOf(perClient.check(client, now)), waitOf(shopWide.check(ALL, now)));
      return wait > 0 ? `Too many wrong passwords. Try again in ${waitText(wait)}.` : null;
    },
    recordFailure(client: string, now: number): void {
      perClient.fail(client, now);
      shopWide.fail(ALL, now);
    },
    recordSuccess(client: string): void {
      perClient.succeed(client);
    },
  };
}
