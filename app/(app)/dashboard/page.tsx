import Link from 'next/link';
import { InOutChart } from '@/components/in-out-chart';
import { MovementTable } from '@/components/movement-table';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { dashboardStats, inOutLast7Days } from '@/lib/dashboard';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { listMovements } from '@/lib/queries';
import { buildReport } from '@/lib/reports';
import { nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

export default async function DashboardPage() {
  await requireRole('admin');
  const db = getDb();
  const now = nowIso();
  const s = dashboardStats(db, now);
  const low = buildReport(db, 'low-stock', now).rows.slice(0, 8);
  const tiles = [
    { label: 'Active SKUs', value: formatQty(s.totalSkus), href: '/items?status=active' },
    { label: 'Stock value', value: formatPeso(s.stockValue), href: '/reports' },
    { label: 'Low stock', value: formatQty(s.lowStockCount), href: '/items?status=low', alert: s.lowStockCount > 0 },
    { label: "Today's movements", value: formatQty(s.todayMovements), href: '/movements' },
  ];
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className={cn('h-full transition-colors hover:bg-accent/50', t.alert && 'ring-red-300')}>
              <CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{t.label}</CardTitle></CardHeader>
              <CardContent className={cn('text-2xl font-semibold tabular-nums', t.alert && 'text-red-700')}>{t.value}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="min-w-0">
          <CardHeader><CardTitle className="text-base">Last 7 days — value in vs out</CardTitle></CardHeader>
          <CardContent><InOutChart data={inOutLast7Days(db, now)} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Low stock</CardTitle></CardHeader>
          <CardContent>
            {low.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is low.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {low.map((r) => (
                  <li key={String(r[0])} className="flex justify-between gap-2">
                    <span><span className="font-mono text-xs">{r[0]}</span> {r[1]}</span>
                    <span className="whitespace-nowrap tabular-nums text-red-700">{formatQty(Number(r[4]))} / {formatQty(Number(r[5]))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Recent movements</h2>
      <MovementTable rows={listMovements(db, { limit: 10 })} />
    </>
  );
}
