import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { MAX_IMPORT_ROWS } from '@/lib/import';
import { ImportForm } from './import-form';

export default async function ImportItemsPage() {
  await requireRole('admin');
  return (
    <>
      <PageHeader title="Import items from CSV" description="Add many items at once, with their opening stock." />
      <div className="mb-6 max-w-3xl space-y-2 text-sm">
        <p>
          In Excel, save your stock list with <strong>File → Save As → CSV UTF-8</strong>. The first row must be headings.{' '}
          {/* Plain link: a route that downloads a file, not a page. */}
          <a href="/items/import/template" download className="underline">Download the template</a> to start from the right layout.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><strong>Required:</strong> SKU, Name, Category, Unit. <strong>Optional:</strong> Reorder point, Qty on hand, Unit cost (needed when there is stock).</li>
          <li>New categories and units are created; existing ones are matched regardless of capital letters.</li>
          <li>Only new SKUs can be imported. Rows whose SKU already exists are flagged.</li>
          <li>Opening stock is posted as one receipt dated today (reference OPENING-date, supplier &ldquo;Opening balance&rdquo;), which also sets each item&rsquo;s average cost.</li>
          <li>Up to {MAX_IMPORT_ROWS.toLocaleString('en-PH')} rows per file. Preview first: nothing is saved until you click Import.</li>
        </ul>
      </div>
      <ImportForm />
    </>
  );
}
