import { getCountSession, postCountSession, saveCountActuals, startCountSession } from '@/lib/count';
import { createCustomer } from '@/lib/customers';
import { postExpense } from '@/lib/expenses';
import { postManualJournal } from '@/lib/ledger';
import { postPurchase } from '@/lib/purchases';
import { postCustomerPayment } from '@/lib/receivables';
import { postSale } from '@/lib/sales';
import { makeDb } from './helpers';

export const NOW = '2026-10-20T04:00:00.000Z';
export const MONTH = { from: '2026-10-01', to: '2026-10-31' };

// One October of activity, all with round numbers so every report line can be checked by hand:
//   Oct 1  capital ₱50,000 cash
//   Oct 2  purchase 10 × ₱112 gross, VAT invoice, cash   → stock 10 @ 100, Input VAT 120
//   Oct 3  cash sale 2 × ₱168 (net 150, VAT 18 each)      → sales 300, COGS 200
//   Oct 5  credit sale 1 × ₱168 to JDC, paid ₱100 on Oct 8 → AR 68 open
//   Oct 10 rent ₱11,200 VAT invoice by bank               → rent 10,000, Input VAT 1,200 (bank goes negative; fine for a test)
//   Oct 15 count: T-001 expected 7, actual 6              → shrinkage 100
export function financeFixture() {
  const f = makeDb();
  const customer = createCustomer(f.db, { name: 'JDC Construction' });
  postManualJournal(f.db, { date: '2026-10-01', memo: 'Owner capital', lines: [{ account: '1010', debit: 50000 }, { account: '3100', credit: 50000 }] }, 'admin', '2026-10-01T00:00:00.000Z');
  const purchase = postPurchase(f.db, { date: '2026-10-02', supplierId: f.supplier, refNo: 'INV-1', method: 'cash', vatInvoice: true, lines: [{ itemId: f.item, qty: 10, unitCost: 112 }] }, 'admin', '2026-10-02T00:00:00.000Z');
  const cashSale = postSale(f.db, { date: '2026-10-03', customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 2, unitPrice: 168 }] }, 'encoder', '2026-10-03T00:00:00.000Z');
  const creditSale = postSale(f.db, { date: '2026-10-05', customerId: customer, method: 'credit', lines: [{ itemId: f.item, qty: 1, unitPrice: 168 }] }, 'encoder', '2026-10-05T00:00:00.000Z');
  postCustomerPayment(f.db, { date: '2026-10-08', saleId: creditSale.id, amount: 100, method: 'cash' }, 'encoder', '2026-10-08T00:00:00.000Z');
  postExpense(f.db, { date: '2026-10-10', accountCode: '6100', payee: 'Landlord', amount: 11200, vatInvoice: true, method: 'bank' }, 'admin', '2026-10-10T00:00:00.000Z');
  const session = startCountSession(f.db, { categoryId: f.cat }, '2026-10-15T00:00:00.000Z');
  const line = getCountSession(f.db, session)!.lines.find((l) => l.itemId === f.item)!;
  saveCountActuals(f.db, session, [{ lineId: line.lineId, actual: 6 }]);
  postCountSession(f.db, session, 'admin', '2026-10-15T01:00:00.000Z');
  return { ...f, customer, purchase, cashSale, creditSale, session };
}
