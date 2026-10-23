import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProspectsView } from '@/components/prospects/prospects-view';

export const metadata: Metadata = { title: 'Prospects' };

export default function ProspectsPage() {
  return (
    <Suspense>
      <ProspectsView />
    </Suspense>
  );
}
