import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, createDatabase, createUser, migrationFiles, rows } from './harness';

// Migration review (phase 10). Two parts:
// 1. A static safety check of every migration and rollback file: row-level security on every table,
//    a pinned search_path on every security-definer function, no destructive statements in the
//    forward migrations, and a rollback for every migration from 003 on.
// 2. The production upgrade path: a database at 002 with existing records gets 003–008, then the
//    whole chain is rolled back newest first, re-applied and re-run. The records that existed before
//    must come through every step unchanged, and the rollback must leave the 002 schema behind.

const ROLLBACK_DIR = join(process.cwd(), 'supabase', 'rollback');
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
/** SQL without comments, so prose in comments cannot satisfy or trip a check. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

const upgrades = migrationFiles().filter((f) => f >= '003');

describe('migration files', () => {
  const all = migrationFiles().map((f) => ({ file: f, sql: code(read(MIGRATIONS_DIR, f)) }));
  const everything = all.map((m) => m.sql).join('\n');

  it('enable row-level security on every table they create', () => {
    const tables = [...everything.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(20);
    const missing = tables.filter((t) => !new RegExp(`alter table (?:if exists )?public\\.${t} enable row level security`, 'i').test(everything));
    expect(missing).toEqual([]);
  });

  it('pin the search_path of every security-definer function', () => {
    const unpinned: string[] = [];
    let definers = 0;
    for (const { file, sql } of all) {
      for (const m of sql.matchAll(/create or replace function (public\.\w+)\(([\s\S]*?)\bas \$\$/gi)) {
        if (!/security definer/i.test(m[2])) continue;
        definers++;
        if (!/set search_path/i.test(m[2])) unpinned.push(`${file}: ${m[1]}`);
      }
    }
    expect(definers).toBeGreaterThan(10);
    expect(unpinned).toEqual([]);
  });

  it('never drop or empty tables, or delete rows without a condition, in a forward migration', () => {
    const findings: string[] = [];
    for (const { file, sql } of all) {
      for (const [pattern, label] of [
        [/^\s*drop table\b/gim, 'drop table'],
        [/^\s*truncate\b/gim, 'truncate'],
        [/^\s*drop schema\b/gim, 'drop schema'],
        [/^\s*delete from [\w.]+\s*;/gim, 'unconditional delete'],
        [/^\s*alter table [\w.]+ drop column\b/gim, 'drop column'],
      ] as const) {
        if (pattern.test(sql)) findings.push(`${file}: ${label}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('have a rollback for every migration from 003 on, and nothing else in the rollback folder', () => {
    const rollbacks = readdirSync(ROLLBACK_DIR).filter((f) => f.endsWith('.sql')).sort();
    expect(rollbacks).toEqual(upgrades.map((f) => f.replace(/\.sql$/, '_down.sql')));
  });
});

// ─── The production upgrade path ────────────────────────────────────────────────────────────────

const OWNER = '00000000-0000-4000-8000-00000000d0a1';
const SALES = '00000000-0000-4000-8000-00000000d0a2';

/** Fingerprint of the given tables' rows over the columns they had at 002. */
async function fingerprint(db: PGlite, columns: Record<string, string[]>) {
  const out: Record<string, { count: number; hash: string }> = {};
  for (const [table, cols] of Object.entries(columns)) {
    const list = cols.map((c) => `"${c}"`).join(', ');
    const [r] = await rows<{ count: number; hash: string }>(
      db,
      `select count(*)::int as count, coalesce(md5(string_agg(row_to_json(t)::text, '|' order by row_to_json(t)::text)), '') as hash from (select ${list} from public.${table}) t`,
    );
    out[table] = r;
  }
  return out;
}

