// Demo-mode automation queue in browser storage. Emulates the SQL functions in migration 003
// (enqueue, claim with leases, finish, cancel, retry, approve) so the engine behaves the same in both
// modes. Jobs run only while the app is open.

import { DEMO_ORG_ID, DEMO_USER_ID, type KeyValueStorage } from '@/lib/data/local-store';
import { resolveSendingPolicy, sendingPolicySchema } from '@/lib/domain/sending-policy';
import { AGENT_KEYS, AUTOMATION_MODES, MODE_META, OUTBOUND_AGENTS, type AgentKey } from './constants';
import { budgetsSchema } from './budget';
import { AUTOMATION_KEY, forgetBusinessAutomation } from './local-keys';
import { AutomationError, DEFAULT_SETTINGS_FOR, emptyCounts, type AutomationStore, type RunFilter } from './store';
import type { AgentRun, AgentRunInsert, AutomationJob, AutomationSettings, AutomationSettingsPatch, FinishRequest, JobFilter, JobRequest, SettingsChange } from './types';

export { AUTOMATION_KEY };
const MAX_JOBS = 2000;
const MAX_RUNS = 2000;
const MAX_HISTORY = 500;

interface State {
  version: 1;
  settings: AutomationSettings;
  jobs: AutomationJob[];
  runs: AgentRun[];
  /** Settings changes, oldest first (absent in demo data saved before phase 8). */
  history?: SettingsChange[];
}

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const clone = <T,>(v: T): T => structuredClone(v);
const isOutbound = (agent: AgentKey) => OUTBOUND_AGENTS.includes(agent);

export class LocalAutomationStore implements AutomationStore {
  readonly mode = 'demo' as const;
  private readonly organizationId: string;
  private readonly userId: string;
  private readonly clock: () => Date;
  private readonly outboundAvailable: boolean;

  constructor(
    private readonly storage: KeyValueStorage | null,
    options: { organizationId?: string; userId?: string; clock?: () => Date; outboundAvailable?: boolean } = {},
  ) {
    this.organizationId = options.organizationId ?? DEMO_ORG_ID;
    this.userId = options.userId ?? DEMO_USER_ID;
    this.clock = options.clock ?? (() => new Date());
    this.outboundAvailable = options.outboundAvailable ?? false;
  }

  private now() {
    return this.clock().toISOString();
  }

  // Re-read on every operation so several open tabs see one queue.
  private load(): State {
    try {
      const raw = this.storage?.getItem(AUTOMATION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as State;
        if (parsed?.version === 1 && Array.isArray(parsed.jobs)) {
          // Settings saved before phase 8 get the default sending policy.
          parsed.settings = { ...DEFAULT_SETTINGS_FOR(this.organizationId, this.now()), ...parsed.settings };
          parsed.settings.sendingPolicy = resolveSendingPolicy(parsed.settings.sendingPolicy);
          return parsed;
        }
      }
    } catch {
      // Corrupt or unavailable storage: start empty.
    }
    return { version: 1, settings: DEFAULT_SETTINGS_FOR(this.organizationId, this.now()), jobs: [], runs: [] };
  }

