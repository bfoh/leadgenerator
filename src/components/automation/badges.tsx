import { JOB_STATUS_META, RUN_STATUS_META, WORKFLOW_GROUP_LABELS, WORKFLOW_META, type JobStatus, type RunStatus, type WorkflowState } from '@/lib/automation/constants';
import { Badge } from '@/components/ui/badge';

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const meta = JOB_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const meta = RUN_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** The prospect's place in the automated workflow (separate from the CRM stage). */
export function WorkflowStateBadge({ state }: { state: WorkflowState }) {
  const meta = WORKFLOW_META[state];
  return (
    <Badge tone={meta.tone} title={`Workflow: ${WORKFLOW_GROUP_LABELS[meta.group]}`}>
      {meta.label}
    </Badge>
  );
}

export const usd = (v: number) => (v === 0 ? '$0' : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);

export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  if (value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) return null;
  return (
    <details className="rounded-md border border-border bg-surface-muted">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">{label}</summary>
      <pre className="max-h-72 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
