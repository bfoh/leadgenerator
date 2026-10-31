import { describe, expect, it, vi } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { businessDefaults } from '@/lib/domain/records';
import { identityProfileOf, type IdentityProfile } from '@/lib/domain/place-identity';
import type { Business } from '@/lib/domain/types';
import { prepareIdentityBatch } from '@/lib/server/identity-batch';

const PLACE_ID = 'ChIJprepFixture1';
const SEARCHED = 'Adwoa’s Boutique';

const workspace = () => new LocalStore(new MemoryStorage());

const seed = async (store: LocalStore): Promise<Business> => {
  const created = await store.createBusiness(
    businessDefaults({
      name: 'Unverified place PREP1',
      city: 'Kumasi',
      region: 'Ashanti',
      category: 'Boutique',
      country: 'GH',
    }),
  );
  return store.updateBusiness(created.id, { placesPlaceId: PLACE_ID });
};

const forged: IdentityProfile = {
  name: 'Something the browser made up',
  city: 'Accra',
  region: 'Greater Accra',
  neighborhood: null,
  category: 'Bakery',
  country: 'GH',
  website: 'https://not-the-record.example/',
};

describe('Resolving a batch request against the caller’s workspace', () => {
  it('checks the stored record, not the copy the browser sent', async () => {
    const store = workspace();
    const record = await seed(store);

    const prepared = await prepareIdentityBatch(
      [{ businessId: record.id, placeId: PLACE_ID, name: SEARCHED, profile: forged }],
      (businessId) => store.getBusiness(businessId),
    );

    expect(prepared.rejected).toEqual([]);
    expect(prepared.jobs).toHaveLength(1);
    expect(prepared.jobs[0]?.profile).toEqual(identityProfileOf(record));
    expect(prepared.jobs[0]?.profile.name).toBe('Unverified place PREP1');
    expect(prepared.jobs[0]?.recordName).toBe('Unverified place PREP1');
    expect(prepared.jobs[0]?.name).toBe(SEARCHED);
    expect(prepared.jobs[0]?.placeId).toBe(PLACE_ID);
    expect(prepared.jobs[0]?.state).toBe('pending');
  });

  it('does not reach a record that belongs to another workspace', async () => {
    const mine = workspace();
    const theirs = workspace();
    const theirRecord = await seed(theirs);

    const prepared = await prepareIdentityBatch(
      [{ businessId: theirRecord.id, placeId: PLACE_ID, name: SEARCHED }],
      (businessId) => mine.getBusiness(businessId),
    );

    expect(prepared.jobs).toEqual([]);
    expect(prepared.rejected).toHaveLength(1);
    expect(prepared.rejected[0]?.state).toBe('failed');
    expect(prepared.rejected[0]?.reason).toBe('Prospect not found in this workspace.');
  });
});

describe('Refusing what a batch cannot check', () => {
  it('refuses a record that changed since the list was loaded', async () => {
    const store = workspace();
    const record = await seed(store);

    const prepared = await prepareIdentityBatch(
      [{ businessId: record.id, placeId: 'ChIJsomethingElse', name: SEARCHED }],
      (businessId) => store.getBusiness(businessId),
    );

    expect(prepared.jobs).toEqual([]);
    expect(prepared.rejected[0]?.reason).toMatch(/changed since the list was loaded/i);
  });

  it('refuses a merged record and one with no Google reference', async () => {
    const store = workspace();
    const record = await seed(store);

    const merged = await prepareIdentityBatch(
      [{ businessId: record.id, placeId: PLACE_ID, name: SEARCHED }],
      async () => ({ ...record, mergedIntoId: 'kept-record' }),
    );
    expect(merged.jobs).toEqual([]);
    expect(merged.rejected[0]?.reason).toMatch(/merged/i);

    const noReference = await prepareIdentityBatch(
      [{ businessId: record.id, placeId: PLACE_ID, name: SEARCHED }],
      async () => ({ ...record, placesPlaceId: null }),
    );
    expect(noReference.jobs).toEqual([]);
    expect(noReference.rejected[0]?.reason).toMatch(/no google place id/i);
  });

  it('refuses a name it cannot search for before it reads anything', async () => {
    const store = workspace();
    const record = await seed(store);
    const lookup = vi.fn((businessId: string) => store.getBusiness(businessId));

    const prepared = await prepareIdentityBatch(
      [
        { businessId: record.id, placeId: PLACE_ID, name: 'Unverified place PREP1' },
        { businessId: record.id, placeId: PLACE_ID, name: 'Ad' },
      ],
      lookup,
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(prepared.jobs).toEqual([]);
    expect(prepared.rejected.map((r) => r.reason)).toEqual([
      'That is the reference label, not a business name.',
      'A business name needs at least three characters.',
    ]);
  });

  it('runs the records it can and answers for the ones it cannot', async () => {
    const store = workspace();
    const record = await seed(store);

    const prepared = await prepareIdentityBatch(
      [
        { businessId: record.id, placeId: PLACE_ID, name: SEARCHED },
        { businessId: 'missing-record', placeId: 'ChIJgone', name: 'Another Shop' },
      ],
      (businessId) => store.getBusiness(businessId),
    );

    expect(prepared.jobs.map((j) => j.businessId)).toEqual([record.id]);
    expect(prepared.rejected.map((r) => r.businessId)).toEqual(['missing-record']);
  });
});

describe('Demo mode, where the store lives in the browser', () => {
  it('trusts the profile the request carries, and refuses a request without one', async () => {
    const demoProfile = { ...forged, name: 'Demo Boutique' };
    const withProfile = await prepareIdentityBatch(
      [{ businessId: 'demo-1', placeId: 'ChIJdemo', name: SEARCHED, profile: demoProfile }],
      null,
    );

    expect(withProfile.rejected).toEqual([]);
    expect(withProfile.jobs[0]?.profile).toEqual(demoProfile);
    expect(withProfile.jobs[0]?.recordName).toBe('Demo Boutique');

    const withoutProfile = await prepareIdentityBatch(
      [{ businessId: 'demo-2', placeId: 'ChIJdemo', name: SEARCHED }],
      null,
    );
    expect(withoutProfile.jobs).toEqual([]);
    expect(withoutProfile.rejected[0]?.reason).toBe('The record is missing from the request.');
  });
});

