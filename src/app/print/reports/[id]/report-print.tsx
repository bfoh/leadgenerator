'use client';

import { useReports } from '@/lib/workspace/hooks';
import { PrintToolbar } from '@/components/records/print-toolbar';
import { ReportDocument } from '@/components/reports/report-document';
import { PageSkeleton } from '@/components/ui/misc';

export function ReportPrint({ id }: { id: string }) {
  const { data: reports, isLoading } = useReports();
  const report = reports?.find((r) => r.id === id);
  if (isLoading) return <PageSkeleton />;
  if (!report) return <p>Report not found.</p>;
  return (
    <>
      <PrintToolbar note="Internal document. Review warnings and unknowns before sharing any part with the business." />
      <ReportDocument content={report.content} pack={report.inputSnapshot} report={report} />
    </>
  );
}
