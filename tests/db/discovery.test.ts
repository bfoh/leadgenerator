import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Migration 011 at the database boundary: quarantine, provenance, review transitions, append-only
// audit, retention, campaign controls and cross-workspace isolation.

const OWNER = '00000000-0000-4000-8000-00000000f0a1';
const ADMIN = '00000000-0000-4000-8000-00000000f0a2';
const RESEARCHER = '00000000-0000-4000-8000-00000000f0a3';
const OUTSIDER = '00000000-0000-4000-8000-00000000f0a4';

async function workspace() {
  const db = await createDatabase();
  await createUser(db, OWNER, 'owner@discovery.example');
  await createUser(db, ADMIN, 'admin@discovery.example');
  await createUser(db, RESEARCHER, 'researcher@discovery.example');
  await createUser(db, OUTSIDER, 'outsider@discovery.example');
  const [{ org_id: org }] = await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
  await db.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'researcher')`, [org, ADMIN, RESEARCHER]);
  const [{ org_id: other }] = await as(db, OUTSIDER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
  return { db, org, other };
}

async function business(db: PGlite, org: string, name = 'Existing Pharmacy') {
  const [row] = await as(db, OWNER, () =>
    rows<{ id: string }>(
      db,
      `insert into public.businesses (organization_id, name, category, region, district_code, contact_permission)
       values ($1, $2, 'Pharmacy', 'Ashanti', 'GH0201', 'unknown') returning id`,
      [org, name],
    ),
  );
  return row.id;
}

async function campaign(db: PGlite, org: string, options: { discovery?: boolean; provider?: string } = {}) {
  const [row] = await as(db, OWNER, () =>
    rows<{ id: string }>(
      db,
      `insert into public.research_campaigns
        (organization_id, name, status, provider_key, regions, categories, discovery_enabled, discovery_daily_limit, discovery_total_limit)
       values ($1, 'Discovery test', 'active', $2, '{Ashanti}', '{Pharmacy}', $3, 5, 20) returning id`,
      [org, options.provider ?? 'offline_synthetic', options.discovery ?? true],
    ),
  );
  return row.id;
}

async function stage(
  db: PGlite,
  org: string,
  values: { campaignId?: string | null; providerRecordId?: string; status?: string; businessId?: string | null; retrievedAt?: string; retentionUntil?: string } = {},
) {
  const recordId = values.providerRecordId ?? `syn-${Math.random().toString(36).slice(2)}`;
  const retrievedAt = values.retrievedAt ?? new Date().toISOString();
  const retentionUntil = values.retentionUntil ?? new Date(Date.now() + 86_400_000).toISOString();
  const result = await db.query<{ id: string }>(
    `insert into public.provider_discovery_records
      (organization_id, campaign_id, provider_key, provider_record_id, name, category, region, district_code, town, website,
       quality_score, identity_confidence, dedupe_key, status, business_id, retrieved_at, retention_until)
     values ($1, $2, 'offline_synthetic', $3, 'Pharmacy Kumasi (synthetic)', 'Pharmacy', 'Ashanti', 'GH0201', 'Kumasi',
       'https://synthetic.example/one', 95, 90, $4, $5, $6, $7, $8) returning id`,
    [org, values.campaignId ?? null, recordId, `name:${recordId}`, values.status ?? 'pending_review', values.businessId ?? null, retrievedAt, retentionUntil],
  );
  return result.rows[0].id;
}

describe('migration 011 schema', () => {
  it('creates the quarantine, run and audit tables with RLS enabled', async () => {
    const db = await createDatabase();
    const tables = await rows<{ tablename: string; rowsecurity: boolean }>(
      db,
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in
        ('provider_discovery_records', 'discovery_runs', 'discovery_events') order by tablename`,
    );
    expect(tables).toHaveLength(3);
    expect(tables.every((table) => table.rowsecurity)).toBe(true);
    const columns = await rows<{ column_name: string }>(
      db,
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'research_campaigns'
        and (column_name like 'discovery%' or column_name = 'discovered_total')`,
    );
    expect(columns.map((column) => column.column_name)).toEqual(
      expect.arrayContaining([
        'discovery_enabled',
        'discovery_daily_limit',
        'discovery_total_limit',
        'discovery_spend_cap_usd',
        'discovery_quality_threshold',
        'discovery_require_review',
        'discovery_cursor',
        'discovery_exhausted',
        'discovered_total',
      ]),
    );
    const providerColumns = await rows<{ column_name: string }>(
      db,
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'businesses'
        and column_name in ('provider_key', 'provider_record_id')`,
    );
    expect(providerColumns).toHaveLength(2);
  });

  it('allows a permitted provider only, and refuses Google Places or tracked records', async () => {
    const { db, org } = await workspace();
    await expect(campaign(db, org, { provider: 'google_places' })).rejects.toThrow(/discovery_provider/);
    await expect(campaign(db, org, { provider: 'tracked_records' })).rejects.toThrow(/discovery_provider/);
    await expect(campaign(db, org, { provider: 'offline_synthetic' })).resolves.toBeTruthy();
  });

  it('accepts provider provenance on a business, and never a half pair', async () => {
    const { db, org } = await workspace();
    await as(db, OWNER, () =>
      db.query(
        `insert into public.businesses (organization_id, name, category, region, district_code, source_kind, provider_key, provider_record_id)
         values ($1, 'Synthetic Pharmacy', 'Pharmacy', 'Ashanti', 'GH0201', 'provider_discovery', 'offline_synthetic', 'syn-1')`,
        [org],
      ),
    );
    await expect(
      as(db, OWNER, () =>
        db.query(
          `insert into public.businesses (organization_id, name, category, region, district_code, source_kind, provider_key)
           values ($1, 'Half Pair', 'Pharmacy', 'Ashanti', 'GH0201', 'manual', 'offline_synthetic')`,
          [org],
        ),
      ),
    ).rejects.toThrow(/businesses_provider_pair/);
    await expect(
      as(db, OWNER, () =>
        db.query(
          `insert into public.businesses (organization_id, name, category, region, district_code, source_kind, provider_key, provider_record_id)
           values ($1, 'Synthetic Pharmacy', 'Pharmacy', 'Ashanti', 'GH0201', 'provider_discovery', 'offline_synthetic', 'syn-1')`,
          [org],
        ),
      ),
    ).rejects.toThrow(/businesses_provider_record_uidx|duplicate key/);
  });
});


