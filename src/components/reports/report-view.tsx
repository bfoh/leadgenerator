'use client';

import { AlertTriangle, ArrowLeft, Download, FileSignature, Pencil, Printer, Sparkles, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import * as svc from '@/lib/data/services';
import { reportToMarkdown, validateReport, type ReportDraft } from '@/lib/domain/report';
import type { Business, OpportunityReport } from '@/lib/domain/types';
import { download, formatDateTime, slug } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { useAction, useBusiness, useReports } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import { generateAiReport, generateRuleBasedReport } from './generate';
import { ReportDocument } from './report-document';
import { ReportEditor } from './report-editor';
import { GENERATOR_LABELS, GeneratorBadge } from './report-meta';

export function ReportView({ id }: { id: string }) {
  const { data: reports, isLoading } = useReports();
  const report = reports?.find((r) => r.id === id);
  const business = useBusiness(report?.businessId ?? '');
  if (isLoading || (report && business.isLoading)) return <PageSkeleton />;
  if (!report) return <EmptyState title="Report not found" action={<ButtonLink href="/reports">Back to reports</ButtonLink>} />;
  return <Loaded report={report} business={business.data ?? null} versions={(reports ?? []).filter((r) => r.businessId === report.businessId).sort((a, b) => b.version - a.version)} />;
}

function Loaded({ report, business, versions }: { report: OpportunityReport; business: Business | null; versions: OpportunityReport[] }) {
  const { can } = useWorkspace();
  const router = useRouter();
  const status = useServerStatus();
  const [editing, setEditing] = useState(false);
  const open = (r: OpportunityReport) => router.push(`/reports/${r.id}`);
  const saveEdit = useAction(
    (ctx, draft: ReportDraft) => {
      if (!business) throw new Error('The business for this report no longer exists.');
      const checked = validateReport(draft, report.inputSnapshot);
      return svc.saveReport(ctx, business, { content: checked.content, generator: 'manual_edit', model: null, pack: report.inputSnapshot, validation: checked.validation, usage: null });
    },
    { success: (r) => `Saved as version ${r.version}`, onSuccess: (r) => (setEditing(false), open(r)) },
  );
  const rule = useAction(generateRuleBasedReport, { success: (r) => `Report v${r.version} saved`, onSuccess: open });
  const ai = useAction(generateAiReport, { success: (r) => `AI report v${r.version} saved`, onSuccess: open });
  const latest = versions[0]?.id === report.id;
  const warnings = report.validation?.warnings ?? [];
  const dropped = report.validation?.droppedClaims ?? [];
  const aiReady = Boolean(status.data?.ai.configured && status.data.serverTools);

  const exportMd = () =>
    download(
      `report-${slug(report.inputSnapshot.business.name)}-v${report.version}.md`,
      reportToMarkdown(report.content, report.inputSnapshot, { version: report.version, generator: report.generator, createdAt: report.createdAt, model: report.model }),
      'text/markdown;charset=utf-8',
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={business ? `/prospects/${business.id}?tab=reports` : '/reports'} className="mb-2 inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden /> {business?.name ?? 'Reports'}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Report v{report.version}</h1>
            <GeneratorBadge report={report} />
            {!latest && <span className="text-xs text-warning">Older version</span>}
          </div>
          <p className="mt-0.5 text-xs text-subtle">
            {formatDateTime(report.createdAt)}
            {report.usage ? ` · ${report.usage.inputTokens + report.usage.outputTokens} tokens · est. $${report.usage.estimatedCostUsd.toFixed(4)}` : ''}
          </p>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {can('reports.write') && business && (
              <>
                <Button onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
                <Button onClick={() => rule.run(business)} loading={rule.pending}>
                  <Wand2 /> Regenerate
                </Button>
                {aiReady && (
                  <Button onClick={() => ai.run(business)} loading={ai.pending}>
                    <Sparkles /> AI regenerate
                  </Button>
                )}
              </>
            )}
            <Button onClick={exportMd}>
              <Download /> Markdown
            </Button>
            <ButtonLink href={`/print/reports/${report.id}`} external>
              <Printer /> Print / PDF
            </ButtonLink>
            {can('proposals.write') && business && (
              <ButtonLink href={`/prospects/${business.id}?tab=proposals`} variant="primary">
                <FileSignature /> Create proposal
              </ButtonLink>
            )}
          </div>
        )}
      </div>

      {warnings.length > 0 && (
        <Notice tone="warning" icon={AlertTriangle} title="Review before sharing" className="mb-4">
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Notice>
      )}
      {dropped.length > 0 && (
        <Notice tone="neutral" title={`${dropped.length} unsupported statement${dropped.length === 1 ? ' was' : 's were'} removed`} className="mb-4">
          Facts without valid citations were moved to limitations, and statements asserting things the evidence does not support were removed.
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs font-medium">Show what was removed</summary>
            <ul className="mt-1 list-disc pl-4 text-xs" data-testid="removed-statements">
              {dropped.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </details>
        </Notice>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_240px]">
        <Card className="p-5 sm:p-8">
          {editing ? (
            <ReportEditor initial={report.content} pack={report.inputSnapshot} pending={saveEdit.pending} onCancel={() => setEditing(false)} onSave={(c) => saveEdit.run(c)} />
          ) : (
            <ReportDocument content={report.content} pack={report.inputSnapshot} report={report} />
          )}
        </Card>
        <Card className="self-start p-3">
          <h2 className="px-1 pb-2 text-xs font-medium uppercase tracking-wide text-subtle">Versions</h2>
          <ul className="space-y-0.5">
            {versions.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/reports/${v.id}`}
                  aria-current={v.id === report.id ? 'page' : undefined}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover aria-[current=page]:bg-surface-hover aria-[current=page]:font-medium"
                >
                  <span>
                    v{v.version} <span className="text-xs font-normal text-subtle">{GENERATOR_LABELS[v.generator]}</span>
                  </span>
                  <span className="text-right text-xs text-subtle">
                    {formatDateTime(v.createdAt)}
                    {v.usage ? <span className="block tabular">${v.usage.estimatedCostUsd.toFixed(4)}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
