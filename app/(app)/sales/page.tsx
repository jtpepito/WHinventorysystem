import Link from 'next/link';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { getDb } from '@/lib/db';
import { formatPeso } from '@/lib/num';
import { isSaleMethod, listSales, SALE_METHOD_LABEL as METHOD_LABEL, type SaleMethod, salesTotals } from '@/lib/sales';
import { isDay, manilaDay, nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function SalesPage({ searchParams }: { searchParams: SP }) {
  const role = await requireRole('admin', 'encoder');
  const sp = await searchParams;
  const today = manilaDay(nowIso());
  const from = isDay(one(sp.from)) ? one(sp.from) : `${today.slice(0, 7)}-01`;
  const to = isDay(one(sp.to)) ? one(sp.to) : today;
  const customerId = Number(one(sp.customer)) || undefined;
  const rawMethod = one(sp.method);
  const method = isSaleMethod(rawMethod) ? rawMethod : undefined;
  const status = one(sp.status) === 'void' ? 'void' : one(sp.status) === 'posted' ? 'posted' : undefined;
  const db = getDb();
  const rows = listSales(db, { from, to, customerId, method, status });
  const totals = salesTotals(db, { from, to, customerId, method });
  const customers = listCustomers(db);

  return (
    <>
      <PageHeader
        title="Sales"
        description={`${totals.count} posted sale(s) ${from} to ${to} · ${formatPeso(totals.total)}`}
        actions={
          <>
            {role === 'admin' && <a href={`/reports/csv/sales-by-day?from=${from}&to=${to}`} download className={buttonVariants({ variant: 'outline' })}>CSV by day</a>}
            <Link prefetch={false} href="/sales/new" className={buttonVariants()}>New sale</Link>
          </>
        }
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_10rem_8rem_auto] lg:items-end">
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="space-y-1">
          <Label htmlFor="customer">Customer</Label>
          <NativeSelect id="customer" name="customer" defaultValue={customerId ?? ''}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="method">Method</Label>
          <NativeSelect id="method" name="method" defaultValue={method ?? ''}>
            <option value="">Any</option>
            {(Object.keys(METHOD_LABEL) as SaleMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={status ?? ''}>
            <option value="">Any</option><option value="posted">Posted</option><option value="void">Void</option>
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sales match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Method</TableHead>
                <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} className={cn(s.status === 'void' && 'text-muted-foreground')}>
                  <TableCell className="font-mono text-xs"><Link prefetch={false} href={`/sales/${s.id}`} className="hover:underline">{s.number}</Link></TableCell>
                  <TableCell>{s.date}</TableCell>
                  <TableCell>{s.customerName}</TableCell>
                  <TableCell>{METHOD_LABEL[s.method]}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(s.total)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', s.balance > 0 && 'text-red-700')}>{s.balance > 0 ? formatPeso(s.balance) : '—'}</TableCell>
                  <TableCell>{s.status === 'void' ? <Badge variant="secondary">Void</Badge> : <Badge variant="outline">Posted</Badge>}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={4}>Posted total</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(totals.total)}</TableCell>
                <TableCell colSpan={2} className="text-xs font-normal text-muted-foreground">VAT {formatPeso(totals.vat)} · cost {formatPeso(totals.cogs)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
