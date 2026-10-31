import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createDatabase, createUser, rows } from './harness';

// Migration 020 at the database boundary: organizations cannot see or write each other's candidates,
// Google and social addresses are refused, discovery fields are immutable, rejections are final, and
// the decision history cannot be rewritten.

const OWNER = '00000000-0000-4000-8000-0000000a0101';
const VIEWER = '00000000-0000-4000-8000-0000000a0102';
const OTHER = '00000000-0000-4000-8000-0000000a0103';
let db: PGlite;
let org: string;
let otherOrg: string;
let business: string;
let project: string;

beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER, 'visual-owner@example.org');
  await createUser(db, VIEWER, 'visual-viewer@example.org');
  await createUser(db, OTHER, 'visual-other@example.org');
  org = (await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  otherOrg = (await as(db, OTHER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  await db.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'viewer')", [org, VIEWER]);
  business = (
    await as(db, OWNER, () =>
      rows<{ id: string }>(
        db,
        "insert into public.businesses(organization_id,name,category,city,official_website) values ($1,'Fictional Harbour Hotel','Hotel','Cape Coast','https://resource-hotel.example.org') returning id",
        [org],
      ),
    )
  )[0].id;
  project = (
    await as(db, OWNER, () =>
      rows<{ id: string }>(db, "insert into public.studio_projects(organization_id,business_id,name) values($1,$2,'Fictional Harbour Hotel — website concept') returning id", [org, business]),
    )
  )[0].id;
});

afterAll(async () => {
  await db?.close();
});

const insert = (
  targetOrg = org,
  image = 'https://resource-hotel.example.org/media/harbour-hotel-logo.png',
  sourceKind = 'official_site',
  status = 'reference_only',
  importedVia: string | null = null,
  assetId: string | null = null,
) =>
  rows<{ id: string }>(
    db,
    `insert into public.visual_asset_candidates(organization_id,business_id,project_id,page_url,image_url,source_kind,image_type,label,relevance,status,imported_via,asset_id,checksum_sha256)
     values($1,$2,$3,'https://resource-hotel.example.org',$4,$5,'logo','Harbour Hotel logo','Linked from the verified homepage. Being published is not permission.',$6,$7,$8,$9) returning id`,
    [targetOrg, business, project, image, sourceKind, status, importedVia, assetId, assetId ? 'a'.repeat(64) : null],
  );

it('isolates candidates by organization and refuses a business from another workspace', async () => {
  await as(db, OWNER, () => insert());
  expect(await as(db, OTHER, () => rows(db, 'select * from public.visual_asset_candidates'))).toEqual([]);
  await expect(as(db, OTHER, () => insert())).rejects.toThrow(/row.level security/i);
  await expect(as(db, OTHER, () => insert(otherOrg))).rejects.toThrow(/foreign key/i);
  await expect(as(db, null, () => rows(db, 'select * from public.visual_asset_candidates'))).rejects.toThrow(/permission denied/i);
});

it('refuses Google and social addresses before any download could happen', async () => {
  await expect(as(db, OWNER, () => insert(org, 'https://lh3.googleusercontent.com/places/photo'))).rejects.toThrow(/check constraint/i);
  await expect(as(db, OWNER, () => insert(org, 'https://scontent.cdninstagram.com/photo.jpg'))).rejects.toThrow(/check constraint/i);
});

it('never records a downloaded copy of a third-party file, but allows an uploaded original', async () => {
  const asset = (
    await as(db, OWNER, () =>
      rows<{ id: string }>(
        db,
        "insert into public.studio_assets(organization_id,project_id,file_name,kind,status,mime_type,bytes,checksum_sha256,storage_path,origin,owner_name,permission_evidence,inspect_permission,store_permission,prototype_permission,export_permission,publish_permission) values($1,$2,'lounge.png','venue_photo','candidate','image/png',1000,$3,$4,'third_party','Kofi Mensah','Written permission from the photographer, 31 October 2026.','granted','granted','granted','granted','unknown') returning id",
        [org, project, 'b'.repeat(64), `${org}/${project}/33333333-3333-4333-8333-333333333333/lounge.png`],
      ),
    )
  )[0].id;
  await expect(
    as(db, OWNER, () => insert(org, 'https://cdn.fictional-photographer.example.net/harbour/pool.jpg', 'third_party_reference', 'imported', 'downloaded', asset)),
  ).rejects.toThrow(/check constraint/i);
  await as(db, OWNER, () => insert(org, 'https://cdn.fictional-photographer.example.net/harbour/pool.jpg', 'third_party_reference', 'imported', 'uploaded', asset));
});

it('keeps discovery fields immutable and a rejection final', async () => {
  const [candidate] = await as(db, OWNER, () => insert(org, 'https://resource-hotel.example.org/media/suite-bedroom.jpg'));
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set image_url='https://resource-hotel.example.org/other.png' where id=$1", [candidate.id]))).rejects.toThrow(/immutable/i);
  await as(db, OWNER, () => db.query("update public.visual_asset_candidates set status='rejected', review_note='Licence could not be verified.' where id=$1", [candidate.id]));
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set status='reference_only' where id=$1", [candidate.id]))).rejects.toThrow(/stays rejected/i);
  expect((await rows(db, "select * from public.audit_events where table_name='visual_asset_candidates' and record_id=$1", [candidate.id])).length).toBeGreaterThanOrEqual(2);
});

it('keeps the decision history append-only and role-gated', async () => {
  const [candidate] = await as(db, OWNER, () => insert(org, 'https://resource-hotel.example.org/media/restaurant-dish.jpg'));
  const [event] = await as(db, OWNER, () => rows<{ id: string }>(db, "insert into public.visual_asset_candidate_events(organization_id,candidate_id,action,note) values($1,$2,'discovered','Found on the homepage') returning id", [org, candidate.id]));
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidate_events set note='changed' where id=$1", [event.id]))).rejects.toThrow(/append-only|permission denied/i);
  await expect(as(db, OWNER, () => db.query('delete from public.visual_asset_candidate_events where id=$1', [event.id]))).rejects.toThrow(/permission denied|append-only/i);
  await expect(as(db, VIEWER, () => insert(org, 'https://resource-hotel.example.org/media/hotel-exterior.jpg'))).rejects.toThrow(/row.level security/i);
  await expect(as(db, VIEWER, () => db.query("insert into public.visual_asset_candidate_events(organization_id,candidate_id,action) values($1,$2,'approved')", [org, candidate.id]))).rejects.toThrow(/row.level security/i);
  // The viewer may read what the workspace collected.
  expect((await as(db, VIEWER, () => rows(db, 'select * from public.visual_asset_candidates'))).length).toBeGreaterThan(0);
});

it('takes back the delete and truncate grants Supabase adds by default', async () => {
  await expect(as(db, OWNER, () => db.query('delete from public.visual_asset_candidates'))).rejects.toThrow(/permission denied/i);
  await expect(as(db, OWNER, () => db.query('truncate public.visual_asset_candidates'))).rejects.toThrow(/permission denied/i);
});

