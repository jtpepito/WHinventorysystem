import type { DatabaseSync } from 'node:sqlite';

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// Default: VAT-registered (12%, VAT-inclusive prices), the common case for a hardware trader.
export function vatRegistered(db: DatabaseSync): boolean {
  return getSetting(db, 'vat_registered') !== '0';
}

export function lockedThrough(db: DatabaseSync): string | null {
  return getSetting(db, 'locked_through') || null;
}

export type BusinessInfo = { name: string; address: string; tin: string; receiptFooter: string };

export function businessInfo(db: DatabaseSync): BusinessInfo {
  return {
    name: getSetting(db, 'business_name') ?? '',
    address: getSetting(db, 'business_address') ?? '',
    tin: getSetting(db, 'business_tin') ?? '',
    receiptFooter: getSetting(db, 'receipt_footer') ?? '',
  };
}
