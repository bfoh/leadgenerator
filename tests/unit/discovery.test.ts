import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessDiscoveredRecord,
  canonicalDiscoveryCategory,
  decodeDiscoveryCursor,
  discoveryControlsSchema,
  discoveryRequestFingerprint,
  discoveryRequestSchema,
  encodeDiscoveryCursor,
  findDiscoveryDuplicate,
  type DiscoveredRecord,
} from '@/lib/domain/discovery-framework';
import { campaignDiscoverySources, DISCOVERY_SOURCE_CATALOG, discoverySourceBlocker, discoverySource, sourceAllows } from '@/lib/domain/discovery-sources';
import { campaignInputSchema } from '@/lib/domain/campaigns';
import { campaignProviderBlocker } from '@/lib/domain/discovery-providers';
import { offlineSyntheticProvider } from '@/lib/server/discovery/offline-provider';
import { DiscoveryProviderError } from '@/lib/server/discovery/provider';
import { promoteDiscoveredRecord, runDiscoveryPage } from '@/lib/server/discovery/service';
import { FakeSupabase } from './fake-supabase';

// Provider-agnostic discovery without a network: declarations, request integrity, quality and
// duplicate rules, the offline generator, staging, quotas and promotion. Database constraints and
// RLS are covered in tests/db/discovery.test.ts.

const NOW = new Date('2026-10-24T10:00:00.000Z');

