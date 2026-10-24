import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_STATUSES,
  GHANA_REGIONS,
  GHANA_REGION_NAMES,
  QUALIFIED_SCORE,
  campaignBudgetReached,
  campaignCandidates,
  campaignIneligibility,
  campaignInputSchema,
  campaignProgress,
  campaignScopeMatch,
  campaignStatusTransitionAllowed,
  campaignTargetCounts,
  describeSchedule,
  describeScope,
  isCampaignDue,
  isQualifiedProspect,
  nextRunAt,
  regionOfBusiness,
  resolveTargetState,
  startOfCampaignDay,
  type CampaignBusiness,
  type CampaignSchedule,
  type CampaignScope,
} from '@/lib/domain/campaigns';
import { DISTRICTS, DISTRICT_SOURCE } from '@/lib/domain/districts';
import {
  DISCOVERY_PROVIDER_CATALOG,
  campaignProviderBlocker,
  campaignProviders,
  providerAllows,
  providerDeclaration,
} from '@/lib/domain/discovery-providers';

const EMPTY_SCOPE: CampaignScope = { regions: [], districtCodes: [], towns: [], categories: [] };

function business(overrides: Partial<CampaignBusiness> & { id: string }): CampaignBusiness {
  return {
    region: 'Ashanti',
    districtCode: null,
    city: 'Kumasi',
    neighborhood: null,
    category: 'Pharmacy',
    contactPermission: 'unknown',
    mergedIntoId: null,
    stage: 'research_candidate',
    businessStatus: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    opportunityScore: null,
    ...overrides,
  };
}

const weekly: CampaignSchedule = { frequency: 'weekly', hour: 9, weekday: 1, day: null };

describe('Ghana regions and districts', () => {
  it('lists the 16 regions once, with codes that match the district P-codes', () => {
    expect(GHANA_REGIONS).toHaveLength(16);
    expect(new Set(GHANA_REGION_NAMES).size).toBe(16);
    expect([...GHANA_REGION_NAMES].sort()).toEqual([...new Set(DISTRICTS.map((d) => d.region))].sort());
    for (const region of GHANA_REGIONS) {
      const districts = DISTRICTS.filter((d) => d.region === region.name);
      expect(districts.length, region.name).toBeGreaterThan(0);
      for (const district of districts) expect(district.code.startsWith(region.code)).toBe(true);
    }
  });

  it('keeps every district code unique', () => {
    expect(new Set(DISTRICTS.map((d) => d.code)).size).toBe(DISTRICTS.length);
    expect(DISTRICTS).toHaveLength(261);
  });

  it('records the source, licence and the exact number of records verified against it', () => {
    expect(DISTRICT_SOURCE).toMatchObject({ licence: 'CC BY-IGO 3.0', verifiedRecords: 260, verifiedOn: '2026-10-24' });
    expect(DISTRICTS.filter((d) => d.code === 'GH10-GUAN')).toEqual([{ code: 'GH10-GUAN', name: 'Guan', region: 'Oti' }]);
    expect(DISTRICTS.filter((d) => d.code !== 'GH10-GUAN')).toHaveLength(DISTRICT_SOURCE.verifiedRecords);
  });
});

describe('discovery provider declarations', () => {
  it('allows campaigns only through tracked records', () => {
    expect(campaignProviders().map((p) => p.id)).toEqual(['tracked_records']);
    expect(campaignProviderBlocker('tracked_records')).toBeNull();
  });

  it('never allows Google Places to run unattended or be stored in the CRM', () => {
    const places = providerDeclaration('google_places')!;
    expect(places.requiresUserInitiation).toBe(true);
    expect(places.permittedUses).toEqual(['interactive_discovery']);
    expect(providerAllows('google_places', 'unattended_discovery')).toBe(false);
    expect(providerAllows('google_places', 'crm_processing')).toBe(false);
    expect(places.retention.storableFields).toEqual(['places_place_id']);
    expect(campaignProviderBlocker('google_places')).toMatch(/person/i);
  });

  it('does not claim an integration that does not exist', () => {
    for (const provider of DISCOVERY_PROVIDER_CATALOG.filter((p) => p.id !== 'tracked_records' && p.id !== 'google_places')) {
      expect(provider.status).toBe('not_integrated');
      expect(provider.permittedUses).toEqual([]);
      expect(Object.values(provider.capabilities).every((v) => v === false)).toBe(true);
      expect(campaignProviderBlocker(provider.id)).not.toBeNull();
    }
  });

  it('rejects an unknown provider', () => {
    expect(providerDeclaration('made_up')).toBeNull();
    expect(providerAllows('made_up', 'unattended_discovery')).toBe(false);
    expect(campaignProviderBlocker('made_up')).toMatch(/unknown/i);
  });
});

