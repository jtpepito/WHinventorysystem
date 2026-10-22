import Link from 'next/link';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listExpenses } from '@/lib/expenses';
import { listAccounts } from '@/lib/ledger';
import { formatPeso } from '@/lib/num';
import { isDay, manilaDay, nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';
import { VoidExpenseButton } from './void-expense-button';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ExpensesPage({ searchParams }: { searchParams: SP }) {
  await requireRole('admin');
  const sp = await searchParams;
  const today = manilaDay(nowIso());
  const from = isDay(one(sp.from)) ? one(sp.from) : `${today.slice(0, 7)}-01`;
  const to = isDay(one(sp.to)) ? one(sp.to) : today;
  const accountCode = one(sp.account) || undefined;
  const posted = one(sp.posted);
  const db = getDb();
  const rows = listExpenses(db, { from, to, accountCode });
  const total = rows.filter((e) => e.status === 'posted').reduce((t, e) => t + e.amount, 0);
  return (
    <>
      <PageHeader title="Expenses" description={`${rows.length} expense(s) ${from} to ${to} · ${formatPeso(total)}`} actions={<Link prefetch={false} href="/expenses/new" className={buttonVariants()}>New expense</Link>} />
      {posted && <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Expense {posted} saved.</p>}
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_auto] lg:items-end">
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="space-y-1">
          <Label htmlFor="account">Account</Label>
          <NativeSelect id="account" name="account" defaultValue={accountCode ?? ''}>
            <option value="">All accounts</option>
            {listAccounts(db, { type: 'expense' }).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No expenses match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Account</TableHead><TableHead>Payee</TableHead><TableHead>Paid by</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">of which VAT</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className={cn(e.status === 'void' && 'text-muted-foreground line-through')}>
                  <TableCell className="font-mono text-xs">{e.number}</TableCell><TableCell>{e.date}</TableCell>
                  <TableCell><Link prefetch={false} href={`/finance/ledger/${e.accountCode}`} className="hover:underline">{e.accountCode} {e.accountName}</Link></TableCell>
                  <TableCell>{e.payee}{e.refNo && <span className="block text-xs text-muted-foreground">{e.refNo}</span>}</TableCell>
                  <TableCell className="capitalize">{e.method}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(e.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.vatInput ? formatPeso(e.vatInput) : '—'}</TableCell>
                  <TableCell>{e.status === 'posted' && <VoidExpenseButton expenseId={e.id} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
