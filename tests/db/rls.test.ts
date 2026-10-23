import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, createDatabase, createUser, rows } from './harness';

const ALICE = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const CAROL = '00000000-0000-4000-8000-00000000000c';
const MALLORY = '00000000-0000-4000-8000-00000000000d';

let db: PGlite;
let aliceOrg: string;
let bobOrg: string;

async function workspace(user: string) {
  return as(db, user, async () => (await rows<{ org_id: string; member_role: string }>(db, 'select * from public.ensure_workspace()'))[0]);
}

beforeAll(async () => {
  db = await createDatabase({
    // Simulate an existing v6 cloud database: Alice has two legacy leads before migration 002 runs.
    before002: async (d) => {
      await createUser(d, ALICE, 'alice@example.com');
      await d.query(
        `insert into public.leads (owner_id, id, name, city, sector, "websiteStatus", confidence, priority, source, notes, suggestion, stage, consent, "verificationOutcome", "reviewedAt", "verifiedBy")
         values ($1, 'GH001', 'The KingsMen Ghana', 'Kumasi', 'Fashion', 'Not found in initial search', 'medium', 85, 'https://example.org/a', 'n', 's', 'Research', 'Unknown', null, null, null),
                ($1, 'GH002', 'PREYMANN', 'Accra', 'Fashion', 'Existing domain reported', 'low', 60, 'not a url', '', '', 'Excluded', 'Permission obtained', 'No official website found after review', '2026-01-05', 'EB')`,
        [ALICE],
      );
    },
  });
  await createUser(db, BOB, 'bob@example.com');
  await createUser(db, CAROL, 'carol@example.com');
  await createUser(db, MALLORY, 'mallory@example.com', false);
  aliceOrg = (await workspace(ALICE)).org_id;
  bobOrg = (await workspace(BOB)).org_id;
});

describe('migrations', () => {
  it('are re-runnable without errors or duplicate legacy rows', async () => {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '002_workspace_model.sql'), 'utf8'));
    const count = await rows<{ n: number }>(db, 'select count(*)::int as n from public.businesses where organization_id = $1', [aliceOrg]);
    expect(count[0].n).toBe(2);
  });

  it('leaves public.leads untouched', async () => {
    expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.leads'))[0].n).toBe(2);
  });

  it('copies legacy leads with the same mapping as the app', async () => {
    const [kings] = await rows<Record<string, string>>(db, `select * from public.businesses where legacy_id = 'GH001'`);
    expect(kings.category).toBe('Fashion boutique');
    expect(kings.region).toBe('Ashanti');
    expect(kings.website_status).toBe('insufficient_evidence');
    expect(kings.stage).toBe('research_candidate');
    expect(kings.source_kind).toBe('legacy_seed');
    const [prey] = await rows<Record<string, string>>(db, `select * from public.businesses where legacy_id = 'GH002'`);
    expect(prey.website_status).toBe('none_found');
    expect(prey.stage).toBe('archived');
    expect(prey.contact_permission).toBe('granted');
    expect(prey.lawful_basis).toBe('consent');
    expect(prey.source_url).toBeNull();
    const verifs = await rows<{ status: string; reviewer_name: string }>(
      db,
      'select status, reviewer_name from public.website_verifications where business_id = $1 order by checked_at',
      [prey.id],
    );
    expect(verifs.map((v) => v.status)).toEqual(['potential_official', 'none_found']);
    expect(verifs[1].reviewer_name).toBe('EB');
  });
});

describe('workspace bootstrap', () => {
  it('creates one organization per new user and is stable on repeat calls', async () => {
    expect(aliceOrg).not.toBe(bobOrg);
    expect((await workspace(BOB)).org_id).toBe(bobOrg);
    expect((await workspace(BOB)).member_role).toBe('owner');
  });

  it('rejects anonymous callers', async () => {
    await expect(as(db, null, () => db.query('select * from public.ensure_workspace()'))).rejects.toThrow();
  });
});

