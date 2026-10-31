import { describe, expect, it } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { approveIdentityBatch, acceptPlaceIdentity, type IdentityApprovalRequest } from '@/lib/data/identity-services';
import { StoreError } from '@/lib/data/store';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import { businessDefaults } from '@/lib/domain/records';
import { IDENTITY_BATCH_LIMIT } from '@/lib/domain/identity-batch';
import {
  deselectAll,
  eligibleIdentityRows,
  identityApprovalPreview,
  identityReviewRow,
  identityReviewRows,
  rowsNeedingMoreEvidence,
  selectAllEligible,
  type IdentityApprovalDecision,
} from '@/lib/domain/identity-approval';
import {
  identityProfileOf,
  planIdentityQueries,
  type IdentityCandidate,
  type IdentityProfile,
  type PlaceIdentityEvidence,
} from '@/lib/domain/place-identity';
import type { ServiceContext } from '@/lib/data/services';
import type { Business } from '@/lib/domain/types';

// Nothing here touches a provider: every reading is a fixture, and every write goes to an isolated
// in-memory store, so a review and its approvals can be exercised without a network or a database.

const PLACE_A = 'ChIJrTLr-GyuEmsRBfy61i59si0';
const PLACE_B = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const NAME_A = 'Adwoa Boutique';
const NAME_B = 'Chale Chops';

