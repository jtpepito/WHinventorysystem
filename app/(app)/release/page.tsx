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
      <PageHeader title="Release stock (not a sale)" description="For shop use, samples and write-offs: stock goes out at cost and is booked as shrinkage. Customer sales go through Sales." />
      <ReleaseForm items={items} />
    </>
  );
}
