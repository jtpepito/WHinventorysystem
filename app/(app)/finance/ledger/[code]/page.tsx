import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { accountLedger } from '@/lib/finance-reports';
import { listAccounts } from '@/lib/ledger';
import { formatPeso } from '@/lib/num';
import { addDays, isDay, manilaDay, nowIso } from '@/lib/time';

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireRole('admin');
  const { code } = await params;
  const sp = await searchParams;
  const db = getDb();
  if (!listAccounts(db).some((a) => a.code === code)) notFound();
  const today = manilaDay(nowIso());
  const from = isDay(sp.from) ? sp.from : addDays(`${today.slice(0, 7)}-01`, -31).slice(0, 7) + '-01';
  const to = isDay(sp.to) ? sp.to : today;
  const l = accountLedger(db, code, { from, to });
  return (
    <>
      <PageHeader title={`${l.account.code} ${l.account.name}`} description={`Ledger ${from} to ${to}`} />
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <Button type="submit" variant="secondary">Show</Button>
      </form>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entry</TableHead><TableHead>Memo</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead><TableHead className="text-right">Balance</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow className="text-muted-foreground"><TableCell colSpan={5}>Opening balance</TableCell><TableCell className="text-right tabular-nums">{formatPeso(l.opening)}</TableCell></TableRow>
            {l.rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{r.date}</TableCell><TableCell className="font-mono text-xs">{r.entryNo}</TableCell><TableCell>{r.memo}</TableCell>
                <TableCell className="text-right tabular-nums">{r.debit ? formatPeso(r.debit) : ''}</TableCell>
                <TableCell className="text-right tabular-nums">{r.credit ? formatPeso(r.credit) : ''}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(r.balance)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold"><TableCell colSpan={5}>Closing balance</TableCell><TableCell className="text-right tabular-nums">{formatPeso(l.closing)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
