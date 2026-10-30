// Migration 019 on PGlite: the five Studio tables from 014 and 015, with Supabase's default privileges
// reproduced exactly as a real project has them. The suite measures the gap 019 closes, the matrix it
// leaves, the behaviour behind it (member reads and inserts, refused deletes and truncates, the worker's
// narrower set), organization isolation, the trigger guards, idempotency, the default privileges 019
// deliberately does not touch, and the rollback.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, rows } from './harness';

const TABLES = [
  'studio_creative_briefs',
  'studio_creative_brief_reviews',
  'studio_creative_directions',
  'studio_creative_direction_reviews',
  'studio_website_prototypes',
] as const;

const ROLES = ['anon', 'authenticated', 'service_role'] as const;
const VERBS = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] as const;

/** Supabase's creation-time grant on every table a migration creates. */
const DEFAULT_SET = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE';
/** What 014 and 015 declared for members, once the defaults are taken back. */
const MEMBER_SET = 'INSERT,REFERENCES,SELECT,TRIGGER,UPDATE';
/** What the worker keeps: everything it was granted, less truncate. */
const WORKER_SET = 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,UPDATE';

const OWNER = '00000000-0000-4000-8000-00000000f201';
const OTHER = '00000000-0000-4000-8000-00000000f202';
const VIEWER = '00000000-0000-4000-8000-00000000f203';

const BRIEF = JSON.stringify({
  format: 'dof-creative-brief/1',
  sections: {},
  missingInformation: [],
  confirmations: [],
  provenance: {},
});

const migration = readFileSync(join(MIGRATIONS_DIR, '019_studio_privilege_hardening.sql'), 'utf8');
const rollback = readFileSync(join(MIGRATIONS_DIR, '..', 'rollback', '019_studio_privilege_hardening_down.sql'), 'utf8');

/**
 * A database exactly as a Supabase project is before 019: the 014 and 015 tables created with the
 * project's default privileges still in place. 019 is skipped so each test can measure either side.
 */
const productionShaped = (skip: string[] = ['019']) =>
  createDatabase({
    skip,
    before: { '014': (d) => d.exec('alter default privileges in schema public grant all on tables to anon, authenticated') },
  });

const can = async (db: PGlite, role: string, table: string, verb: string) =>
  (await rows<{ allowed: boolean }>(db, 'select has_table_privilege($1, $2, $3) as allowed', [role, `public.${table}`, verb]))[0].allowed;

/** The role's privilege set on one table, as the catalog reports it, or null when it holds none. */
const held = async (db: PGlite, role: string, table: string) => {
  const privileges = (
    await rows<{ privileges: string | null }>(
      db,
      `select string_agg(privilege_type, ',' order by privilege_type) as privileges
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = $1 and grantee = $2`,
      [table, role],
    )
  )[0].privileges;
  // PGlite runs Postgres 17, where `grant all` also hands out MAINTAIN. 15 and 16 have no such privilege,
  // so it is stripped here to keep one matrix for both; the tests assert the 17-only revoke directly.
  return privileges === null ? null : privileges.split(',').filter((p) => p !== 'MAINTAIN').join(',');
};

const matrix = async (db: PGlite) =>
  Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, Object.fromEntries(await Promise.all(ROLES.map(async (r) => [r, await held(db, r, t)])))])));

/** Rows granted to `anon` anywhere in `public`: the release gate's own measure of the gap. */
const anonGrants = async (db: PGlite) =>
  (await rows<{ n: number }>(db, "select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'"))[0].n;

const publicGrants = async (db: PGlite, table: string) =>
  (await rows<{ n: number }>(db, "select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and table_name = $1 and grantee = 'PUBLIC'", [table]))[0].n;

/** Policy and trigger counts of the five tables, so the revoke can be shown to leave both alone. */
const policyCount = async (d: PGlite) =>
  (await rows<{ n: number }>(d, "select count(*)::int as n from pg_policies where schemaname = 'public' and tablename::text = any($1)", [TABLES as unknown as string[]]))[0].n;

const triggerCount = async (d: PGlite) =>
  (
    await rows<{ n: number }>(
      d,
      `select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and c.relname::text = any($1) and not t.tgisinternal`,
      [TABLES as unknown as string[]],
    )
  )[0].n;

