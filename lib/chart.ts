import type { DatabaseSync } from 'node:sqlite';

// Dependency-free so openDb can ensure the chart exists on every database, old or new.
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export const CHART: [string, string, AccountType][] = [
  ['1010', 'Cash on hand', 'asset'], ['1020', 'GCash', 'asset'], ['1030', 'Bank', 'asset'],
  ['1100', 'Accounts receivable', 'asset'], ['1200', 'Inventory', 'asset'], ['1300', 'Input VAT', 'asset'],
  ['2100', 'Accounts payable', 'liability'], ['2200', 'Output VAT payable', 'liability'],
  ['3100', "Owner's capital", 'equity'], ['3200', "Owner's drawings", 'equity'], ['3900', 'Retained earnings', 'equity'],
  ['4100', 'Sales', 'income'], ['4200', 'Sales returns', 'income'],
  ['5100', 'Cost of goods sold', 'expense'], ['5200', 'Inventory shrinkage / adjustments', 'expense'],
  ['6100', 'Rent', 'expense'], ['6200', 'Salaries & wages', 'expense'], ['6300', 'Utilities', 'expense'],
  ['6400', 'Transport & delivery', 'expense'], ['6500', 'Supplies', 'expense'], ['6600', 'Repairs & maintenance', 'expense'],
  ['6900', 'Other expenses', 'expense'],
];

// Idempotent: codes below 6000 are system accounts, the 6xxx expense accounts are editable.
export function ensureChart(db: DatabaseSync): void {
  const insert = db.prepare('INSERT OR IGNORE INTO accounts (code, name, type, system) VALUES (?, ?, ?, ?)');
  for (const [code, name, type] of CHART) insert.run(code, name, type, code < '6000' ? 1 : 0);
}
