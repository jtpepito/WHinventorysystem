import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { getSale } from '@/lib/sales';
import { businessInfo, vatRegistered } from '@/lib/settings';
import { formatManila } from '@/lib/time';
import { PrintButton } from './print-button';

const METHOD: Record<string, string> = { cash: 'Cash', gcash: 'GCash', bank: 'Bank transfer', credit: 'Charge (on account)' };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const db = getDb();
  const sale = Number.isInteger(id) ? getSale(db, id) : null;
  if (!sale) notFound();
  const biz = businessInfo(db);
  const isVat = vatRegistered(db);
  return (
    <div className="mx-auto max-w-sm bg-white p-4 font-mono text-sm text-black print:max-w-none print:p-0">
      <div className="mb-3 text-center">
        <p className="text-base font-bold">{biz.name || 'Sales receipt'}</p>
        {biz.address && <p>{biz.address}</p>}
        {biz.tin && <p>TIN {biz.tin}{isVat ? ' · VAT Reg.' : ' · Non-VAT'}</p>}
      </div>
      <p>{sale.status === 'void' ? 'VOID — ' : ''}{sale.number}</p>
      <p>{formatManila(sale.createdAt)}</p>
      <p>Customer: {sale.customerName}</p>
      <p>Paid by: {METHOD[sale.method]}</p>
      <hr className="my-2 border-dashed border-black" />
      {sale.lines.map((l) => (
        <div key={l.id} className="mb-1">
          <div>{l.sku} {l.name}</div>
          <div className="flex justify-between"><span>{formatQty(l.qty)} {l.unit} × {formatPeso(l.unitPrice)}</span><span>{formatPeso(l.lineTotal)}</span></div>
        </div>
      ))}
      <hr className="my-2 border-dashed border-black" />
      {isVat && (
        <>
          <div className="flex justify-between"><span>VATable sales</span><span>{formatPeso(sale.subtotal)}</span></div>
          <div className="flex justify-between"><span>VAT 12%</span><span>{formatPeso(sale.vat)}</span></div>
        </>
      )}
      <div className="flex justify-between text-base font-bold"><span>TOTAL</span><span>{formatPeso(sale.total)}</span></div>
      {sale.method === 'credit' && <div className="flex justify-between"><span>Balance due</span><span>{formatPeso(sale.balance)}</span></div>}
      {isVat && <p className="mt-2 text-center text-xs">Prices are VAT-inclusive.</p>}
      {biz.receiptFooter && <p className="mt-2 text-center text-xs">{biz.receiptFooter}</p>}
      <p className="mt-1 text-center text-xs">Served by: {sale.actor}</p>
      <div className="mt-4 print:hidden"><PrintButton /></div>
    </div>
  );
}
