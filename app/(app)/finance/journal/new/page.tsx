import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listAccounts } from '@/lib/ledger';
import { manilaDay, nowIso } from '@/lib/time';
import { JournalForm } from './journal-form';

export default async function NewJournalPage() {
  await requireRole('admin');
  const accounts = listAccounts(getDb(), { activeOnly: true }).map(({ code, name }) => ({ code, name }));
  return (
    <>
      <PageHeader title="Manual journal entry" description="For things the documents don't cover: owner capital or drawings, moving cash to the bank, paying VAT to the BIR." />
      <JournalForm accounts={accounts} today={manilaDay(nowIso())} />
    </>
  );
}
