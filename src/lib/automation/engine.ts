// Runs automation jobs. The engine — not the agent — enforces mode, the outbound stop, input
// validation, opt-out, budgets and timeouts; records every run; validates workflow transitions; and
// enqueues follow-ups with idempotency keys. It has no browser or server dependencies, so the
// foreground route, the scheduled worker and demo mode all run this same code.

import { ZodError } from 'zod';
import type { ServiceContext } from '@/lib/data/services';
import { StoreError } from '@/lib/data/store';
import type { Business } from '@/lib/domain/types';
import { agentStore } from './agent-store';
import { AGENTS, isAvailable } from './agents/catalog';
import { AgentError, type AgentDefinition, type AgentResult, type ToolGateway } from './agents/types';
import { checkBudgets, monthStart, spendByProvider, type CostEstimate } from './budget';
import { MODE_META, OUTBOUND_AGENTS, WORKFLOW_META, modeAllows, type AgentKey, type ErrorKind, type RunStatus, type WorkflowState } from './constants';
import { AutomationError, type AutomationStore } from './store';
import type { AgentRunInsert, AutomationJob, AutomationSettings, FinishRequest, JobOutcome, JobRequest, ProviderCall } from './types';
import { checkTransition, workflowStateOf } from './workflow';

export interface EngineContext {
  automation: AutomationStore;
  svc: ServiceContext;
  tools: ToolGateway;
  workerId: string;
  clock?: () => Date;
  random?: () => number;
  /** Platform switch for outbound channels. False in this version. */
  outboundAvailable?: boolean;
}

export interface JobOutcomeSummary {
  jobId: string;
  agent: AgentKey;
  outcome: JobOutcome;
  message: string;
}

export interface QueueRunSummary {
  processed: number;
  outcomes: JobOutcomeSummary[];
  stoppedBecause: 'empty' | 'limit' | 'deadline' | 'paused' | 'aborted' | 'error';
}

/** Lease for one claimed job: the longest agent timeout plus a margin. */
export const LEASE_SECONDS = 180;

/** Exponential backoff with jitter: 30 s, 60 s, 120 s … capped at one hour, scaled by 50–100 %. */
export function backoffMs(attempt: number, random: () => number = Math.random) {
  const base = Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + random() * 0.5));
}

export function followUpKey(traceId: string, agent: AgentKey, businessId: string | null | undefined) {
  return `${traceId}:${agent}:${businessId ?? 'none'}`.slice(0, 200);
}

const sumCost = (calls: ProviderCall[]) => Math.round(calls.reduce((s, c) => s + (c.estimatedCostUsd || 0), 0) * 10_000) / 10_000;
const totalEstimate = (e: CostEstimate) => Object.values(e).reduce((s, v) => s + (v ?? 0), 0);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Maps any thrown value to an error class and a message safe to store (no stack, no request data). */
export function classifyError(error: unknown, timedOut: boolean, timeoutMs: number): { kind: ErrorKind; message: string } {
  if (timedOut) return { kind: 'timeout', message: `Timed out after ${Math.round(timeoutMs / 1000)} s.` };
  const message = clip(error instanceof Error ? error.message || error.name : 'Unknown error', 300);
  if (error instanceof AgentError) return { kind: error.kind, message };
  if (error instanceof ZodError) return { kind: 'permanent', message: `Invalid data: ${clip(error.issues[0]?.message ?? 'validation failed', 200)}` };
  if (error instanceof StoreError) return { kind: error.code === 'unavailable' ? 'retryable' : 'permanent', message };
  if (error instanceof AutomationError) return { kind: error.code === 'unavailable' ? 'retryable' : 'permanent', message };
  const e = error as { retryable?: unknown; status?: unknown };
  if (typeof e?.retryable === 'boolean') return { kind: e.retryable ? 'retryable' : 'permanent', message };
  if (typeof e?.status === 'number') return { kind: e.status === 0 || e.status === 429 || e.status >= 500 ? 'retryable' : 'permanent', message };
  return { kind: 'retryable', message };
}

