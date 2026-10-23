// Cloud automation queue through the SECURITY DEFINER functions in migration 003. Works with a
// member's session (RLS) or, in the scheduled worker, a server-only service-role client — every
// query is scoped to this store's organization either way.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { fromRow, toRow } from '@/lib/data/supabase-store';
import { DEFAULT_SENDING_POLICY, resolveSendingPolicy, sendingPolicySchema } from '@/lib/domain/sending-policy';
import { budgetsSchema } from './budget';
import { MODE_META } from './constants';
import { AutomationError, emptyCounts, type AutomationStore, type RunFilter } from './store';
import type { AgentRun, AgentRunInsert, AutomationJob, AutomationSettings, AutomationSettingsPatch, FinishRequest, JobFilter, JobRequest, SettingsChange } from './types';

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);
export const MIGRATION_REQUIRED = 'Automation needs database migration 003. An owner must apply supabase/migrations/003_automation_infrastructure.sql (see docs/RUNBOOK.md).';
export const SENDING_MIGRATION_REQUIRED = 'The sending policy needs database migration 007. An owner must apply supabase/migrations/007_sending_policy.sql (see docs/RUNBOOK.md).';
const SENDING_FIELDS = ['sendingPolicy', 'sendingPaused', 'sendingPauseReason'] as const;

export function automationError(error: PostgrestError | null, fallback = 'The automation request failed.'): AutomationError {
  if (!error) return new AutomationError(fallback);
  if (MISSING.has(error.code)) return new AutomationError(MIGRATION_REQUIRED, 'unavailable');
  if (error.code === '42501') return new AutomationError(error.message.includes('role') || error.message.includes('Only') ? error.message : 'Your role does not allow this automation action.', 'forbidden');
  if (error.code === '55000') return new AutomationError(error.message, 'stale_lease');
  if (error.code === '23514' || error.code === '23503' || error.code === '22023') return new AutomationError(error.message, 'conflict');
  if (error.code === 'P0002' || error.code === 'PGRST116') return new AutomationError('Job not found.', 'not_found');
  return new AutomationError(error.message || fallback);
}

const NUMERIC = (job: AutomationJob) => ({ ...job, estimatedCostUsd: Number(job.estimatedCostUsd) || 0 });
const toJob = (row: Record<string, unknown>) => NUMERIC(fromRow<AutomationJob>(row));
const toRun = (row: Record<string, unknown>) => {
  const run = fromRow<AgentRun>(row);
  return { ...run, estimatedCostUsd: Number(run.estimatedCostUsd) || 0 };
};

export class SupabaseAutomationStore implements AutomationStore {
  readonly mode = 'cloud' as const;
  private available: boolean | null = null;

  constructor(
    private readonly sb: SupabaseClient,
    readonly organizationId: string,
  ) {}

  async isAvailable() {
    if (this.available !== null) return this.available;
    const { error } = await this.sb.from('automation_settings').select('organization_id').eq('organization_id', this.organizationId).limit(1);
    if (error && !MISSING.has(error.code)) throw automationError(error);
    this.available = !error;
    return this.available;
  }

  async getSettings(): Promise<AutomationSettings> {
    const { data, error } = await this.sb.from('automation_settings').select('*').eq('organization_id', this.organizationId).maybeSingle();
    if (error) throw automationError(error);
    if (!data) throw new AutomationError('Automation settings were not found for this workspace. Re-run migration 003.', 'unavailable');
    const s = fromRow<AutomationSettings>(data);
    // Before migration 007 the sending columns are absent: the defaults apply (and the database
    // trigger that enforces them is absent too, so dispatch stays with the gateway's checks).
    return {
      ...s,
      budgets: budgetsSchema.catch({}).parse(s.budgets ?? {}),
      sendingPolicy: 'sendingPolicy' in s ? resolveSendingPolicy(s.sendingPolicy) : structuredClone(DEFAULT_SENDING_POLICY),
      sendingPaused: s.sendingPaused === true,
      sendingPauseReason: s.sendingPauseReason ?? null,
      sendingPausedAt: s.sendingPausedAt ?? null,
    };
  }

