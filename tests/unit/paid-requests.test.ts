import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENTS } from '@/lib/automation/agents/catalog';
import { LONGEST_JOB_MS } from '@/lib/automation/engine';
import { unsettledMarkers } from '@/lib/automation/paid-calls';
import { aiClassifyEstimateUsd } from '@/lib/automation/pricing';
import type { EvidencePack } from '@/lib/domain/evidence';
import type { RequestContext } from '@/lib/server/context';
import { ProviderError } from '@/lib/server/providers/discovery';
import { sdk } from './fake-anthropic';
import { FakeSupabase } from './fake-supabase';

// Worker reliability: the routes that run jobs stop starting work in time for the slowest job to
// finish, AI requests are sent once (no SDK retries), every failure says whether it was charged, and
// the paid-request ledger records a request before it is sent. Nothing leaves the machine: the SDK is
// a fake and the database is FakeSupabase.

vi.mock('@anthropic-ai/sdk', () => import('./fake-anthropic'));
vi.mock('@anthropic-ai/sdk/helpers/beta/zod', () => ({ betaZodOutputFormat: () => ({ type: 'json_schema', schema: { type: 'object' } }) }));

const tokens = { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const reading = { intent: 'unclear', confidence: 40, summary: 'Asks a question.' };
const message = { channel: 'email' as const, subject: 'Hello', body: 'Do you build websites?' };
const pack = {
  business: { name: 'Pack Ltd', category: 'Tailor', city: 'Accra', region: null, neighborhood: null, country: 'Ghana', websiteStatus: 'unverified' },
  items: [],
  unknowns: [],
  generatedAt: '2026-10-24T10:00:00Z',
} as unknown as EvidencePack;

let db: FakeSupabase;
let ctx: RequestContext;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-5-5';
  sdk.retrieve.mockResolvedValue({ id: 'claude-sonnet-5-5', display_name: 'Test model', max_tokens: 64000, capabilities: { structured_outputs: { supported: true }, effort: { supported: true } } });
  sdk.parse.mockReset();
  sdk.clients.length = 0;
  db = new FakeSupabase();
  ctx = { mode: 'worker', key: 'worker:org-1', userId: null, orgId: 'org-1', role: null, supabase: db.client };
});

const ledger = () =>
  db.rows('usage_records').map((r) => ({
    operation: r.operation as string,
    estimatedCostUsd: Number(r.estimated_cost_usd),
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: r.created_at as string,
  }));

describe('worker time limits', () => {
  it('lets the slowest job finish before either route is stopped', async () => {
    const { RUN_LIMITS, finishWithinMs } = await import('@/lib/server/automation/runner');
    const stopAt = RUN_LIMITS.maxDurationMs - RUN_LIMITS.stopMarginMs;
    expect(RUN_LIMITS.workerStartWindowMs + LONGEST_JOB_MS).toBeLessThanOrEqual(stopAt);
    expect(RUN_LIMITS.foregroundStartWindowMs + LONGEST_JOB_MS).toBeLessThanOrEqual(stopAt);
    expect(finishWithinMs(1_000, 11_000)).toBe(stopAt - 10_000);
    // Vercel Hobby with Fluid compute allows at most 300 s.
    expect(RUN_LIMITS.maxDurationMs).toBeLessThanOrEqual(300_000);
    for (const route of ['src/app/api/cron/automation/route.ts', 'src/app/api/automation/run/route.ts']) {
      const source = readFileSync(route, 'utf8');
      expect(source).toContain(`export const maxDuration = ${RUN_LIMITS.maxDurationMs / 1000};`);
      expect(source).toContain('finishWithinMs: finishWithinMs(startedAt)');
    }
  });

  it('gives every AI request a client timeout shorter than its agent’s, and no SDK retries', async () => {
    const { generateAiReport } = await import('@/lib/server/ai/report-generator');
    const { generateOutreachNote } = await import('@/lib/server/ai/outreach-note');
    const { classifyReplyWithAi } = await import('@/lib/server/ai/reply-classifier');
    sdk.parse.mockRejectedValue(new ProviderError('stop here', false, 'none'));
    await expect(generateAiReport(pack)).rejects.toThrow();
    await expect(generateOutreachNote(pack)).rejects.toThrow();
    await expect(classifyReplyWithAi(message)).rejects.toThrow();
    const paid = sdk.clients.filter((c) => (c.timeout as number) > 10_000);
    expect(paid).toHaveLength(3);
    for (const c of paid) expect(c.maxRetries).toBe(0);
    const [report, note, classify] = paid.map((c) => c.timeout as number);
    expect(report).toBeLessThan(AGENTS.opportunity_report.timeoutMs);
    expect(note).toBeLessThan(AGENTS.outreach_drafting.timeoutMs);
    expect(classify).toBeLessThan(AGENTS.response_classification.timeoutMs);
  });
});

