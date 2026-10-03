import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MovementTable } from '@/components/movement-table';
import { PageHeader } from '@/components/page-header';
import { StockBadge } from '@/components/stock-badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { getItem, listMovementsPage } from '@/lib/queries';

const HISTORY_LIMIT = 300;

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className="text-xl font-semibold tabular-nums">{children}</CardContent>
    </Card>
  );
}

export default async function ItemCard({ params }: { params: Promise<{ id: string }> }) {
  const role = await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const db = getDb();
  const item = Number.isInteger(id) ? getItem(db, id) : null;
  if (!item) notFound();
  const history = listMovementsPage(db, { itemId: item.id }, HISTORY_LIMIT);
  return (
    <>
      <PageHeader
        title={item.name}
        description={`${item.sku} · ${item.category} · per ${item.unit}`}
        actions={
          <>
            <StockBadge active={item.active} low={item.low} />
            {role === 'admin' && <Link href={`/items/${item.id}/edit`} className={buttonVariants({ variant: 'outline' })}>Edit</Link>}
          </>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="On hand"><span data-testid="qty-on-hand">{formatQty(item.qty)}</span> <span className="text-sm font-normal">{item.unit}</span></Stat>
        <Stat label="Average cost"><span data-testid="avg-cost">{formatPeso(item.avgCost)}</span></Stat>
        <Stat label="Stock value">{formatPeso(item.qty * item.avgCost)}</Stat>
        <Stat label="Reorder point">{formatQty(item.reorderPoint)} <span className="text-sm font-normal">{item.unit}</span></Stat>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Movement history</h2>
      {history.truncated && (
        <p data-testid="history-truncated" className="mb-2 text-xs text-muted-foreground">
          Showing the latest {HISTORY_LIMIT} movements.{' '}
          <Link prefetch={false} href={`/movements?item=${item.id}`} className="underline">See all in Movements</Link>
        </p>
      )}
      <MovementTable rows={history.rows} showItem={false} />
    </>
  );
}
