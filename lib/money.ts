import { InventoryError } from './errors';
import { round } from './num';

export const VAT_RATE = 0.12;
const MAX = 1_000_000_000;

export function roundMoney(n: number): number {
  return round(n, 2);
}

// Prices are VAT-inclusive. Derive VAT from the total once, so lines + VAT always add up exactly.
export function vatSplit(gross: number, registered: boolean): { net: number; vat: number } {
  if (!registered) return { net: roundMoney(gross), vat: 0 };
  const net = roundMoney(gross / (1 + VAT_RATE));
  return { net, vat: roundMoney(gross - net) };
}

export function checkMoney(n: number, label: string): number {
  if (!Number.isFinite(n) || n < 0) throw new InventoryError(`${label} must be 0 or more.`);
  if (n > MAX) throw new InventoryError(`${label} is too large.`);
  if (Math.abs(roundMoney(n) - n) > 1e-9) throw new InventoryError(`${label} can have at most 2 decimal places.`);
  return roundMoney(n);
}
