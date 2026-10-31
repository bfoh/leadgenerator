import { describe, expect, it, vi } from 'vitest';
import { businessDefaults } from '@/lib/domain/records';
import {
  IDENTITY_BATCH_CONCURRENCY,
  IDENTITY_BATCH_LIMIT,
  identityBatchEligibility,
  identityBatchEstimate,
  identityBatchProgress,
  identityNameProblem,
  isBlockingIdentityFailure,
  nextIdentityChunk,
  planIdentityJobs,
  resetIdentityJobs,
  retryableIdentityJobs,
  runIdentityChecks,
  settleIdentityJobs,
  startIdentityJobs,
  stopIdentityJobs,
  suggestedIdentityName,
  type IdentityCheckRun,
  type IdentityJob,
} from '@/lib/domain/identity-batch';
import {
  PLACE_IDENTITY_INSPECTION_LIMIT,
  planIdentityQueries,
  readPlaceIdentity,
  type IdentityCandidate,
  type IdentityProfile,
  type PlaceIdentityEvidence,
} from '@/lib/domain/place-identity';
import { extractPageFacts } from '@/lib/domain/page-signals';
import type { Business, TechnicalCheck } from '@/lib/domain/types';
import { HttpError } from '@/lib/server/http';
import { runPlaceIdentityCheck } from '@/lib/server/place-identity';

// Search and page reading are the only paid/networked parts of a check, so both are mocked: nothing
// below reaches a provider, and every reading comes from a fixture.
vi.mock('@/lib/server/research-tools', () => ({
  runWebSearch: vi.fn(),
  runInspection: vi.fn(),
}));
import { runInspection, runWebSearch } from '@/lib/server/research-tools';

const SEARCHED = 'Adwoa’s Boutique';

const placeOnly = (index: number, overrides: Partial<Business> = {}): Business =>
  ({
    id: `business-batch-${index}`,
    ...businessDefaults({
      name: `Unverified place BATCH${index}`,
      city: 'Kumasi',
      region: 'Ashanti',
      category: 'Boutique',
      country: 'GH',
    }),
    placesPlaceId: `ChIJbatchFixture${index}`,
    ...overrides,
  }) as Business;

const job = (businessId: string, name = SEARCHED): IdentityJob => ({
  businessId,
  placeId: `ChIJ${businessId}`,
  recordName: `Unverified place ${businessId}`,
  name,
  profile: { name: 'Unverified place', city: 'Kumasi', region: 'Ashanti', neighborhood: null, category: 'Boutique', country: 'GH', website: '' },
  state: 'pending',
  evidence: null,
  reading: null,
  reason: null,
  checkedAt: null,
});

// A site that names the business, sits in its city and is owned by it: the reading such a page gives is
// `identified`, which is the only fixture the batch needs to reason about a settled row.
const candidate: IdentityCandidate = {
  site: 'adwoaboutique.com',
  url: 'https://adwoaboutique.com/',
  verdict: 'owned',
  ownershipScore: 92,
  publishedName: SEARCHED,
  publishedNameFrom: 'structured_data',
  nameMatch: 1,
  describesCity: true,
  elsewhereInGhana: [],
  foreign: false,
  category: 'Boutique',
  locality: 'Kumasi',
  failure: null,
};

const evidenceFor = (profile: IdentityProfile, name: string): PlaceIdentityEvidence => ({
  schema: 1,
  checkedAt: new Date().toISOString(),
  profile,
  queries: planIdentityQueries(profile, name).map((q) => ({ purpose: q.purpose, resultCount: 3, ok: true })),
  candidates: [candidate],
  corroboration: [],
});

const settledRun = (j: IdentityJob): IdentityCheckRun => {
  const evidence = evidenceFor(j.profile, j.name);
  return { state: 'settled', evidence, reading: readPlaceIdentity(evidence) };
};

