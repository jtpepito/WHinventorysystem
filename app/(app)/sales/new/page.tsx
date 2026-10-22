import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { vatRegistered } from '@/lib/settings';
import { manilaDay, nowIso } from '@/lib/time';
import { SaleForm } from './sale-form';

export default async function NewSalePage() {
  await requireRole('admin', 'encoder');
  const db = getDb();
  const items = listItems(db, { status: 'active' }).map(({ id, sku, name, unit, qty, sellPrice }) => ({ id, sku, name, unit, qty, sellPrice }));
  const customers = listCustomers(db, { activeOnly: true }).map(({ id, name }) => ({ id, name }));
  return (
    <>
      <PageHeader title="New sale" description="Posting takes the items off the shelf and books the sale." />
      <SaleForm items={items} customers={customers} today={manilaDay(nowIso())} vatRegistered={vatRegistered(db)} />
    </>
  );
}
