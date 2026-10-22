import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { financeCheck } from '@/lib/finance-reports';
import { ledgerCheck } from '@/lib/inventory';
import { formatPeso, formatQty } from '@/lib/num';
import { rebuildAction } from './actions';

export default async function DebugPage({ searchParams }: { searchParams: Promise<{ rebuilt?: string }> }) {
  await requireRole('admin');
  const { rebuilt } = await searchParams;
  const db = getDb();
  const rows = ledgerCheck(db);
  const bad = rows.filter((r) => !r.match);
  const fin = financeCheck(db);
  const stockMatch = Math.abs(fin.stockValue - fin.inventoryGl) <= Math.max(0.05, 0.05 * rows.length);
  return (
    <>
      <PageHeader title="Ledger check" description="Three checks: cached qty vs movements, stock value vs the Inventory account, and every journal entry balancing." />
      {rebuilt !== undefined && <p role="status" className="mb-4 text-sm">Rebuild finished: {Number(rebuilt) || 0} item(s) corrected.</p>}
      <div className="mb-4 space-y-2">
        <p className={stockMatch ? 'rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900' : 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900'}>
          {stockMatch ? 'Stock value matches the Inventory account.' : 'Stock value and the Inventory account differ.'}{' '}
          Stock on hand {formatPeso(fin.stockValue)} · Inventory account {formatPeso(fin.inventoryGl)}.
          {!stockMatch && ' A difference usually means stock was changed outside a sale, purchase or count (e.g. a rebuild below); post an adjusting count to realign.'}
        </p>
        <p className={fin.unbalancedEntries.length === 0 ? 'rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900' : 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900'}>
          {fin.unbalancedEntries.length === 0 ? 'Every journal entry balances.' : `Unbalanced journal entries: ${fin.unbalancedEntries.join(', ')}.`}
        </p>
      </div>
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
