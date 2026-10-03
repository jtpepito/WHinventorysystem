import { describe, expect, it } from 'vitest';
import { createThrottle } from '@/lib/throttle';

const MIN = 60_000;

function throttle() {
  return createThrottle({ maxFailures: 5, windowMs: 15 * MIN, baseLockMs: MIN, maxLockMs: 15 * MIN });
}

describe('createThrottle', () => {
  it('allows attempts until the limit, then locks for the base time', () => {
    const t = throttle();
    for (let i = 0; i < 4; i++) {
      t.fail('pc-1', 0);
      expect(t.check('pc-1', 0)).toEqual({ allowed: true });
    }
    t.fail('pc-1', 0);
    expect(t.check('pc-1', 1000)).toEqual({ allowed: false, retryAfterMs: MIN - 1000 });
    expect(t.check('pc-1', MIN)).toEqual({ allowed: true });
  });
  it('keeps clients apart', () => {
    const t = throttle();
    for (let i = 0; i < 5; i++) t.fail('pc-1', 0);
    expect(t.check('pc-2', 0)).toEqual({ allowed: true });
  });
  it('doubles the lock on repeat lockouts, up to the cap', () => {
    const t = throttle();
    let now = 0;
    const lockFor = () => {
      for (let i = 0; i < 5; i++) t.fail('pc-1', now);
      const r = t.check('pc-1', now);
      if (r.allowed) throw new Error('expected a lock');
      now += r.retryAfterMs;
      return r.retryAfterMs;
    };
    expect([lockFor(), lockFor(), lockFor(), lockFor(), lockFor()]).toEqual([MIN, 2 * MIN, 4 * MIN, 8 * MIN, 15 * MIN]);
  });
  it('forgets old failures after the window', () => {
    const t = throttle();
    for (let i = 0; i < 4; i++) t.fail('pc-1', 0);
    t.fail('pc-1', 16 * MIN);
    expect(t.check('pc-1', 16 * MIN)).toEqual({ allowed: true });
  });
  it('resets lockout escalation after a quiet window', () => {
    const t = throttle();
    for (let i = 0; i < 5; i++) t.fail('pc-1', 0);
    for (let i = 0; i < 5; i++) t.fail('pc-1', 40 * MIN);
    expect(t.check('pc-1', 40 * MIN)).toEqual({ allowed: false, retryAfterMs: MIN });
  });
  it('clears a client on success', () => {
    const t = throttle();
    for (let i = 0; i < 4; i++) t.fail('pc-1', 0);
    t.succeed('pc-1');
    t.fail('pc-1', 0);
    expect(t.check('pc-1', 0)).toEqual({ allowed: true });
  });
  it('does not grow without bound', () => {
    const t = throttle();
    for (let i = 0; i < 5000; i++) t.fail(`pc-${i}`, 0);
    for (let i = 0; i < 5000; i++) t.fail(`late-${i}`, 20 * MIN);
    expect(t.size()).toBeLessThanOrEqual(5000);
  });
});
