import { describe, expect, it } from 'vitest';
import { roleForPassword } from '@/lib/passwords';

const cfg = { admin: 'owner-pass', encoder: 'staff-pass' };

describe('roleForPassword', () => {
  it('maps each password to its role', () => {
    expect(roleForPassword('owner-pass', cfg)).toBe('admin');
    expect(roleForPassword('staff-pass', cfg)).toBe('encoder');
  });
  it('rejects wrong and empty input', () => {
    expect(roleForPassword('nope', cfg)).toBeNull();
    expect(roleForPassword('', cfg)).toBeNull();
    expect(roleForPassword('Owner-pass', cfg)).toBeNull();
  });
  it('refuses a broken config', () => {
    expect(() => roleForPassword('x', { admin: 'same', encoder: 'same' })).toThrow(/must be different/);
    expect(() => roleForPassword('x', { admin: 'a' })).toThrow(/must both be set/);
  });
  it('refuses the example passwords from .env.example', () => {
    expect(() => roleForPassword('x', { admin: 'change-me-admin', encoder: 'staff-pass' })).toThrow(/example password/);
    expect(() => roleForPassword('x', { admin: 'owner-pass', encoder: 'change-me-encoder' })).toThrow(/example password/);
  });
});
