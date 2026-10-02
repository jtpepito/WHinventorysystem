import { currentRole } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { buildReport, isReportKey } from '@/lib/reports';
import { manilaDay, nowIso } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ report: string }> }) {
  if ((await currentRole()) !== 'admin') return new Response('Forbidden', { status: 403 });
  const { report } = await params;
  if (!isReportKey(report)) return new Response('Not found', { status: 404 });
  const now = nowIso();
  const table = buildReport(getDb(), report, now);
  return new Response(toCsv(table.headers, table.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report}-${manilaDay(now)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
