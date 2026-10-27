import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createDatabase, createUser, rows } from './harness';

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

it('refuses an unknown source kind on prospects', async () => {
  await expect(as(db, OWNER, () => rows(db, "insert into public.businesses(organization_id,name,city,source_kind) values($1,'Bad Provenance','Accra','instagram')", [org]))).rejects.toThrow(/check constraint/i);
});
