import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '@/lib/domain/districts';
import { as, createDatabase, createUser, rows } from './harness';

// Milestone 2 at the database boundary: the district reference data, the region/district location
// model, campaign membership (many-to-many, history, per-campaign state), row-level security, job
// attribution, campaign spend, and both rollbacks.

const OWNER = '00000000-0000-4000-8000-00000000e0a1';
const RESEARCHER = '00000000-0000-4000-8000-00000000e0a2';
const OUTSIDER = '00000000-0000-4000-8000-00000000e0a3';

const readRollback = (file: string) => readFileSync(join(process.cwd(), 'supabase', 'rollback', file), 'utf8');

async function workspace() {
  const db = await createDatabase();
  await createUser(db, OWNER, 'owner@campaigns.example');
  await createUser(db, RESEARCHER, 'researcher@campaigns.example');
  await createUser(db, OUTSIDER, 'outsider@campaigns.example');
  const [{ org_id: org }] = await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
  await db.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'researcher') on conflict do nothing`, [org, RESEARCHER]);
  const [{ org_id: other }] = await as(db, OUTSIDER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
  return { db, org, other };
}

async function createBusiness(db: PGlite, org: string, name: string, extra: Record<string, unknown> = {}) {
  const columns = ['organization_id', 'name', 'category', 'city', 'contact_permission', 'stage', ...Object.keys(extra)];
  const values = [org, name, 'Pharmacy', 'Kumasi', 'unknown', 'research_candidate', ...Object.values(extra)];
  const [row] = await as(db, OWNER, () =>
    rows<{ id: string }>(db, `insert into public.businesses (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, values),
  );
  return row.id;
}

async function createCampaign(db: PGlite, org: string, name: string, options: { status?: string; provider?: string; regions?: string[] } = {}) {
  const [row] = await as(db, OWNER, () =>
    rows<{ id: string }>(
      db,
      `insert into public.research_campaigns
        (organization_id, name, status, provider_key, regions, categories, batch_size, daily_target_limit, schedule_frequency, schedule_hour, next_run_at)
       values ($1, $2, $3, $4, $5, '{Pharmacy}', 5, 20, 'daily', 6, now() + interval '1 hour')
       returning id`,
      [org, name, options.status ?? 'active', options.provider ?? 'tracked_records', options.regions ?? []],
    ),
  );
  return row.id;
}

describe('district and region reference data', () => {
  it('matches the verified TypeScript list exactly (261 districts, 16 regions)', async () => {
    const db = await createDatabase();
    const stored = await rows<{ code: string; name: string; region: string; source_name: string | null }>(
      db,
      'select code, name, region, source_name from public.ghana_districts order by code',
    );
    const expected = [...DISTRICTS].sort((a, b) => a.code.localeCompare(b.code));
    expect(stored).toHaveLength(261);
    expect(stored.map((d) => d.code)).toEqual(expected.map((d) => d.code));
    expect(stored.map((d) => d.name)).toEqual(expected.map((d) => d.name));
    expect(stored.map((d) => d.region)).toEqual(expected.map((d) => d.region));
    expect(stored.map((d) => d.source_name)).toEqual(expected.map((d) => d.sourceName ?? null));

    const regions = await rows<{ code: string; name: string }>(db, 'select code, name from public.ghana_regions order by code');
    expect(regions).toHaveLength(16);
    expect(regions.map((r) => r.name).sort()).toEqual([...new Set(DISTRICTS.map((d) => d.region))].sort());
    expect(regions.find((r) => r.name === 'Oti')?.code).toBe('GH10');
    expect(regions.find((r) => r.name === 'Northern')?.code).toBe('GH08');
  });

  it('is read-only to signed-in users', async () => {
    const { db } = await workspace();
    const visible = await as(db, OWNER, () => rows(db, 'select code from public.ghana_districts limit 3'));
    expect(visible).toHaveLength(3);
    await expect(as(db, OWNER, () => db.query(`update public.ghana_districts set name = 'Changed'`))).rejects.toThrow();
  });
});