describe('quarantine and review', () => {
  it('refuses a retention deadline before retrieval, a promoted row without a business, and a duplicate provider record', async () => {
    const { db, org } = await workspace();
    const campaignId = await campaign(db, org);
    await expect(stage(db, org, { campaignId, retentionUntil: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow(/provider_discovery_retention/);
    await expect(stage(db, org, { campaignId, status: 'promoted' })).rejects.toThrow(/provider_discovery_promoted_business/);
    await stage(db, org, { campaignId, providerRecordId: 'same' });
    await expect(stage(db, org, { campaignId, providerRecordId: 'same' })).rejects.toThrow(/duplicate key/);
  });

  it('moves pending → promoted or rejected once, stamps the decision, and refuses edits to provider fields', async () => {
    const { db, org } = await workspace();
    const businessId = await business(db, org);
    const id = await stage(db, org);
    await expect(db.query(`update public.provider_discovery_records set name = 'Changed' where id = $1`, [id])).rejects.toThrow(/immutable/i);
    const [promoted] = await as(db, ADMIN, () =>
      rows<{ status: string; decided_at: string | null; decided_by: string }>(
        db,
        `update public.provider_discovery_records set status = 'promoted', business_id = $2 where id = $1 returning status, decided_at, decided_by`,
        [id, businessId],
      ),
    );
    expect(promoted.status).toBe('promoted');
    expect(promoted.decided_at).toBeTruthy();
    expect(promoted.decided_by).toBe(ADMIN);
    await expect(db.query(`update public.provider_discovery_records set status = 'rejected' where id = $1`, [id])).rejects.toThrow(/cannot move/i);
  });

  it('makes the audit trail append-only', async () => {
    const { db, org } = await workspace();
    const event = await db.query<{ id: number }>(`insert into public.discovery_events (organization_id, event) values ($1, 'started') returning id`, [org]);
    const eventId = event.rows[0].id;
    await expect(db.query(`update public.discovery_events set detail = 'changed' where id = $1`, [eventId])).rejects.toThrow(/append-only/i);
    await expect(db.query(`delete from public.discovery_events where id = $1`, [eventId])).rejects.toThrow(/append-only/i);
  });
});

describe('row-level security', () => {
  it('shows staged records to members, lets only owners/admins decide, and hides them from another workspace', async () => {
    const { db, org } = await workspace();
    const id = await stage(db, org);
    expect(await as(db, OWNER, () => rows(db, 'select id from public.provider_discovery_records'))).toHaveLength(1);
    expect(await as(db, RESEARCHER, () => rows(db, 'select id from public.provider_discovery_records'))).toHaveLength(1);
    expect(await as(db, OUTSIDER, () => rows(db, 'select id from public.provider_discovery_records'))).toHaveLength(0);

    const researcherUpdate = await as(db, RESEARCHER, () =>
      rows<{ id: string }>(db, `update public.provider_discovery_records set decision_note = 'tried' where id = $1 returning id`, [id]),
    );
    expect(researcherUpdate).toHaveLength(0);
    const adminUpdate = await as(db, ADMIN, () =>
      rows<{ id: string }>(db, `update public.provider_discovery_records set decision_note = 'checked' where id = $1 returning id`, [id]),
    );
    expect(adminUpdate).toHaveLength(1);
    expect(adminUpdate[0].id).toBe(id);
  });

  it('does not let a member insert runs or audit rows directly', async () => {
    const { db, org } = await workspace();
    await expect(
      as(db, OWNER, () => db.query(`insert into public.discovery_runs (organization_id, provider_key) values ($1, 'offline_synthetic')`, [org])),
    ).rejects.toThrow(/permission denied/i);
    await expect(as(db, OWNER, () => db.query(`insert into public.discovery_events (organization_id, event) values ($1, 'started')`, [org]))).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('retention', () => {
  it('purges only expired staging rows and refuses a member direct table deletes', async () => {
    const { db, org } = await workspace();
    const expired = await stage(db, org, {
      providerRecordId: 'old',
      retrievedAt: new Date(Date.now() - 120_000).toISOString(),
      retentionUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    const kept = await stage(db, org, { providerRecordId: 'new' });
    const [count] = await asServiceRole(db, () => rows<{ purge_expired_discovery_records: number }>(db, `select public.purge_expired_discovery_records($1)`, [org]));
    expect(Number(count.purge_expired_discovery_records)).toBe(1);
    const remaining = await rows<{ id: string }>(db, 'select id from public.provider_discovery_records order by id');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(kept);
    expect(remaining.some((row) => row.id === expired)).toBe(false);
    await expect(as(db, OWNER, () => db.query(`delete from public.provider_discovery_records where id = $1`, [kept]))).rejects.toThrow(/permission denied/i);
  });
});

