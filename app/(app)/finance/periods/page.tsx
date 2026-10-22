import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso } from '@/lib/num';
import { listPeriods, monthLabel, periodLog } from '@/lib/periods';
import { lockedThrough } from '@/lib/settings';
import { addDays, formatManila, manilaDay, nowIso } from '@/lib/time';
import { CloseForm, ReopenForm } from './period-forms';

export default async function PeriodsPage() {
  await requireRole('admin');
  const db = getDb();
  const now = nowIso();
  const lock = lockedThrough(db);
  const months = listPeriods(db, now);
  const thisMonth = manilaDay(now).slice(0, 7);
  // The next month that can be closed: the newest open month before the current one.
  const closable = months.filter((m) => !m.closed && m.month < thisMonth).map((m) => addDays(`${addDays(`${m.month}-01`, 31).slice(0, 7)}-01`, -1))[0];
  const reopenOptions = months.filter((m) => m.closed).map((m) => addDays(`${m.month}-01`, -1)).filter((d) => d !== lock && d >= '2000-01-01').slice(0, 3);
  return (
    <>
      <PageHeader title="Month-end close" description={lock ? `Closed through ${lock}.` : 'All months are open.'} />
      <div className="mb-6 space-y-4">
        {closable ? <CloseForm through={closable} /> : <p className="text-sm text-muted-foreground">Nothing left to close before this month.</p>}
        {lock && <ReopenForm options={reopenOptions} />}
      </div>
      <div className="mb-6 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Sales</TableHead><TableHead className="text-right">Purchases</TableHead><TableHead className="text-right">Expenses</TableHead></TableRow></TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{monthLabel(`${m.month}-01`)}</TableCell>
                <TableCell>{m.closed ? 'Closed' : 'Open'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(m.sales)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(m.purchases)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(m.expenses)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Log</h2>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>Through</TableHead><TableHead>Reason</TableHead><TableHead>Who</TableHead></TableRow></TableHeader>
          <TableBody>
            {periodLog(db).length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No closes yet.</TableCell></TableRow>}
            {periodLog(db).map((r) => (
              <TableRow key={r.id}><TableCell className="whitespace-nowrap">{formatManila(r.createdAt)}</TableCell><TableCell className="capitalize">{r.action}</TableCell><TableCell>{r.through ?? 'everything'}</TableCell><TableCell>{r.reason}</TableCell><TableCell className="capitalize">{r.actor}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
