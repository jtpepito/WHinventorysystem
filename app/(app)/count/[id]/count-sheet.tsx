'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CountLineView } from '@/lib/count';
import { formatQty, formatSignedQty, parseNumberInput, round } from '@/lib/num';
import { cn } from '@/lib/utils';
import { countAction } from '../actions';

export function CountSheet({ sessionId, lines }: { sessionId: number; lines: CountLineView[] }) {
  const [state, action, pending] = useActionState(countAction, null);
  const [actuals, setActuals] = useState<Record<number, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.lineId, l.actual === null ? '' : String(l.actual)])),
  );
  const payload = lines.map((l) => ({ lineId: l.lineId, actual: actuals[l.lineId] ?? '', label: l.sku }));
  const counted = payload.filter((p) => p.actual.trim() !== '').length;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="actuals" value={JSON.stringify(payload)} />
      <p className="text-sm text-muted-foreground">{counted} of {lines.length} counted. Leave a row blank to skip it.</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="w-36">Actual</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const raw = actuals[l.lineId] ?? '';
              const a = raw.trim() === '' ? null : parseNumberInput(raw);
              const variance = a === null ? null : round(a - l.expected, 3);
              const moved = Math.abs(l.currentQty - l.expected) > 1e-9;
              return (
                <TableRow key={l.lineId} className={cn(moved && 'bg-amber-50')}>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>
                    {l.name}
                    {moved && <span className="block text-xs text-amber-800">Stock moved since start (now {formatQty(l.currentQty)}). Refresh expected.</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(l.expected)} {l.unit}</TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Actual for ${l.sku}`}
                      inputMode="decimal"
                      value={raw}
                      onChange={(e) => setActuals((cur) => ({ ...cur, [l.lineId]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', variance !== null && variance < 0 && 'text-red-700', variance !== null && variance > 0 && 'text-emerald-700')}>
                    {variance === null ? '—' : formatSignedQty(variance)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" variant="outline" disabled={pending}>Save progress</Button>
        <Button type="submit" name="intent" value="refresh" variant="outline" disabled={pending}>Refresh expected</Button>
        <Button
          type="submit"
          name="intent"
          value="post"
          disabled={pending}
          onClick={(e) => {
            if (!confirm('Post this count? Variances become adjustments and cannot be edited.')) e.preventDefault();
          }}
        >
          Post count
        </Button>
      </div>
    </form>
  );
}
