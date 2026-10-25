'use client';

import { Palette } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { INTELLIGENCE_META, PROJECT_STATUS_META, STUDIO_PROJECT_STATUSES, type StudioProjectStatus } from '@/lib/domain/studio';
import { formatDate } from '@/lib/utils';
import { useBusinesses, useStudioProjects, useStudioSchema } from '@/lib/workspace/hooks';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui/misc';

export function StudioList() {
  const schema = useStudioSchema();
  const { data: projects, isLoading } = useStudioProjects();
  const { data: businesses = [] } = useBusinesses();
  const [status, setStatus] = useState<StudioProjectStatus | ''>('');
  const names = useMemo(() => new Map(businesses.map((b) => [b.id, b.name])), [businesses]);

  if (isLoading) return <PageSkeleton />;
  const rows = (projects ?? []).filter((p) => !status || p.status === status);

  return (
    <>
      <PageHeader
        eyebrow="Studio"
        title="Website concepts"
        description="One concept per prospect, built only from what a page shows. Facts, gaps, placeholders, our suggestions and restricted references stay apart on purpose."
        actions={
          <ButtonLink href="/prospects" variant="primary">
            <Palette className="size-4" aria-hidden /> Start from a prospect
          </ButtonLink>
        }
      />
      {schema.data === false && (
        <Notice tone="warning" className="mb-4" title="Database migration required">
          Apply migration 012 (supabase/migrations/012_studio_brand_intelligence.sql) to store concepts and their evidence. Until then this page stays empty.
        </Notice>
      )}
      {rows.length > 0 && (
        <div className="mb-3">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StudioProjectStatus | '')} className="w-auto">
            <option value="">All statuses</option>
            {STUDIO_PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={Palette}
            title={projects?.length ? 'No concepts with this status' : 'No website concepts yet'}
            description="Open a prospect and choose “Create website concept”. The Studio reads that business's homepage once and records what it can and cannot tell you."
            action={<ButtonLink href="/prospects">Go to prospects</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-surface-muted/60 text-left text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Concept</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Evidence</th>
                  <th scope="col" className="px-4 py-2 font-medium">Last analysis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((project) => (
                  <tr key={project.id} className="hover:bg-surface-hover/60">
                    <td className="max-w-sm px-4 py-2.5">
                      <Link href={`/studio/${project.id}`} className="block truncate font-medium hover:underline">
                        {project.name}
                      </Link>
                      <span className="text-xs text-subtle">{names.get(project.businessId) ?? 'Deleted prospect'}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={PROJECT_STATUS_META[project.status].tone}>{PROJECT_STATUS_META[project.status].label}</Badge>
                    </td>
                    <td className="max-w-xs px-4 py-2.5">
                      <Badge tone={INTELLIGENCE_META[project.intelligenceStatus].tone}>{INTELLIGENCE_META[project.intelligenceStatus].label}</Badge>
                      {project.intelligenceNote && <span className="mt-1 block truncate text-xs text-subtle">{project.intelligenceNote}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-subtle">{project.intelligenceAt ? formatDate(project.intelligenceAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
