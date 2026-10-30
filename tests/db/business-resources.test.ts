import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, as, createDatabase, createUser, rows } from './harness';
const OWNER = '00000000-0000-4000-8000-00000000f101';
const OTHER = '00000000-0000-4000-8000-00000000f102';
const VIEWER = '00000000-0000-4000-8000-00000000f103';
let db: PGlite; let org: string; let otherOrg: string; let business: string;
beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER, 'resource-owner@example.org'); await createUser(db, OTHER, 'resource-other@example.org');
  org = (await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  otherOrg = (await as(db, OTHER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  await createUser(db, VIEWER, 'resource-viewer@example.org');
  await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')", [org, VIEWER]);
  business = (await as(db, OWNER, () => rows<{ id: string }>(db, "insert into public.businesses(organization_id,name,city) values ($1,'Fictional Resources Bakery','Cape Coast') returning id", [org])))[0].id;
});
afterAll(async () => { await db?.close(); });
const insert = (organization = org, source = 'https://sample.example.org/permission', kind = 'business_owner') => rows<{ id: string }>(db, `insert into public.business_resource_entries(organization_id,business_id,category,label,value,source_kind,source_url,evidence,export_permission,independently_verified) values($1,$2,'service','Baking','Owner supplied description',$3,$4,'Owner authorization dated 25 October','granted',true) returning id`, [organization, business, kind, source]);
it('isolates independent resources by organization and enforces the business binding', async () => {
  await as(db, OWNER, () => insert());
  expect(await as(db, OTHER, () => rows(db, 'select * from public.business_resource_entries'))).toEqual([]);
  await expect(as(db, OTHER, () => insert())).rejects.toThrow(/row.level security/i);
  await expect(as(db, OTHER, () => insert(otherOrg))).rejects.toThrow(/foreign key/i);
  await expect(as(db, null, () => rows(db, 'select * from public.business_resource_entries'))).rejects.toThrow(/permission denied/i);
});
it('refuses Google-origin source types and URLs at the database boundary', async () => {
  await expect(as(db, OWNER, () => insert(org, 'https://maps.google.com/place/example'))).rejects.toThrow(/check constraint/i);
  // The retired Google Business Profile host is Google content even when it looks like a website.
  await expect(as(db, OWNER, () => insert(org, 'https://fictionalbakery.business.site/'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert(org, 'https://sample.example.org', 'google'))).rejects.toThrow(/check constraint/i);
  // Only the host itself is refused, not a longer domain that happens to contain its name.
  await as(db, OWNER, () => insert(org, 'https://notmybusiness.site/permission'));
});
it('allows a member to read but a viewer cannot create or revoke resource entries', async () => {
  const [entry] = await as(db, OWNER, () => insert());
  expect((await as(db, VIEWER, () => rows(db, 'select * from public.business_resource_entries where id=$1', [entry.id]))).length).toBe(1);
  await expect(as(db, VIEWER, () => insert())).rejects.toThrow(/row.level security/i);
  await as(db, VIEWER, () => db.query('update public.business_resource_entries set revoked_at=now() where id=$1', [entry.id]));
  expect((await rows<{ revoked_at: string | null }>(db, 'select revoked_at from public.business_resource_entries where id=$1', [entry.id]))[0].revoked_at).toBeNull();
});
it('keeps facts immutable while allowing audited one-way revocation', async () => {
  const [entry] = await as(db, OWNER, () => insert());
  await expect(as(db, OWNER, () => db.query("update public.business_resource_entries set value='changed' where id=$1", [entry.id]))).rejects.toThrow(/immutable/i);
  await as(db, OWNER, () => db.query('update public.business_resource_entries set revoked_at=now() where id=$1', [entry.id]));
  await expect(as(db, OWNER, () => db.query('update public.business_resource_entries set revoked_at=null where id=$1', [entry.id]))).rejects.toThrow(/immutable/i);
  expect((await rows(db, "select * from public.audit_events where table_name='business_resource_entries' and record_id=$1", [entry.id])).length).toBeGreaterThanOrEqual(2);
});

it('takes back the delete and truncate Supabase grants on the resource ledger', async () => {
  // Supabase's default privileges grant every role everything on a table a migration creates, so 016's
  // grant-only block left `authenticated` and `anon` holding delete and truncate as well as what it meant
  // to grant. This database starts with those defaults, as a real project does, and 018 has to take them
  // back without touching the insert, read and revoke paths the collector uses.
  const d = await createDatabase({
    before: {
      '016': async (setup) => {
        await setup.exec('alter default privileges in schema public grant all on tables to anon, authenticated');
      },
    },
  });
  try {
    const can = async (role: string, table: string, verb: string) =>
      (await rows<{ allowed: boolean }>(d, 'select has_table_privilege($1, $2, $3) as allowed', [role, `public.${table}`, verb]))[0].allowed;

    // The fixture has to be permissive, or the assertions below would prove nothing: a table created here
    // still receives the full default set for both roles.
    await d.exec('create table public.privilege_probe (id integer)');
    expect(await can('authenticated', 'privilege_probe', 'truncate')).toBe(true);
    expect(await can('anon', 'privilege_probe', 'select')).toBe(true);

    // Members keep exactly what the page does: read, create a fact, revoke it once.
    for (const verb of ['select', 'insert', 'update']) {
      expect(await can('authenticated', 'business_resource_entries', verb)).toBe(true);
    }
    for (const verb of ['delete', 'truncate']) {
      expect(await can('authenticated', 'business_resource_entries', verb)).toBe(false);
    }

    // Anonymous visitors hold nothing at all on the ledger, and neither does PUBLIC.
    for (const verb of ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) {
      expect(await can('anon', 'business_resource_entries', verb)).toBe(false);
    }
    expect(await rows(d, `select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = 'business_resource_entries' and grantee = 'PUBLIC'`)).toEqual([{ n: 0 }]);

    // The worker keeps delete for retention and erasure jobs, and loses the truncate it never used.
    for (const verb of ['select', 'insert', 'update', 'delete']) {
      expect(await can('service_role', 'business_resource_entries', verb)).toBe(true);
    }
    expect(await can('service_role', 'business_resource_entries', 'truncate')).toBe(false);

    // Behaviour, not just the catalog: the destructive statements are refused by the privilege check
    // instead of being silently filtered down to no rows by row-level security.
    await createUser(d, OWNER, 'ledger-owner@example.org');
    const [{ org_id: ledgerOrg }] = await as(d, OWNER, () => rows<{ org_id: string }>(d, 'select * from public.ensure_workspace()'));
    const [ledgerBusiness] = await as(d, OWNER, () => rows<{ id: string }>(d, "insert into public.businesses(organization_id,name,city) values ($1,'Fictional Ledger Bakery','Accra') returning id", [ledgerOrg]));
    const [entry] = await as(d, OWNER, () => rows<{ id: string }>(d, `insert into public.business_resource_entries(organization_id,business_id,category,label,value,source_kind,source_url,evidence,export_permission,independently_verified) values($1,$2,'service','Baking','Owner supplied description','business_owner','https://sample.example.org/permission','Owner authorization dated 25 October','granted',true) returning id`, [ledgerOrg, ledgerBusiness.id]));
    await as(d, OWNER, () => d.query('update public.business_resource_entries set revoked_at=now() where id=$1', [entry.id]));
    await expect(as(d, OWNER, () => d.query('delete from public.business_resource_entries'))).rejects.toThrow(/permission denied/i);
    await expect(as(d, OWNER, () => d.query('truncate public.business_resource_entries'))).rejects.toThrow(/permission denied/i);
    await expect(as(d, null, () => rows(d, 'select * from public.business_resource_entries'))).rejects.toThrow(/permission denied/i);

    // Re-running the file changes nothing: the grant the entry was revoked with is still there.
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '018_business_resource_privileges.sql'), 'utf8'));
    expect(await can('authenticated', 'business_resource_entries', 'delete')).toBe(false);
    expect(await can('authenticated', 'business_resource_entries', 'truncate')).toBe(false);
    expect((await rows<{ revoked_at: string | null }>(d, 'select revoked_at from public.business_resource_entries where id=$1', [entry.id]))[0].revoked_at).not.toBeNull();

    // The rollback puts back exactly what 016 and the defaults left, and 018 takes it away again — the
    // pair is reversible, and the down file is not a silent no-op.
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '..', 'rollback', '018_business_resource_privileges_down.sql'), 'utf8'));
    expect(await can('authenticated', 'business_resource_entries', 'delete')).toBe(true);
    expect(await can('authenticated', 'business_resource_entries', 'truncate')).toBe(true);
    expect(await can('anon', 'business_resource_entries', 'select')).toBe(true);
    expect(await can('service_role', 'business_resource_entries', 'truncate')).toBe(true);
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '018_business_resource_privileges.sql'), 'utf8'));
    expect(await can('authenticated', 'business_resource_entries', 'delete')).toBe(false);
    expect(await can('authenticated', 'business_resource_entries', 'truncate')).toBe(false);
    expect(await can('anon', 'business_resource_entries', 'select')).toBe(false);
  } finally {
    await d.close();
  }
});
