'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { acceptPlaceIdentity } from '@/lib/data/identity-services';
import {
  IDENTITY_BATCH_LIMIT,
  IDENTITY_JOB_META,
  identityBatchEligibility,
  identityBatchEstimate,
  identityBatchProgress,
  identityNameProblem,
  nextIdentityChunk,
  planIdentityJobs,
  resetIdentityJobs,
  retryableIdentityJobs,
  settleIdentityJobs,
  startIdentityJobs,
  stopIdentityJobs,
  suggestedIdentityName,
  type IdentityBatchProgress,
  type IdentityCheckResult,
  type IdentityJob,
} from '@/lib/domain/identity-batch';
import { PLACE_IDENTITY_STATUS_META, identityPatch } from '@/lib/domain/place-identity';
import type { Business } from '@/lib/domain/types';
import { CONFIDENCE_BAND_META } from '@/lib/domain/website-assessment';
import { errorMessage } from '@/lib/utils';
import { api, useServerStatus } from '@/lib/workspace/api';
import { useAction } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

interface BatchResponse {
  results: IdentityCheckResult[];
  blocked: { reason: string } | null;
  simulated: boolean;
  retrievedAt: string;
}

/**
 * Identifies several Google references at once. The selection bar opens a plan first: which records
 * can be checked, the name each check will search for, and what the run will cost. The batch writes
 * nothing — every identified record is accepted separately, from its own evidence.
 */
