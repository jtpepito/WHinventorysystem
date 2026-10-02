import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { ReleaseForm } from './release-form';

export default async function ReleasePage() {
  await requireRole('admin', 'encoder');
  const items = listItems(getDb(), { status: 'active' }).map(({ id, sku, name, unit, qty, avgCost }) => ({ id, sku, name, unit, qty, avgCost }));
  return (
    <>
      <PageHeader title="Release stock" description="Posting subtracts from on-hand qty. You can't release more than is on hand." />
      <ReleaseForm items={items} />
    </>
  );
}
