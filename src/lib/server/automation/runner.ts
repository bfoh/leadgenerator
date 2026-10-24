import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { processQueue, type QueueRunSummary } from '@/lib/automation/engine';
import { MIGRATION_REQUIRED, SupabaseAutomationStore } from '@/lib/automation/supabase-store';
import type { ServiceContext } from '@/lib/data/services';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { serviceRoleKey } from '@/lib/supabase/service';
import type { RequestContext } from '../context';
import { serverEnv } from '../env';
import { HttpError } from '../http';
import { serverToolGateway } from './tools';

/** The scheduled worker runs only when Supabase, CRON_SECRET and the service-role key are all set. */
export function isBackgroundWorkerConfigured() {
  return Boolean(isSupabaseConfigured() && serverEnv.cronSecret() && serviceRoleKey());
}

/**
 * Which workspaces one scheduled run visits, from due rows ordered oldest first: the longest-waiting
 * come first, so every workspace is reached when more than `max` have work. A paused workspace claims
 * nothing (its expired leases are recovered when it resumes), so it must not take the place of one
 * with work to do.
 */
export function workerOrganizations(due: { organization_id: string }[], paused: ReadonlySet<string>, max: number) {
  return [...new Set(due.map((r) => r.organization_id))].filter((id) => !paused.has(id)).slice(0, max);
}

/**
 * Time limits for the routes that run jobs (maxDuration 300 s, the Vercel Hobby maximum with Fluid
 * compute; each route file repeats the number because Next.js reads it statically). Jobs start only in
 * the first `startWindowMs`, and only when the longest job (engine LONGEST_JOB_MS) can finish before
 * `maxDurationMs - stopMarginMs`, so the platform never stops a job mid-run.
 */
export const RUN_LIMITS = {
  maxDurationMs: 300_000,
  stopMarginMs: 15_000,
  /** Scheduled worker: called every minute. */
  workerStartWindowMs: 50_000,
  /** "Process queue now" and the other buttons that run jobs straight away. */
  foregroundStartWindowMs: 45_000,
} as const;

/** Time left, from `startedAt`, before a run must have finished. */
export const finishWithinMs = (startedAt: number, now = Date.now()) => RUN_LIMITS.maxDurationMs - RUN_LIMITS.stopMarginMs - (now - startedAt);

/** Placeholder actor for the scheduled worker. Agents never write it into user-id columns. */
export const WORKER_ACTOR = 'automation-worker';

/**
 * Processes due jobs for one organization. With a member's session the worker can do only what that
 * member's role allows (RLS); with the service-role client every query is still scoped to `orgId`.
 */
export async function runOrganizationQueue(options: {
  supabase: SupabaseClient;
  orgId: string;
  requestCtx: Exclude<RequestContext, { mode: 'demo' }>;
  actorLabel: string;
  workerId: string;
  maxJobs: number;
  /** No job starts after this. */
  deadlineMs: number;
  /** When the route will be stopped; see RUN_LIMITS. */
  finishWithinMs: number;
}): Promise<QueueRunSummary> {
  const automation = new SupabaseAutomationStore(options.supabase, options.orgId);
  if (!(await automation.isAvailable())) throw new HttpError(409, MIGRATION_REQUIRED);
  const store = new SupabaseStore(options.supabase, options.orgId);
  const svc: ServiceContext = {
    store,
    settings: await store.getSettings(),
    userId: options.requestCtx.userId ?? WORKER_ACTOR,
    userLabel: options.actorLabel,
  };
  return processQueue(
    { automation, svc, tools: serverToolGateway(options.requestCtx), workerId: options.workerId, outboundAvailable: false },
    { maxJobs: options.maxJobs, deadlineMs: options.deadlineMs, finishWithinMs: options.finishWithinMs },
  );
}
