import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tickCampaign } from '@/lib/server/campaigns/orchestrator';
import { campaignFromRow } from '@/lib/server/campaigns/store';
import { promoteDiscoveredRecord } from '@/lib/server/discovery/service';
import { FakeSupabase } from './fake-supabase';

// Campaign orchestration without a network: the same query shapes the Supabase store uses, driven by
// the in-memory builder. The database's triggers, constraints and RLS are covered by tests/db.

const ORG = '00000000-0000-4000-8000-00000000c001';
const NOW = new Date('2026-10-24T10:00:00.000Z');
const NOW_ISO = NOW.toISOString();

afterEach(() => {
  vi.unstubAllEnvs();
});

type Row = Record<string, unknown>;

class CampaignDb extends FakeSupabase {
  override rpc(name: string, args: Row = {}) {
    if (name === 'campaign_spend') {
      const campaignId = args.p_campaign;
      const jobs = this.rows('automation_jobs');
      const actual = this.rows('agent_runs')
        .filter((run) => jobs.some((job) => job.id === run.job_id && job.campaign_id === campaignId))
        .reduce((sum, run) => sum + (Number(run.estimated_cost_usd) || 0), 0);
      const open = jobs
        .filter((job) => job.campaign_id === campaignId && ['pending', 'running', 'awaiting_approval'].includes(String(job.status)))
        .reduce((sum, job) => sum + (Number(job.estimated_cost_usd) || 0), 0);
      return Promise.resolve({ data: actual + open, error: null });
    }
    if (name === 'enqueue_campaign_job' || name === 'enqueue_automation_job') {
      const key = args.p_idempotency_key as string | null;
      const existing = key
        ? this.rows('automation_jobs').find((job) => job.organization_id === args.p_org && job.idempotency_key === key)
        : undefined;
      if (existing) return Promise.resolve({ data: { created: false, job: structuredClone(existing) }, error: null });
      const job = {
        id: randomUUID(),
        organization_id: args.p_org,
        agent: args.p_agent,
        status: args.p_requires_approval ? 'awaiting_approval' : 'pending',
        priority: args.p_priority ?? 100,
        business_id: args.p_business ?? null,
        payload: args.p_payload ?? {},
        idempotency_key: key ?? null,
        run_after: args.p_run_after ?? NOW_ISO,
        parent_job_id: args.p_parent ?? null,
        trace_id: randomUUID(),
        estimated_cost_usd: args.p_estimated_cost ?? 0,
        max_attempts: 3,
        attempts: 0,
        created_by: null,
        campaign_id: args.p_campaign ?? null,
        campaign_target_id: args.p_campaign_target ?? null,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
        started_at: null,
        finished_at: null,
        last_error: null,
        error_kind: null,
        cancel_requested: false,
      };
      this.rows('automation_jobs').push(job);
      return Promise.resolve({ data: { created: true, job: structuredClone(job) }, error: null });
    }
    return super.rpc(name);
  }
}

function business(id: string, name: string, overrides: Row = {}): Row {
  return {
    id,
    organization_id: ORG,
    name,
    region: 'Ashanti',
    district_code: 'GH0201',
    city: 'Kumasi',
    neighborhood: null,
    category: 'Pharmacy',
    contact_permission: 'unknown',
    merged_into_id: null,
    stage: 'research_candidate',
    business_status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    opportunity_score: null,
    ...overrides,
  };
}

