import { describe, expect, it, vi } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import { businessDefaults } from '@/lib/domain/records';
import { extractPageFacts } from '@/lib/domain/page-signals';
import {
  PLACE_IDENTITY_INSPECTION_LIMIT,
  PLACE_IDENTITY_QUERY_LIMIT,
  acceptanceFor,
  corroboratingSources,
  identityIsStale,
  identityPatch,
  identityProfileOf,
  looksLikePlaceholderName,
  planIdentityQueries,
  profileChanged,
  readPlaceIdentity,
  type IdentityCandidate,
  type IdentityProfile,
  type PlaceIdentityEvidence,
} from '@/lib/domain/place-identity';
import type { TechnicalCheck } from '@/lib/domain/types';
import type { ServiceContext } from '@/lib/data/services';
import { acceptPlaceIdentity } from '@/lib/data/identity-services';
import { HttpError } from '@/lib/server/http';
import { runPlaceIdentityCheck, searchableName } from '@/lib/server/place-identity';

// The search and page reading are the only paid/networked parts, so they are mocked here: every test
// below uses fixed fixtures and no request leaves the process.
vi.mock('@/lib/server/research-tools', () => ({
  runWebSearch: vi.fn(),
  runInspection: vi.fn(),
}));
import { runInspection, runWebSearch } from '@/lib/server/research-tools';

const PLACE_ID = 'ChIJrTLr-GyuEmsRBfy61i59si0';
const SEARCHED = 'Adwoa’s Boutique';

