import { describe, expect, it, vi } from 'vitest';
import { DEMO_KEY, LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { businessDefaults } from '@/lib/domain/records';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import {
  assessPlacesIntake,
  isValidPlaceId,
  normalizePlaceId,
  placeReferenceName,
  summarizePlacesIntake,
  type PlacesCandidate,
} from '@/lib/domain/places-intake';
import { sourceEvidenceIssues } from '@/lib/domain/research-source';
import type { SocialCandidate } from '@/lib/domain/social-discovery';
import type { Business } from '@/lib/domain/types';
import type { ServiceContext } from '@/lib/data/services';
import { bulkAddMixedCandidates, bulkAddPlacesCandidates } from '@/lib/data/places-intake-services';
import { bulkAddSocialCandidates } from '@/lib/data/social-intake-services';

const PLACE_ID = 'ChIJrTLr-GyuEmsRBfy61i59si0';
const OTHER_PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

const place = (overrides: Partial<PlacesCandidate> = {}): PlacesCandidate => ({
  externalId: PLACE_ID,
  name: 'Adwoa’s Boutique — Kumasi listing copy that must never be stored',
  websiteUri: null,
  isDemo: false,
  ...overrides,
});

const social = (overrides: Partial<SocialCandidate> = {}): SocialCandidate => ({
  platform: 'instagram',
  handle: 'adwoas.boutique',
  profileUrl: 'https://www.instagram.com/adwoas.boutique/',
  displayName: 'Adwoa’s Boutique (@adwoas.boutique) • Instagram photos and videos',
  snippet: 'Best pastries in Kumasi.',
  sourceQuery: 'site:instagram.com "bakery" Kumasi',
  location: { region: 'Ashanti', city: 'Kumasi', country: 'GH' },
  confidence: 0.8,
  verification: 'likely_official',
  evidence: ['Result text mentions “bakery”.'],
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
    ...businessDefaults({ name: 'Adwoa Boutique', city: 'Kumasi', region: 'Ashanti', socialProfiles: [] }),
    id: '00000000-0000-4000-8000-000000000201',
    organizationId: '00000000-0000-4000-8000-000000000001',
    createdBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...values,
  }) as Business;

const placesInput = (candidates: PlacesCandidate[]) => ({
  candidates,
  category: 'Boutique',
  country: 'GH',
  region: 'Ashanti',
  city: 'Kumasi',
  neighborhood: null,
});
describe('Place ID handling', () => {
  it('accepts the legacy and places/-prefixed forms, and refuses anything else', () => {
    expect(normalizePlaceId(PLACE_ID)).toBe(PLACE_ID);
    expect(normalizePlaceId(`places/${PLACE_ID}`)).toBe(PLACE_ID);
    expect(isValidPlaceId('  ChIJrTLr-GyuEmsRBfy61i59si0  ')).toBe(true);
    expect(isValidPlaceId('Adwoa’s Boutique, Kumasi')).toBe(false);
    expect(isValidPlaceId('')).toBe(false);
    expect(isValidPlaceId('https://maps.google.com/?cid=1234')).toBe(false);
  });

  it('generates a placeholder name from the ID, never from the listing name', () => {
    const name = placeReferenceName(PLACE_ID);
    expect(name).toBe(`Unverified place ${PLACE_ID.slice(-6).toUpperCase()}`);
    expect(name).not.toContain('Adwoa');
  });
});

describe('Places intake eligibility', () => {
  it('adds a live result as a Place ID reference and says what is kept', () => {
    const result = assessPlacesIntake(place(), { existingBusinesses: [], search: { region: 'Ashanti', city: 'Kumasi' } });
    expect(result.outcome).toBe('added');
    expect(result.placeId).toBe(PLACE_ID);
    expect(result.reason).toMatch(/Place ID reference/i);
    expect(result.listingName).toContain('Adwoa'); // transient, for the reviewer only
  });

  it('reports a recorded Place ID before anything else, so a retry is never a new lead', () => {
    const existing = existingBusiness({ placesPlaceId: PLACE_ID, name: 'Adwoa Boutique' });
    const result = assessPlacesIntake(place(), { existingBusinesses: [existing], search: { region: 'Ashanti', city: 'Kumasi' } });
    expect(result.outcome).toBe('already_exists');
    expect(result.businessId).toBe(existing.id);
    expect(result.reason).toMatch(/never creates a second record/i);
  });

  it('holds a same-name candidate for review instead of merging', () => {
    const result = assessPlacesIntake(place(), {
      existingBusinesses: [existingBusiness({ name: placeReferenceName(PLACE_ID) })],
      search: { region: 'Ashanti', city: 'Kumasi' },
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reason).toMatch(/Possible existing prospect/);
  });

  it('finds a prospect already in the CRM under its real name, without keeping the listing name', () => {
    const existing = existingBusiness({ name: 'Adwoa’s Boutique' });
    const result = assessPlacesIntake(place({ name: 'Adwoa’s Boutique' }), {
      existingBusinesses: [existing],
      search: { region: 'Ashanti', city: 'Kumasi' },
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.businessId).toBe(existing.id);
    expect(result.reason).toContain(existing.name);
    // The comparison is transient: nothing from the listing is reported back for storage.
    expect(result.reason).not.toMatch(/listing copy/i);
    expect(result.listingName).toContain('Adwoa');
  });

  it('finds a prospect on the listed website or phone, so one business never gets two references', () => {
    const onWebsite = existingBusiness({ id: '00000000-0000-4000-8000-000000000202', name: 'Adwoa Boutique and Gifts', officialWebsite: 'https://adwoasboutique.example.org/about' });
    const byWebsite = assessPlacesIntake(place({ name: 'Another trading name entirely', websiteUri: 'https://www.adwoasboutique.example.org/' }), {
      existingBusinesses: [onWebsite],
      search: { region: 'Ashanti', city: 'Kumasi' },
    });
    expect(byWebsite.outcome).toBe('needs_review');
    expect(byWebsite.businessId).toBe(onWebsite.id);

    const onPhone = existingBusiness({ id: '00000000-0000-4000-8000-000000000203', name: 'Adwoa Boutique and Gifts', phone: '+233 24 123 4567' });
    const byPhone = assessPlacesIntake(place({ name: 'Another trading name entirely', phone: '024 123 4567' }), {
      existingBusinesses: [onPhone],
      search: { region: 'Ashanti', city: 'Kumasi' },
    });
    expect(byPhone.outcome).toBe('needs_review');
    expect(byPhone.businessId).toBe(onPhone.id);
  });

  it('refuses a result with no usable Place ID', () => {
    const result = assessPlacesIntake(place({ externalId: 'Adwoa Boutique' }), { existingBusinesses: [], search: { region: 'Ashanti', city: 'Kumasi' } });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toMatch(/no usable Place ID/i);
  });

  it('returns "needs permitted source" when the only location is Google’s', () => {
    const result = assessPlacesIntake(place(), { existingBusinesses: [], search: { region: null, city: null } });
    expect(result.outcome).toBe('needs_permitted_source');
    expect(result.reason).toMatch(/cannot be stored/i);
  });

  it('summarises every Google outcome the UI reports', () => {
    const summary = summarizePlacesIntake([
      { outcome: 'added' },
      { outcome: 'added' },
      { outcome: 'already_exists' },
      { outcome: 'needs_review' },
      { outcome: 'needs_permitted_source' },
      { outcome: 'failed' },
    ]);
    expect(summary).toEqual({ added: 2, already_exists: 1, needs_review: 1, needs_permitted_source: 1, failed: 1, total: 6 });
  });
});


describe('bulk Places intake', () => {
  it('creates a Place ID reference without storing any listing content and without a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { store, ctx, storage } = context();
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddPlacesCandidates(ctx, placesInput([place()]));

    expect(result.summary.added).toBe(1);
    const created = (await store.listBusinesses()).slice(before);
    expect(created).toHaveLength(1);
    const business = created[0];
    expect(business.placesPlaceId).toBe(PLACE_ID);
    expect(business.sourceKind).toBe('places_reference');
    expect(business.sourceUrl).toBeNull();
    expect(business.name).toBe(placeReferenceName(PLACE_ID));
    expect(business.stage).toBe('research_candidate');
    expect(business.contactPermission).toBe('unknown');
    expect(business.nextAction).toMatch(/independent source/);
    expect(business.notes).toContain(PLACE_ID);
    expect(business.notes).toMatch(/never saved/);

    const persisted = storage.getItem(DEMO_KEY) ?? '';
    expect(persisted).toContain(PLACE_ID);
    expect(persisted).not.toContain('listing copy that must never be stored');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('never stores a Google listing name, address or phone — a live reference keeps only the ID', async () => {
    const { store, ctx, storage } = context();
    await bulkAddPlacesCandidates(ctx, placesInput([place({ websiteUri: 'https://adwoasboutique.example.org/' })]));
    const business = (await store.listBusinesses()).find((b) => b.placesPlaceId === PLACE_ID)!;
    expect(business.officialWebsite).toBeNull();
    expect(business.address).toBeNull();
    expect(business.phone).toBeNull();
    expect(business.socialProfiles).toEqual([]);
    expect(storage.getItem(DEMO_KEY) ?? '').not.toContain('adwoasboutique.example.org');
  });

  it('holds a result the CRM already has under its real name: no record, no listing content', async () => {
    const { store, ctx, storage } = context();
    await store.createBusiness(businessDefaults({ name: 'Adwoa’s Boutique', city: 'Kumasi', region: 'Ashanti', socialProfiles: [] }));
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddPlacesCandidates(ctx, placesInput([place({ name: 'Adwoa’s Boutique', websiteUri: 'https://adwoasboutique.example.org/', phone: '+233 24 123 4567' })]));

    expect(result.summary.added).toBe(0);
    expect(result.summary.needs_review).toBe(1);
    expect(result.results[0].businessName).toBe('Adwoa’s Boutique');
    expect((await store.listBusinesses()).length).toBe(before);
    const persisted = storage.getItem(DEMO_KEY) ?? '';
    expect(persisted).not.toContain('adwoasboutique.example.org');
    expect(persisted).not.toContain('listing copy that must never be stored');
    expect(persisted).not.toContain('123 4567');
  });

  it('is idempotent: repeating the same batch adds nothing', async () => {
    const { store, ctx } = context();
    await bulkAddPlacesCandidates(ctx, placesInput([place(), place({ externalId: OTHER_PLACE_ID })]));
    const count = (await store.listBusinesses()).length;
    const retry = await bulkAddPlacesCandidates(ctx, placesInput([place(), place({ externalId: OTHER_PLACE_ID })]));
    expect(retry.summary.already_exists).toBe(2);
    expect(retry.summary.added).toBe(0);
    expect((await store.listBusinesses()).length).toBe(count);
  });

  it('de-duplicates two copies of the same Place ID inside one batch', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddPlacesCandidates(ctx, placesInput([place(), place()]));
    expect(result.results.map((r) => r.outcome)).toEqual(['added', 'already_exists']);
    expect((await store.listBusinesses()).length).toBe(before + 1);
  });

  it('reports one row’s failure in plain language and keeps going', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    const input = { ...placesInput([place(), place({ externalId: OTHER_PLACE_ID })]), neighborhood: 'n'.repeat(120) };
    const result = await bulkAddPlacesCandidates(ctx, input);
    expect(result.results.map((r) => r.outcome)).toEqual(['failed', 'failed']);
    expect(result.results[0].reason).toBe('This reference could not be saved: Too big: expected string to have <=80 characters');
    expect(result.summary.failed).toBe(2);
    expect((await store.listBusinesses()).length).toBe(before);
  });

  it('refuses more than 20 results at a time', async () => {
    const { ctx } = context();
    const many = Array.from({ length: 21 }, (_, index) => place({ externalId: `ChIJbatchtest${String(index).padStart(6, '0')}` }));
    await expect(bulkAddPlacesCandidates(ctx, placesInput(many))).rejects.toThrow(/at most 20/i);
  });

  it('keeps a labelled demo reference usable and repeatable', async () => {
    const { store, ctx } = context();
    const demo = place({ externalId: 'syn-ashanti-boutique-1', name: 'Boutique Kumasi 1 (synthetic)', isDemo: true });
    const first = await bulkAddPlacesCandidates(ctx, placesInput([demo]));
    expect(first.summary.added).toBe(1);
    const created = (await store.listBusinesses()).find((b) => b.name === 'Boutique Kumasi 1 (synthetic)')!;
    expect(created.placesPlaceId).toBeNull();
    expect(created.sourceKind).toBe('manual');
    expect(created.notes).toMatch(/does not exist/i);
    const retry = await bulkAddPlacesCandidates(ctx, placesInput([demo]));
    expect(retry.summary.already_exists).toBe(1);
  });

  it('keeps workspaces apart: one store never sees the other’s references', async () => {
    const first = context();
    const second = context();
    await bulkAddPlacesCandidates(first.ctx, placesInput([place()]));
    expect((await first.store.listBusinesses()).some((b) => b.placesPlaceId === PLACE_ID)).toBe(true);
    expect((await second.store.listBusinesses()).some((b) => b.placesPlaceId === PLACE_ID)).toBe(false);
  });
});


describe('combined Google + social intake', () => {
  it('adds both providers in one batch and reports one summary', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddMixedCandidates(ctx, { ...placesInput([place()]), social: [social()], basis: 'first_party_observation' });
    expect(result.summary.added).toBe(2);
    expect(result.summary.total).toBe(2);
    expect(result.social?.summary.added).toBe(1);
    expect((await store.listBusinesses()).length).toBe(before + 2);
  });

  it('detects a cross-provider duplicate and keeps the Place ID, not a second prospect', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddMixedCandidates(ctx, {
      ...placesInput([place({ websiteUri: 'https://www.instagram.com/adwoas.boutique/' })]),
      social: [social()],
      basis: 'first_party_observation',
    });
    expect(result.places.summary.added).toBe(1);
    expect(result.social?.results[0].outcome).toBe('needs_review');
    expect(result.social?.results[0].businessId).toBe(result.places.results[0].businessId);
    expect(result.social?.results[0].reason).toMatch(/already added as a Place ID reference/);
    expect((await store.listBusinesses()).length).toBe(before + 1);
    expect(await store.listSocialSources()).toEqual([]);
  });

  it('counts a mixed selection against one 20-result limit', async () => {
    const { ctx } = context();
    const places = Array.from({ length: 15 }, (_, index) => place({ externalId: `ChIJmixedlimit${String(index).padStart(5, '0')}` }));
    const socials = Array.from({ length: 6 }, (_, index) => social({ handle: `mixed.limit.${index}`, profileUrl: `https://www.instagram.com/mixed.limit.${index}/` }));
    await expect(
      bulkAddMixedCandidates(ctx, { ...placesInput(places), social: socials, basis: 'first_party_observation' }),
    ).rejects.toThrow(/at most 20/i);
  });

  it('leaves the social-only path unchanged', async () => {
    const { store, ctx } = context();
    const before = (await store.listBusinesses()).length;
    const result = await bulkAddSocialCandidates(ctx, {
      candidates: [social()],
      basis: 'first_party_observation',
      category: 'Boutique',
      country: 'GH',
      region: 'Ashanti',
      city: 'Kumasi',
      neighborhood: null,
    });
    expect(result.summary.added).toBe(1);
    expect((await store.listBusinesses()).length).toBe(before + 1);
    expect((await store.listSocialSources()).length).toBe(1);
  });
});

