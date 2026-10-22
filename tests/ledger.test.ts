import { describe, expect, it } from 'vitest';
import {
  ACC, accountBalance, accountByCode, addAccount, assertNotControlled, cashAccountFor, listAccounts, nextNumber, postJournal, reverseJournal,
  seedChart, updateAccount,
} from '@/lib/ledger';
import { makeDb, plain } from './helpers';

function fixture() {
  const f = makeDb();
  seedChart(f.db);
  return f;
}
const D = '2026-10-02';

describe('chart of accounts', () => {
  it('seeds 22 accounts once', () => {
    const { db } = fixture();
    seedChart(db);
    expect(listAccounts(db)).toHaveLength(22);
    expect(accountByCode(db, '1200')).toMatchObject({ code: '1200', name: 'Inventory', type: 'asset', system: true, active: true });
    expect(listAccounts(db, { type: 'expense' }).map((a) => a.code)).toEqual(['5100', '5200', '6100', '6200', '6300', '6400', '6500', '6600', '6900']);
  });
  it('adds, renames and deactivates accounts with the system guard', () => {
    const { db } = fixture();
    expect(() => addAccount(db, { code: '61', name: 'x', type: 'expense' })).toThrow(/4 digits/);
    expect(() => addAccount(db, { code: '6100', name: 'x', type: 'expense' })).toThrow(/already/);
    const id = addAccount(db, { code: '6700', name: 'Marketing', type: 'expense' });
    updateAccount(db, id, { name: 'Marketing & ads', active: false });
    expect(accountByCode(db, '6700')).toMatchObject({ name: 'Marketing & ads', active: false, system: false });
    expect(listAccounts(db, { activeOnly: true }).some((a) => a.code === '6700')).toBe(false);
    const inv = accountByCode(db, '1200');
    updateAccount(db, inv.id, { name: 'Stock on hand', active: false });
    expect(accountByCode(db, '1200')).toMatchObject({ name: 'Stock on hand', active: true });
  });
  it('maps payment methods to cash accounts', () => {
    expect(cashAccountFor('cash')).toBe(ACC.cash);
    expect(cashAccountFor('gcash')).toBe('1020');
    expect(cashAccountFor('bank')).toBe('1030');
  });
});

describe('numbering', () => {
  it('is sequential per prefix', () => {
    const { db } = fixture();
    expect(nextNumber(db, 'SI')).toBe('SI-000001');
    expect(nextNumber(db, 'SI')).toBe('SI-000002');
    expect(nextNumber(db, 'CR')).toBe('CR-000001');
  });
});

describe('postJournal', () => {
  it('posts a balanced entry and reports balances by natural side', () => {
    const { db } = fixture();
    const id = postJournal(db, { date: D, sourceType: 'sale', sourceId: 1, memo: 'SI-1', lines: [
      { account: '1010', debit: 112 }, { account: '4100', credit: 100 }, { account: '2200', credit: 12 },
    ] }, 'admin');
    expect(id).toBeGreaterThan(0);
    expect(accountBalance(db, '1010')).toBe(112);
    expect(accountBalance(db, '4100')).toBe(100);
    expect(accountBalance(db, '2200')).toBe(12);
    expect(plain(db.prepare('SELECT entry_no, date, source_type, memo FROM journal_entries').all())).toEqual([{ entry_no: 'JE-000001', date: D, source_type: 'sale', memo: 'SI-1' }]);
  });
  it('rejects unbalanced, single-line, and unknown-account entries', () => {
    const { db } = fixture();
    expect(() => postJournal(db, { date: D, sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '1010', debit: 100 }, { account: '4100', credit: 99.99 }] }, 'admin'))
      .toThrow('Journal entry does not balance: debits ₱100.00, credits ₱99.99.');
    expect(() => postJournal(db, { date: D, sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '1010', debit: 100 }] }, 'admin')).toThrow(/at least two/);
    expect(() => postJournal(db, { date: D, sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '9999', debit: 1 }, { account: '1010', credit: 1 }] }, 'admin')).toThrow(/Account 9999/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get()).toMatchObject({ n: 0 });
  });
  it('drops zero lines', () => {
    const { db } = fixture();
    postJournal(db, { date: D, sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '1010', debit: 0 }, { account: '1030', debit: 5 }, { account: '1010', credit: 5 }] }, 'admin');
    expect(db.prepare('SELECT COUNT(*) AS n FROM journal_lines').get()).toMatchObject({ n: 2 });
  });
  it('refuses an inactive account', () => {
    const { db } = fixture();
    const id = addAccount(db, { code: '6700', name: 'Marketing', type: 'expense' });
    updateAccount(db, id, { name: 'Marketing', active: false });
    expect(() => postJournal(db, { date: D, sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '6700', debit: 1 }, { account: '1010', credit: 1 }] }, 'admin')).toThrow(/inactive/);
  });
  it('reverses an entry and filters balances by date', () => {
    const { db } = fixture();
    const id = postJournal(db, { date: D, sourceType: 'sale', sourceId: 1, memo: 'SI-1', lines: [{ account: '1010', debit: 112 }, { account: '4100', credit: 100 }, { account: '2200', credit: 12 }] }, 'admin');
    reverseJournal(db, id, { date: '2026-10-05', sourceType: 'sale_void', sourceId: 1, memo: 'Void SI-1' }, 'admin');
    expect(accountBalance(db, '1010')).toBe(0);
    expect(accountBalance(db, '4100')).toBe(0);
    expect(accountBalance(db, '1010', { through: '2026-10-04' })).toBe(112);
    expect(plain(db.prepare('SELECT entry_no FROM journal_entries ORDER BY id').all())).toEqual([{ entry_no: 'JE-000001' }, { entry_no: 'JE-000002' }]);
    const rev = plain(db.prepare('SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = 2 ORDER BY l.id').all());
    expect(rev).toEqual([{ code: '1010', debit: 0, credit: 112 }, { code: '4100', debit: 100, credit: 0 }, { code: '2200', debit: 12, credit: 0 }]);
  });
});

describe('assertNotControlled', () => {
  it('blocks AR, Inventory and AP, allows VAT accounts', () => {
    expect(() => assertNotControlled([{ account: '1100', debit: 1 }])).toThrow('Accounts receivable, Inventory and Accounts payable are posted by sales, purchases and payments; use those screens.');
    expect(() => assertNotControlled([{ account: ACC.inventory, credit: 1 }])).toThrow(/use those screens/);
    expect(() => assertNotControlled([{ account: '2200', credit: 1 }])).not.toThrow();
  });
});
