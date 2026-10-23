'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PrintToolbar({ note }: { note?: string }) {
  return (
    <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
      <p className="text-xs text-subtle">{note ?? 'Use your browser’s print dialog and choose “Save as PDF”.'}</p>
      <Button variant="primary" onClick={() => window.print()}>
        <Printer /> Print / Save as PDF
      </Button>
    </div>
  );
}
