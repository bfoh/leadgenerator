import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { fromRow, toRow } from '@/lib/data/supabase-store';
import type { CampaignActivity, CampaignRun, CampaignScope, CampaignStatus, CampaignTarget, CampaignTargetState, ResearchCampaign } from '@/lib/domain/campaigns';

/** A job that belongs to a campaign, as campaign progress needs it. */
export interface CampaignJob {
  id: string;
  agent: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
  businessId: string | null;
  campaignTargetId: string | null;
  estimatedCostUsd: number;
  lastError: string | null;
  errorKind: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CampaignCandidate {
  id: string;
  name: string;
  region: string | null;
  districtCode: string | null;
  city: string | null;
  neighborhood: string | null;
  category: string;
  contactPermission: string;
  mergedIntoId: string | null;
  stage: string;
  businessStatus: string;
  createdAt: string;
  opportunityScore: number | null;
}

export interface CampaignRunInsert {
  campaignId: string;
  status: CampaignRun['status'];
  targetsEnqueued?: number;
  targetsCompleted?: number;
  jobsOpen?: number;
  spendUsd?: number;
  note?: string | null;
}

export class CampaignError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'not_found' | 'forbidden' | 'conflict' | 'unavailable' = 'invalid',
  ) {
    super(message);
    this.name = 'CampaignError';
  }
}

type Row = Record<string, unknown>;

/** Maps a `research_campaigns` row to the domain object (scope and schedule are flattened columns). */
export function campaignFromRow(row: Row): ResearchCampaign {
  const r = fromRow<Record<string, unknown>>(row);
  return {
    id: String(r.id),
    organizationId: String(r.organizationId),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    status: r.status as CampaignStatus,
    providerKey: String(r.providerKey),
    scope: {
      regions: (r.regions as string[] | null) ?? [],
      districtCodes: (r.districtCodes as string[] | null) ?? [],
      towns: (r.towns as string[] | null) ?? [],
      categories: (r.categories as string[] | null) ?? [],
    },
    batchSize: Number(r.batchSize) || 10,
    dailyTargetLimit: Number(r.dailyTargetLimit) || 50,
    monthlyBudgetUsd: r.monthlyBudgetUsd == null ? null : Number(r.monthlyBudgetUsd),
    schedule: {
      frequency: r.scheduleFrequency as ResearchCampaign['schedule']['frequency'],
      hour: Number(r.scheduleHour) || 6,
      weekday: r.scheduleWeekday == null ? null : Number(r.scheduleWeekday),
      day: r.scheduleDay == null ? null : Number(r.scheduleDay),
    },
    autoComplete: r.autoComplete !== false,
    nextRunAt: (r.nextRunAt as string | null) ?? null,
    lastRunAt: (r.lastRunAt as string | null) ?? null,
    lastRunStatus: (r.lastRunStatus as ResearchCampaign['lastRunStatus']) ?? null,
    lastRunNote: (r.lastRunNote as string | null) ?? null,
    pausedReason: (r.pausedReason as string | null) ?? null,
    createdBy: (r.createdBy as string | null) ?? null,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  };
}

