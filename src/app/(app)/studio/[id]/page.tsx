import type { Metadata } from 'next';
import { StudioConceptView } from '@/components/studio/studio-concept';

export const metadata: Metadata = { title: 'Website concept' };

export default async function StudioConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudioConceptView id={id} />;
}
