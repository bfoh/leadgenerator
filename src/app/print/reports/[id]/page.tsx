import type { Metadata } from 'next';
import { ReportPrint } from './report-print';

export const metadata: Metadata = { title: 'Report (print)' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportPrint id={id} />;
}