const siteFor = (name: string) => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const candidate = (overrides: Partial<IdentityCandidate> = {}): IdentityCandidate => ({
  site: siteFor(NAME_A),
  url: `https://${siteFor(NAME_A)}/`,
  verdict: 'owned',
  ownershipScore: 92,
  publishedName: NAME_A,
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

/** The evidence one check returns for a record, with the site that publishes the name. */
function evidenceFor(
  profile: IdentityProfile,
  name: string,
  candidateOverrides: Partial<IdentityCandidate> = {},
  evidenceOverrides: Partial<PlaceIdentityEvidence> = {},
): PlaceIdentityEvidence {
  const site = siteFor(name);
  return {
    schema: 1,
    checkedAt: new Date(Date.now() - 3_600_000).toISOString(),
    profile,
    queries: planIdentityQueries(profile, name).map((query) => ({ purpose: query.purpose, resultCount: 4, ok: true })),
    candidates: [candidate({ site, url: `https://${site}/`, publishedName: name, ...candidateOverrides })],
    corroboration: [],
    ...evidenceOverrides,
  };
}

const record = (id: string, name: string, overrides: Partial<Business> = {}): Business =>
  ({
    id,
    ...businessDefaults({ name, city: 'Kumasi', region: 'Ashanti', category: 'Boutique', country: 'GH' }),
    placesPlaceId: `ChIJ${id.replace(/[^a-z0-9]/gi, '').slice(-10)}`,
    ...overrides,
  }) as Business;


describe('Reviewing checked identities', () => {
  it('reviews twenty independently supported rows as eligible', () => {
    const records = Array.from({ length: 20 }, (_, index) => record(`row-${index}`, `Unverified place ROW${index}`));
    const inputs = records.map((business, index) => {
      const name = `Fictional Shop ${index}`;
      return reviewInput(business, name, evidenceFor(identityProfileOf(business), name));
    });

    const rows = identityReviewRows(inputs, records);

    expect(rows).toHaveLength(20);
    expect(eligibleIdentityRows(rows)).toHaveLength(20);
    expect(rows[0]?.proposedName).toBe('Fictional Shop 0');
    expect(rows[0]?.sourceUrl).toBe('https://fictionalshop0.com/');
    expect(rows[0]?.evidenceFrom).toBe('structured data');
    expect(rows[0]?.confidence).toBe('high');
  });

  it('never qualifies a row from Google or a social listing alone', () => {
    const business = record('google-only', 'Unverified place GOOGLE');
    const evidence = evidenceFor(identityProfileOf(business), NAME_A, {
      site: 'google.com',
      url: 'https://www.google.com/maps/place/Adwoa',
    });

    const row = identityReviewRow(reviewInput(business, NAME_A, evidence), [business]);

    expect(row.verification).toBe('unverified');
    expect(row.eligible).toBe(false);
    expect(row.reason).toMatch(/references, not independent sources/i);
  });

  it('keeps a conflicting identity unverified, and says which site competes', () => {
    const business = record('conflicted', 'Unverified place CONFLI');
    const evidence = evidenceFor(identityProfileOf(business), NAME_A, {}, {
      candidates: [
        candidate(),
        candidate({ site: 'otherboutique.com', url: 'https://otherboutique.com/', ownershipScore: 88 }),
      ],
    });

    const row = identityReviewRow(reviewInput(business, NAME_A, evidence), [business]);

    expect(row.verification).toBe('conflicting');
    expect(row.eligible).toBe(false);
    expect(row.conflicts.join(' ')).toMatch(/independent sites could be this business/i);
  });

  it('refuses a check that is more than a week old', () => {
    const business = record('stale', 'Unverified place STALE0');
    const evidence = evidenceFor(identityProfileOf(business), NAME_A, {}, { checkedAt: daysAgo(9) });

    const row = identityReviewRow(reviewInput(business, NAME_A, evidence), [business], new Date());

    expect(row.verification).toBe('stale');
    expect(row.eligible).toBe(false);
    expect(row.reason).toMatch(/more than a week old/i);
  });

  it('holds back a row whose new name another prospect already holds', () => {
    const business = record('rename-me', 'Unverified place RENAME');
    const duplicate = record('already-named', NAME_A);
    const evidence = evidenceFor(identityProfileOf(business), NAME_A);

    const row = identityReviewRow(reviewInput(business, NAME_A, evidence), [business, duplicate]);

    expect(row.eligible).toBe(false);
    expect(row.duplicates[0]?.name).toBe(NAME_A);
    expect(row.duplicates[0]?.strength).toBe('likely');
    expect(row.reason).toMatch(/never merged automatically/i);
  });

  it('shows a similar name without blocking the row on it', () => {
    const business = record('similar', 'Unverified place SIMILA');
    const similar = record('similar-other', `${NAME_A} Kumasi`);
    const evidence = evidenceFor(identityProfileOf(business), NAME_A);

    const row = identityReviewRow(reviewInput(business, NAME_A, evidence), [business, similar]);

    expect(row.duplicates[0]?.strength).toBe('possible');
    expect(row.eligible).toBe(true);
  });

  it('reports a record that already carries the proposed details as nothing to change', () => {
    const business = record('already', NAME_A, { officialWebsite: `https://${siteFor(NAME_A)}/` });
    const evidence = evidenceFor(identityProfileOf(business), NAME_A);

    const row = identityReviewRow(reviewInput(business, NAME_A, evidence), [business]);

    expect(row.eligible).toBe(false);
    expect(row.reason).toMatch(/already carries these details/i);
  });
});

const reviewInput = (business: Business, name: string, evidence: PlaceIdentityEvidence | null) => ({
  businessId: business.id,
  placeId: business.placesPlaceId ?? '',
  recordName: business.name,
  searchedName: name,
  profile: identityProfileOf(business),
  state: evidence ? 'identified' : 'failed',
  evidence,
  reason: evidence ? null : 'The check could not run.',
});

describe('Choosing what to approve', () => {
  const rows = () => {
    const eligibleRecord = record('choose-a', 'Unverified place CHOOSE');
    const blockedRecord = record('choose-b', 'Unverified place BLOCKD');
    const eligible = identityReviewRow(
      reviewInput(eligibleRecord, NAME_A, evidenceFor(identityProfileOf(eligibleRecord), NAME_A)),
      [eligibleRecord, blockedRecord],
    );
    const blocked = identityReviewRow(reviewInput(blockedRecord, NAME_B, null), [eligibleRecord, blockedRecord]);
    return { eligible, blocked };
  };

  it('selects every eligible row and leaves a rejection in place', () => {
    const { eligible, blocked } = rows();
    const decisions = selectAllEligible([eligible, blocked], { [blocked.businessId]: 'reject' });

    expect(decisions[eligible.businessId]).toBe('approve');
    expect(decisions[blocked.businessId]).toBe('reject');
    expect(identityApprovalPreview([eligible, blocked], decisions).selected).toHaveLength(1);
  });

  it('keeps an ineligible row out of the selection however it was marked', () => {
    const { eligible, blocked } = rows();
    const decisions: Record<string, IdentityApprovalDecision> = {
      [blocked.businessId]: 'approve',
      [eligible.businessId]: 'more_evidence',
    };
    const preview = identityApprovalPreview([eligible, blocked], decisions);

    expect(preview.selected).toHaveLength(0);
    expect(preview.setAside.map((row) => row.businessId)).toEqual([eligible.businessId]);
    expect(rowsNeedingMoreEvidence([eligible, blocked], decisions)).toEqual([eligible.businessId]);
  });

  it('deselects everything, so no earlier click survives', () => {
    const { eligible } = rows();
    expect(deselectAll()).toEqual({});
    expect(identityApprovalPreview([eligible], deselectAll()).undecided).toHaveLength(1);
  });
});


// ── The write path ───────────────────────────────────────────────────────────

describe('Approving a reviewed batch', () => {
  const context = () => {
    const store = new LocalStore(new MemoryStorage());
    const ctx: ServiceContext = { store, userId: 'reviewer-1', userLabel: 'Ama Reviewer', settings: DEFAULT_SETTINGS };
    return { store, ctx };
  };

  const seed = async (store: LocalStore, placeId: string, overrides: Partial<Business> = {}) => {
    const created = await store.createBusiness(
      businessDefaults({
        name: `Unverified place ${placeId.slice(-6).toUpperCase()}`,
        city: 'Kumasi',
        region: 'Ashanti',
        category: 'Boutique',
        country: 'GH',
        ...overrides,
      }),
    );
    return store.updateBusiness(created.id, { placesPlaceId: placeId, ...overrides });
  };

  const requestFor = (business: Business, name: string, evidence?: PlaceIdentityEvidence): IdentityApprovalRequest => ({
    businessId: business.id,
    placeId: business.placesPlaceId ?? '',
    evidence: evidence ?? evidenceFor(identityProfileOf(business), name),
  });

  it('renames every approved record, keeps its Place ID and logs the reviewer and the old name', async () => {
    const { store, ctx } = context();
    const first = await seed(store, PLACE_A);
    const second = await seed(store, PLACE_B);

    const results = await approveIdentityBatch(ctx, [requestFor(first, NAME_A), requestFor(second, NAME_B)]);

    expect(results.map((result) => result.state)).toEqual(['approved', 'approved']);
    const savedFirst = await store.getBusiness(first.id);
    const savedSecond = await store.getBusiness(second.id);
    expect(savedFirst?.name).toBe(NAME_A);
    expect(savedSecond?.name).toBe(NAME_B);
    expect(savedFirst?.placesPlaceId).toBe(PLACE_A);
    expect(savedSecond?.placesPlaceId).toBe(PLACE_B);

    const activities = await store.listActivities(first.id);
    const entry = activities.find((activity) => /Identified from an independent source/.test(activity.summary));
    expect(entry).toBeTruthy();
    const details = entry!.details as Record<string, unknown>;
    expect(details.approvedVia).toBe('batch');
    expect(details.placeId).toBe(PLACE_A);
    expect((details.reviewer as { label: string }).label).toBe('Ama Reviewer');
    expect((details.previous as { name: string }).name).toBe(first.name);
    expect((details.identity as { name: string }).name).toBe(NAME_A);
    expect((details.previous as { name: string }).name).not.toBe((details.identity as { name: string }).name);

    const observations = await store.listResearchObservations(first.id);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.category).toBe('identity');
    expect(JSON.stringify(observations[0])).not.toMatch(/google/i);
  });

  it('approves only what the evidence supports, and leaves Google-only rows alone', async () => {
    const { store, ctx } = context();
    const business = await seed(store, PLACE_A);
    const googleOnly = evidenceFor(
      identityProfileOf(business),
      NAME_A,
      { site: 'google.com', url: 'https://www.google.com/maps/place/Adwoa' },
      { candidates: [] },
    );

    const results = await approveIdentityBatch(ctx, [requestFor(business, NAME_A, googleOnly)]);

    expect(results[0]?.state).toBe('failed');
    expect((await store.getBusiness(business.id))?.name).toBe(business.name);
  });

  it('refuses stale evidence and a record that no longer carries the Place ID', async () => {
    const { store, ctx } = context();
    const business = await seed(store, PLACE_A);
    const stale = evidenceFor(identityProfileOf(business), NAME_A, {}, { checkedAt: daysAgo(9) });

    const [staleResult] = await approveIdentityBatch(ctx, [requestFor(business, NAME_A, stale)]);
    expect(staleResult?.state).toBe('failed');
    expect(staleResult?.reason).toMatch(/more than a week old/i);

    const [movedResult] = await approveIdentityBatch(ctx, [
      { businessId: business.id, placeId: PLACE_B, evidence: evidenceFor(identityProfileOf(business), NAME_A) },
    ]);
    expect(movedResult?.state).toBe('failed');
    expect(movedResult?.reason).toMatch(/no longer refers/i);
    expect((await store.getBusiness(business.id))?.placesPlaceId).toBe(PLACE_A);
  });

  it('never renames a record into an identity another prospect already holds', async () => {
    const { store, ctx } = context();
    const business = await seed(store, PLACE_A);
    await store.createBusiness(
      businessDefaults({ name: NAME_A, city: 'Kumasi', region: 'Ashanti', category: 'Boutique' }),
    );

    const [result] = await approveIdentityBatch(ctx, [requestFor(business, NAME_A)]);

    expect(result?.state).toBe('failed');
    expect(result?.reason).toMatch(/never merged automatically/i);
    expect((await store.getBusiness(business.id))?.name).toBe(business.name);
  });

  it('keeps successful approvals when one record in the batch fails', async () => {
    const { store, ctx } = context();
    const first = await seed(store, PLACE_A);
    const stale = await seed(store, PLACE_B);
    const third = await seed(store, 'ChIJbatchApprovalFixture0003');

    const results = await approveIdentityBatch(ctx, [
      requestFor(first, NAME_A),
      requestFor(stale, NAME_B, evidenceFor(identityProfileOf(stale), NAME_B, {}, { checkedAt: daysAgo(9) })),
      requestFor(third, 'Fictional Third Shop'),
    ]);

    expect(results.map((result) => result.state)).toEqual(['approved', 'failed', 'approved']);
    expect(results[1]?.reason).toMatch(/more than a week old/i);
    expect((await store.getBusiness(first.id))?.name).toBe(NAME_A);
    expect((await store.getBusiness(stale.id))?.name).toBe(stale.name);
    expect((await store.getBusiness(third.id))?.name).toBe('Fictional Third Shop');
  });


  it('applies the same approval twice as one change, not two', async () => {
    const { store, ctx } = context();
    const business = await seed(store, PLACE_A);
    const request = requestFor(business, NAME_A);

    const first = await approveIdentityBatch(ctx, [request]);
    const second = await approveIdentityBatch(ctx, [request]);

    expect(first[0]?.state).toBe('approved');
    expect(second[0]?.state).toBe('unchanged');
    expect((await store.getBusiness(business.id))?.name).toBe(NAME_A);
    const identifications = (await store.listActivities(business.id)).filter((activity) =>
      /Identified from an independent source/.test(activity.summary),
    );
    expect(identifications).toHaveLength(1);
    expect(await store.listResearchObservations(business.id)).toHaveLength(1);
  });

  it('refuses a record from another workspace, a repeated row and a batch over the limit', async () => {
    const { store, ctx } = context();
    const business = await seed(store, PLACE_A);

    const [unknown] = await approveIdentityBatch(ctx, [
      { businessId: '11111111-1111-4111-8111-111111111111', placeId: PLACE_B, evidence: null },
    ]);
    expect(unknown?.state).toBe('failed');
    expect(unknown?.reason).toMatch(/not found in this workspace/i);

    const [first, repeated] = await approveIdentityBatch(ctx, [requestFor(business, NAME_A), requestFor(business, NAME_A)]);
    expect(first?.state).toBe('approved');
    expect(repeated?.state).toBe('failed');
    expect(repeated?.reason).toMatch(/appears twice/i);
    expect((await store.getBusiness(business.id))?.name).toBe(NAME_A);

    const tooMany = Array.from({ length: IDENTITY_BATCH_LIMIT + 1 }, () => requestFor(business, NAME_A));
    await expect(approveIdentityBatch(ctx, tooMany)).rejects.toBeInstanceOf(StoreError);
  });

  it('records a single acceptance with the same audit trail, marked as a single approval', async () => {
    const { store, ctx } = context();
    const business = await seed(store, PLACE_A);

    const accepted = await acceptPlaceIdentity(ctx, business, evidenceFor(identityProfileOf(business), NAME_A));

    expect(accepted.state).toBe('approved');
    expect(accepted.business.name).toBe(NAME_A);
    const entry = (await store.listActivities(business.id)).find((activity) =>
      /Identified from an independent source/.test(activity.summary),
    );
    expect((entry?.details as Record<string, unknown>).approvedVia).toBe('single');
  });
});
