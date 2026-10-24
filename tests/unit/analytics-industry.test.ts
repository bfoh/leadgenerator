import { describe, expect, it } from 'vitest';
import { industryRollup } from '@/lib/domain/analytics';
import { INDUSTRY_GROUPS } from '@/lib/domain/categories';
import type { Activity, Business, Proposal } from '@/lib/domain/types';

// Milestone 3A.1: analytics at industry-group level, with the stored category labels kept for
// drill-down and every record accounted for (including labels outside the catalogue).

const business = (id: string, category: string, stage: Business['stage'], opportunityScore: number | null = null) =>
  ({ id, category, stage, opportunityScore }) as Business;

const activity = (businessId: string, from: string, to: string) => ({ businessId, type: 'stage_change', details: { from, to } }) as unknown as Activity;

const proposal = (businessId: string, status: Proposal['status']) => ({ businessId, status }) as Pick<Proposal, 'businessId' | 'status'>;

const group = (rollup: ReturnType<typeof industryRollup>, key: string) => rollup.groups.find((g) => g.key === key)!;

describe('industry rollups', () => {
  const records = [
    business('b1', 'Furniture showroom', 'qualified', 82),
    business('b2', 'Fashion boutique', 'research_candidate', 40),
    business('b3', 'Waakye joint', 'qualified', 65),
    // Discover files a whole-group search under the group label; it belongs to the same group.
    business('b4', 'Food, Drink & Catering', 'verification_pending', 55),
    // A workspace label outside the catalogue is kept, never dropped.
    business('b5', 'Mammy wagon transport', 'discovery_meeting', 70),
    business('b6', 'Pharmacy', 'lost', 90),
  ];

  it('reports all thirty groups, including groups with no records', () => {
    const rollup = industryRollup(records, []);
    expect(rollup.groups).toHaveLength(30);
    expect(rollup.groups.map((g) => g.key)).toEqual(INDUSTRY_GROUPS.map((g) => g.key));
    expect(rollup.groups.filter((g) => g.prospects > 0)).toHaveLength(4);
    expect(group(rollup, 'agriculture')).toMatchObject({ prospects: 0, open: 0, qualified: 0, won: 0, avgScore: null, conversionRate: null });
  });

  it('counts open and qualified prospects per group, and keeps the stored category labels underneath', () => {
    const rollup = industryRollup(records, []);
    expect(group(rollup, 'furniture')).toMatchObject({ prospects: 1, open: 1, qualified: 1, avgScore: 82 });
    expect(group(rollup, 'food')).toMatchObject({ prospects: 2, open: 2, qualified: 2, avgScore: 60 });
    expect(group(rollup, 'food').categories.map((c) => c.label)).toEqual(['Food, Drink & Catering', 'Waakye joint']);
    expect(group(rollup, 'food').categories.every((c) => c.qualified === 1)).toBe(true);
    expect(group(rollup, 'fashion')).toMatchObject({ prospects: 1, open: 1, qualified: 0 });
    // Lost records still count towards the group's history, but not towards open or qualified.
    expect(group(rollup, 'pharmacy')).toMatchObject({ prospects: 1, open: 0, qualified: 0 });
    expect(group(rollup, 'pharmacy').categories[0]).toMatchObject({ label: 'Pharmacy', prospects: 1, open: 0 });
  });

  it('keeps labels outside the catalogue in a separate bucket so totals reconcile', () => {
    const rollup = industryRollup(records, []);
    expect(rollup.unclassified).toMatchObject({ key: 'unclassified', label: 'Not in the catalogue', prospects: 1, open: 1, qualified: 1 });
    expect(rollup.unclassified!.categories.map((c) => c.label)).toEqual(['Mammy wagon transport']);
    expect(rollup.totals).toMatchObject({ prospects: records.length, open: 5, qualified: 4, groupsCovered: 4 });
  });

  it('counts a win from the furthest stage reached, even when the record later moved on', () => {
    const rows = [business('w1', 'Furniture showroom', 'won', 70), business('w2', 'Furniture showroom', 'lost', 80), business('w3', 'Furniture showroom', 'lost', 20)];
    const log = [activity('w2', 'negotiation', 'won'), activity('w2', 'won', 'lost')];
    const rollup = industryRollup(rows, log);
    expect(group(rollup, 'furniture').won).toBe(2);
    expect(group(rollup, 'furniture').conversionRate).toBeCloseTo(2 / 3);
    expect(group(rollup, 'furniture').categories[0]).toMatchObject({ label: 'Furniture showroom', won: 2, prospects: 3 });
    expect(rollup.totals.won).toBe(2);
  });

  it('uses the campaign qualification score and only counts open prospects', () => {
    const rows = [business('q1', 'Pharmacy', 'qualified', 49), business('q2', 'Pharmacy', 'qualified', 50), business('q3', 'Pharmacy', 'qualified', 51), business('q4', 'Pharmacy', 'lost', 100)];
    expect(group(industryRollup(rows, []), 'pharmacy').qualified).toBe(2);
    expect(group(industryRollup(rows, [], [], { qualifiedScore: 60 }), 'pharmacy').qualified).toBe(0);
  });

  it('counts decided proposals per group and per stored category', () => {
    const rows = [business('p1', 'Pharmacy', 'won', 80), business('p2', 'Pharmacy', 'qualified', 70), business('p3', 'Fashion boutique', 'qualified', 60)];
    const proposals = [proposal('p1', 'accepted'), proposal('p2', 'declined'), proposal('p2', 'sent'), proposal('p3', 'accepted'), proposal('p3', 'draft')];
    const rollup = industryRollup(rows, [], proposals);
    expect(group(rollup, 'pharmacy')).toMatchObject({ proposalsDecided: 2, proposalsAccepted: 1, proposalWinRate: 0.5 });
    expect(group(rollup, 'pharmacy').categories.find((c) => c.label === 'Pharmacy')).toMatchObject({ proposalsDecided: 2, proposalsAccepted: 1 });
    expect(group(rollup, 'fashion')).toMatchObject({ proposalsDecided: 1, proposalsAccepted: 1, proposalWinRate: 1 });
    expect(rollup.totals).toMatchObject({ proposalsDecided: 3, proposalsAccepted: 2 });
  });

  it('returns a zero rollup with no records and no unclassified bucket', () => {
    const rollup = industryRollup([], []);
    expect(rollup.groups).toHaveLength(30);
    expect(rollup.unclassified).toBeNull();
    expect(rollup.totals).toMatchObject({ prospects: 0, open: 0, qualified: 0, won: 0, groupsCovered: 0 });
    expect(rollup.groups.every((g) => g.proposalWinRate === null && g.conversionRate === null)).toBe(true);
  });
});