describe('Planning a batch', () => {
  it('takes Google references and leaves behind what a batch cannot identify', () => {
    const first = placeOnly(1);
    const second = placeOnly(2);
    const merged = placeOnly(3, { mergedIntoId: '<-merged' });
    const noReference = placeOnly(4, { placesPlaceId: null });
    const plan = planIdentityJobs([first, merged, noReference, second]);

    expect(plan.jobs.map((j) => j.businessId)).toEqual([first.id, second.id]);
    expect(plan.jobs[0]?.placeId).toBe('ChIJbatchFixture1');
    expect(plan.skipped.map((s) => s.businessId)).toEqual([merged.id, noReference.id]);
    expect(plan.skipped[0]?.reason).toMatch(/merged/i);
    expect(plan.skipped[1]?.reason).toMatch(/no google place id/i);
    expect(identityBatchEligibility(merged).eligible).toBe(false);
    expect(identityBatchEligibility(noReference).eligible).toBe(false);
  });

  it('holds a batch to the ceiling and says why the rest wait', () => {
    const businesses = Array.from({ length: IDENTITY_BATCH_LIMIT + 3 }, (_, i) => placeOnly(i + 1));
    const plan = planIdentityJobs(businesses);
    expect(plan.jobs).toHaveLength(IDENTITY_BATCH_LIMIT);
    expect(plan.skipped).toHaveLength(3);
    for (const skip of plan.skipped) expect(skip.reason).toContain(String(IDENTITY_BATCH_LIMIT));
  });

  it('never suggests a reference label as the name to search for', () => {
    expect(suggestedIdentityName(placeOnly(1))).toBe('');
    expect(suggestedIdentityName(placeOnly(1, { name: '  Adwoa’s Boutique  ' }))).toBe('Adwoa’s Boutique');
    const plan = planIdentityJobs([placeOnly(1)]);
    expect(plan.jobs[0]?.name).toBe('');
  });

  it('uses the typed name, keeps it per record and does not plan the same record twice', () => {
    const first = placeOnly(1);
    const second = placeOnly(2);
    const plan = planIdentityJobs([first, second, first], { [second.id]: 'Kente House' });
    expect(plan.jobs.map((j) => j.name)).toEqual(['', 'Kente House']);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toMatch(/already counted/i);
  });

  it('refuses a name that is empty, too short, or the reference label again', () => {
    expect(identityNameProblem('')).toMatch(/enter the business name/i);
    expect(identityNameProblem('Ad')).toMatch(/three characters/i);
    expect(identityNameProblem('Unverified place BATCH1')).toMatch(/reference label/i);
    expect(identityNameProblem(SEARCHED)).toBeNull();
  });
});

describe('What a batch will cost before it runs', () => {
  it('counts only named, waiting checks and prices the searches it may spend', () => {
    const named = job('a');
    const second = job('b');
    const waitingForName = { ...job('c'), name: '' };
    const done = { ...job('d'), state: 'identified' as const };

    const estimate = identityBatchEstimate([named, second, waitingForName, done], 0.005);
    const perCheck = planIdentityQueries(named.profile, named.name).length;

    expect(estimate.checks).toBe(2);
    expect(estimate.unnamed).toBe(1);
    expect(estimate.searches).toBe(perCheck * 2);
    expect(estimate.pages).toBe(2 * PLACE_IDENTITY_INSPECTION_LIMIT);
    expect(estimate.costUsd).toBe(Math.round(estimate.searches * 0.005 * 1000) / 1000);
  });

  it('prices nothing when no name has been typed', () => {
    const estimate = identityBatchEstimate([{ ...job('a'), name: '' }], 0.005);
    expect(estimate.checks).toBe(0);
    expect(estimate.searches).toBe(0);
    expect(estimate.costUsd).toBe(0);
    expect(estimate.unnamed).toBe(1);
  });

  it('only runs named rows, a chunk at a time', () => {
    const jobs = [
      job('a'),
      { ...job('b'), name: '' },
      { ...job('c'), state: 'identified' as const },
      job('d'),
      job('e'),
      job('f'),
      job('g'),
    ];
    expect(nextIdentityChunk(jobs).map((j) => j.businessId)).toEqual(['a', 'd', 'e', 'f']);
    expect(nextIdentityChunk(jobs, 2).map((j) => j.businessId)).toEqual(['a', 'd']);
  });
});

