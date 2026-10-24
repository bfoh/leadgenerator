import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAutomationStore } from '@/lib/automation/supabase-store';
import {
  campaignBudgetReached,
  campaignCandidates,
  campaignShouldAutoComplete,
  campaignTargetCounts,
  isCampaignDue,
  nextRunAt,
  resolveTargetState,
  startOfCampaignDay,
  type ResearchCampaign,
} from '@/lib/domain/campaigns';
import { campaignProviderBlocker } from '@/lib/domain/discovery-providers';
import { discoveryRemaining, discoveryScopeFromCampaign } from '@/lib/domain/discovery-framework';
import { serverEnv } from '@/lib/server/env';
import { purgeExpiredDiscoveryRecords, runDiscoveryPage } from '@/lib/server/discovery/service';
import { campaignColumns, campaignFromRow, CampaignError, SupabaseCampaignStore, type CampaignJob } from './store';

const OPEN_STATUSES = new Set<CampaignJob['status']>(['pending', 'running', 'awaiting_approval']);
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** Eligible prospects this campaign has not targeted, and ones waiting for another campaign's work. */
async function remainingInScope(
  store: SupabaseCampaignStore,
  campaign: ResearchCampaign,
): Promise<{ untargeted: number; busy: number }> {
  const pool = await store.listCandidateBusinesses(2000);
  const eligible = campaignCandidates(pool, campaign.scope);
  if (!eligible.length) return { untargeted: 0, busy: 0 };
  const ids = eligible.map((entry) => entry.business.id);
  const [targeted, busy] = await Promise.all([store.targetedBusinessIds(campaign.id, ids), store.busyBusinessIds(ids, campaign.id)]);
  return {
    untargeted: eligible.filter((entry) => !targeted.has(entry.business.id) && !busy.has(entry.business.id)).length,
    busy: eligible.filter((entry) => !targeted.has(entry.business.id) && busy.has(entry.business.id)).length,
  };
}

/**
 * Close a finite campaign once its scope is exhausted. Runs are never deleted; the campaign simply
 * moves to `completed` (a terminal status), which keeps every target, job and run readable.
 */
async function completeIfExhausted(
  store: SupabaseCampaignStore,
  campaign: ResearchCampaign,
): Promise<{ completed: boolean; note: string | null }> {
  const targets = await store.listTargets(campaign.id, 2000);
  const counts = campaignTargetCounts(targets);
  if (counts.queued > 0 || counts.researching > 0 || counts.completed === 0 || counts.failed > 0) {
    return { completed: false, note: null };
  }
  // An autonomous campaign is not exhausted while the provider has more pages or a person still has
  // records to review. Closing it then would silently drop the rest of the scope.
  if (campaign.discovery.enabled) {
    const pending = await store.pendingDiscoveryCount(campaign.id);
    const allowanceLeft = discoveryRemaining(campaign.discovery.discoveredTotal, campaign.discovery.totalLimit);
    if (pending > 0 || (!campaign.discovery.exhausted && allowanceLeft > 0)) return { completed: false, note: null };
  }
  const remaining = await remainingInScope(store, campaign);
  if (!campaignShouldAutoComplete(campaign, counts, remaining)) return { completed: false, note: null };
  const note = clip(
    `Scope exhausted: ${counts.completed} prospect(s) researched${counts.qualified ? ` (${counts.qualified} qualified)` : ''}. The campaign completed automatically.`,
    1000,
  );
  await store.updateCampaign(campaign.id, { status: 'completed', nextRunAt: null, lastRunStatus: 'succeeded', lastRunNote: note });
  return { completed: true, note };
}

export interface CampaignTickResult {
  campaignId: string;
  /** `skipped` means nothing was enqueued (not due, paused, quota or budget reached). */
  status: 'succeeded' | 'failed' | 'skipped';
  enqueued: number;
  completed: number;
  openJobs: number;
  spendUsd: number;
  note: string;
}

/**
 * One campaign tick: first reconcile targets whose job chain has finished, then (when the campaign
 * is due) add eligible tracked prospects to the campaign and queue the first research step.
 *
 * Deduplication is deliberate: a prospect already in this campaign is never added twice, and a
 * prospect being researched by another campaign or an open job waits for that work to finish.
 */
