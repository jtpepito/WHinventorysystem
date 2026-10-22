'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPeso, parseNumberInput } from '@/lib/num';
import { postJournalAction } from '../../actions';

type Line = { key: number; account: string; debit: string; credit: string };
let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, account: '', debit: '', credit: '' });

export function JournalForm({ accounts, today }: { accounts: { code: string; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState(postJournalAction, null);
  const [lines, setLines] = useState<Line[]>(() => [blank(), blank()]);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sum = (k: 'debit' | 'credit') => Math.round(lines.reduce((s, l) => s + (parseNumberInput(l[k]) ?? 0), 0) * 100) / 100;
  const dr = sum('debit');
  const cr = sum('credit');
  const balanced = dr > 0 && Math.abs(dr - cr) < 0.005;
  return (
    <form action={action} className="max-w-3xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-2"><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" defaultValue={today} max={today} required /></div>
        <div className="space-y-2"><Label htmlFor="memo">Memo</Label><Input id="memo" name="memo" required maxLength={200} placeholder="What this entry is for" /></div>
      </div>
      <div className="space-y-2">
        {lines.map((l, idx) => (
          <div key={l.key} className="grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor={`acc-${l.key}`} className="text-xs">Line {idx + 1} account</Label>
              <NativeSelect id={`acc-${l.key}`} value={l.account} onChange={(e) => update(l.key, { account: e.target.value })}>
                <option value="">Pick an account…</option>
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1"><Label htmlFor={`dr-${l.key}`} className="text-xs">Line {idx + 1} debit</Label><Input id={`dr-${l.key}`} inputMode="decimal" value={l.debit} onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></div>
            <div className="space-y-1"><Label htmlFor={`cr-${l.key}`} className="text-xs">Line {idx + 1} credit</Label><Input id={`cr-${l.key}`} inputMode="decimal" value={l.credit} onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></div>
            <Button type="button" variant="ghost" size="sm" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}>Add line</Button>
      </div>
      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ account, debit, credit }) => ({ account, debit, credit })))} />
      <p className={balanced ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>Debits {formatPeso(dr)} · Credits {formatPeso(cr)} {balanced ? '· balanced' : '· must be equal'}</p>
      <p className="text-xs text-muted-foreground">Receivables, Inventory and Payables can&rsquo;t be posted here; they move only through sales, purchases and payments.</p>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending || !balanced}>{pending ? 'Posting…' : 'Post entry'}</Button>
    </form>
  );
}
