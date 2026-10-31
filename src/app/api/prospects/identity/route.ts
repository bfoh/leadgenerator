import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { identityProfileOf, identityProfileSchema, type IdentityProfile } from '@/lib/domain/place-identity';
import { requireContext } from '@/lib/server/context';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { runPlaceIdentityCheck } from '@/lib/server/place-identity';
import { researchRateLimit } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';

/**
 * Identifies a Place-ID-only reference from independent public sources.
 *
 * A workspace record with only a Place ID carries no name to search for, so the person supplies the
 * name they are looking for. In a signed-in workspace the record is read here, from the store that
 * belongs to the caller, and the returned evidence describes that record. Nothing is written: the
 * reading is returned for review, and acceptance is a separate, re-validated step.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'prospects.write', researchRateLimit(12));
    const body = await readJson(
      req,
      z.object({
        businessId: z.uuid(),
        name: z.string().trim().min(3).max(200),
        /** Demo mode only: the browser holds the demo store, so the record travels with the request. */
        profile: identityProfileSchema.optional(),
      }),
      4_000,
    );

    let profile: IdentityProfile;
    if (ctx.mode === 'cloud' || ctx.mode === 'worker') {
      const business = await new SupabaseStore(ctx.supabase, ctx.orgId).getBusiness(body.businessId);
      if (!business) throw new HttpError(404, 'Prospect not found in this workspace.');
      profile = identityProfileOf(business);
    } else {
      if (!body.profile) throw new HttpError(400, 'The record is missing from the request.');
      profile = body.profile;
    }

    const { evidence, reading, simulated } = await runPlaceIdentityCheck(ctx, { profile, name: body.name });
    return ok({ evidence, reading, simulated, retrievedAt: new Date().toISOString() });
  } catch (error) {
    return fail(error);
  }
}
