export function round(n: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round(Math.abs(n) * f + 1e-9) / f;
  return Math.sign(n) * r || 0;
}

// Accepts "1,000", " 5 ", ".5", "-5". Rejects blanks, exponents, junk and non-finite values.
export function parseNumberInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/,/g, '');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const qty = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });

export function formatPeso(n: number): string {
  return peso.format(n);
}

export function formatQty(n: number): string {
  return qty.format(n);
}

export function formatSignedQty(n: number): string {
  return n > 0 ? `+${qty.format(n)}` : n < 0 ? `−${qty.format(-n)}` : '0';
}
