'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ImportPlan } from '@/lib/import';
import { formatPeso, formatQty } from '@/lib/num';
import { cn } from '@/lib/utils';
import { importAction, previewImportAction } from './actions';

const OK_ROWS_SHOWN = 200;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Summary({ plan }: { plan: ImportPlan }) {
  const created = [
    plan.newCategories.length ? `New ${plan.newCategories.length === 1 ? 'category' : 'categories'}: ${plan.newCategories.join(', ')}` : '',
    plan.newUnits.length ? `New ${plan.newUnits.length === 1 ? 'unit' : 'units'}: ${plan.newUnits.join(', ')}` : '',
  ].filter(Boolean);
  return (
    <div
      data-testid="import-summary"
      className={cn('space-y-1 rounded-md border px-3 py-2 text-sm', plan.errorCount ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900')}
    >
      {plan.errorCount ? (
        <p>
          <strong>{plural(plan.errorCount, 'row has', 'rows have')} problems.</strong> Fix them in your sheet, save it as CSV again and preview it. Nothing has been imported.
          {plan.okCount > 0 && ` (${plural(plan.okCount, 'other row is', 'other rows are')} fine.)`}
        </p>
      ) : (
        <p>
          <strong>{plural(plan.okCount, 'item')} ready to import.</strong>{' '}
          {plan.stockedCount
            ? `Opening stock for ${plural(plan.stockedCount, 'item')}, worth ${formatPeso(plan.stockValue)}, will be posted as one receipt dated today.`
            : 'No opening stock in this file; items start at 0 on hand.'}
        </p>
      )}
      {created.map((c) => <p key={c}>{c} (will be created — check for typos)</p>)}
    </div>
  );
}

function PreviewTable({ plan }: { plan: ImportPlan }) {
  const problems = plan.rows.filter((r) => r.errors.length);
  const ok = plan.rows.filter((r) => !r.errors.length);
  const shown = [...problems, ...ok.slice(0, OK_ROWS_SHOWN)];
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Row</TableHead><TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead>
            <TableHead className="text-right">Qty on hand</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Reorder pt</TableHead><TableHead>Check</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r) => (
            <TableRow key={r.row} className={cn(r.errors.length && 'bg-red-50/60')}>
              <TableCell className="tabular-nums">{r.row}</TableCell>
              <TableCell className="font-mono text-xs">{r.sku}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell>{r.category}</TableCell>
              <TableCell>{r.unit}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQty(r.qty)}</TableCell>
              <TableCell className="text-right tabular-nums">{r.unitCost === null ? '—' : formatPeso(r.unitCost)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatQty(r.reorderPoint)}</TableCell>
              <TableCell className={r.errors.length ? 'text-red-800' : 'text-emerald-700'}>
                {r.errors.length ? r.errors.map((e) => <span key={e} className="block">{e}</span>) : 'OK'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {ok.length > OK_ROWS_SHOWN && <p className="px-3 py-2 text-xs text-muted-foreground">…and {ok.length - OK_ROWS_SHOWN} more rows that are OK.</p>}
    </div>
  );
}

export function ImportForm() {
  const [preview, previewAction, previewing] = useActionState(previewImportAction, null);
  const [result, importFormAction, importing] = useActionState(importAction, null);
  const plan = preview && 'plan' in preview ? preview.plan : null;
  const ready = plan && plan.fileErrors.length === 0 && plan.errorCount === 0 && plan.okCount > 0;

  return (
    <div className="space-y-6">
      <form action={previewAction} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="file">CSV file</Label>
          <input
            id="file" name="file" type="file" accept=".csv,text/csv" required
            className="block text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
        <Button type="submit" disabled={previewing}>{previewing ? 'Checking…' : 'Preview'}</Button>
      </form>

      {preview && 'error' in preview && <FormMessage state={{ ok: false, error: preview.error }} />}
      {plan && plan.fileErrors.length > 0 && <FormMessage state={{ ok: false, error: plan.fileErrors.join(' ') }} />}

      {plan && plan.fileErrors.length === 0 && preview && 'fileName' in preview && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Preview of {preview.fileName}</h2>
          <Summary plan={plan} />
          {ready && (
            <form action={importFormAction} className="flex items-center gap-3">
              <input type="hidden" name="csv" value={preview.text} />
              <Button type="submit" disabled={importing}>{importing ? 'Importing…' : `Import ${plural(plan.okCount, 'item')}`}</Button>
              <span className="text-xs text-muted-foreground">All rows are saved together, or none are.</span>
            </form>
          )}
          <FormMessage state={result} />
          <PreviewTable plan={plan} />
        </section>
      )}
    </div>
  );
}
