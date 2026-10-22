'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPeso } from '@/lib/num';
import { saveSellPricesAction } from './actions';

type Row = { id: number; sku: string; name: string; categoryId: number; unit: string; avgCost: number; sellPrice: number };

// Edits are overrides on the saved values; a successful save clears them so the page shows the new baseline.
export function SellPriceEditor({ rows, categories }: { rows: Row[]; categories: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(async (prev: Parameters<typeof saveSellPricesAction>[0], fd: FormData) => {
    const result = await saveSellPricesAction(prev, fd);
    if (result?.ok) setEdits({});
    return result;
  }, null);
  const [category, setCategory] = useState('');
  const [edits, setEdits] = useState<Record<number, string>>({});
  const valueOf = (r: Row) => edits[r.id] ?? String(r.sellPrice);
  const visible = rows.filter((r) => !category || String(r.categoryId) === category);
  const changed = rows.filter((r) => valueOf(r) !== String(r.sellPrice)).map((r) => ({ itemId: r.id, sku: r.sku, sellPrice: valueOf(r) }));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Selling prices</CardTitle>
          <CardDescription>VAT-inclusive. The sale form fills these in; the cashier can still change a line&rsquo;s price.</CardDescription>
        </div>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-48" aria-label="Show category for prices">
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
                <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Avg cost</TableHead><TableHead className="w-36">Sell price</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(r.avgCost)}</TableCell>
                    <TableCell>
                      <Input aria-label={`Sell price for ${r.sku}`} inputMode="decimal" value={valueOf(r)} onChange={(e) => setEdits((v) => ({ ...v, [r.id]: e.target.value }))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <FormMessage state={state} />
          <Button type="submit" disabled={pending || changed.length === 0}>{pending ? 'Saving…' : `Save ${changed.length} price(s)`}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
