import { beforeEach, describe, expect, it } from 'vitest';
import type { ToolGateway } from '@/lib/automation/agents/types';
import { checkBudgets, nextDayStart, spendByProvider } from '@/lib/automation/budget';
import { backoffMs, classifyError, followUpKey, processQueue, queueAgent, type EngineContext } from '@/lib/automation/engine';
import { LocalAutomationStore } from '@/lib/automation/local-store';
import { aiReportEstimateUsd } from '@/lib/automation/pricing';
import { AutomationError } from '@/lib/automation/store';
import { checkTransition, deriveWorkflowState, workflowStateOf } from '@/lib/automation/workflow';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { generateDeterministicReport, validateReport } from '@/lib/domain/report';
import type { BusinessForm, VerificationForm } from '@/lib/domain/schemas';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { Business } from '@/lib/domain/types';

const form = (overrides: Partial<BusinessForm> = {}): BusinessForm => ({
  name: 'Adom Bridal House',
  category: 'Bridal shop',
  country: 'GH',
  region: 'Greater Accra',
  city: 'Accra',
  neighborhood: 'Osu',
  address: null,
  businessStatus: 'active',
  officialWebsite: null,
  socialProfiles: [{ platform: 'instagram', url: 'https://instagram.com/adombridal' }],
  enquiryChannel: 'Instagram direct messages',
  phone: null,
  email: null,
  contactSource: null,
  interestLevel: 'unknown',
  budgetSignal: 'unknown',
  serviceNeeds: ['Booking website'],
  estimatedValue: null,
  expectedCloseDate: null,
  nextAction: null,
  nextActionDue: null,
  notes: '',
  sourceUrl: 'https://example.org/directory/adom',
  sourceKind: 'directory',
  placesPlaceId: null,
  ...overrides,
});

const noneFound: VerificationForm = {
  status: 'none_found',
  methods: ['exact_name_search', 'domain_probe', 'social_profile_review'],
  domain: null,
  sourceUrl: null,
  evidenceSummary: 'Exact-name searches and candidate domains found no official site; Instagram profile links nowhere else.',
  confidence: 'high',
  websiteOutdated: false,
  nextCheckAt: null,
};

let storage: MemoryStorage;
let now: Date;
let svcCtx: ServiceContext;
let automation: LocalAutomationStore;
let aiCalls: number;

function fakeTools(overrides: Partial<ToolGateway> = {}): ToolGateway {
  return {
    aiConfigured: true,
    aiModel: 'claude-sonnet-5-5',
    async aiReport(pack) {
      aiCalls++;
      const { content, validation } = validateReport(generateDeterministicReport(pack), pack);
      return {
        content,
        validation,
        model: 'claude-sonnet-5-5',
        usage: { inputTokens: 8000, outputTokens: 3000, estimatedCostUsd: 0.046 },
        call: { provider: 'anthropic', operation: 'ai_report', units: 1, estimatedCostUsd: 0.046, ok: true },
      };
    },
    // No network in unit tests: nothing resolves and no site answers.
    research: { available: true, simulated: false, search: { configured: false, provider: null, costPerQueryUsd: 0.005 } },
    async webSearch() {
      throw new Error('web search is not available in this test');
    },
    async probeDomains(domains) {
      return domains.map((domain) => ({ domain, resolves: false }));
    },
    async inspectWebsite(url) {
      return {
        check: { url, finalUrl: null, ok: false, status: null, redirects: [], https: true, responseMs: null, title: null, hasViewport: null, generator: null, error: 'Domain does not resolve', checkedAt: now.toISOString() },
        facts: null,
        robots: 'unavailable',
      };
    },
    contacts: { available: false, simulated: false },
    async readContactPage() {
      throw new Error('contact pages are not available in this test');
    },
    async lookupMx() {
      return [];
    },
    ...overrides,
  };
}

function engine(tools: ToolGateway = fakeTools()): EngineContext {
  return { automation, svc: svcCtx, tools, workerId: 'test', clock: () => now, random: () => 1 };
}

async function qualifiedBusiness(overrides: Partial<BusinessForm> = {}) {
  const b = await svc.createBusiness(svcCtx, form(overrides));
  const { business } = await svc.recordVerification(svcCtx, b, noneFound);
  return business;
}