const schemaObjects = async (db: PGlite) => ({
  tables: (await rows<{ n: string }>(db, `select tablename as n from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.n),
  triggers: (await rows<{ n: string }>(db, `select tgrelid::regclass || '.' || tgname as n from pg_trigger t join pg_class c on c.oid = t.tgrelid where not tgisinternal and c.relnamespace = 'public'::regnamespace order by 1`)).map((r) => r.n),
  policies: (await rows<{ n: string }>(db, `select tablename || '.' || policyname as n from pg_policies where schemaname = 'public' order by 1`)).map((r) => r.n),
});

async function seedExistingWorkspace(db: PGlite) {
  await createUser(db, OWNER, 'owner@agency.example');
  await createUser(db, SALES, 'sales@agency.example');
  // A v6 lead row, as the oldest deployments have.
  await db.query(`insert into public.leads (owner_id, id, name) values ($1, 'legacy-1', 'Legacy Lead')`, [OWNER]);
  const [{ org_id: org }] = await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
  await as(db, OWNER, () => db.query(`insert into public.organization_invitations (organization_id, email, role) values ($1, 'sales@agency.example', 'sales')`, [org]));
  await as(db, SALES, () => db.query('select * from public.ensure_workspace()'));

  const business = async (name: string, extra: Record<string, string> = {}) => {
    const cols = ['organization_id', 'name', 'city', ...Object.keys(extra)];
    const vals = [org, name, 'Accra', ...Object.values(extra)];
    const [r] = await as(db, OWNER, () => rows<{ id: string }>(db, `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals));
    return r.id;
  };
  const ids = {
    fresh: await business('Fresh Bakery'),
    verified: await business('Verified Salon', { website_status: 'none_found', stage: 'qualified' }),
    granted: await business('Granted Tailor', { contact_permission: 'granted', lawful_basis: 'consent', stage: 'contact_authorized', email: 'hello@grantedtailor.example' }),
    optedOut: await business('Opted Out Spa', { contact_permission: 'opted_out', phone: '+233201234567' }),
    won: await business('Won Clinic', { stage: 'won' }),
  };
  await as(db, OWNER, async () => {
    await db.query(
      `insert into public.website_verifications (organization_id, business_id, status, methods, evidence_summary, confidence) values ($1, $2, 'none_found', '{exact_name_search,domain_probe}', 'Searched the exact name and likely domains; nothing official found.', 'medium')`,
      [org, ids.verified],
    );
    await db.query(`insert into public.activities (organization_id, business_id, type, summary) values ($1, $2, 'note', 'Met the owner at the trade fair')`, [org, ids.granted]);
    await db.query(`insert into public.tasks (organization_id, business_id, title) values ($1, $2, 'Send the proposal')`, [org, ids.granted]);
    await db.query(`insert into public.proposals (organization_id, business_id, title, content, one_time_total) values ($1, $2, 'Website proposal', '{"lineItems":[]}', 4000)`, [org, ids.granted]);
    await db.query(`insert into public.proposals (organization_id, business_id, title, content) values ($1, $2, 'Draft proposal', '{"lineItems":[]}')`, [org, ids.verified]);
  });
  // The first proposal was issued before any of the new guards existed, with no approval time.
  await db.query(`update public.proposals set status = 'sent', sent_at = now() where title = 'Website proposal'`);
  return { org, ids };
}

