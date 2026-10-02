import { describe, expect, it } from 'vitest';
import { formatPeso, formatQty, formatSignedQty, parseNumberInput, round } from '@/lib/num';

describe('round', () => {
  it('rounds half away from zero despite float noise', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(10.00666666, 4)).toBe(10.0067);
    expect(round(-2.5, 0)).toBe(-3);
    expect(Object.is(round(-0.0001, 2), 0)).toBe(true);
  });
});

describe('parseNumberInput', () => {
  it.each([
    ['10', 10], [' 5 ', 5], ['1,000', 1000], ['1,234.5', 1234.5], ['.5', 0.5], ['-5', -5], ['0', 0], [7, 7],
  ])('parses %j', (raw, want) => expect(parseNumberInput(raw)).toBe(want));
  it.each([[''], ['  '], ['abc'], ['1e400'], ['1e3'], ['12abc'], ['--1'], [null], [undefined], [NaN], [Infinity]])(
    'rejects %j', (raw) => expect(parseNumberInput(raw)).toBeNull(),
  );
});

describe('formatting', () => {
  it('formats pesos and quantities', () => {
    expect(formatPeso(75)).toBe('₱75.00');
    expect(formatPeso(1234.5)).toBe('₱1,234.50');
    expect(formatQty(20)).toBe('20');
    expect(formatQty(1.25)).toBe('1.25');
    expect(formatSignedQty(10)).toBe('+10');
    expect(formatSignedQty(-3)).toBe('−3');
  });
});