describe('region-level business records (migration 010)', () => {
  it('accepts a district without a town and fills in the region', async () => {
    const { db, org } = await workspace();
    const [created] = await as(db, OWNER, () =>
      rows<{ id: string; region: string | null; city: string | null }>(
        db,
        `insert into public.businesses (organization_id, name, category, district_code, contact_permission)
         values ($1, 'District Only', 'Pharmacy', 'GH0201', 'unknown') returning id, region, city`,
        [org],
      ),
    );
    expect(created.region).toBe('Ashanti');
    expect(created.city).toBeNull();
  });

  it('accepts a region without a town, and refuses a record with no place at all', async () => {
    const { db, org } = await workspace();
    await as(db, OWNER, () =>
      db.query(
        `insert into public.businesses (organization_id, name, category, region, contact_permission) values ($1, 'Region Only', 'Pharmacy', 'Ashanti', 'unknown')`,
        [org],
      ),
    );
    await expect(
      as(db, OWNER, () =>
        db.query(`insert into public.businesses (organization_id, name, category, contact_permission) values ($1, 'Nowhere', 'Pharmacy', 'unknown')`, [org]),
      ),
    ).rejects.toThrow(/businesses_location_known/);
  });

  it('refuses a district that contradicts the region, and an unknown district code', async () => {
    const { db, org } = await workspace();
    await expect(
      as(db, OWNER, () =>
        db.query(
          `insert into public.businesses (organization_id, name, category, region, district_code, contact_permission)
           values ($1, 'Wrong Region', 'Pharmacy', 'Greater Accra', 'GH0201', 'unknown')`,
          [org],
        ),
      ),
    ).rejects.toThrow(/is in Ashanti, not Greater Accra/);
    await expect(
      as(db, OWNER, () =>
        db.query(
          `insert into public.businesses (organization_id, name, category, region, district_code, contact_permission)
           values ($1, 'Bad District', 'Pharmacy', 'Ashanti', 'GH9999', 'unknown')`,
          [org],
        ),
      ),
    ).rejects.toThrow(/Unknown district code/);
  });
});

describe('campaign membership and per-campaign state', () => {
  it('lets one prospect belong to several campaigns without losing either membership', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'Kumasi Pharmacy');
    const first = await createCampaign(db, org, 'Campaign one');
    const second = await createCampaign(db, org, 'Campaign two');
    for (const campaignId of [first, second]) {
      await as(db, OWNER, () =>
        db.query(`insert into public.campaign_targets (organization_id, campaign_id, business_id, match_reason) values ($1, $2, $3, 'Ashanti · Kumasi')`, [
          org,
          campaignId,
          businessId,
        ]),
      );
    }
    const memberships = await rows(db, 'select campaign_id from public.campaign_targets where business_id = $1', [businessId]);
    expect(memberships).toHaveLength(2);

    await expect(
      as(db, OWNER, () =>
        db.query(`insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3)`, [org, first, businessId]),
      ),
    ).rejects.toThrow(/duplicate key|already exists/i);
  });

  it('records history and enforces the per-campaign state machine', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'State Pharmacy');
    const campaignId = await createCampaign(db, org, 'State campaign');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(
        db,
        `insert into public.campaign_targets (organization_id, campaign_id, business_id, match_reason) values ($1, $2, $3, 'Ashanti · Kumasi') returning id`,
        [org, campaignId, businessId],
      ),
    );
    for (const state of ['researching', 'researched', 'qualified']) {
      await as(db, OWNER, () => db.query(`update public.campaign_targets set state = $1 where id = $2`, [state, target.id]));
    }
    const events = await rows<{ event: string }>(db, 'select event from public.campaign_target_events where target_id = $1 order by created_at, event', [target.id]);
    expect(events.map((e) => e.event)).toEqual(['added', 'researching', 'researched', 'qualified']);

    await expect(as(db, OWNER, () => db.query(`update public.campaign_targets set state = 'researching' where id = $1`, [target.id]))).rejects.toThrow(
      /cannot move from qualified to researching/,
    );
    // A failure is recorded on a live target and may be queued again.
    const secondBusiness = await createBusiness(db, org, 'State Pharmacy two');
    const [second] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        campaignId,
        secondBusiness,
      ]),
    );
    await as(db, OWNER, () => db.query(`update public.campaign_targets set state = 'researching' where id = $1`, [second.id]));
    await as(db, OWNER, () => db.query(`update public.campaign_targets set state = 'failed', note = 'Job failed' where id = $1`, [second.id]));
    await as(db, OWNER, () => db.query(`update public.campaign_targets set state = 'queued' where id = $1`, [second.id]));
    const [state] = await rows<{ state: string }>(db, 'select state from public.campaign_targets where id = $1', [second.id]);
    expect(state.state).toBe('queued');
  });

  it('keeps the membership history append-only', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'History Pharmacy');
    const campaignId = await createCampaign(db, org, 'History campaign');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        campaignId,
        businessId,
      ]),
    );
    const before = await rows<{ id: string; detail: string | null }>(db, 'select id, detail from public.campaign_target_events where target_id = $1', [target.id]);
    expect(before).toHaveLength(1);
    await expect(as(db, OWNER, () => db.query(`update public.campaign_target_events set detail = 'changed' where target_id = $1`, [target.id]))).rejects.toThrow(
      /permission denied|row-level security/i,
    );
    await expect(as(db, OWNER, () => db.query(`delete from public.campaign_target_events where target_id = $1`, [target.id]))).rejects.toThrow(
      /permission denied|row-level security/i,
    );
    const after = await rows<{ id: string; detail: string | null }>(db, 'select id, detail from public.campaign_target_events where target_id = $1', [target.id]);
    expect(after).toEqual(before);
  });
});

