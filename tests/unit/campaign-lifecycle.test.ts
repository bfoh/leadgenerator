import { describe, expect, it } from 'vitest';
import {
  QUALIFIED_SCORE,
  campaignEditAccess,
  campaignInputSchema,
  campaignPhase,
  campaignScheduleEquals,
  campaignScopeEquals,
  campaignShouldAutoComplete,
  campaignTargetCounts,
  type CampaignTargetCounts,
  type ResearchCampaign,
} from '@/lib/domain/campaigns';

// The campaign's human state, its editable fields and the safe auto-completion rule. These are the
// rules the UI and the API share; the orchestrator tests exercise them against the queue.

function campaign(overrides: Partial<ResearchCampaign> = {}): ResearchCampaign {
  return {
    id: 'c1',
    organizationId: 'o1',
    name: 'Kumasi pharmacies',
    description: null,
    status: 'active',
    providerKey: 'tracked_records',
    scope: { regions: ['Ashanti'], districtCodes: [], towns: [], categories: ['Pharmacy'] },
    batchSize: 10,
    dailyTargetLimit: 50,
    monthlyBudgetUsd: null,
    schedule: { frequency: 'daily', hour: 6, weekday: null, day: null },
    autoComplete: true,
    nextRunAt: '2026-10-25T06:00:00.000Z',
    lastRunAt: '2026-10-24T06:00:00.000Z',
    lastRunStatus: 'succeeded',
    lastRunNote: '2 prospect(s) queued; 0 left for later because research is already in progress.',
    pausedReason: null,
    createdBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function counts(overrides: Partial<CampaignTargetCounts> = {}): CampaignTargetCounts {
  return { queued: 0, researching: 0, researched: 0, qualified: 0, skipped: 0, failed: 0, total: 0, completed: 0, ...overrides };
}

describe('campaign phase', () => {
  it('distinguishes draft, waiting, progress, completion, pause, failure and an empty audience', () => {
    expect(campaignPhase(campaign({ status: 'draft' }), counts())).toMatchObject({ phase: 'draft', label: 'Draft' });
    expect(campaignPhase(campaign(), counts())).toMatchObject({ phase: 'waiting', label: 'Waiting for next run' });
    expect(campaignPhase(campaign(), counts({ researching: 2, total: 2 }))).toMatchObject({ phase: 'researching', label: 'Research in progress' });
    expect(campaignPhase(campaign(), counts({ queued: 1, total: 1 }))).toMatchObject({ phase: 'researching' });
    expect(campaignPhase(campaign(), counts({ researched: 1, qualified: 1, total: 2, completed: 2 }))).toMatchObject({
      phase: 'completed',
      label: 'Research completed',
    });
    expect(campaignPhase(campaign({ status: 'paused' }), counts())).toMatchObject({ phase: 'paused', label: 'Paused' });
    expect(campaignPhase(campaign({ status: 'cancelled' }), counts())).toMatchObject({ phase: 'cancelled' });
    expect(campaignPhase(campaign(), counts({ failed: 1, total: 1 }))).toMatchObject({ phase: 'failed', label: 'Research failed' });
    expect(campaignPhase(campaign({ lastRunStatus: 'failed', lastRunNote: 'The queue was unavailable.' }), counts())).toMatchObject({
      phase: 'failed',
      description: 'The queue was unavailable.',
    });
  });

  it('reports an empty audience only after a run that found no match', () => {
    const empty = campaign({ lastRunStatus: 'skipped', lastRunNote: 'No untargeted prospect matches the scope right now.' });
    expect(campaignPhase(empty, counts())).toMatchObject({ phase: 'no_prospects', label: 'No eligible prospects' });

    const neverRun = campaign({ lastRunAt: null, lastRunStatus: null, lastRunNote: null });
    expect(campaignPhase(neverRun, counts())).toMatchObject({ phase: 'waiting' });
  });

  it('says that a manual campaign waits for a person', () => {
    const manual = campaign({ schedule: { frequency: 'manual', hour: 6, weekday: null, day: null }, nextRunAt: null });
    expect(campaignPhase(manual, counts())).toMatchObject({ phase: 'waiting', description: expect.stringMatching(/Run now/) });
  });
});

describe('campaign editing', () => {
  const idle = { researching: 0, openJobs: 0 };

  it('allows every field while a draft, active or paused campaign is idle', () => {
    for (const status of ['draft', 'active', 'paused'] as const) {
      const access = campaignEditAccess(status, idle);
      expect(access).toMatchObject({ name: true, scope: true, schedule: true, quotas: true, budget: true, autoComplete: true, status: true });
      expect(access.reason).toBeNull();
    }
  });

  it('locks the scope and schedule while research is running, but not the name or limits', () => {
    const access = campaignEditAccess('active', { researching: 1, openJobs: 2 });
    expect(access).toMatchObject({ name: true, quotas: true, budget: true, autoComplete: true, scope: false, schedule: false });
    expect(access.scopeReason).toMatch(/still running/i);
  });

  it('allows no change to a completed or cancelled campaign', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const access = campaignEditAccess(status, idle);
      expect(access).toMatchObject({ name: false, scope: false, schedule: false, quotas: false, budget: false, autoComplete: false, status: false });
      expect(access.reason).toMatch(new RegExp(status, 'i'));
    }
  });

  it('ignores an unchanged scope or schedule sent by the edit form', () => {
    const scope = { regions: ['Ashanti', 'Greater Accra'], districtCodes: ['GH0201'], towns: ['Kumasi'], categories: ['Pharmacy'] };
    expect(campaignScopeEquals(scope, { ...scope, regions: ['Greater Accra', 'Ashanti'], categories: ['pharmacy'] })).toBe(true);
    expect(campaignScopeEquals(scope, { ...scope, towns: [] })).toBe(false);
    const daily = { frequency: 'daily' as const, hour: 6, weekday: null, day: null };
    expect(campaignScheduleEquals(daily, { frequency: 'daily', hour: 6, weekday: 3, day: 9 })).toBe(true);
    expect(campaignScheduleEquals(daily, { frequency: 'daily', hour: 7, weekday: null, day: null })).toBe(false);
    expect(campaignScheduleEquals({ frequency: 'manual', hour: 6, weekday: null, day: null }, { frequency: 'manual', hour: 22, weekday: 1, day: 2 })).toBe(true);
    expect(campaignScheduleEquals({ frequency: 'weekly', hour: 9, weekday: 1, day: null }, { frequency: 'weekly', hour: 9, weekday: 2, day: null })).toBe(false);
  });
});

