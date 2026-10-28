import { describe, expect, it } from 'vitest';
import { DEMO_KEY, LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { businessDefaults } from '@/lib/domain/records';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import { assessSocialIntake, intakeBusinessName, nameFromHandle, summarizeIntake } from '@/lib/domain/social-intake';
import type { SocialCandidate } from '@/lib/domain/social-discovery';
import type { Business } from '@/lib/domain/types';
import { addSocialSourceToBusiness, bulkAddSocialCandidates, confirmSocialSource } from '@/lib/data/social-intake-services';
import type { SocialSourceInsert } from '@/lib/domain/social-research';
import type { ServiceContext } from '@/lib/data/services';

const candidate = (overrides: Partial<SocialCandidate> = {}): SocialCandidate => ({
  platform: 'instagram',
  handle: 'adwoas.boutique',
  profileUrl: 'https://www.instagram.com/adwoas.boutique/',
  displayName: 'Adwoa’s Boutique (@adwoas.boutique) • Instagram photos and videos',
  snippet: 'Best pastries in Kumasi. Search-result copy that must never be stored.',
  sourceQuery: 'site:instagram.com "bakery" Kumasi Ashanti Ghana',
  location: { region: 'Ashanti', city: 'Kumasi', country: 'GH' },
  confidence: 0.8,
  verification: 'likely_official',
  evidence: ['Result text mentions “bakery”.', 'Location evidence matches Kumasi.'],
  duplicateOf: null,
  simulated: false,
  ...overrides,
});

const context = (storage = new MemoryStorage()) => {
  const store = new LocalStore(storage);
  const ctx: ServiceContext = { store, userId: 'demo-user', userLabel: 'Demo researcher', settings: DEFAULT_SETTINGS };
  return { store, ctx, storage };
};

const existingBusiness = (values: Partial<Business> = {}): Business =>
  ({
    ...businessDefaults({ name: 'Adwoas Boutique', city: 'Kumasi', region: 'Ashanti', socialProfiles: [] }),
    id: '00000000-0000-4000-8000-000000000101',
    organizationId: '00000000-0000-4000-8000-000000000001',
    createdBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...values,
  }) as Business;

const input = (candidates: SocialCandidate[], basis: 'first_party_observation' | 'owner_supplied' | 'licensed_directory' | null = 'first_party_observation') => ({
  candidates,
  basis,
  category: 'Bakery',
  country: 'GH',
  region: 'Ashanti',
  city: 'Kumasi',
  neighborhood: null,
});

describe('social intake eligibility', () => {
  it('derives a trading name from the canonical handle, never from the search title', () => {
    expect(nameFromHandle('@adwoas.boutique')).toBe('Adwoas Boutique');
    expect(nameFromHandle('adwoas_bakery_gh')).toBe('Adwoas Bakery Gh');
    const live = candidate();
    expect(intakeBusinessName(live)).toBe('Adwoas Boutique');
    expect(intakeBusinessName(live)).not.toContain('Instagram');
  });

  it('keeps the labelled fictional name for simulated practice profiles', () => {
    expect(intakeBusinessName(candidate({ simulated: true, displayName: 'Adwoa Demo Bakery (fictional demo)' }))).toBe('Adwoa Demo Bakery (fictional demo)');
  });

  it('refuses a live candidate until a lawful retention basis is chosen', () => {
    const refused = assessSocialIntake(candidate(), { basis: null, existingBusinesses: [], existingSources: [] });
    expect(refused.outcome).toBe('needs_permitted_source');
    expect(refused.basis).toBeNull();
    expect(refused.reason).toMatch(/search result/i);
    const accepted = assessSocialIntake(candidate(), { basis: 'owner_supplied', existingBusinesses: [], existingSources: [] });
    expect(accepted.outcome).toBe('added');
    expect(accepted.basis).toBe('owner_supplied');
  });

  it('lets a fictional profile through because it is labelled practice data', () => {
    const result = assessSocialIntake(candidate({ simulated: true }), { basis: null, existingBusinesses: [], existingSources: [] });
    expect(result.outcome).toBe('added');
    expect(result.basis).toBe('first_party_observation');
  });

  it('reports existing profiles before a missing basis, so a retry is never a new lead', () => {
    const existing = existingBusiness();
    const recorded = assessSocialIntake(candidate(), {
      basis: null,
      existingBusinesses: [existingBusiness({ socialProfiles: [{ platform: 'instagram', url: 'https://instagram.com/adwoas.boutique' }] })],
      existingSources: [],
    });
    expect(recorded.outcome).toBe('already_exists');
    expect(recorded.businessId).toBe(existing.id);
    expect(recorded.reason).toMatch(/never merged/i);
  });

  it('treats a same-name business in the same region as needing review, never an automatic merge', () => {
    const result = assessSocialIntake(candidate(), {
      basis: 'first_party_observation',
      existingBusinesses: [existingBusiness({ city: 'Accra' })],
      existingSources: [],
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reason).toMatch(/Possible existing prospect/);
  });

  it('keeps a disputed or duplicate-looking account out of the batch', () => {
    expect(assessSocialIntake(candidate({ verification: 'wrong_business' }), { basis: 'first_party_observation', existingBusinesses: [], existingSources: [] }).outcome).toBe('not_eligible');
    expect(assessSocialIntake(candidate({ duplicateOf: 'https://www.instagram.com/other/' }), { basis: 'first_party_observation', existingBusinesses: [], existingSources: [] }).outcome).toBe('needs_review');
    expect(assessSocialIntake(candidate({ profileUrl: 'https://www.instagram.com/p/Cabc123/', handle: 'Cabc123' }), { basis: 'first_party_observation', existingBusinesses: [], existingSources: [] }).outcome).toBe('not_eligible');
  });

  it('summarises every outcome the batch UI reports', () => {
    const summary = summarizeIntake([
      { outcome: 'added' },
      { outcome: 'added' },
      { outcome: 'already_exists' },
      { outcome: 'needs_permitted_source' },
      { outcome: 'needs_review' },
      { outcome: 'not_eligible' },
    ]);
    expect(summary).toEqual({ added: 2, already_exists: 1, needs_permitted_source: 1, needs_review: 1, not_eligible: 1, total: 6 });
  });
});

describe('bulk intake service', () => {
  it('creates unverified research candidates with linked sources and no provider copy', async () => {
    const { store, ctx, storage } = context();
    const before = (await store.listBusinesses()).length;
    const selected = [
      candidate(),
      candidate({ platform: 'facebook', handle: 'adwoa.bakery', profileUrl: 'https://www.facebook.com/adwoa.bakery' }),
    ];
    const result = await bulkAddSocialCandidates(ctx, input(selected));
    expect(result.summary.added).toBe(2);
    const created = (await store.listBusinesses()).slice(before);
    expect(created.map((business) => business.name).sort()).toEqual(['Adwoa Bakery', 'Adwoas Boutique']);
    for (const business of created) {
      expect(business.stage).toBe('research_candidate');
      expect(business.sourceKind).toBe('social_profile');
      expect(business.socialProfiles).toHaveLength(1);
      expect(business.contactPermission).toBe('unknown');
      expect(business.placesPlaceId).toBeNull();
      expect(business.confidenceScore).not.toBeNull();
    }
    const sources = await store.listSocialSources();
    expect(sources).toHaveLength(2);
    expect(sources.every((source) => source.verificationStatus === 'observed')).toBe(true);
    expect(sources.every((source) => source.provenance === 'independent_observation')).toBe(true);
    // The transient search copy is nowhere in browser storage: no title, snippet or query.
    const persisted = storage.getItem(DEMO_KEY) ?? '';
    expect(persisted).not.toContain('Best pastries in Kumasi');
    expect(persisted).not.toContain('Instagram photos and videos');
    expect(persisted).not.toContain('site:instagram.com');
  });

  it('retries without creating a second prospect or a second link', async () => {
    const { store, ctx } = context();
    const selected = [candidate()];
    await bulkAddSocialCandidates(ctx, input(selected));
    const count = (await store.listBusinesses()).length;
    const retry = await bulkAddSocialCandidates(ctx, input(selected));
    expect(retry.summary.already_exists).toBe(1);
    expect((await store.listBusinesses()).length).toBe(count);
    expect((await store.listSocialSources()).length).toBe(1);
  });

  it('saves nothing when no lawful basis is stated', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddSocialCandidates(ctx, input([candidate()], null));
    expect(result.summary.needs_permitted_source).toBe(1);
    expect((await store.listBusinesses()).length).toBe(before);
    expect(await store.listSocialSources()).toEqual([]);
  });

  it('captures a labelled fictional profile for practice without a basis', async () => {
    const { store, ctx } = context();
    const fictional = candidate({ simulated: true, handle: 'fictional.bakery', profileUrl: 'https://www.instagram.com/fictional.bakery/', displayName: 'Fictional Bakery (fictional demo)' });
    const result = await bulkAddSocialCandidates(ctx, input([fictional], null));
    expect(result.summary.added).toBe(1);
    const created = (await store.listBusinesses()).find((business) => business.sourceKind === 'social_profile');
    expect(created?.name).toBe('Fictional Bakery (fictional demo)');
    expect(created?.notes).toMatch(/does not exist/i);
  });

  it('refuses a second active link to the same profile', async () => {
    const { store, ctx } = context();
    await bulkAddSocialCandidates(ctx, input([candidate()]));
    const created = (await store.listBusinesses()).find((business) => business.sourceKind === 'social_profile')!;
    await expect(
      addSocialSourceToBusiness(ctx, {
        businessId: created.id,
        platform: 'instagram',
        handle: 'adwoas.boutique',
        profileUrl: 'https://www.instagram.com/adwoas.boutique/',
        provenance: 'independent_observation',
        retentionBasis: 'first_party_observation',
        verificationStatus: 'observed',
        verificationEvidence: null,
      }),
    ).rejects.toThrow(/already linked/i);
    expect((await store.listSocialSources()).length).toBe(1);
  });

  it('refuses a duplicate profile at the store boundary even across prospects', async () => {
    const { store } = context();
    const [first, second] = await store.listBusinesses();
    const input: SocialSourceInsert = {
      businessId: first.id,
      platform: 'instagram',
      handle: 'storedup',
      profileUrl: 'https://www.instagram.com/storedup/',
      provenance: 'owner_supplied',
      retentionBasis: 'owner_supplied',
      verificationStatus: 'owner_confirmed',
      verificationEvidence: 'The owner supplied this profile on 26 October.',
    };
    await store.createSocialSource(input);
    await expect(store.createSocialSource({ ...input, businessId: second.id, handle: '@StoreDup' })).rejects.toThrow(/already linked/i);
    expect(await store.listSocialSources()).toHaveLength(1);
  });

  it('names the other prospect when the service finds an existing workspace link', async () => {
    const { store, ctx } = context();
    const [first, second] = await store.listBusinesses();
    await store.createSocialSource({
      businessId: first.id,
      platform: 'instagram',
      handle: 'workspacedup',
      profileUrl: 'https://www.instagram.com/workspacedup/',
      provenance: 'owner_supplied',
      retentionBasis: 'owner_supplied',
      verificationStatus: 'owner_confirmed',
      verificationEvidence: 'The owner supplied this profile on 26 October.',
    });
    await expect(
      addSocialSourceToBusiness(ctx, {
        businessId: second.id,
        platform: 'instagram',
        handle: '@WorkspaceDup',
        profileUrl: 'https://www.instagram.com/workspacedup/',
        provenance: 'owner_supplied',
        retentionBasis: 'owner_supplied',
        verificationStatus: 'owner_confirmed',
        verificationEvidence: 'The owner supplied this profile on 26 October.',
      }),
    ).rejects.toThrow(/another prospect/i);
    expect(await store.listSocialSources()).toHaveLength(1);
  });

  it('refuses an invented retention basis before writing anything', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    await expect(
      bulkAddSocialCandidates(ctx, { ...input([candidate()]), basis: 'search_result' as never }),
    ).rejects.toThrow(/lawful retention basis/i);
    expect((await store.listBusinesses()).length).toBe(before);
    expect(await store.listSocialSources()).toEqual([]);
  });

  it('moves verification forward only and records the evidence', async () => {
    const { store, ctx } = context();
    await bulkAddSocialCandidates(ctx, input([candidate()]));
    const [source] = await store.listSocialSources();
    await expect(confirmSocialSource(ctx, source, 'observed', 'This would be a downgrade.')).rejects.toThrow(/only moves forward/i);
    const verified = await confirmSocialSource(ctx, source, 'independently_verified', 'Checked against the official website on 26 October.');
    expect(verified.verificationStatus).toBe('independently_verified');
    expect(verified.verifiedAt).not.toBeNull();
  });

  it('links an owner-supplied profile and mirrors it on the prospect', async () => {
    const { store, ctx } = context();
    const seeded = (await store.listBusinesses())[0];
    const saved = await addSocialSourceToBusiness(ctx, {
      businessId: seeded.id,
      platform: 'facebook',
      handle: 'seededpage',
      profileUrl: 'https://www.facebook.com/seededpage',
      provenance: 'owner_supplied',
      retentionBasis: 'owner_supplied',
      verificationStatus: 'owner_confirmed',
      verificationEvidence: 'The owner supplied this page on 26 October.',
    });
    expect(saved.verificationStatus).toBe('owner_confirmed');
    const refreshed = await store.getBusiness(seeded.id);
    expect(refreshed?.socialProfiles.some((profile) => profile.url === 'https://www.facebook.com/seededpage')).toBe(true);
  });

  it('caps one batch at twenty selected results', async () => {
    const { ctx } = context();
    const tooMany = Array.from({ length: 21 }, (_, index) =>
      candidate({ handle: `shop.${index}`, profileUrl: `https://www.instagram.com/shop.${index}/` }),
    );
    await expect(bulkAddSocialCandidates(ctx, input(tooMany))).rejects.toThrow(/at most 20/i);
  });
});