const profile = (overrides: Partial<IdentityProfile> = {}): IdentityProfile => ({
  name: `Unverified place ${PLACE_ID.slice(-6).toUpperCase()}`,
  city: 'Kumasi',
  region: 'Ashanti',
  neighborhood: null,
  category: 'Boutique',
  country: 'GH',
  website: '',
  ...overrides,
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const candidate = (overrides: Partial<IdentityCandidate> = {}): IdentityCandidate => ({
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
  ...overrides,
});

const evidence = (overrides: Partial<PlaceIdentityEvidence> = {}): PlaceIdentityEvidence => ({
  schema: 1,
  checkedAt: new Date(Date.now() - 3_600_000).toISOString(),
  profile: profile(),
  queries: planIdentityQueries(profile(), SEARCHED).map((q) => ({ purpose: q.purpose, resultCount: 4, ok: true })),
  candidates: [candidate()],
  corroboration: [],
  ...overrides,
});

describe('Searching for a name instead of a reference label', () => {
  it('plans the bounded queries the website rules use, with the typed name in place of the placeholder', () => {
    const planned = planIdentityQueries(profile(), SEARCHED);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.length).toBeLessThanOrEqual(PLACE_IDENTITY_QUERY_LIMIT);
    for (const q of planned) {
      expect(q.query.toLowerCase()).toContain('adwoa');
      expect(q.query).not.toMatch(/unverified place/i);
    }
  });

  it('refuses a reference label as the thing to search for', () => {
    expect(searchableName('  Adwoa’s   Boutique ')).toBe('Adwoa’s Boutique');
    expect(() => searchableName('ab')).toThrow(HttpError);
    expect(() => searchableName(`Unverified place ${PLACE_ID}`)).toThrow(/reference label/i);
    expect(looksLikePlaceholderName(profile().name)).toBe(true);
    expect(looksLikePlaceholderName(SEARCHED)).toBe(false);
  });
});

describe('Reading an identification', () => {
  it('proposes the name and site one independent page publishes', () => {
    const reading = readPlaceIdentity(evidence());
    expect(reading.status).toBe('identified');
    expect(reading.proposal.name).toBe(SEARCHED);
    expect(reading.proposal.url).toBe('https://adwoaboutique.com/');
    expect(reading.checks[0]?.site).toBe('adwoaboutique.com');
    expect(reading.queryCount).toBeGreaterThan(0);
    expect(reading.queryCount).toBeLessThanOrEqual(PLACE_IDENTITY_QUERY_LIMIT);
  });

  it('never accepts a page that publishes the reference label itself', () => {
    const stamped = evidence({ candidates: [candidate({ publishedName: profile().name })] });
    expect(readPlaceIdentity(stamped).status).not.toBe('identified');
    expect(acceptanceFor(stamped, profile()).ok).toBe(false);
  });

  it('asks for a person when two independent sites could both be this business', () => {
    const two = evidence({
      candidates: [candidate(), candidate({ site: 'adwoaboutique.shop', url: 'https://adwoaboutique.shop/', publishedName: 'Adwoa Boutique' })],
    });
    const reading = readPlaceIdentity(two);
    expect(reading.status).toBe('ambiguous');
    expect(reading.concerns.join(' ')).toMatch(/could be this business/i);
    expect(acceptanceFor(two, profile()).ok).toBe(false);
  });

  it('does not identify a business from a site that names another town', () => {
    const elsewhere = evidence({ candidates: [candidate({ describesCity: false, locality: 'Sunyani', elsewhereInGhana: ['Sunyani'] })] });
    const reading = readPlaceIdentity(elsewhere);
    expect(reading.status).not.toBe('identified');
    expect(acceptanceFor(elsewhere, profile()).ok).toBe(false);
  });

  it('names no business when nothing usable came back', () => {
    const empty = evidence({ candidates: [], queries: [] });
    const reading = readPlaceIdentity(empty);
    expect(reading.status).toBe('not_found');
    expect(reading.concerns.join(' ')).toMatch(/no search returned usable results/i);
    expect(acceptanceFor(empty, profile()).ok).toBe(false);
  });
});


describe('Accepting changes only what the site supports', () => {
  it('fills an empty website and town but never overwrites details already on the record', () => {
    const empty = identityPatch(profile(), readPlaceIdentity(evidence()).proposal);
    expect(empty.renames).toBe(true);
    expect(empty.name).toBe(SEARCHED);
    expect(empty.officialWebsite).toBe('https://adwoaboutique.com/');
    expect(empty.city).toBeNull(); // the record already names Kumasi

    const filled = identityPatch(profile({ website: 'https://adwoaboutique.example/', city: '' }), readPlaceIdentity(evidence()).proposal);
    expect(filled.officialWebsite).toBeNull();
    expect(filled.city).toBe('Kumasi');
    expect(filled.renames).toBe(true);
  });

  it('refuses a check the record has outgrown, and refuses to re-accept the same check twice', () => {
    const moved = acceptanceFor(evidence(), profile({ city: 'Accra' }));
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.reason).toMatch(/changed after the check ran/i);

    // The record already says everything the site says, so there is nothing left to write.
    const settled = profile({ name: SEARCHED, website: 'https://adwoaboutique.com/' });
    const reread = acceptanceFor(evidence({ profile: settled }), settled);
    expect(reread.ok).toBe(false);
    if (!reread.ok) expect(reread.reason).toMatch(/already has these details/i);
  });

  it('refuses evidence that is too old to trust', () => {
    const old = evidence({ checkedAt: daysAgo(30) });
    expect(identityIsStale(old)).toBe(true);
    expect(identityIsStale(evidence())).toBe(false);
    const decision = acceptanceFor(old, profile());
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toMatch(/more than a week old.*run it again/i);
  });

  it('notices when the stored record no longer matches the check that was reviewed', () => {
    expect(profileChanged(profile(), profile({ city: 'Accra' }))).toBe(true);
    expect(profileChanged(profile(), profile())).toBe(false);
  });
});

