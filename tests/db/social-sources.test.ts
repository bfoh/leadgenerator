import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR, as, createDatabase, createUser, rows } from './harness';

// Social sources and research observations: organization isolation, database-enforced retention
// shape, one-way revocation and forward-only verification. The tables hold references and metadata
// only, so the constraints that matter are the profile URL, the basis and the status.

const OWNER = '00000000-0000-4000-8000-00000000f201';
const OTHER = '00000000-0000-4000-8000-00000000f202';
const VIEWER = '00000000-0000-4000-8000-00000000f203';
let db: PGlite;
let org: string;
let otherOrg: string;
let business: string;

beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER, 'social-owner@example.org');
  await createUser(db, OTHER, 'social-other@example.org');
  org = (await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  otherOrg = (await as(db, OTHER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  await createUser(db, VIEWER, 'social-viewer@example.org');
  await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')", [org, VIEWER]);
  business = (await as(db, OWNER, () => rows<{ id: string }>(db, "insert into public.businesses(organization_id,name,city,source_kind) values ($1,'Fictional Social Bakery','Cape Coast','social_profile') returning id", [org])))[0].id;
  await as(db, OTHER, () => rows(db, "insert into public.businesses(organization_id,name,city) values ($1,'Other Social Bakery','Kumasi')", [otherOrg]));
});
afterAll(async () => { await db?.close(); });

const source = (organizationId = org, businessId = business, platform = 'instagram', handle = 'sample.bakery', url = 'https://www.instagram.com/sample.bakery/') =>
  rows<{ id: string }>(
    db,
    `insert into public.business_social_sources(organization_id,business_id,platform,handle,profile_url,provenance,retention_basis,verification_status,verification_evidence)
     values($1,$2,$3,$4,$5,'independent_observation','first_party_observation','observed',null) returning id`,
    [organizationId, businessId, platform, handle, url],
  );

const observation = (organizationId = org, businessId = business) =>
  rows<{ id: string }>(
    db,
    `insert into public.business_research_observations(organization_id,business_id,category,statement,source_kind,source_url,status,evidence)
     values($1,$2,'product_service','Cakes and celebration bread','social_profile','https://www.instagram.com/sample.bakery/','observed',null) returning id`,
    [organizationId, businessId],
  );

it('accepts the social_profile provenance and isolates every row by organization', async () => {
  const [saved] = await as(db, OWNER, () => source());
  expect(saved.id).toBeTruthy();
  expect(await as(db, OTHER, () => rows(db, 'select * from public.business_social_sources'))).toEqual([]);
  expect(await as(db, OTHER, () => rows(db, 'select * from public.business_research_observations'))).toEqual([]);
  // A member of another workspace cannot attach a profile to this prospect, nor create one in their
  // own workspace that points at it.
  await expect(as(db, OTHER, () => source(org, business))).rejects.toThrow(/row.level security/i);
  await expect(as(db, OTHER, () => source(otherOrg, business))).rejects.toThrow(/foreign key/i);
  await expect(as(db, null, () => rows(db, 'select * from public.business_social_sources'))).rejects.toThrow(/permission denied/i);
  await expect(as(db, null, () => rows(db, 'select * from public.business_research_observations'))).rejects.toThrow(/permission denied/i);
  await as(db, OWNER, () => observation());
  expect((await as(db, VIEWER, () => rows(db, 'select * from public.business_research_observations'))).length).toBe(1);
});

it('stores only canonical public profile URLs on the right platform', async () => {
  await expect(as(db, OWNER, () => source(org, business, 'instagram', 'elsewhere', 'https://www.facebook.com/elsewhere'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => source(org, business, 'instagram', 'sample.bakery', 'https://www.instagram.com/p/Cabc123/'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => source(org, business, 'instagram', 'sample.bakery', 'https://www.instagram.com/sample.bakery/?igsh=tracking'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => source(org, business, 'tiktok', 'sample.bakery', 'https://www.tiktok.com/sample.bakery'))).rejects.toThrow(/check constraint/i);
  await as(db, OWNER, () => source(org, business, 'facebook', 'samplebakery', 'https://www.facebook.com/samplebakery'));
});

it('keeps one active link per profile and allows a fresh link after revocation', async () => {
  const [entry] = await as(db, OWNER, () => source(org, business, 'tiktok', 'sample.bakery', 'https://www.tiktok.com/@sample.bakery'));
  await expect(as(db, OWNER, () => source(org, business, 'tiktok', 'sample.bakery', 'https://www.tiktok.com/@sample.bakery'))).rejects.toThrow(/duplicate key|unique/i);
  await as(db, OWNER, () => db.query('update public.business_social_sources set revoked_at=now() where id=$1', [entry.id]));
  await as(db, OWNER, () => source(org, business, 'tiktok', 'sample.bakery', 'https://www.tiktok.com/@sample.bakery'));
});

it('protects the profile identity and moves verification forward only, with evidence', async () => {
  const [entry] = await as(db, OWNER, () => source(org, business, 'facebook', 'protectedpage', 'https://www.facebook.com/protectedpage'));
  await expect(as(db, OWNER, () => db.query("update public.business_social_sources set profile_url='https://www.facebook.com/otherpage' where id=$1", [entry.id]))).rejects.toThrow(/immutable/i);
  await expect(as(db, OWNER, () => db.query("update public.business_social_sources set verification_status='independently_verified' where id=$1", [entry.id]))).rejects.toThrow(/needs evidence/i);
  await as(db, OWNER, () => db.query("update public.business_social_sources set verification_status='independently_verified', verification_evidence='Checked against the business website on 26 October.' where id=$1", [entry.id]));
  const [verified] = await rows<{ verification_status: string; verified_at: string | null }>(db, 'select verification_status, verified_at from public.business_social_sources where id=$1', [entry.id]);
  expect(verified.verification_status).toBe('independently_verified');
  expect(verified.verified_at).not.toBeNull();
  await expect(as(db, OWNER, () => db.query("update public.business_social_sources set verification_status='observed' where id=$1", [entry.id]))).rejects.toThrow(/only moves forward/i);
  await as(db, OWNER, () => db.query('update public.business_social_sources set revoked_at=now() where id=$1', [entry.id]));
  await expect(as(db, OWNER, () => db.query('update public.business_social_sources set revoked_at=null where id=$1', [entry.id]))).rejects.toThrow(/revoked/i);
  expect((await rows(db, "select * from public.audit_events where table_name='business_social_sources' and record_id=$1", [entry.id])).length).toBeGreaterThanOrEqual(3);
});

it('derives the starting status from the retention basis at the database boundary', async () => {
  const insert = (handle: string, provenance: string, basis: string, status: string, evidence: string | null) =>
    rows<{ verification_status: string; verified_at: string | null }>(
      db,
      `insert into public.business_social_sources(organization_id,business_id,platform,handle,profile_url,provenance,retention_basis,verification_status,verification_evidence)
       values($1,$2,'instagram',$3,$4,$5,$6,$7,$8) returning verification_status, verified_at`,
      [org, business, handle, `https://www.instagram.com/${handle}/`, provenance, basis, status, evidence],
    );
  // A first-party observation cannot arrive already owner-confirmed.
  await expect(
    as(db, OWNER, () => insert('statuscheck', 'independent_observation', 'first_party_observation', 'owner_confirmed', 'The owner confirmed this account on 26 October.')),
  ).rejects.toThrow(/starts at the status/i);
  // Nor can an observed profile carry verification evidence before it is verified.
  await expect(
    as(db, OWNER, () => insert('evidencecheck', 'independent_observation', 'first_party_observation', 'observed', 'Seen on the public profile on 26 October.')),
  ).rejects.toThrow(/check constraint/i);
  // Nor can its basis be relabelled as owner-supplied.
  await expect(
    as(db, OWNER, () => insert('basischeck', 'owner_supplied', 'first_party_observation', 'observed', null)),
  ).rejects.toThrow(/check constraint/i);
  // A basis that asserts owner confirmation may start confirmed, with evidence.
  const [owner] = await as(db, OWNER, () =>
    insert('ownercheck', 'owner_supplied', 'owner_supplied', 'owner_confirmed', 'The owner supplied this profile link on 26 October.'),
  );
  expect(owner.verification_status).toBe('owner_confirmed');
  expect(owner.verified_at).not.toBeNull();
});

it('refuses Google pointers and social links mislabelled as independent observations', async () => {
  const insert = (kind: string, url: string, category = 'product_service') =>
    rows(
      db,
      `insert into public.business_research_observations(organization_id,business_id,category,statement,source_kind,source_url,status,evidence)
       values($1,$2,$3,'A source link was observed',$4,$5,'observed',null)`,
      [org, business, category, kind, url],
    );
  await expect(as(db, OWNER, () => insert('official_website', 'https://www.google.com/maps/place/Fictional+Bakery'))).rejects.toThrow(/check constraint/i);
  // A trailing dot is the same host, so it cannot be used to slip a Google or social link through.
  await expect(as(db, OWNER, () => insert('official_website', 'https://www.google.com./maps/place/Fictional+Bakery'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert('licensed_directory', 'https://maps.google.com/?cid=123'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert('business_owner', 'https://g.page/fictional-bakery'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert('official_website', 'https://www.instagram.com/sample.bakery/'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert('official_website', 'https://www.instagram.com./sample.bakery/'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert('official_website', 'https://fb.com/sample.bakery'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert('official_website', 'https://scontent.fbcdn.net/profile.jpg'))).rejects.toThrow(/check constraint/i);
  // Userinfo hides the real host from a reader, so it is not a plain source link.
  await expect(
    as(db, OWNER, () => insert('official_website', 'https://www.fictionalbakery.example@evil.example/menu')),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    as(db, OWNER, () => insert('research_gap', 'https://www.google.com/search?q=bakery', 'missing_information')),
  ).rejects.toThrow(/check constraint/i);
  // The business's own website remains a valid independent source.
  await expect(as(db, OWNER, () => insert('official_website', 'https://www.fictionalbakery.example/menu'))).resolves.toBeTruthy();
});

it('lets a viewer read but never create, verify or revoke a social source', async () => {
  const [entry] = await as(db, OWNER, () => source(org, business, 'instagram', 'viewercheck', 'https://www.instagram.com/viewercheck/'));
  expect((await as(db, VIEWER, () => rows(db, 'select * from public.business_social_sources where id=$1', [entry.id]))).length).toBe(1);
  await expect(as(db, VIEWER, () => source(org, business, 'instagram', 'viewercreated', 'https://www.instagram.com/viewercreated/'))).rejects.toThrow(/row.level security/i);
  await as(db, VIEWER, () => db.query('update public.business_social_sources set revoked_at=now() where id=$1', [entry.id]));
  expect((await rows<{ revoked_at: string | null }>(db, 'select revoked_at from public.business_social_sources where id=$1', [entry.id]))[0].revoked_at).toBeNull();
});

it('requires every observation to name a source and a truthful state', async () => {
  await as(db, OWNER, () => observation());
  await as(db, OWNER, () => rows(db, "insert into public.business_research_observations(organization_id,business_id,category,statement,source_kind,source_url,status,evidence) values($1,$2,'missing_information','Owner permission has not been recorded','research_gap',null,'observed',null)", [org, business]));
  // A gap is not a source, and a sourced observation needs its link.
  await expect(as(db, OWNER, () => rows(db, "insert into public.business_research_observations(organization_id,business_id,category,statement,source_kind,source_url,status,evidence) values($1,$2,'missing_information','Mislabelled gap','social_profile','https://www.instagram.com/sample.bakery/','observed',null)", [org, business]))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => rows(db, "insert into public.business_research_observations(organization_id,business_id,category,statement,source_kind,source_url,status,evidence) values($1,$2,'product_service','No link supplied','social_profile',null,'observed',null)", [org, business]))).rejects.toThrow(/check constraint/i);
  // A verified claim without evidence is refused.
  await expect(as(db, OWNER, () => rows(db, "insert into public.business_research_observations(organization_id,business_id,category,statement,source_kind,source_url,status,evidence) values($1,$2,'product_service','Verified without proof','official_website','https://sample.example.org/menu','independently_verified',null)", [org, business]))).rejects.toThrow(/check constraint/i);
  await expect(as(db, VIEWER, () => observation())).rejects.toThrow(/row.level security/i);
});

it('keeps research observations immutable and revocable in one direction', async () => {
  const [entry] = await as(db, OWNER, () => observation());
  await expect(as(db, OWNER, () => db.query("update public.business_research_observations set statement='changed' where id=$1", [entry.id]))).rejects.toThrow(/immutable/i);
  await as(db, OWNER, () => db.query('update public.business_research_observations set revoked_at=now() where id=$1', [entry.id]));
  await expect(as(db, OWNER, () => db.query('update public.business_research_observations set revoked_at=null where id=$1', [entry.id]))).rejects.toThrow(/revoked/i);
  expect((await rows(db, "select * from public.audit_events where table_name='business_research_observations' and record_id=$1", [entry.id])).length).toBeGreaterThanOrEqual(2);
});

// The operator pastes the whole file into the SQL editor, so a second run has to converge rather than
// fail or duplicate: same rows, same six policies, same four triggers, and the reviewed constraints
// still refusing a row that skips a verification step.
it('re-applies the whole file without losing records or duplicating its guards', async () => {
  const [entry] = await as(db, OWNER, () => source(org, business, 'instagram', 'reruncheck', 'https://www.instagram.com/reruncheck/'));
  const snapshot = () => rows<{ id: string; platform: string; handle: string; profile_url: string }>(
    db,
    'select id, platform, handle, profile_url from public.business_social_sources order by id',
  );
  const before = await snapshot();

  await db.exec(readFileSync(join(MIGRATIONS_DIR, '017_social_research_intelligence.sql'), 'utf8'));

  expect(await snapshot()).toEqual(before);
  expect((await rows(db, 'select id from public.business_social_sources where id=$1', [entry.id]))).toHaveLength(1);
  const counts = (
    await rows<{ policies: number; triggers: number }>(
      db,
      `select
         (select count(*)::int from pg_policies where schemaname = 'public'
            and tablename in ('business_social_sources', 'business_research_observations')) as policies,
         (select count(*)::int from pg_trigger
            where tgrelid in (to_regclass('public.business_social_sources'), to_regclass('public.business_research_observations'))
              and tgname in ('business_social_source_guard', 'business_social_source_audit',
                             'business_research_observation_guard', 'business_research_observation_audit')) as triggers`,
    )
  )[0];
  expect(counts).toEqual({ policies: 6, triggers: 4 });
  await expect(
    as(db, OWNER, () =>
      rows(
        db,
        `insert into public.business_social_sources(organization_id,business_id,platform,handle,profile_url,provenance,retention_basis,verification_status,verification_evidence)
         values($1,$2,'instagram','rerunevidence','https://www.instagram.com/rerunevidence/','independent_observation','first_party_observation','observed','Seen on the profile on 26 October.')`,
        [org, business],
      ),
    ),
  ).rejects.toThrow(/check constraint/i);
});

it('refuses an unknown source kind on prospects', async () => {
  await expect(as(db, OWNER, () => rows(db, "insert into public.businesses(organization_id,name,city,source_kind) values($1,'Bad Provenance','Accra','instagram')", [org]))).rejects.toThrow(/check constraint/i);
});

it('takes back the delete and truncate Supabase grants on a new table', async () => {
  // Supabase's default privileges grant every role everything on a table it creates, so a migration
  // that only grants is still deletable and truncatable (truncate bypasses RLS). This database starts
  // with those defaults, as a real project does, and the migration has to take them back.
  const d = await createDatabase({
    before: {
      '017': async (setup) => {
        await setup.exec('alter default privileges in schema public grant all on tables to anon, authenticated');
      },
    },
  });
  try {
    const can = async (role: string, table: string, verb: string) =>
      (await rows<{ allowed: boolean }>(d, 'select has_table_privilege($1, $2, $3) as allowed', [role, `public.${table}`, verb]))[0].allowed;
    for (const table of ['business_social_sources', 'business_research_observations']) {
      expect(await can('authenticated', table, 'select')).toBe(true);
      expect(await can('authenticated', table, 'insert')).toBe(true);
      expect(await can('authenticated', table, 'update')).toBe(true);
      expect(await can('authenticated', table, 'delete')).toBe(false);
      expect(await can('authenticated', table, 'truncate')).toBe(false);
      expect(await can('anon', table, 'select')).toBe(false);
      expect(await can('service_role', table, 'delete')).toBe(true);
    }
  } finally {
    await d.close();
  }
});

