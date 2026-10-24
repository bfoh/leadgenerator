'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Pause, Pencil, Play, Square, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CAMPAIGN_STATUS_META,
  TARGET_STATE_META,
  campaignPhase,
  campaignProgress,
  describeSchedule,
  describeScope,
  type CampaignStatus,
  type CampaignSummary,
} from '@/lib/domain/campaigns';
import { discoveryProgress } from '@/lib/domain/discovery-framework';
import { errorMessage, formatDateTime, relativeTime } from '@/lib/utils';
import { campaignApi, useCampaignDetail, useCampaignRefresh, type DiscoveryRecordView } from '@/lib/workspace/campaigns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { usd } from './badges';
import { CampaignForm } from './campaign-form';

export function CampaignCard({
  campaign,
  manage,
  canRun,
  open,
  onOpen,
}: {
  campaign: CampaignSummary;
  manage: boolean;
  canRun: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const refresh = useCampaignRefresh();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const progress = campaignProgress(campaign.counts);
  const found = discoveryProgress(campaign.discovery.discoveredTotal, campaign.discovery.totalLimit);
  const meta = CAMPAIGN_STATUS_META[campaign.status];
  const phase = campaignPhase(campaign, campaign.counts);
  const busy = campaign.counts.researching > 0 || campaign.counts.queued > 0;

  const change = useMutation({
    mutationFn: (body: { status?: CampaignStatus; pausedReason?: string | null }) => campaignApi.update(campaign.id, body),
    onSuccess: ({ campaign: updated }) => {
      refresh();
      toast.success(`Campaign is now ${CAMPAIGN_STATUS_META[updated.status].label.toLowerCase()}.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: () => campaignApi.run(campaign.id),
    onSuccess: ({ result }) => {
      refresh();
      if (result.status === 'failed') toast.error(result.note);
      else toast.success(result.note);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => campaignApi.remove(campaign.id),
    onSuccess: () => {
      refresh();
      toast.success('Campaign deleted.');
      setConfirmDelete(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{campaign.name}</h3>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
            {phase.phase !== campaign.status && <Badge tone={phase.tone}>{phase.label}</Badge>}
            {campaign.discovery.enabled ? (
              <Badge tone="info">Discovery · {campaign.providerKey}</Badge>
            ) : (
              <Badge tone="neutral">Tracked prospects</Badge>
            )}
          </div>
          <p className="text-xs text-subtle">
            {describeScope(campaign.scope)} · {describeSchedule(campaign.schedule)}
          </p>
          <p className="text-xs text-muted">{phase.description}</p>
          {campaign.description && <p className="max-w-3xl text-xs text-muted">{campaign.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRun && campaign.status === 'active' && (
            <Button size="sm" variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
              <Zap className="size-3.5" aria-hidden /> Run now
            </Button>
          )}
          {manage && campaign.status !== 'completed' && campaign.status !== 'cancelled' && (
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" aria-hidden /> Edit
            </Button>
          )}
          {manage && campaign.status === 'draft' && (
            <Button size="sm" variant="primary" loading={change.isPending} onClick={() => change.mutate({ status: 'active' })}>
              <Play className="size-3.5" aria-hidden /> Activate
            </Button>
          )}
          {manage && campaign.status === 'active' && (
            <>
              <Button size="sm" loading={change.isPending} onClick={() => change.mutate({ status: 'paused', pausedReason: 'Paused by a team member.' })}>
                <Pause className="size-3.5" aria-hidden /> Pause
              </Button>
              <Button size="sm" loading={change.isPending} onClick={() => change.mutate({ status: 'completed' })}>
                <Square className="size-3.5" aria-hidden /> Complete
              </Button>
            </>
          )}
          {manage && campaign.status === 'paused' && (
            <>
              <Button size="sm" variant="primary" loading={change.isPending} onClick={() => change.mutate({ status: 'active' })}>
                <Play className="size-3.5" aria-hidden /> Resume
              </Button>
              <Button size="sm" loading={change.isPending} onClick={() => change.mutate({ status: 'completed' })}>
                Complete
              </Button>
              <Button size="sm" variant="outline-danger" loading={change.isPending} onClick={() => change.mutate({ status: 'cancelled' })}>
                Cancel
              </Button>
            </>
          )}
          {manage && (campaign.status === 'draft' || campaign.status === 'cancelled') && (
            <Button size="sm" variant="outline-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" aria-hidden /> Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpen} aria-expanded={open}>
            {open ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
            {open ? 'Hide details' : 'Details'}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5 px-4 pb-3">
        <div className="flex items-center gap-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
            <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress.percent}%` }} />
          </span>
          <span className="shrink-0 text-xs tabular text-muted">
            {progress.done}/{progress.total} researched
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['queued', 'researching', 'researched', 'qualified', 'skipped', 'failed'] as const)
            .filter((state) => campaign.counts[state] > 0)
            .map((state) => (
              <Badge key={state} tone={TARGET_STATE_META[state].tone}>
                {campaign.counts[state]} {TARGET_STATE_META[state].label.toLowerCase()}
              </Badge>
            ))}
          {campaign.counts.total === 0 && <span className="text-xs text-subtle">No prospects started yet.</span>}
        </div>
        <p className="text-xs text-subtle">
          {campaign.nextRunAt
            ? `Next run ${formatDateTime(campaign.nextRunAt)}`
            : campaign.schedule.frequency === 'manual'
              ? 'Runs only when someone presses Run now'
              : 'No run scheduled'}
          {' · '}
          {campaign.lastRunAt ? `Last run ${relativeTime(campaign.lastRunAt)}` : 'Never run'}
          {campaign.monthlyBudgetUsd != null ? ` · ${usd(campaign.spendUsd)} of ${usd(campaign.monthlyBudgetUsd)} budget` : ` · ${usd(campaign.spendUsd)} recorded`}
        </p>
        {campaign.discovery.enabled && (
          <p className="text-xs text-subtle">
            {found.used} of {found.total} provider record(s) fetched · {campaign.discovery.exhausted ? 'provider exhausted' : 'more pages available'} ·{' '}
            {campaign.discovery.requireReview ? 'every import needs review' : 'high-confidence imports are automatic'}
          </p>
        )}
        {campaign.lastRunNote && <p className="text-xs text-muted">{campaign.lastRunNote}</p>}
        {campaign.pausedReason && campaign.status === 'paused' && <p className="text-xs text-warning">{campaign.pausedReason}</p>}
      </div>

      {open && <CampaignDetail campaign={campaign} manage={manage} />}

      <CampaignForm key={`${campaign.id}:${campaign.updatedAt}`} open={editing} onOpenChange={setEditing} campaign={campaign} busy={busy} />

      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this campaign?"
        description="Its membership history and run log are deleted with it. The prospects themselves, and any research already done, stay."
        size="sm"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete campaign
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Only a draft or cancelled campaign can be deleted. To stop one that is running, cancel it first; its history stays readable.
        </p>
      </Dialog>
    </Card>
  );
}