describe('Moving a row through the batch', () => {
  it('shows which row is being read, then applies what the server answered', () => {
    const jobs = [job('a'), job('b')];
    const checking = startIdentityJobs(jobs, ['a']);
    expect(checking[0]?.state).toBe('checking');
    expect(checking[1]?.state).toBe('pending');

    const evidence = evidenceFor(jobs[0]!.profile, jobs[0]!.name);
    const settled = settleIdentityJobs(checking, [
      { businessId: 'a', state: 'identified', evidence, reading: readPlaceIdentity(evidence), reason: null },
      { businessId: 'b', state: 'failed', evidence: null, reading: null, reason: 'Site did not answer.' },
    ], '2026-10-31T09:00:00.000Z');

    expect(settled[0]?.state).toBe('identified');
    expect(settled[0]?.checkedAt).toBe('2026-10-31T09:00:00.000Z');
    expect(settled[0]?.reading?.status).toBe('identified');
    // A failed check keeps whatever time it last succeeded, so the row is not dated as fresh evidence.
    expect(settled[1]?.state).toBe('failed');
    expect(settled[1]?.reason).toBe('Site did not answer.');
    expect(settled[1]?.checkedAt).toBeNull();
  });

  it('never lets a reading land on a row the server did not answer for', () => {
    const jobs = startIdentityJobs([job('a'), job('b')], ['a', 'b']);
    const evidence = evidenceFor(jobs[0]!.profile, jobs[0]!.name);
    const settled = settleIdentityJobs(jobs, [
      { businessId: 'a', state: 'identified', evidence, reading: readPlaceIdentity(evidence), reason: null },
    ]);
    expect(settled[1]?.state).toBe('checking');
    expect(settled[1]?.reading).toBeNull();
  });

  it('ends what never ran with the reason the batch stopped', () => {
    const jobs = startIdentityJobs([job('a'), job('b'), { ...job('c'), state: 'identified' as const }], ['a']);
    const blocked = stopIdentityJobs(jobs, 'blocked', 'The web search quota is spent.');
    expect(blocked.map((j) => j.state)).toEqual(['blocked', 'blocked', 'identified']);
    expect(blocked[0]?.reason).toBe('The web search quota is spent.');

    const cancelled = stopIdentityJobs(jobs, 'cancelled', null);
    expect(cancelled[1]?.reason).toMatch(/stopped before this check ran/i);
  });

  it('keeps what was found when a batch is reset, and counts the rows worth running again', () => {
    const evidence = evidenceFor(job('a').profile, SEARCHED);
    const jobs = [
      { ...job('a'), state: 'identified' as const, evidence, reading: readPlaceIdentity(evidence), checkedAt: '2026-10-30T10:00:00.000Z' },
      { ...job('b'), state: 'failed' as const, reason: 'Timed out.' },
      { ...job('c'), state: 'cancelled' as const },
      job('d'),
    ];
    expect(retryableIdentityJobs(jobs)).toEqual(['b', 'c']);

    const reset = resetIdentityJobs(jobs);
    expect(reset.every((j) => j.state === 'pending')).toBe(true);
    expect(reset[0]?.evidence).toBeNull();
    expect(reset[0]?.checkedAt).toBeNull();

    // A reading can be set aside on its own, without touching a row that is still waiting.
    const one = resetIdentityJobs(jobs, ['b']);
    expect(one.map((j) => j.state)).toEqual(['identified', 'pending', 'cancelled', 'pending']);
  });

  it('counts progress by state, and separately the rows still waiting for a name', () => {
    const progress = identityBatchProgress([
      { ...job('a'), state: 'identified' as const },
      { ...job('b'), state: 'ambiguous' as const },
      { ...job('c'), name: '' },
      { ...job('d'), state: 'checking' as const },
    ]);
    expect(progress.total).toBe(4);
    expect(progress.done).toBe(2);
    expect(progress.identified).toBe(1);
    expect(progress.remainingNames).toBe(1);
    expect(progress.byState.checking).toBe(1);
  });

  it('treats a missing key, a spent quota and a reached budget as the workspace stopping it', () => {
    expect(isBlockingIdentityFailure(403)).toBe(true);
    expect(isBlockingIdentityFailure(429)).toBe(true);
    expect(isBlockingIdentityFailure(503)).toBe(true);
    expect(isBlockingIdentityFailure(500)).toBe(false);
    expect(isBlockingIdentityFailure(404)).toBe(false);
  });
});

