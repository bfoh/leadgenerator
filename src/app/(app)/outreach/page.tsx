import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OutreachWorkspace } from '@/components/outreach/outreach-workspace';
import { PageSkeleton } from '@/components/ui/misc';

export const metadata: Metadata = { title: 'Outreach' };

export default function OutreachPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OutreachWorkspace />
    </Suspense>
  );
}