export async function tickCampaign(
  sb: SupabaseClient,
  organizationId: string,
  campaign: ResearchCampaign,
  options: { now?: Date; enqueue?: boolean } = {},
): Promise<CampaignTickResult> {
  const now = options.now ?? new Date();
  const store = new SupabaseCampaignStore(sb, organizationId);
  const automation = new SupabaseAutomationStore(sb, organizationId);
  const manual = campaign.schedule.frequency === 'manual';
  const enqueue = options.enqueue !== false && campaign.status === 'active' && (manual || isCampaignDue(campaign, now));

  // A scheduled run is claimed by moving next_run_at, so two workers cannot enqueue the same batch.
  let claimedNextRunAt: string | null = null;
  if (enqueue && !manual) {
    const following = nextRunAt(campaign.schedule, now) ?? new Date(now.getTime() + 86_400_000).toISOString();
    const won = await store.claimScheduledRun(campaign.id, campaign.nextRunAt ?? '', following);
    if (!won) {
      return { campaignId: campaign.id, status: 'skipped', enqueued: 0, completed: 0, openJobs: 0, spendUsd: 0, note: 'Another worker is already running this campaign.' };
    }
    claimedNextRunAt = following;
  }

  const targets = await store.listTargets(campaign.id, 2000);
  const jobs = await store.listCampaignJobs(campaign.id, 2000);
  const byTarget = new Map<string, CampaignJob[]>();
  for (const job of jobs) {
    if (!job.campaignTargetId) continue;
    const list = byTarget.get(job.campaignTargetId) ?? [];
    list.push(job);
    byTarget.set(job.campaignTargetId, list);
  }

  // ── Reconcile memberships whose chain has stopped ──
  let completed = 0;
  for (const target of targets) {
    if (target.state !== 'researching') continue;
    const list = byTarget.get(target.id) ?? [];
    if (list.some((job) => OPEN_STATUSES.has(job.status))) continue;
    const settled = !list.some((job) => job.status === 'failed' || job.status === 'cancelled') && list.some((job) => job.status === 'succeeded');
    const business = settled ? await store.getCandidate(target.businessId) : null;
    const next = resolveTargetState(list, business?.opportunityScore ?? null);
    if (!next) continue;
    await store.updateTarget(target.id, { state: next.state, note: clip(next.note, 1000) });
    if (next.state === 'researched' || next.state === 'qualified') completed += 1;
  }

  // ── A reconcile-only tick (manual campaign, or not due) stops here ──
  if (!enqueue) {
    const openJobs = jobs.filter((job) => OPEN_STATUSES.has(job.status)).length;
    // A batch that settled on this tick may have exhausted a finite scope, even when nothing is due.
    const completion = completed > 0 ? await completeIfExhausted(store, campaign) : { completed: false, note: null };
    return {
      campaignId: campaign.id,
      status: completion.completed ? 'succeeded' : 'skipped',
      enqueued: 0,
      completed,
      openJobs,
      spendUsd: 0,
      note: completion.note ?? (completed ? `Reconciled ${completed} target(s); nothing was due to run.` : 'Nothing was due to run.'),
    };
  }

  const run = await store.createRun({ campaignId: campaign.id, status: 'running' });
  let enqueued = 0;
  let spendUsd = 0;
  let status: CampaignTickResult['status'] = 'succeeded';
  let note = '';
  let discoveryNote: string | null = null;
  let discoveryFailure = false;

  try {
    const settings = await automation.getSettings();
    const blocker = campaignProviderBlocker(campaign.providerKey, { syntheticEnabled: serverEnv.discovery.synthetic() });
    spendUsd = (await store.campaignSpend(campaign.id)) + (await store.discoverySpend(campaign.id));
    if (settings.paused) {
      status = 'skipped';
      note = 'The automation queue is paused, so no prospects were added.';
    } else if (blocker) {
      status = 'skipped';
      note = blocker;
    } else if (campaignBudgetReached(campaign, spendUsd)) {
      status = 'skipped';
      note = `The campaign’s monthly budget of $${(campaign.monthlyBudgetUsd ?? 0).toFixed(2)} is reached ($${spendUsd.toFixed(2)} recorded).`;
    } else {
      if (campaign.discovery.enabled) {
        await purgeExpiredDiscoveryRecords(sb, organizationId);
        if (campaign.discovery.exhausted) {
          discoveryNote = 'The provider has no more records for this scope.';
        } else {
          const fetchedToday = await store.countDiscoveredSince(campaign.id, startOfCampaignDay(now));
          const dailyLeft = Math.max(0, campaign.discovery.dailyLimit - fetchedToday);
          const totalLeft = discoveryRemaining(campaign.discovery.discoveredTotal, campaign.discovery.totalLimit);
          const pageSize = Math.min(20, dailyLeft, totalLeft);
          if (pageSize <= 0) {
            discoveryNote =
              dailyLeft <= 0
                ? `The discovery daily limit of ${campaign.discovery.dailyLimit} record(s) is reached.`
                : `The discovery total limit of ${campaign.discovery.totalLimit} record(s) is reached.`;
          } else {
            try {
              const result = await runDiscoveryPage(sb, {
                organizationId,
                campaignId: campaign.id,
                request: {
                  sourceId: campaign.providerKey,
                  ...discoveryScopeFromCampaign(campaign.scope),
                  pageSize,
                  cursor: campaign.discovery.cursor ?? '',
                  minQuality: campaign.discovery.qualityThreshold,
                },
                requireReview: campaign.discovery.requireReview,
                qualityThreshold: campaign.discovery.qualityThreshold,
                spendCapUsd: campaign.discovery.spendCapUsd,
                now,
              });
              spendUsd += result.spendUsd;
              const nextCursor = result.nextCursor;
              await store.updateCampaign(
                campaign.id,
                campaignColumns({
                  discovery: {
                    ...campaign.discovery,
                    cursor: nextCursor,
                    exhausted: nextCursor === null,
                    discoveredTotal: campaign.discovery.discoveredTotal + result.fetched,
                  },
                }),
              );
              discoveryNote = `Discovery: ${result.note}`;
              if (result.status === 'failed') discoveryFailure = true;
            } catch (error) {
              discoveryFailure = true;
              discoveryNote = `Discovery failed: ${error instanceof Error ? error.message : 'unknown error'}`;
            }
          }
        }
      }
      const startedToday = await store.countTargetsStartedSince(campaign.id, startOfCampaignDay(now));
      let slots = Math.min(campaign.batchSize, Math.max(0, campaign.dailyTargetLimit - startedToday));
      if (slots <= 0) {
        status = discoveryNote ? 'succeeded' : 'skipped';
        note = `The daily limit of ${campaign.dailyTargetLimit} started target(s) is reached.`;
      } else {
        // Memberships left queued (a job vanished, or an enqueue failed before creating one) resume
        // first, so nothing is stranded.
        const queued = (await store.listTargets(campaign.id, 2000)).filter((target) => target.state === 'queued');
        if (queued.length) {
          const queuedBusy = await store.busyBusinessIds(
            queued.map((target) => target.businessId),
            campaign.id,
          );
          for (const target of queued.filter((entry) => !queuedBusy.has(entry.businessId)).slice(0, slots)) {
            try {
              const { created, job } = await automation.enqueue({
                agent: 'business_identity',
                businessId: target.businessId,
                payload: {},
                campaignId: campaign.id,
                campaignTargetId: target.id,
                idempotencyKey: `campaign:${campaign.id}:${target.businessId}:identity`,
                priority: 200,
              });
              try {
                await store.updateTarget(target.id, {
                  state: 'researching',
                  jobId: job.id,
                  startedAt: target.startedAt ?? now.toISOString(),
                  note: `Resumed by campaign “${campaign.name}”.`,
                });
              } catch (error) {
                // Another worker moved the membership on between the enqueue and this update.
                if (!(error instanceof CampaignError && error.code === 'conflict')) throw error;
              }
              if (created) {
                enqueued += 1;
                slots -= 1;
              }
            } catch (error) {
              await store.updateTarget(target.id, {
                state: 'failed',
                note: clip(error instanceof Error ? error.message : 'The research job could not be queued.', 1000),
              });
            }
          }
        }
        const pool = await store.listCandidateBusinesses(2000);
        const eligible = campaignCandidates(pool, campaign.scope);
        const ids = eligible.map((entry) => entry.business.id);
        const [targeted, busy] = await Promise.all([store.targetedBusinessIds(campaign.id, ids), store.busyBusinessIds(ids, campaign.id)]);
        const chosen = eligible.filter((entry) => !targeted.has(entry.business.id) && !busy.has(entry.business.id)).slice(0, Math.max(0, slots));
        for (const { business, reason } of chosen) {
          const target = await store.addTarget({
            campaignId: campaign.id,
            businessId: business.id,
            matchReason: reason,
            source: business.providerKey ? 'provider' : 'tracked',
          });
          // Another worker may have added (and already started) this prospect between the check and
          // the insert; never move a membership backwards.
          if (target.state !== 'queued') continue;
          try {
            const { created, job } = await automation.enqueue({
              agent: 'business_identity',
              businessId: business.id,
              payload: {},
              campaignId: campaign.id,
              campaignTargetId: target.id,
              idempotencyKey: `campaign:${campaign.id}:${business.id}:identity`,
              priority: 200,
            });
            try {
              await store.updateTarget(target.id, {
                state: 'researching',
                jobId: job.id,
                startedAt: now.toISOString(),
                note: `Started by campaign “${campaign.name}”.`,
              });
            } catch (error) {
              // Another worker moved the membership on between the enqueue and this update.
              if (!(error instanceof CampaignError && error.code === 'conflict')) throw error;
            }
            if (created) enqueued += 1;
          } catch (error) {
            await store.updateTarget(target.id, {
              state: 'failed',
              note: clip(error instanceof Error ? error.message : 'The research job could not be queued.', 1000),
            });
          }
        }
        if (!chosen.length && !enqueued) {
          status = discoveryNote ? 'succeeded' : 'skipped';
          note = discoveryNote
            ? 'Discovery ran; no untargeted prospect is ready to research yet.'
            : 'No untargeted prospect matches the scope right now.';
        } else if (!enqueued) {
          status = discoveryNote ? 'skipped' : 'failed';
          note = 'No research job could be queued; see the target notes.';
        } else {
          note = `${enqueued} prospect(s) queued; ${busy.size} left for later because research is already in progress.`;
        }
      }
      if (discoveryNote) note = note ? `${discoveryNote} ${note}` : discoveryNote;
      if (discoveryFailure) {
        status = 'failed';
        note = discoveryNote ?? note;
      }
    }
  } catch (error) {
    status = 'failed';
    note = clip(error instanceof Error ? error.message : 'The campaign run failed.', 1000);
  }

  const completion = status === 'failed' ? { completed: false, note: null } : await completeIfExhausted(store, campaign);
  if (completion.note) note = `${note} ${completion.note}`.trim();
  if (completion.completed) status = 'succeeded';

  const openJobs = (await store.listCampaignJobs(campaign.id, 2000)).filter((job) => OPEN_STATUSES.has(job.status)).length;
  await store.finishRun(run.id, { status, targetsEnqueued: enqueued, targetsCompleted: completed, jobsOpen: openJobs, spendUsd, note: clip(note, 1000) });
  await store.updateCampaign(campaign.id, {
    lastRunAt: now.toISOString(),
    lastRunStatus: status,
    lastRunNote: clip(note, 1000),
    ...(claimedNextRunAt && !completion.completed ? { nextRunAt: claimedNextRunAt } : {}),
  });

  return { campaignId: campaign.id, status, enqueued, completed, openJobs, spendUsd, note: clip(note, 1000) };
}

