import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { getItem } from '@/lib/queries';
import { ItemForm } from '../../item-form';

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('admin');
  const db = getDb();
  const id = Number((await params).id);
  const item = Number.isInteger(id) ? getItem(db, id) : null;
  if (!item) notFound();
  return (
    <>
      <PageHeader title={`Edit ${item.sku}`} />
      <ItemForm
        initial={{ id: item.id, sku: item.sku, name: item.name, categoryId: String(item.categoryId), unitId: String(item.unitId), reorderPoint: String(item.reorderPoint), active: item.active }}
        categories={listNamed(db, 'categories')}
        units={listNamed(db, 'units')}
      />
    </>
  );
}
