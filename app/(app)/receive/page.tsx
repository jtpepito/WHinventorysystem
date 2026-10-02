import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { ReceiveForm } from './receive-form';

export default async function ReceivePage() {
  await requireRole('admin', 'encoder');
  const db = getDb();
  const items = listItems(db, { status: 'active' }).map(({ id, sku, name, unit, qty, avgCost }) => ({ id, sku, name, unit, qty, avgCost }));
  return (
    <>
      <PageHeader title="Receive stock" description="Posting adds to on-hand qty and updates the weighted-average cost." />
      <ReceiveForm items={items} suppliers={listSuppliers(db).map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