function CampaignDetail({ campaign, manage }: { campaign: CampaignSummary; manage: boolean }) {
  const { data, isLoading, error } = useCampaignDetail(campaign.id);
  if (isLoading) return <p className="border-t border-border px-4 py-3 text-sm text-subtle">Loading the campaign’s prospects and log…</p>;
  if (error) return <p className="border-t border-border px-4 py-3 text-sm text-danger">Could not load the campaign detail. {errorMessage(error)}</p>;
  if (!data) return null;

  const prospects = new Map(data.businesses.map((business) => [business.id, business]));
  const targets = data.targets.slice(0, 100);
  const runs = data.runs.slice(0, 10);
  const jobs = [...data.jobs].reverse().slice(0, 20);
  const pendingDiscovery = (data.discoveryRecords ?? []).filter((record) => record.status === 'pending_review');

  return (
    <div className="space-y-4 border-t border-border px-4 py-3">
      <section aria-labelledby={`campaign-targets-${campaign.id}`}>
        <h4 id={`campaign-targets-${campaign.id}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
          Prospects ({data.targets.length})
        </h4>
        {targets.length === 0 ? (
          <p className="text-sm text-subtle">No prospect has been added yet. The next run adds the first batch.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-subtle">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Prospect</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">State</th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">Why it matched</th>
                  <th scope="col" className="py-1.5 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {targets.map((target) => {
                  const business = prospects.get(target.businessId);
                  return (
                    <tr key={target.id}>
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{business?.name ?? 'Prospect'}</span>
                        <span className="block text-xs text-subtle">
                          {[business?.city, business?.region, business?.category].filter(Boolean).join(' · ')}
                          {business?.opportunityScore != null ? ` · score ${business.opportunityScore}` : ''}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={TARGET_STATE_META[target.state].tone}>{TARGET_STATE_META[target.state].label}</Badge>
                      </td>
                      <td className="max-w-[260px] py-1.5 pr-3 text-xs text-muted">
                        {target.matchReason ?? '—'}
                        {target.note && <span className="block text-subtle">{target.note}</span>}
                      </td>
                      <td className="py-1.5 text-xs text-subtle">{relativeTime(target.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.targets.length > targets.length && <p className="mt-1 text-xs text-subtle">Showing the first {targets.length} of {data.targets.length}.</p>}
          </div>
        )}
      </section>

      {campaign.discovery.enabled && (
        <section aria-labelledby={`campaign-discovery-${campaign.id}`}>
          <h4 id={`campaign-discovery-${campaign.id}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
            Discovered businesses to review ({pendingDiscovery.length})
          </h4>
          {pendingDiscovery.length === 0 ? (
            <p className="text-sm text-subtle">Nothing is waiting for review. New provider records appear here after a run.</p>
          ) : (
            <DiscoveryReview records={pendingDiscovery} manage={manage} />
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby={`campaign-runs-${campaign.id}`}>
          <h4 id={`campaign-runs-${campaign.id}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
            Run log
          </h4>
          {runs.length === 0 ? (
            <p className="text-sm text-subtle">No background run yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {runs.map((run) => (
                <li key={run.id} className="px-3 py-2 text-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : run.status === 'running' ? 'info' : 'neutral'}>{run.status}</Badge>
                    <span className="text-muted">{formatDateTime(run.startedAt)}</span>
                    <span className="text-subtle">
                      {run.targetsEnqueued} queued · {run.targetsCompleted} completed · {usd(run.spendUsd)}
                    </span>
                  </span>
                  {run.note && <p className="mt-0.5 text-muted">{run.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby={`campaign-jobs-${campaign.id}`}>
          <h4 id={`campaign-jobs-${campaign.id}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">
            Agent jobs
          </h4>
          {jobs.length === 0 ? (
            <p className="text-sm text-subtle">No job has been queued by this campaign yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {jobs.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-xs">
                  <Badge tone={job.status === 'succeeded' ? 'success' : job.status === 'failed' ? 'danger' : job.status === 'running' ? 'info' : job.status === 'cancelled' ? 'neutral' : 'warning'}>
                    {job.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="font-medium">{job.agent.replace(/_/g, ' ')}</span>
                  <span className="text-subtle">{relativeTime(job.createdAt)}</span>
                  {job.lastError && <span className="basis-full text-danger">{job.lastError}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}



function DiscoveryReview({ records, manage }: { records: DiscoveryRecordView[]; manage: boolean }) {
  const refresh = useCampaignRefresh();
  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'promote' | 'reject' }) => campaignApi.reviewRecord(id, { action }),
    onSuccess: (_result, variables) => {
      refresh();
      toast.success(variables.action === 'promote' ? 'Added as a research candidate. The next campaign run can research it.' : 'Record rejected.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-subtle">
            <th scope="col" className="py-1.5 pr-3 font-medium">Business</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Location</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Quality</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Why review</th>
            {manage && <th scope="col" className="py-1.5 font-medium">Decision</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {records.map((record) => (
            <tr key={record.id}>
              <td className="py-2 pr-3">
                <span className="font-medium">{record.name}</span>
                <span className="block text-xs text-subtle">
                  {record.category ?? 'Uncategorised'} · {record.providerKey}
                </span>
              </td>
              <td className="py-2 pr-3 text-xs text-muted">
                {[record.town, record.region, record.districtCode].filter(Boolean).join(' · ') || 'No location'}
              </td>
              <td className="py-2 pr-3 text-xs tabular">
                {record.qualityScore}/100
                <span className="block text-subtle">identity {record.identityConfidence}/100</span>
              </td>
              <td className="max-w-[240px] py-2 pr-3 text-xs text-muted">
                {record.reviewReasons.length ? record.reviewReasons.join('; ') : 'No specific concern recorded.'}
              </td>
              {manage && (
                <td className="py-2">
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" loading={review.isPending && review.variables?.id === record.id} onClick={() => review.mutate({ id: record.id, action: 'promote' })}>
                      Add prospect
                    </Button>
                    <Button size="sm" variant="outline-danger" loading={review.isPending && review.variables?.id === record.id} onClick={() => review.mutate({ id: record.id, action: 'reject' })}>
                      Reject
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

