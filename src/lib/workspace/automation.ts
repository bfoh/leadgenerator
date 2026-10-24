'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AGENTS } from '@/lib/automation/agents/catalog';
import { OPEN_JOB_STATUSES, type AgentKey } from '@/lib/automation/constants';
import type { ContactPageRead, InspectedWebsite, ToolGateway } from '@/lib/automation/agents/types';
import { processQueue, queueAgent, type QueueRunSummary } from '@/lib/automation/engine';
import type { AutomationStore, RunFilter } from '@/lib/automation/store';
import type { AutomationSettingsPatch, JobFilter } from '@/lib/automation/types';
import type { ServiceContext } from '@/lib/data/services';
import type { DataStore } from '@/lib/data/store';
import type { MxResult } from '@/lib/domain/contacts';
import type { EvidencePack } from '@/lib/domain/evidence';
import type { AiClassification } from '@/lib/domain/replies';
import type { ReportContent, ReportValidation } from '@/lib/domain/report';
import type { SearchHit } from '@/lib/domain/website-assessment';
import type { Business, ReportUsage, UsageInsert } from '@/lib/domain/types';
import { errorMessage } from '@/lib/utils';
import { api, recordCharge, useServerStatus, type ServerStatus } from './api';
import { useWorkspace } from './workspace-provider';

/** Agent tools in the browser: this app's route handlers (secrets stay on the server). */
export function httpToolGateway(store: DataStore, status: ServerStatus | undefined): ToolGateway {
  return {
    aiConfigured: Boolean(status?.ai.configured),
    aiModel: status?.ai.model ?? null,
    async aiReport(pack: EvidencePack, { jobId }, signal) {
      const res = await api.post<{ content: ReportContent; validation: ReportValidation; model: string; usage: ReportUsage; charge: UsageInsert }>(
        '/api/reports/generate',
        { pack, jobId },
        signal,
      );
      await recordCharge(store, res.charge);
      return { ...res, call: { provider: 'anthropic', operation: 'ai_report', units: 1, estimatedCostUsd: res.usage.estimatedCostUsd, ok: true } };
    },
    async aiOutreachNote(pack: EvidencePack, { jobId }, signal) {
      const res = await api.post<{ note: string | null; evidenceIds: string[]; reason: string | null; model: string; usage: ReportUsage; charge: UsageInsert }>('/api/messaging/draft-note', { pack, jobId }, signal);
      await recordCharge(store, res.charge);
      return { ...res, call: { provider: 'anthropic', operation: 'ai_note', units: 1, estimatedCostUsd: res.usage.estimatedCostUsd, ok: true } };
    },
    async aiClassifyReply(message, { jobId }, signal) {
      const res = await api.post<{ result: AiClassification; model: string; usage: ReportUsage; charge: UsageInsert }>('/api/messaging/classify-reply', { ...message, jobId }, signal);
      await recordCharge(store, res.charge);
      return { ...res, call: { provider: 'anthropic', operation: 'ai_classify', units: 1, estimatedCostUsd: res.usage.estimatedCostUsd, ok: true } };
    },
    research: {
      available: Boolean(status?.serverTools),
      simulated: Boolean(status?.research?.simulated),
      search: status?.research?.search ?? { configured: false, provider: null, costPerQueryUsd: 0 },
    },
    async webSearch(query, { jobId, purpose }, signal) {
      const res = await api.post<{ results: SearchHit[]; provider: string; usage: UsageInsert | null }>('/api/verify/search', { query, jobId, purpose }, signal);
      await recordCharge(store, res.usage);
      const cost = res.usage?.estimatedCostUsd ?? 0;
      return { hits: res.results, provider: res.provider, call: { provider: res.usage?.provider ?? 'web_search', operation: 'web_search', units: 1, estimatedCostUsd: cost, ok: true } };
    },
    async probeDomains(domains, signal) {
      const res = await api.post<{ results: { domain: string; resolves: boolean }[]; usage: UsageInsert | null }>('/api/verify/domains', { domains }, signal);
      await recordCharge(store, res.usage);
      return res.results.map(({ domain, resolves }) => ({ domain, resolves }));
    },
    async inspectWebsite(url, signal) {
      const res = await api.post<InspectedWebsite & { usage: UsageInsert | null }>('/api/verify/website', { url, inspect: true }, signal);
      await recordCharge(store, res.usage);
      return { check: res.check, facts: res.facts, robots: res.robots };
    },
    contacts: { available: Boolean(status?.serverTools && status.contacts), simulated: Boolean(status?.contacts?.simulated) },
    async readContactPage(url, signal) {
      const res = await api.post<ContactPageRead & { usage: UsageInsert | null }>('/api/contacts/page', { url }, signal);
      await recordCharge(store, res.usage);
      return { check: res.check, robots: res.robots, contacts: res.contacts };
    },
    async lookupMx(domains, signal) {
      const res = await api.post<{ results: MxResult[]; usage: UsageInsert | null }>('/api/contacts/mx', { domains }, signal);
      await recordCharge(store, res.usage);
      return res.results;
    },
  };
}

