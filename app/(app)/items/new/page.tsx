import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { ItemForm } from '../item-form';

export default async function NewItemPage() {
  await requireRole('admin');
  const db = getDb();
  return (
    <>
      <PageHeader title="New item" />
      <ItemForm
        initial={{ sku: '', name: '', categoryId: '', unitId: '', reorderPoint: '0', active: true }}
        categories={listNamed(db, 'categories')}
        units={listNamed(db, 'units')}
      />
    </>
  );
}
