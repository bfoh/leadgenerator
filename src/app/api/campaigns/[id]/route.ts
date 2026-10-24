import type { NextRequest } from 'next/server';
import {
  campaignEditAccess,
  campaignPatchSchema,
  campaignScheduleEquals,
  campaignScopeEquals,
  campaignStatusTransitionAllowed,
  nextRunAt,
} from '@/lib/domain/campaigns';
import { campaignProviderBlocker } from '@/lib/domain/discovery-providers';
import { campaignHttpError, requireCloud } from '@/lib/server/campaigns/api';
import { CampaignError, SupabaseCampaignStore, campaignColumns } from '@/lib/server/campaigns/store';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';

// One campaign: its detail (targets, jobs, runs, spend), changes, and deletion of a draft.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireContext(req, 'automation.run', { count: 60, windowMs: 60_000 });
    requireCloud(ctx);
    const { id } = await params;
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const campaign = await store.getCampaign(id);
    if (!campaign) throw new CampaignError('Campaign not found.', 'not_found');
    const [targets, runs, jobs, spendUsd, activity] = await Promise.all([
      store.listTargets(id, 500),
      store.listRuns(id, 20),
      store.listCampaignJobs(id, 200),
      store.campaignSpend(id).catch(() => 0),
      store.campaignActivity(id),
    ]);
    const ids = [...new Set(targets.map((target) => target.businessId))];
    const businesses = ids.length
      ? await ctx.supabase
          .from('businesses')
          .select('id, name, region, city, category, opportunity_score')
          .eq('organization_id', ctx.orgId)
          .in('id', ids)
          .limit(500)
      : { data: [], error: null };
    if (businesses.error) throw new CampaignError('Could not load the campaign’s prospects.', 'unavailable');
    return ok({
      campaign,
      targets,
      runs,
      jobs,
      spendUsd,
      activity,
      businesses: (businesses.data ?? []).map((b) => ({
        id: String(b.id),
        name: String(b.name),
        region: (b.region as string | null) ?? null,
        city: (b.city as string | null) ?? null,
        category: String(b.category),
        opportunityScore: b.opportunity_score == null ? null : Number(b.opportunity_score),
      })),
    });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireContext(req, 'automation.manage', { count: 30, windowMs: 60_000 });
    requireCloud(ctx);
    const { id } = await params;
    const input = await readJson(req, campaignPatchSchema, 20_000);
    if (input.providerKey) {
      const blocker = campaignProviderBlocker(input.providerKey);
      if (blocker) throw new CampaignError(blocker, 'invalid');
    }
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const current = await store.getCampaign(id);
    if (!current) throw new CampaignError('Campaign not found.', 'not_found');

    const activity = await store.campaignActivity(id);
    const access = campaignEditAccess(current.status, activity);
    const editing = (['name', 'description', 'scope', 'batchSize', 'dailyTargetLimit', 'monthlyBudgetUsd', 'schedule', 'autoComplete'] as const).some(
      (field) => input[field] !== undefined,
    );
    // The edit form sends the whole campaign, so an unchanged scope or schedule is not a change.
    const scopeChanged = input.scope !== undefined && !campaignScopeEquals(input.scope, current.scope);
    const scheduleChanged = input.schedule !== undefined && !campaignScheduleEquals(input.schedule, current.schedule);
    if (editing) {
      if (access.reason) throw new CampaignError(access.reason, 'conflict');
      if ((scopeChanged || scheduleChanged) && !access.scope) {
        throw new CampaignError(access.scopeReason ?? 'Research is still running for this campaign.', 'conflict');
      }
    }
    if (input.providerKey && input.providerKey !== current.providerKey) {
      throw new CampaignError('The research provider cannot be changed after a campaign is saved.', 'conflict');
    }
    if (input.status && input.status !== current.status && !access.status) {
      throw new CampaignError(access.reason ?? 'This campaign cannot change status.', 'conflict');
    }

    const columns = campaignColumns(input);
    if (input.status) {
      if (!campaignStatusTransitionAllowed(current.status, input.status)) {
        throw new CampaignError(`A ${current.status} campaign cannot become ${input.status}.`, 'conflict');
      }
      columns.status = input.status;
      const schedule = input.schedule ?? current.schedule;
      if (input.status === 'active') {
        columns.next_run_at = nextRunAt(schedule);
        columns.paused_reason = null;
      } else if (input.status === 'paused') {
        columns.next_run_at = null;
        columns.paused_reason = input.pausedReason ?? 'Paused by a team member.';
      } else {
        columns.next_run_at = null;
      }
    } else if (scheduleChanged) {
      columns.next_run_at = current.status === 'active' ? nextRunAt(input.schedule ?? current.schedule) : null;
    }

    if (!Object.keys(columns).length) return ok({ campaign: current });
    const campaign = await store.updateCampaign(id, columns);
    return ok({ campaign });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireContext(req, 'automation.manage', { count: 20, windowMs: 60_000 });
    requireCloud(ctx);
    const { id } = await params;
    const store = new SupabaseCampaignStore(ctx.supabase, ctx.orgId);
    const campaign = await store.getCampaign(id);
    if (!campaign) throw new CampaignError('Campaign not found.', 'not_found');
    if (campaign.status !== 'draft' && campaign.status !== 'cancelled') {
      throw new CampaignError('Only a draft or cancelled campaign can be deleted. Cancel it first to keep its history.', 'conflict');
    }
    await store.deleteCampaign(id);
    return ok({ deleted: true });
  } catch (error) {
    return fail(campaignHttpError(error));
  }
}
