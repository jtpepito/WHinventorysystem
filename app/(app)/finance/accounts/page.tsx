import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { trialBalance } from '@/lib/finance-reports';
import { listAccounts } from '@/lib/ledger';
import { formatPeso } from '@/lib/num';
import { manilaDay, nowIso } from '@/lib/time';

export default async function AccountsPage() {
  await requireRole('admin');
  const db = getDb();
  const today = manilaDay(nowIso());
  const tb = new Map(trialBalance(db, today).rows.map((r) => [r.code, r]));
  const accounts = listAccounts(db);
  return (
    <>
      <PageHeader title="Accounts" description={`Balances as of ${today}. Click an account for its ledger.`} />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const b = tb.get(a.code);
              return (
                <TableRow key={a.id} className={!a.active ? 'text-muted-foreground' : ''}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell><Link prefetch={false} href={`/finance/ledger/${a.code}`} className="hover:underline">{a.name}</Link></TableCell>
                  <TableCell className="capitalize">{a.type}</TableCell>
                  <TableCell className="text-right tabular-nums">{b?.debit ? formatPeso(b.debit) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{b?.credit ? formatPeso(b.credit) : ''}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
