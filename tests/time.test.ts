import { describe, expect, it } from 'vitest';
import { addDays, daysBefore, formatDayLabel, isDay, manilaAt, manilaDay, manilaDayStartUtc } from '@/lib/time';

describe('Manila day math', () => {
  it('assigns 23:30 Manila to the same Manila day and 00:00 to the next', () => {
    expect(manilaDay('2026-10-01T15:30:00.000Z')).toBe('2026-10-01');
    expect(manilaDay('2026-10-01T16:00:00.000Z')).toBe('2026-10-02');
  });
  it('finds the UTC instant a Manila day starts', () => {
    expect(manilaDayStartUtc('2026-10-02')).toBe('2026-10-01T16:00:00.000Z');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('validates day strings', () => {
    expect(isDay('2026-10-02')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-1-2')).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });
  it('builds a Manila wall-clock instant', () => {
    expect(manilaAt('2026-10-02', 9, 15)).toBe('2026-10-02T01:15:00.000Z');
  });
  it('subtracts whole days from an instant', () => {
    expect(daysBefore('2026-10-31T00:00:00.000Z', 30)).toBe('2026-10-01T00:00:00.000Z');
  });
  it('labels a day', () => {
    expect(formatDayLabel('2026-10-02')).toBe('Oct 2');
  });
});