describe('campaign permissions and lifecycle', () => {
  it('lets members read campaigns but only owners and admins create or change them', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'Permission Pharmacy');
    const campaignId = await createCampaign(db, org, 'Permission campaign');
    expect(await as(db, RESEARCHER, () => rows(db, 'select id from public.research_campaigns'))).toHaveLength(1);
    await expect(
      as(db, RESEARCHER, () => db.query(`insert into public.research_campaigns (organization_id, name) values ($1, 'Researcher campaign')`, [org])),
    ).rejects.toThrow(/row-level security/i);
    expect(await as(db, OUTSIDER, () => rows(db, 'select id from public.research_campaigns'))).toHaveLength(0);

    await as(db, RESEARCHER, () =>
      db.query(`insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3)`, [org, campaignId, businessId]),
    );
    await expect(
      as(db, OUTSIDER, () =>
        db.query(`insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3)`, [org, campaignId, businessId]),
      ),
    ).rejects.toThrow();
  });

  it('moves a campaign only along the documented paths', async () => {
    const { db, org } = await workspace();
    const campaignId = await createCampaign(db, org, 'Lifecycle', { status: 'draft' });
    for (const status of ['active', 'paused', 'active', 'completed']) {
      await as(db, OWNER, () => db.query(`update public.research_campaigns set status = $1 where id = $2`, [status, campaignId]));
    }
    await expect(as(db, OWNER, () => db.query(`update public.research_campaigns set status = 'active' where id = $1`, [campaignId]))).rejects.toThrow(
      /cannot move from completed to active/,
    );
  });

  it('refuses Google Places as a campaign provider', async () => {
    const { db, org } = await workspace();
    await expect(createCampaign(db, org, 'Places harvest', { provider: 'google_places' })).rejects.toThrow(/research_campaigns_unattended_provider/);
  });
});