beforeEach(() => {
  storage = new MemoryStorage();
  now = new Date('2026-10-22T10:00:00Z');
  svcCtx = { store: new LocalStore(storage), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user' };
  automation = new LocalAutomationStore(storage, { clock: () => now });
  aiCalls = 0;
});

describe('workflow state machine', () => {
  it('derives states from CRM stages the same way as the migration backfill', () => {
    const base = { stage: 'research_candidate', websiteStatus: 'unverified', contactPermission: 'unknown', interestLevel: 'unknown' } as const;
    expect(deriveWorkflowState(base)).toBe('discovered');
    expect(deriveWorkflowState({ ...base, websiteStatus: 'none_found' })).toBe('contact_research');
    expect(deriveWorkflowState({ ...base, stage: 'qualified' })).toBe('qualification');
    expect(deriveWorkflowState({ ...base, stage: 'lost', interestLevel: 'none' })).toBe('not_interested');
    expect(deriveWorkflowState({ ...base, stage: 'lost' })).toBe('disqualified');
    expect(deriveWorkflowState({ ...base, stage: 'won', contactPermission: 'opted_out' })).toBe('opted_out');
  });

  it('lets opt-out win and keeps agents out of outreach', () => {
    const unknown = { contactPermission: 'unknown', lawfulBasis: null } as const;
    const granted = { contactPermission: 'granted', lawfulBasis: 'consent' } as const;
    const agent = { kind: 'agent', agent: 'opportunity_scoring' } as const;
    expect(checkTransition('qualification', 'opted_out', agent, unknown).ok).toBe(true);
    expect(checkTransition('qualification', 'opportunity_report', { kind: 'user' }, { contactPermission: 'opted_out', lawfulBasis: null }).ok).toBe(false);
    expect(checkTransition('discovered', 'qualification', agent, unknown).ok).toBe(true);
    expect(checkTransition('proposal_draft', 'ready_for_outreach', agent, granted).ok).toBe(false);
    expect(checkTransition('ready_for_outreach', 'contacted', { kind: 'agent', agent: 'outreach_execution' }, granted).ok).toBe(true);
    expect(checkTransition('proposal_draft', 'ready_for_outreach', { kind: 'user' }, unknown).ok).toBe(false);
    expect(checkTransition('proposal_draft', 'ready_for_outreach', { kind: 'user' }, granted).ok).toBe(true);
    expect(checkTransition('archived', 'discovered', agent, unknown).ok).toBe(false);
    expect(checkTransition('archived', 'discovered', { kind: 'user' }, unknown).ok).toBe(true);
    expect(checkTransition('contact_research', 'needs_human_review', agent, unknown).ok).toBe(true);
  });

  it('records transitions and forces opted_out in the demo store like the database trigger', async () => {
    const b = await svc.createBusiness(svcCtx, form());
    expect(b.workflowState).toBe('discovered');
    const updated = await svcCtx.store.updateBusiness(b.id, { contactPermission: 'opted_out', optedOutAt: now.toISOString() });
    expect(updated.workflowState).toBe('opted_out');
    expect(updated.workflowStateActor).toBe('system');
    const won = await svc.createBusiness(svcCtx, form({ name: 'Kente Couture' }));
    const after = await svcCtx.store.updateBusiness(won.id, { stage: 'won' });
    expect(after.workflowState).toBe('client_won');
    const log = await svcCtx.store.listWorkflowTransitions(b.id);
    expect(log.map((t) => t.toState)).toEqual(['opted_out', 'discovered']);
  });
});

describe('budgets', () => {
  const usage = (provider: string, cost: number, createdAt: string) => ({ provider, estimatedCostUsd: cost, createdAt });

  it('sums spend by provider for the GMT day and month', () => {
    const spend = spendByProvider([usage('anthropic', 0.5, '2026-10-22T08:00:00Z'), usage('anthropic', 1, '2026-10-02T08:00:00Z'), usage('anthropic', 9, '2026-09-30T23:00:00Z')], now);
    expect(spend.day.anthropic).toBeCloseTo(0.5);
    expect(spend.month.anthropic).toBeCloseTo(1.5);
    expect(spend.month.total).toBeCloseTo(1.5);
  });

  it('requires an explicit budget for automated paid work but not for manual work', () => {
    const empty = spendByProvider([], now);
    const automated = checkBudgets({}, empty, { anthropic: 0.18 }, { automated: true, now });
    expect(automated.ok).toBe(false);
    expect(!automated.ok && automated.kind).toBe('missing');
    expect(checkBudgets({}, empty, { anthropic: 0.18 }, { automated: false, now }).ok).toBe(true);
  });

  it('stops at daily, monthly and total limits and says when the window resets', () => {
    const spend = spendByProvider([usage('anthropic', 0.9, '2026-10-22T08:00:00Z')], now);
    const daily = checkBudgets({ anthropic: { dailyUsd: 1, monthlyUsd: null } }, spend, { anthropic: 0.18 }, { automated: true, now });
    expect(daily.ok).toBe(false);
    expect(!daily.ok && daily.kind === 'exceeded' && daily.retryAt).toBe(nextDayStart(now).toISOString());
    expect(checkBudgets({ anthropic: { dailyUsd: 2, monthlyUsd: null } }, spend, { anthropic: 0.18 }, { automated: true, now }).ok).toBe(true);
    const total = checkBudgets({ anthropic: { dailyUsd: 2, monthlyUsd: null }, total: { dailyUsd: 1, monthlyUsd: null } }, spend, { anthropic: 0.18 }, { automated: false, now });
    expect(!total.ok && total.provider).toBe('total');
  });

  it('estimates an AI report as an upper bound', () => {
    expect(aiReportEstimateUsd('claude-sonnet-5-5')).toBeCloseTo(0.22);
  });
});

describe('retries', () => {
  it('backs off exponentially with jitter and a one-hour cap', () => {
    expect(backoffMs(1, () => 1)).toBe(30_000);
    expect(backoffMs(2, () => 1)).toBe(60_000);
    expect(backoffMs(3, () => 0)).toBe(60_000);
    expect(backoffMs(20, () => 1)).toBe(3_600_000);
  });

  it('classifies errors without leaking detail', () => {
    expect(classifyError(new Error('x'), true, 20_000)).toEqual({ kind: 'timeout', message: 'Timed out after 20 s.' });
    expect(classifyError(Object.assign(new Error('rate limited'), { retryable: true }), false, 0).kind).toBe('retryable');
    expect(classifyError(Object.assign(new Error('bad key'), { retryable: false }), false, 0).kind).toBe('permanent');
    expect(classifyError(Object.assign(new Error('Forbidden'), { status: 403 }), false, 0).kind).toBe('permanent');
    expect(classifyError(Object.assign(new Error('Unavailable'), { status: 503 }), false, 0).kind).toBe('retryable');
  });
});

describe('demo job queue', () => {
  it('starts in research-only mode with the outbound stop engaged and refuses outreach', async () => {
    const s = await automation.getSettings();
    expect(s.mode).toBe('research_only');
    expect(s.outboundStopped).toBe(true);
    await expect(automation.updateSettings({ mode: 'approval_based_outreach' })).rejects.toThrow(/not available/);
    await expect(automation.enqueue({ agent: 'outreach_execution' })).rejects.toThrow(/stopped/);
  });

  it('deduplicates by idempotency key', async () => {
    const a = await automation.enqueue({ agent: 'opportunity_scoring', businessId: 'b1', idempotencyKey: 'k1' });
    const b = await automation.enqueue({ agent: 'opportunity_scoring', businessId: 'b1', idempotencyKey: 'k1' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it('respects pause, disabled agents and the concurrency limit', async () => {
    for (let i = 0; i < 4; i++) await automation.enqueue({ agent: 'opportunity_scoring', businessId: `b${i}` });
    await automation.updateSettings({ paused: true });
    expect(await automation.claim('w', 5, 60)).toHaveLength(0);
    await automation.updateSettings({ paused: false, disabledAgents: ['opportunity_scoring'] });
    expect(await automation.claim('w', 5, 60)).toHaveLength(0);
    await automation.updateSettings({ disabledAgents: [] });
    const first = await automation.claim('w', 5, 60);
    expect(first).toHaveLength(2); // default concurrency
    expect(first[0].attempts).toBe(1);
    expect(await automation.claim('w', 5, 60)).toHaveLength(0);
  });

  it('retries with backoff, dead-letters after the last attempt, and rejects stale leases', async () => {
    await automation.enqueue({ agent: 'opportunity_scoring', businessId: 'b1', maxAttempts: 2 });
    let [job] = await automation.claim('w', 1, 60);
    await expect(automation.finish({ ...job, leaseToken: 'stale' }, { outcome: 'succeeded' })).rejects.toBeInstanceOf(AutomationError);
    const retried = await automation.finish(job, { outcome: 'retry', error: 'busy', errorKind: 'retryable', runAfter: '2026-10-22T10:01:00Z' });
    expect(retried.status).toBe('pending');
    expect(await automation.claim('w', 1, 60)).toHaveLength(0); // not due yet
    now = new Date('2026-10-22T10:02:00Z');
    [job] = await automation.claim('w', 1, 60);
    expect(job.attempts).toBe(2);
    const dead = await automation.finish(job, { outcome: 'retry', error: 'busy', errorKind: 'retryable' });
    expect(dead.status).toBe('failed');
    const again = await automation.retry(dead.id);
    expect(again.status).toBe('pending');
    expect(again.attempts).toBe(0);
  });

  it('does not count budget deferrals as attempts', async () => {
    await automation.enqueue({ agent: 'opportunity_report', businessId: 'b1' });
    const [job] = await automation.claim('w', 1, 60);
    const deferred = await automation.finish(job, { outcome: 'deferred', error: 'budget', errorKind: 'budget', runAfter: '2026-10-23T00:00:00Z' });
    expect(deferred.status).toBe('pending');
    expect(deferred.attempts).toBe(0);
  });

  it('recovers expired leases, and turns a running cancel into a cancellation', async () => {
    await automation.enqueue({ agent: 'opportunity_scoring', businessId: 'b1' });
    await automation.enqueue({ agent: 'opportunity_scoring', businessId: 'b2' });
    const [a, b] = await automation.claim('w', 2, 30);
    await automation.cancel(b.id);
    expect((await automation.finish(b, { outcome: 'retry', error: 'x', errorKind: 'retryable' })).status).toBe('cancelled');
    now = new Date('2026-10-22T10:05:00Z');
    const [recovered] = await automation.claim('w2', 1, 30);
    expect(recovered.id).toBe(a.id);
    expect(recovered.attempts).toBe(2);
  });
});

describe('automation engine', () => {
  it('runs the research pipeline: scoring, contact research and validation, then a rule-based report, with one trace and audited transitions', async () => {
    const business = await qualifiedBusiness({ phone: '030 212 3456', contactSource: 'Business card from the owner' });
    const settings = await automation.getSettings();
    await queueAgent(engine(), settings, { agent: 'opportunity_scoring', businessId: business.id });

    const summary = await processQueue(engine(), { maxJobs: 6 });
    expect(summary.outcomes.map((o) => [o.agent, o.outcome])).toEqual([
      ['opportunity_scoring', 'succeeded'],
      ['contact_research', 'succeeded'],
      ['contact_validation', 'succeeded'],
      ['opportunity_report', 'succeeded'],
    ]);
    // The profile phone is now tracked with its source and checked; no consent was recorded.
    const [point] = await svcCtx.store.listContactPoints(business.id);
    expect(point).toMatchObject({ type: 'phone', normalizedValue: '+233302123456', sourceType: 'crm_record', sourceNote: 'Business card from the owner', classification: 'source_confirmed', agentVersion: 'contact-research-1.0.0' });
    expect(point.validation?.result).toBe('valid');
    expect(await svcCtx.store.listConsentRecords(business.id)).toHaveLength(0);
    expect(aiCalls).toBe(0); // no Anthropic budget set → rule-based
    const reports = await svcCtx.store.listReports(business.id);
    expect(reports).toHaveLength(1);
    expect(reports[0].generator).toBe('deterministic');

    const after = (await svcCtx.store.getBusiness(business.id))!;
    expect(workflowStateOf(after)).toBe('opportunity_report');
    expect(after.workflowStateActor).toBe('agent');
    const states = (await svcCtx.store.listWorkflowTransitions(business.id)).map((t) => t.toState);
    expect(states).toEqual(expect.arrayContaining(['qualification', 'contact_research', 'opportunity_report']));
    const runs = await automation.listRuns({ businessId: business.id });
    expect(new Set(runs.map((r) => r.traceId)).size).toBe(1);
    expect(runs.every((r) => r.agentVersion !== 'planned' && r.status === 'succeeded')).toBe(true);
  });

  it('sends unverified or inconclusive prospects back to website verification without a report', async () => {
    const fresh = await svc.createBusiness(svcCtx, form());
    const inconclusive = await svc.createBusiness(svcCtx, form({ name: 'Inconclusive Co' }));
    await svc.recordVerification(svcCtx, inconclusive, { ...noneFound, status: 'insufficient_evidence', methods: ['exact_name_search'], confidence: 'low' });
    for (const b of [fresh, inconclusive]) await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_scoring', businessId: b.id });

    const summary = await processQueue(engine(), { maxJobs: 5 });
    expect(summary.outcomes.map((o) => o.agent)).toEqual(['opportunity_scoring', 'opportunity_scoring']);
    for (const b of [fresh, inconclusive]) expect(workflowStateOf((await svcCtx.store.getBusiness(b.id))!)).toBe('website_verification');
    const decisions = (await automation.listRuns()).map((r) => r.decision).sort();
    expect(decisions).toEqual(['Needs more website verification', 'Needs website verification first']);
  });

  it('does not queue a second follow-up for the same trace when a step is replayed', async () => {
    const business = await qualifiedBusiness();
    const { job } = await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_scoring', businessId: business.id });
    await processQueue(engine(), { maxJobs: 3 });
    const [research] = await automation.listJobs({ agent: 'contact_research' });
    const [validation] = await automation.listJobs({ agent: 'contact_validation' });
    const [report] = await automation.listJobs({ agent: 'opportunity_report' });
    // A replayed step derives the same key for its follow-up.
    for (const [agent, existing] of [
      ['contact_research', research],
      ['opportunity_report', report],
    ] as const) {
      const replay = await automation.enqueue({ agent, businessId: business.id, idempotencyKey: followUpKey(job.traceId, agent, business.id) });
      expect(replay.created).toBe(false);
      expect(replay.job.id).toBe(existing.id);
    }
    expect(research.parentJobId).toBe(job.id);
    expect(validation.parentJobId).toBe(research.id);
    expect(report.parentJobId).toBe(validation.id);
    expect(new Set([research.traceId, validation.traceId, report.traceId])).toEqual(new Set([job.traceId]));
  });

  it('goes straight from scoring to the report without the contact tables (before migration 005)', async () => {
    const business = await qualifiedBusiness();
    const store = svcCtx.store;
    svcCtx = { ...svcCtx, store: Object.assign(Object.create(store), { contactSchemaAvailable: async () => false }) };
    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_scoring', businessId: business.id });
    const summary = await processQueue(engine(), { maxJobs: 3 });
    expect(summary.outcomes.map((o) => o.agent)).toEqual(['opportunity_scoring', 'opportunity_report']);
  });

  it('uses AI for "auto" reports only once an Anthropic budget is set, and records the cost', async () => {
    const business = await qualifiedBusiness();
    await automation.updateSettings({ budgets: { anthropic: { dailyUsd: 1, monthlyUsd: 10 } } });
    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_report', businessId: business.id, payload: { generator: 'auto' } });
    const [outcome] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
    expect(outcome.outcome).toBe('succeeded');
    expect(aiCalls).toBe(1);
    const [run] = await automation.listRuns({ businessId: business.id });
    expect(run.model).toBe('claude-sonnet-5-5');
    expect(run.estimatedCostUsd).toBeCloseTo(0.046);
  });

  it('refuses automated AI without a budget and defers when the budget is spent', async () => {
    const business = await qualifiedBusiness();
    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_report', businessId: business.id, payload: { generator: 'ai' } });
    let [outcome] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
    expect(outcome.outcome).toBe('failed');
    expect(outcome.message).toMatch(/Set a daily or monthly budget/);
    expect(aiCalls).toBe(0);

    await automation.updateSettings({ budgets: { anthropic: { dailyUsd: 0.1, monthlyUsd: null } } });
    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_report', businessId: business.id, payload: { generator: 'ai' }, idempotencyKey: 'second' });
    [outcome] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
    expect(outcome.outcome).toBe('deferred');
    const job = (await automation.listJobs({ statuses: ['pending'] }))[0];
    expect(job.runAfter).toBe('2026-10-23T00:00:00.000Z');
    expect(job.attempts).toBe(0);
    expect(workflowStateOf((await svcCtx.store.getBusiness(business.id))!)).toBe('retry_pending');
  });

  it('stops automation for opted-out businesses, planned agents and agents above the mode', async () => {
    const business = await qualifiedBusiness();
    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_scoring', businessId: business.id });
    await svcCtx.store.updateBusiness(business.id, { contactPermission: 'opted_out', optedOutAt: now.toISOString() });
    const [outcome] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
    expect(outcome.outcome).toBe('cancelled');
    expect(outcome.message).toMatch(/opted out/);
    await queueAgent(engine(), await automation.getSettings(), { agent: 'contact_research', businessId: business.id });
    const [research] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
    expect(research).toMatchObject({ agent: 'contact_research', outcome: 'cancelled' });
    expect(await svcCtx.store.listContactPoints(business.id)).toHaveLength(0);
    await expect(queueAgent(engine(), await automation.getSettings(), { agent: 'sales_intelligence' })).rejects.toThrow(/planned for phase 11/);
    await expect(queueAgent(engine(), await automation.getSettings(), { agent: 'response_classification', businessId: business.id })).rejects.toThrow(/needs Research \+ proposals mode/);
    await expect(queueAgent(engine(), await automation.getSettings(), { agent: 'follow_up_planning', businessId: business.id })).rejects.toThrow(/needs Research \+ proposals mode/);
    await expect(queueAgent(engine(), await automation.getSettings(), { agent: 'outreach_drafting', businessId: business.id })).rejects.toThrow(/needs Research \+ proposals mode/);
    await expect(queueAgent(engine(), await automation.getSettings(), { agent: 'proposal_generation', businessId: business.id })).rejects.toThrow(/needs Research \+ proposals mode/);
  });

  it('retries transient failures with backoff and marks the business failed after the last attempt', async () => {
    const business = await qualifiedBusiness();
    const failing = fakeTools({
      aiReport: async () => {
        throw Object.assign(new Error('AI provider error (529).'), { retryable: true });
      },
    });
    await automation.updateSettings({ budgets: { anthropic: { dailyUsd: 5, monthlyUsd: null } } });
    await queueAgent(engine(failing), await automation.getSettings(), { agent: 'opportunity_report', businessId: business.id, payload: { generator: 'ai' }, maxAttempts: 2 });
    let [outcome] = (await processQueue(engine(failing), { maxJobs: 1 })).outcomes;
    expect(outcome.outcome).toBe('retry');
    const pending = (await automation.listJobs())[0];
    expect(pending.runAfter).toBe('2026-10-22T10:00:30.000Z');
    now = new Date('2026-10-22T10:01:00Z');
    [outcome] = (await processQueue(engine(failing), { maxJobs: 1 })).outcomes;
    expect(outcome.outcome).toBe('failed');
    expect((await automation.listJobs())[0].status).toBe('failed');
    expect(workflowStateOf((await svcCtx.store.getBusiness(business.id))!)).toBe('failed');
  });

  it('times out slow agents', async () => {
    const business = await qualifiedBusiness();
    const slow = fakeTools({ aiReport: (_pack, _ctx, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))) });
    await automation.updateSettings({ budgets: { anthropic: { dailyUsd: 5, monthlyUsd: null } } });
    const { opportunityReportAgent } = await import('@/lib/automation/agents/research');
    const original = opportunityReportAgent.timeoutMs;
    opportunityReportAgent.timeoutMs = 20;
    try {
      await queueAgent(engine(slow), await automation.getSettings(), { agent: 'opportunity_report', businessId: business.id, payload: { generator: 'ai' } });
      const [outcome] = (await processQueue(engine(slow), { maxJobs: 1 })).outcomes;
      expect(outcome.outcome).toBe('retry');
      expect((await automation.listJobs())[0].errorKind).toBe('timeout');
    } finally {
      opportunityReportAgent.timeoutMs = original;
    }
  });

  it('cancels queued work the current mode does not allow, and refuses planned agents', async () => {
    const business: Business = await qualifiedBusiness();
    const { opportunityScoringAgent } = await import('@/lib/automation/agents/research');
    await automation.enqueue({ agent: 'opportunity_scoring', businessId: business.id });
    opportunityScoringAgent.minimumMode = 'research_and_proposals';
    try {
      const [outcome] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
      expect(outcome.outcome).toBe('cancelled');
      expect(outcome.message).toMatch(/not allowed in Research only mode/);
      expect((await automation.listJobs())[0].errorKind).toBe('cancelled');
    } finally {
      opportunityScoringAgent.minimumMode = 'research_only';
    }
    await automation.enqueue({ agent: 'sales_intelligence' });
    const [planned] = (await processQueue(engine(), { maxJobs: 1 })).outcomes;
    expect(planned.outcome).toBe('failed');
    expect(planned.message).toMatch(/not available in this version/);
  });
});
