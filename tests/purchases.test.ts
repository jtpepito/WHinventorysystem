import { describe, expect, it } from 'vitest';
import { financeCheck } from '@/lib/finance-reports';
import { duplicateRefWarning, postRelease } from '@/lib/inventory';
import { accountBalance, seedChart } from '@/lib/ledger';
import { apAging, getPurchase, listPurchases, postPurchase, postSupplierPayment, purchaseOpenBalance, voidPurchase, voidSupplierPayment } from '@/lib/purchases';
import { setSetting } from '@/lib/settings';
import { avgOf, type Fixture, makeDb, plain, qtyOf } from './helpers';

const D = '2026-10-02';
const AT = '2026-10-02T04:00:00.000Z';

function fixture() {
  const f = makeDb();
  seedChart(f.db);
  return f;
}
const lastLines = (f: Fixture) =>
  plain(f.db.prepare('SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = (SELECT MAX(id) FROM journal_entries) ORDER BY l.id').all());
const buy = (f: Fixture, opts: Partial<Parameters<typeof postPurchase>[1]> = {}) =>
  postPurchase(f.db, { date: D, supplierId: f.supplier, refNo: 'INV-77', method: 'cash', vatInvoice: true, lines: [{ itemId: f.item, qty: 10, unitCost: 112 }], ...opts }, 'encoder', opts.date ? `${opts.date}T04:00:00.000Z` : AT);

describe('postPurchase', () => {
  it('ACCEPTANCE: a VAT invoice puts the net cost into stock and the VAT into Input VAT', () => {
    const f = fixture();
    const r = buy(f);
    expect(r).toEqual({ id: 1, number: 'PUR-000001', total: 1120 });
    expect(qtyOf(f.db, f.item)).toBe(10);
    expect(avgOf(f.db, f.item)).toBe(100);
    expect(lastLines(f)).toEqual([{ code: '1200', debit: 1000, credit: 0 }, { code: '1300', debit: 120, credit: 0 }, { code: '1010', debit: 0, credit: 1120 }]);
    expect(getPurchase(f.db, r.id)).toMatchObject({
      number: 'PUR-000001', supplierName: 'Acme Supply', refNo: 'INV-77', method: 'cash', subtotal: 1000, vat: 120, total: 1120, vatInvoice: true, status: 'posted', paid: 1120, balance: 0,
      lines: [{ sku: 'T-001', qty: 10, unitCost: 100, lineTotal: 1120 }],
    });
    expect(plain(f.db.prepare("SELECT ref_no, purchase_id, unit_cost FROM movements WHERE type = 'receive'").all())).toEqual([{ ref_no: 'PUR-000001', purchase_id: 1, unit_cost: 100 }]);
  });
  it('without a VAT invoice the gross cost goes into stock', () => {
    const f = fixture();
    buy(f, { vatInvoice: false });
    expect(avgOf(f.db, f.item)).toBe(112);
    expect(lastLines(f)).toEqual([{ code: '1200', debit: 1120, credit: 0 }, { code: '1010', debit: 0, credit: 1120 }]);
  });
  it('ignores the VAT invoice flag when not VAT-registered', () => {
    const f = fixture();
    setSetting(f.db, 'vat_registered', '0');
    buy(f);
    expect(avgOf(f.db, f.item)).toBe(112);
    expect(lastLines(f).map((l) => l.code)).toEqual(['1200', '1010']);
    expect(getPurchase(f.db, 1)).toMatchObject({ vat: 0, vatInvoice: false });
  });
  it('on account goes to payables; supplier payments settle it', () => {
    const f = fixture();
    const r = buy(f, { method: 'credit' });
    expect(lastLines(f)[2]).toEqual({ code: '2100', debit: 0, credit: 1120 });
    expect(purchaseOpenBalance(f.db, r.id)).toBe(1120);
    const p = postSupplierPayment(f.db, { date: '2026-10-12', purchaseId: r.id, amount: 1120, method: 'bank', refNo: 'CHK-9' }, 'admin', '2026-10-12T00:00:00.000Z');
    expect(p).toEqual({ id: 1, number: 'PV-000001' });
    expect(purchaseOpenBalance(f.db, r.id)).toBe(0);
    expect(lastLines(f)).toEqual([{ code: '2100', debit: 1120, credit: 0 }, { code: '1030', debit: 0, credit: 1120 }]);
    expect(() => postSupplierPayment(f.db, { date: D, purchaseId: r.id, amount: 1, method: 'cash' }, 'admin', AT)).toThrow('Only ₱0.00 is still owed on PUR-000001.');
    voidSupplierPayment(f.db, p.id, 'Cheque bounced', 'admin', '2026-10-13T00:00:00.000Z');
    expect(purchaseOpenBalance(f.db, r.id)).toBe(1120);
    expect(accountBalance(f.db, '2100')).toBe(1120);
  });
  it('validates input and writes nothing on failure', () => {
    const f = fixture();
    expect(() => buy(f, { refNo: '' })).toThrow(/Supplier invoice no/);
    expect(() => buy(f, { lines: [] })).toThrow(/at least one line/);
    expect(() => buy(f, { lines: [{ itemId: f.item, qty: 0, unitCost: 1 }] })).toThrow(/Line 1/);
    expect(() => buy(f, { supplierId: 999 })).toThrow(/supplier/);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM purchases').get()).toMatchObject({ n: 0 });
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get()).toMatchObject({ n: 0 });
  });
});

