import { Badge } from '@/components/ui/badge';

export function StockBadge({ active, low }: { active: boolean; low: boolean }) {
  if (!active) return <Badge variant="secondary">Inactive</Badge>;
  if (low) return <Badge className="bg-red-600 text-white">Low</Badge>;
  return <Badge variant="outline">OK</Badge>;
}
