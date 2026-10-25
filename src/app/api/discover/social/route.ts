import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SOCIAL_DISCOVERY_PLATFORMS } from '@/lib/domain/social-discovery';
import { enforceBudget } from '@/lib/server/budget';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/providers/discovery';
import { searchSocialCandidates, socialDiscoveryStatus } from '@/lib/server/providers/social-discovery';
import { enforceQuota, recordUsage } from '@/lib/server/usage';

// Transient social discovery. The server never caches or stores a profile, a title or a snippet:
// the response is `no-store` and the browser keeps results in memory for the session only.
export const dynamic = 'force-dynamic';

const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((v) => v || null);

const socialSearchSchema = z
  .object({
    country: z.string().length(2),
    // A region with no town searches the whole region, as Google discovery does.
    region: optionalText(80),
    city: optionalText(80),
    category: z.string().trim().min(1).max(80),
    terms: optionalText(120),
    platforms: z.array(z.enum(SOCIAL_DISCOVERY_PLATFORMS)).min(1).max(SOCIAL_DISCOVERY_PLATFORMS.length),
    limit: z.number().int().min(1).max(20).default(20),
  })
  .refine((q) => q.city || q.region, { message: 'Choose a region or a city / town.', path: ['city'] });

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'discovery.run', { count: 10, windowMs: 60_000 });
    const status = socialDiscoveryStatus();
    if (!status.enabled) {
      throw new HttpError(
        503,
        status.searchConfigured
          ? 'Social discovery is switched off on this server.'
          : 'Social discovery needs a web-search API key on the server.',
      );
    }
    const input = await readJson(req, socialSearchSchema, 10_000);

    // Simulated results cost nothing and touch no provider.
    const metered = !status.simulated;
    if (metered) {
      await enforceQuota(ctx, 'social_discovery_search', serverEnv.socialDiscovery.quota());
      await enforceBudget(ctx, { brave_search: status.costPerQueryUsd * input.platforms.length });
    }

    const outcome = await searchSocialCandidates(input, {
      signal: AbortSignal.timeout(20_000),
      // Recorded in every mode: demo mode counts in server memory, so DAILY_SOCIAL_DISCOVERY_QUOTA
      // is a real brake on a local machine too. A paid query is never invisible to the quota.
      onQueryAnswered: metered
        ? async (query) => {
            await recordUsage(ctx, {
              provider: 'brave_search',
              operation: 'social_discovery_search',
              units: 1,
              estimatedCostUsd: status.costPerQueryUsd,
              metadata: {
                platform: query.platform,
                query: query.query,
                category: input.category,
                region: input.region,
                city: input.city,
              },
            });
          }
        : undefined,
    });

    return ok({
      candidates: outcome.candidates.slice(0, input.limit),
      queries: outcome.queries,
      simulated: outcome.simulated,
      // Stated explicitly so a client can never mistake this for a stored list.
      retained: false,
      usage: metered
        ? {
            provider: 'brave_search',
            operation: 'social_discovery_search',
            units: outcome.queries.length,
            estimatedCostUsd: outcome.estimatedCostUsd,
            metadata: { category: input.category, region: input.region, city: input.city, platforms: input.platforms },
          }
        : null,
      retrievedAt: outcome.retrievedAt,
    });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}