/** The writable columns for a campaign, from domain fields. */
export function campaignColumns(campaign: Partial<Omit<ResearchCampaign, 'scope'>> & { scope?: Partial<CampaignScope> }): Row {
  const row: Row = {};
  if (campaign.name !== undefined) row.name = campaign.name;
  if (campaign.description !== undefined) row.description = campaign.description;
  if (campaign.status !== undefined) row.status = campaign.status;
  if (campaign.providerKey !== undefined) row.provider_key = campaign.providerKey;
  if (campaign.scope?.regions !== undefined) row.regions = campaign.scope.regions;
  if (campaign.scope?.districtCodes !== undefined) row.district_codes = campaign.scope.districtCodes;
  if (campaign.scope?.towns !== undefined) row.towns = campaign.scope.towns;
  if (campaign.scope?.categories !== undefined) row.categories = campaign.scope.categories;
  if (campaign.batchSize !== undefined) row.batch_size = campaign.batchSize;
  if (campaign.dailyTargetLimit !== undefined) row.daily_target_limit = campaign.dailyTargetLimit;
  if (campaign.monthlyBudgetUsd !== undefined) row.monthly_budget_usd = campaign.monthlyBudgetUsd;
  if (campaign.autoComplete !== undefined) row.auto_complete = campaign.autoComplete;
  if (campaign.schedule) {
    row.schedule_frequency = campaign.schedule.frequency;
    row.schedule_hour = campaign.schedule.hour;
    row.schedule_weekday = campaign.schedule.weekday;
    row.schedule_day = campaign.schedule.day;
  }
  if (campaign.nextRunAt !== undefined) row.next_run_at = campaign.nextRunAt;
  if (campaign.lastRunAt !== undefined) row.last_run_at = campaign.lastRunAt;
  if (campaign.lastRunStatus !== undefined) row.last_run_status = campaign.lastRunStatus;
  if (campaign.lastRunNote !== undefined) row.last_run_note = campaign.lastRunNote;
  if (campaign.pausedReason !== undefined) row.paused_reason = campaign.pausedReason;
  return row;
}

