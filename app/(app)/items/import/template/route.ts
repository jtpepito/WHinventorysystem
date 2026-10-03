import { currentRole } from '@/lib/auth';
import { IMPORT_TEMPLATE } from '@/lib/import';

export async function GET() {
  if ((await currentRole()) !== 'admin') return new Response('Forbidden', { status: 403 });
  return new Response(IMPORT_TEMPLATE, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="inventory-import-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
