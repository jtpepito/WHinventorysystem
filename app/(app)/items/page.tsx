import Link from 'next/link';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { StockBadge } from '@/components/stock-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { isItemStatus, type ItemStatus, listItems } from '@/lib/queries';
import { cn } from '@/lib/utils';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ItemsPage({ searchParams }: { searchParams: SP }) {
  const role = await requireRole('admin', 'encoder');
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const category = Number(one(sp.category)) || undefined;
  const rawStatus = one(sp.status);
  const status: ItemStatus = isItemStatus(rawStatus) ? rawStatus : 'all';
  const db = getDb();
  const items = listItems(db, { q: q || undefined, categoryId: category, status });
  const categories = listNamed(db, 'categories');
  // Set by the CSV import's redirect.
  const imported = Number(one(sp.imported));
  const stocked = Number(one(sp.stocked));
  const openingRef = one(sp.ref);

  return (
    <>
      <PageHeader
        title="Items"
        description={`${items.length} item(s)`}
        actions={
          role === 'admin' && (
            <>
              <Link prefetch={false} href="/items/import" className={buttonVariants({ variant: 'outline' })}>Import from CSV</Link>
              <Link prefetch={false} href="/items/new" className={buttonVariants()}>New item</Link>
            </>
          )
        }
      />
      {imported > 0 && (
        <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Imported {imported} item{imported === 1 ? '' : 's'}.{' '}
          {stocked > 0 && openingRef ? `Opening stock for ${stocked} posted under ${openingRef}.` : 'No opening stock was posted.'}
        </p>
      )}
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Search SKU or name" aria-label="Search" />
        <NativeSelect name="category" defaultValue={category ?? ''} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={status} aria-label="Status">
          <option value="all">Any status</option>
          <option value="low">Low stock</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead>
                <TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reorder pt</TableHead>
                <TableHead className="text-right">Avg cost</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id} className={cn(i.low && 'bg-red-50/60')}>
                  <TableCell className="font-mono text-xs"><Link prefetch={false} href={`/items/${i.id}`} className="hover:underline">{i.sku}</Link></TableCell>
                  <TableCell><Link prefetch={false} href={`/items/${i.id}`} className="hover:underline">{i.name}</Link></TableCell>
                  <TableCell>{i.category}</TableCell>
                  <TableCell>{i.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(i.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(i.reorderPoint)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(i.avgCost)}</TableCell>
                  <TableCell><StockBadge active={i.active} low={i.low} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