export function BulkIdentifyBusiness({ businesses, onDone }: { businesses: Business[]; onDone: () => void }) {
  const { can } = useWorkspace();
  const [open, setOpen] = useState(false);
  const eligible = useMemo(() => businesses.filter((business) => identityBatchEligibility(business).eligible).length, [businesses]);
  if (!can('prospects.write') || eligible === 0) return null;

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        title={`Name up to ${IDENTITY_BATCH_LIMIT} Google references from independent public sources.`}
      >
        <Search aria-hidden /> Identify {eligible} reference{eligible === 1 ? '' : 's'}
      </Button>
      {open && (
        <BatchIdentifyDialog
          businesses={businesses}
          onClose={() => {
            setOpen(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

function BatchIdentifyDialog({ businesses, onClose }: { businesses: Business[]; onClose: () => void }) {
  const status = useServerStatus();
  const simulated = status.data?.research?.simulated ?? false;
  const costPerQuery = status.data?.research?.search.costPerQueryUsd ?? 0;
  const quota = status.data?.quotas.webSearch ?? null;

  // The typed names are the only input while planning: the jobs are built when the run starts, so
  // changing a name before that changes both what is searched for and what the run costs.
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(businesses.map((business) => [business.id, suggestedIdentityName(business)])),
  );
  const plan = useMemo(() => planIdentityJobs(businesses, names), [businesses, names]);
  const estimate = useMemo(() => identityBatchEstimate(plan.jobs, costPerQuery), [plan.jobs, costPerQuery]);

  const [jobs, setJobs] = useState<IdentityJob[] | null>(null);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());
  const stopRequested = useRef(false);

  const rows = jobs ?? plan.jobs;
  const progress = identityBatchProgress(rows);
  const retryable = retryableIdentityJobs(rows);
  const canRun = !running && estimate.checks > 0 && confirmed;

  const accept = useAction(
    async (ctx, job: IdentityJob) => {
      // The service re-reads the record and re-judges the evidence, so a stale row cannot write.
      const business = await ctx.store.getBusiness(job.businessId);
      if (!business) throw new Error('That record is no longer in this workspace.');
      return acceptPlaceIdentity(ctx, business, job.evidence);
    },
    {
      success: (result) => `Identified ${result.business.name}`,
      onSuccess: (result) => setAccepted((current) => new Set(current).add(result.business.id)),
    },
  );

  /**
   * Runs the plan in chunks. Between chunks it looks at whether the person stopped it or the server
   * said the search quota or the spending budget is spent; either way nothing new starts, and the rows
   * that never ran say so instead of looking like they are still waiting.
   */
  async function run(start: IdentityJob[]) {
    setRunning(true);
    setError(null);
    setStopped(null);
    stopRequested.current = false;
    let current = start;
    setJobs(current);
    try {
      while (!stopRequested.current) {
        const chunk = nextIdentityChunk(current);
        if (!chunk.length) break;
        current = startIdentityJobs(current, chunk.map((job) => job.businessId));
        setJobs(current);
        const response = await api.post<BatchResponse>('/api/prospects/identity/batch', {
          jobs: chunk.map((job) => ({ businessId: job.businessId, placeId: job.placeId, name: job.name, profile: job.profile })),
        });
        current = settleIdentityJobs(current, response.results);
        setJobs(current);
        if (response.blocked) {
          setStopped(response.blocked.reason);
          current = stopIdentityJobs(current, 'blocked', response.blocked.reason);
          setJobs(current);
          break;
        }
      }
      if (stopRequested.current) {
        current = stopIdentityJobs(current, 'cancelled', null);
        setJobs(current);
      }
    } catch (failure) {
      // The request itself failed, so the rows it was carrying did not answer. They fail with the
      // reason; everything they were not carrying stays waiting, so nothing has to be re-typed.
      const reason = errorMessage(failure);
      setError(reason);
      current = settleIdentityJobs(
        current,
        current
          .filter((job) => job.state === 'checking')
          .map((job) => ({ businessId: job.businessId, state: 'failed' as const, evidence: null, reading: null, reason })),
      );
      setJobs(current);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open) return;
        // Closing also stops the run: a batch writes nothing, so there is nothing to unwind.
        stopRequested.current = true;
        onClose();
      }}
      size="xl"
      title="Identify Google references"
      description={
        simulated
          ? 'Each check searches the labelled simulated world and reads its pages. No paid request leaves this machine, and nothing found is kept.'
          : 'Each check runs a few bounded searches and reads the homepages it shortlists. Nothing is written until you accept a reading.'
      }
      footer={
        jobs === null ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void run(plan.jobs)} disabled={!canRun}>
              <Search aria-hidden /> Check {estimate.checks} record{estimate.checks === 1 ? '' : 's'}
            </Button>
          </>
        ) : running ? (
          <Button variant="outline-danger" onClick={() => (stopRequested.current = true)}>
            Stop the batch
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            {retryable.length > 0 && (
              <Button variant="primary" onClick={() => void run(resetIdentityJobs(rows, retryable))}>
                Check {retryable.length} again
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-4 text-sm" data-testid="identity-batch">
        {jobs === null ? (
          <>
            <section aria-labelledby="identity-batch-names" className="space-y-2">
              <h3 id="identity-batch-names" className="text-xs font-semibold uppercase tracking-wide text-muted">
                The name each check searches for
              </h3>
              <p className="text-xs text-subtle">
                A Google reference has no name of its own, so each check needs the name someone is looking for. The record&apos;s
                own label is never searched for.
              </p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {rows.map((job) => {
                  const problem = identityNameProblem(job.name);
                  return (
                    <li key={job.businessId} className="grid gap-2 p-2.5 sm:grid-cols-[1fr_1fr] sm:items-start">
                      <div className="min-w-0">
                        <span className="block truncate font-medium">{job.recordName}</span>
                        <span className="block font-mono text-[11px] text-subtle">Place ID …{job.placeId.slice(-6)}</span>
                      </div>
                      <div>
                        <Input
                          aria-label={`Business name for ${job.recordName}`}
                          aria-invalid={problem ? true : undefined}
                          value={job.name}
                          maxLength={200}
                          placeholder="Business name as it trades"
                          onChange={(event) => setNames((current) => ({ ...current, [job.businessId]: event.target.value }))}
                        />
                        {problem && <p className="mt-1 text-xs text-danger">{problem}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {plan.skipped.length > 0 && (
              <section aria-labelledby="identity-batch-skipped" className="space-y-1">
                <h3 id="identity-batch-skipped" className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Left out of this batch
                </h3>
                <ul className="space-y-1 text-xs text-subtle">
                  {plan.skipped.map((skip) => (
                    <li key={skip.businessId}>
                      <span className="font-medium text-foreground">{skip.recordName}</span> — {skip.reason}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="identity-batch-cost" className="space-y-2 rounded-lg border border-border bg-surface-muted/60 p-3">
              <h3 id="identity-batch-cost" className="text-xs font-semibold uppercase tracking-wide text-muted">
                What this run costs
              </h3>
              <ul className="grid gap-1 text-xs text-muted sm:grid-cols-3">
                <li>
                  <span className="font-medium text-foreground">{estimate.checks}</span> check{estimate.checks === 1 ? '' : 's'}
                </li>
                <li>
                  up to <span className="font-medium text-foreground">{estimate.searches}</span> search{estimate.searches === 1 ? '' : 'es'}
                </li>
                <li>
                  up to <span className="font-medium text-foreground">{estimate.pages}</span> homepage read{estimate.pages === 1 ? '' : 's'}
                </li>
              </ul>
              <p className="text-xs text-subtle">
                {simulated
                  ? 'Simulated searches: nothing leaves this machine and nothing is billed.'
                  : `Searches are USD ${costPerQuery.toFixed(3)} each, so the searches alone cap this run at USD ${estimate.costUsd.toFixed(
                      2,
                    )}. The provider bills what it actually runs.${quota ? ` The run also stops at the ${quota} searches allowed in 24 hours.` : ''}`}
              </p>
              <Checkbox
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                label={`Run these ${estimate.checks} check${estimate.checks === 1 ? '' : 's'} now`}
                description="The batch writes nothing. Each reading is accepted on its own, once you have seen its source."
              />
            </section>
          </>
        ) : (
          <ResultsSection
            jobs={rows}
            progress={progress}
            stopped={stopped}
            error={error}
            running={running}
            accepted={accepted}
            accepting={accept.pending}
            onAccept={(job) => void accept.run(job)}
          />
        )}
      </div>
    </Dialog>
  );
}

interface ResultsSectionProps {
  jobs: IdentityJob[];
  progress: IdentityBatchProgress;
  stopped: string | null;
  error: string | null;
  running: boolean;
  accepted: Set<string>;
  accepting: boolean;
  onAccept: (job: IdentityJob) => void;
}

function ResultsSection({ jobs, progress, stopped, error, running, accepted, accepting, onAccept }: ResultsSectionProps) {
  return (
    <section aria-labelledby="identity-batch-progress" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="identity-batch-progress" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Results
        </h3>
        <p aria-live="polite" className="text-xs text-subtle">
          {progress.done} of {progress.total} checked · {progress.byState.identified} identified
          {progress.byState.ambiguous ? ` · ${progress.byState.ambiguous} need a person` : ''}
          {progress.byState.failed + progress.byState.blocked > 0
            ? ` · ${progress.byState.failed + progress.byState.blocked} not checked`
            : ''}
        </p>
      </div>

      {stopped && (
        <Notice tone="warning" title="The batch stopped">
          {stopped} Nothing else was attempted, and every record that was not checked says so below.
        </Notice>
      )}
      {error && (
        <Notice tone="danger" title="The last request failed">
          {error} The records it was carrying are marked as not checked; the rest are still waiting.
        </Notice>
      )}
      {running && !stopped && !error && (
        <p className="text-xs text-subtle">Checking in small groups. You can stop after the group that is running now.</p>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {jobs.map((job) => (
          <JobRow
            key={job.businessId}
            job={job}
            accepted={accepted.has(job.businessId)}
            accepting={accepting}
            onAccept={() => onAccept(job)}
          />
        ))}
      </ul>

      <p className="text-xs text-subtle">
        Accepting changes one record at a time and logs the site it came from. A record marked “Needs a person” has a candidate
        worth reading, but no source that clearly stands for the place.
      </p>
    </section>
  );
}

function JobRow({ job, accepted, accepting, onAccept }: { job: IdentityJob; accepted: boolean; accepting: boolean; onAccept: () => void }) {
  const meta = IDENTITY_JOB_META[job.state];
  const reading = job.reading;
  const proposal = reading?.proposal ?? null;
  const patch = reading?.status === 'identified' ? identityPatch(job.profile, reading.proposal) : null;
  const changes = patch
    ? [
        patch.renames ? { label: 'Name', from: job.profile.name, to: patch.name } : null,
        patch.officialWebsite ? { label: 'Website', from: job.profile.website || 'Not recorded', to: patch.officialWebsite } : null,
        patch.category ? { label: 'Category', from: job.profile.category || 'Not recorded', to: patch.category } : null,
        patch.city ? { label: 'Town', from: job.profile.city || 'Not recorded', to: patch.city } : null,
      ].filter((change): change is { label: string; from: string; to: string } => change !== null)
    : [];
  const acceptable = patch !== null && changes.length > 0 && job.evidence !== null;

  return (
    <li className="space-y-1.5 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-medium">{job.recordName}</span>
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
        {reading && <Badge tone="neutral">{CONFIDENCE_BAND_META[reading.confidence].label}</Badge>}
        {accepted && <Badge tone="success">Accepted</Badge>}
        {reading && <span className="text-[11px] text-subtle">searched “{job.name}”</span>}
      </div>

      {reading?.status === 'identified' && proposal && (
        <p className="text-xs text-muted">
          {proposal.site} publishes {proposal.publishedName ? `“${proposal.publishedName}”` : 'the name'}
          {proposal.nameMatch > 0 ? ` · name matches ${Math.round(proposal.nameMatch * 100)}%` : ''}{' '}
          <a href={proposal.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Read the source
          </a>
        </p>
      )}
      {reading && reading.status !== 'identified' && (
        <p className="text-xs text-subtle">{PLACE_IDENTITY_STATUS_META[reading.status].description}</p>
      )}

      {changes.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {changes.map((change) => (
            <li key={change.label} className="grid grid-cols-[4.5rem_1fr] gap-2">
              <span className="text-subtle">{change.label}</span>
              <span>
                <span className="text-subtle line-through">{change.from}</span> →{' '}
                <strong className="font-medium">{change.to}</strong>
              </span>
            </li>
          ))}
        </ul>
      )}

      {reading && reading.concerns.length > 0 && !accepted && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-subtle">
          {reading.concerns.slice(0, 2).map((concern) => (
            <li key={concern}>{concern}</li>
          ))}
        </ul>
      )}

      {job.reason && reading === null && <p className="text-xs text-muted">{job.reason}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {acceptable && !accepted && (
          <Button size="sm" variant="primary" loading={accepting} onClick={onAccept}>
            Use this name and website
          </Button>
        )}
        <Link href={`/prospects/${job.businessId}`} className="text-xs text-subtle underline-offset-2 hover:underline">
          Open the record
        </Link>
      </div>
    </li>
  );
}