  async updateSettings(patch: AutomationSettingsPatch) {
    if (patch.mode && MODE_META[patch.mode].outreach) throw new AutomationError('Outreach modes are not available in this version.', 'forbidden');
    if (patch.budgets !== undefined && !budgetsSchema.safeParse(patch.budgets).success) {
      throw new AutomationError('Budgets must be amounts of zero or more, or left blank.');
    }
    if (patch.sendingPolicy !== undefined) {
      const parsed = sendingPolicySchema.safeParse(patch.sendingPolicy);
      if (!parsed.success) throw new AutomationError(`Sending policy: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
      patch = { ...patch, sendingPolicy: parsed.data };
    }
    const { data, error } = await this.sb.from('automation_settings').update(toRow(patch)).eq('organization_id', this.organizationId).select('*').maybeSingle();
    if (error?.code === '42703' || (error?.code === 'PGRST204' && SENDING_FIELDS.some((f) => f in patch))) throw new AutomationError(SENDING_MIGRATION_REQUIRED, 'unavailable');
    if (error) throw automationError(error);
    if (!data) throw new AutomationError('Only owners and administrators can change automation settings.', 'forbidden');
    return this.getSettings();
  }

  async listSettingsHistory(limit = 100): Promise<SettingsChange[]> {
    const { data, error } = await this.sb
      .from('audit_events')
      .select('id, actor_id, changes, created_at')
      .eq('organization_id', this.organizationId)
      .eq('table_name', 'automation_settings')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw automationError(error);
    return (data ?? []).map((r) => fromRow<SettingsChange>(r));
  }

  async enqueue(request: JobRequest) {
    const { data, error } = await this.sb.rpc('enqueue_automation_job', {
      p_org: this.organizationId,
      p_agent: request.agent,
      p_business: request.businessId ?? null,
      p_payload: request.payload ?? {},
      p_idempotency_key: request.idempotencyKey ?? null,
      p_priority: request.priority ?? 100,
      p_run_after: request.runAfter ?? null,
      p_parent: request.parentJobId ?? null,
      p_requires_approval: request.requiresApproval ?? false,
      p_estimated_cost: request.estimatedCostUsd ?? 0,
      p_max_attempts: request.maxAttempts ?? 3,
    });
    if (error) throw automationError(error);
    const body = data as { created: boolean; job: Record<string, unknown> };
    return { created: body.created, job: toJob(body.job) };
  }

  async claim(worker: string, limit: number, leaseSeconds: number) {
    const { data, error } = await this.sb.rpc('claim_automation_jobs', { p_org: this.organizationId, p_worker: worker, p_limit: limit, p_lease_seconds: leaseSeconds });
    if (error) throw automationError(error);
    return ((data ?? []) as Record<string, unknown>[]).map(toJob);
  }

  async finish(job: AutomationJob, request: FinishRequest) {
    const { data, error } = await this.sb.rpc('finish_automation_job', {
      p_job: job.id,
      p_lease: job.leaseToken,
      p_outcome: request.outcome,
      p_result: request.result ?? null,
      p_error: request.error ?? null,
      p_error_kind: request.errorKind ?? null,
      p_run_after: request.runAfter ?? null,
    });
    if (error) throw automationError(error);
    return toJob(data as Record<string, unknown>);
  }

  private async call(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw automationError(error);
    return toJob(data as Record<string, unknown>);
  }
  cancel(jobId: string, reason?: string) {
    return this.call('cancel_automation_job', { p_job: jobId, p_reason: reason ?? null });
  }
  retry(jobId: string) {
    return this.call('retry_automation_job', { p_job: jobId });
  }
  approve(jobId: string) {
    return this.call('approve_automation_job', { p_job: jobId });
  }

  async getJob(id: string) {
    const { data, error } = await this.sb.from('automation_jobs').select('*').eq('organization_id', this.organizationId).eq('id', id).maybeSingle();
    if (error) throw automationError(error);
    return data ? toJob(data) : null;
  }

  async listJobs(filter: JobFilter = {}) {
    let q = this.sb.from('automation_jobs').select('*').eq('organization_id', this.organizationId);
    if (filter.statuses?.length) q = q.in('status', filter.statuses);
    if (filter.agent) q = q.eq('agent', filter.agent);
    if (filter.businessId) q = q.eq('business_id', filter.businessId);
    if (filter.traceId) q = q.eq('trace_id', filter.traceId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.min(filter.limit ?? 200, 1000));
    if (error) throw automationError(error);
    return (data ?? []).map(toJob);
  }

  async countJobs() {
    const counts = emptyCounts();
    const statuses = Object.keys(counts) as (keyof typeof counts)[];
    const results = await Promise.all(
      statuses.map((status) => this.sb.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('organization_id', this.organizationId).eq('status', status)),
    );
    results.forEach(({ count, error }, i) => {
      if (error) throw automationError(error);
      counts[statuses[i]] = count ?? 0;
    });
    return counts;
  }

  async recordRun(run: AgentRunInsert) {
    const { data, error } = await this.sb
      .from('agent_runs')
      .insert({ ...toRow(run), organization_id: this.organizationId })
      .select('*')
      .single();
    if (error) throw automationError(error);
    return toRun(data);
  }

  async listRuns(filter: RunFilter = {}) {
    let q = this.sb.from('agent_runs').select('*').eq('organization_id', this.organizationId);
    if (filter.businessId) q = q.eq('business_id', filter.businessId);
    if (filter.jobId) q = q.eq('job_id', filter.jobId);
    if (filter.traceId) q = q.eq('trace_id', filter.traceId);
    const { data, error } = await q.order('started_at', { ascending: false }).limit(Math.min(filter.limit ?? 200, 1000));
    if (error) throw automationError(error);
    return (data ?? []).map(toRun);
  }
}
