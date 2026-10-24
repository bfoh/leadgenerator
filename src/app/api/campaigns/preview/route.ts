import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { campaignCandidates, campaignScopeSchema, campaignIneligibility } from '@/lib/domain/campaigns';
import { campaignHttpError, requireCloud } from '@/lib/server/campaigns/api';
import { SupabaseCampaignStore } from '@/lib/server/campaigns/store';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';

// Counts the tracked prospects a scope would target, and shows the first few. Nothing is stored.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const previewSchema = z.object({ scope: campaignScopeSchema });

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'automation.run', { count: 30, windowMs: 60_000 });
    requireCloud(ctx);
    const { scope } = await readJson(req, previewSchema, 20_000);
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const pool = await store.listCandidateBusinesses(2000);
    const matched = campaignCandidates(pool, scope);
    const excluded = pool.filter((business) => campaignIneligibility(business)).length;
    return ok({
      matched: matched.length,
      excluded,
      sample: matched.slice(0, 10).map(({ business, reason }) => ({
        id: business.id,
        name: business.name,
        region: business.region,
        city: business.city,
        category: business.category,
        reason,
      })),
    });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}
