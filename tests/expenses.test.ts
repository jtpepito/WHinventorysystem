import { describe, expect, it } from 'vitest';
import { expenseTotalsByAccount, listExpenses, postExpense, voidExpense } from '@/lib/expenses';
import { accountBalance, postManualJournal } from '@/lib/ledger';
import { setSetting } from '@/lib/settings';
import { type Fixture, makeDb, plain } from './helpers';

const D = '2026-10-02';
const AT = '2026-10-02T04:00:00.000Z';
const lastLines = (f: Fixture) =>
  plain(f.db.prepare('SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = (SELECT MAX(id) FROM journal_entries) ORDER BY l.id').all());

describe('postExpense', () => {
  it('splits VAT out of an expense with a VAT invoice', () => {
    const f = makeDb();
    const r = postExpense(f.db, { date: D, accountCode: '6100', payee: 'Landlord', amount: 11200, vatInvoice: true, method: 'bank', refNo: 'OR-55' }, 'admin', AT);
    expect(r).toEqual({ id: 1, number: 'EXP-000001' });
    expect(lastLines(f)).toEqual([{ code: '6100', debit: 10000, credit: 0 }, { code: '1300', debit: 1200, credit: 0 }, { code: '1030', debit: 0, credit: 11200 }]);
    expect(listExpenses(f.db)).toMatchObject([{ number: 'EXP-000001', accountCode: '6100', accountName: 'Rent', payee: 'Landlord', amount: 11200, vatInput: 1200, method: 'bank', status: 'posted' }]);
  });
  it('posts the gross amount without a VAT invoice or when not registered', () => {
    const f = makeDb();
    postExpense(f.db, { date: D, accountCode: '6200', payee: 'Staff', amount: 5000, vatInvoice: false, method: 'cash' }, 'admin', AT);
    expect(lastLines(f)).toEqual([{ code: '6200', debit: 5000, credit: 0 }, { code: '1010', debit: 0, credit: 5000 }]);
    setSetting(f.db, 'vat_registered', '0');
    postExpense(f.db, { date: D, accountCode: '6300', payee: 'Meralco', amount: 2240, vatInvoice: true, method: 'gcash' }, 'admin', AT);
    expect(lastLines(f)).toEqual([{ code: '6300', debit: 2240, credit: 0 }, { code: '1020', debit: 0, credit: 2240 }]);
  });
  it('only takes a real expense account and a positive amount', () => {
    const f = makeDb();
    const base = { date: D, payee: 'X', amount: 10, vatInvoice: false, method: 'cash' as const };
    expect(() => postExpense(f.db, { ...base, accountCode: '5100' }, 'admin', AT)).toThrow('Pick an expense account.');
    expect(() => postExpense(f.db, { ...base, accountCode: '1010' }, 'admin', AT)).toThrow('Pick an expense account.');
    expect(() => postExpense(f.db, { ...base, accountCode: '6100', amount: 0 }, 'admin', AT)).toThrow(/more than 0/);
    expect(() => postExpense(f.db, { ...base, accountCode: '6100', date: 'nope' }, 'admin', AT)).toThrow(/date/);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM expenses').get()).toMatchObject({ n: 0 });
  });
  it('voids with a reversal and totals by account', () => {
    const f = makeDb();
    const a = postExpense(f.db, { date: D, accountCode: '6100', payee: 'Landlord', amount: 11200, vatInvoice: true, method: 'bank' }, 'admin', AT);
    postExpense(f.db, { date: D, accountCode: '6200', payee: 'Staff', amount: 5000, vatInvoice: false, method: 'cash' }, 'admin', AT);
    postExpense(f.db, { date: '2026-11-01', accountCode: '6200', payee: 'Staff', amount: 5000, vatInvoice: false, method: 'cash' }, 'admin', '2026-11-01T00:00:00.000Z');
    expect(expenseTotalsByAccount(f.db, '2026-10-01', '2026-10-31')).toEqual([{ code: '6100', name: 'Rent', amount: 10000 }, { code: '6200', name: 'Salaries & wages', amount: 5000 }]);
    voidExpense(f.db, a.id, 'Paid twice', 'admin', '2026-10-03T00:00:00.000Z');
    expect(lastLines(f)).toEqual([{ code: '6100', debit: 0, credit: 10000 }, { code: '1300', debit: 0, credit: 1200 }, { code: '1030', debit: 11200, credit: 0 }]);
    expect(accountBalance(f.db, '6100')).toBe(0);
    expect(listExpenses(f.db, { status: 'void' })).toMatchObject([{ id: a.id, voidReason: 'Paid twice' }]);
    expect(expenseTotalsByAccount(f.db, '2026-10-01', '2026-10-31')).toEqual([{ code: '6200', name: 'Salaries & wages', amount: 5000 }]);
    expect(() => voidExpense(f.db, a.id, 'again', 'admin')).toThrow(/already void/);
  });
});

describe('postManualJournal', () => {
  it('posts a balanced entry but never to the controlled accounts', () => {
    const f = makeDb();
    const id = postManualJournal(f.db, { date: D, memo: 'Owner capital', lines: [{ account: '1010', debit: 50000 }, { account: '3100', credit: 50000 }] }, 'admin', AT);
    expect(plain(f.db.prepare('SELECT source_type, memo FROM journal_entries WHERE id = ?').all(id))).toEqual([{ source_type: 'manual', memo: 'Owner capital' }]);
    expect(accountBalance(f.db, '3100')).toBe(50000);
    expect(() => postManualJournal(f.db, { date: D, memo: 'x', lines: [{ account: '1200', debit: 1 }, { account: '1010', credit: 1 }] }, 'admin', AT))
      .toThrow('Accounts receivable, Inventory and Accounts payable are posted by sales, purchases and payments; use those screens.');
    expect(() => postManualJournal(f.db, { date: D, memo: 'x', lines: [{ account: '1030', debit: 5 }, { account: '1010', credit: 4 }] }, 'admin', AT)).toThrow(/does not balance/);
    expect(() => postManualJournal(f.db, { date: D, memo: '', lines: [{ account: '1030', debit: 5 }, { account: '1010', credit: 5 }] }, 'admin', AT)).toThrow(/memo/);
  });
});