export interface AutomationContext {
  automation: AutomationStore;
  svc: ServiceContext;
  tools: ToolGateway;
}

export function useAutomationContext(): AutomationContext {
  const { automation, ctx, store } = useWorkspace();
  const { data: status } = useServerStatus();
  return { automation, svc: ctx, tools: httpToolGateway(store, status) };
}

function useAutomationQuery<T>(key: readonly unknown[], fn: (a: AutomationStore) => Promise<T>, options: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  const { automation, workspace } = useWorkspace();
  return useQuery({ queryKey: [workspace.organizationId, 'automation', ...key], queryFn: () => fn(automation), enabled: options.enabled ?? true, refetchInterval: options.refetchInterval });
}

export const useAutomationAvailable = () => useAutomationQuery(['available'], (a) => a.isAvailable());
export function useAutomationSettings() {
  const available = useAutomationAvailable();
  return useAutomationQuery(['settings'], (a) => a.getSettings(), { enabled: available.data === true });
}
export function useJobs(filter: JobFilter = {}, live = false, enabled = true) {
  const available = useAutomationAvailable();
  return useAutomationQuery(['jobs', filter], (a) => a.listJobs(filter), { enabled: enabled && available.data === true, refetchInterval: live ? 5_000 : false });
}
export function useJob(id: string | null, live = false) {
  const available = useAutomationAvailable();
  return useAutomationQuery(['job', id], (a) => a.getJob(id!), { enabled: Boolean(id) && available.data === true, refetchInterval: live ? 5_000 : false });
}
/** Job counts; `refreshMs` polls while the page shows work in progress. */
export function useJobCounts(refreshMs: number | false = false) {
  const available = useAutomationAvailable();
  return useAutomationQuery(['job-counts'], (a) => a.countJobs(), { enabled: available.data === true, refetchInterval: refreshMs });
}
/** What the scheduled worker has done here (cloud mode); the page shows it rather than running the work. */
export function useWorkerActivity(enabled: boolean) {
  const available = useAutomationAvailable();
  return useAutomationQuery(['worker-activity'], (a) => a.workerActivity(), { enabled: enabled && available.data === true, refetchInterval: enabled ? 30_000 : false });
}
export function useAgentRuns(filter: RunFilter = {}, enabled = true, live = false) {
  const available = useAutomationAvailable();
  return useAutomationQuery(['runs', filter], (a) => a.listRuns(filter), { enabled: enabled && available.data === true, refetchInterval: live ? 5_000 : false });
}
export function useSettingsHistory(enabled = true) {
  const available = useAutomationAvailable();
  return useAutomationQuery(['settings-history'], (a) => a.listSettingsHistory(100), { enabled: enabled && available.data === true });
}
export function useWorkflowTransitions(businessId: string) {
  const { store, workspace } = useWorkspace();
  return useQuery({ queryKey: [workspace.organizationId, 'workflow-transitions', businessId], queryFn: () => store.listWorkflowTransitions(businessId) });
}

/** Like useAction, for automation operations: refreshes every workspace query and reports the outcome. */
export function useAutomationAction<A extends unknown[], R>(
  fn: (ctx: AutomationContext, ...args: A) => Promise<R>,
  options: { success?: string | ((result: R) => string); onSuccess?: (result: R) => void } = {},
) {
  const actx = useAutomationContext();
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const mutation = useMutation({
    mutationFn: (args: A) => fn(actx, ...args),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === workspace.organizationId });
      const message = typeof options.success === 'function' ? options.success(result) : options.success;
      if (message) toast.success(message);
      options.onSuccess?.(result);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return {
    run: async (...args: A): Promise<R | undefined> => {
      try {
        return await mutation.mutateAsync(args);
      } catch {
        return undefined;
      }
    },
    pending: mutation.isPending,
  };
}

// ── Operations ───────────────────────────────────────────────────────────────

