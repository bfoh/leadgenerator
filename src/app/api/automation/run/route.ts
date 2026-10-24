import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { RUN_LIMITS, finishWithinMs, runOrganizationQueue } from '@/lib/server/automation/runner';
import { requireContext } from '@/lib/server/context';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';

// Foreground runner: a signed-in member processes their workspace's due jobs under their own session,
// so RLS limits the worker to what their role allows. Bounded to a few jobs per request.
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // RUN_LIMITS.maxDurationMs

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const ctx = await requireContext(req, 'automation.run', { count: 12, windowMs: 60_000 });
    const { maxJobs } = await readJson(req, z.object({ maxJobs: z.number().int().min(1).max(5).default(3) }), 1_000);
    if (ctx.mode !== 'cloud') throw new HttpError(400, 'In demo mode the queue runs in your browser.');
    const summary = await runOrganizationQueue({
      supabase: ctx.supabase,
      orgId: ctx.orgId,
      requestCtx: ctx,
      actorLabel: 'Automation (started by a team member)',
      workerId: `web:${ctx.userId.slice(0, 8)}`,
      maxJobs,
      deadlineMs: RUN_LIMITS.foregroundStartWindowMs,
      finishWithinMs: finishWithinMs(startedAt),
    });
    return ok(summary);
  } catch (error) {
    return fail(error);
  }
}