describe('AI request failures say whether they were charged', () => {
  async function failure(error: unknown) {
    const { classifyReplyWithAi } = await import('@/lib/server/ai/reply-classifier');
    sdk.parse.mockRejectedValueOnce(error);
    return classifyReplyWithAi(message).then(
      () => null,
      (e: unknown) => e as ProviderError,
    );
  }

  it('maps each SDK failure to its billing', async () => {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const fake = Anthropic as unknown as Record<string, new (status?: number) => Error>;
    expect(await failure(new fake.APIUserAbortError())).toMatchObject({ billing: 'unknown' });
    expect(await failure(new fake.APIConnectionTimeoutError())).toMatchObject({ billing: 'unknown' });
    expect(await failure(new fake.APIConnectionError())).toMatchObject({ billing: 'unknown' });
    expect(await failure(new fake.RateLimitError(429))).toMatchObject({ billing: 'none', retryable: true });
    expect(await failure(new fake.InternalServerError(529))).toMatchObject({ billing: 'none', retryable: true });
    expect(await failure(new fake.AuthenticationError(401))).toMatchObject({ billing: 'none', retryable: false });
    expect(await failure(new fake.BadRequestError(400))).toMatchObject({ billing: 'none', retryable: false });
  });

  it('charges an answer that arrived but cannot be used', async () => {
    const { classifyReplyWithAi } = await import('@/lib/server/ai/reply-classifier');
    sdk.parse.mockResolvedValueOnce({ stop_reason: 'max_tokens', parsed_output: null, model: 'claude-sonnet-5-5', usage: tokens });
    const error = (await classifyReplyWithAi(message).catch((e: unknown) => e)) as ProviderError;
    expect(error.billing).toBe('charged');
    expect(error.charge).toMatchObject({ model: 'claude-sonnet-5-5', usage: { inputTokens: 900, outputTokens: 40 } });
    expect(error.charge!.usage.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('refuses before sending, without charge, when the model check fails', async () => {
    const { classifyReplyWithAi } = await import('@/lib/server/ai/reply-classifier');
    // Model checks are cached per model, so use one this file has not checked yet.
    process.env.ANTHROPIC_MODEL = 'model-without-structured-outputs';
    sdk.retrieve.mockResolvedValueOnce({ id: 'model-without-structured-outputs', display_name: 'Test model', max_tokens: 64000, capabilities: { structured_outputs: { supported: false } } });
    const error = (await classifyReplyWithAi(message).catch((e: unknown) => e)) as ProviderError;
    expect(error.billing).toBe('none');
    expect(sdk.parse).not.toHaveBeenCalled();
  });
});

describe('paid-request ledger', () => {
  const spec = { provider: 'anthropic', operation: 'ai_classify', maxCostUsd: 0.25, metadata: { jobId: 'job-1' } };
  const cost = (r: number) => ({ estimatedCostUsd: r, metadata: { model: 'm' } });

  it('records the request before sending it and settles it with the actual cost', async () => {
    const { paidCall } = await import('@/lib/server/usage');
    let rowsWhenSent = -1;
    const { result, charge } = await paidCall(
      ctx,
      spec,
      async () => {
        rowsWhenSent = db.rows('usage_records').length;
        return 0.012;
      },
      cost,
    );
    expect(result).toBe(0.012);
    expect(rowsWhenSent).toBe(1);
    const [sent, answered] = ledger();
    expect(sent).toMatchObject({ operation: 'ai_classify:sent', estimatedCostUsd: 0, metadata: { jobId: 'job-1', maxCostUsd: 0.25 } });
    expect(answered).toMatchObject({ operation: 'ai_classify', estimatedCostUsd: 0.012, metadata: { jobId: 'job-1', model: 'm', callId: sent.metadata!.callId } });
    expect(charge.estimatedCostUsd).toBe(0.012);
    expect(unsettledMarkers(ledger())).toHaveLength(0);
  });

  it('sends nothing when the request cannot be recorded first', async () => {
    const { paidCall } = await import('@/lib/server/usage');
    db.failWrites.add('usage_records');
    const send = vi.fn(async () => 1);
    await expect(paidCall(ctx, spec, send, cost)).rejects.toThrow(/not sent/);
    expect(send).not.toHaveBeenCalled();
  });

  it('settles refused and unusable answers, and leaves a request with no answer open', async () => {
    const { paidCall } = await import('@/lib/server/usage');
    await expect(paidCall(ctx, spec, () => Promise.reject(new ProviderError('busy', true, 'none')), cost)).rejects.toThrow('busy');
    const unusable = new ProviderError('cut off', true, 'charged', { model: 'claude-sonnet-5-5', usage: { inputTokens: 900, outputTokens: 40, estimatedCostUsd: 0.0022 } });
    await expect(paidCall(ctx, spec, () => Promise.reject(unusable), cost)).rejects.toThrow('cut off');
    await expect(paidCall(ctx, spec, () => Promise.reject(new ProviderError('no answer', true, 'unknown')), cost)).rejects.toThrow('no answer');
    await expect(paidCall(ctx, spec, () => Promise.reject(new Error('socket hang up')), cost)).rejects.toThrow('socket hang up');

    const rows = ledger();
    expect(rows.map((r) => r.operation)).toEqual(['ai_classify:sent', 'ai_classify:refused', 'ai_classify:sent', 'ai_classify', 'ai_classify:sent', 'ai_classify:sent']);
    expect(rows[3]).toMatchObject({ estimatedCostUsd: 0.0022, metadata: { outcome: 'unusable' } });
    expect(unsettledMarkers(rows)).toHaveLength(2);
  });

  it('does not send when the job was already stopped', async () => {
    const { paidCall } = await import('@/lib/server/usage');
    const send = vi.fn(async () => 1);
    await expect(paidCall(ctx, { ...spec, signal: AbortSignal.abort() }, send, cost)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(db.rows('usage_records')).toHaveLength(0);
  });

  it('leaves the request open when the agent’s gateway call gets no answer, and counts it against manual budgets', async () => {
    const { serverToolGateway } = await import('@/lib/server/automation/tools');
    const { enforceBudget } = await import('@/lib/server/budget');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const fake = Anthropic as unknown as Record<string, new () => Error>;
    const gateway = serverToolGateway(ctx);

    sdk.parse.mockResolvedValueOnce({ stop_reason: 'end_turn', parsed_output: reading, model: 'claude-sonnet-5-5', usage: tokens });
    const ok = await gateway.aiClassifyReply!(message, { jobId: 'job-1' }, new AbortController().signal);
    expect(ok.call.estimatedCostUsd).toBeGreaterThan(0);
    expect(unsettledMarkers(ledger())).toHaveLength(0);

    sdk.parse.mockRejectedValueOnce(new fake.APIConnectionTimeoutError());
    await expect(gateway.aiClassifyReply!(message, { jobId: 'job-2' }, new AbortController().signal)).rejects.toMatchObject({ billing: 'unknown' });
    const open = unsettledMarkers(ledger());
    expect(open).toHaveLength(1);
    expect(open[0].metadata).toMatchObject({ jobId: 'job-2', maxCostUsd: aiClassifyEstimateUsd('claude-sonnet-5-5') });

    // A manual request is refused when the open request's maximum cost leaves no room in the budget.
    const room = aiClassifyEstimateUsd('claude-sonnet-5-5') * 1.5;
    db.rows('automation_settings').push({ organization_id: 'org-1', budgets: { anthropic: { dailyUsd: room, monthlyUsd: null } } });
    const manual: RequestContext = { mode: 'cloud', key: 'u', userId: 'u-1', orgId: 'org-1', role: 'owner', supabase: db.client };
    await expect(enforceBudget(manual, { anthropic: aiClassifyEstimateUsd('claude-sonnet-5-5') })).rejects.toThrow(/budget reached/);
    // Without the open request the same call would fit.
    db.tables.usage_records = db.rows('usage_records').filter((r) => (r.metadata as { jobId?: string } | null)?.jobId !== 'job-2');
    await expect(enforceBudget(manual, { anthropic: aiClassifyEstimateUsd('claude-sonnet-5-5') })).resolves.toBeUndefined();
  });
});
