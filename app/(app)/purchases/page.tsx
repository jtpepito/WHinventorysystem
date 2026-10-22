import Link from 'next/link';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { formatPeso } from '@/lib/num';
import { isPurchaseMethod, listPurchases } from '@/lib/purchases';
import { isDay, manilaDay, nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const METHOD: Record<string, string> = { cash: 'Cash', gcash: 'GCash', bank: 'Bank', credit: 'On account' };

export default async function PurchasesPage({ searchParams }: { searchParams: SP }) {
  await requireRole('admin', 'encoder');
  const sp = await searchParams;
  const today = manilaDay(nowIso());
  const from = isDay(one(sp.from)) ? one(sp.from) : `${today.slice(0, 7)}-01`;
  const to = isDay(one(sp.to)) ? one(sp.to) : today;
  const supplierId = Number(one(sp.supplier)) || undefined;
  const rawMethod = one(sp.method);
  const method = isPurchaseMethod(rawMethod) ? rawMethod : undefined;
  const openOnly = one(sp.open) === '1';
  const db = getDb();
  let rows = listPurchases(db, { from: openOnly ? undefined : from, to: openOnly ? undefined : to, supplierId, method: openOnly ? 'credit' : method });
  if (openOnly) rows = rows.filter((p) => p.balance > 0);
  const total = rows.filter((p) => p.status === 'posted').reduce((t, p) => t + p.total, 0);
  const owed = rows.reduce((t, p) => t + p.balance, 0);
  return (
    <>
      <PageHeader
        title="Purchases"
        description={openOnly ? `${rows.length} unpaid purchase(s) · ${formatPeso(owed)} owed` : `${rows.length} purchase(s) ${from} to ${to} · ${formatPeso(total)}`}
        actions={<Link prefetch={false} href="/receive" className={buttonVariants()}>Receive stock</Link>}
      />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_10rem_auto_auto] lg:items-end">
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <div className="space-y-1">
          <Label htmlFor="supplier">Supplier</Label>
          <NativeSelect id="supplier" name="supplier" defaultValue={supplierId ?? ''}>
            <option value="">All suppliers</option>
            {listSuppliers(db).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="method">Method</Label>
          <NativeSelect id="method" name="method" defaultValue={method ?? ''}>
            <option value="">Any</option>
            {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="open" value="1" defaultChecked={openOnly} /> Unpaid only</label>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No purchases match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead><TableHead>Invoice</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} className={cn(p.status === 'void' && 'text-muted-foreground')}>
                  <TableCell className="font-mono text-xs"><Link prefetch={false} href={`/purchases/${p.id}`} className="hover:underline">{p.number}</Link></TableCell>
                  <TableCell>{p.date}</TableCell><TableCell>{p.supplierName}</TableCell><TableCell className="font-mono text-xs">{p.refNo}</TableCell><TableCell>{METHOD[p.method]}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(p.total)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', p.balance > 0 && 'text-red-700')}>{p.balance > 0 ? formatPeso(p.balance) : '—'}</TableCell>
                  <TableCell>{p.status === 'void' ? <Badge variant="secondary">Void</Badge> : <Badge variant="outline">Posted</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
