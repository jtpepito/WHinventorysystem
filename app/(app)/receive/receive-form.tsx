'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { PostAnywayButton } from '@/components/post-anyway-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPeso, formatQty, parseNumberInput } from '@/lib/num';
import { receiveAction } from './actions';

export type ItemOption = { id: number; sku: string; name: string; unit: string; qty: number; avgCost: number };
type Line = { key: number; itemId: string; qty: string; unitCost: string };

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: '', qty: '', unitCost: '' });

export function ReceiveForm({ items, suppliers }: { items: ItemOption[]; suppliers: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(receiveAction, null);
  const [supplierId, setSupplierId] = useState('');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  // Clear the slip after a successful post; keep the supplier for the next delivery.
  useEffect(() => {
    if (state?.ok) {
      setRefNo('');
      setNote('');
      setLines([blankLine()]);
    }
  }, [state]);

  const byId = new Map(items.map((i) => [String(i.id), i]));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineTotal = (l: Line) => {
    const q = parseNumberInput(l.qty);
    const c = parseNumberInput(l.unitCost);
    return q !== null && c !== null ? q * c : null;
  };
  const total = lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0);

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="supplierId">Supplier</Label>
          <NativeSelect id="supplierId" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="" disabled>Pick a supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="refNo">Reference no.</Label>
          <Input id="refNo" name="refNo" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="DR / invoice no." maxLength={60} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
      </div>

      <div className="space-y-3">
        {lines.map((l, idx) => {
          const n = idx + 1;
          const item = byId.get(l.itemId);
          const t = lineTotal(l);
          return (
            <div key={l.key} className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[1fr_8rem_9rem_8rem_auto]">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`item-${l.key}`} className="text-xs">Line {n} item</Label>
                <NativeSelect
                  id={`item-${l.key}`}
                  value={l.itemId}
                  onChange={(e) => {
                    const it = byId.get(e.target.value);
                    update(l.key, { itemId: e.target.value, unitCost: l.unitCost || (it && it.avgCost > 0 ? String(it.avgCost) : '') });
                  }}
                >
                  <option value="">Pick an item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
                </NativeSelect>
                {item && <p className="text-xs text-muted-foreground">On hand {formatQty(item.qty)} {item.unit} · avg {formatPeso(item.avgCost)}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`qty-${l.key}`} className="text-xs">Line {n} qty</Label>
                <Input id={`qty-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`cost-${l.key}`} className="text-xs">Line {n} unit cost</Label>
                <Input id={`cost-${l.key}`} inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
              </div>
              <p className="pb-2 text-right text-sm tabular-nums">{t === null ? '—' : formatPeso(t)}</p>
              <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                Remove
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ itemId, qty, unitCost }) => ({ itemId, qty, unitCost })))} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm">Total <span className="ml-2 text-lg font-semibold tabular-nums">{formatPeso(total)}</span></p>
        <div className="flex gap-2">
          {/* Main button first: Enter submits with the first submit button, and must not skip the warning. */}
          <Button type="submit" disabled={pending}>{pending ? 'Posting…' : 'Post receipt'}</Button>
          <PostAnywayButton state={state} refNo={refNo} pending={pending} />
        </div>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