/** Checks whether an agent can be queued now; the same rules apply again when it runs. */
export function queueBlocker(agent: AgentDefinition, settings: AutomationSettings, outboundAvailable = false): string | null {
  if (!isAvailable(agent)) return `${agent.name} is planned for phase ${agent.phase} and is not available yet.`;
  if (settings.disabledAgents.includes(agent.key)) return `${agent.name} is turned off in Automation Center → Agents.`;
  if (!modeAllows(settings.mode, agent.minimumMode)) return `${agent.name} needs ${MODE_META[agent.minimumMode].label} mode (current: ${MODE_META[settings.mode].label}).`;
  if (OUTBOUND_AGENTS.includes(agent.key) && (settings.outboundStopped || !outboundAvailable)) return 'Outbound sending is stopped.';
  return null;
}

/** Queues a job after the same policy checks the engine applies, with its cost estimate. */
export async function queueAgent(ctx: Pick<EngineContext, 'automation' | 'tools' | 'outboundAvailable'>, settings: AutomationSettings, request: JobRequest) {
  const agent = AGENTS[request.agent];
  const blocker = queueBlocker(agent, settings, ctx.outboundAvailable);
  if (blocker) throw new AutomationError(blocker, 'forbidden');
  const input = agent.input.parse(request.payload ?? {});
  const estimate = agent.estimate?.({ input, settings, tools: ctx.tools }) ?? {};
  return ctx.automation.enqueue({ ...request, payload: input as Record<string, unknown>, estimatedCostUsd: totalEstimate(estimate) });
}

export async function processQueue(ctx: EngineContext, opts: { maxJobs?: number; deadlineMs?: number; signal?: AbortSignal } = {}): Promise<QueueRunSummary> {
  const maxJobs = opts.maxJobs ?? 5;
  const deadline = Date.now() + (opts.deadlineMs ?? 45_000);
  const outcomes: JobOutcomeSummary[] = [];
  const stop = (stoppedBecause: QueueRunSummary['stoppedBecause']) => ({ processed: outcomes.length, outcomes, stoppedBecause });

  while (true) {
    if (opts.signal?.aborted) return stop('aborted');
    if (outcomes.length >= maxJobs) return stop('limit');
    if (Date.now() >= deadline) return stop('deadline');
    const settings = await ctx.automation.getSettings();
    if (settings.paused) return stop('paused');
    // One job per claim keeps leases short and lets a deadline stop between jobs.
    const [job] = await ctx.automation.claim(ctx.workerId, 1, LEASE_SECONDS);
    if (!job) return stop('empty');
    try {
      outcomes.push(await runJob(ctx, job, settings));
    } catch (error) {
      // The job keeps its lease; the next claim after expiry recovers and retries it.
      outcomes.push({ jobId: job.id, agent: job.agent, outcome: 'retry', message: `Worker error: ${classifyError(error, false, 0).message} It will be retried after its lease expires.` });
      return stop('error');
    }
  }
}