function campaign(overrides: Row = {}): Row {
  return {
    id: 'c1',
    organization_id: ORG,
    name: 'Kumasi pharmacies',
    description: null,
    status: 'active',
    provider_key: 'tracked_records',
    regions: ['Ashanti'],
    district_codes: [],
    towns: [],
    categories: ['Pharmacy'],
    batch_size: 2,
    daily_target_limit: 50,
    monthly_budget_usd: null,
    discovery_enabled: false,
    discovery_daily_limit: 25,
    discovery_total_limit: 100,
    discovery_spend_cap_usd: null,
    discovery_quality_threshold: 60,
    discovery_require_review: true,
    discovery_cursor: null,
    discovery_exhausted: false,
    discovered_total: 0,
    schedule_frequency: 'manual',
    schedule_hour: 6,
    schedule_weekday: null,
    schedule_day: null,
    auto_complete: true,
    next_run_at: null,
    last_run_at: null,
    last_run_status: null,
    last_run_note: null,
    paused_reason: null,
    created_by: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDb(options: { businesses?: Row[]; campaign?: Row; settings?: Row } = {}) {
  const db = new CampaignDb();
  db.tables = {
    automation_settings: [
      {
        organization_id: ORG,
        mode: 'research_only',
        paused: false,
        disabled_agents: [],
        max_concurrent_jobs: 2,
        budgets: {},
        sending_paused: false,
        ...options.settings,
      },
    ],
    businesses: options.businesses ?? [],
    research_campaigns: [options.campaign ?? campaign()],
    campaign_targets: [],
    automation_jobs: [],
    campaign_runs: [],
    agent_runs: [],
    provider_discovery_records: [],
    discovery_runs: [],
    discovery_events: [],
  };
  db.unique = {
    campaign_targets: [['campaign_id', 'business_id']],
    automation_jobs: [['organization_id', 'idempotency_key']],
    provider_discovery_records: [['organization_id', 'provider_key', 'provider_record_id']],
  };
  db.defaults = {
    campaign_targets: {
      state: 'queued',
      source: 'tracked',
      job_id: null,
      note: null,
      match_reason: null,
      added_by: null,
      added_at: NOW_ISO,
      started_at: null,
      completed_at: null,
      updated_at: NOW_ISO,
    },
    campaign_runs: {
      status: 'running',
      started_at: NOW_ISO,
      finished_at: null,
      targets_enqueued: 0,
      targets_completed: 0,
      jobs_open: 0,
      spend_usd: 0,
      note: null,
    },
    automation_jobs: { attempts: 0 },
    discovery_runs: { status: 'running', started_at: NOW_ISO, created_at: NOW_ISO, records_fetched: 0, spend_usd: 0 },
  };
  return db;
}

function savedCampaign(db: CampaignDb) {
  return campaignFromRow(db.rows('research_campaigns')[0]);
}

async function tick(db: CampaignDb, options: { enqueue?: boolean; now?: Date } = {}) {
  return tickCampaign(db.client, ORG, campaignFromRow(db.rows('research_campaigns')[0]), {
    now: options.now ?? NOW,
    ...(options.enqueue === undefined ? {} : { enqueue: options.enqueue }),
  });
}


describe('campaign orchestration', () => {
  it('queues a single-region batch, respects the batch size and attributes every job', async () => {
    const db = makeDb({
      businesses: [
        business('b1', 'Kumasi Pharmacy'),
        business('b2', 'Obuasi Pharmacy', { city: 'Obuasi', district_code: 'GH0202' }),
        business('b3', 'Accra Pharmacy', { region: 'Greater Accra', city: 'Accra', district_code: 'GH0701' }),
        business('b4', 'Kumasi Hotel', { category: 'Hotel' }),
      ],
    });
    const result = await tick(db);

    expect(result).toMatchObject({ status: 'succeeded', enqueued: 2, completed: 0, openJobs: 2 });
    const targets = db.rows('campaign_targets');
    expect(targets).toHaveLength(2);
    expect(targets.map((t) => t.business_id).sort()).toEqual(['b1', 'b2']);
    expect(targets.every((t) => t.state === 'researching' && t.started_at)).toBe(true);
    const jobs = db.rows('automation_jobs');
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.campaign_id === 'c1' && j.campaign_target_id && j.agent === 'business_identity')).toBe(true);
    expect(db.rows('campaign_runs')).toMatchObject([{ status: 'succeeded', targets_enqueued: 2, jobs_open: 2 }]);
    expect(savedCampaign(db)).toMatchObject({ status: 'active', lastRunStatus: 'succeeded' });
    expect(savedCampaign(db).lastRunNote).toMatch(/2 prospect\(s\) queued/);
  });

  it('matches several regions, district and town filters, and never targets an ineligible record', async () => {
    const db = makeDb({
      campaign: campaign({
        regions: ['Ashanti', 'Greater Accra'],
        district_codes: ['GH0201', 'GH0701'],
        towns: ['Kumasi', 'Accra'],
        categories: [],
        batch_size: 10,
      }),
      businesses: [
        business('b1', 'Kumasi Pharmacy'),
        business('b2', 'Kumasi Optician', { category: 'Optician' }),
        business('b3', 'Accra Pharmacy', { region: 'Greater Accra', city: 'Accra', district_code: 'GH0701' }),
        business('b4', 'Obuasi Pharmacy', { city: 'Obuasi', district_code: 'GH0202' }),
        business('b5', 'Opted out', { contact_permission: 'opted_out' }),
        business('b6', 'Archived', { stage: 'archived' }),
        business('b7', 'Inactive', { business_status: 'inactive' }),
        business('b8', 'Merged', { merged_into_id: 'b1' }),
      ],
    });
    const result = await tick(db);

    expect(result.enqueued).toBe(3);
    expect(db.rows('campaign_targets').map((t) => t.business_id).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('treats an empty scope as nationwide', async () => {
    const db = makeDb({
      campaign: campaign({ regions: [], categories: [], batch_size: 10 }),
      businesses: [
        business('b1', 'Kumasi Pharmacy'),
        business('b2', 'Accra Hotel', { region: 'Greater Accra', city: 'Accra', district_code: 'GH0701', category: 'Hotel' }),
        business('b3', 'Tamale School', { region: 'Northern', city: 'Tamale', district_code: 'GH0801', category: 'School' }),
      ],
    });
    expect((await tick(db)).enqueued).toBe(3);
  });

  it('stops at the daily target quota', async () => {
    const db = makeDb({
      campaign: campaign({ daily_target_limit: 1 }),
      businesses: [business('b1', 'Kumasi Pharmacy'), business('b2', 'Obuasi Pharmacy')],
    });
    db.rows('campaign_targets').push({
      id: 't0',
      organization_id: ORG,
      campaign_id: 'c1',
      business_id: 'b0',
      state: 'queued',
      started_at: NOW_ISO,
      updated_at: NOW_ISO,
    });

    const result = await tick(db);
    expect(result).toMatchObject({ status: 'skipped', enqueued: 0 });
    expect(result.note).toMatch(/daily limit/i);
    expect(db.rows('automation_jobs')).toHaveLength(0);
  });

  it('stops at the campaign monthly budget', async () => {
    const db = makeDb({
      campaign: campaign({ monthly_budget_usd: 1 }),
      businesses: [business('b1', 'Kumasi Pharmacy')],
    });
    db.rows('automation_jobs').push({ id: 'oldjob', organization_id: ORG, campaign_id: 'c1', status: 'succeeded', estimated_cost_usd: 0 });
    db.rows('agent_runs').push({ id: 'run1', organization_id: ORG, job_id: 'oldjob', estimated_cost_usd: 1 });

    const result = await tick(db);
    expect(result).toMatchObject({ status: 'skipped', enqueued: 0, spendUsd: 1 });
    expect(result.note).toMatch(/budget/i);
    expect(db.rows('campaign_targets')).toHaveLength(0);
  });

  it('does nothing when the automation queue is paused', async () => {
    const db = makeDb({
      settings: { paused: true },
      businesses: [business('b1', 'Kumasi Pharmacy')],
    });
    const result = await tick(db);
    expect(result).toMatchObject({ status: 'skipped', enqueued: 0 });
    expect(result.note).toMatch(/queue is paused/i);
  });

  it('does not enqueue for a paused or cancelled campaign', async () => {
    for (const status of ['paused', 'cancelled']) {
      const db = makeDb({
        campaign: campaign({ status }),
        businesses: [business('b1', 'Kumasi Pharmacy')],
      });
      const result = await tick(db);
      expect(result).toMatchObject({ status: 'skipped', enqueued: 0 });
      expect(db.rows('campaign_targets')).toHaveLength(0);
    }
  });
});

describe('deduplication, recovery and completion', () => {
  it('never queues the same prospect twice in one campaign or while another campaign researches it', async () => {
    const db = makeDb({
      campaign: campaign({ batch_size: 10 }),
      businesses: [business('b1', 'Kumasi Pharmacy'), business('b2', 'Obuasi Pharmacy')],
    });
    db.rows('campaign_targets').push(
      { id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO },
      { id: 't2', organization_id: ORG, campaign_id: 'c2', business_id: 'b2', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO },
    );
    db.rows('automation_jobs').push(
      { id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'pending' },
      { id: 'j2', organization_id: ORG, campaign_id: 'c2', campaign_target_id: 't2', business_id: 'b2', status: 'running' },
    );

    const result = await tick(db);
    expect(result).toMatchObject({ enqueued: 0, status: 'skipped' });
    expect(result.note).toMatch(/no untargeted prospect/i);
    expect(db.rows('campaign_targets')).toHaveLength(2);
    expect(db.rows('automation_jobs')).toHaveLength(2);
  });

  it('is idempotent across repeated manual ticks', async () => {
    const db = makeDb({ businesses: [business('b1', 'Kumasi Pharmacy'), business('b2', 'Obuasi Pharmacy')] });
    const first = await tick(db);
    const second = await tick(db);

    expect(first.enqueued).toBe(2);
    expect(second.enqueued).toBe(0);
    expect(db.rows('campaign_targets')).toHaveLength(2);
    expect(db.rows('automation_jobs')).toHaveLength(2);
    expect(new Set(db.rows('automation_jobs').map((j) => j.idempotency_key)).size).toBe(2);
  });

  it('queues one batch when two manual ticks race', async () => {
    const db = makeDb({ businesses: [business('b1', 'Kumasi Pharmacy'), business('b2', 'Obuasi Pharmacy')] });
    const [a, b] = await Promise.all([tick(db), tick(db)]);

    expect(a.enqueued + b.enqueued).toBe(2);
    expect(db.rows('campaign_targets')).toHaveLength(2);
    expect(db.rows('automation_jobs')).toHaveLength(2);
  });

  it('reconciles succeeded, failed and vanished chains, and resumes a queued membership', async () => {
    const db = makeDb({
      campaign: campaign({ batch_size: 10 }),
      businesses: [
        business('b1', 'Finished Pharmacy', { opportunity_score: 70 }),
        business('b2', 'Failed Pharmacy'),
        business('b3', 'Queued Pharmacy'),
      ],
    });
    db.rows('campaign_targets').push(
      { id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO },
      { id: 't2', organization_id: ORG, campaign_id: 'c1', business_id: 'b2', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO },
      { id: 't3', organization_id: ORG, campaign_id: 'c1', business_id: 'b3', state: 'queued', updated_at: NOW_ISO },
    );
    db.rows('automation_jobs').push(
      { id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'succeeded' },
      { id: 'j2', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't2', business_id: 'b2', status: 'failed', last_error: 'No budget for Brave Search' },
    );

    const result = await tick(db);
    const byId = new Map(db.rows('campaign_targets').map((t) => [t.id, t]));
    expect(byId.get('t1')?.state).toBe('qualified');
    expect(byId.get('t2')).toMatchObject({ state: 'failed', note: 'No budget for Brave Search' });
    expect(byId.get('t3')?.state).toBe('researching');
    expect(result).toMatchObject({ enqueued: 1, completed: 1 });
    expect(db.rows('automation_jobs').find((j) => j.campaign_target_id === 't3')?.idempotency_key).toBe('campaign:c1:b3:identity');
  });
});


describe('auto-completion', () => {
  it('completes a finite campaign when the last chain succeeds and no prospect is left', async () => {
    const db = makeDb({ businesses: [business('b1', 'Finished Pharmacy', { opportunity_score: 70 })] });
    db.rows('campaign_targets').push({ id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO });
    db.rows('automation_jobs').push({ id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'succeeded' });

    const result = await tick(db);
    expect(result).toMatchObject({ status: 'succeeded', completed: 1 });
    expect(savedCampaign(db)).toMatchObject({ status: 'completed', nextRunAt: null });
    expect(savedCampaign(db).lastRunNote).toMatch(/scope exhausted/i);
    expect(db.rows('campaign_runs')[0]).toMatchObject({ status: 'succeeded', targets_completed: 1 });
  });

  it('stays open when a prospect remains', async () => {
    const db = makeDb({
      campaign: campaign({ batch_size: 10 }),
      businesses: [business('b1', 'Finished Pharmacy', { opportunity_score: 70 }), business('b2', 'Second Pharmacy')],
    });
    db.rows('campaign_targets').push({ id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO });
    db.rows('automation_jobs').push({ id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'succeeded' });

    const result = await tick(db);
    expect(result.enqueued).toBe(1);
    expect(savedCampaign(db).status).toBe('active');
  });

  it('stays open when auto-complete is switched off', async () => {
    const db = makeDb({ campaign: campaign({ auto_complete: false }), businesses: [business('b1', 'Finished Pharmacy', { opportunity_score: 70 })] });
    db.rows('campaign_targets').push({ id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO });
    db.rows('automation_jobs').push({ id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'succeeded' });

    await tick(db);
    expect(savedCampaign(db).status).toBe('active');
    expect(savedCampaign(db).lastRunNote).not.toMatch(/scope exhausted/i);
  });

  it('stays open when a target failed, so it can be retried', async () => {
    const db = makeDb({ businesses: [business('b1', 'Failed Pharmacy')] });
    db.rows('campaign_targets').push({ id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO });
    db.rows('automation_jobs').push({ id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'failed', last_error: 'Web check failed' });

    await tick(db);
    expect(savedCampaign(db).status).toBe('active');
    expect(savedCampaign(db).lastRunNote).not.toMatch(/scope exhausted/i);
  });

  it('records an empty audience without completing the campaign', async () => {
    const db = makeDb({ campaign: campaign({ regions: ['Volta'], categories: [] }), businesses: [business('b1', 'Kumasi Pharmacy')] });
    const result = await tick(db);

    expect(result).toMatchObject({ status: 'skipped', enqueued: 0 });
    expect(result.note).toMatch(/no untargeted prospect/i);
    expect(db.rows('campaign_runs')).toMatchObject([{ status: 'skipped' }]);
    expect(savedCampaign(db)).toMatchObject({ status: 'active' });
  });
});


describe('scheduled runs', () => {
  it('claims a due run once under concurrent workers, then waits for the next schedule', async () => {
    const db = makeDb({
      campaign: campaign({ schedule_frequency: 'daily', schedule_hour: 6, next_run_at: '2026-10-24T09:00:00.000Z', batch_size: 10 }),
      businesses: [business('b1', 'Kumasi Pharmacy'), business('b2', 'Obuasi Pharmacy')],
    });
    const [first, second] = await Promise.all([tick(db), tick(db)]);

    expect(first.enqueued + second.enqueued).toBe(2);
    expect([first, second].filter((result) => /another worker/i.test(result.note))).toHaveLength(1);
    expect(db.rows('automation_jobs')).toHaveLength(2);
    expect(savedCampaign(db).nextRunAt).toBe('2026-10-25T06:00:00.000Z');

    const later = await tick(db);
    expect(later.enqueued).toBe(0);
    expect(db.rows('automation_jobs')).toHaveLength(2);
  });

  it('does not run before the scheduled time but still reconciles finished work', async () => {
    const db = makeDb({
      campaign: campaign({ schedule_frequency: 'weekly', schedule_weekday: 1, schedule_hour: 9, next_run_at: '2026-10-26T09:00:00.000Z' }),
      businesses: [business('b1', 'Kumasi Pharmacy'), business('b2', 'Second Pharmacy')],
    });
    db.rows('campaign_targets').push({ id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO });
    db.rows('automation_jobs').push({ id: 'j1', organization_id: ORG, campaign_id: 'c1', campaign_target_id: 't1', business_id: 'b1', status: 'succeeded' });

    const result = await tick(db);
    expect(result).toMatchObject({ status: 'skipped', enqueued: 0, completed: 1 });
    expect(db.rows('campaign_targets')[0].state).toBe('researched');
    expect(savedCampaign(db)).toMatchObject({ status: 'active', nextRunAt: '2026-10-26T09:00:00.000Z' });
  });
});


describe('human review and eligibility', () => {
  it('waits while a job needs human approval and never completes the campaign', async () => {
    const db = makeDb({ businesses: [business('b1', 'Needs Review Pharmacy')] });
    db.rows('campaign_targets').push({ id: 't1', organization_id: ORG, campaign_id: 'c1', business_id: 'b1', state: 'researching', started_at: NOW_ISO, updated_at: NOW_ISO });
    db.rows('automation_jobs').push({
      id: 'j1',
      organization_id: ORG,
      campaign_id: 'c1',
      campaign_target_id: 't1',
      business_id: 'b1',
      status: 'awaiting_approval',
    });

    const result = await tick(db);
    expect(result).toMatchObject({ status: 'skipped', enqueued: 0, completed: 0, openJobs: 1 });
    expect(db.rows('campaign_targets')[0].state).toBe('researching');
    expect(savedCampaign(db).status).toBe('active');
  });

  it('never starts research for opted-out, merged, archived or inactive prospects', async () => {
    const db = makeDb({
      campaign: campaign({ regions: [], categories: [], batch_size: 10 }),
      businesses: [
        business('b1', 'Eligible Pharmacy'),
        business('b2', 'Opted out', { contact_permission: 'opted_out' }),
        business('b3', 'Merged', { merged_into_id: 'b1' }),
        business('b4', 'Archived', { stage: 'archived' }),
        business('b5', 'Inactive', { business_status: 'inactive' }),
      ],
    });
    expect((await tick(db)).enqueued).toBe(1);
    expect(db.rows('campaign_targets').map((target) => target.business_id)).toEqual(['b1']);
  });
});


describe('autonomous discovery in a campaign', () => {
  it('stages a page, suppresses a repeat, and researches a promoted record on the next tick', async () => {
    vi.stubEnv('DISCOVERY_SYNTHETIC_PROVIDER', 'true');
    const db = makeDb({
      campaign: campaign({
        provider_key: 'offline_synthetic',
        discovery_enabled: true,
        discovery_daily_limit: 2,
        discovery_total_limit: 10,
        regions: ['Ashanti'],
        categories: ['Pharmacy'],
        batch_size: 2,
      }),
    });

    const first = await tick(db);
    expect(first).toMatchObject({ status: 'succeeded', enqueued: 0 });
    expect(first.note).toMatch(/2 record\(s\) read/);
    expect(db.rows('provider_discovery_records')).toHaveLength(2);
    expect(db.rows('provider_discovery_records').every((row) => row.status === 'pending_review')).toBe(true);
    expect(savedCampaign(db).discovery.discoveredTotal).toBe(2);
    expect(savedCampaign(db).discovery.cursor).toBeTruthy();

    // The same page would be skipped as duplicates, but the campaign's cursor already moved on.
    const record = db.rows('provider_discovery_records')[0];
    const { businessId } = await promoteDiscoveredRecord(db.client, {
      organizationId: ORG,
      recordId: String(record.id),
      actorId: null,
      note: 'Reviewed by the owner.',
    });

    const second = await tick(db);
    expect(second.enqueued).toBe(1);
    expect(db.rows('campaign_targets')).toHaveLength(1);
    expect(db.rows('campaign_targets')[0].business_id).toBe(businessId);
    expect(db.rows('automation_jobs')).toHaveLength(1);
    // The daily discovery limit was reached after the first page, so no second provider call.
    expect(db.rows('discovery_runs')).toHaveLength(1);
  });

  it('refuses to run a campaign whose synthetic connector is disabled', async () => {
    const db = makeDb({
      campaign: campaign({ provider_key: 'offline_synthetic', discovery_enabled: true, regions: ['Ashanti'], categories: ['Pharmacy'] }),
    });
    const result = await tick(db);
    expect(result).toMatchObject({ status: 'skipped', enqueued: 0 });
    expect(result.note).toMatch(/disabled/i);
    expect(db.rows('provider_discovery_records')).toHaveLength(0);
  });
});

