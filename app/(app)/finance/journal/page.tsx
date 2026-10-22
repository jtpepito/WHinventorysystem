import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso } from '@/lib/num';
import { escapeLike } from '@/lib/queries';
import { isDay, manilaDay, nowIso } from '@/lib/time';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
type Line = { entryId: number; entryNo: string; date: string; source: string; memo: string; code: string; name: string; debit: number; credit: number };
const SOURCE_LINK: Record<string, (id: number) => string> = {
  sale: (id) => `/sales/${id}`, sale_void: (id) => `/sales/${id}`, customer_payment: () => '/customers', purchase: (id) => `/purchases/${id}`, purchase_void: (id) => `/purchases/${id}`,
  supplier_payment: () => '/purchases', expense: () => '/expenses', expense_void: () => '/expenses', count: (id) => `/count/${id}`,
};

export default async function JournalPage({ searchParams }: { searchParams: SP }) {
  await requireRole('admin');
  const sp = await searchParams;
  const today = manilaDay(nowIso());
  const from = isDay(one(sp.from)) ? one(sp.from) : `${today.slice(0, 7)}-01`;
  const to = isDay(one(sp.to)) ? one(sp.to) : today;
  const q = one(sp.q).trim();
  const entry = Number(one(sp.entry)) || undefined;
  const posted = one(sp.posted);
  const db = getDb();
  const where = entry ? ['e.id = ?'] : ['e.date >= ?', 'e.date <= ?'];
  const params: (string | number)[] = entry ? [entry] : [from, to];
  if (q) { where.push(`(e.memo LIKE ? ESCAPE '\\' OR e.entry_no LIKE ? ESCAPE '\\')`); params.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`); }
  const lines = db
    .prepare(`SELECT e.id AS entryId, e.entry_no AS entryNo, e.date, e.source_type AS source, e.memo, a.code, a.name, l.debit, l.credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC, l.id LIMIT 3000`)
    .all(...params) as Line[];
  const entries = new Map<number, { head: Line; lines: Line[] }>();
  for (const l of lines) {
    const e = entries.get(l.entryId) ?? { head: l, lines: [] };
    e.lines.push(l);
    entries.set(l.entryId, e);
  }
  const sourceId = (src: string, id: number) => (db.prepare('SELECT source_id AS s FROM journal_entries WHERE id = ?').get(id) as { s: number | null }).s;
  return (
    <>
      <PageHeader title="General journal" description={entry ? `Entry #${entry}` : `${entries.size} entr${entries.size === 1 ? 'y' : 'ies'} ${from} to ${to}`} actions={<><a href={`/reports/csv/journal?from=${from}&to=${to}`} download className={buttonVariants({ variant: 'outline' })}>CSV</a><Link prefetch={false} href="/finance/journal/new" className={buttonVariants()}>Manual entry</Link></>} />
      {posted && <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Entry {posted} posted.</p>}
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_auto] lg:items-end">
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="space-y-1"><Label htmlFor="q">Search memo</Label><Input id="q" name="q" defaultValue={q} placeholder="SI-000012, rent, …" /></div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {entries.size === 0 ? (
        <p className="text-sm text-muted-foreground">No entries match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Entry</TableHead><TableHead>Memo</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Debit</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
            <TableBody>
              {[...entries.values()].map(({ head, lines }) => {
                const sid = sourceId(head.source, head.entryId);
                const link = sid !== null && SOURCE_LINK[head.source] ? SOURCE_LINK[head.source](sid) : null;
                return lines.map((l, i) => (
                  <TableRow key={`${l.entryId}-${i}`} className={i === 0 ? 'border-t-2' : ''}>
                    <TableCell className="whitespace-nowrap">{i === 0 ? l.date : ''}</TableCell>
                    <TableCell className="font-mono text-xs">{i === 0 ? l.entryNo : ''}</TableCell>
                    <TableCell>{i === 0 ? (link ? <Link prefetch={false} href={link} className="hover:underline">{l.memo}</Link> : l.memo) : ''}{i === 0 && <span className="block text-xs text-muted-foreground">{l.source}</span>}</TableCell>
                    <TableCell className={l.credit > 0 ? 'pl-8' : ''}><span className="font-mono text-xs">{l.code}</span> {l.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.debit ? formatPeso(l.debit) : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.credit ? formatPeso(l.credit) : ''}</TableCell>
                  </TableRow>
                ));
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
