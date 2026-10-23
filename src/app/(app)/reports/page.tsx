import type { Metadata } from 'next';
import { ReportsList } from '@/components/reports/reports-list';

export const metadata: Metadata = { title: 'Opportunity reports' };

export default function ReportsPage() {
  return <ReportsList />;
}
