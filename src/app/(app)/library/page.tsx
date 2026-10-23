import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LibraryView } from '@/components/library/library-view';
import { PageSkeleton } from '@/components/ui/misc';

export const metadata: Metadata = { title: 'Solution library' };

export default function LibraryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LibraryView />
    </Suspense>
  );
}
