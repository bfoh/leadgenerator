'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { approveIdentityBatch, type IdentityApprovalRequest, type IdentityApprovalResult } from '@/lib/data/identity-services';
import {
  IDENTITY_BATCH_LIMIT,
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
import {
  IDENTITY_APPROVAL_DECISION_META,
  IDENTITY_APPROVAL_DECISIONS,
  IDENTITY_VERIFICATION_META,
  deselectAll,
  duplicateNoticeLabel,
  eligibleIdentityRows,
  identityApprovalPreview,
  identityReviewRows,
  rowsNeedingMoreEvidence,
  selectAllEligible,
  type IdentityApprovalDecision,
  type IdentityApprovalPreview,
  type IdentityReviewRow,
} from '@/lib/domain/identity-approval';
import type { Business } from '@/lib/domain/types';
import { CONFIDENCE_BAND_META } from '@/lib/domain/website-assessment';
import { errorMessage } from '@/lib/utils';
import { api, useServerStatus } from '@/lib/workspace/api';
import { useAction, useBusinesses } from '@/lib/workspace/hooks';
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
 * can be checked, the name each check will search for, and what the run will cost. The checks write
 * nothing; the readings they return are approved together, from a reviewed selection, once confirmed.
 *
 * The dialog keeps its own copy of the selection it opened with. Approving renames the records, and a
 * renamed record may drop out of the list's filter or stop being a reference, so the live selection is
 * not a safe thing to re-read while the person is still looking at the results.
 */
export function BulkIdentifyBusiness({ businesses, onDone }: { businesses: Business[]; onDone: () => void }) {
  const { can } = useWorkspace();
  const [batch, setBatch] = useState<Business[] | null>(null);
  const eligible = useMemo(() => businesses.filter((business) => identityBatchEligibility(business).eligible).length, [businesses]);
  if (!can('prospects.write')) return null;
  if (!batch && eligible === 0) return null;

  return (
    <>
      {!batch && (
        <Button
          size="sm"
          onClick={() => setBatch(businesses)}
          title={`Name up to ${IDENTITY_BATCH_LIMIT} Google references from independent public sources.`}
        >
          <Search aria-hidden /> Identify {eligible} reference{eligible === 1 ? '' : 's'}
        </Button>
      )}
      {batch && (
        <BatchIdentifyDialog
          businesses={batch}
          onClose={() => {
            setBatch(null);
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
  const [decisions, setDecisions] = useState<Record<string, IdentityApprovalDecision>>({});
  const [confirming, setConfirming] = useState(false);
  const [approval, setApproval] = useState<{ results: IdentityApprovalResult[]; at: string } | null>(null);
  const stopRequested = useRef(false);

  // Duplicates are judged against the whole workspace, not the selection: renaming a reference into a
  // name another prospect already holds is the duplicate this workspace refuses to create.
  const { data: workspaceBusinesses = businesses } = useBusinesses();
  const rows = jobs ?? plan.jobs;
  const progress = identityBatchProgress(rows);
  const reviews = useMemo(
    () =>
      identityReviewRows(
        rows.map((job) => ({
          businessId: job.businessId,
          placeId: job.placeId,
          recordName: job.recordName,
          searchedName: job.name,
          profile: job.profile,
          state: job.state,
          evidence: job.evidence,
          reason: job.reason,
        })),
        workspaceBusinesses,
      ),
    [rows, workspaceBusinesses],
  );
  const preview = identityApprovalPreview(reviews, decisions);
  const retryable = [...new Set([...retryableIdentityJobs(rows), ...rowsNeedingMoreEvidence(reviews, decisions)])];
  const canRun = !running && estimate.checks > 0 && confirmed;

  const approve = useAction(
    async (ctx, requests: IdentityApprovalRequest[]) => approveIdentityBatch(ctx, requests),
    {
      success: (results) => {
        const done = results.filter((result) => result.state !== 'failed').length;
        const failed = results.length - done;
        return failed
          ? `${done} approved, ${failed} could not be applied`
          : `${done} identit${done === 1 ? 'y' : 'ies'} approved`;
      },
      onSuccess: (results) => {
        setApproval({ results, at: new Date().toISOString() });
        setConfirming(false);
        // The served reading no longer matches the records it named, so the review cannot be reused.
        setDecisions({});
      },
    },
  );

  function approveSelected() {
    const requests: IdentityApprovalRequest[] = preview.selected.map((row) => ({
      businessId: row.businessId,
      placeId: row.placeId,
      evidence: rows.find((job) => job.businessId === row.businessId)?.evidence ?? null,
    }));
    if (!requests.length) return;
    void approve.run(requests);
  }

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
        ) : confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>Back to the review</Button>
            <Button variant="primary" loading={approve.pending} onClick={approveSelected}>
              Approve {preview.selected.length} and update the CRM
            </Button>
          </>
        ) : approval ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            {retryable.length > 0 && (
              <Button onClick={() => void run(resetIdentityJobs(rows, retryable))}>Check {retryable.length} again</Button>
            )}
            <Button
              variant="primary"
              disabled={preview.selected.length === 0}
              onClick={() => setConfirming(true)}
            >
              Approve {preview.selected.length} identit{preview.selected.length === 1 ? 'y' : 'ies'}
            </Button>
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
        ) : confirming ? (
          <ConfirmSection preview={preview} />
        ) : approval ? (
          <ApprovalResults results={approval.results} at={approval.at} jobs={rows} />
        ) : (
          <ReviewSection
            reviews={reviews}
            decisions={decisions}
            progress={progress}
            stopped={stopped}
            error={error}
            running={running}
            onDecide={(businessId, decision) =>
              setDecisions((current) => {
                // Pressing the same decision again clears it, so nothing is approved by a stray click.
                const next = { ...current };
                if (next[businessId] === decision) delete next[businessId];
                else next[businessId] = decision;
                return next;
              })
            }
            onSelectAll={() => setDecisions((current) => selectAllEligible(reviews, current))}
            onDeselectAll={() => setDecisions(deselectAll())}
          />
        )}
      </div>
    </Dialog>
  );
}

interface ReviewSectionProps {
  reviews: IdentityReviewRow[];
  decisions: Record<string, IdentityApprovalDecision>;
  progress: IdentityBatchProgress;
  stopped: string | null;
  error: string | null;
  running: boolean;
  onDecide: (businessId: string, decision: IdentityApprovalDecision) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

/**
 * The review table. Every checked record is shown with the source that stands for it, its evidence
 * and verification, and the duplicates a rename would create; only rows that pass every rule offer a
 * decision, and nothing is written until the whole selection is confirmed.
 */
function ReviewSection({
  reviews,
  decisions,
  progress,
  stopped,
  error,
  running,
  onDecide,
  onSelectAll,
  onDeselectAll,
}: ReviewSectionProps) {
  const eligible = eligibleIdentityRows(reviews);
  const selected = eligible.filter((review) => decisions[review.businessId] === 'approve').length;

  return (
    <section aria-labelledby="identity-batch-progress" className="space-y-3" data-testid="identity-review">
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

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSelectAll} disabled={eligible.length === 0}>
          Select all {eligible.length} eligible
        </Button>
        <Button size="sm" variant="ghost" onClick={onDeselectAll}>
          Deselect all
        </Button>
        <span aria-live="polite" className="text-xs text-subtle">
          {selected} of {eligible.length} selected for approval
        </span>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {reviews.map((review) => (
          <ReviewRow
            key={review.businessId}
            review={review}
            decision={decisions[review.businessId] ?? null}
            onDecide={onDecide}
          />
        ))}
      </ul>

      <p className="text-xs text-subtle">
        Only an independently supported identity can be approved: a Google listing is a reference, not a source. Approving re-reads
        every record, re-checks its Place ID and duplicates, and logs the reviewer, the source and the name it replaced.
      </p>
    </section>
  );
}

function ReviewRow({
  review,
  decision,
  onDecide,
}: {
  review: IdentityReviewRow;
  decision: IdentityApprovalDecision | null;
  onDecide: (businessId: string, decision: IdentityApprovalDecision) => void;
}) {
  const verification = IDENTITY_VERIFICATION_META[review.verification];
  return (
    <li className="space-y-2 p-3" data-testid="identity-review-row" data-eligible={review.eligible}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate font-medium">{review.recordName}</span>
          <span className="block font-mono text-[11px] text-subtle">Place ID …{review.placeId.slice(-6)}</span>
          {review.searchedName && <span className="block text-[11px] text-subtle">searched “{review.searchedName}”</span>}
        </div>
        <div role="group" aria-label={`Decision for ${review.recordName}`} className="flex flex-wrap gap-1.5">
          {IDENTITY_APPROVAL_DECISIONS.map((value) => {
            const meta = IDENTITY_APPROVAL_DECISION_META[value];
            const pressed = decision === value;
            return (
              <Button
                key={value}
                size="sm"
                variant={pressed ? (value === 'reject' ? 'outline-danger' : value === 'approve' ? 'primary' : 'secondary') : 'ghost'}
                aria-pressed={pressed}
                disabled={!review.eligible && value === 'approve'}
                title={review.eligible ? meta.description : (review.reason ?? meta.description)}
                onClick={() => onDecide(review.businessId, value)}
              >
                {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-subtle">Proposed name</dt>
          <dd className="flex flex-wrap items-center gap-1.5 font-medium">
            {review.proposedName || 'No name proposed'}
            {review.eligible && <Badge tone="success">Eligible</Badge>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-subtle">Independent supporting source</dt>
          <dd className="break-words">
            {review.sourceUrl ? (
              <a href={review.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {review.site}
              </a>
            ) : (
              'No independent source'
            )}
            {review.evidenceFrom && <span className="text-subtle"> · read from the {review.evidenceFrom.toLowerCase()}</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-subtle">Verification</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <Badge tone={verification.tone}>{verification.label}</Badge>
            {review.confidence && <Badge tone="neutral">{CONFIDENCE_BAND_META[review.confidence].label} confidence</Badge>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-subtle">Possible CRM duplicates</dt>
          <dd>
            {review.duplicates.length === 0 ? (
              'None found'
            ) : (
              <ul className="space-y-0.5">
                {review.duplicates.slice(0, 3).map((duplicate) => (
                  <li key={duplicate.businessId}>
                    <span className="font-medium">{duplicate.name}</span>
                    <span className="text-subtle"> · {duplicateNoticeLabel(duplicate)}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>

      {review.conflicts.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-subtle">
          {review.conflicts.slice(0, 2).map((conflict) => (
            <li key={conflict}>{conflict}</li>
          ))}
        </ul>
      )}

      {review.reason && <p className="text-xs text-muted">{review.reason}</p>}

      <Link href={`/prospects/${review.businessId}`} className="text-xs text-subtle underline-offset-2 hover:underline">
        Open the record
      </Link>
    </li>
  );
}


/** The confirmation step: exactly which CRM records will change, before anything is written. */
function ConfirmSection({ preview }: { preview: IdentityApprovalPreview }) {
  return (
    <section aria-labelledby="identity-approval-confirm" className="space-y-3" data-testid="identity-approval-confirm">
      <h3 id="identity-approval-confirm" className="text-xs font-semibold uppercase tracking-wide text-muted">
        Confirm the records that will change
      </h3>
      <Notice tone="warning" title="This renames existing prospects">
        Only the fields below change. Prospect IDs, Google Place IDs, research history and permissions stay as they are, and no
        record is merged.
      </Notice>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {preview.selected.map((row) => (
          <li key={row.businessId} className="grid gap-1.5 p-2.5 sm:grid-cols-[1fr_1fr] sm:items-center">
            <div className="min-w-0">
              <span className="block truncate font-medium">{row.recordName}</span>
              <span className="block font-mono text-[11px] text-subtle">Place ID …{row.placeId.slice(-6)}</span>
            </div>
            <div className="text-xs">
              <span className="text-subtle line-through">{row.recordName}</span>{' '}
              <span aria-hidden>→</span>{' '}
              <strong className="font-medium">{row.proposedName}</strong>
            </div>
          </li>
        ))}
      </ul>
      {preview.setAside.length > 0 && (
        <p className="text-xs text-subtle">
          {preview.setAside.length} eligible record{preview.setAside.length === 1 ? ' is' : 's are'} set aside and will not change.
        </p>
      )}
    </section>
  );
}


const APPROVAL_STATE_META = {
  approved: { label: 'Approved', tone: 'success' },
  unchanged: { label: 'Already applied', tone: 'neutral' },
  failed: { label: 'Not applied', tone: 'danger' },
} as const;

/** Per-record results: what landed, what did not, and where the updated prospect is. */
function ApprovalResults({ results, at, jobs }: { results: IdentityApprovalResult[]; at: string; jobs: IdentityJob[] }) {
  const nameOf = new Map(jobs.map((job) => [job.businessId, job.recordName]));
  const applied = results.filter((result) => result.state === 'approved').length;
  const failed = results.filter((result) => result.state === 'failed').length;
  return (
    <section aria-labelledby="identity-approval-result" className="space-y-3" data-testid="identity-approval-result">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="identity-approval-result" className="text-xs font-semibold uppercase tracking-wide text-muted">
          Approval results
        </h3>
        <p aria-live="polite" className="text-xs text-subtle">
          {applied} changed{failed ? ` · ${failed} not applied` : ''} · {new Date(at).toLocaleTimeString()}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {results.map((result) => {
          const meta = APPROVAL_STATE_META[result.state];
          return (
            <li key={result.businessId} className="space-y-1 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium">
                  {nameOf.get(result.businessId) ?? result.business?.name ?? 'Record'}
                </span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {result.business && result.business.name !== nameOf.get(result.businessId) && (
                  <span className="text-xs text-subtle">now “{result.business.name}”</span>
                )}
              </div>
              {result.changed.length > 0 && <p className="text-xs text-muted">Changed: {result.changed.join(', ')}.</p>}
              {result.reason && <p className="text-xs text-muted">{result.reason}</p>}
              <Link href={`/prospects/${result.businessId}`} className="text-xs text-subtle underline-offset-2 hover:underline">
                Open the updated prospect
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-subtle">
        Every change is logged against the prospect with the reviewer, the source, the Place ID and the name it replaced. A record
        that failed is unchanged and can be reviewed again.
      </p>
    </section>
  );
}

