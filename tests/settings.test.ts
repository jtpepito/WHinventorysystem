import { describe, expect, it } from 'vitest';
import { businessInfo, getSetting, lockedThrough, setSetting, vatRegistered } from '@/lib/settings';
import { openDb } from '@/lib/sqlite';

describe('settings', () => {
  it('defaults: VAT-registered, no lock, blank business info', () => {
    const db = openDb(':memory:');
    expect(getSetting(db, 'nope')).toBeNull();
    expect(vatRegistered(db)).toBe(true);
    expect(lockedThrough(db)).toBeNull();
    expect(businessInfo(db)).toEqual({ name: '', address: '', tin: '', receiptFooter: '' });
  });
  it('stores and reads values', () => {
    const db = openDb(':memory:');
    setSetting(db, 'vat_registered', '0');
    expect(vatRegistered(db)).toBe(false);
    setSetting(db, 'locked_through', '2026-09-30');
    expect(lockedThrough(db)).toBe('2026-09-30');
    setSetting(db, 'locked_through', '');
    expect(lockedThrough(db)).toBeNull();
    setSetting(db, 'business_name', 'WWJ Trading');
    expect(businessInfo(db).name).toBe('WWJ Trading');
    setSetting(db, 'business_name', 'WWJ Trading Corp');
    expect(businessInfo(db).name).toBe('WWJ Trading Corp');
  });
});
