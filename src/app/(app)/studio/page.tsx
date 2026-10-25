import type { Metadata } from 'next';
import { StudioList } from '@/components/studio/studio-list';

export const metadata: Metadata = { title: 'Website concepts' };

export default function StudioPage() {
  return <StudioList />;
}
