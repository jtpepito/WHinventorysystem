// Asia/Manila is UTC+8 all year (no DST), so fixed-offset math is exact.
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function manilaDay(iso: string): string {
  return new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 10);
}

export function manilaDayStartUtc(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - OFFSET_MS).toISOString();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;
}

export function manilaAt(day: string, hour: number, minute = 0): string {
  return new Date(Date.parse(manilaDayStartUtc(day)) + (hour * 60 + minute) * 60_000).toISOString();
}

export function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * DAY_MS).toISOString();
}

const dateTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export function formatManila(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDayLabel(day: string): string {
  return dayLabel.format(new Date(`${day}T00:00:00.000Z`));
}
