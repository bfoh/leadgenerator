import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsView } from '@/components/settings/settings-view';
import { PageSkeleton } from '@/components/ui/misc';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsView />
    </Suspense>
  );
}
