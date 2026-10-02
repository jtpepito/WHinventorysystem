import { describe, expect, it } from 'vitest';
import { parseCountEntries, parseReceiptLines, parseReleaseLines, parseReorderUpdates, readItemForm } from '@/lib/forms';

const j = (v: unknown) => JSON.stringify(v);

describe('parseReceiptLines', () => {
  it('parses lines, accepts thousands separators, and skips fully blank rows', () => {
    expect(parseReceiptLines(j([{ itemId: '3', qty: '1,000', unitCost: ' 50 ' }, { itemId: '', qty: '', unitCost: '' }, { itemId: '4', qty: '2', unitCost: '0' }]))).toEqual([
      { itemId: 3, qty: 1000, unitCost: 50 },
      { itemId: 4, qty: 2, unitCost: 0 },
    ]);
  });
  it('labels errors with the row number the user sees', () => {
    expect(() => parseReceiptLines(j([{ itemId: '', qty: '', unitCost: '' }, { itemId: '3', qty: 'abc', unitCost: '1' }]))).toThrow('Line 2: enter a valid quantity.');
    expect(() => parseReceiptLines(j([{ itemId: '', qty: '5', unitCost: '1' }]))).toThrow('Line 1: pick an item.');
    expect(() => parseReceiptLines(j([{ itemId: '3', qty: '5', unitCost: '' }]))).toThrow('Line 1: enter a valid unit cost.');
  });
  it('rejects junk payloads', () => {
    expect(() => parseReceiptLines('not json')).toThrow(/Could not read the line items/);
    expect(() => parseReceiptLines(j({ a: 1 }))).toThrow(/Could not read the line items/);
  });
});

describe('parseReleaseLines', () => {
  it('parses item and qty', () => {
    expect(parseReleaseLines(j([{ itemId: '7', qty: '2.5' }]))).toEqual([{ itemId: 7, qty: 2.5 }]);
    expect(() => parseReleaseLines(j([{ itemId: '7', qty: '1e3' }]))).toThrow('Line 1: enter a valid quantity.');
  });
});

describe('parseCountEntries', () => {
  it('treats blank as not counted', () => {
    expect(parseCountEntries(j([{ lineId: 1, actual: '17', label: 'T-001' }, { lineId: 2, actual: ' ', label: 'T-002' }]))).toEqual([
      { lineId: 1, actual: 17 },
      { lineId: 2, actual: null },
    ]);
    expect(() => parseCountEntries(j([{ lineId: 1, actual: 'x', label: 'T-001' }]))).toThrow('T-001: enter a valid count.');
  });
});

describe('parseReorderUpdates', () => {
  it('parses and names bad rows by SKU', () => {
    expect(parseReorderUpdates(j([{ itemId: 1, sku: 'A', reorderPoint: '5' }]))).toEqual([{ itemId: 1, reorderPoint: 5 }]);
    expect(() => parseReorderUpdates(j([{ itemId: 1, sku: 'A', reorderPoint: '' }]))).toThrow('A: enter a reorder point.');
  });
});

describe('readItemForm', () => {
  it('reads fields, defaults a blank reorder point to 0, and reads the checkbox', () => {
    const fd = new FormData();
    fd.set('sku', 'X-1'); fd.set('name', 'Thing'); fd.set('categoryId', '2'); fd.set('unitId', '3'); fd.set('reorderPoint', '');
    expect(readItemForm(fd)).toEqual({ sku: 'X-1', name: 'Thing', categoryId: 2, unitId: 3, reorderPoint: 0, active: false });
    fd.set('active', 'on'); fd.set('reorderPoint', 'ten');
    expect(() => readItemForm(fd)).toThrow('Reorder point must be a number.');
  });
});
