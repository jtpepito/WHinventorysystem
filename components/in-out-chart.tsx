'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { DayFlow } from '@/lib/dashboard';

// Explicit hues: the neutral theme's --chart-1/2 are two greys, too close to tell in from out.
const config = {
  inValue: { label: 'Received (₱)', color: '#059669' },
  outValue: { label: 'Released (₱)', color: '#0284c7' },
} satisfies ChartConfig;

export function InOutChart({ data }: { data: DayFlow[] }) {
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis width={80} tickLine={false} axisLine={false} tickFormatter={(v) => `₱${Number(v).toLocaleString('en-PH')}`} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="inValue" fill="var(--color-inValue)" radius={4} />
        <Bar dataKey="outValue" fill="var(--color-outValue)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