describe('campaign scope matching', () => {
  it('treats an empty scope as nationwide', () => {
    const match = campaignScopeMatch(business({ id: 'b1' }), EMPTY_SCOPE);
    expect(match.matched).toBe(true);
    expect(match.reason).toContain('Nationwide');
  });

  it('narrows by region, district, town and category', () => {
    const b = business({ id: 'b1', districtCode: 'GH0201', neighborhood: 'Adum' });
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, regions: ['Ashanti'] }).matched).toBe(true);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, regions: ['Greater Accra'] }).matched).toBe(false);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, districtCodes: ['GH0201'] }).matched).toBe(true);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, districtCodes: ['GH0301'] }).matched).toBe(false);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, towns: ['kumasi'] }).matched).toBe(true);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, towns: ['adum'] }).matched).toBe(true);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, towns: ['Accra'] }).matched).toBe(false);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, categories: ['pharmacy'] }).matched).toBe(true);
    expect(campaignScopeMatch(b, { ...EMPTY_SCOPE, categories: ['Hotel'] }).matched).toBe(false);
  });

  it('requires a district when the campaign targets districts', () => {
    expect(campaignScopeMatch(business({ id: 'b1', districtCode: null }), { ...EMPTY_SCOPE, districtCodes: ['GH0201'] }).matched).toBe(false);
  });

  it('reads the region from the district when the record has none', () => {
    expect(regionOfBusiness({ region: null, districtCode: 'GH0201' })).toBe('Ashanti');
    expect(regionOfBusiness({ region: 'Ashanti', districtCode: 'GH0201' })).toBe('Ashanti');
  });

  it('never targets opted-out, merged, archived or inactive records', () => {
    expect(campaignIneligibility(business({ id: 'b1', contactPermission: 'opted_out' }))).toMatch(/opted out/i);
    expect(campaignIneligibility(business({ id: 'b2', mergedIntoId: 'other' }))).toMatch(/merged/i);
    expect(campaignIneligibility(business({ id: 'b3', stage: 'archived' }))).toMatch(/archived/i);
    expect(campaignIneligibility(business({ id: 'b4', businessStatus: 'inactive' }))).toMatch(/inactive/i);
    expect(campaignIneligibility(business({ id: 'b5' }))).toBeNull();
  });

  it('returns eligible prospects oldest first, with a reason', () => {
    const list = [
      business({ id: 'new', createdAt: '2026-03-01T00:00:00.000Z' }),
      business({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
      business({ id: 'out', createdAt: '2025-01-01T00:00:00.000Z', contactPermission: 'opted_out' }),
      business({ id: 'hotel', createdAt: '2026-02-01T00:00:00.000Z', category: 'Hotel' }),
    ];
    const picked = campaignCandidates(list, { ...EMPTY_SCOPE, regions: ['Ashanti'], categories: ['Pharmacy'] });
    expect(picked.map((p) => p.business.id)).toEqual(['old', 'new']);
    expect(picked[0].reason).toContain('Kumasi');
  });
});