async function workspace(db: PGlite, user: string, email: string) {
  await createUser(db, user, email);
  return (await as(db, user, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
}

async function project(db: PGlite, user: string, org: string, name: string) {
  const [business] = await as(db, user, () =>
    rows<{ id: string }>(db, "insert into public.businesses (organization_id, name, city) values ($1, $2, 'Accra') returning id", [org, name]),
  );
  const [row] = await as(db, user, () =>
    rows<{ id: string }>(db, 'insert into public.studio_projects (organization_id, business_id, name) values ($1, $2, $3) returning id', [org, business.id, name]),
  );
  return row.id;
}

const insertBrief = (db: PGlite, user: string, org: string, projectId: string, version = 1) =>
  as(db, user, () =>
    rows<{ id: string }>(db, 'insert into public.studio_creative_briefs (organization_id, project_id, version, content) values ($1, $2, $3, $4::jsonb) returning id', [org, projectId, version, BRIEF]),
  );

let db: PGlite;
let org: string;
let otherOrg: string;
let projectId: string;
let briefId: string;
/** Policies, triggers and row counts as they stand before 019 is applied. */
let shape: { policies: number; triggers: number };
let beforeAnon: number;

beforeAll(async () => {
  db = await productionShaped();
  org = await workspace(db, OWNER, 'studio-privileges-owner@example.org');
  otherOrg = await workspace(db, OTHER, 'studio-privileges-other@example.org');
  await createUser(db, VIEWER, 'studio-privileges-viewer@example.org');
  await db.query("insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')", [org, VIEWER]);
  projectId = await project(db, OWNER, org, 'Studio privileges concept');
  [briefId] = (await insertBrief(db, OWNER, org, projectId)).map((r) => r.id);
  shape = {
    policies: await policyCount(db),
    triggers: await triggerCount(db),
  };
  beforeAnon = await anonGrants(db);
});

afterAll(async () => {
  await db?.close();
});

it('measures the grant Supabase adds at creation, then takes it back without touching a row', async () => {
  // Before: every role holds the full creation-time set on all five tables, because 014 and 015 only
  // granted on top of the defaults. This is the state the preflight queries look for on production.
  for (const table of TABLES) {
    for (const role of ROLES) {
      expect(await held(db, role, table), `${role} on ${table}`).toBe(DEFAULT_SET);
    }
    // Every one of the seven, verb by verb, not just the aggregate: this is the state 019 has to remove.
    for (const verb of VERBS) {
      expect(await can(db, 'anon', table, verb), `anon ${verb} on ${table}`).toBe(true);
    }
    expect(await publicGrants(db, table), `PUBLIC on ${table}`).toBe(0);
  }
  expect(beforeAnon).toBe(TABLES.length * 7);
  expect(await can(db, 'authenticated', 'studio_website_prototypes', 'truncate')).toBe(true);

  await db.exec(migration);

  // After: members keep exactly what 014 and 015 declared, anonymous visitors keep nothing, and the
  // worker keeps its delete for retention and erasure but loses the truncate no job needs.
  for (const table of TABLES) {
    expect(await held(db, 'authenticated', table), `authenticated on ${table}`).toBe(MEMBER_SET);
    expect(await held(db, 'anon', table), `anon on ${table}`).toBeNull();
    expect(await held(db, 'service_role', table), `service_role on ${table}`).toBe(WORKER_SET);
    expect(await publicGrants(db, table), `PUBLIC on ${table}`).toBe(0);
  }
  expect(await anonGrants(db)).toBe(0);

  // Postgres 17 only: `grant all` also grants MAINTAIN (vacuum, analyze, cluster, reindex), which would let
  // one member lock a table for every organization. 019 takes it back from both roles; 15 has no such
  // privilege, so the check is skipped there rather than asserted about a name Postgres does not know.
  const [{ version }] = await rows<{ version: number }>(db, "select current_setting('server_version_num')::int as version");
  if (version >= 170000) {
    for (const table of TABLES) {
      expect(await can(db, 'authenticated', table, 'maintain'), `authenticated maintain on ${table}`).toBe(false);
      expect(await can(db, 'service_role', table, 'maintain'), `service_role maintain on ${table}`).toBe(false);
    }
  }

  // Nothing but privileges changed: same policies, same triggers, same rows.
  expect(await policyCount(db)).toBe(shape.policies);
  expect(await triggerCount(db)).toBe(shape.triggers);
  expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.studio_creative_briefs'))[0].n).toBe(1);
  expect((await as(db, OWNER, () => rows<{ id: string }>(db, 'select id from public.studio_creative_briefs where id = $1', [briefId])))[0].id).toBe(briefId);
});


it('keeps member reads and inserts working, and refuses delete and truncate at the privilege check', async () => {
  // A member still reads their organization's history and writes the next version.
  expect((await as(db, OWNER, () => rows(db, 'select id from public.studio_creative_briefs where project_id = $1', [projectId]))).length).toBe(1);
  const [second] = await insertBrief(db, OWNER, org, projectId, 2);
  expect(second.id).toBeTruthy();

  // A viewer reads but cannot write: the insert policy is untouched by the revoke.
  expect((await as(db, VIEWER, () => rows(db, 'select id from public.studio_creative_briefs where project_id = $1', [projectId]))).length).toBe(2);
  await expect(insertBrief(db, VIEWER, org, projectId, 3)).rejects.toThrow(/policy|permission/i);

  // DELETE and TRUNCATE are refused by the privilege check itself. Before 019 the delete was filtered
  // down to no rows by the missing policy and the truncate would have been allowed.
  await expect(as(db, OWNER, () => db.query('delete from public.studio_creative_briefs where id = $1', [briefId]))).rejects.toThrow(/permission denied/i);
  await expect(as(db, OWNER, () => db.query('truncate public.studio_creative_briefs'))).rejects.toThrow(/permission denied/i);
  expect((await rows<{ n: number }>(db, 'select count(*)::int as n from public.studio_creative_briefs'))[0].n).toBe(2);

  // Writing still works after the refusals: the page's own path is untouched.
  await expect(insertBrief(db, OWNER, org, projectId, 3)).resolves.toBeDefined();
});

it('keeps organization isolation and the trigger guards, which the revoke does not replace', async () => {
  // Another organization sees nothing and cannot attach a brief to a project it does not own.
  expect(await as(db, OTHER, () => rows(db, 'select id from public.studio_creative_briefs where project_id = $1', [projectId]))).toEqual([]);
  await expect(insertBrief(db, OTHER, otherOrg, projectId, 4)).rejects.toThrow(/foreign key|policy/i);

  // `anon` holds nothing, so a session-less read is refused before any policy is consulted.
  await expect(as(db, null, () => rows(db, 'select id from public.studio_creative_briefs'))).rejects.toThrow(/permission denied/i);

  // The worker keeps update, so its attempt reaches the guard trigger: the immutability rule is the
  // trigger, not the grant, and it survives the revoke.
  await expect(asServiceRole(db, () => db.query("update public.studio_creative_briefs set note = 'edited' where id = $1", [briefId]))).rejects.toThrow(/immutable/i);
  await expect(asServiceRole(db, () => db.query('truncate public.studio_creative_briefs'))).rejects.toThrow(/permission denied/i);

  // A member's update never reaches that trigger: no update policy exists, so it matches no row. That is
  // why the UPDATE privilege is left in place rather than revoked — and why this test asserts the outcome
  // instead of the error text.
  await as(db, OWNER, () => db.query("update public.studio_creative_briefs set note = 'edited' where id = $1", [briefId]));
  expect((await rows<{ note: string }>(db, 'select note from public.studio_creative_briefs where id = $1', [briefId]))[0].note).toBe('');

  // The worker keeps read, insert, update and delete for retention and erasure work, as 014 granted.
  for (const verb of ['select', 'insert', 'update', 'delete']) {
    expect(await can(db, 'service_role', 'studio_creative_briefs', verb), verb).toBe(true);
  }
  for (const table of TABLES) {
    for (const verb of ['delete', 'truncate']) {
      expect(await can(db, 'authenticated', table, verb), `${verb} on ${table}`).toBe(false);
    }
    expect(await can(db, 'authenticated', table, 'select')).toBe(true);
    expect(await can(db, 'authenticated', table, 'insert')).toBe(true);
  }
});




it('leaves the project default privileges alone, and measures the separate statement that changes them', async () => {
  const d = await productionShaped(['019']);
  const snapshot = () =>
    rows(
      d,
      `select pg_get_userbyid(d.defaclrole) as creating_role, d.defaclobjtype as object_type, d.defaclacl::text as acl
         from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace order by 1, 2`,
    );
  try {
    // The defaults belong to the role that creates objects, and the grantor is recorded with them: that is
    // why 019 cannot close this half from five revokes, and why the release gate runs its own statement as
    // the grantor. Recorded here as a measurement rather than an assumption.
    const defaults = await rows<{ creating_role: string; grantor: string; grantee: string }>(
      d,
      `select distinct pg_get_userbyid(d.defaclrole) as creating_role,
              pg_get_userbyid(a.grantor) as grantor,
              pg_get_userbyid(a.grantee) as grantee
         from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
        where d.defaclnamespace = 'public'::regnamespace
        order by 3`,
    );
    expect(defaults.map((r) => r.grantee)).toEqual(expect.arrayContaining(['anon', 'authenticated', 'service_role']));
    const [{ current_user: creatingRole }] = await rows<{ current_user: string }>(d, 'select current_user as current_user');
    expect(defaults.every((r) => r.creating_role === creatingRole)).toBe(true);
    expect(defaults.every((r) => r.grantor === creatingRole)).toBe(true);

    // The runbook's §6 query, verbatim, so the operator's first check is exercised here rather than only
    // written down.
    const documented = await rows<{ object_creating_role: string; grantee: string; grantor: string; object_type: string; privileges: string }>(
      d,
      `select pg_get_userbyid(d.defaclrole) as object_creating_role,
              case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
              pg_get_userbyid(a.grantor) as grantor,
              d.defaclobjtype as object_type,
              string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
         from pg_default_acl d
         cross join lateral aclexplode(d.defaclacl) a
        where d.defaclnamespace = 'public'::regnamespace
        group by 1, 2, 3, 4
        order by 2, 4`,
    );
    expect(documented.filter((r) => r.object_type === 'r').map((r) => r.grantee)).toEqual(expect.arrayContaining(['anon', 'authenticated', 'service_role']));
    expect(documented.filter((r) => r.object_type === 'r').every((r) => r.privileges.replace(',MAINTAIN', '') === DEFAULT_SET)).toBe(true);

    const before = await snapshot();
    await d.exec(migration);
    expect(await snapshot()).toEqual(before);

    // So a table created after 019 still inherits the full set, exactly as the review records.
    await d.exec('create table public.after_019_probe (id integer)');
    expect(await can(d, 'anon', 'after_019_probe', 'select')).toBe(true);
    expect(await can(d, 'authenticated', 'after_019_probe', 'truncate')).toBe(true);

    // The release-gate statement (§5.3) is a different measure for a different problem: project wide, and
    // it removes the default itself. Run here only to show that 019 is not that statement.
    await d.exec(`
      do $$
      begin
        if exists (select 1 from pg_roles where rolname = 'anon') then
          execute 'revoke all on all tables in schema public from anon';
          execute 'alter default privileges in schema public revoke all on tables from anon';
        end if;
      end $$;
    `);
    await d.exec('create table public.after_gate_probe (id integer)');
    expect(await can(d, 'anon', 'after_gate_probe', 'select')).toBe(false);
    expect(await anonGrants(d)).toBe(0);
  } finally {
    await d.close();
  }
});

it('is re-runnable, and rolls back to exactly what 014, 015 and the defaults left', async () => {
  const d = await productionShaped(['019']);
  try {
    await d.exec(migration);
    const closed = await matrix(d);

    // A second run changes nothing: a repeated revoke is a no-op, not an error.
    await d.exec(migration);
    expect(await matrix(d)).toEqual(closed);

    // A row written before the reversal is still there after it, and the privileges come back exactly.
    const orgId = await workspace(d, OWNER, 'studio-privileges-reversal@example.org');
    const reversalProject = await project(d, OWNER, orgId, 'Reversal concept');
    const [brief] = await insertBrief(d, OWNER, orgId, reversalProject);
    expect(brief.id).toBeTruthy();

    await d.exec(rollback);
    for (const table of TABLES) {
      for (const role of ROLES) {
        expect(await held(d, role, table), `${role} on ${table} after rollback`).toBe(DEFAULT_SET);
      }
    }
    expect(await anonGrants(d)).toBe(TABLES.length * 7);
    expect((await rows<{ n: number }>(d, 'select count(*)::int as n from public.studio_creative_briefs'))[0].n).toBe(1);
    const [{ version }] = await rows<{ version: number }>(d, "select current_setting('server_version_num')::int as version");
    if (version >= 170000) {
      expect(await can(d, 'authenticated', 'studio_creative_briefs', 'maintain')).toBe(true);
      expect(await can(d, 'service_role', 'studio_website_prototypes', 'maintain')).toBe(true);
    }

    // The down file is not a silent no-op: applying 019 again re-closes the same five tables.
    await d.exec(migration);
    expect(await matrix(d)).toEqual(closed);
    expect(await anonGrants(d)).toBe(0);
  } finally {
    await d.close();
  }
});

it('reports the runbook matrix query from the catalog, after the revoke', async () => {
  // The exact query in docs/MIGRATION_REVIEW_019.md §8.1, run against the closed database: no anon row,
  // members without delete or truncate, the worker without truncate.
  const granted = await rows<{ table_name: string; grantee: string; privileges: string }>(
    db,
    `select c.relname as table_name,
            case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
            string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
       from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('studio_creative_briefs', 'studio_creative_brief_reviews',
                          'studio_creative_directions', 'studio_creative_direction_reviews',
                          'studio_website_prototypes')
        and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))
      group by 1, 2
      order by 1, 2`,
  );
  expect(granted.filter((r) => r.grantee === 'anon' || r.grantee === 'PUBLIC')).toEqual([]);
  for (const table of TABLES) {
    expect(granted.find((r) => r.table_name === table && r.grantee === 'authenticated')?.privileges.replace(',MAINTAIN', '')).toBe(MEMBER_SET);
    expect(granted.find((r) => r.table_name === table && r.grantee === 'service_role')?.privileges.replace(',MAINTAIN', '')).toBe(WORKER_SET);
  }
});