describe('Running a chunk', () => {
  const workers = (count: number) => Array.from({ length: count }, (_, i) => job(String.fromCharCode(97 + i)));

  it('keeps at most two checks in flight and answers for every row it started', async () => {
    let active = 0;
    let peak = 0;
    const outcome = await runIdentityChecks(workers(5), async (j) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return settledRun(j);
    });

    expect(peak).toBe(IDENTITY_BATCH_CONCURRENCY);
    expect(outcome.results).toHaveLength(5);
    expect(outcome.results.every((r) => r.state === 'identified')).toBe(true);
    expect(outcome.results.every((r) => r.evidence && r.reading)).toBe(true);
    expect(outcome.stopped).toBeNull();
  });

  it('stops launching checks the moment the workspace is blocked, and ends the rest with its reason', async () => {
    const calls: string[] = [];
    const jobs = workers(4);
    const outcome = await runIdentityChecks(
      jobs,
      async (j) => {
        calls.push(j.businessId);
        return j.businessId === 'a' ? { state: 'blocked', reason: 'The web search quota is spent.' } : settledRun(j);
      },
      { concurrency: 1 },
    );

    expect(calls).toEqual(['a']);
    expect(outcome.stopped).toEqual({ state: 'blocked', reason: 'The web search quota is spent.' });

    const applied = stopIdentityJobs(settleIdentityJobs(jobs, outcome.results), 'blocked', outcome.stopped?.reason ?? null);
    expect(applied.map((j) => j.state)).toEqual(['blocked', 'blocked', 'blocked', 'blocked']);
    expect(applied.every((j) => j.reason === 'The web search quota is spent.')).toBe(true);
  });

  it('carries on past a record that failed on its own, and turns a thrown check into a failed row', async () => {
    const outcome = await runIdentityChecks(
      workers(3),
      async (j) => {
        if (j.businessId === 'b') throw new Error('Site did not answer.');
        return j.businessId === 'c' ? { state: 'failed', reason: 'Timed out.' } : settledRun(j);
      },
      { concurrency: 1 },
    );

    expect(outcome.stopped).toBeNull();
    expect(outcome.results.map((r) => [r.businessId, r.state])).toEqual([
      ['a', 'identified'],
      ['b', 'failed'],
      ['c', 'failed'],
    ]);
    expect(outcome.results[1]?.reason).toBe('Site did not answer.');
  });

  it('stops when the person cancels, keeping the reading that was already paid for', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const outcome = await runIdentityChecks(
      workers(3),
      async (j) => {
        seen.push(j.businessId);
        return settledRun(j);
      },
      { concurrency: 1, signal: controller.signal, onResult: () => controller.abort() },
    );

    expect(seen).toEqual(['a']);
    expect(outcome.stopped).toEqual({ state: 'cancelled', reason: null });
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.reading?.status).toBe('identified');
  });

  it('never starts a check for a batch that was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const check = vi.fn(async () => settledRun(job('a')));
    const outcome = await runIdentityChecks(workers(2), check, { signal: controller.signal });

    expect(check).not.toHaveBeenCalled();
    expect(outcome.results).toEqual([]);
    expect(outcome.stopped).toEqual({ state: 'cancelled', reason: null });
    expect(workers(2).map((j) => stopIdentityJobs([j], 'cancelled', null)[0]?.state)).toEqual(['cancelled', 'cancelled']);
  });
});


