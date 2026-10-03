'use client';

import { Button } from '@/components/ui/button';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Nothing was saved. Try again; if it keeps happening, note what you clicked and tell the admin.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
