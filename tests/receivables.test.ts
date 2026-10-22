import { describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/customers';
import { postReceipt } from '@/lib/inventory';
import { accountBalance, seedChart } from '@/lib/ledger';
import { closeThrough } from '@/lib/periods';
import { arAging, customerStatement, listCustomerPayments, postCustomerPayment, saleOpenBalance, voidCustomerPayment } from '@/lib/receivables';
import { getSale, postSale, voidSale } from '@/lib/sales';
import { type Fixture, makeDb, plain } from './helpers';

const D = '2026-10-02';
const AT = '2026-10-02T04:00:00.000Z';

function fixture() {
  const f = makeDb();
  seedChart(f.db);
  postReceipt(f.db, { supplierId: f.supplier, refNo: 'OB', lines: [{ itemId: f.item, qty: 50, unitCost: 50 }] }, 'admin', '2026-08-01T00:00:00.000Z');
  const customer = createCustomer(f.db, { name: 'JDC Construction' });
  const other = createCustomer(f.db, { name: 'Reyes Builders' });
  return { ...f, customer, other };
}
const credit = (f: ReturnType<typeof fixture>, customerId: number, qty: number, date = D, at = AT) =>
  postSale(f.db, { date, customerId, method: 'credit', lines: [{ itemId: f.item, qty, unitPrice: 56 }] }, 'admin', at);
const lastLines = (f: Fixture) =>
  plain(f.db.prepare('SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = (SELECT MAX(id) FROM journal_entries) ORDER BY l.id').all());

describe('customer payments', () => {
  it('reduces the open balance and posts cash against AR', () => {
    const f = fixture();
    const sale = credit(f, f.customer, 2);
    expect(saleOpenBalance(f.db, sale.id)).toBe(112);
    const p = postCustomerPayment(f.db, { date: D, saleId: sale.id, amount: 50, method: 'cash', refNo: 'OR-1' }, 'encoder', AT);
    expect(p).toEqual({ id: 1, number: 'CR-000001' });
    expect(saleOpenBalance(f.db, sale.id)).toBe(62);
    expect(getSale(f.db, sale.id)).toMatchObject({ paid: 50, balance: 62 });
    expect(lastLines(f)).toEqual([{ code: '1010', debit: 50, credit: 0 }, { code: '1100', debit: 0, credit: 50 }]);
    expect(accountBalance(f.db, '1100')).toBe(62);
  });
  it('refuses overpayment, non-credit sales, void sales and bad amounts', () => {
    const f = fixture();
    const sale = credit(f, f.customer, 2);
    postCustomerPayment(f.db, { date: D, saleId: sale.id, amount: 50, method: 'cash' }, 'admin', AT);
    expect(() => postCustomerPayment(f.db, { date: D, saleId: sale.id, amount: 70, method: 'cash' }, 'admin', AT)).toThrow('Only ₱62.00 is still owed on SI-000001.');
    expect(() => postCustomerPayment(f.db, { date: D, saleId: sale.id, amount: 0, method: 'cash' }, 'admin', AT)).toThrow(/more than 0/);
    const cash = postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: 56 }] }, 'admin', AT);
    expect(() => postCustomerPayment(f.db, { date: D, saleId: cash.id, amount: 1, method: 'cash' }, 'admin', AT)).toThrow(/not on account/);
    expect(() => postCustomerPayment(f.db, { date: D, saleId: 999, amount: 1, method: 'cash' }, 'admin', AT)).toThrow(/Sale not found/);
  });
  it('blocks voiding a paid sale until the payment is voided', () => {
    const f = fixture();
    const sale = credit(f, f.customer, 2);
    const p = postCustomerPayment(f.db, { date: D, saleId: sale.id, amount: 112, method: 'bank' }, 'admin', AT);
    expect(() => voidSale(f.db, sale.id, 'wrong customer', 'admin', AT)).toThrow('Void the payment(s) first.');
    voidCustomerPayment(f.db, p.id, 'Bounced', 'admin', '2026-10-03T00:00:00.000Z');
    expect(saleOpenBalance(f.db, sale.id)).toBe(112);
    expect(lastLines(f)).toEqual([{ code: '1030', debit: 0, credit: 112 }, { code: '1100', debit: 112, credit: 0 }]);
    expect(listCustomerPayments(f.db, { saleId: sale.id })).toMatchObject([{ number: 'CR-000001', status: 'void', voidReason: 'Bounced' }]);
    expect(() => voidCustomerPayment(f.db, p.id, 'again', 'admin')).toThrow(/already void/);
    voidSale(f.db, sale.id, 'wrong customer', 'admin', '2026-10-03T00:00:00.000Z');
    expect(getSale(f.db, sale.id)?.status).toBe('void');
  });
  it('checks the payment date against the lock, not the sale date', () => {
    const f = fixture();
    const sale = credit(f, f.customer, 1, '2026-09-15', '2026-09-15T00:00:00.000Z');
    closeThrough(f.db, '2026-09-30', 'admin');
    expect(() => postCustomerPayment(f.db, { date: '2026-09-20', saleId: sale.id, amount: 10, method: 'cash' }, 'admin', AT)).toThrow(/Sep 2026 is closed/);
    postCustomerPayment(f.db, { date: '2026-10-02', saleId: sale.id, amount: 10, method: 'cash' }, 'admin', AT);
    expect(saleOpenBalance(f.db, sale.id)).toBe(46);
  });
});

describe('arAging', () => {
  it('buckets open balances by age and skips settled or void sales', () => {
    const f = fixture();
    const asOf = '2026-10-31';
    credit(f, f.customer, 1, '2026-10-21', '2026-10-21T00:00:00.000Z'); // 10 days
    credit(f, f.customer, 1, '2026-09-16', '2026-09-16T00:00:00.000Z'); // 45 days
    credit(f, f.other, 1, '2026-08-17', '2026-08-17T00:00:00.000Z'); // 75 days
    credit(f, f.other, 1, '2026-07-23', '2026-07-23T00:00:00.000Z'); // 100 days
    const settled = credit(f, f.other, 1, '2026-10-01', '2026-10-01T00:00:00.000Z');
    postCustomerPayment(f.db, { date: '2026-10-05', saleId: settled.id, amount: 56, method: 'cash' }, 'admin', '2026-10-05T00:00:00.000Z');
    const voided = credit(f, f.customer, 1, '2026-10-02', AT);
    voidSale(f.db, voided.id, 'dup', 'admin', '2026-10-02T05:00:00.000Z');
    const aging = arAging(f.db, asOf);
    expect(aging.rows).toEqual([
      { customerId: f.customer, customer: 'JDC Construction', current: 56, d31_60: 56, d61_90: 0, d90plus: 0, total: 112 },
      { customerId: f.other, customer: 'Reyes Builders', current: 0, d31_60: 0, d61_90: 56, d90plus: 56, total: 112 },
    ]);
    expect(aging.total).toBe(224);
    expect(arAging(f.db, '2026-10-20').rows.find((r) => r.customerId === f.customer)?.total).toBe(56);
  });
  it('builds a customer statement', () => {
    const f = fixture();
    const s = credit(f, f.customer, 2);
    postCustomerPayment(f.db, { date: D, saleId: s.id, amount: 12, method: 'gcash' }, 'admin', AT);
    const st = customerStatement(f.db, f.customer, '2026-10-31');
    expect(st.sales.map((x) => x.number)).toEqual(['SI-000001']);
    expect(st.payments.map((p) => p.amount)).toEqual([12]);
    expect(st.balance).toBe(100);
  });
});
