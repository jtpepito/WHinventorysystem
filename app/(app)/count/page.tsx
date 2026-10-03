import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { listCountSessions } from '@/lib/count';
import { getDb } from '@/lib/db';
import { formatManila } from '@/lib/time';
import { StartCountForm } from './start-count-form';

export default async function CountPage({ searchParams }: { searchParams: Promise<{ discarded?: string }> }) {
  await requireRole('admin', 'encoder');
  const { discarded } = await searchParams;
  const db = getDb();
  const sessions = listCountSessions(db);
  return (
    <>
      <PageHeader title="Physical count" description="Count shelves, type what you find, and post the variances as adjustments." />
      {discarded && (
        <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Count discarded. Nothing was posted.
        </p>
      )}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Start a new count</CardTitle></CardHeader>
        <CardContent><StartCountForm categories={listNamed(db, 'categories')} /></CardContent>
      </Card>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No counts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Started</TableHead><TableHead>Scope</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Variances</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link prefetch={false} className="hover:underline" href={`/count/${s.id}`}>{formatManila(s.startedAt)}</Link></TableCell>
                  <TableCell>{s.scope}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.countedCount} / {s.lineCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.varianceCount}</TableCell>
                  <TableCell>{s.postedAt ? <Badge variant="secondary">Posted {formatManila(s.postedAt)}</Badge> : <Badge>Open</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
