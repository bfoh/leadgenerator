import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { ProviderError, describeProvider } from '@/lib/server/providers/discovery';
import { discoveryProvider } from '@/lib/server/providers/registry';
import { enforceBudget } from '@/lib/server/budget';
import { enforceQuota, recordUsage } from '@/lib/server/usage';

// Transient discovery. Responses are never cached or persisted by the server; the client keeps
// results in memory only. Only Place IDs may be stored, by explicit user action.
export const dynamic = 'force-dynamic';

const searchSchema = z.object({
  providerId: z.string().max(40),
  country: z.string().length(2),
  region: z.string().max(80).nullable(),
  city: z.string().trim().min(1).max(80),
  neighborhood: z.string().max(80).nullable(),
  category: z.string().trim().min(1).max(80),
  terms: z.string().max(120).nullable(),
  limit: z.number().int().min(1).max(20),
  pageToken: z.string().max(2000).nullable(),
  websitePreference: z.enum(['any', 'missing', 'present']),
});

function providerOr404(id: string) {
  const provider = discoveryProvider(id);
  if (!provider) throw new HttpError(404, 'Unknown discovery provider.');
  if (!provider.isConfigured()) throw new HttpError(503, `${provider.name} is not configured on the server.`);
  return provider;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'discovery.run', { count: 20, windowMs: 60_000 });
    const input = await readJson(req, searchSchema, 10_000);
    const provider = providerOr404(input.providerId);
    const metered = !provider.getCapabilities().isDemo;
    if (metered) {
      await enforceQuota(ctx, 'discovery_search', serverEnv.quota.discovery());
      if (provider.id === 'google_places') await enforceBudget(ctx, { google_places: provider.estimatedCostUsd('search') });
    }

    const page = await provider.search(input, AbortSignal.timeout(10_000));
    const usage = metered
      ? await recordUsage(ctx, {
          provider: provider.id,
          operation: 'discovery_search',
          units: 1,
          estimatedCostUsd: provider.estimatedCostUsd('search'),
          metadata: { city: input.city, category: input.category, results: page.results.length },
        })
      : null;

    const results = page.results.filter((r) =>
      input.websitePreference === 'missing' ? !r.websiteUri : input.websitePreference === 'present' ? Boolean(r.websiteUri) : true,
    );
    return ok({
      results,
      filteredOut: page.results.length - results.length,
      nextPageToken: page.nextPageToken,
      provider: describeProvider(provider),
      usage,
      retrievedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'discovery.run', { count: 30, windowMs: 60_000 });
    const providerId = req.nextUrl.searchParams.get('provider') ?? '';
    const id = req.nextUrl.searchParams.get('id') ?? '';
    const provider = providerOr404(providerId);
    if (!id) throw new HttpError(400, 'Missing place reference.');
    const metered = !provider.getCapabilities().isDemo;
    if (metered) {
      await enforceQuota(ctx, 'discovery_details', serverEnv.quota.discovery());
      if (provider.id === 'google_places') await enforceBudget(ctx, { google_places: provider.estimatedCostUsd('details') });
    }
    const result = await provider.getDetails(id, AbortSignal.timeout(10_000));
    const usage = metered
      ? await recordUsage(ctx, { provider: provider.id, operation: 'discovery_details', units: 1, estimatedCostUsd: provider.estimatedCostUsd('details') })
      : null;
    return ok({ result, provider: describeProvider(provider), usage, retrievedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}
