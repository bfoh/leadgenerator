import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createDatabase, createUser, rows } from './harness';
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
