import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseStore } from '@/lib/data/supabase-store';
import {
  IDENTITY_BATCH_CHUNK,
  IDENTITY_BATCH_CONCURRENCY,
  isBlockingIdentityFailure,
  runIdentityChecks,
} from '@/lib/domain/identity-batch';
import { identityProfileSchema } from '@/lib/domain/place-identity';
import { requireContext } from '@/lib/server/context';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { prepareIdentityBatch } from '@/lib/server/identity-batch';
import { runPlaceIdentityCheck } from '@/lib/server/place-identity';
import { researchRateLimit, researchToolStatus } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';
// A chunk is a few checks, and each one is bounded; the browser sends the next chunk in its own
// request, so no request ever carries a whole batch.
export const maxDuration = 60;

/**
 * Identifies a few Place-ID-only references per request, with the same rules and the same evidence as
 * the single-record check.
 *
 * Nothing is written. Each check returns a reading for one record; acceptance is a separate action per
 * record, re-validated against that record as it stands. A check that reports an exhausted quota, a
 * reached budget or a missing key stops the chunk: the remaining records are not attempted, because
 * they would spend against the same wall.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'prospects.write', researchRateLimit(12));
    const body = await readJson(
      req,
      z
        .object({
          jobs: z
            .array(
              z.object({
                businessId: z.uuid(),
                /** The reference the person saw. It must still be the record's Place ID. */
                placeId: z.string().trim().min(1).max(300),
                name: z.string().trim().min(1).max(200),
                /** Demo mode only: the browser holds the demo store, so the record travels with it. */
                profile: identityProfileSchema.optional(),
              }),
            )
            .min(1)
            .max(IDENTITY_BATCH_CHUNK),
        })
        .refine((input) => new Set(input.jobs.map((job) => job.businessId)).size === input.jobs.length, {
          message: 'A record appears twice in the same batch.',
          path: ['jobs'],
        }),
      32_000,
    );

    const store = ctx.mode === 'cloud' || ctx.mode === 'worker' ? new SupabaseStore(ctx.supabase, ctx.orgId) : null;
    // In a cloud workspace every record is re-read from the caller's own store; only demo mode trusts
    // the profile the browser sent, because the demo store lives in the browser.
    const { jobs: prepared, rejected } = await prepareIdentityBatch(
      body.jobs,
      store ? (businessId) => store.getBusiness(businessId) : null,
    );

    const outcome = await runIdentityChecks(
      prepared,
      async (job) => {
        try {
          const run = await runPlaceIdentityCheck(ctx, { profile: job.profile, name: job.name });
          return { state: 'settled' as const, evidence: run.evidence, reading: run.reading };
        } catch (error) {
          if (error instanceof HttpError) {
            // A missing key, a spent quota or a reached budget belongs to the workspace, not to this
            // record, so the rest of the batch is not attempted.
            if (isBlockingIdentityFailure(error.status)) return { state: 'blocked' as const, reason: error.message };
            return { state: 'failed' as const, reason: error.message };
          }
          return { state: 'failed' as const, reason: 'The check could not run. Try again.' };
        }
      },
      { concurrency: IDENTITY_BATCH_CONCURRENCY },
    );

    const blocked = outcome.stopped?.state === 'blocked' ? { reason: outcome.stopped.reason ?? 'The batch was stopped.' } : null;
    return ok({
      results: [...rejected, ...outcome.results],
      blocked,
      // True when the checks read the labelled simulated world rather than the public web.
      simulated: researchToolStatus().simulated,
      retrievedAt: new Date().toISOString(),
    });
  } catch (error) {
    return fail(error);
  }
}
