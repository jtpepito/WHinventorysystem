import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPeso, formatSignedQty } from '@/lib/num';
import type { MovementRow } from '@/lib/queries';
import { formatManila } from '@/lib/time';
import { cn } from '@/lib/utils';

const TYPE_STYLE = { receive: 'bg-emerald-100 text-emerald-900', release: 'bg-sky-100 text-sky-900', adjust: 'bg-amber-100 text-amber-900' };

export function MovementTable({ rows, showItem = true }: { rows: MovementRow[]; showItem?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No movements match.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Type</TableHead>
            {showItem && <TableHead>Item</TableHead>}
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead>Ref</TableHead>
            <TableHead>Counterparty / note</TableHead>
            <TableHead>Who</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => (
            <TableRow key={m.id} data-testid="movement-row">
              <TableCell className="whitespace-nowrap">{formatManila(m.createdAt)}</TableCell>
              <TableCell><Badge className={cn('capitalize', TYPE_STYLE[m.type])}>{m.type}</Badge></TableCell>
              {showItem && (
                <TableCell>
                  <Link href={`/items/${m.itemId}`} className="hover:underline"><span className="font-mono text-xs">{m.sku}</span> {m.itemName}</Link>
                </TableCell>
              )}
              <TableCell className={cn('text-right font-medium tabular-nums', m.qtyDelta < 0 ? 'text-red-700' : 'text-emerald-700')}>
                {formatSignedQty(m.qtyDelta)} <span className="text-xs text-muted-foreground">{m.unit}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{m.unitCost === null ? '—' : formatPeso(m.unitCost)}</TableCell>
              <TableCell className="font-mono text-xs">{m.refNo}</TableCell>
              <TableCell>{m.counterparty}{m.note && <span className="block text-xs text-muted-foreground">{m.note}</span>}</TableCell>
              <TableCell className="capitalize">{m.actor}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