describe('campaign scheduling (Africa/Accra = UTC)', () => {
  const at = (iso: string) => new Date(iso);

  it('is manual when the frequency is manual', () => {
    expect(nextRunAt({ frequency: 'manual', hour: 6, weekday: null, day: null }, at('2026-10-24T12:00:00Z'))).toBeNull();
  });

  it('runs daily at the next occurrence of the hour', () => {
    expect(nextRunAt({ frequency: 'daily', hour: 9, weekday: null, day: null }, at('2026-10-24T08:00:00Z'))).toBe('2026-10-24T09:00:00.000Z');
    expect(nextRunAt({ frequency: 'daily', hour: 9, weekday: null, day: null }, at('2026-10-24T09:00:00Z'))).toBe('2026-10-25T09:00:00.000Z');
    expect(nextRunAt({ frequency: 'daily', hour: 9, weekday: null, day: null }, at('2026-12-31T22:00:00Z'))).toBe('2027-01-01T09:00:00.000Z');
  });

  it('runs weekly on the chosen weekday', () => {
    // 24 October 2026 is a Saturday; the next Monday is the 26th.
    expect(nextRunAt(weekly, at('2026-10-24T12:00:00Z'))).toBe('2026-10-26T09:00:00.000Z');
    expect(nextRunAt(weekly, at('2026-10-26T08:00:00Z'))).toBe('2026-10-26T09:00:00.000Z');
  });

  it('runs monthly on the chosen day, rolling into the next month', () => {
    const monthly: CampaignSchedule = { frequency: 'monthly', hour: 6, weekday: null, day: 5 };
    expect(nextRunAt(monthly, at('2026-10-01T00:00:00Z'))).toBe('2026-10-05T06:00:00.000Z');
    expect(nextRunAt(monthly, at('2026-10-05T06:00:00Z'))).toBe('2026-11-05T06:00:00.000Z');
    expect(nextRunAt(monthly, at('2026-12-20T00:00:00Z'))).toBe('2027-01-05T06:00:00.000Z');
  });

  it('is due only when active, scheduled and past its next run', () => {
    const base = { status: 'active' as const, schedule: weekly, nextRunAt: '2026-10-26T09:00:00.000Z' };
    expect(isCampaignDue(base, at('2026-10-26T09:01:00Z'))).toBe(true);
    expect(isCampaignDue(base, at('2026-10-26T08:59:00Z'))).toBe(false);
    expect(isCampaignDue({ ...base, status: 'paused' }, at('2026-10-26T10:00:00Z'))).toBe(false);
    expect(isCampaignDue({ ...base, schedule: { ...weekly, frequency: 'manual' } }, at('2026-10-26T10:00:00Z'))).toBe(false);
    expect(isCampaignDue({ ...base, nextRunAt: null }, at('2026-10-26T10:00:00Z'))).toBe(false);
  });

  it('describes a schedule in plain words', () => {
    expect(describeSchedule({ frequency: 'daily', hour: 6, weekday: null, day: null })).toBe('Every day at 06:00 GMT');
    expect(describeSchedule(weekly)).toBe('Every Monday at 09:00 GMT');
    expect(describeSchedule({ frequency: 'monthly', hour: 6, weekday: null, day: 5 })).toBe('Day 5 of every month at 06:00 GMT');
  });

  it('starts the campaign day at midnight UTC', () => {
    expect(startOfCampaignDay(new Date('2026-10-24T23:59:59Z'))).toBe('2026-10-24T00:00:00.000Z');
  });
});

