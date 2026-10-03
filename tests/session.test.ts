import { describe, expect, it } from 'vitest';
import { canAccess, homeFor, SESSION_TTL_MS, signSession, verifySession } from '@/lib/session';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = 1_800_000_000_000;

describe('session tokens', () => {
  it('round-trips a role', async () => {
    const t = await signSession('encoder', SECRET, NOW);
    expect(await verifySession(t, SECRET, NOW + 1000)).toBe('encoder');
  });
  it('rejects expiry, a wrong secret, tampering and junk', async () => {
    const t = await signSession('encoder', SECRET, NOW);
    expect(await verifySession(t, SECRET, NOW + SESSION_TTL_MS + 1)).toBeNull();
    expect(await verifySession(t, SECRET + 'x', NOW)).toBeNull();
    expect(await verifySession(t.replace('encoder', 'admin'), SECRET, NOW)).toBeNull();
    const [, exp, sig] = t.split('.');
    expect(await verifySession(`encoder.${Number(exp) + 999999}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifySession('garbage', SECRET, NOW)).toBeNull();
    expect(await verifySession('', SECRET, NOW)).toBeNull();
  });
});

describe('canAccess', () => {
  it('lets admin go anywhere', () => {
    for (const p of ['/dashboard', '/reports', '/reports/csv/low-stock', '/settings', '/debug', '/items/new', '/items/3/edit']) {
      expect(canAccess('admin', p)).toBe(true);
    }
  });
  it('limits encoder to receive/release/count/items/movements, read-only items', () => {
    for (const p of ['/receive', '/release', '/count', '/count/4', '/items', '/items/12', '/movements']) expect(canAccess('encoder', p)).toBe(true);
    for (const p of ['/dashboard', '/reports', '/reports/csv/low-stock', '/settings', '/debug', '/items/new', '/items/12/edit', '/items/import', '/items/import/template', '/receivex']) {
      expect(canAccess('encoder', p)).toBe(false);
    }
  });
  it('sends each role home', () => {
    expect(homeFor('admin')).toBe('/dashboard');
    expect(homeFor('encoder')).toBe('/receive');
  });
});
