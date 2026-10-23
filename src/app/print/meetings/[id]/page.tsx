import type { Metadata } from 'next';
import { MeetingPrint } from './meeting-print';

export const metadata: Metadata = { title: 'Meeting brief (print)' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingPrint businessId={id} />;
}
