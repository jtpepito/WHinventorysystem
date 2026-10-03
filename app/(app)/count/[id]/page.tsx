import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getCountSession } from '@/lib/count';
import { getDb } from '@/lib/db';
import { formatQty, formatSignedQty } from '@/lib/num';
import { formatManila } from '@/lib/time';
import { CountSheet } from './count-sheet';

export default async function CountSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const { posted } = await searchParams;
  const session = Number.isInteger(id) ? getCountSession(getDb(), id) : null;
  if (!session) notFound();
  const title = `Count #${session.id} — ${session.scope}`;
  if (!session.postedAt) {
    return (
      <>
        <PageHeader title={title} description={`Started ${formatManila(session.startedAt)}`} />
        <CountSheet sessionId={session.id} lines={session.lines} />
      </>
    );
  }
  return (
    <>
      <PageHeader title={title} description={`Posted ${formatManila(session.postedAt)} · adjustments use ref COUNT-${session.id}`} />
      {posted !== undefined && (
        <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Count posted. {Number(posted) || 0} adjustment(s) created.
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {session.lines.map((l) => (
              <TableRow key={l.lineId}>
                <TableCell className="font-mono text-xs"><Link prefetch={false} className="hover:underline" href={`/items/${l.itemId}`}>{l.sku}</Link></TableCell>
                <TableCell>{l.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.expected)}</TableCell>
                <TableCell className="text-right tabular-nums">{l.actual === null ? 'Not counted' : formatQty(l.actual)}</TableCell>
                <TableCell className="text-right tabular-nums">{l.variance === null ? '—' : formatSignedQty(l.variance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
