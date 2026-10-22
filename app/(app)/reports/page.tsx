import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { buildReport, defaultParams, FINANCE_REPORT_KEYS, type ReportKey, type ReportParams, SALES_REPORT_KEYS, STOCK_REPORT_KEYS } from '@/lib/reports';
import { isDay, nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function readParams(sp: Record<string, string | string[] | undefined>): ReportParams {
  const p: ReportParams = {};
  if (isDay(one(sp.from))) p.from = one(sp.from);
  if (isDay(one(sp.to))) p.to = one(sp.to);
  if (isDay(one(sp.asOf))) p.asOf = one(sp.asOf);
  if (/^\d{4}-\d{2}$/.test(one(sp.month))) p.month = one(sp.month);
  return p;
}

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  await requireRole('admin');
  const sp = await searchParams;
  const tab = one(sp.tab) === 'financial' ? 'financial' : 'stock';
  const db = getDb();
  const now = nowIso();
  const p = defaultParams(now, readParams(sp));
  const query = `from=${p.from}&to=${p.to}&asOf=${p.asOf}&month=${p.month}`;
  const keys: ReportKey[] = tab === 'stock' ? STOCK_REPORT_KEYS : [...SALES_REPORT_KEYS, ...FINANCE_REPORT_KEYS];
  const tables = keys.map((k) => buildReport(db, k, now, p));
  return (
    <>
      <PageHeader title="Reports" description="Each report downloads as a CSV that opens in Excel." />
      <div className="mb-4 flex gap-2">
        <Link prefetch={false} href="/reports?tab=stock" className={cn(buttonVariants({ variant: tab === 'stock' ? 'default' : 'outline', size: 'sm' }))}>Stock</Link>
        <Link prefetch={false} href={`/reports?tab=financial&${query}`} className={cn(buttonVariants({ variant: tab === 'financial' ? 'default' : 'outline', size: 'sm' }))}>Sales &amp; financial</Link>
      </div>
      {tab === 'financial' && (
        <form className="mb-6 grid gap-3 rounded-md border p-4 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_10rem_8rem_auto] lg:items-end">
          <input type="hidden" name="tab" value="financial" />
          <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={p.from} /></div>
          <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={p.to} /></div>
          <div className="space-y-1"><Label htmlFor="asOf">Balance sheet / aging as of</Label><Input id="asOf" name="asOf" type="date" defaultValue={p.asOf} /></div>
          <div className="space-y-1"><Label htmlFor="month">VAT month</Label><Input id="month" name="month" type="month" defaultValue={p.month} /></div>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      )}
      <div className="space-y-6">
        {tables.map((t) => (
          <Card key={t.key}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </div>
              <a href={`/reports/csv/${t.key}?${query}`} download data-testid={`csv-${t.key}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Download CSV
              </a>
            </CardHeader>
            <CardContent>
              {t.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to show.</p>
              ) : (
                <div className="max-h-[32rem] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>{t.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.rows.map((r, i) => (
                        <TableRow key={i} className={cn(typeof r[0] === 'string' && /^(TOTAL|Total |Net income|Gross profit|Net sales)/.test(r[0]) && 'font-semibold')}>
                          {r.map((c, j) => (
                            <TableCell key={j} className={typeof c === 'number' ? 'text-right tabular-nums' : undefined}>
                              {typeof c === 'number' ? (t.moneyColumns.includes(j) ? formatPeso(c) : formatQty(c)) : c}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