export interface CampaignTickSummary {
  ticked: number;
  enqueued: number;
  completed: number;
  skipped: number;
  failed: number;
}

/**
 * Reconciles every active campaign and runs the ones that are due. Called by the scheduled worker;
 * enqueueing is cheap (no provider or model calls), and each campaign claims its own run.
 */
export async function tickDueCampaigns(sb: SupabaseClient, now = new Date(), limit = 20, stopAtMs = Number.POSITIVE_INFINITY): Promise<CampaignTickSummary> {
  const summary: CampaignTickSummary = { ticked: 0, enqueued: 0, completed: 0, skipped: 0, failed: 0 };
  const { data, error } = await sb
    .from('research_campaigns')
    .select('*')
    .eq('status', 'active')
    .order('next_run_at', { ascending: true, nullsFirst: false })
    .limit(Math.min(limit, 50));
  if (error) return summary;
  for (const row of data ?? []) {
    if (Date.now() > stopAtMs) break;
    const campaign = campaignFromRow(row);
    try {
      const due = campaign.schedule.frequency !== 'manual' && isCampaignDue(campaign, now);
      const result = await tickCampaign(sb, campaign.organizationId, campaign, { now, enqueue: due });
      summary.ticked += 1;
      summary.enqueued += result.enqueued;
      summary.completed += result.completed;
      if (result.status === 'skipped') summary.skipped += 1;
      if (result.status === 'failed') summary.failed += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

