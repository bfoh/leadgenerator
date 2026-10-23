import type { Metadata } from 'next';
import { ReportView } from '@/components/reports/report-view';

export const metadata: Metadata = { title: 'Opportunity report' };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportView id={id} />;
}
