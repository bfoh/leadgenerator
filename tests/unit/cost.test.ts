import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLASSIFY_MAX_INPUT_TOKENS, CLASSIFY_MAX_OUTPUT_TOKENS, MODEL_PRICING, NOTE_MAX_INPUT_TOKENS, REPORT_MAX_INPUT_TOKENS, aiClassifyEstimateUsd, tokenCostUsd } from '@/lib/automation/pricing';
import type { EvidencePack } from '@/lib/domain/evidence';
import { sdk } from './fake-anthropic';

// Cost testing (phase 10). Budget checks reserve a fixed estimate per AI call, so the estimate must be
// a true upper bound: whatever a reply or the stored evidence contains, a request can never use more
// input tokens than were reserved. A token covers at least one byte of UTF-8, so the bytes sent bound
// the tokens. Also checks that normal test runs cannot reach a real (paid) service.

vi.mock('@anthropic-ai/sdk', () => import('./fake-anthropic'));
vi.mock('@anthropic-ai/sdk/helpers/beta/zod', () => ({ betaZodOutputFormat: () => ({ type: 'json_schema', schema: { type: 'object' } }) }));

const bytes = (s: unknown) => new TextEncoder().encode(typeof s === 'string' ? s : JSON.stringify(s)).length;
const usage = { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  process.env.ANTHROPIC_MODEL = 'model-cost';
  sdk.retrieve.mockResolvedValue({ id: 'model-cost', display_name: 'Test model', max_tokens: 64000, capabilities: { structured_outputs: { supported: true }, effort: { supported: true } } });
  sdk.parse.mockReset();
});

function sentBytes() {
  const [request] = sdk.parse.mock.calls.at(-1) as [{ system: string; messages: { content: string }[]; output_config: { format: unknown }; max_tokens: number }];
  return { total: bytes(request.system) + bytes(request.messages[0].content) + bytes(request.output_config.format), maxTokens: request.max_tokens };
}

/** An evidence pack at the limits its schema allows: 80 long items and 30 unknowns. */
function hugePack(): EvidencePack {
  const long = '<'.repeat(1200) + '€'.repeat(600);
  return {
    business: { name: 'Huge Pack Ltd', category: 'Tailor', city: 'Accra', region: null, neighborhood: null, country: 'Ghana', websiteStatus: 'unverified' },
    items: Array.from({ length: 80 }, (_, i) => ({ id: `E${i + 1}`, kind: 'note' as const, statement: long, source: `https://example.org/${'x'.repeat(1900)}`, recordedAt: null, userSupplied: true })),
    unknowns: Array.from({ length: 30 }, () => 'u'.repeat(300)),
    generatedAt: '2026-10-23T10:00:00Z',
  } as unknown as EvidencePack;
}

describe('AI cost bounds', () => {
  it('reserves an upper bound for a reply reading, however hostile the reply', async () => {
    const { classifyReplyWithAi } = await import('@/lib/server/ai/reply-classifier');
    sdk.parse.mockResolvedValue({ stop_reason: 'end_turn', parsed_output: { intent: 'unclear', confidence: 40, summary: '' }, model: 'claude-opus-5-5', usage });
    // 20,000 "<" (each escaped to six characters) and four-byte emoji: far past the character cap.
    await classifyReplyWithAi({ channel: 'email', subject: '<'.repeat(500), body: '<'.repeat(20_000) + '😀'.repeat(5_000) });
    const { total, maxTokens } = sentBytes();
    expect(total).toBeLessThanOrEqual(CLASSIFY_MAX_INPUT_TOKENS);
    expect(maxTokens).toBeLessThanOrEqual(CLASSIFY_MAX_OUTPUT_TOKENS);
    for (const model of Object.keys(MODEL_PRICING)) expect(tokenCostUsd(model, total, maxTokens)).toBeLessThanOrEqual(aiClassifyEstimateUsd(model));
  });

  it('refuses an AI report or note before calling when the evidence is larger than the reserved input', async () => {
    const { generateAiReport } = await import('@/lib/server/ai/report-generator');
    const { generateOutreachNote } = await import('@/lib/server/ai/outreach-note');
    const pack = hugePack();
    expect(bytes(pack)).toBeGreaterThan(REPORT_MAX_INPUT_TOKENS);
    await expect(generateAiReport(pack)).rejects.toThrow(/larger than one AI call is budgeted for.*rule-based report/);
    await expect(generateOutreachNote(pack)).rejects.toThrow(/larger than one AI call is budgeted for.*without the AI note/);
    expect(sdk.parse).not.toHaveBeenCalled();
    expect(NOTE_MAX_INPUT_TOKENS).toBeLessThanOrEqual(REPORT_MAX_INPUT_TOKENS);
  });

  it('keeps every daily AI quota finite by default', async () => {
    const { serverEnv } = await import('@/lib/server/env');
    for (const quota of [serverEnv.quota.aiReports(), serverEnv.quota.aiNotes(), serverEnv.quota.aiClassifications()]) {
      expect(quota).toBeGreaterThan(0);
      expect(quota).toBeLessThanOrEqual(100);
    }
  });
});

describe('test isolation from paid services', () => {
  it('blocks real network requests in normal test runs', async () => {
    for (const url of ['https://api.anthropic.com/v1/models', 'https://places.googleapis.com/v1/places:searchText', 'https://api.search.brave.com/res/v1/web/search', 'https://api.resend.com/emails', 'https://graph.facebook.com/v21.0/me']) {
      await expect(fetch(url)).rejects.toThrow(/Blocked a network request/);
    }
  });
});
