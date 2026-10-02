'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatQty, parseNumberInput } from '@/lib/num';
import type { ItemOption } from '../receive/receive-form';
import { releaseAction } from './actions';

type Line = { key: number; itemId: string; qty: string };
let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: '', qty: '' });

export function ReleaseForm({ items }: { items: ItemOption[] }) {
  const [state, action, pending] = useActionState(releaseAction, null);
  const [counterparty, setCounterparty] = useState('');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  useEffect(() => {
    if (state?.ok) {
      setRefNo('');
      setNote('');
      setLines([blankLine()]);
    }
  }, [state]);

  const byId = new Map(items.map((i) => [String(i.id), i]));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const wanted = new Map<string, number>();
  for (const l of lines) {
    const q = parseNumberInput(l.qty);
    if (l.itemId && q !== null) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + q);
  }

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="counterparty">Destination / customer</Label>
          <Input id="counterparty" name="counterparty" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={120} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="refNo">Reference no.</Label>
          <Input id="refNo" name="refNo" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="DR / charge slip no." maxLength={60} required />
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
          const over = item !== undefined && (wanted.get(l.itemId) ?? 0) > item.qty;
          return (
            <div key={l.key} className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[1fr_8rem_auto]">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`item-${l.key}`} className="text-xs">Line {n} item</Label>
                <NativeSelect id={`item-${l.key}`} value={l.itemId} onChange={(e) => update(l.key, { itemId: e.target.value })}>
                  <option value="">Pick an item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
                </NativeSelect>
                {item && (
                  <p className={over ? 'text-xs font-medium text-red-700' : 'text-xs text-muted-foreground'}>
                    On hand {formatQty(item.qty)} {item.unit}{over && ' — this release asks for more than that'}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`qty-${l.key}`} className="text-xs">Line {n} qty</Label>
                <Input id={`qty-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                Remove
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ itemId, qty }) => ({ itemId, qty })))} />
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={pending}>{pending ? 'Posting…' : 'Post release'}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
