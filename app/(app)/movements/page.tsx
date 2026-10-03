import { MovementTable } from '@/components/movement-table';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { isMovementType } from '@/lib/inventory';
import { listItems, listMovementsPage } from '@/lib/queries';
import { isDay } from '@/lib/time';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const LIMIT = 500;

export default async function MovementsPage({ searchParams }: { searchParams: SP }) {
  await requireRole('admin', 'encoder');
  const sp = await searchParams;
  const itemId = Number(one(sp.item)) || undefined;
  const rawType = one(sp.type);
  const type = isMovementType(rawType) ? rawType : undefined;
  const from = isDay(one(sp.from)) ? one(sp.from) : undefined;
  const to = isDay(one(sp.to)) ? one(sp.to) : undefined;
  const db = getDb();
  const { rows, truncated } = listMovementsPage(db, { itemId, type, from, to }, LIMIT);
  const items = listItems(db);

  return (
    <>
      <PageHeader title="Movements" description="Every receive, release and adjustment. Entries are never edited." />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_10rem_auto] lg:items-end">
        <div className="space-y-1">
          <Label htmlFor="item">Item</Label>
          <NativeSelect id="item" name="item" defaultValue={itemId ?? ''}>
            <option value="">All items</option>
            {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <NativeSelect id="type" name="type" defaultValue={type ?? ''}>
            <option value="">All types</option>
            <option value="receive">Receive</option>
            <option value="release">Release</option>
            <option value="adjust">Adjust</option>
          </NativeSelect>
        </div>
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {truncated && <p className="mb-2 text-xs text-muted-foreground">Showing the latest {LIMIT}. Narrow the filters to see older entries.</p>}
      <MovementTable rows={rows} />
    </>
  );
}
