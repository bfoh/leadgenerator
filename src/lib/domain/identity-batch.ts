// Identifying several Place-ID-only references at once.
//
// One check is already bounded and cheap; the risk in a batch is that it becomes a runaway: an
// unreadable record, a name typed once and reused, a quota that runs out in the middle, or twenty
// paid checks fired the moment a person pressed a button. So a batch is planned before it runs (who
// is eligible, which name each check searches for, what it will cost), it runs in small chunks with
// two checks in flight at most, and it stops the whole batch the moment a search quota, a spending
// budget, a missing key or the person says so. A success is a reading, not a write: every acceptance
// goes through the single-record rules again, one record at a time.

import type { Tone } from './constants';
import {
  PLACE_IDENTITY_INSPECTION_LIMIT,
  identityProfileOf,
  looksLikePlaceholderName,
  planIdentityQueries,
  type IdentityProfile,
  type PlaceIdentityEvidence,
  type PlaceIdentityReading,
} from './place-identity';
import type { Business } from './types';

// ── Bounds ───────────────────────────────────────────────────────────────────

/** References one batch may cover. Beyond this a person is exporting, not reviewing. */
export const IDENTITY_BATCH_LIMIT = 20;
/** Checks per request, so one long-lived request never carries a whole batch. */
export const IDENTITY_BATCH_CHUNK = 4;
/** Checks in flight inside a request. Each one spends searches, so the bound is small. */
export const IDENTITY_BATCH_CONCURRENCY = 2;

// ── Jobs ─────────────────────────────────────────────────────────────────────

/**
 * Where one reference stands. `checking` exists on the screen only: the server answers once per
 * check, so a person watching a running batch can see which row is being read right now.
 */
export const IDENTITY_JOB_STATES = ['pending', 'checking', 'identified', 'ambiguous', 'not_found', 'failed', 'blocked', 'cancelled'] as const;
export type IdentityJobState = (typeof IDENTITY_JOB_STATES)[number];

export const IDENTITY_JOB_META: Record<IdentityJobState, { label: string; tone: Tone; done: boolean }> = {
  pending: { label: 'Waiting', tone: 'neutral', done: false },
  checking: { label: 'Checking', tone: 'info', done: false },
  identified: { label: 'Identified', tone: 'success', done: true },
  ambiguous: { label: 'Needs a person', tone: 'warning', done: true },
  not_found: { label: 'Nothing found', tone: 'neutral', done: true },
  failed: { label: 'Could not check', tone: 'danger', done: true },
  blocked: { label: 'Stopped', tone: 'danger', done: true },
  cancelled: { label: 'Not checked', tone: 'neutral', done: true },
};

export interface IdentityJob {
  businessId: string;
  /** The Place ID the record was created from; acceptance never changes it. */
  placeId: string;
  /** The record's own label, so the row can be named even while its name is being checked. */
  recordName: string;
  /** The name this check searches for. Empty until someone types one. */
  name: string;
  /** The record as the check will compare it, captured when the batch was planned. */
  profile: IdentityProfile;
  state: IdentityJobState;
  evidence: PlaceIdentityEvidence | null;
  reading: PlaceIdentityReading | null;
  reason: string | null;
  checkedAt: string | null;
}

/** What one check returned, as the API sends it and the screen applies it. */
export interface IdentityCheckResult {
  businessId: string;
  state: IdentityJobState;
  evidence: PlaceIdentityEvidence | null;
  reading: PlaceIdentityReading | null;
  reason: string | null;
}

export interface IdentityBatchSkip {
  businessId: string;
  recordName: string;
  reason: string;
}

// ── Planning ─────────────────────────────────────────────────────────────────

/**
 * Whether this record can be checked in a batch. The batch exists to name Google references, so a
 * record without a Place ID has nothing to identify, and a record archived by a merge would only
 * rename a row nobody keeps.
 */
export function identityBatchEligibility(business: Business): { eligible: true } | { eligible: false; reason: string } {
  if (business.mergedIntoId) return { eligible: false, reason: 'This record was merged into another one. Identify the record that was kept.' };
  if (!business.placesPlaceId) return { eligible: false, reason: 'No Google Place ID is recorded, so there is no reference to identify.' };
  return { eligible: true };
}

/** The name a check starts from: the record's own, unless that is only a reference label. */
export function suggestedIdentityName(business: Business): string {
  const name = business.name.trim();
  return !name || looksLikePlaceholderName(name) ? '' : name;
}

/** Why a typed name cannot be searched for, or null when it can. */
export function identityNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter the business name to check.';
  if (trimmed.length < 3) return 'A business name needs at least three characters.';
  if (looksLikePlaceholderName(trimmed)) return 'That is the reference label, not a business name.';
  return null;
}

