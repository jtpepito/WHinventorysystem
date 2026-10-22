import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getCustomer } from '@/lib/customers';
import { getDb } from '@/lib/db';
import { formatPeso } from '@/lib/num';
import { customerStatement } from '@/lib/receivables';
import { manilaDay, nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const db = getDb();
  const c = Number.isInteger(id) ? getCustomer(db, id) : null;
  if (!c) notFound();
  const st = customerStatement(db, c.id, manilaDay(nowIso()));
  return (
    <>
      <PageHeader
        title={c.name}
        description={`${c.contact || 'No contact'} · ${c.termsDays} days terms`}
        actions={
          <>
            {!c.active && <Badge variant="secondary">Inactive</Badge>}
            <Link prefetch={false} href={`/customers/${c.id}/edit`} className={buttonVariants({ variant: 'outline' })}>Edit</Link>
            <Link prefetch={false} href="/sales/new" className={buttonVariants()}>New sale</Link>
          </>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">Open balance</CardTitle></CardHeader><CardContent className={cn('text-xl font-semibold tabular-nums', st.balance > 0 && 'text-red-700')} data-testid="customer-balance">{formatPeso(st.balance)}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">Sales</CardTitle></CardHeader><CardContent className="text-xl font-semibold tabular-nums">{st.sales.filter((s) => s.status === 'posted').length}</CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">Payments</CardTitle></CardHeader><CardContent className="text-xl font-semibold tabular-nums">{st.payments.filter((p) => p.status === 'posted').length}</CardContent></Card>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Sales</h2>
      <div className="mb-6 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {st.sales.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No sales yet.</TableCell></TableRow>}
            {st.sales.map((s) => (
              <TableRow key={s.id} className={cn(s.status === 'void' && 'text-muted-foreground')}>
                <TableCell className="font-mono text-xs"><Link prefetch={false} href={`/sales/${s.id}`} className="hover:underline">{s.number}</Link></TableCell>
                <TableCell>{s.date}</TableCell><TableCell className="capitalize">{s.method}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(s.total)}</TableCell>
                <TableCell className={cn('text-right tabular-nums', s.balance > 0 && 'text-red-700')}>{s.balance > 0 ? formatPeso(s.balance) : '—'}</TableCell>
                <TableCell>{s.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Payments</h2>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>For</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {st.payments.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">No payments yet.</TableCell></TableRow>}
            {st.payments.map((p) => (
              <TableRow key={p.id} className={cn(p.status === 'void' && 'text-muted-foreground line-through')}>
                <TableCell className="font-mono text-xs">{p.number}</TableCell><TableCell>{p.date}</TableCell>
                <TableCell className="font-mono text-xs">{p.saleNumber}</TableCell><TableCell className="capitalize">{p.method}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(p.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