describe('source-specific validation', () => {
  it('saves a Place ID without demanding a non-Google source URL', () => {
    expect(sourceEvidenceIssues({ sourceKind: 'places_reference', sourceUrl: '', placesPlaceId: PLACE_ID, contactSource: '', notes: '' })).toEqual([]);
  });

  it('requires a valid Place ID for a reference and says where to find it', () => {
    const issues = sourceEvidenceIssues({ sourceKind: 'places_reference', sourceUrl: '', placesPlaceId: 'Adwoa’s Boutique', contactSource: '', notes: '' });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('placesPlaceId');
    expect(issues[0].message).toMatch(/ChIJ/);
  });

  it('requires an independent URL for a manual candidate, and refuses a Google page', () => {
    const missing = sourceEvidenceIssues({ sourceKind: 'manual', sourceUrl: '', placesPlaceId: '', contactSource: '', notes: '' });
    expect(missing[0]).toMatchObject({ field: 'sourceUrl' });
    const google = sourceEvidenceIssues({ sourceKind: 'manual', sourceUrl: 'https://www.google.com/maps/place/x', placesPlaceId: '', contactSource: '', notes: '' });
    expect(google[0].message).toMatch(/cannot be cited as an independent source/);
    const ok = sourceEvidenceIssues({ sourceKind: 'manual', sourceUrl: 'https://adwoasboutique.example.org/about', placesPlaceId: '', contactSource: '', notes: '' });
    expect(ok).toEqual([]);
  });

  it('requires the business’s own evidence for a submission or a referral', () => {
    const submission = sourceEvidenceIssues({ sourceKind: 'direct_submission', sourceUrl: '', placesPlaceId: '', contactSource: '', notes: '' });
    expect(submission[0].field).toBe('contactSource');
    expect(sourceEvidenceIssues({ sourceKind: 'direct_submission', sourceUrl: '', placesPlaceId: '', contactSource: 'Owner email, 12 Nov', notes: '' })).toEqual([]);
    const referral = sourceEvidenceIssues({ sourceKind: 'referral', sourceUrl: '', placesPlaceId: '', contactSource: '', notes: '' });
    expect(referral[0].field).toBe('notes');
    expect(sourceEvidenceIssues({ sourceKind: 'referral', sourceUrl: '', placesPlaceId: '', contactSource: '', notes: 'Referred by Ama at the Kumasi trade fair, 3 Nov.' })).toEqual([]);
  });

  it('never treats a Place ID as independent evidence for business details', () => {
    const issues = sourceEvidenceIssues({ sourceKind: 'manual', sourceUrl: '', placesPlaceId: PLACE_ID, contactSource: '', notes: '' });
    expect(issues.map((issue) => issue.field)).toEqual(['sourceUrl']);
  });

  it('rejects a malformed Place ID kept alongside independent details', () => {
    const issues = sourceEvidenceIssues({
      sourceKind: 'manual',
      sourceUrl: 'https://adwoasboutique.example.org/about',
      placesPlaceId: 'Adwoa Boutique',
      contactSource: '',
      notes: '',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe('placesPlaceId');
  });

  it('checks that the chosen provenance matches the evidence', () => {
    const notADirectory = sourceEvidenceIssues({
      sourceKind: 'directory',
      sourceUrl: 'https://www.instagram.com/adwoas.boutique/',
      placesPlaceId: '',
      contactSource: '',
      notes: '',
    });
    expect(notADirectory[0]?.message).toMatch(/not a business directory/);
    const notAProfile = sourceEvidenceIssues({
      sourceKind: 'social_profile',
      sourceUrl: 'https://adwoasboutique.example.org/',
      placesPlaceId: '',
      contactSource: '',
      notes: '',
    });
    expect(notAProfile[0]?.message).toMatch(/not a social profile page/);
    expect(
      sourceEvidenceIssues({
        sourceKind: 'directory',
        sourceUrl: 'https://yellowpages.example.org/kumasi/boutiques/adwoa',
        placesPlaceId: '',
        contactSource: '',
        notes: '',
      }),
    ).toEqual([]);
  });
});

