import type { NextRequest } from 'next/server';
import { campaignHttpError, requireCloud } from '@/lib/server/campaigns/api';
import { CampaignError, SupabaseCampaignStore } from '@/lib/server/campaigns/store';
import { tickCampaign } from '@/lib/server/campaigns/orchestrator';
import { requireContext } from '@/lib/server/context';
import { fail, ok } from '@/lib/server/http';

// Runs one campaign tick now: reconcile finished work and queue the next batch. The scheduled worker
// does the same on the campaign's schedule; this button is for a person who does not want to wait.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireContext(req, 'automation.run', { count: 6, windowMs: 60_000 });
    requireCloud(ctx);
    const { id } = await params;
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const campaign = await store.getCampaign(id);
    if (!campaign) throw new CampaignError('Campaign not found.', 'not_found');
    if (campaign.status !== 'active') throw new CampaignError('Activate the campaign before running it.', 'conflict');
    const result = await tickCampaign(ctx.supabase, ctx.orgId, campaign, { enqueue: true });
    return ok({ result });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}
