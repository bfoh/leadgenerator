import { afterAll, describe, expect, it } from 'vitest';
import { aiClassifyEstimateUsd } from '@/lib/automation/pricing';
import { LIVE_BUDGET_USD, LIVE_ENABLED, reserve, reservedUsd } from './budget';

// Live provider checks (phase 10). Opt-in only (LIVE_INTEGRATION=1) and budget-capped: one free model
// lookup, one AI reading of a made-up reply, one web search and one Places search. Nothing is stored
// and no message is sent to anyone; sandbox sending is tested by a person in the app (runbook §12).

describe.skipIf(!LIVE_ENABLED)('live providers (paid, opt-in)', () => {
  afterAll(() => {
    console.log(`Live checks reserved $${reservedUsd()} of the $${LIVE_BUDGET_USD} budget (worst case; actual usage is lower).`);
  });

  it('Anthropic: the configured model is available (free metadata call)', async ({ skip }) => {
    if (!process.env.ANTHROPIC_API_KEY) skip();
    const { assertUsable, checkModel } = await import('@/lib/server/ai/model-check');
    const check = await checkModel(true);
    assertUsable(check);
    expect(check.structuredOutputs).not.toBe(false);
  });

  it('Anthropic: reads a made-up reply within the reserved cost', async ({ skip }) => {
    const { serverEnv } = await import('@/lib/server/env');
    const estimate = aiClassifyEstimateUsd(serverEnv.anthropicModel());
    if (!process.env.ANTHROPIC_API_KEY || !reserve(estimate)) skip();
    const { classifyReplyWithAi } = await import('@/lib/server/ai/reply-classifier');
    const { result, usage } = await classifyReplyWithAi({ channel: 'email', subject: 'Re: a website for the shop', body: 'Thanks for the note. How much would a simple booking website cost us?' });
    expect(['pricing_question', 'interested', 'more_information']).toContain(result.intent);
    expect(usage.estimatedCostUsd).toBeLessThanOrEqual(estimate);
  });

  it('Brave Search: one query', async ({ skip }) => {
    const { braveSearchProvider } = await import('@/lib/server/providers/web-search');
    if (!braveSearchProvider.isConfigured() || !reserve(braveSearchProvider.estimatedCostUsd())) skip();
    const results = await braveSearchProvider.search('tailor Osu Accra', AbortSignal.timeout(20_000));
    expect(Array.isArray(results)).toBe(true);
  });

  it('Google Places: one Text Search with the field mask', async ({ skip }) => {
    const { googlePlacesProvider } = await import('@/lib/server/providers/google-places');
    if (!googlePlacesProvider.isConfigured() || !reserve(googlePlacesProvider.estimatedCostUsd('search'))) skip();
    const page = await googlePlacesProvider.search({ country: 'GH', region: null, city: 'Accra', neighborhood: 'Osu', category: 'Tailor', terms: null, limit: 5, pageToken: null }, AbortSignal.timeout(20_000));
    expect(page.results.length).toBeLessThanOrEqual(20);
    for (const r of page.results) expect(r.externalId).toBeTruthy();
  });
});
