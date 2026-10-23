import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { buckets, costGroup, funnel, granularityFor, outcomeGroup, series, topCounts } from '@/lib/domain/analytics';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { Activity, Business } from '@/lib/domain/types';

const biz = (id: string, stage: Business['stage']) => ({ id, stage }) as Business;
const move = (businessId: string, from: string, to: string) => ({ businessId, type: 'stage_change', details: { from, to } }) as unknown as Activity;

describe('analytics aggregations', () => {
  it('counts the furthest stage reached, including prospects that later exited', () => {
    const steps = funnel(
      [biz('a', 'research_candidate'), biz('b', 'qualified'), biz('c', 'lost'), biz('d', 'won')],
      [move('c', 'negotiation', 'lost'), move('x', 'research_candidate', 'won')],
    );
    const at = (stage: string) => steps.find((s) => s.stage === stage)!.count;
    expect(at('research_candidate')).toBe(4);
    expect(at('qualified')).toBe(3);
    expect(at('negotiation')).toBe(2);
    expect(at('won')).toBe(1);
    expect(steps.some((s) => s.stage === 'lost' || s.stage === 'archived')).toBe(false);
  });

  it('builds day, week and month buckets that end today', () => {
    const now = new Date('2026-10-21T15:00:00Z');
    const daily = buckets(30, now);
    expect(granularityFor(30)).toBe('day');
    expect(daily).toHaveLength(30);
    expect(daily.at(-1)!.key).toBe('2026-10-21');
    const weekly = buckets(90, now);
    expect(new Date(weekly[0].start).getUTCDay()).toBe(1);
    expect(weekly.at(-1)!.end > now.toISOString()).toBe(true);
    const monthly = buckets(365, now);
    expect(monthly[0].key).toBe('2025-10-01');
    expect(monthly.at(-1)!.label).toBe('Oct 26');
  });

  it('sums values per bucket and series, ignoring rows outside the range', () => {
    const list = buckets(30, new Date('2026-10-21T12:00:00Z'));
    const rows = [
      { at: '2026-10-21T09:00:00Z', p: 'google_places', c: 0.035 },
      { at: '2026-10-21T10:00:00Z', p: 'google_places', c: 0.035 },
      { at: '2026-10-20T10:00:00Z', p: 'anthropic', c: 0.2 },
      { at: '2025-01-01T00:00:00Z', p: 'anthropic', c: 9 },
      { at: '2026-10-21T10:00:00Z', p: 'brave', c: 0.005 },
    ];
    const data = series(rows, list, (r) => r.at, (r) => costGroup(r.p), ['google_places', 'anthropic', 'other'], (r) => r.c);
    expect(data.at(-1)).toMatchObject({ google_places: 0.07, anthropic: 0, other: 0.005 });
    expect(data.at(-2)).toMatchObject({ anthropic: 0.2 });
    expect(data.reduce((s, d) => s + Number(d.anthropic), 0)).toBe(0.2);
  });

  it('groups outcomes and folds small categories into Other', () => {
    expect(outcomeGroup('none_found')).toBe('opportunity');
    expect(outcomeGroup('unhealthy')).toBe('opportunity');
    expect(outcomeGroup('potential_official')).toBe('exists');
    expect(outcomeGroup('insufficient_evidence')).toBe('inconclusive');
    expect(topCounts(['a', 'a', 'b', 'c', 'd'], 2)).toEqual([
      { label: 'a', value: 2 },
      { label: 'b', value: 1 },
      { label: 'Other', value: 2 },
    ]);
  });
});

describe('settings and project services', () => {
  let ctx: ServiceContext;
  beforeEach(() => {
    ctx = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user' };
  });

  it('rejects invalid settings with a readable message', async () => {
    const zero = { ...ctx.settings, scoringWeights: { website: 0, activity: 0, fit: 0, reachability: 0, interest: 0, budget: 0 } };
    await expect(svc.saveSettings(ctx, zero)).rejects.toThrow(/at least one scoring weight/i);
    const badPackage = structuredClone(ctx.settings);
    badPackage.packages[1].lineItems[0].description = '';
    await expect(svc.saveSettings(ctx, badPackage)).rejects.toThrow('Package 2 → line item 1 → description is required.');
    const dupe = structuredClone(ctx.settings);
    dupe.packages[1].key = dupe.packages[0].key;
    await expect(svc.saveSettings(ctx, dupe)).rejects.toThrow(/unique key/);
  });

  it('saves weights and rescores every prospect with them', async () => {
    const before = await ctx.store.listBusinesses();
    const next = { ...ctx.settings, scoringWeights: { website: 100, activity: 0, fit: 0, reachability: 0, interest: 0, budget: 0 } };
    const { rescored, settings } = await svc.saveSettings(ctx, next, { organizationName: 'Kumasi Digital', rescore: true });
    expect(rescored).toBe(before.length);
    expect(settings.scoringWeights.website).toBe(100);
    expect((ctx.store as LocalStore).organizationName()).toBe('Kumasi Digital');
    const after = await ctx.store.listBusinesses();
    const changed = after.filter((b) => b.opportunityScore !== before.find((x) => x.id === b.id)!.opportunityScore);
    expect(changed.length).toBeGreaterThan(0);
    for (const b of after) expect(b.scoreBreakdown!.factors.find((f) => f.factor === 'website')!.weight).toBe(100);
  });

  it('creates a manual project and logs status changes', async () => {
    const [business] = await ctx.store.listBusinesses();
    const project = await svc.createProject(ctx, business, '  Catalogue site  ', 'website');
    expect(project).toMatchObject({ name: 'Catalogue site', status: 'planning', currency: 'GHS', contractValue: null, proposalId: null });
    const updated = await svc.updateProjectDetails(
      ctx,
      project,
      { ...project, status: 'in_progress', contractValue: 12000, startDate: '2026-10-21', dueDate: null, deploymentUrl: null, notes: '' },
      [' Home page ', '', 'Catalogue'],
    );
    expect(updated.deliverables).toEqual(['Home page', 'Catalogue']);
    expect(updated.contractValue).toBe(12000);
    const log = (await ctx.store.listActivities(business.id)).filter((a) => a.type === 'project');
    expect(log.map((a) => a.summary)).toEqual(expect.arrayContaining(['Project created: Catalogue site', 'Catalogue site: Planning → In progress']));
  });
});

describe('settings validation messages', () => {
  it('names the field in plain language', async () => {
    const ctx: ServiceContext = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'u', userLabel: 'u' };
    await expect(svc.saveSettings(ctx, { ...ctx.settings, proposalValidityDays: 0 })).rejects.toThrow('Proposal validity (days) must be at least 1.');
    await expect(svc.saveSettings(ctx, { ...ctx.settings, defaultTaxes: [{ label: 'VAT', ratePercent: Number.NaN }] })).rejects.toThrow('Tax 1 → rate (%) needs a number.');
  });
});
