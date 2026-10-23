import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProfileView } from '@/components/prospects/profile/profile-view';

export const metadata: Metadata = { title: 'Prospect' };

export default async function ProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ProfileView id={id} />
    </Suspense>
  );
}
