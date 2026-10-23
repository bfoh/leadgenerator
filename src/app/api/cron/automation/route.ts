import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { isBackgroundWorkerConfigured, runOrganizationQueue } from '@/lib/server/automation/runner';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok } from '@/lib/server/http';
import { serviceSupabase } from '@/lib/supabase/service';
import { logEvent } from '@/lib/server/log';

// Scheduled runner, called every minute by Supabase pg_cron + pg_net or Vercel Cron with
// `Authorization: Bearer $CRON_SECRET`. Disabled until CRON_SECRET and SUPABASE_SERVICE_ROLE_KEY are
// set. Returns counts only — no organization identifiers or record data.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ORGS = 20;
const DEADLINE_MS = 50_000;

function authorized(req: NextRequest) {
  const expected = Buffer.from(`Bearer ${serverEnv.cronSecret()}`);
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: NextRequest) {
  try {
    if (!isBackgroundWorkerConfigured()) throw new HttpError(503, 'The background worker is not configured.');
    if (!authorized(req)) throw new HttpError(401, 'Unauthorized.');

    const sb = serviceSupabase();
    const nowIso = new Date().toISOString();
    const { data, error } = await sb
      .from('automation_jobs')
      .select('organization_id')
      .or(`and(status.eq.pending,run_after.lte.${nowIso}),and(status.eq.running,locked_until.lt.${nowIso})`)
      .limit(500);
    if (error) throw new HttpError(503, 'The job queue is unavailable.');
    const orgIds = [...new Set((data ?? []).map((r) => r.organization_id as string))].slice(0, MAX_ORGS);

    const started = Date.now();
    const totals: Record<string, number> = {};
    let processed = 0;
    for (const orgId of orgIds) {
      const remaining = DEADLINE_MS - (Date.now() - started);
      if (remaining < 5_000) break;
      try {
        const summary = await runOrganizationQueue({
          supabase: sb,
          orgId,
          requestCtx: { mode: 'worker', key: `worker:${orgId}`, userId: null, orgId, role: null, supabase: sb },
          actorLabel: 'Automation worker',
          workerId: 'cron',
          maxJobs: 5,
          deadlineMs: remaining,
        });
        processed += summary.processed;
        for (const o of summary.outcomes) totals[o.outcome] = (totals[o.outcome] ?? 0) + 1;
      } catch (orgError) {
        // One workspace's failure must not stop the others; details stay out of logs.
        void logEvent('error', 'cron_organization_failed', { error: orgError instanceof Error ? orgError.name : 'unknown' });
      }
    }
    return ok({ organizations: orgIds.length, processed, outcomes: totals });
  } catch (error) {
    return fail(error);
  }
}
