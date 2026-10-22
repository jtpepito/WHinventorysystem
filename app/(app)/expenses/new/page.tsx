import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { ACC, listAccounts } from '@/lib/ledger';
import { vatRegistered } from '@/lib/settings';
import { manilaDay, nowIso } from '@/lib/time';
import { ExpenseForm } from './expense-form';

export default async function NewExpensePage() {
  await requireRole('admin');
  const db = getDb();
  const accounts = listAccounts(db, { type: 'expense', activeOnly: true }).filter((a) => a.code !== ACC.cogs && a.code !== ACC.shrink).map(({ code, name }) => ({ code, name }));
  return (
    <>
      <PageHeader title="New expense" description="Rent, salaries, utilities and other spending paid from cash, GCash or the bank." />
      <ExpenseForm accounts={accounts} today={manilaDay(nowIso())} vatRegistered={vatRegistered(db)} />
    </>
  );
}
