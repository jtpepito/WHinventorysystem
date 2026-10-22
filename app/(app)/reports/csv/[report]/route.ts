import { currentRole } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { buildReport, isReportKey, type ReportParams } from '@/lib/reports';
import { isDay, manilaDay, nowIso } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  if ((await currentRole()) !== 'admin') return new Response('Forbidden', { status: 403 });
  const { report } = await params;
  if (!isReportKey(report)) return new Response('Not found', { status: 404 });
  const q = new URL(req.url).searchParams;
  const p: ReportParams = {};
  for (const k of ['from', 'to', 'asOf'] as const) if (isDay(q.get(k))) p[k] = q.get(k)!;
  if (/^\d{4}-\d{2}$/.test(q.get('month') ?? '')) p.month = q.get('month')!;
  const now = nowIso();
  const table = buildReport(getDb(), report, now, p);
  return new Response(toCsv(table.headers, table.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report}-${manilaDay(now)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
