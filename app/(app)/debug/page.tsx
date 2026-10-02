import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { ledgerCheck } from '@/lib/inventory';
import { formatQty } from '@/lib/num';
import { rebuildAction } from './actions';

export default async function DebugPage({ searchParams }: { searchParams: Promise<{ rebuilt?: string }> }) {
  await requireRole('admin');
  const { rebuilt } = await searchParams;
  const rows = ledgerCheck(getDb());
  const bad = rows.filter((r) => !r.match);
  return (
    <>
      <PageHeader title="Ledger check" description="Compares each item's cached qty with the sum of its movements." />
      {rebuilt !== undefined && <p role="status" className="mb-4 text-sm">Rebuild finished: {Number(rebuilt) || 0} item(s) corrected.</p>}
      {bad.length === 0 ? (
        <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          All items match the ledger. ({rows.length} items checked)
        </p>
      ) : (
        <div className="mb-4 overflow-x-auto rounded-md border border-red-300">
          <Table>
            <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Cached</TableHead><TableHead className="text-right">Ledger</TableHead></TableRow></TableHeader>
            <TableBody>
              {bad.map((r) => (
                <TableRow key={r.itemId}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell><TableCell>{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.cached)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.ledger)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <form action={rebuildAction}>
        <Button type="submit" variant="outline">Recompute cached qty from ledger</Button>
      </form>
    </>
  );
}