/** The agents the research pipeline queues for a prospect, in order (each step queues the next). */
export const RESEARCH_PIPELINE: readonly AgentKey[] = ['business_identity', 'website_verification', 'digital_audit', 'opportunity_scoring', 'contact_research', 'contact_validation', 'opportunity_report'];

/** Prospects the research pipeline may run on: open and not opted out. */
export function researchable(b: Business) {
  return b.contactPermission !== 'opted_out' && !b.mergedIntoId && !['won', 'lost', 'archived'].includes(b.stage);
}

/**
 * Queues the research pipeline for each prospect: identity, website verification, digital audit,
 * scoring, then — when the prospect qualifies — contact research, contact validation and a report.
 * Without migration 004 it starts at scoring; without 005 a qualifying prospect goes straight to the
 * report.
 * Prospects with research already queued or running are skipped, and the idempotency key stops a
 * double click from queueing the same prospect twice in one minute.
 */
export async function queueResearch(actx: AutomationContext, businesses: Business[]) {
  const settings = await actx.automation.getSettings();
  const open = await actx.automation.listJobs({ statuses: [...OPEN_JOB_STATUSES], limit: 1000 });
  const busy = new Set(open.filter((j) => RESEARCH_PIPELINE.includes(j.agent)).map((j) => j.businessId));
  const minute = new Date().toISOString().slice(0, 16);
  const first: AgentKey = (await actx.svc.store.researchSchemaAvailable()) ? 'business_identity' : 'opportunity_scoring';
  const eligible = businesses.filter(researchable);
  let created = 0;
  let existing = 0;
  for (const b of eligible) {
    if (busy.has(b.id)) {
      existing++;
      continue;
    }
    const res = await queueAgent(actx, settings, {
      agent: first,
      businessId: b.id,
      payload: first === 'opportunity_scoring' ? { reason: 'Research pipeline started by a team member' } : {},
      idempotencyKey: `ui:research:${b.id}:${minute}`,
    });
    if (res.created) created++;
    else existing++;
  }
  return { created, existing, skipped: businesses.length - eligible.length };
}

/**
 * Where bulk work runs: this tab (demo), the server while this page asks (cloud), or the scheduled
 * background worker, in which case the page only queues and shows status and may be closed.
 */
export type QueueMode = 'demo' | 'cloud' | 'background';

export function useQueueMode(): QueueMode {
  const { workspace } = useWorkspace();
  const { data: server } = useServerStatus();
  return workspace.mode === 'cloud' && server?.automation?.backgroundWorker === true ? 'background' : workspace.mode;
}

const LEFT_FOR_WORKER: QueueRunSummary = { processed: 0, outcomes: [], stoppedBecause: 'queued' };

/** Queues research for the prospects, then (without a background worker) processes the queue once so results appear straight away. */
export async function runResearchNow(actx: AutomationContext, mode: QueueMode, businesses: Business[]) {
  const queued = await queueResearch(actx, businesses);
  const run = mode === 'background' ? LEFT_FOR_WORKER : await processQueueOnce(actx, mode);
  return { queued, run };
}

/** Queues one agent for several prospects (skipping ones already queued for it), then processes the queue once unless a background worker will. */
export async function runAgentForMany(actx: AutomationContext, mode: QueueMode, agent: AgentKey, businesses: Business[], payload: Record<string, unknown> = {}) {
  const settings = await actx.automation.getSettings();
  const open = await actx.automation.listJobs({ statuses: [...OPEN_JOB_STATUSES], limit: 1000 });
  const busy = new Set(open.filter((j) => j.agent === agent).map((j) => j.businessId));
  const minute = new Date().toISOString().slice(0, 16);
  let created = 0;
  let existing = 0;
  for (const b of businesses.filter(researchable)) {
    if (busy.has(b.id)) {
      existing++;
      continue;
    }
    const res = await queueAgent(actx, settings, { agent, businessId: b.id, payload, idempotencyKey: `ui:${agent}:${b.id}:${minute}` });
    if (res.created) created++;
    else existing++;
  }
  const run = mode === 'background' ? LEFT_FOR_WORKER : await processQueueOnce(actx, mode);
  return { queued: { created, existing, skipped: businesses.length - created - existing }, run };
}