describe('campaign status and progress', () => {
  it('allows only the documented moves', () => {
    expect(campaignStatusTransitionAllowed('draft', 'active')).toBe(true);
    expect(campaignStatusTransitionAllowed('active', 'paused')).toBe(true);
    expect(campaignStatusTransitionAllowed('paused', 'active')).toBe(true);
    expect(campaignStatusTransitionAllowed('active', 'completed')).toBe(true);
    expect(campaignStatusTransitionAllowed('draft', 'completed')).toBe(false);
    expect(campaignStatusTransitionAllowed('completed', 'active')).toBe(false);
    expect(campaignStatusTransitionAllowed('cancelled', 'active')).toBe(false);
    for (const status of CAMPAIGN_STATUSES) expect(campaignStatusTransitionAllowed(status, status)).toBe(true);
  });

  it('counts targets and reports progress', () => {
    const counts = campaignTargetCounts([
      { state: 'queued' },
      { state: 'researching' },
      { state: 'researched' },
      { state: 'qualified' },
      { state: 'failed' },
      { state: 'skipped' },
    ]);
    expect(counts).toMatchObject({ queued: 1, researching: 1, researched: 1, qualified: 1, failed: 1, skipped: 1, total: 6, completed: 2 });
    expect(campaignProgress(counts)).toEqual({ done: 2, total: 6, percent: 33 });
    expect(campaignProgress(campaignTargetCounts([]))).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('treats a prospect at or above the qualified score as an opportunity', () => {
    expect(isQualifiedProspect({ opportunityScore: QUALIFIED_SCORE })).toBe(true);
    expect(isQualifiedProspect({ opportunityScore: QUALIFIED_SCORE - 1 })).toBe(false);
    expect(isQualifiedProspect({ opportunityScore: null })).toBe(false);
  });

  it('stops at the campaign budget', () => {
    expect(campaignBudgetReached({ monthlyBudgetUsd: 10 }, 9.99)).toBe(false);
    expect(campaignBudgetReached({ monthlyBudgetUsd: 10 }, 10)).toBe(true);
    expect(campaignBudgetReached({ monthlyBudgetUsd: null }, 1000)).toBe(false);
  });

  it('describes a nationwide scope and a narrowed one', () => {
    expect(describeScope(EMPTY_SCOPE)).toContain('Nationwide');
    expect(describeScope({ regions: ['Ashanti'], districtCodes: ['GH0201'], towns: [], categories: ['Pharmacy'] })).toContain('1 district');
  });
});

describe('campaign input schema', () => {
  const base = {
    name: 'Q4 pharmacies',
    scope: EMPTY_SCOPE,
    schedule: { frequency: 'daily', hour: 6 },
    batchSize: 5,
    dailyTargetLimit: 20,
  };

  it('accepts a nationwide tracked-record campaign', () => {
    const parsed = campaignInputSchema.parse(base);
    expect(parsed.providerKey).toBe('tracked_records');
    expect(parsed.scope).toEqual(EMPTY_SCOPE);
    expect(parsed.monthlyBudgetUsd).toBeNull();
  });

  it('refuses Google Places and unknown providers', () => {
    expect(campaignInputSchema.safeParse({ ...base, providerKey: 'google_places' }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...base, providerKey: 'made_up' }).success).toBe(false);
  });

  it('refuses an unknown region or a district outside the chosen region', () => {
    expect(campaignInputSchema.safeParse({ ...base, scope: { ...EMPTY_SCOPE, regions: ['Atlantis'] } }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...base, scope: { ...EMPTY_SCOPE, regions: ['Ashanti'], districtCodes: ['GH0301'] } }).success).toBe(false);
  });

  it('needs a weekday for a weekly schedule and a day for a monthly one', () => {
    expect(campaignInputSchema.safeParse({ ...base, schedule: { frequency: 'weekly', hour: 6 } }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...base, schedule: { frequency: 'weekly', hour: 6, weekday: 1 } }).success).toBe(true);
    expect(campaignInputSchema.safeParse({ ...base, schedule: { frequency: 'monthly', hour: 6 } }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...base, schedule: { frequency: 'monthly', hour: 6, day: 5 } }).success).toBe(true);
  });

  it('removes duplicate scope entries', () => {
    const parsed = campaignInputSchema.parse({ ...base, scope: { ...EMPTY_SCOPE, regions: ['Ashanti', 'Ashanti'], towns: ['Kumasi', 'Kumasi'] } });
    expect(parsed.scope.regions).toEqual(['Ashanti']);
    expect(parsed.scope.towns).toEqual(['Kumasi']);
  });
});

describe('campaign target reconciliation', () => {
  it('waits while any job in the chain is open', () => {
    expect(resolveTargetState([{ status: 'pending' }], 90)).toBeNull();
    expect(resolveTargetState([{ status: 'succeeded' }, { status: 'running' }], 90)).toBeNull();
    expect(resolveTargetState([{ status: 'awaiting_approval' }], 90)).toBeNull();
  });

  it('queues a target again when its job has disappeared', () => {
    expect(resolveTargetState([], null)).toMatchObject({ state: 'queued' });
  });

  it('records a failure with the job’s reason', () => {
    expect(resolveTargetState([{ status: 'succeeded' }, { status: 'failed', lastError: 'No budget for Brave Search' }], 10)).toEqual({
      state: 'failed',
      note: 'No budget for Brave Search',
    });
    expect(resolveTargetState([{ status: 'failed' }], 10)?.note).toMatch(/failed/);
  });

  it('treats a cancelled chain as skipped', () => {
    expect(resolveTargetState([{ status: 'succeeded' }, { status: 'cancelled', lastError: 'Opted out' }], 90)).toEqual({ state: 'skipped', note: 'Opted out' });
  });

  it('qualifies a finished chain at the score threshold, otherwise marks it researched', () => {
    expect(resolveTargetState([{ status: 'succeeded' }], QUALIFIED_SCORE)).toMatchObject({ state: 'qualified' });
    expect(resolveTargetState([{ status: 'succeeded' }], QUALIFIED_SCORE - 1)).toMatchObject({ state: 'researched' });
    expect(resolveTargetState([{ status: 'succeeded' }], null)?.state).toBe('researched');
  });
});