describe('opening stock through Receive', () => {
  it('posts the "Opening balance" supplier to capital, with no VAT and no cash', () => {
    const f = fixture();
    const opening = Number(f.db.prepare("INSERT INTO suppliers (name) VALUES ('Opening balance')").run().lastInsertRowid);
    postPurchase(f.db, { date: D, supplierId: opening, refNo: 'OB-1', method: 'cash', vatInvoice: true, lines: [{ itemId: f.item, qty: 10, unitCost: 50 }] }, 'admin', AT);
    expect(avgOf(f.db, f.item)).toBe(50);
    expect(lastLines(f)).toEqual([{ code: '1200', debit: 500, credit: 0 }, { code: '3100', debit: 0, credit: 500 }]);
    expect(accountBalance(f.db, '1010')).toBe(0);
  });
});

describe('supplier payment dates', () => {
  it('cannot be dated before the purchase', () => {
    const f = fixture();
    const r = buy(f, { method: 'credit' });
    expect(() => postSupplierPayment(f.db, { date: '2026-10-01', purchaseId: r.id, amount: 10, method: 'cash' }, 'admin', AT)).toThrow('A payment cannot be dated before its purchase (2026-10-02).');
  });
});

describe('VAT purchases keep stock and books exact', () => {
  it('debits Inventory with the sum of rounded line costs, so fifty purchases drift by nothing', () => {
    const f = fixture();
    for (let i = 0; i < 50; i++) {
      postPurchase(f.db, { date: D, supplierId: f.supplier, refNo: `V-${i}`, method: 'cash', vatInvoice: true, lines: [{ itemId: f.item, qty: 3, unitCost: 19.99 }, { itemId: f.item2, qty: 7, unitCost: 1.07 }] }, 'admin', AT);
    }
    const chk = financeCheck(f.db);
    expect(Math.abs(chk.stockValue - chk.inventoryGl)).toBeLessThan(0.005);
  });
});