describe('upgrading an existing database from 002', () => {
  it('applies 003–008 without changing existing records, rolls back to the 002 schema, and re-applies', async () => {
    const db = await createDatabase({ skip: upgrades.map((f) => f.slice(0, 3)) });
    const { org, ids } = await seedExistingWorkspace(db);

    const tables = ['organizations', 'organization_members', 'businesses', 'website_verifications', 'activities', 'tasks', 'proposals', 'leads'];
    const columns: Record<string, string[]> = {};
    for (const t of tables) {
      columns[t] = (await rows<{ c: string }>(db, `select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [t])).map((r) => r.c);
    }
    const before = await fingerprint(db, columns);
    const schemaAt002 = await schemaObjects(db);
    // Five prospects plus the v6 lead, copied into businesses on the owner's first sign-in.
    expect(before.businesses.count).toBe(6);

    const applyAll = async () => {
      for (const f of upgrades) await db.exec(read(MIGRATIONS_DIR, f));
    };
    await applyAll();
    expect(await fingerprint(db, columns)).toEqual(before);

    // What the upgrade derives for existing records.
    const states = Object.fromEntries((await rows<{ id: string; workflow_state: string }>(db, 'select id, workflow_state from public.businesses')).map((r) => [r.id, r.workflow_state]));
    expect(states[ids.optedOut]).toBe('opted_out');
    expect(states[ids.won]).toBe('client_won');
    expect(states[ids.granted]).toBe('ready_for_outreach');
    const suppressed = await rows(db, `select 1 from public.suppressions where organization_id = $1 and business_id = $2 and lifted_at is null`, [org, ids.optedOut]);
    expect(suppressed.length).toBeGreaterThan(0);
    // No consent is invented for the business that had permission recorded on its profile.
    expect(await rows(db, 'select 1 from public.consent_records')).toHaveLength(0);
    // The proposal issued before the guards existed can still be decided.
    await as(db, OWNER, () => db.query(`update public.proposals set status = 'accepted', decided_at = now() where title = 'Website proposal'`));
    expect((await rows<{ status: string }>(db, `select status from public.proposals where title = 'Website proposal'`))[0].status).toBe('accepted');
    await db.query(`update public.proposals set status = 'sent', decided_at = null where title = 'Website proposal'`);
    const afterUpgrade = await fingerprint(db, columns);

    // Roll back newest first.
    for (const f of [...upgrades].reverse()) await db.exec(read(ROLLBACK_DIR, f.replace(/\.sql$/, '_down.sql')));
    expect(await schemaObjects(db)).toEqual(schemaAt002);
    expect(await fingerprint(db, columns)).toEqual(afterUpgrade);

    // Re-apply, then run every migration once more: re-runnable, and still nothing changed.
    await applyAll();
    await applyAll();
    expect(await fingerprint(db, columns)).toEqual(afterUpgrade);
    expect((await rows(db, `select 1 from public.automation_settings where organization_id = $1`, [org])).length).toBe(1);
  });
});

describe('pre-production inspection script', () => {
  const preflight = read(join(process.cwd(), 'supabase', 'checks'), 'preflight.sql');
  /** The SELECT on its own, run inside a read-only transaction like the script's own. */
  const query = preflight.slice(preflight.indexOf('select section'), preflight.lastIndexOf(';', preflight.indexOf('\nrollback;')) + 1);

  it('runs read-only at 002 and at 008, and reports what is installed and what the upgrade will do', async () => {
    const db = await createDatabase({ skip: upgrades.map((f) => f.slice(0, 3)) });
    await seedExistingWorkspace(db);
    const run = async () => {
      await db.exec('begin transaction read only');
      try {
        return Object.fromEntries((await rows<{ check: string; value: string }>(db, query)).map((r) => [r.check, r.value]));
      } finally {
        await db.exec('rollback');
      }
    };
    const at002 = await run();
    expect(at002['002 workspace model']).toBe('yes');
    expect(at002['003 automation']).toBe('no');
    expect(at002['businesses']).toBe('6');
    expect(at002['businesses opted out']).toBe('1');
    expect(at002['businesses with permission on the profile']).toBe('1');
    expect(at002['approved or sent proposals without an approval time']).toBe('1');
    expect(at002['members by role']).toBe('owner: 1, sales: 1');

    for (const f of upgrades) await db.exec(read(MIGRATIONS_DIR, f));
    const at008 = await run();
    expect(at008['008 replies and conversion']).toBe('yes');
    expect(at008['businesses']).toBe('6');
    // The whole script, as written, also runs and changes nothing.
    await db.exec(preflight);
  });

  it('contains nothing that writes', () => {
    expect(code(preflight)).not.toMatch(/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/i);
  });
});
