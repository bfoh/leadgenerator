import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { BACKGROUND_WORKER_ID } from '@/lib/automation/constants';
import { tickDueCampaigns } from '@/lib/server/campaigns/orchestrator';
import { RUN_LIMITS, finishWithinMs, isBackgroundWorkerConfigured, runOrganizationQueue, workerOrganizations } from '@/lib/server/automation/runner';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok } from '@/lib/server/http';
import { serviceSupabase } from '@/lib/supabase/service';
import { logEvent } from '@/lib/server/log';

// Scheduled runner, called every minute by Supabase pg_cron + pg_net or Vercel Cron with
// `Authorization: Bearer $CRON_SECRET`. Disabled until CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY are
// set. Returns counts only — no organization identifiers or record data.
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // RUN_LIMITS.maxDurationMs

const MAX_ORGS = 20;

function authorized(req: NextRequest) {
  const expected = Buffer.from(`Bearer ${serverEnv.cronSecret()}`);
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  try {
    if (!isBackgroundWorkerConfigured()) throw new HttpError(503, 'The background worker is not configured.');
    if (!authorized(req)) throw new HttpError(401, 'Unauthorized.');

    const sb = serviceSupabase();
    const nowIso = new Date().toISOString();
    const paused = await sb.from('automation_settings').select('organization_id').eq('paused', true);
    if (paused.error) throw new HttpError(503, 'The job queue is unavailable.');
    const skip = new Set((paused.data ?? []).map((r) => r.organization_id as string));
    // Oldest first (see workerOrganizations).
    const { data, error } = await sb
      .from('automation_jobs')
      .select('organization_id')
      .or(`and(status.eq.pending,run_after.lte.${nowIso}),and(status.eq.running,locked_until.lt.${nowIso})`)
      .order('run_after', { ascending: true })
      .limit(500);
    if (error) throw new HttpError(503, 'The job queue is unavailable.');
    const orgIds = workerOrganizations((data ?? []) as { organization_id: string }[], skip, MAX_ORGS);

    const totals: Record<string, number> = {};
    let processed = 0;
    for (const orgId of orgIds) {
      const remaining = RUN_LIMITS.workerStartWindowMs - (Date.now() - startedAt);
      if (remaining < 5_000) break;
      try {
        const summary = await runOrganizationQueue({
          supabase: sb,
          orgId,
          requestCtx: { mode: 'worker', key: `worker:${orgId}`, userId: null, orgId, role: null, supabase: sb },
          actorLabel: 'Automation worker',
          workerId: BACKGROUND_WORKER_ID,
          maxJobs: 5,
          deadlineMs: remaining,
          finishWithinMs: finishWithinMs(startedAt),
        });
        processed += summary.processed;
        for (const o of summary.outcomes) totals[o.outcome] = (totals[o.outcome] ?? 0) + 1;
      } catch (orgError) {
        // One workspace's failure must not stop the others; details stay out of logs.
        void logEvent('error', 'cron_organization_failed', { error: orgError instanceof Error ? orgError.name : 'unknown' });
      }
    }
    // Campaigns reconcile and enqueue after the job loop: the jobs they queue run on the next tick.
    let campaigns = { ticked: 0, enqueued: 0, completed: 0, skipped: 0, failed: 0 };
    if (RUN_LIMITS.workerStartWindowMs - (Date.now() - startedAt) > 10_000) {
      try {
        const stopAt = Date.now() + finishWithinMs(startedAt) - 5_000;
        campaigns = await tickDueCampaigns(sb, new Date(), 20, stopAt);
      } catch (campaignError) {
        void logEvent('error', 'cron_campaigns_failed', { error: campaignError instanceof Error ? campaignError.name : 'unknown' });
      }
    }
    return ok({ organizations: orgIds.length, processed, outcomes: totals, campaigns });
  } catch (error) {
    return fail(error);
  }
}