describe('duplicate invoice check', () => {
  it('sees supplier invoice numbers on purchases, not just legacy receipts', () => {
    const f = fixture();
    const other = Number(f.db.prepare("INSERT INTO suppliers (name) VALUES ('Other Co')").run().lastInsertRowid);
    buy(f);
    const warning = duplicateRefWarning(f.db, { type: 'receive', refNo: ' inv-77 ', supplierId: f.supplier });
    expect(warning).toContain('Reference INV-77 from Acme Supply was already received on');
    expect(warning).toContain('PUR-000001');
    expect(warning).toContain("Check this isn't the same delivery entered twice.");
    expect(duplicateRefWarning(f.db, { type: 'receive', refNo: 'INV-77', supplierId: other })).toBeNull();
    expect(duplicateRefWarning(f.db, { type: 'receive', refNo: 'INV-78', supplierId: f.supplier })).toBeNull();
  });
  it('ignores a voided purchase, so the invoice can be re-entered', () => {
    const f = fixture();
    const r = buy(f);
    voidPurchase(f.db, r.id, 'Wrong quantities', 'admin', '2026-10-03T00:00:00.000Z');
    expect(duplicateRefWarning(f.db, { type: 'receive', refNo: 'INV-77', supplierId: f.supplier })).toBeNull();
  });
});

describe('voidPurchase', () => {
  it('refuses when the stock has since been released or a payment exists', () => {
    const f = fixture();
    const r = buy(f, { method: 'credit' });
    postRelease(f.db, { counterparty: 'X', refNo: 'D', lines: [{ itemId: f.item, qty: 8 }] }, 'admin', AT);
    expect(() => voidPurchase(f.db, r.id, 'wrong supplier', 'admin', AT)).toThrow('T-001 has only 2 on hand; 10 were received on this purchase. Adjust stock first.');
    const g = buy(f, { method: 'credit', refNo: 'INV-78' });
    postSupplierPayment(f.db, { date: D, purchaseId: g.id, amount: 100, method: 'cash' }, 'admin', AT);
    expect(() => voidPurchase(f.db, g.id, 'wrong supplier', 'admin', AT)).toThrow('Void the payment(s) first.');
  });
  it('restores qty and the Inventory account exactly, leaving avg cost alone', () => {
    const f = fixture();
    const inv0 = accountBalance(f.db, '1200');
    const r = buy(f);
    voidPurchase(f.db, r.id, 'Duplicate entry', 'admin', '2026-10-03T00:00:00.000Z');
    expect(qtyOf(f.db, f.item)).toBe(0);
    expect(avgOf(f.db, f.item)).toBe(100);
    expect(accountBalance(f.db, '1200')).toBe(inv0);
    expect(accountBalance(f.db, '1300')).toBe(0);
    expect(getPurchase(f.db, r.id)).toMatchObject({ status: 'void', voidReason: 'Duplicate entry', balance: 0 });
    expect(plain(f.db.prepare("SELECT qty_delta, unit_cost, purchase_id FROM movements WHERE type = 'adjust'").all())).toEqual([{ qty_delta: -10, unit_cost: 100, purchase_id: r.id }]);
  });
});

describe('listPurchases / apAging', () => {
  it('lists and ages open payables by supplier', () => {
    const f = fixture();
    const other = Number(f.db.prepare("INSERT INTO suppliers (name) VALUES ('Other Co')").run().lastInsertRowid);
    buy(f, { method: 'credit', date: '2026-10-21' });
    buy(f, { method: 'credit', date: '2026-09-16', refNo: 'INV-2' });
    buy(f, { method: 'credit', date: '2026-07-20', refNo: 'INV-3', supplierId: other });
    buy(f, { method: 'cash', date: '2026-10-01', refNo: 'INV-4' });
    expect(listPurchases(f.db, { method: 'credit' })).toHaveLength(3);
    expect(listPurchases(f.db, { from: '2026-10-01', to: '2026-10-31' }).map((p) => p.refNo)).toEqual(['INV-77', 'INV-4']);
    const aging = apAging(f.db, '2026-10-31');
    expect(aging.rows).toEqual([
      { supplierId: f.supplier, supplier: 'Acme Supply', current: 1120, d31_60: 1120, d61_90: 0, d90plus: 0, total: 2240 },
      { supplierId: other, supplier: 'Other Co', current: 0, d31_60: 0, d61_90: 0, d90plus: 1120, total: 1120 },
    ]);
    expect(aging.total).toBe(3360);
  });
});