describe('tenant isolation', () => {
  it('hides other organizations’ records', async () => {
    const visible = await as(db, BOB, () => rows(db, 'select id from public.businesses'));
    expect(visible).toHaveLength(0);
    const legacy = await as(db, BOB, () => rows(db, 'select * from public.leads'));
    expect(legacy).toHaveLength(0);
  });

  it('blocks inserting into another organization', async () => {
    await expect(
      as(db, BOB, () => db.query(`insert into public.businesses (organization_id, name, city) values ($1, 'Intruder', 'Accra')`, [aliceOrg])),
    ).rejects.toThrow(/row-level security/);
  });

  it('silently affects zero rows when updating or deleting another organization’s data', async () => {
    const res = await as(db, BOB, () => db.query(`update public.businesses set name = 'pwned' where organization_id = $1`, [aliceOrg]));
    expect(res.affectedRows ?? 0).toBe(0);
    const del = await as(db, BOB, () => db.query(`delete from public.businesses where organization_id = $1`, [aliceOrg]));
    expect(del.affectedRows ?? 0).toBe(0);
  });

  it('prevents attaching rows to another organization’s business via forged IDs', async () => {
    const [target] = await rows<{ id: string }>(db, `select id from public.businesses where organization_id = $1 limit 1`, [aliceOrg]);
    await expect(
      as(db, BOB, () =>
        db.query(
          `insert into public.website_verifications (organization_id, business_id, status, evidence_summary, confidence) values ($1, $2, 'none_found', 'forged', 'low')`,
          [bobOrg, target.id],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('gives anon no access at all', async () => {
    await expect(as(db, null, () => db.query('select * from public.businesses'))).rejects.toThrow(/permission denied/);
  });
});

describe('roles and invitations', () => {
  it('lets an owner invite a viewer who then joins with read-only access', async () => {
    await as(db, ALICE, () => db.query(`insert into public.organization_invitations (organization_id, email, role) values ($1, 'carol@example.com', 'viewer')`, [aliceOrg]));
    const carol = await workspace(CAROL);
    expect(carol.org_id).toBe(aliceOrg);
    expect(carol.member_role).toBe('viewer');
    const visible = await as(db, CAROL, () => rows(db, 'select id from public.businesses'));
    expect(visible.length).toBe(2);
    await expect(
      as(db, CAROL, () => db.query(`insert into public.businesses (organization_id, name, city) values ($1, 'Nope', 'Accra')`, [aliceOrg])),
    ).rejects.toThrow(/row-level security/);
  });

  it('does not accept invitations for unconfirmed email addresses', async () => {
    await as(db, ALICE, () => db.query(`insert into public.organization_invitations (organization_id, email, role) values ($1, 'mallory@example.com', 'admin')`, [aliceOrg]));
    const mallory = await workspace(MALLORY);
    expect(mallory.org_id).not.toBe(aliceOrg);
  });

  it('hides invitation emails from non-admins', async () => {
    const seen = await as(db, CAROL, () => rows(db, 'select * from public.organization_invitations'));
    expect(seen).toHaveLength(0);
  });

  it('protects the last owner', async () => {
    await expect(as(db, ALICE, () => db.query('delete from public.organization_members where user_id = $1', [ALICE]))).rejects.toThrow(/at least one owner/);
  });

  it('stops a viewer from promoting themselves', async () => {
    const res = await as(db, CAROL, () => db.query(`update public.organization_members set role = 'owner' where user_id = $1`, [CAROL]));
    expect(res.affectedRows ?? 0).toBe(0);
  });
});

describe('audit trail', () => {
  it('records changed columns and purges payloads on delete', async () => {
    const [b] = await as(db, BOB, () =>
      rows<{ id: string; created_by: string }>(db, `insert into public.businesses (organization_id, name, city, created_by) values ($1, 'Audit Co', 'Accra', $2) returning id, created_by`, [bobOrg, ALICE]),
    );
    expect(b.created_by).toBe(BOB);
    await as(db, BOB, () => db.query(`update public.businesses set phone = '0241234567', notes = 'x' where id = $1`, [b.id]));
    const events = await as(db, BOB, () => rows<{ action: string; changes: Record<string, unknown> | null }>(db, 'select action, changes from public.audit_events where record_id = $1 order by id', [b.id]));
    expect(events.map((e) => e.action)).toEqual(['insert', 'update']);
    expect(Object.keys(events[1].changes ?? {}).sort()).toEqual(['notes', 'phone']);

    await as(db, BOB, () => db.query('delete from public.businesses where id = $1', [b.id]));
    const after = await rows<{ action: string; changes: unknown }>(db, 'select action, changes from public.audit_events where record_id = $1', [b.id]);
    expect(after).toEqual([{ action: 'delete', changes: null }]);
  });

  it('cannot be written or erased by clients', async () => {
    await expect(as(db, BOB, () => db.query(`insert into public.audit_events (organization_id, table_name, record_id, action) values ($1, 'x', gen_random_uuid(), 'insert')`, [bobOrg]))).rejects.toThrow(/permission denied/);
    await expect(as(db, BOB, () => db.query('delete from public.audit_events'))).rejects.toThrow(/permission denied/);
  });
});

describe('reports and proposals', () => {
  let businessId: string;
  beforeAll(async () => {
    [{ id: businessId }] = await as(db, BOB, () => rows<{ id: string }>(db, `insert into public.businesses (organization_id, name, city) values ($1, 'Doc Co', 'Kumasi') returning id`, [bobOrg]));
  });

  it('numbers report versions automatically and keeps them immutable', async () => {
    const insert = () =>
      as(db, BOB, () =>
        rows<{ id: string; version: number }>(
          db,
          `insert into public.opportunity_reports (organization_id, business_id, version, content, generator, input_snapshot) values ($1, $2, 99, '{}', 'deterministic', '{}') returning id, version`,
          [bobOrg, businessId],
        ),
      );
    expect((await insert())[0].version).toBe(1);
    const [second] = await insert();
    expect(second.version).toBe(2);
    await expect(as(db, BOB, () => db.query(`update public.opportunity_reports set content = '{"x":1}' where id = $1`, [second.id]))).rejects.toThrow(/permission denied/);
  });

  it('snapshots proposal versions and locks non-draft content', async () => {
    const [p] = await as(db, BOB, () =>
      rows<{ id: string }>(db, `insert into public.proposals (organization_id, business_id, title, content) values ($1, $2, 'Website', '{"a":1}') returning id`, [bobOrg, businessId]),
    );
    await as(db, BOB, () => db.query(`update public.proposals set content = '{"a":2}' where id = $1`, [p.id]));
    await as(db, BOB, () => db.query(`update public.proposals set status = 'approved' where id = $1`, [p.id]));
    await expect(as(db, BOB, () => db.query(`update public.proposals set content = '{"a":3}' where id = $1`, [p.id]))).rejects.toThrow(/Only draft proposals/);
    const versions = await as(db, BOB, () => rows<{ version: number; status: string }>(db, 'select version, status from public.proposal_versions where proposal_id = $1 order by version', [p.id]));
    expect(versions).toEqual([
      { version: 1, status: 'draft' },
      { version: 2, status: 'draft' },
      { version: 3, status: 'approved' },
    ]);
  });

  it('requires a lawful basis when permission is granted', async () => {
    await expect(as(db, BOB, () => db.query(`update public.businesses set contact_permission = 'granted' where id = $1`, [businessId]))).rejects.toThrow(/businesses_permission_basis/);
  });

  it('refuses to delete a business that still has projects', async () => {
    await as(db, BOB, () => db.query(`insert into public.projects (organization_id, business_id, name, project_type) values ($1, $2, 'Build', 'website')`, [bobOrg, businessId]));
    await expect(as(db, BOB, () => db.query('delete from public.businesses where id = $1', [businessId]))).rejects.toThrow(/foreign key/);
  });
});

describe('usage metering', () => {
  it('is insert-only and attributed to the caller', async () => {
    await as(db, BOB, () => db.query(`insert into public.usage_records (organization_id, provider, operation, estimated_cost_usd) values ($1, 'google_places', 'search', 0.035)`, [bobOrg]));
    await expect(
      as(db, BOB, () => db.query(`insert into public.usage_records (organization_id, user_id, provider, operation) values ($1, $2, 'x', 'y')`, [bobOrg, ALICE])),
    ).rejects.toThrow(/row-level security/);
    await expect(as(db, BOB, () => db.query('delete from public.usage_records'))).rejects.toThrow(/permission denied/);
    const own = await as(db, BOB, () => rows(db, 'select * from public.usage_records'));
    expect(own).toHaveLength(1);
  });
});

describe('member directory', () => {
  it('lists teammates with emails only for members of that organization', async () => {
    const forAlice = await as(db, ALICE, () => rows<{ email: string }>(db, 'select * from public.list_organization_members($1)', [aliceOrg]));
    expect(forAlice.map((m) => m.email).sort()).toEqual(['alice@example.com', 'carol@example.com']);
    const forBob = await as(db, BOB, () => rows(db, 'select * from public.list_organization_members($1)', [aliceOrg]));
    expect(forBob).toHaveLength(0);
  });
});