/**
 * The batch as it will be shown: one job per eligible record, in the order the person selected them,
 * and a reason for every record that was left out rather than silently dropped.
 */
export function planIdentityJobs(
  businesses: Business[],
  names: Record<string, string> = {},
): { jobs: IdentityJob[]; skipped: IdentityBatchSkip[] } {
  const jobs: IdentityJob[] = [];
  const skipped: IdentityBatchSkip[] = [];
  const seen = new Set<string>();

  for (const business of businesses) {
    if (seen.has(business.id)) {
      skipped.push({ businessId: business.id, recordName: business.name, reason: 'This record is already counted in the batch.' });
      continue;
    }
    seen.add(business.id);
    const eligible = identityBatchEligibility(business);
    if (!eligible.eligible) {
      skipped.push({ businessId: business.id, recordName: business.name, reason: eligible.reason });
      continue;
    }
    if (jobs.length >= IDENTITY_BATCH_LIMIT) {
      skipped.push({
        businessId: business.id,
        recordName: business.name,
        reason: `Only ${IDENTITY_BATCH_LIMIT} references run in one batch. Run this one in the next batch.`,
      });
      continue;
    }
    const typed = names[business.id];
    jobs.push({
      businessId: business.id,
      placeId: business.placesPlaceId ?? '',
      recordName: business.name,
      name: typed !== undefined ? typed : suggestedIdentityName(business),
      profile: identityProfileOf(business),
      state: 'pending',
      evidence: null,
      reading: null,
      reason: null,
      checkedAt: null,
    });
  }

  return { jobs, skipped };
}

/** The jobs a request may still run now: planned, named, and waiting. */
export function nextIdentityChunk(jobs: IdentityJob[], size = IDENTITY_BATCH_CHUNK): IdentityJob[] {
  return jobs.filter((job) => job.state === 'pending' && identityNameProblem(job.name) === null).slice(0, size);
}

// ── Cost, before anything is spent ───────────────────────────────────────────

export interface IdentityBatchEstimate {
  /** Checks that would actually run. */
  checks: number;
  /** Searches those checks may spend: the plan is bounded per check, so this is a ceiling. */
  searches: number;
  /** Homepage reads, at most one per shortlisted site. */
  pages: number;
  costUsd: number;
  /** Names still to be typed; they cannot be run or priced yet. */
  unnamed: number;
}

export function identityBatchEstimate(jobs: IdentityJob[], costPerQueryUsd = 0): IdentityBatchEstimate {
  let checks = 0;
  let searches = 0;
  let unnamed = 0;
  for (const job of jobs) {
    if (job.state !== 'pending') continue;
    if (identityNameProblem(job.name) !== null) {
      unnamed += 1;
      continue;
    }
    checks += 1;
    searches += planIdentityQueries(job.profile, job.name).length;
  }
  return {
    checks,
    searches,
    pages: checks * PLACE_IDENTITY_INSPECTION_LIMIT,
    costUsd: Math.round(searches * costPerQueryUsd * 1000) / 1000,
    unnamed,
  };
}

// ── Progress and transitions ─────────────────────────────────────────────────

export interface IdentityBatchProgress {
  total: number;
  done: number;
  remainingNames: number;
  byState: Record<IdentityJobState, number>;
  identified: number;
}

export function identityBatchProgress(jobs: IdentityJob[]): IdentityBatchProgress {
  const byState = Object.fromEntries(IDENTITY_JOB_STATES.map((s) => [s, 0])) as Record<IdentityJobState, number>;
  for (const job of jobs) byState[job.state] += 1;
  const done = IDENTITY_JOB_STATES.filter((s) => IDENTITY_JOB_META[s].done).reduce((n, s) => n + byState[s], 0);
  return {
    total: jobs.length,
    done,
    remainingNames: jobs.filter((job) => job.state === 'pending' && identityNameProblem(job.name) !== null).length,
    byState,
    identified: byState.identified,
  };
}

/** Marks a chunk as in flight, so the screen shows what is being read right now. */
export function startIdentityJobs(jobs: IdentityJob[], ids: string[]): IdentityJob[] {
  const set = new Set(ids);
  return jobs.map((job) => (set.has(job.businessId) ? { ...job, state: 'checking' as const, reason: null } : job));
}

/** Applies what the server returned. A row the server did not answer stays as it was. */
export function settleIdentityJobs(jobs: IdentityJob[], results: IdentityCheckResult[], checkedAt = new Date().toISOString()): IdentityJob[] {
  const byId = new Map(results.map((r) => [r.businessId, r]));
  return jobs.map((job) => {
    const result = byId.get(job.businessId);
    if (!result) return job;
    return {
      ...job,
      state: result.state,
      evidence: result.evidence,
      reading: result.reading,
      reason: result.reason,
      checkedAt: result.state === 'failed' || result.state === 'blocked' ? job.checkedAt : checkedAt,
    };
  });
}