describe('Checking records through the real check, with the providers mocked', () => {
  const ctx = {} as Parameters<typeof runPlaceIdentityCheck>[0];

  const check = (overrides: Partial<TechnicalCheck> = {}): TechnicalCheck => ({
    url: 'https://adwoaboutique.com/',
    finalUrl: 'https://adwoaboutique.com/',
    ok: true,
    status: 200,
    redirects: [],
    https: true,
    responseMs: 120,
    title: null,
    hasViewport: true,
    generator: null,
    error: null,
    checkedAt: new Date().toISOString(),
    ...overrides,
  });

  const page = (url: string) => {
    const html = [
      '<html><head><title>Adwoa’s Boutique — Kumasi</title>',
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ClothingStore","name":"Adwoa’s Boutique",',
      '"address":{"@type":"PostalAddress","addressLocality":"Kumasi"},"telephone":"+233 24 555 0100"}</script></head>',
      '<body><h1>Adwoa’s Boutique</h1><p>Kumasi, Ghana</p></body></html>',
    ].join('');
    return { check: check({ url, finalUrl: url }), facts: extractPageFacts(html, url), robots: 'allowed' as const, simulated: false, usage: null };
  };

  const hits = [
    { title: 'Adwoa’s Boutique — Kumasi listing copy that must not be kept', url: 'https://www.google.com/maps/place/Adwoa', description: 'Kumasi listing copy that must not be kept' },
    { title: 'Adwoa’s Boutique (@adwoas.boutique) • Instagram photos', url: 'https://www.instagram.com/adwoas.boutique/', description: 'Kumasi boutique' },
    { title: 'Adwoa’s Boutique — Kumasi', url: 'https://adwoaboutique.com/', description: 'Boutique in Kumasi, Ghana' },
  ];

  const search = async () => ({
    hits,
    provider: 'fixture',
    simulated: false,
    usage: { provider: 'fixture', operation: 'web_search' as const, units: 1, estimatedCostUsd: 0 },
  });

  const identify = async (j: IdentityJob): Promise<IdentityCheckRun> => {
    try {
      const run = await runPlaceIdentityCheck(ctx, { profile: j.profile, name: j.name });
      return { state: 'settled', evidence: run.evidence, reading: run.reading };
    } catch (error) {
      if (error instanceof HttpError) {
        return isBlockingIdentityFailure(error.status)
          ? { state: 'blocked', reason: error.message }
          : { state: 'failed', reason: error.message };
      }
      return { state: 'failed', reason: 'The check could not run.' };
    }
  };

  it('identifies every named reference from its own reading, and keeps nothing from Google', async () => {
    vi.mocked(runWebSearch).mockReset().mockImplementation(search);
    vi.mocked(runInspection).mockReset().mockImplementation(async (_ctx, url) => page(url));

    const businesses = [placeOnly(1), placeOnly(2)];
    const names = Object.fromEntries(businesses.map((b) => [b.id, SEARCHED]));
    const plan = planIdentityJobs(businesses, names);
    expect(plan.jobs).toHaveLength(2);

    const outcome = await runIdentityChecks(plan.jobs, identify);
    const expectedSearches = plan.jobs.reduce((n, j) => n + planIdentityQueries(j.profile, j.name).length, 0);

    expect(outcome.stopped).toBeNull();
    expect(outcome.results.map((r) => r.state)).toEqual(['identified', 'identified']);
    expect(outcome.results.map((r) => r.reading?.proposal.url)).toEqual(['https://adwoaboutique.com/', 'https://adwoaboutique.com/']);
    expect(outcome.results.every((r) => r.businessId === plan.jobs[0]?.businessId || r.businessId === plan.jobs[1]?.businessId)).toBe(true);
    expect(vi.mocked(runWebSearch)).toHaveBeenCalledTimes(expectedSearches);
    expect(JSON.stringify(outcome.results)).not.toMatch(/google/i);
    expect(JSON.stringify(outcome.results)).not.toMatch(/must not be kept/i);
  });

  it('stops the whole batch when the search quota runs out, instead of spending the next record', async () => {
    vi.mocked(runWebSearch).mockReset().mockRejectedValue(new HttpError(429, 'The web search quota is spent.'));
    vi.mocked(runInspection).mockReset();

    const jobs = ['a', 'b', 'c', 'd', 'e'].map((id) => job(id));
    const outcome = await runIdentityChecks(jobs, identify, { concurrency: IDENTITY_BATCH_CONCURRENCY });

    expect(outcome.stopped).toEqual({ state: 'blocked', reason: 'The web search quota is spent.' });
    // Two workers were already in flight; nothing after them was attempted.
    expect(vi.mocked(runWebSearch)).toHaveBeenCalledTimes(IDENTITY_BATCH_CONCURRENCY);
    expect(outcome.results).toHaveLength(IDENTITY_BATCH_CONCURRENCY);
    expect(outcome.results.every((r) => r.state === 'blocked')).toBe(true);

    const applied = stopIdentityJobs(settleIdentityJobs(jobs, outcome.results), 'blocked', outcome.stopped?.reason ?? null);
    expect(applied.filter((j) => j.state === 'blocked')).toHaveLength(5);
    expect(retryableIdentityJobs(applied)).toHaveLength(5);
  });

  it('leaves a record the provider failed on as a failed row, not a blocked batch', async () => {
    vi.mocked(runWebSearch).mockReset().mockRejectedValueOnce(new HttpError(500, 'The search provider failed.'));
    vi.mocked(runWebSearch).mockImplementation(search);
    vi.mocked(runInspection).mockReset().mockImplementation(async (_ctx, url) => page(url));

    const outcome = await runIdentityChecks(['a', 'b'].map((id) => job(id)), identify, { concurrency: 1 });

    expect(outcome.stopped).toBeNull();
    expect(outcome.results.map((r) => r.state)).toEqual(['failed', 'identified']);
    expect(outcome.results[0]?.reason).toBe('The search provider failed.');
  });
});