describe('campaign job attribution and spend', () => {
  const enqueue = (db: PGlite, org: string, businessId: string, campaignId: string, targetId: string, key: string, estimated = 0) =>
    as(db, OWNER, () =>
      rows<{ body: { created: boolean; job: { id: string; campaign_id: string | null; campaign_target_id: string | null } } }>(
        db,
        `select public.enqueue_campaign_job($1, 'business_identity', $2, '{}'::jsonb, $3, 100, null, null, false, $4, 3, $5, $6) as body`,
        [org, businessId, key, estimated, campaignId, targetId],
      ),
    );

  it('stores the campaign on the job and refuses a target from another campaign', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'Job Pharmacy');
    const first = await createCampaign(db, org, 'Job campaign one');
    const second = await createCampaign(db, org, 'Job campaign two');
    const [targetOne] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        first,
        businessId,
      ]),
    );
    const [targetTwo] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        second,
        businessId,
      ]),
    );

    const [enqueued] = await enqueue(db, org, businessId, first, targetOne.id, 'campaign-job-1');
    expect(enqueued.body.created).toBe(true);
    expect(enqueued.body.job.campaign_id).toBe(first);
    expect(enqueued.body.job.campaign_target_id).toBe(targetOne.id);

    const [again] = await enqueue(db, org, businessId, first, targetOne.id, 'campaign-job-1');
    expect(again.body.created).toBe(false);

    await expect(enqueue(db, org, businessId, first, targetTwo.id, 'campaign-job-2')).rejects.toThrow(/does not belong to this campaign/);
  });

  it('sums actual run cost and open job estimates, and hides another workspace', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'Spend Pharmacy');
    const campaignId = await createCampaign(db, org, 'Spend campaign');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        campaignId,
        businessId,
      ]),
    );
    const [finished] = await enqueue(db, org, businessId, campaignId, target.id, 'campaign-spend-1');
    await as(db, OWNER, () =>
      db.query(
        `insert into public.agent_runs (organization_id, job_id, business_id, agent, agent_version, status, summary, started_at, finished_at, estimated_cost_usd)
         values ($1, $2, $3, 'business_identity', 'test-1', 'succeeded', 'Identity checked', now(), now(), 0.5)`,
        [org, finished.body.job.id, businessId],
      ),
    );
    await enqueue(db, org, businessId, campaignId, target.id, 'campaign-spend-2', 0.25);

    const [spend] = await as(db, OWNER, () => rows<{ spend: string }>(db, 'select public.campaign_spend($1)::text as spend', [campaignId]));
    expect(Number(spend.spend)).toBeCloseTo(0.75, 4);
    const [hidden] = await as(db, OUTSIDER, () => rows<{ spend: string }>(db, 'select public.campaign_spend($1)::text as spend', [campaignId]));
    expect(Number(hidden.spend)).toBe(0);
  });
});

describe('rolling back migrations 009 and 010', () => {
  it('protects records that need a town, then restores the previous schema and can re-apply', async () => {
    const { db, org } = await workspace();
    await as(db, OWNER, () =>
      db.query(
        `insert into public.businesses (organization_id, name, category, district_code, contact_permission) values ($1, 'District Only', 'Pharmacy', 'GH0201', 'unknown')`,
        [org],
      ),
    );
    await expect(db.exec(readRollback('010_region_records_down.sql'))).rejects.toThrow(/no town/i);

    await db.query(`update public.businesses set city = 'Kumasi' where city is null`);
    await db.exec(readRollback('010_region_records_down.sql'));
    await db.exec(readRollback('009_research_campaigns_down.sql'));

    expect((await rows<{ t: string | null }>(db, `select to_regclass('public.research_campaigns') as t`))[0].t).toBeNull();
    expect((await rows<{ t: string | null }>(db, `select to_regclass('public.ghana_districts') as t`))[0].t).toBeNull();
    const columns = await rows(
      db,
      `select column_name from information_schema.columns
       where table_schema = 'public' and column_name in ('campaign_id', 'campaign_target_id', 'district_code')`,
    );
    expect(columns).toEqual([]);
    const [city] = await rows<{ is_nullable: string }>(
      db,
      `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'city'`,
    );
    expect(city.is_nullable).toBe('NO');
    const functions = await rows<{ proname: string; pronargs: number }>(db, `select proname, pronargs from pg_proc where proname in ('enqueue_automation_job', 'enqueue_campaign_job')`);
    expect(functions).toEqual([{ proname: 'enqueue_automation_job', pronargs: 11 }]);

    // Both migrations are re-runnable after a rollback.
    const migrations = join(process.cwd(), 'supabase', 'migrations');
    await db.exec(readFileSync(join(migrations, '009_research_campaigns.sql'), 'utf8'));
    await db.exec(readFileSync(join(migrations, '010_region_records.sql'), 'utf8'));
    expect((await rows<{ t: string | null }>(db, `select to_regclass('public.research_campaigns') as t`))[0].t).toBe('research_campaigns');
    expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.ghana_districts'))[0].n).toBe(261);
  });
});