/** Queues one agent for one prospect (a person's explicit request) and processes the queue once. */
export async function runAgentNow(actx: AutomationContext, mode: 'demo' | 'cloud', agent: AgentKey, business: Business, payload: Record<string, unknown> = {}) {
  const settings = await actx.automation.getSettings();
  const minute = new Date().toISOString().slice(0, 16);
  const { created } = await queueAgent(actx, settings, { agent, businessId: business.id, payload, idempotencyKey: `ui:${agent}:${business.id}:${minute}` });
  const run = await processQueueOnce(actx, mode);
  return { created, run };
}

export function describeQueued({ created, existing, skipped }: Awaited<ReturnType<typeof queueResearch>>) {
  const parts = [`${created} queued`];
  if (existing) parts.push(`${existing} already in the queue`);
  if (skipped) parts.push(`${skipped} skipped (closed or opted out)`);
  return `Research pipeline: ${parts.join(', ')}.`;
}

export async function updateAutomationSettings(actx: AutomationContext, patch: AutomationSettingsPatch) {
  return actx.automation.updateSettings(patch);
}

export const cancelJob = (actx: AutomationContext, jobId: string) => actx.automation.cancel(jobId);
export const retryJob = (actx: AutomationContext, jobId: string) => actx.automation.retry(jobId);
export const approveJob = (actx: AutomationContext, jobId: string) => actx.automation.approve(jobId);

/**
 * Processes due jobs once. Cloud mode uses the server runner (the member's session, server-side
 * tools); demo mode runs the engine in this tab, guarded by a Web Lock so two tabs never overlap.
 */
export async function processQueueOnce(actx: AutomationContext, mode: 'demo' | 'cloud'): Promise<QueueRunSummary> {
  if (mode === 'cloud') return api.post<QueueRunSummary>('/api/automation/run', { maxJobs: 3 });
  const run = () => processQueue({ ...actx, workerId: 'browser', outboundAvailable: false }, { maxJobs: 5, deadlineMs: 45_000 });
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return run();
  const result = await locks.request('dof-automation-runner', { ifAvailable: true }, async (lock) => (lock ? run() : null));
  return result ?? { processed: 0, outcomes: [], stoppedBecause: 'aborted' };
}

export function describeRun(summary: QueueRunSummary) {
  if (!summary.processed) {
    if (summary.stoppedBecause === 'queued') return 'The background worker runs them within a few minutes; you can close this page.';
    return summary.stoppedBecause === 'paused' ? 'Automation is paused.' : summary.stoppedBecause === 'aborted' ? 'Another tab is already processing the queue.' : 'No jobs are due.';
  }
  const by = summary.outcomes.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.outcome]: (acc[o.outcome] ?? 0) + 1 }), {});
  const parts = Object.entries(by).map(([k, n]) => `${n} ${k === 'retry' ? 'to retry' : k.replace('_', ' ')}`);
  return `Processed ${summary.processed} job${summary.processed === 1 ? '' : 's'}: ${parts.join(', ')}.`;
}

export function agentName(key: AgentKey) {
  return AGENTS[key]?.name ?? key;
}

/** How often the page processes the queue while "keep processing" is on. */
const RUNNER_INTERVAL_MS = 10_000;

/**
 * Processes the queue from this page: once on request, or repeatedly while `keepProcessing` is on and
 * the tab is visible. It is the worker when no scheduled background worker is configured.
 */
export function useQueueRunner() {
  const actx = useAutomationContext();
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const [processing, setProcessing] = useState(false);
  const [keepProcessing, setKeepProcessing] = useState(false);
  const [last, setLast] = useState<{ at: string; summary: QueueRunSummary } | null>(null);
  const actxRef = useRef(actx);
  const inFlight = useRef(false);

  useEffect(() => {
    actxRef.current = actx;
  });

  const runOnce = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setProcessing(true);
      try {
        const summary = await processQueueOnce(actxRef.current, workspace.mode);
        setLast({ at: new Date().toISOString(), summary });
        if (summary.processed || !options.quiet) await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === workspace.organizationId });
        if (!options.quiet || summary.processed) toast(describeRun(summary));
        return summary;
      } catch (error) {
        toast.error(errorMessage(error));
        setKeepProcessing(false);
        return null;
      } finally {
        inFlight.current = false;
        setProcessing(false);
      }
    },
    [qc, workspace.mode, workspace.organizationId],
  );

  useEffect(() => {
    if (!keepProcessing) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void runOnce({ quiet: true });
    };
    const id = window.setInterval(tick, RUNNER_INTERVAL_MS);
    tick();
    return () => window.clearInterval(id);
  }, [keepProcessing, runOnce]);

  return { runOnce, processing, keepProcessing, setKeepProcessing, last };
}
