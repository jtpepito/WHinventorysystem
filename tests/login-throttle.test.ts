import { describe, expect, it } from 'vitest';
import { createLoginGate } from '@/lib/login-throttle';

describe('login gate', () => {
  it('locks one client after 5 wrong passwords and says how long to wait', () => {
    const gate = createLoginGate();
    for (let i = 0; i < 5; i++) gate.recordFailure('10.0.0.5', 0);
    expect(gate.check('10.0.0.5', 0)).toBe('Too many wrong passwords. Try again in 1 minute.');
    expect(gate.check('10.0.0.5', 30_000)).toBe('Too many wrong passwords. Try again in 30 seconds.');
    expect(gate.check('10.0.0.6', 0)).toBeNull();
  });
  it('a correct password clears that client', () => {
    const gate = createLoginGate();
    for (let i = 0; i < 4; i++) gate.recordFailure('10.0.0.5', 0);
    gate.recordSuccess('10.0.0.5');
    gate.recordFailure('10.0.0.5', 0);
    expect(gate.check('10.0.0.5', 0)).toBeNull();
  });
  it('pauses every login after 100 failures from any mix of clients', () => {
    const gate = createLoginGate();
    for (let i = 0; i < 100; i++) gate.recordFailure(`spoofed-${i}`, 0);
    expect(gate.check('10.0.0.99', 0)).toBe('Too many wrong passwords. Try again in 5 minutes.');
    expect(gate.check('10.0.0.99', 5 * 60_000)).toBeNull();
  });
});