describe('migration acceptance: idempotency and existing data', () => {
  const migration = (file: string) => readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');

  it('re-applies 009 and 010 on a populated database without losing or duplicating anything', async () => {
    const { db, org } = await workspace();
    const businessId = await createBusiness(db, org, 'Repeat Pharmacy');
    const campaignId = await createCampaign(db, org, 'Repeat campaign');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(
        db,
        `insert into public.campaign_targets (organization_id, campaign_id, business_id, match_reason)
         values ($1, $2, $3, 'Ashanti · Kumasi') returning id`,
        [org, campaignId, businessId],
      ),
    );
    await as(db, OWNER, () => db.query(`update public.campaign_targets set state = 'researching' where id = $1`, [target.id]));
    const before = {
      events: (await rows<{ n: number }>(db, 'select count(*)::int as n from public.campaign_target_events'))[0].n,
      districts: (await rows<{ n: number }>(db, 'select count(*)::int as n from public.ghana_districts'))[0].n,
    };

    await db.exec(migration('009_research_campaigns.sql'));
    await db.exec(migration('010_region_records.sql'));

    expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.research_campaigns'))[0].n).toBe(1);
    expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.campaign_targets'))[0].n).toBe(1);
    expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.campaign_target_events'))[0].n).toBe(before.events);
    expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.ghana_districts'))[0].n).toBe(before.districts);
    expect((await rows<{ state: string }>(db, 'select state from public.campaign_targets where id = $1', [target.id]))[0].state).toBe('researching');
    expect((await rows<{ auto_complete: boolean }>(db, 'select auto_complete from public.research_campaigns where id = $1', [campaignId]))[0].auto_complete).toBe(true);
  });

  it('adds campaigns and districts to a database that already holds prospects and jobs', async () => {
    const db = await createDatabase({ skip: ['009', '010'] });
    await createUser(db, OWNER, 'owner@existing.example');
    const [{ org_id: org }] = await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
    const [business] = await as(db, OWNER, () =>
      rows<{ id: string; city: string | null }>(
        db,
        `insert into public.businesses (organization_id, name, category, city, contact_permission, stage)
         values ($1, 'Existing Pharmacy', 'Pharmacy', 'Kumasi', 'unknown', 'research_candidate') returning id, city`,
        [org],
      ),
    );
    const [job] = await rows<{ id: string }>(db, `insert into public.automation_jobs (organization_id, agent) values ($1, 'website_verification') returning id`, [org]);

    await db.exec(migration('009_research_campaigns.sql'));
    await db.exec(migration('010_region_records.sql'));

    expect(
      (await rows<{ city: string | null; district_code: string | null }>(db, 'select city, district_code from public.businesses where id = $1', [business.id]))[0],
    ).toEqual({ city: 'Kumasi', district_code: null });
    expect((await rows<{ campaign_id: string | null }>(db, 'select campaign_id from public.automation_jobs where id = $1', [job.id]))[0].campaign_id).toBeNull();

    const campaignId = await createCampaign(db, org, 'After upgrade');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        campaignId,
        business.id,
      ]),
    );
    const [created] = await as(db, OWNER, () =>
      rows<{ body: { created: boolean; job: { campaign_id: string } } }>(
        db,
        `select public.enqueue_campaign_job($1, 'business_identity', $2, '{}'::jsonb, 'acceptance:existing', 100, null, null, false, 0, 3, $3, $4) as body`,
        [org, business.id, campaignId, target.id],
      ),
    );
    expect(created.body.created).toBe(true);
    expect(created.body.job.campaign_id).toBe(campaignId);
  });

  it('stores the auto-complete preference and defaults it on', async () => {
    const { db, org } = await workspace();
    const [row] = await as(db, OWNER, () =>
      rows<{ auto_complete: boolean }>(db, `insert into public.research_campaigns (organization_id, name) values ($1, 'Auto') returning auto_complete`, [org]),
    );
    expect(row.auto_complete).toBe(true);
    await as(db, OWNER, () => db.query('update public.research_campaigns set auto_complete = false where organization_id = $1', [org]));
    expect(
      (await rows<{ auto_complete: boolean }>(db, 'select auto_complete from public.research_campaigns where organization_id = $1', [org]))[0].auto_complete,
    ).toBe(false);
  });
});


