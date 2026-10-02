export type CsvCell = string | number | null;

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

// UTF-8 BOM so Excel reads ₱ correctly; CRLF line endings; RFC 4180 quoting.
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
