import { describe, expect, it } from 'vitest';
import { checkMoney, roundMoney, VAT_RATE, vatSplit } from '@/lib/money';

describe('money', () => {
  it('splits a VAT-inclusive amount, deriving VAT from the total once', () => {
    expect(VAT_RATE).toBe(0.12);
    expect(vatSplit(112, true)).toEqual({ net: 100, vat: 12 });
    expect(vatSplit(99.99, true)).toEqual({ net: 89.28, vat: 10.71 });
    expect(vatSplit(99.99, false)).toEqual({ net: 99.99, vat: 0 });
    expect(vatSplit(0, true)).toEqual({ net: 0, vat: 0 });
  });
  it('rounds money half-up to centavos', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });
  it('checks a money input', () => {
    expect(checkMoney(10, 'Amount')).toBe(10);
    expect(() => checkMoney(-1, 'Amount')).toThrow('Amount must be 0 or more.');
    expect(() => checkMoney(1.005, 'Amount')).toThrow('Amount can have at most 2 decimal places.');
    expect(() => checkMoney(NaN, 'Amount')).toThrow('Amount must be 0 or more.');
    expect(() => checkMoney(2e9, 'Amount')).toThrow('Amount is too large.');
  });
});
