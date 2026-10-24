import type { NextRequest } from 'next/server';
import { campaignInputSchema, campaignTargetCounts, type CampaignSummary, type CampaignTargetState } from '@/lib/domain/campaigns';
import { campaignHttpError, requireCloud } from '@/lib/server/campaigns/api';
import { SupabaseCampaignStore, campaignColumns } from '@/lib/server/campaigns/store';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';

// Research campaigns: list and create. Campaigns are cloud-only (they queue server-side jobs) and
// every query is scoped to the caller's workspace.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'automation.run', { count: 60, windowMs: 60_000 });
    if (ctx.mode !== 'cloud') return ok({ campaigns: [], availability: 'demo' });
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const [campaigns, states] = await Promise.all([store.listCampaigns(), store.listAllTargetStates()]);
    const byCampaign = new Map<string, { state: CampaignTargetState }[]>();
    for (const row of states) {
      const list = byCampaign.get(row.campaignId) ?? [];
      list.push({ state: row.state });
      byCampaign.set(row.campaignId, list);
    }
    const summaries = await Promise.all(
      campaigns.map(async (campaign): Promise<CampaignSummary> => ({
        ...campaign,
        counts: campaignTargetCounts(byCampaign.get(campaign.id) ?? []),
        spendUsd: await store.campaignSpend(campaign.id).catch(() => 0),
      })),
    );
    return ok({ campaigns: summaries });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'automation.manage', { count: 20, windowMs: 60_000 });
    requireCloud(ctx);
    const input = await readJson(req, campaignInputSchema, 20_000);
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const campaign = await store.createCampaign(campaignColumns({ ...input, status: 'draft', nextRunAt: null }));
    return ok({ campaign }, { status: 201 });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}
