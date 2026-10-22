'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { PostAnywayButton } from '@/components/post-anyway-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vatSplit } from '@/lib/money';
import { formatPeso, formatQty, parseNumberInput } from '@/lib/num';
import { receiveAction } from './actions';

export type ItemOption = { id: number; sku: string; name: string; unit: string; qty: number; avgCost: number };
type Line = { key: number; itemId: string; qty: string; unitCost: string };

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: '', qty: '', unitCost: '' });

export function ReceiveForm({ items, suppliers, today, vatRegistered }: {
  items: ItemOption[]; suppliers: { id: number; name: string }[]; today: string; vatRegistered: boolean;
}) {
  const [state, action, pending] = useActionState(receiveAction, null);
  const [supplierId, setSupplierId] = useState('');
  const [refNo, setRefNo] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('cash');
  // Off by default: ticking it nets 12% off every cost typed below, which must be a deliberate choice.
  const [vatInvoice, setVatInvoice] = useState(false);
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
    return q !== null && c !== null ? Math.round(q * c * 100) / 100 : null;
  };
  const total = Math.round(lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0) * 100) / 100;
  const withVat = vatRegistered && vatInvoice;
  const { net, vat } = vatSplit(total, withVat);

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
          <Label htmlFor="refNo">Supplier invoice no.</Label>
          <Input id="refNo" name="refNo" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Invoice / DR no." maxLength={60} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="method">Payment method</Label>
          <NativeSelect id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="gcash">GCash</option>
            <option value="bank">Bank transfer</option>
            <option value="credit">On account (pay later)</option>
          </NativeSelect>
        </div>
        {vatRegistered && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="vatInvoice" checked={vatInvoice} onChange={(e) => setVatInvoice(e.target.checked)} /> VAT invoice
            <span className="text-xs text-muted-foreground">(costs below include 12% VAT)</span>
          </label>
        )}
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
                    const suggested = it && it.avgCost > 0 ? String(Math.round(it.avgCost * (withVat ? 1.12 : 1) * 100) / 100) : '';
                    update(l.key, { itemId: e.target.value, unitCost: l.unitCost || suggested });
                  }}
                >
                  <option value="">Pick an item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
                </NativeSelect>
                {item && <p className="text-xs text-muted-foreground">On hand {formatQty(item.qty)} {item.unit} · avg cost {formatPeso(item.avgCost)}</p>}
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
              <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ itemId, qty, unitCost }) => ({ itemId, qty, unitCost })))} />
      <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-4">
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          {withVat && (
            <>
              <dt className="text-muted-foreground">Goods (ex-VAT, into stock)</dt><dd className="text-right tabular-nums">{formatPeso(net)}</dd>
              <dt className="text-muted-foreground">Input VAT 12%</dt><dd className="text-right tabular-nums">{formatPeso(vat)}</dd>
            </>
          )}
          <dt className="font-semibold">Invoice total</dt><dd className="text-right text-lg font-semibold tabular-nums">{formatPeso(total)}</dd>
        </dl>
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
