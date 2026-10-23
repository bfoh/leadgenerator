'use client';

import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { AGENT_LIST } from '@/lib/automation/agents/catalog';
import { ERROR_KIND_LABELS, JOB_STATUS_META, JOB_STATUSES, OPEN_JOB_STATUSES, OUTBOUND_AGENTS, type AgentKey, type JobStatus } from '@/lib/automation/constants';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import { agentName, approveJob, cancelJob, retryJob, useAgentRuns, useAutomationAction, useJob, useJobs } from '@/lib/workspace/automation';
import { useBusinesses } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { DefinitionList, EmptyState, Notice, Skeleton } from '@/components/ui/misc';
import { JobStatusBadge, JsonBlock, RunStatusBadge, usd } from './badges';

export function JobsTab({ status, onStatus, live }: { status: JobStatus | null; onStatus: (status: JobStatus | null) => void; live: boolean }) {
  const [agent, setAgent] = useState<AgentKey | ''>('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: jobs, isLoading } = useJobs({ statuses: status ? [status] : undefined, agent: agent || undefined, limit: 200 }, live);
  const { data: businesses = [] } = useBusinesses();
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const chips: (JobStatus | null)[] = [null, ...JOB_STATUSES];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Filter jobs by status">
          {chips.map((s) => (
            <button
              key={s ?? 'all'}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => onStatus(s)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                status === s ? 'border-accent bg-accent-soft text-accent-strong' : 'border-border bg-surface text-muted hover:border-border-strong',
              )}
            >
              {s ? JOB_STATUS_META[s].label : 'All'}
            </button>
          ))}
        </div>
        <Field label="Agent" className="w-56">
          {(p) => (
            <Select {...p} value={agent} onChange={(e) => setAgent(e.target.value as AgentKey | '')}>
              <option value="">All agents</option>
              {AGENT_LIST.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <Skeleton className="m-4 h-40" />
        ) : !jobs?.length ? (
          <EmptyState icon={Inbox} title="No jobs" description={status ? `No ${JOB_STATUS_META[status].label.toLowerCase()} jobs.` : 'Queue research from the Overview tab or a prospect’s profile.'} />
        ) : (
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id}>
                <button type="button" onClick={() => setSelected(j.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-hover">
                  <JobStatusBadge status={j.status} />
                  <span className="text-sm font-medium">{agentName(j.agent)}</span>
                  <span className="order-last min-w-0 basis-full truncate text-sm text-muted sm:order-none sm:flex-1 sm:basis-0">
                    {j.businessId ? (names.get(j.businessId) ?? 'Deleted prospect') : 'Workspace'}
                    {j.lastError && j.status !== 'succeeded' ? ` · ${j.lastError}` : ''}
                  </span>
                  <span className="ml-auto text-xs tabular text-subtle sm:ml-0">
                    try {j.attempts}/{j.maxAttempts}
                  </span>
                  <span className="text-right text-xs text-subtle sm:w-24">{relativeTime(j.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {jobs && jobs.length >= 200 && <p className="text-xs text-subtle">Showing the 200 most recent jobs. Filter by status or agent to narrow the list.</p>}
      <JobInspector jobId={selected} onClose={() => setSelected(null)} names={names} live={live} />
    </div>
  );
}

function JobInspector({ jobId, onClose, names, live }: { jobId: string | null; onClose: () => void; names: Map<string, string>; live: boolean }) {
  const { can } = useWorkspace();
  const { data: job = null } = useJob(jobId, live);
  const { data: runs = [] } = useAgentRuns({ jobId: jobId ?? undefined }, Boolean(jobId), live);
  const { data: trace = [] } = useJobs({ traceId: job?.traceId, limit: 50 }, live, Boolean(job));
  const cancel = useAutomationAction(cancelJob, { success: (j) => (j.status === 'running' ? 'Cancellation requested; the job stops at its next checkpoint' : 'Job cancelled') });
  const retry = useAutomationAction(retryJob, { success: 'Job queued again' });
  const approve = useAutomationAction(approveJob, { success: 'Approved; the job is queued' });

  const outbound = job ? OUTBOUND_AGENTS.includes(job.agent) : false;
  const canCancel = job && OPEN_JOB_STATUSES.includes(job.status) && !job.cancelRequested && can('automation.run');
  const canRetry = job && ['failed', 'cancelled'].includes(job.status) && !outbound && can('automation.run');
  const canApprove = job && job.status === 'awaiting_approval' && can('automation.manage');

  return (
    <Dialog
      open={Boolean(jobId && job)}
      onOpenChange={(open) => !open && onClose()}
      side="right"
      size="lg"
      title={job ? agentName(job.agent) : 'Job'}
      description={job ? `Job ${job.id.slice(0, 8)} · queued ${formatDateTime(job.createdAt)}` : undefined}
      footer={
        job && (canCancel || canRetry || canApprove) ? (
          <>
            {canCancel && (
              <Button variant="outline-danger" loading={cancel.pending} onClick={() => void cancel.run(job.id)}>
                Cancel job
              </Button>
            )}
            {canRetry && (
              <Button loading={retry.pending} onClick={() => void retry.run(job.id)}>
                Retry from the start
              </Button>
            )}
            {canApprove && (
              <Button variant="primary" loading={approve.pending} onClick={() => void approve.run(job.id)}>
                Approve
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {job && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            {job.cancelRequested && job.status === 'running' && <span className="text-xs text-warning">Cancellation requested</span>}
          </div>
          {job.lastError && job.status !== 'succeeded' && (
            <Notice tone={job.status === 'failed' ? 'danger' : 'warning'} title={job.errorKind ? ERROR_KIND_LABELS[job.errorKind] : 'Last error'}>
              {job.lastError}
            </Notice>
          )}
          {outbound && job.status === 'failed' && (
            <Notice tone="warning">Outbound jobs are never re-sent from the queue. Check the message’s delivery status before doing anything else.</Notice>
          )}
          <DefinitionList
            items={[
              {
                label: 'Prospect',
                value: job.businessId ? (
                  names.get(job.businessId) ? (
                    <Link href={`/prospects/${job.businessId}?tab=activity`} className="underline">
                      {names.get(job.businessId)}
                    </Link>
                  ) : (
                    'Deleted prospect'
                  )
                ) : (
                  'Whole workspace'
                ),
              },
              { label: 'Attempts', value: `${job.attempts} of ${job.maxAttempts}` },
              { label: 'Run after', value: formatDateTime(job.runAfter) },
              { label: 'Started', value: job.startedAt ? formatDateTime(job.startedAt) : 'Not yet' },
              { label: 'Finished', value: job.finishedAt ? formatDateTime(job.finishedAt) : 'Not yet' },
              { label: 'Estimated cost', value: usd(job.estimatedCostUsd) },
              { label: 'Priority', value: String(job.priority) },
              { label: 'Worker', value: job.worker ?? runs[0]?.worker ?? '—' },
              { label: 'Approved', value: job.approvedAt ? formatDateTime(job.approvedAt) : 'Not required' },
              { label: 'Trace', value: <code className="font-mono text-xs">{job.traceId.slice(0, 8)}</code> },
            ]}
          />
          <section>
            <h3 className="mb-2 text-sm font-semibold">Runs</h3>
            {runs.length === 0 ? (
              <p className="text-sm text-subtle">No runs recorded for this job yet.</p>
            ) : (
              <ul className="space-y-2">
                {runs.map((r) => (
                  <li key={r.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <RunStatusBadge status={r.status} />
                      <span className="text-xs text-subtle">
                        {formatDateTime(r.startedAt)} · {(r.durationMs / 1000).toFixed(1)} s{r.estimatedCostUsd ? ` · ${usd(r.estimatedCostUsd)}` : ''}
                        {r.model ? ` · ${r.model}` : ''}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{r.summary}</p>
                    {r.decision && <p className="text-xs text-muted">Decision: {r.decision}</p>}
                    {r.error && <p className="text-xs text-danger">{r.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {trace.length > 1 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Pipeline</h3>
              <ol className="space-y-1.5">
                {[...trace].reverse().map((t) => (
                  <li key={t.id} className={cn('flex items-center gap-2 text-sm', t.id === job.id && 'font-medium')}>
                    <JobStatusBadge status={t.status} />
                    {agentName(t.agent)}
                    {t.id === job.id && <span className="text-xs text-subtle">(this job)</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="space-y-2">
            <JsonBlock label="Input" value={job.payload} />
            <JsonBlock label="Result" value={job.result} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
