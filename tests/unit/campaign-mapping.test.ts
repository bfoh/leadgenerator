import { describe, expect, it } from 'vitest';
import { campaignColumns, campaignFromRow, runFromRow, targetFromRow } from '@/lib/server/campaigns/store';

// The database boundary: snake_case columns in, domain objects out, and only the supplied fields back.

const row = {
  id: 'c1',
  organization_id: 'o1',
  name: 'Q4 pharmacies',
  description: null,
  status: 'active',
  provider_key: 'tracked_records',
  regions: ['Ashanti'],
  district_codes: ['GH0201'],
  towns: ['Kumasi'],
  categories: ['Pharmacy'],
  batch_size: 5,
  daily_target_limit: 20,
  monthly_budget_usd: '10.50',
  schedule_frequency: 'weekly',
  schedule_hour: 9,
  schedule_weekday: 1,
  schedule_day: null,
  auto_complete: false,
  next_run_at: '2026-10-26T09:00:00.000Z',
  last_run_at: null,
  last_run_status: null,
  last_run_note: null,
  paused_reason: null,
  created_by: null,
  created_at: '2026-10-24T00:00:00.000Z',
  updated_at: '2026-10-24T00:00:00.000Z',
};

describe('campaign row mapping', () => {
  it('maps the flattened scope and schedule columns to the domain shape', () => {
    const campaign = campaignFromRow(row);
    expect(campaign).toMatchObject({
      id: 'c1',
      organizationId: 'o1',
      status: 'active',
      providerKey: 'tracked_records',
      batchSize: 5,
      dailyTargetLimit: 20,
      monthlyBudgetUsd: 10.5,
      nextRunAt: '2026-10-26T09:00:00.000Z',
      autoComplete: false,
    });
    expect(campaign.scope).toEqual({ regions: ['Ashanti'], districtCodes: ['GH0201'], towns: ['Kumasi'], categories: ['Pharmacy'] });
    expect(campaign.schedule).toEqual({ frequency: 'weekly', hour: 9, weekday: 1, day: null });
  });

  it('defaults missing scope arrays and a missing budget', () => {
    const campaign = campaignFromRow({ ...row, regions: null, district_codes: null, towns: null, categories: null, monthly_budget_usd: null, auto_complete: null });
    expect(campaign.scope).toEqual({ regions: [], districtCodes: [], towns: [], categories: [] });
    expect(campaign.monthlyBudgetUsd).toBeNull();
    expect(campaign.autoComplete).toBe(true);
  });

  it('writes only the fields a change supplies', () => {
    expect(campaignColumns({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(campaignColumns({ scope: { regions: ['Ashanti'], districtCodes: [] } })).toEqual({ regions: ['Ashanti'], district_codes: [] });
    expect(campaignColumns({ schedule: { frequency: 'monthly', hour: 6, weekday: null, day: 5 } })).toEqual({
      schedule_frequency: 'monthly',
      schedule_hour: 6,
      schedule_weekday: null,
      schedule_day: 5,
    });
    expect(campaignColumns({ status: 'paused', pausedReason: 'Paused by a team member.' })).toEqual({
      status: 'paused',
      paused_reason: 'Paused by a team member.',
    });
    expect(campaignColumns({ autoComplete: false })).toEqual({ auto_complete: false });
  });

  it('maps a campaign target', () => {
    const target = targetFromRow({
      id: 't1',
      organization_id: 'o1',
      campaign_id: 'c1',
      business_id: 'b1',
      state: 'researching',
      match_reason: 'Ashanti · Kumasi',
      source: 'tracked',
      job_id: 'j1',
      note: 'Started',
      added_by: null,
      added_at: '2026-10-24T00:00:00.000Z',
      started_at: '2026-10-24T00:01:00.000Z',
      completed_at: null,
      updated_at: '2026-10-24T00:01:00.000Z',
    });
    expect(target).toMatchObject({
      id: 't1',
      campaignId: 'c1',
      businessId: 'b1',
      state: 'researching',
      matchReason: 'Ashanti · Kumasi',
      jobId: 'j1',
      startedAt: '2026-10-24T00:01:00.000Z',
    });
  });

  it('maps a campaign run and coerces its numbers', () => {
    const run = runFromRow({
      id: 'r1',
      organization_id: 'o1',
      campaign_id: 'c1',
      status: 'succeeded',
      started_at: '2026-10-24T00:00:00.000Z',
      finished_at: '2026-10-24T00:00:02.000Z',
      targets_enqueued: 3,
      targets_completed: 1,
      jobs_open: 2,
      spend_usd: '0.1250',
      note: 'Three added',
      created_at: '2026-10-24T00:00:00.000Z',
    });
    expect(run).toMatchObject({ targetsEnqueued: 3, targetsCompleted: 1, jobsOpen: 2, spendUsd: 0.125, note: 'Three added' });
  });
});
