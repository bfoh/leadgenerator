import type { Metadata } from 'next';
import { ResourceCollector } from '@/components/resources/resource-collector';
export const metadata: Metadata = { title: 'Business resources' };
export default async function ResourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResourceCollector key={id} id={id} />;
}
