'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vatSplit } from '@/lib/money';
import { formatPeso, formatQty, parseNumberInput } from '@/lib/num';
import { postSaleAction } from '../actions';

export type SaleItemOption = { id: number; sku: string; name: string; unit: string; qty: number; sellPrice: number };
type Line = { key: number; itemId: string; qty: string; unitPrice: string };
let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: '', qty: '1', unitPrice: '' });

export function SaleForm({ items, customers, today, vatRegistered }: {
  items: SaleItemOption[]; customers: { id: number; name: string }[]; today: string; vatRegistered: boolean;
}) {
  const [state, action, pending] = useActionState(postSaleAction, null);
  const [customerId, setCustomerId] = useState('');
  const [method, setMethod] = useState('cash');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  const byId = new Map(items.map((i) => [String(i.id), i]));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineTotal = (l: Line) => {
    const q = parseNumberInput(l.qty);
    const p = parseNumberInput(l.unitPrice);
    return q !== null && p !== null ? Math.round(q * p * 100) / 100 : null;
  };
  const total = Math.round(lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0) * 100) / 100;
  const { net, vat } = vatSplit(total, vatRegistered);
  const wanted = new Map<string, number>();
  for (const l of lines) {
    const q = parseNumberInput(l.qty);
    if (l.itemId && q !== null) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + q);
  }

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="customerId">Customer</Label>
          <NativeSelect id="customerId" name="customerId" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="method">Payment method</Label>
          <NativeSelect id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="gcash">GCash</option>
            <option value="bank">Bank transfer</option>
            <option value="credit">On account (pay later)</option>
          </NativeSelect>
          {method === 'credit' && !customerId && <p className="text-xs text-red-700">Pick a customer for an on-account sale.</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="note">Note</Label>
          <Input id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
      </div>

      <div className="space-y-3">
        {lines.map((l, idx) => {
          const n = idx + 1;
          const item = byId.get(l.itemId);
          const over = item !== undefined && (wanted.get(l.itemId) ?? 0) > item.qty;
          const t = lineTotal(l);
          return (
            <div key={l.key} className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[1fr_7rem_9rem_8rem_auto]">
              <div className="min-w-0 space-y-1">
                <Label htmlFor={`item-${l.key}`} className="text-xs">Line {n} item</Label>
                <NativeSelect
                  id={`item-${l.key}`}
                  value={l.itemId}
                  onChange={(e) => {
                    const it = byId.get(e.target.value);
                    update(l.key, { itemId: e.target.value, unitPrice: it ? String(it.sellPrice) : '' });
                  }}
                >
                  <option value="">Pick an item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
                </NativeSelect>
                {item && (
                  <p className={over ? 'text-xs font-medium text-red-700' : 'text-xs text-muted-foreground'}>
                    On hand {formatQty(item.qty)} {item.unit}{over && ' — not enough stock for this sale'}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`qty-${l.key}`} className="text-xs">Line {n} qty</Label>
                <Input id={`qty-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`price-${l.key}`} className="text-xs">Line {n} price</Label>
                <Input id={`price-${l.key}`} inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
              </div>
              <p className="pb-2 text-right text-sm tabular-nums">{t === null ? '—' : formatPeso(t)}</p>
              <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ itemId, qty, unitPrice }) => ({ itemId, qty, unitPrice })))} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          {vatRegistered && (
            <>
              <dt className="text-muted-foreground">Subtotal (ex-VAT)</dt><dd className="text-right tabular-nums">{formatPeso(net)}</dd>
              <dt className="text-muted-foreground">VAT 12%</dt><dd className="text-right tabular-nums">{formatPeso(vat)}</dd>
            </>
          )}
          <dt className="font-semibold">Total</dt><dd className="text-right text-lg font-semibold tabular-nums" data-testid="sale-total">{formatPeso(total)}</dd>
        </dl>
        <Button type="submit" disabled={pending}>{pending ? 'Posting…' : 'Post sale'}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