describe('What may be carried out of a search', () => {
  const hit = (title: string, url: string) => ({ title, url, description: `${SEARCHED} — best in Kumasi` });

  it('keeps other sites that use the name, by host, and never Google or a reference page', () => {
    const hosts = corroboratingSources(
      [
        hit(`${SEARCHED} (@adwoas.boutique) • Instagram`, 'https://www.instagram.com/adwoas.boutique/'),
        hit(`${SEARCHED} — Kumasi listing`, 'https://www.google.com/maps/place/Adwoa'),
        hit(`${SEARCHED} - Wikipedia`, 'https://en.wikipedia.org/wiki/Adwoa'),
        hit(`${SEARCHED} opens in Kumasi`, 'https://www.ghana-business-news.com/adwoa-boutique'),
        hit('Unrelated bakery', 'https://www.other-bakery.com/'),
      ],
      SEARCHED,
    );
    const listed = hosts.map((h) => h.host);
    expect(listed).toContain('instagram.com');
    expect(listed.some((h) => /google/.test(h))).toBe(false);
    expect(listed.some((h) => /wikipedia/.test(h))).toBe(false);
    expect(listed).not.toContain('other-bakery.com');
  });

  it('holds no result text in the evidence at all', () => {
    const serialized = JSON.stringify(evidence());
    expect(serialized).not.toMatch(/best in kumasi/i);
    expect(serialized).not.toMatch(/google/i);
  });
});


describe('Accepting an identification into the workspace', () => {
  const context = () => {
    const store = new LocalStore(new MemoryStorage());
    const ctx: ServiceContext = { store, userId: 'demo-user', userLabel: 'Demo researcher', settings: DEFAULT_SETTINGS };
    return { store, ctx };
  };

  const seed = async (store: LocalStore) => {
    const created = await store.createBusiness(
      businessDefaults({
        name: `Unverified place ${PLACE_ID.slice(-6).toUpperCase()}`,
        category: 'Boutique',
        country: 'GH',
        region: 'Ashanti',
        city: 'Kumasi',
      }),
    );
    return store.updateBusiness(created.id, { placesPlaceId: PLACE_ID });
  };

  it('renames the reference, records the site and keeps the Place ID', async () => {
    const { store, ctx } = context();
    const business = await seed(store);
    // The check was run against exactly this record, which is what acceptance requires.
    expect(identityProfileOf(business)).toEqual(evidence().profile);

    const result = await acceptPlaceIdentity(ctx, business, evidence());

    expect(result.business.name).toBe(SEARCHED);
    expect(result.business.officialWebsite).toBe('https://adwoaboutique.com/');
    expect(result.business.placesPlaceId).toBe(PLACE_ID);

    const activities = await store.listActivities(business.id);
    expect(activities.some((a) => /Identified from an independent source: Adwoa/.test(a.summary))).toBe(true);

    const observations = await store.listResearchObservations(business.id);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.category).toBe('identity');
    expect(observations[0]?.status).toBe('independently_verified');
    expect(observations[0]?.sourceUrl).toBe('https://adwoaboutique.com/');
    expect(JSON.stringify(observations[0])).not.toMatch(/google/i);
    expect(result.observationId).toBe(observations[0]?.id);
  });

  it('applies the same check twice as one change, and refuses evidence it cannot read', async () => {
    const { store, ctx } = context();
    const business = await seed(store);
    await acceptPlaceIdentity(ctx, business, evidence());
    // A retry of the same reading changes nothing: no second write, no second audit entry, no error.
    const again = await acceptPlaceIdentity(ctx, business, evidence());
    expect(again.state).toBe('unchanged');
    expect(again.business.name).toBe(SEARCHED);
    expect(again.observationId).toBeNull();
    const identified = (await store.listActivities(business.id)).filter((activity) => /Identified from an independent source/.test(activity.summary));
    expect(identified).toHaveLength(1);
    await expect(acceptPlaceIdentity(ctx, business, { ...evidence(), schema: 2 } as never)).rejects.toThrow(/run it again/i);
  });

  it('leaves other records alone', async () => {
    const { store, ctx } = context();
    const business = await seed(store);
    const other = await store.createBusiness(businessDefaults({ name: 'Unverified place OTHER1', city: 'Kumasi', region: 'Ashanti' }));
    await acceptPlaceIdentity(ctx, business, evidence());
    const untouched = await store.getBusiness(other.id);
    expect(untouched?.name).toBe(other.name);
    expect(untouched?.officialWebsite).toBeNull();
  });
});