export function targetFromRow(row: Row): CampaignTarget {
  const r = fromRow<Record<string, unknown>>(row);
  return {
    id: String(r.id),
    organizationId: String(r.organizationId),
    campaignId: String(r.campaignId),
    businessId: String(r.businessId),
    state: r.state as CampaignTargetState,
    matchReason: (r.matchReason as string | null) ?? null,
    source: (r.source as CampaignTarget['source']) ?? 'tracked',
    jobId: (r.jobId as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    addedBy: (r.addedBy as string | null) ?? null,
    addedAt: String(r.addedAt),
    startedAt: (r.startedAt as string | null) ?? null,
    completedAt: (r.completedAt as string | null) ?? null,
    updatedAt: String(r.updatedAt),
  };
}

export function runFromRow(row: Row): CampaignRun {
  const r = fromRow<Record<string, unknown>>(row);
  return {
    id: String(r.id),
    organizationId: String(r.organizationId),
    campaignId: String(r.campaignId),
    status: r.status as CampaignRun['status'],
    startedAt: String(r.startedAt),
    finishedAt: (r.finishedAt as string | null) ?? null,
    targetsEnqueued: Number(r.targetsEnqueued) || 0,
    targetsCompleted: Number(r.targetsCompleted) || 0,
    jobsOpen: Number(r.jobsOpen) || 0,
    spendUsd: Number(r.spendUsd) || 0,
    note: (r.note as string | null) ?? null,
    createdAt: String(r.createdAt),
  };
}

export const CAMPAIGN_MIGRATION_REQUIRED =
  'Campaigns need database migration 009. An owner must apply supabase/migrations/009_research_campaigns.sql (see docs/RUNBOOK.md).';

function campaignError(error: { code?: string; message?: string } | null, fallback: string): CampaignError {
  if (!error) return new CampaignError(fallback);
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42883') return new CampaignError(CAMPAIGN_MIGRATION_REQUIRED, 'unavailable');
  if (error.code === '42501') return new CampaignError('Your role does not allow this campaign action.', 'forbidden');
  if (error.code === '23505') return new CampaignError('That prospect is already in the campaign.', 'conflict');
  if (error.code === '23514' || error.code === '23503') return new CampaignError(error.message || 'The campaign change is not allowed.', 'conflict');
  if (error.code === 'P0002' || error.code === 'PGRST116') return new CampaignError('Campaign not found.', 'not_found');
  return new CampaignError(error.message || fallback);
}

/** Campaign persistence, always scoped to one workspace. Works with a member session or the worker. */
export class SupabaseCampaignStore {
  readonly mode = 'cloud' as const;

  constructor(
    private readonly sb: SupabaseClient,
    readonly organizationId: string,
  ) {}

  async listCampaigns(limit = 100): Promise<ResearchCampaign[]> {
    const { data, error } = await this.sb
      .from('research_campaigns')
      .select('*')
      .eq('organization_id', this.organizationId)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 200));
    if (error) throw campaignError(error, 'Could not load campaigns.');
    return (data ?? []).map(campaignFromRow);
  }

  async getCampaign(id: string): Promise<ResearchCampaign | null> {
    const { data, error } = await this.sb
      .from('research_campaigns')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw campaignError(error, 'Could not load the campaign.');
    return data ? campaignFromRow(data) : null;
  }

  /** Research currently executing (or queued to resume) for this campaign: memberships and open jobs. */
  async campaignActivity(id: string): Promise<CampaignActivity> {
    const [targets, jobs] = await Promise.all([
      this.sb
        .from('campaign_targets')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', this.organizationId)
        .eq('campaign_id', id)
        .in('state', ['queued', 'researching']),
      this.sb
        .from('automation_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', this.organizationId)
        .eq('campaign_id', id)
        .in('status', ['pending', 'running', 'awaiting_approval']),
    ]);
    if (targets.error) throw campaignError(targets.error, 'Could not check research in progress.');
    if (jobs.error) throw campaignError(jobs.error, 'Could not check research in progress.');
    return { researching: targets.count ?? 0, openJobs: jobs.count ?? 0 };
  }

  async createCampaign(columns: Row): Promise<ResearchCampaign> {
    const { data, error } = await this.sb
      .from('research_campaigns')
      .insert({ ...columns, organization_id: this.organizationId })
      .select('*')
      .single();
    if (error) throw campaignError(error, 'Could not create the campaign.');
    return campaignFromRow(data);
  }

  async updateCampaign(id: string, columns: Row): Promise<ResearchCampaign> {
    const { data, error } = await this.sb
      .from('research_campaigns')
      .update(columns)
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw campaignError(error, 'Could not save the campaign.');
    if (!data) throw new CampaignError('Campaign not found.', 'not_found');
    return campaignFromRow(data);
  }

  /** Claims a scheduled run by moving `next_run_at`; only one worker can win the update. */
  async claimScheduledRun(id: string, expectedNextRunAt: string, nextRunAtIso: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from('research_campaigns')
      .update({ next_run_at: nextRunAtIso })
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .eq('status', 'active')
      .eq('next_run_at', expectedNextRunAt)
      .select('id');
    if (error) throw campaignError(error, 'Could not claim the campaign run.');
    return (data ?? []).length > 0;
  }

  async deleteCampaign(id: string): Promise<void> {
    const { error } = await this.sb.from('research_campaigns').delete().eq('organization_id', this.organizationId).eq('id', id);
    if (error) throw campaignError(error, 'Could not delete the campaign.');
  }

  async listTargets(campaignId: string, limit = 500): Promise<CampaignTarget[]> {
    const { data, error } = await this.sb
      .from('campaign_targets')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('campaign_id', campaignId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(limit, 2000));
    if (error) throw campaignError(error, 'Could not load the campaign targets.');
    return (data ?? []).map(targetFromRow);
  }

  /** Target states across every campaign, for the dashboard's progress counts. */
  async listAllTargetStates(limit = 20_000): Promise<{ campaignId: string; state: CampaignTargetState }[]> {
    const { data, error } = await this.sb
      .from('campaign_targets')
      .select('campaign_id, state')
      .eq('organization_id', this.organizationId)
      .limit(limit);
    if (error) throw campaignError(error, 'Could not load campaign progress.');
    return (data ?? []).map((r) => ({ campaignId: String(r.campaign_id), state: r.state as CampaignTargetState }));
  }

  async listCampaignJobs(campaignId: string, limit = 1000): Promise<CampaignJob[]> {
    const { data, error } = await this.sb
      .from('automation_jobs')
      .select('id, agent, status, business_id, campaign_target_id, estimated_cost_usd, last_error, error_kind, created_at, finished_at')
      .eq('organization_id', this.organizationId)
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true })
      .limit(Math.min(limit, 2000));
    if (error) throw campaignError(error, 'Could not load the campaign jobs.');
    return (data ?? []).map((r) => ({
      id: String(r.id),
      agent: String(r.agent),
      status: r.status as CampaignJob['status'],
      businessId: (r.business_id as string | null) ?? null,
      campaignTargetId: (r.campaign_target_id as string | null) ?? null,
      estimatedCostUsd: Number(r.estimated_cost_usd) || 0,
      lastError: (r.last_error as string | null) ?? null,
      errorKind: (r.error_kind as string | null) ?? null,
      createdAt: String(r.created_at),
      finishedAt: (r.finished_at as string | null) ?? null,
    }));
  }

  async listRuns(campaignId: string, limit = 20): Promise<CampaignRun[]> {
    const { data, error } = await this.sb
      .from('campaign_runs')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('campaign_id', campaignId)
      .order('started_at', { ascending: false })
      .limit(Math.min(limit, 100));
    if (error) throw campaignError(error, 'Could not load the campaign run log.');
    return (data ?? []).map(runFromRow);
  }

  async createRun(input: CampaignRunInsert): Promise<CampaignRun> {
    const { data, error } = await this.sb
      .from('campaign_runs')
      .insert({
        organization_id: this.organizationId,
        campaign_id: input.campaignId,
        status: input.status,
        targets_enqueued: input.targetsEnqueued ?? 0,
        targets_completed: input.targetsCompleted ?? 0,
        jobs_open: input.jobsOpen ?? 0,
        spend_usd: input.spendUsd ?? 0,
        note: input.note ?? null,
      })
      .select('*')
      .single();
    if (error) throw campaignError(error, 'Could not record the campaign run.');
    return runFromRow(data);
  }

  async finishRun(id: string, patch: Partial<CampaignRunInsert> & { status: CampaignRun['status'] }): Promise<void> {
    const columns = toRow({
      status: patch.status,
      targetsEnqueued: patch.targetsEnqueued,
      targetsCompleted: patch.targetsCompleted,
      jobsOpen: patch.jobsOpen,
      spendUsd: patch.spendUsd,
      note: patch.note,
      finishedAt: new Date().toISOString(),
    });
    const { error } = await this.sb.from('campaign_runs').update(columns).eq('organization_id', this.organizationId).eq('id', id);
    if (error) throw campaignError(error, 'Could not finish the campaign run.');
  }

  /** Actual run cost plus the estimates of open jobs (migration 009 function; RLS applies). */
  async campaignSpend(campaignId: string): Promise<number> {
    const { data, error } = await this.sb.rpc('campaign_spend', { p_campaign: campaignId });
    if (error) throw campaignError(error, 'Could not read the campaign spend.');
    return Number(data) || 0;
  }

  async countTargetsStartedSince(campaignId: string, sinceIso: string): Promise<number> {
    const { count, error } = await this.sb
      .from('campaign_targets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', this.organizationId)
      .eq('campaign_id', campaignId)
      .gte('started_at', sinceIso);
    if (error) throw campaignError(error, 'Could not count today’s campaign targets.');
    return count ?? 0;
  }

  async targetedBusinessIds(campaignId: string, businessIds: string[]): Promise<Set<string>> {
    if (!businessIds.length) return new Set();
    const { data, error } = await this.sb
      .from('campaign_targets')
      .select('business_id')
      .eq('organization_id', this.organizationId)
      .eq('campaign_id', campaignId)
      .in('business_id', businessIds);
    if (error) throw campaignError(error, 'Could not check campaign membership.');
    return new Set((data ?? []).map((r) => String(r.business_id)));
  }

  /** Prospects already being researched elsewhere: another campaign, or any open automation job. */
  async busyBusinessIds(businessIds: string[], campaignId: string): Promise<Set<string>> {
    if (!businessIds.length) return new Set();
    const [targets, jobs] = await Promise.all([
      this.sb
        .from('campaign_targets')
        .select('business_id')
        .eq('organization_id', this.organizationId)
        .eq('state', 'researching')
        .neq('campaign_id', campaignId)
        .in('business_id', businessIds),
      this.sb
        .from('automation_jobs')
        .select('business_id')
        .eq('organization_id', this.organizationId)
        .in('status', ['pending', 'running'])
        .in('business_id', businessIds),
    ]);
    if (targets.error) throw campaignError(targets.error, 'Could not check research in progress.');
    if (jobs.error) throw campaignError(jobs.error, 'Could not check research in progress.');
    return new Set([...(targets.data ?? []), ...(jobs.data ?? [])].map((r) => String(r.business_id)).filter(Boolean));
  }

  async listCandidateBusinesses(limit = 1000): Promise<CampaignCandidate[]> {
    const { data, error } = await this.sb
      .from('businesses')
      .select('id, name, region, district_code, city, neighborhood, category, contact_permission, merged_into_id, stage, business_status, created_at, opportunity_score')
      .eq('organization_id', this.organizationId)
      .order('created_at', { ascending: true })
      .limit(Math.min(limit, 2000));
    if (error) throw campaignError(error, 'Could not load prospects for the campaign.');
    return (data ?? []).map(toCandidate);
  }

  async getCandidate(id: string): Promise<CampaignCandidate | null> {
    const { data, error } = await this.sb
      .from('businesses')
      .select('id, name, region, district_code, city, neighborhood, category, contact_permission, merged_into_id, stage, business_status, created_at, opportunity_score')
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw campaignError(error, 'Could not load the prospect.');
    return data ? toCandidate(data) : null;
  }

  async addTarget(values: { campaignId: string; businessId: string; matchReason: string | null; state?: CampaignTargetState }): Promise<CampaignTarget> {
    const { data, error } = await this.sb
      .from('campaign_targets')
      .insert({
        organization_id: this.organizationId,
        campaign_id: values.campaignId,
        business_id: values.businessId,
        match_reason: values.matchReason,
        state: values.state ?? 'queued',
      })
      .select('*')
      .single();
    if (error?.code === '23505') {
      const existing = await this.sb
        .from('campaign_targets')
        .select('*')
        .eq('organization_id', this.organizationId)
        .eq('campaign_id', values.campaignId)
        .eq('business_id', values.businessId)
        .maybeSingle();
      if (existing.error || !existing.data) throw campaignError(error, 'Could not add the prospect to the campaign.');
      return targetFromRow(existing.data);
    }
    if (error) throw campaignError(error, 'Could not add the prospect to the campaign.');
    return targetFromRow(data);
  }

  async updateTarget(id: string, patch: { state?: CampaignTargetState; jobId?: string | null; note?: string | null; startedAt?: string | null }): Promise<CampaignTarget> {
    const { data, error } = await this.sb
      .from('campaign_targets')
      .update(toRow(patch))
      .eq('organization_id', this.organizationId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw campaignError(error, 'Could not update the campaign target.');
    if (!data) throw new CampaignError('Campaign target not found.', 'not_found');
    return targetFromRow(data);
  }
}

function toCandidate(row: Record<string, unknown>): CampaignCandidate {
  return {
    id: String(row.id),
    name: String(row.name),
    region: (row.region as string | null) ?? null,
    districtCode: (row.district_code as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    neighborhood: (row.neighborhood as string | null) ?? null,
    category: String(row.category),
    contactPermission: String(row.contact_permission),
    mergedIntoId: (row.merged_into_id as string | null) ?? null,
    stage: String(row.stage),
    businessStatus: String(row.business_status),
    createdAt: String(row.created_at),
    opportunityScore: row.opportunity_score == null ? null : Number(row.opportunity_score),
  };
}
