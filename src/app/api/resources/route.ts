import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { restrictedResourceUrl } from '@/lib/domain/business-resources';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { fail, HttpError, ok, readJson } from '@/lib/server/http';
import { collectGoogleListing, collectGooglePhoto, resourceGoogleStatus, searchResourcePlaces, simulatedResourceWebsite } from '@/lib/server/resource-collector';
import { researchRateLimit } from '@/lib/server/research-tools';
import { inspectResourceWebsite, parsePublicUrl } from '@/lib/server/safe-fetch';
import { ProviderError } from '@/lib/server/providers/discovery';
import { enforceQuota, recordUsage } from '@/lib/server/usage';

export const dynamic = 'force-dynamic';
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('details'), businessId: z.uuid(), placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/), authorized: z.literal(true) }),
  z.object({ action: z.literal('search'), businessId: z.uuid(), query: z.string().trim().min(3).max(200), country: z.string().regex(/^[A-Z]{2}$/), authorized: z.literal(true) }),
  z.object({ action: z.literal('photo'), businessId: z.uuid(), name: z.string().regex(/^places\/[A-Za-z0-9_-]{10,300}\/photos\/[A-Za-z0-9_-]{1,1500}$/), authorized: z.literal(true) }),
  z.object({ action: z.literal('website'), businessId: z.uuid(), url: z.string().max(2000), independentlyVerified: z.literal(true) }),
]);

export async function GET(req: NextRequest) {
  try { await requireContext(req, 'studio.write'); return ok(resourceGoogleStatus()); } catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', researchRateLimit(20));
    const input = await readJson(req, schema, 8_000);
    if (ctx.mode === 'cloud' && !(await new SupabaseStore(ctx.supabase, ctx.orgId).getBusiness(input.businessId))) throw new HttpError(404, 'Prospect not found in this workspace.');
    if (input.action === 'search') return ok({ results: await searchResourcePlaces(ctx, input.query, input.country), simulated: serverEnv.simulateExternalTools() });
    if (input.action === 'details') return ok({ listing: await collectGoogleListing(ctx, input.placeId) });
    if (input.action === 'photo') return ok({ uri: await collectGooglePhoto(ctx, input.name) });
    let url: URL;
    try { url = parsePublicUrl(input.url); } catch { throw new HttpError(400, 'Use a public official website on a standard web port.'); }
    if (restrictedResourceUrl(url.href)) throw new HttpError(400, 'Google and social platforms are preview/source links, not independent websites to analyze.');
    if (serverEnv.simulateExternalTools()) {
      return ok(simulatedResourceWebsite(url.href));
    }
    await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
    // Reserve the zero-cost quota before network access, including failed/blocked reads.
    await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { purpose: 'resources' } }, { required: true });
    return ok(await inspectResourceWebsite(url.href));
  } catch (e) { return fail(e instanceof ProviderError ? new HttpError(e.retryable ? 503 : 400, e.message) : e); }
}