describe('One identification run', () => {
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
      '<body><h1>Adwoa’s Boutique</h1><p>Kumasi, Ghana</p><a href="tel:+233245550100">Call</a></body></html>',
    ].join('');
    return { check: check({ url, finalUrl: url }), facts: extractPageFacts(html, url), robots: 'allowed' as const, simulated: false, usage: null };
  };

  const hits = [
    {
      title: 'Adwoa’s Boutique — Kumasi listing copy that must not be kept',
      url: 'https://www.google.com/maps/place/Adwoa',
      description: 'Kumasi listing copy that must not be kept',
    },
    { title: 'Adwoa’s Boutique (@adwoas.boutique) • Instagram photos', url: 'https://www.instagram.com/adwoas.boutique/', description: 'Kumasi boutique' },
    { title: 'Adwoa’s Boutique — Kumasi', url: 'https://adwoaboutique.com/', description: 'Boutique in Kumasi, Ghana' },
  ];

  const search = async () => ({
    hits,
    provider: 'fixture',
    simulated: false,
    usage: { provider: 'fixture', operation: 'web_search' as const, units: 1, estimatedCostUsd: 0 },
  });

  it('searches, reads the shortlisted site and returns a proposal with nothing from Google', async () => {
    vi.mocked(runWebSearch).mockImplementation(search);
    vi.mocked(runInspection).mockImplementation(async (_ctx, url) => page(url));

    const run = await runPlaceIdentityCheck(ctx, { profile: profile(), name: SEARCHED });

    expect(run.evidence.queries.length).toBeGreaterThan(0);
    expect(run.evidence.queries.every((q) => q.ok)).toBe(true);
    expect(run.evidence.candidates.length).toBeGreaterThan(0);
    expect(run.evidence.candidates.length).toBeLessThanOrEqual(PLACE_IDENTITY_INSPECTION_LIMIT);
    expect(run.evidence.candidates[0]?.publishedName).toBe(SEARCHED);
    expect(run.evidence.corroboration.map((c) => c.host)).toEqual(['instagram.com']);
    expect(run.reading.status).toBe('identified');
    expect(run.reading.proposal.url).toBe('https://adwoaboutique.com/');

    const serialized = JSON.stringify(run.evidence);
    expect(serialized).not.toMatch(/google/i);
    expect(serialized).not.toMatch(/must not be kept/i);
    expect(serialized).not.toMatch(/instagram photos/i);

    // Every search is labelled by purpose, so a usage record says why it was spent.
    expect(vi.mocked(runWebSearch).mock.calls.map((c) => c[2]?.purpose)).toEqual(expect.arrayContaining([expect.stringMatching(/^identity_/)]));
  });

  it('stops when the search key or quota is the problem', async () => {
    vi.mocked(runWebSearch).mockRejectedValueOnce(new HttpError(503, 'Web search is not configured (BRAVE_SEARCH_API_KEY).'));
    await expect(runPlaceIdentityCheck(ctx, { profile: profile(), name: SEARCHED })).rejects.toThrow(/not configured/i);
  });

  it('records a site it cannot read instead of treating it as a match', async () => {
    vi.mocked(runWebSearch).mockImplementation(search);
    vi.mocked(runInspection).mockImplementation(async (_ctx, url) => ({
      check: check({ url, ok: false, status: 0, error: 'Site does not resolve' }),
      facts: null,
      robots: 'unavailable' as const,
      simulated: false,
      usage: null,
    }));

    const run = await runPlaceIdentityCheck(ctx, { profile: profile(), name: SEARCHED });
    expect(run.evidence.candidates.length).toBeGreaterThan(0);
    expect(run.evidence.candidates.every((c) => c.failure)).toBe(true);
    expect(run.reading.status).not.toBe('identified');
  });
});
