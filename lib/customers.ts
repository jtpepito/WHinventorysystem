import type { DatabaseSync } from 'node:sqlite';
import { InventoryError } from './inventory';
import { escapeLike } from './queries';

export const WALK_IN = 'Walk-in';

export type Customer = { id: number; name: string; contact: string; termsDays: number; active: boolean };
export type CustomerInput = { name: string; contact?: string; termsDays?: number };

type Raw = Omit<Customer, 'active'> & { active: number };
const toCustomer = (r: Raw): Customer => ({ ...r, active: r.active === 1 });
const SELECT = 'SELECT id, name, contact, terms_days AS termsDays, active FROM customers';

function clean(db: DatabaseSync, c: CustomerInput & { active?: boolean }, exceptId = 0) {
  const name = (c.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) throw new InventoryError('Customer name is required.');
  if (name.length > 120) throw new InventoryError('Customer name is too long (max 120 characters).');
  if (db.prepare('SELECT 1 FROM customers WHERE name = ? AND id <> ?').get(name, exceptId)) throw new InventoryError(`Customer "${name}" already exists.`);
  const termsDays = c.termsDays ?? 30;
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 365) throw new InventoryError('Credit terms must be 0–365 days.');
  return { name, contact: (c.contact ?? '').trim().slice(0, 200), termsDays, active: c.active ?? true };
}

export function listCustomers(db: DatabaseSync, opts: { q?: string; activeOnly?: boolean } = {}): Customer[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.q) { where.push(`name LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(opts.q)}%`); }
  if (opts.activeOnly) where.push('active = 1');
  const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
  return (db.prepare(sql).all(...params) as Raw[]).map(toCustomer);
}

export function getCustomer(db: DatabaseSync, id: number): Customer | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Raw | undefined;
  return r ? toCustomer(r) : null;
}

export function createCustomer(db: DatabaseSync, input: CustomerInput): number {
  const c = clean(db, input);
  return Number(db.prepare('INSERT INTO customers (name, contact, terms_days) VALUES (?, ?, ?)').run(c.name, c.contact, c.termsDays).lastInsertRowid);
}

export function updateCustomer(db: DatabaseSync, id: number, input: CustomerInput & { active: boolean }): void {
  if (!getCustomer(db, id)) throw new InventoryError('Customer not found.');
  const c = clean(db, input, id);
  db.prepare('UPDATE customers SET name = ?, contact = ?, terms_days = ?, active = ? WHERE id = ?').run(c.name, c.contact, c.termsDays, c.active ? 1 : 0, id);
}
