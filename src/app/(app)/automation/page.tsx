import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AutomationCenter } from '@/components/automation/automation-center';
import { PageSkeleton } from '@/components/ui/misc';

export const metadata: Metadata = { title: 'Automation Center' };

export default function AutomationPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AutomationCenter />
    </Suspense>
  );
}