function record(overrides: Partial<DiscoveredRecord> = {}): DiscoveredRecord {
  return {
    sourceId: 'offline_synthetic',
    providerRecordId: 'syn-gh0201-pharmacy-1',
    name: 'Pharmacy Kumasi 1 (synthetic)',
    category: 'Pharmacy',
    address: '1 Synthetic Street, Kumasi',
    region: 'Ashanti',
    districtCode: 'GH0201',
    town: 'Kumasi',
    website: 'https://synthetic.example/syn-gh0201-pharmacy-1',
    phone: null,
    email: null,
    operatingStatus: 'open',
    confidence: 0.9,
    sourceUrl: null,
    retrievedAt: NOW.toISOString(),
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return discoveryRequestSchema.parse({
    sourceId: 'offline_synthetic',
    regions: ['Ashanti'],
    categories: ['Pharmacy'],
    pageSize: 2,
    cursor: '',
    minQuality: 60,
    ...overrides,
  });
}

function discoveryDb() {
  const db = new FakeSupabase();
  db.tables = { businesses: [], provider_discovery_records: [], discovery_runs: [], discovery_events: [] };
  db.unique = { provider_discovery_records: [['organization_id', 'provider_key', 'provider_record_id']] };
  db.defaults = {
    provider_discovery_records: { status: 'pending_review', review_reasons: [] },
    discovery_runs: { status: 'running', records_fetched: 0 },
  };
  return db;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('source declarations', () => {
  it('offers only the synthetic connector to campaigns, and only when enabled', () => {
    expect(campaignDiscoverySources().map((source) => source.id)).toEqual([]);
    expect(campaignDiscoverySources({ syntheticEnabled: true }).map((source) => source.id)).toEqual(['offline_synthetic']);
    expect(campaignProviderBlocker('offline_synthetic')).toMatch(/disabled/i);
    expect(campaignProviderBlocker('offline_synthetic', { syntheticEnabled: true })).toBeNull();
  });

  it('keeps Google Places interactive and refuses every placeholder', () => {
    expect(discoverySourceBlocker('google_places')).toMatch(/does not permit/i);
    for (const source of DISCOVERY_SOURCE_CATALOG.filter((entry) => entry.id !== 'offline_synthetic')) {
      expect(discoverySourceBlocker(source.id)).not.toBeNull();
    }
    expect(campaignProviderBlocker('made_up')).toMatch(/unknown/i);
  });

  it('records the Overture licence evidence and does not claim an integration', () => {
    const overture = discoverySource('overture_places')!;
    expect(overture.status).toBe('not_integrated');
    expect(overture.permissions.uses).toEqual(['unattended_search', 'crm_storage']);
    expect(overture.licence.evidence).toMatch(/CDLA Permissive 2\.0/);
    expect(overture.licence.evidence).toMatch(/ODbL/);
    expect(sourceAllows('overture_places', 'marketing')).toBe(false);
    expect(sourceAllows('overture_places', 'contact_storage')).toBe(false);
  });

  it('blocks Yellow Pages Ghana and keeps OSM out on licence grounds', () => {
    expect(discoverySource('yellow_pages_ghana')?.status).toBe('blocked');
    expect(discoverySource('yellow_pages_ghana')?.licence.evidence).toMatch(/automated tools/i);
    expect(discoverySource('openstreetmap')?.permissions.uses).toEqual([]);
    expect(discoverySource('openstreetmap')?.licence.evidence).toMatch(/same license|share-alike/i);
    expect(discoverySource('national_registry_ghana')?.status).toBe('not_integrated');
  });
});

describe('discovery request integrity', () => {
  it('rejects an unknown region, a mismatched district and an oversized page', () => {
    expect(discoveryRequestSchema.safeParse({ sourceId: 'x', regions: ['Atlantis'] }).success).toBe(false);
    expect(discoveryRequestSchema.safeParse({ sourceId: 'x', regions: ['Ashanti'], districtCodes: ['GH0301'] }).success).toBe(false);
    expect(discoveryRequestSchema.safeParse({ sourceId: 'x', pageSize: 51 }).success).toBe(false);
    expect(discoveryRequestSchema.safeParse({ sourceId: 'x', pageSize: 50 }).success).toBe(true);
  });

  it('binds a cursor to the exact query', () => {
    const first = request();
    const fingerprint = discoveryRequestFingerprint(first);
    const cursor = encodeDiscoveryCursor(4, fingerprint);
    expect(decodeDiscoveryCursor(cursor, fingerprint)).toBe(4);
    expect(decodeDiscoveryCursor(cursor, discoveryRequestFingerprint(request({ categories: ['Hotel'] })))).toBeNull();
    expect(decodeDiscoveryCursor('v1:4:deadbeef', fingerprint)).toBeNull();
  });

  it('defaults discovery controls off and validates the risky combination', () => {
    const controls = discoveryControlsSchema.parse({});
    expect(controls).toMatchObject({ enabled: false, dailyLimit: 25, totalLimit: 100, qualityThreshold: 60, requireReview: true });
    expect(discoveryControlsSchema.safeParse({ enabled: true, dailyLimit: 0 }).success).toBe(false);
    expect(discoveryControlsSchema.safeParse({ enabled: true, totalLimit: 10_001 }).success).toBe(false);
  });
});

describe('record quality and canonical category', () => {
  it('accepts a complete, known record and reports no review reason', () => {
    const quality = assessDiscoveredRecord(record());
    expect(quality).toMatchObject({ score: 100, identityConfidence: 85, accepted: true, needsReview: false, issues: [] });
  });

  it('rejects a permanently closed record and flags an unknown category', () => {
    const closed = assessDiscoveredRecord(record({ operatingStatus: 'permanently_closed' }));
    expect(closed.accepted).toBe(false);
    expect(closed.reviewReasons).toContain('Permanently closed.');
    const unknown = assessDiscoveredRecord(record({ category: 'Martian pet shop' }));
    // An unknown category is still staged, but it can never be auto-promoted: it must be reviewed.
    expect(unknown.accepted).toBe(true);
    expect(unknown.needsReview).toBe(true);
    expect(unknown.reviewReasons).toContain('Unrecognised category.');
    expect(canonicalDiscoveryCategory('Martian pet shop')).toBe('Martian pet shop');
  });

  it('drops a record with no usable name, even if the provider is confident', () => {
    const quality = assessDiscoveredRecord(record({ name: ' ', confidence: 0.99 }));
    expect(quality.accepted).toBe(false);
    expect(quality.issues.join(' ')).toMatch(/no usable business name/i);
  });
});

describe('duplicate detection', () => {
  it('matches a provider record exactly, then a domain, phone or name in the same place', () => {
    expect(findDiscoveryDuplicate(record(), [{ name: 'Other', providerKey: 'offline_synthetic', providerRecordId: 'syn-gh0201-pharmacy-1' }])).toMatchObject({ strength: 'exact' });
    expect(findDiscoveryDuplicate(record(), [{ name: 'Other', website: 'https://synthetic.example/syn-gh0201-pharmacy-1/' }])).toMatchObject({ strength: 'likely' });
    expect(findDiscoveryDuplicate(record({ phone: '+233 20 123 4567' }), [{ name: 'Other', phone: '0201234567' }])).toMatchObject({ strength: 'likely' });
    expect(findDiscoveryDuplicate(record(), [{ name: 'Pharmacy Kumasi 1 (synthetic)', town: 'Kumasi' }])).toMatchObject({ strength: 'likely' });
    expect(findDiscoveryDuplicate(record(), [{ name: 'Different', town: 'Accra' }])).toBeNull();
  });
});

describe('offline synthetic provider', () => {
  it('paginates deterministically inside the requested scope', async () => {
    vi.stubEnv('DISCOVERY_SYNTHETIC_PROVIDER', 'true');
    const first = await offlineSyntheticProvider.search(request(), AbortSignal.timeout(1000));
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    expect(first.records.every((entry) => entry.region === 'Ashanti' && entry.category === 'Pharmacy')).toBe(true);
    const second = await offlineSyntheticProvider.search(request({ cursor: first.nextCursor }), AbortSignal.timeout(1000));
    expect(second.records).toHaveLength(2);
    expect(second.records.map((entry) => entry.providerRecordId)).not.toEqual(first.records.map((entry) => entry.providerRecordId));
    expect(second.nextCursor).toBeNull();
  });

  it('refuses to search while disabled and refuses a cursor from another query', async () => {
    await expect(offlineSyntheticProvider.search(request(), AbortSignal.timeout(1000))).rejects.toThrow(/disabled/i);
    vi.stubEnv('DISCOVERY_SYNTHETIC_PROVIDER', 'true');
    await expect(offlineSyntheticProvider.search(request({ cursor: 'v1:2:00000000' }), AbortSignal.timeout(1000))).rejects.toThrow(/cursor/i);
  });
});

describe('staging, quotas and promotion', () => {
  it('stages permitted records, suppresses the same page again, and promotes one with provenance', async () => {
    vi.stubEnv('DISCOVERY_SYNTHETIC_PROVIDER', 'true');
    const db = discoveryDb();
    const first = await runDiscoveryPage(db.client, {
      organizationId: 'o1',
      campaignId: null,
      request: request(),
      requireReview: true,
      qualityThreshold: 60,
      now: NOW,
    });
    expect(first).toMatchObject({ status: 'succeeded', fetched: 2, staged: 2, duplicates: 0, rejected: 0, promoted: 0 });
    expect(db.rows('provider_discovery_records')).toHaveLength(2);
    expect(db.rows('provider_discovery_records').every((row) => row.status === 'pending_review' && row.phone === null && row.email === null)).toBe(true);

    const repeat = await runDiscoveryPage(db.client, {
      organizationId: 'o1',
      campaignId: null,
      request: request(),
      requireReview: true,
      qualityThreshold: 60,
      now: NOW,
    });
    expect(repeat).toMatchObject({ fetched: 2, staged: 0, duplicates: 2 });

    const staged = db.rows('provider_discovery_records')[0];
    const { businessId } = await promoteDiscoveredRecord(db.client, {
      organizationId: 'o1',
      recordId: String(staged.id),
      actorId: 'u1',
      note: 'Checked against the register.',
    });
    const business = db.rows('businesses').find((row) => row.id === businessId)!;
    expect(business).toMatchObject({
      name: staged.name,
      source_kind: 'provider_discovery',
      provider_key: 'offline_synthetic',
      provider_record_id: staged.provider_record_id,
      contact_permission: 'unknown',
    });
    // Provider website and contact details are not copied into the canonical CRM.
    expect(business.official_website ?? null).toBeNull();
    expect(business.phone ?? null).toBeNull();
    expect(business.email ?? null).toBeNull();
    expect(db.rows('provider_discovery_records')[0]).toMatchObject({ status: 'promoted', business_id: businessId });
    expect(db.rows('discovery_events').some((event) => event.event === 'record_promoted')).toBe(true);
  });

  it('auto-promotes only when review is off and the record clears the high-confidence gate', async () => {
    vi.stubEnv('DISCOVERY_SYNTHETIC_PROVIDER', 'true');
    const db = discoveryDb();
    const result = await runDiscoveryPage(db.client, {
      organizationId: 'o1',
      campaignId: null,
      request: request(),
      requireReview: false,
      qualityThreshold: 80,
      now: NOW,
    });
    expect(result.promoted).toBe(2);
    expect(db.rows('businesses')).toHaveLength(2);
  });

  it('retries a retryable provider failure and records a failed page for a non-retryable one', async () => {
    vi.stubEnv('DISCOVERY_SYNTHETIC_PROVIDER', 'true');
    let attempts = 0;
    const flaky = {
      id: 'offline_synthetic',
      declaration: offlineSyntheticProvider.declaration,
      isEnabled: () => true,
      search: async () => {
        attempts += 1;
        if (attempts < 3) throw new DiscoveryProviderError('overloaded', 'provider', true);
        return { records: [record()], nextCursor: null };
      },
    };
    const recovered = await runDiscoveryPage(discoveryDb().client, {
      organizationId: 'o1',
      campaignId: null,
      request: request(),
      requireReview: true,
      qualityThreshold: 60,
      now: NOW,
      adapter: flaky,
    });
    expect(attempts).toBe(3);
    expect(recovered.status).toBe('succeeded');

    const broken = {
      ...flaky,
      search: async () => {
        throw new DiscoveryProviderError('bad request', 'invalid', false);
      },
    };
    const failed = await runDiscoveryPage(discoveryDb().client, {
      organizationId: 'o1',
      campaignId: null,
      request: request(),
      requireReview: true,
      qualityThreshold: 60,
      now: NOW,
      adapter: broken,
    });
    expect(failed.status).toBe('failed');
    expect(failed.fetched).toBe(0);
  });

  it('refuses a source whose connector is disabled', async () => {
    const db = discoveryDb();
    await expect(
      runDiscoveryPage(db.client, {
        organizationId: 'o1',
        campaignId: null,
        request: request(),
        requireReview: true,
        qualityThreshold: 60,
        now: NOW,
      }),
    ).rejects.toThrow(/disabled/i);
  });

  it('rejects enabling discovery on tracked records, and automatic import below 80', () => {
    const base = {
      name: 'Test',
      scope: { regions: [], districtCodes: [], towns: [], categories: [] },
      schedule: { frequency: 'manual', hour: 6, weekday: null, day: null },
    };
    expect(campaignInputSchema.safeParse({ ...base, providerKey: 'tracked_records', discovery: { enabled: true } }).success).toBe(false);
    expect(
      campaignInputSchema.safeParse({
        ...base,
        providerKey: 'offline_synthetic',
        discovery: { enabled: true, requireReview: false, qualityThreshold: 70 },
      }).success,
    ).toBe(false);
    expect(
      campaignInputSchema.safeParse({
        ...base,
        providerKey: 'offline_synthetic',
        discovery: { enabled: true, requireReview: false, qualityThreshold: 80 },
      }).success,
    ).toBe(true);
  });
});
