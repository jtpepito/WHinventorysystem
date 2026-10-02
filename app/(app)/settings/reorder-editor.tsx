'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatQty } from '@/lib/num';
import { saveReorderPointsAction } from './actions';

type Row = { id: number; sku: string; name: string; categoryId: number; unit: string; qty: number; reorderPoint: number };

// Edits are kept as overrides on top of the saved values, so a refresh after saving shows the new baseline.
export function ReorderEditor({ rows, categories }: { rows: Row[]; categories: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof saveReorderPointsAction>[0], fd: FormData) => {
    const result = await saveReorderPointsAction(prev, fd);
    if (result?.ok) setEdits({});
    return result;
  }, null);
  const [category, setCategory] = useState('');
  const [edits, setEdits] = useState<Record<number, string>>({});

  const valueOf = (r: Row) => edits[r.id] ?? String(r.reorderPoint);
  const visible = rows.filter((r) => !category || String(r.categoryId) === category);
  const changed = rows.filter((r) => valueOf(r) !== String(r.reorderPoint)).map((r) => ({ itemId: r.id, sku: r.sku, reorderPoint: valueOf(r) }));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Reorder points</CardTitle>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-48" aria-label="Show category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="updates" value={JSON.stringify(changed)} />
          <div className="max-h-[28rem] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="w-32">Reorder point</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(r.qty)} {r.unit}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Reorder point for ${r.sku}`}
                        inputMode="decimal"
                        value={valueOf(r)}
                        onChange={(e) => setEdits((v) => ({ ...v, [r.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <FormMessage state={state} />
          <Button type="submit" disabled={pending || changed.length === 0}>
            {pending ? 'Saving…' : `Save ${changed.length} change(s)`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