  private save(state: State) {
    const terminal = (j: AutomationJob) => j.status === 'succeeded' || j.status === 'cancelled';
    if (state.jobs.length > MAX_JOBS) {
      const excess = state.jobs.length - MAX_JOBS;
      const drop = new Set(state.jobs.filter(terminal).slice(0, excess).map((j) => j.id));
      state.jobs = state.jobs.filter((j) => !drop.has(j.id));
    }
    if (state.runs.length > MAX_RUNS) state.runs = state.runs.slice(-MAX_RUNS);
    if (state.history && state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
    try {
      this.storage?.setItem(AUTOMATION_KEY, JSON.stringify(state));
    } catch {
      throw new AutomationError('Browser storage is full or unavailable. Clear finished jobs or reset the demo.', 'unavailable');
    }
  }

  private mutate<T>(fn: (state: State) => T): T {
    const state = this.load();
    const result = fn(state);
    this.save(state);
    return clone(result);
  }

  /** Clears the demo queue and policy (used by the demo reset). */
  reset() {
    this.storage?.removeItem(AUTOMATION_KEY);
  }

  async isAvailable() {
    return true;
  }

  async getSettings() {
    return clone(this.load().settings);
  }

  async updateSettings(patch: AutomationSettingsPatch) {
    return this.mutate((state) => {
      const next = { ...state.settings };
      if (patch.mode !== undefined) {
        if (!AUTOMATION_MODES.includes(patch.mode)) throw new AutomationError('Unknown automation mode.');
        if (patch.mode !== next.mode && MODE_META[patch.mode].outreach && !this.outboundAvailable) {
          throw new AutomationError('Outreach modes are not available in this version.', 'forbidden');
        }
        next.mode = patch.mode;
      }
      if (patch.paused !== undefined) next.paused = patch.paused;
      if (patch.disabledAgents !== undefined) next.disabledAgents = patch.disabledAgents.filter((a) => AGENT_KEYS.includes(a));
      if (patch.maxConcurrentJobs !== undefined) {
        if (!Number.isInteger(patch.maxConcurrentJobs) || patch.maxConcurrentJobs < 1 || patch.maxConcurrentJobs > 10) {
          throw new AutomationError('Concurrent jobs must be between 1 and 10.');
        }
        next.maxConcurrentJobs = patch.maxConcurrentJobs;
      }
      if (patch.budgets !== undefined) {
        const parsed = budgetsSchema.safeParse(patch.budgets);
        if (!parsed.success) throw new AutomationError('Budgets must be amounts of zero or more, or left blank.');
        next.budgets = parsed.data;
      }
      // Mirrors guard_sending_controls in migration 007.
      if (patch.sendingPolicy !== undefined) {
        const parsed = sendingPolicySchema.safeParse(patch.sendingPolicy);
        if (!parsed.success) throw new AutomationError(`Sending policy: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
        next.sendingPolicy = parsed.data;
      }
      if (patch.sendingPaused !== undefined && patch.sendingPaused !== next.sendingPaused) {
        // Pausing is always allowed; resuming needs a new reason.
        const reason = patch.sendingPauseReason?.trim() ?? '';
        if (!patch.sendingPaused && (!reason || reason === next.sendingPauseReason)) throw new AutomationError('Record why sending is being resumed.');
        next.sendingPaused = patch.sendingPaused;
        next.sendingPauseReason = (reason || 'Sending paused.').slice(0, 500);
        next.sendingPausedAt = this.now();
      }
      next.updatedAt = this.now();
      const changes: SettingsChange['changes'] = {};
      for (const [k, v] of Object.entries(next)) {
        if (k === 'updatedAt') continue;
        const old = (state.settings as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(old) !== JSON.stringify(v)) changes[k] = { old: old ?? null, new: v ?? null };
      }
      if (Object.keys(changes).length) (state.history ??= []).push({ id: uuid(), actorId: this.userId, changes, createdAt: this.now() });
      state.settings = next;
      return next;
    });
  }

  async listSettingsHistory(limit = 100) {
    return clone([...(this.load().history ?? [])].reverse().slice(0, limit));
  }

  async enqueue(request: JobRequest) {
    return this.mutate((state) => {
      if (isOutbound(request.agent) && (state.settings.outboundStopped || !this.outboundAvailable)) {
        throw new AutomationError('Outbound sending is stopped for this workspace.', 'forbidden');
      }
      if (request.idempotencyKey) {
        const existing = state.jobs.find((j) => j.idempotencyKey === request.idempotencyKey);
        if (existing) return { job: existing, created: false };
      }
      let traceId: string = uuid();
      if (request.parentJobId) {
        const parent = state.jobs.find((j) => j.id === request.parentJobId);
        if (!parent) throw new AutomationError('Parent job not found in this workspace.', 'not_found');
        traceId = parent.traceId;
      }
      const at = this.now();
      const job: AutomationJob = {
        id: uuid(),
        organizationId: this.organizationId,
        agent: request.agent,
        status: request.requiresApproval ? 'awaiting_approval' : 'pending',
        priority: request.priority ?? 100,
        businessId: request.businessId ?? null,
        payload: request.payload ?? {},
        result: null,
        idempotencyKey: request.idempotencyKey ?? null,
        attempts: 0,
        maxAttempts: request.maxAttempts ?? 3,
        runAfter: request.runAfter ?? at,
        leaseToken: null,
        lockedUntil: null,
        worker: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        errorKind: null,
        cancelRequested: false,
        parentJobId: request.parentJobId ?? null,
        traceId,
        estimatedCostUsd: Math.max(0, request.estimatedCostUsd ?? 0),
        approvedBy: null,
        approvedAt: null,
        createdBy: this.userId,
        createdAt: at,
        updatedAt: at,
      };
      state.jobs.push(job);
      return { job, created: true };
    });
  }

  async claim(worker: string, limit: number, leaseSeconds: number) {
    return this.mutate((state) => {
      const now = this.clock();
      const at = now.toISOString();
      const lim = Math.min(Math.max(Math.trunc(limit) || 1, 1), 20);
      const lease = Math.min(Math.max(Math.trunc(leaseSeconds) || 120, 30), 900);

      for (const j of state.jobs) {
        if (j.status !== 'running' || !j.lockedUntil || j.lockedUntil >= at) continue;
        const outbound = isOutbound(j.agent);
        const terminal = outbound || j.cancelRequested || j.attempts >= j.maxAttempts;
        j.status = outbound ? 'failed' : j.cancelRequested ? 'cancelled' : j.attempts >= j.maxAttempts ? 'failed' : 'pending';
        j.errorKind = outbound ? 'uncertain_delivery' : j.cancelRequested ? 'cancelled' : 'timeout';
        j.lastError = outbound
          ? 'The worker stopped before confirming delivery. Check the message status manually; it will not be retried automatically.'
          : 'The worker stopped before finishing this job (lease expired).';
        j.finishedAt = terminal ? at : null;
        j.leaseToken = null;
        j.lockedUntil = null;
        j.worker = null;
        j.runAfter = at;
        j.updatedAt = at;
      }

      const s = state.settings;
      if (s.paused) return [];
      const running = state.jobs.filter((j) => j.status === 'running').length;
      const slots = Math.min(lim, s.maxConcurrentJobs - running);
      if (slots <= 0) return [];
      const due = state.jobs
        .filter(
          (j) =>
            j.status === 'pending' &&
            j.runAfter <= at &&
            !j.cancelRequested &&
            !s.disabledAgents.includes(j.agent) &&
            (!isOutbound(j.agent) || (!s.outboundStopped && this.outboundAvailable)),
        )
        .sort((a, b) => a.priority - b.priority || a.runAfter.localeCompare(b.runAfter) || a.createdAt.localeCompare(b.createdAt))
        .slice(0, slots);
      const lockedUntil = new Date(now.getTime() + lease * 1000).toISOString();
      for (const j of due) {
        j.status = 'running';
        j.attempts += 1;
        j.leaseToken = uuid();
        j.lockedUntil = lockedUntil;
        j.worker = worker.slice(0, 100);
        j.startedAt ??= at;
        j.updatedAt = at;
      }
      return due;
    });
  }

  async finish(job: AutomationJob, request: FinishRequest) {
    return this.mutate((state) => {
      const j = state.jobs.find((x) => x.id === job.id);
      if (!j) throw new AutomationError('Job not found.', 'not_found');
      if (j.status !== 'running' || j.leaseToken !== job.leaseToken) {
        throw new AutomationError('This job is no longer held by this worker.', 'stale_lease');
      }
      const at = this.now();
      const { outcome } = request;
      const kind = request.errorKind ?? null;
      const outbound = isOutbound(j.agent);
      const next =
        outcome === 'succeeded'
          ? 'succeeded'
          : j.cancelRequested || outcome === 'cancelled'
            ? 'cancelled'
            : outcome === 'awaiting_approval'
              ? 'awaiting_approval'
              : outcome === 'deferred' && !outbound
                ? 'pending'
                : outcome === 'retry' && !outbound && j.attempts < j.maxAttempts && (kind === null || kind === 'retryable' || kind === 'timeout')
                  ? 'pending'
                  : 'failed';
      if (outcome === 'deferred') j.attempts = Math.max(j.attempts - 1, 0);
      j.status = next;
      j.result = request.result ?? j.result;
      j.lastError = next === 'succeeded' ? null : (request.error ?? '').slice(0, 1000) || null;
      j.errorKind = next === 'succeeded' ? null : next === 'cancelled' ? 'cancelled' : kind;
      if (next === 'pending') j.runAfter = request.runAfter ?? at;
      j.finishedAt = next === 'succeeded' || next === 'failed' || next === 'cancelled' ? at : null;
      j.leaseToken = null;
      j.lockedUntil = null;
      j.worker = null;
      j.updatedAt = at;
      return j;
    });
  }

  async cancel(jobId: string, reason?: string) {
    return this.mutate((state) => {
      const j = state.jobs.find((x) => x.id === jobId);
      if (!j) throw new AutomationError('Job not found.', 'not_found');
      const at = this.now();
      if (j.status === 'pending' || j.status === 'awaiting_approval') {
        j.status = 'cancelled';
        j.errorKind = 'cancelled';
        j.finishedAt = at;
        j.lastError = reason?.trim() || 'Cancelled by a team member.';
      } else if (j.status === 'running') {
        j.cancelRequested = true;
      } else {
        throw new AutomationError('Only queued or running jobs can be cancelled.', 'conflict');
      }
      j.updatedAt = at;
      return j;
    });
  }

  async retry(jobId: string) {
    return this.mutate((state) => {
      const j = state.jobs.find((x) => x.id === jobId);
      if (!j) throw new AutomationError('Job not found.', 'not_found');
      if (isOutbound(j.agent)) throw new AutomationError('Outbound messages are never re-sent from the queue. Review the message and approve a new send.', 'forbidden');
      if (j.status !== 'failed' && j.status !== 'cancelled') throw new AutomationError('Only failed or cancelled jobs can be retried.', 'conflict');
      const at = this.now();
      Object.assign(j, { status: 'pending', attempts: 0, runAfter: at, cancelRequested: false, lastError: null, errorKind: null, finishedAt: null, updatedAt: at });
      return j;
    });
  }

  async approve(jobId: string) {
    return this.mutate((state) => {
      const j = state.jobs.find((x) => x.id === jobId);
      if (!j) throw new AutomationError('Job not found.', 'not_found');
      if (j.status !== 'awaiting_approval') throw new AutomationError('This job is not waiting for approval.', 'conflict');
      const at = this.now();
      Object.assign(j, { status: 'pending', runAfter: at, approvedBy: this.userId, approvedAt: at, updatedAt: at });
      return j;
    });
  }

  async getJob(id: string) {
    return clone(this.load().jobs.find((j) => j.id === id) ?? null);
  }

  async listJobs(filter: JobFilter = {}) {
    const jobs = this.load()
      .jobs.filter(
        (j) =>
          (!filter.statuses?.length || filter.statuses.includes(j.status)) &&
          (!filter.agent || j.agent === filter.agent) &&
          (!filter.businessId || j.businessId === filter.businessId) &&
          (!filter.traceId || j.traceId === filter.traceId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return clone(jobs.slice(0, filter.limit ?? 200));
  }

  async countJobs() {
    const counts = emptyCounts();
    for (const j of this.load().jobs) counts[j.status] += 1;
    return counts;
  }

  async recordRun(run: AgentRunInsert) {
    return this.mutate((state) => {
      const row: AgentRun = { ...run, id: uuid(), organizationId: this.organizationId, actorId: this.userId, createdAt: this.now() };
      state.runs.push(row);
      return row;
    });
  }

  async listRuns(filter: RunFilter = {}) {
    const runs = this.load()
      .runs.filter(
        (r) => (!filter.businessId || r.businessId === filter.businessId) && (!filter.jobId || r.jobId === filter.jobId) && (!filter.traceId || r.traceId === filter.traceId),
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.createdAt.localeCompare(a.createdAt));
    return clone(runs.slice(0, filter.limit ?? 200));
  }

  /** Removes runs and jobs for a deleted business (the database cascades the same way). */
  forgetBusiness(businessId: string) {
    forgetBusinessAutomation(this.storage, businessId);
  }
}