describe('safe auto-completion', () => {
  it('closes an active finite campaign only when work finished and nothing remains', () => {
    const done = campaignTargetCounts([{ state: 'researched' }, { state: 'qualified' }]);
    expect(campaignShouldAutoComplete(campaign(), done, { untargeted: 0, busy: 0 })).toBe(true);
  });

  it('does not close when the scope is not exhausted, a prospect is busy, or work failed', () => {
    const done = campaignTargetCounts([{ state: 'researched' }]);
    expect(campaignShouldAutoComplete(campaign(), done, { untargeted: 1, busy: 0 })).toBe(false);
    expect(campaignShouldAutoComplete(campaign(), done, { untargeted: 0, busy: 1 })).toBe(false);
    expect(campaignShouldAutoComplete(campaign(), campaignTargetCounts([{ state: 'failed' }]), { untargeted: 0, busy: 0 })).toBe(false);
    expect(campaignShouldAutoComplete(campaign(), campaignTargetCounts([]), { untargeted: 0, busy: 0 })).toBe(false);
    expect(campaignShouldAutoComplete(campaign({ autoComplete: false }), done, { untargeted: 0, busy: 0 })).toBe(false);
    expect(campaignShouldAutoComplete(campaign({ status: 'paused' }), done, { untargeted: 0, busy: 0 })).toBe(false);
    expect(campaignShouldAutoComplete(campaign(), campaignTargetCounts([{ state: 'researching' }]), { untargeted: 0, busy: 0 })).toBe(false);
  });

  it('is on by default and can be switched off', () => {
    const base = {
      name: 'Q4 pharmacies',
      scope: { regions: [], districtCodes: [], towns: [], categories: [] },
      schedule: { frequency: 'manual', hour: 6 },
      batchSize: 5,
      dailyTargetLimit: 20,
    };
    expect(campaignInputSchema.parse(base).autoComplete).toBe(true);
    expect(campaignInputSchema.parse({ ...base, autoComplete: false }).autoComplete).toBe(false);
  });

  it('uses the shared qualification threshold', () => {
    expect(QUALIFIED_SCORE).toBe(50);
  });
});