/**
 * Ends every job that has not been answered. Used when the batch stops: the rows that never ran say
 * so, with the same reason, instead of looking like they are still waiting for something.
 */
export function stopIdentityJobs(jobs: IdentityJob[], state: 'blocked' | 'cancelled', reason: string | null): IdentityJob[] {
  return jobs.map((job) =>
    job.state === 'pending' || job.state === 'checking'
      ? { ...job, state, reason: state === 'blocked' ? reason : 'Stopped before this check ran.' }
      : job,
  );
}

/** Clears a check so it can run again, keeping nothing from the previous attempt. */
export function resetIdentityJobs(jobs: IdentityJob[], ids?: string[]): IdentityJob[] {
  const only = ids ? new Set(ids) : null;
  return jobs.map((job) =>
    (only ? only.has(job.businessId) : ['failed', 'blocked', 'cancelled', 'identified', 'ambiguous', 'not_found'].includes(job.state))
      ? { ...job, state: 'pending' as const, evidence: null, reading: null, reason: null, checkedAt: null }
      : job,
  );
}

/** Rows a person can usefully run again: the ones that produced no reading. */
export function retryableIdentityJobs(jobs: IdentityJob[]): string[] {
  return jobs.filter((job) => job.state === 'failed' || job.state === 'blocked' || job.state === 'cancelled').map((job) => job.businessId);
}

// ── Stops ────────────────────────────────────────────────────────────────────

/**
 * Whether a failed check blocks the whole batch. A missing key, a spent search quota or a reached
 * spending budget is a property of the workspace, so the next record in the batch would hit the same
 * wall; anything else belongs to the one record and the batch carries on.
 */
export function isBlockingIdentityFailure(status: number): boolean {
  return status === 403 || status === 429 || status === 503;
}

// ── Running a chunk ──────────────────────────────────────────────────────────

export type IdentityCheckRun =
  | { state: 'settled'; evidence: PlaceIdentityEvidence; reading: PlaceIdentityReading }
  | { state: 'failed'; reason: string }
  /** Nothing to do with this record: the run cannot continue for anyone (quota, budget, missing key). */
  | { state: 'blocked'; reason: string };

export interface IdentityChunkOutcome {
  results: IdentityCheckResult[];
  /** Set when the batch must stop; every job left in it is then `blocked` or `cancelled`. */
  stopped: { state: 'blocked' | 'cancelled'; reason: string | null } | null;
}

/**
 * Runs at most `concurrency` checks at a time and stops launching new ones as soon as the batch is
 * stopped: a blocked check means the next one would spend against the same empty quota, and an abort
 * means the person is no longer waiting for the answer. A check that answers after a cancel keeps its
 * reading, because it has already been paid for.
 */
export async function runIdentityChecks(
  jobs: IdentityJob[],
  check: (job: IdentityJob) => Promise<IdentityCheckRun>,
  options: { concurrency?: number; signal?: AbortSignal; onResult?: (result: IdentityCheckResult) => void } = {},
): Promise<IdentityChunkOutcome> {
  if (!jobs.length) return { results: [], stopped: null };
  const concurrency = Math.max(1, Math.min(options.concurrency ?? IDENTITY_BATCH_CONCURRENCY, jobs.length));
  const results: IdentityCheckResult[] = [];
  let stopped: IdentityChunkOutcome['stopped'] = null;
  let index = 0;

  const worker = async () => {
    while (true) {
      if (stopped) return;
      if (options.signal?.aborted) {
        stopped = { state: 'cancelled', reason: null };
        return;
      }
      const position = index++;
      if (position >= jobs.length) return;
      const job = jobs[position]!;

      let run: IdentityCheckRun;
      try {
        run = await check(job);
      } catch (error) {
        run = { state: 'failed', reason: error instanceof Error ? error.message : 'The check could not run.' };
      }

      const result: IdentityCheckResult =
        run.state === 'settled'
          ? { businessId: job.businessId, state: run.reading.status, evidence: run.evidence, reading: run.reading, reason: null }
          : { businessId: job.businessId, state: run.state, evidence: null, reading: null, reason: run.reason };
      results.push(result);
      options.onResult?.(result);

      if (run.state === 'blocked') {
        stopped = { state: 'blocked', reason: run.reason };
        return;
      }
      if (options.signal?.aborted) {
        stopped = { state: 'cancelled', reason: null };
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { results, stopped };
}