export async function runJob(ctx: EngineContext, job: AutomationJob, settings: AutomationSettings): Promise<JobOutcomeSummary> {
  const clock = ctx.clock ?? (() => new Date());
  const now = clock();
  const agent: AgentDefinition | undefined = AGENTS[job.agent];
  const calls: ProviderCall[] = [];
  let business: Business | null = null;

  const done = async (
    status: RunStatus,
    finish: FinishRequest,
    run: Partial<Pick<AgentRunInsert, 'summary' | 'decision' | 'confidence' | 'output' | 'model' | 'inputTokens' | 'outputTokens'>> = {},
  ): Promise<JobOutcomeSummary> => {
    const finishedAt = clock();
    const summary = clip(run.summary ?? finish.error ?? 'No summary.', 500);
    const record: AgentRunInsert = {
      jobId: job.id,
      businessId: job.businessId,
      agent: job.agent,
      agentVersion: agent?.version ?? 'unknown',
      status,
      summary,
      decision: run.decision ? clip(run.decision, 200) : null,
      confidence: run.confidence ?? null,
      input: job.payload,
      output: run.output ?? null,
      providerCalls: calls,
      model: run.model ?? null,
      inputTokens: run.inputTokens ?? null,
      outputTokens: run.outputTokens ?? null,
      estimatedCostUsd: sumCost(calls),
      error: finish.error ? clip(finish.error, 1000) : null,
      traceId: job.traceId,
      worker: ctx.workerId,
      startedAt: now.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - now.getTime()),
    };
    try {
      await ctx.automation.recordRun(record);
    } catch {
      // The prospect may have been deleted mid-run; keep the run without the link.
      await ctx.automation.recordRun({ ...record, businessId: null }).catch(() => undefined);
    }
    await ctx.automation.finish(job, finish);
    return { jobId: job.id, agent: job.agent, outcome: finish.outcome, message: summary };
  };

  const moveWorkflow = async (target: Business, to: WorkflowState, reason: string) => {
    const from = workflowStateOf(target);
    if (from === to) return null;
    const check = checkTransition(from, to, { kind: 'agent', agent: job.agent }, target);
    if (!check.ok) return { from, to, rejected: check.reason };
    await ctx.svc.store.updateBusiness(target.id, { workflowState: to, workflowStateReason: clip(reason, 500), workflowStateActor: 'agent' });
    return { from, to };
  };

  // ── Policy checks ──
  if (!agent || !isAvailable(agent)) {
    return done('skipped', { outcome: 'failed', error: `${agent?.name ?? job.agent} is not available in this version${agent ? ` (planned for phase ${agent.phase})` : ''}.`, errorKind: 'permanent' });
  }
  if (!modeAllows(settings.mode, agent.minimumMode)) {
    return done('cancelled', {
      outcome: 'cancelled',
      error: `${agent.name} is not allowed in ${MODE_META[settings.mode].label} mode (needs ${MODE_META[agent.minimumMode].label}).`,
      errorKind: 'policy',
    });
  }
  if (OUTBOUND_AGENTS.includes(job.agent) && (settings.outboundStopped || !ctx.outboundAvailable)) {
    return done('cancelled', { outcome: 'cancelled', error: 'Outbound sending is stopped for this workspace.', errorKind: 'policy' });
  }
  const parsed = agent.input.safeParse(job.payload);
  if (!parsed.success) {
    return done('failed', { outcome: 'failed', error: `Invalid job input: ${clip(parsed.error.issues[0]?.message ?? 'invalid', 200)}`, errorKind: 'permanent' });
  }
  if (agent.needsBusiness) {
    if (!job.businessId) return done('failed', { outcome: 'failed', error: `${agent.name} needs a prospect.`, errorKind: 'permanent' });
    business = await ctx.svc.store.getBusiness(job.businessId);
    if (!business) return done('cancelled', { outcome: 'cancelled', error: 'The prospect no longer exists.', errorKind: 'cancelled' });
    if (business.contactPermission === 'opted_out' || workflowStateOf(business) === 'opted_out') {
      return done('cancelled', { outcome: 'cancelled', error: 'This business opted out; automation for it is stopped.', errorKind: 'policy' });
    }
  }

  // ── Budget hard stop ──
  const estimate = agent.estimate?.({ input: parsed.data, settings, tools: ctx.tools }) ?? {};
  if (totalEstimate(estimate) > 0) {
    const usage = await ctx.svc.store.listUsage(monthStart(now).toISOString());
    const decision = checkBudgets(settings.budgets, spendByProvider(usage, now), estimate, { automated: true, now });
    if (!decision.ok) {
      if (decision.kind === 'missing') return done('skipped', { outcome: 'failed', error: decision.message, errorKind: 'budget' });
      if (business && WORKFLOW_META[workflowStateOf(business)].group === 'research') {
        await moveWorkflow(business, 'retry_pending', `Waiting for budget: ${decision.message}`);
      }
      return done('deferred', { outcome: 'deferred', error: decision.message, errorKind: 'budget', runAfter: decision.retryAt });
    }
  }

  // ── Run with a timeout ──
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, agent.timeoutMs);
  let result: AgentResult;
  try {
    result = await agent.run!({
      input: parsed.data,
      jobId: job.id,
      traceId: job.traceId,
      business,
      // Agents get a store that refuses consent, suppression lifts, deletions and permission changes.
      svc: { ...ctx.svc, store: agentStore(ctx.svc.store) },
      tools: ctx.tools,
      settings,
      signal: controller.signal,
      now,
      charge: (call) => calls.push(call),
    });
    if (timedOut) throw new Error('timeout');
  } catch (error) {
    const { kind, message } = classifyError(error, timedOut, agent.timeoutMs);
    const retryable = (kind === 'retryable' || kind === 'timeout') && !OUTBOUND_AGENTS.includes(job.agent);
    const final = !retryable || job.attempts >= job.maxAttempts;
    if (final && business) {
      const latest = (await ctx.svc.store.getBusiness(business.id).catch(() => null)) ?? business;
      if (WORKFLOW_META[workflowStateOf(latest)].group === 'research') await moveWorkflow(latest, 'failed', `${agent.name} failed: ${message}`).catch(() => null);
    }
    const runAfter = retryable && !final ? new Date(now.getTime() + backoffMs(job.attempts, ctx.random)).toISOString() : null;
    return done('failed', { outcome: retryable && !final ? 'retry' : 'failed', error: message, errorKind: kind, runAfter });
  } finally {
    clearTimeout(timer);
  }

  // ── Apply the result ──
  const cancelRequested = (await ctx.automation.getJob(job.id))?.cancelRequested ?? false;
  let transition: Record<string, unknown> | null = null;
  if (business) {
    const latest = (await ctx.svc.store.getBusiness(business.id)) ?? business;
    const current = workflowStateOf(latest);
    if (result.transition) {
      transition = await moveWorkflow(latest, result.transition.to, `${agent.name}: ${result.transition.reason}`);
    } else if ((current === 'retry_pending' || current === 'failed') && agent.stepState) {
      transition = await moveWorkflow(latest, agent.stepState, `${agent.name} completed`);
    }
  }

  const queued: { agent: AgentKey; jobId: string; created: boolean }[] = [];
  const skipped: { agent: AgentKey; reason: string }[] = [];
  if (!cancelRequested) {
    for (const follow of result.followUps ?? []) {
      const def = AGENTS[follow.agent];
      const blocker = queueBlocker(def, settings, ctx.outboundAvailable);
      if (blocker) {
        skipped.push({ agent: follow.agent, reason: blocker });
        continue;
      }
      const { job: child, created } = await ctx.automation.enqueue({
        ...follow,
        parentJobId: job.id,
        idempotencyKey: followUpKey(job.traceId, follow.agent, follow.businessId),
        estimatedCostUsd: totalEstimate(def.estimate?.({ input: def.input.parse(follow.payload ?? {}), settings, tools: ctx.tools }) ?? {}),
      });
      queued.push({ agent: follow.agent, jobId: child.id, created });
    }
  }

  return done(
    'succeeded',
    {
      outcome: 'succeeded',
      result: { summary: clip(result.summary, 500), output: result.output ?? null, transition, followUps: queued, skippedFollowUps: skipped, cancelRequested },
    },
    {
      summary: result.summary,
      decision: result.decision,
      confidence: result.confidence,
      output: { ...(result.output ?? {}), ...(transition ? { transition } : {}), ...(queued.length ? { followUps: queued } : {}), ...(skipped.length ? { skippedFollowUps: skipped } : {}) },
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  );
}
