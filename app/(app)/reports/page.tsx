import { PageHeader } from '@/components/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { buildReport, REPORT_KEYS } from '@/lib/reports';
import { nowIso } from '@/lib/time';

export default async function ReportsPage() {
  await requireRole('admin');
  const db = getDb();
  const now = nowIso();
  const tables = REPORT_KEYS.map((k) => buildReport(db, k, now));
  return (
    <>
      <PageHeader title="Reports" description="Each report downloads as a CSV that opens in Excel." />
      <div className="space-y-6">
        {tables.map((t) => (
          <Card key={t.key}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </div>
              <a href={`/reports/csv/${t.key}`} download data-testid={`csv-${t.key}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Download CSV
              </a>
            </CardHeader>
            <CardContent>
              {t.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to show.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>{t.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.rows.map((r, i) => (
                        <TableRow key={i}>
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