describe('campaign security boundaries', () => {
  it('keeps targets, runs and history inside the workspace that owns them', async () => {
    const { db, org, other } = await workspace();
    const businessId = await createBusiness(db, org, 'Owner Pharmacy');
    const campaignId = await createCampaign(db, org, 'Owner campaign');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [org, campaignId, businessId]),
    );
    await as(db, OWNER, () =>
      db.query(`insert into public.campaign_runs (organization_id, campaign_id, status) values ($1, $2, 'succeeded')`, [org, campaignId]),
    );
    const [outsiderCampaign] = await as(db, OUTSIDER, () =>
      rows<{ id: string }>(db, `insert into public.research_campaigns (organization_id, name) values ($1, 'Outsider campaign') returning id`, [other]),
    );

    for (const table of ['campaign_targets', 'campaign_runs', 'campaign_target_events']) {
      expect(await as(db, OUTSIDER, () => rows(db, `select 1 from public.${table} where campaign_id = $1`, [campaignId]))).toHaveLength(0);
    }
    await expect(
      as(db, OUTSIDER, () =>
        db.query(`insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3)`, [other, campaignId, businessId]),
      ),
    ).rejects.toThrow();
    await expect(
      as(db, OUTSIDER, () =>
        db.query(`insert into public.campaign_runs (organization_id, campaign_id, status) values ($1, $2, 'running')`, [other, campaignId]),
      ),
    ).rejects.toThrow();
    expect((await rows<{ id: string }>(db, 'select id from public.campaign_targets where id = $1', [target.id]))[0].id).toBe(target.id);
    expect((await rows<{ id: string }>(db, 'select id from public.research_campaigns where id = $1', [outsiderCampaign.id]))[0].id).toBe(outsiderCampaign.id);
  });

  it('runs the campaign functions as the definer with an empty search path', async () => {
    const db = await createDatabase();
    const functions = await rows<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      db,
      `select proname, prosecdef, proconfig from pg_proc where proname in ('enqueue_campaign_job', 'log_campaign_target_event', 'campaign_spend') order by proname`,
    );
    expect(functions).toHaveLength(3);
    for (const fn of functions) {
      if (fn.proname === 'campaign_spend') {
        expect(fn.prosecdef).toBe(false);
      } else {
        expect(fn.prosecdef).toBe(true);
      }
      expect((fn.proconfig ?? []).join(',')).toMatch(/search_path/);
    }
  });

  it('refuses a campaign target that belongs to a different prospect', async () => {
    const { db, org } = await workspace();
    const first = await createBusiness(db, org, 'First Pharmacy');
    const second = await createBusiness(db, org, 'Second Pharmacy');
    const campaignId = await createCampaign(db, org, 'Mismatch campaign');
    const [target] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.campaign_targets (organization_id, campaign_id, business_id) values ($1, $2, $3) returning id`, [
        org,
        campaignId,
        first,
      ]),
    );
    await expect(
      as(db, OWNER, () =>
        db.query(`select public.enqueue_campaign_job($1, 'business_identity', $2, '{}'::jsonb, 'mismatch', 100, null, null, false, 0, 3, $3, $4)`, [
          org,
          second,
          campaignId,
          target.id,
        ]),
      ),
    ).rejects.toThrow(/does not belong to this campaign and prospect/);
  });
});

