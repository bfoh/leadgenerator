'use client';

import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { reportSummary } from '@/lib/domain/report';
import { formatDateTime } from '@/lib/utils';
import { useBusinesses, useReports } from '@/lib/workspace/hooks';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';
import { WebsiteStatusBadge } from '@/components/records/badges';
import { GeneratorBadge } from './report-meta';

export function ReportsList() {
  const { data: reports, isLoading } = useReports();
  const { data: businesses = [] } = useBusinesses();
  const [query, setQuery] = useState('');
  const byBusiness = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);

  const latest = useMemo(() => {
    const map = new Map<string, { latest: NonNullable<typeof reports>[number]; count: number }>();
    for (const r of reports ?? []) {
      const cur = map.get(r.businessId);
      if (!cur) map.set(r.businessId, { latest: r, count: 1 });
      else map.set(r.businessId, { latest: r.version > cur.latest.version ? r : cur.latest, count: cur.count + 1 });
    }
    return [...map.values()]
      .filter(({ latest }) => {
        const b = byBusiness.get(latest.businessId);
        return !query.trim() || (b?.name ?? '').toLowerCase().includes(query.trim().toLowerCase());
      })
      .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
  }, [reports, byBusiness, query]);

  if (isLoading) return <PageSkeleton />;

  return (
    <>
      <PageHeader title="Opportunity reports" description="Twelve-section, evidence-grounded assessments. Every statement is labelled as fact, finding, recommendation, assumption or unknown. Reports are written automatically once research is complete, or from a prospect’s profile." />
      <div className="mb-3">
        <Input aria-label="Search reports by business" placeholder="Search by business…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:w-72" />
      </div>
      <Card className="overflow-hidden">
        {latest.length === 0 ? (
          <EmptyState icon={FileText} title="No reports yet" description="Open a verified prospect and generate a report from its Reports tab." action={<ButtonLink href="/prospects">Go to prospects</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-border">
            {latest.map(({ latest: r, count }) => {
              const b = byBusiness.get(r.businessId);
              return (
                <li key={r.id}>
                  <Link href={`/reports/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-surface-hover/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{b?.name ?? 'Deleted business'}</p>
                      <p className="truncate text-xs text-subtle">{reportSummary(r.content)}</p>
                    </div>
                    {b && <WebsiteStatusBadge status={b.websiteStatus} />}
                    <GeneratorBadge report={r} />
                    {(r.validation?.warnings.length ?? 0) > 0 && <Badge tone="warning">Needs review</Badge>}
                    <span className="w-36 text-right text-xs text-subtle">
                      v{r.version}
                      {count > 1 ? ` of ${count}` : ''} · {formatDateTime(r.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
