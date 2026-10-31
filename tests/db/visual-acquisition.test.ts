import { afterAll, beforeAll, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { as, createDatabase, createUser, MIGRATIONS_DIR, rows } from './harness';

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
let asset: string;

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
  asset = (
    await as(db, OWNER, () =>
      rows<{ id: string }>(
        db,
        "insert into public.studio_assets(organization_id,project_id,file_name,kind,status,mime_type,bytes,checksum_sha256,storage_path,origin,owner_name,permission_evidence,inspect_permission,store_permission,prototype_permission,export_permission,publish_permission) values($1,$2,'lounge.png','venue_photo','candidate','image/png',1000,$3,$4,'third_party','Kofi Mensah','Written permission from the photographer, 31 October 2026.','granted','granted','granted','granted','unknown') returning id",
        [org, project, 'b'.repeat(64), `${org}/${project}/33333333-3333-4333-8333-333333333333/lounge.png`],
      ),
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
  rightsBasis = 'not_established',
  rightsEvidence: string | null = null,
) =>
  rows<{ id: string }>(
    db,
    `insert into public.visual_asset_candidates(organization_id,business_id,project_id,page_url,image_url,source_kind,image_type,label,relevance,status,imported_via,asset_id,checksum_sha256,rights_basis,rights_evidence)
     values($1,$2,$3,'https://resource-hotel.example.org',$4,$5,'logo','Harbour Hotel logo','Linked from the verified homepage. Being published is not permission.',$6,$7,$8,$9,$10,$11) returning id`,
    [targetOrg, business, project, image, sourceKind, status, importedVia, assetId, assetId ? 'a'.repeat(64) : null, rightsBasis, rightsEvidence],
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
  await expect(
    as(db, OWNER, () => insert(org, 'https://cdn.fictional-photographer.example.net/harbour/pool.jpg', 'third_party_reference', 'imported', 'downloaded', asset, 'written_permission', 'The photographer granted reuse in writing on 30 October 2026.')),
  ).rejects.toThrow(/check constraint/i);
  await as(db, OWNER, () => insert(org, 'https://cdn.fictional-photographer.example.net/harbour/pool.jpg', 'third_party_reference', 'imported', 'uploaded', asset, 'written_permission', 'The photographer granted reuse in writing on 30 October 2026.'));
});

it('refuses a stored candidate whose rights record is missing, even through a direct write', async () => {
  const [candidate] = await as(db, OWNER, () => insert(org, 'https://resource-hotel.example.org/media/direct-write.jpg'));
  // The API could try to skip the attestation by writing the columns directly. The table refuses.
  await expect(
    as(db, OWNER, () => db.query(
      "update public.visual_asset_candidates set status='imported', imported_via='downloaded', asset_id=$1, checksum_sha256=$2 where id=$3",
      [asset, 'c'.repeat(64), candidate.id],
    )),
  ).rejects.toThrow(/check constraint/i);
  await expect(
    as(db, OWNER, () => db.query(
      "update public.visual_asset_candidates set status='imported', imported_via='downloaded', asset_id=$1, checksum_sha256=$2, rights_basis='written_permission', rights_evidence='too short' where id=$3",
      [asset, 'c'.repeat(64), candidate.id],
    )),
  ).rejects.toThrow(/check constraint/i);
});

it('will not reopen a decision or swap the file a candidate stored', async () => {
  const [candidate] = await as(db, OWNER, () => insert(org, 'https://resource-hotel.example.org/media/stored-suite.jpg'));
  await as(db, OWNER, () => db.query(
    "update public.visual_asset_candidates set status='imported', imported_via='uploaded', asset_id=$1, checksum_sha256=$2, rights_basis='written_permission', rights_evidence='The owner supplied this file with written permission on 31 October 2026.' where id=$3",
    [asset, 'd'.repeat(64), candidate.id],
  ));
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set status='reference_only' where id=$1", [candidate.id]))).rejects.toThrow(/only move from reference-only/i);
  await expect(as(db, OWNER, () => db.query('update public.visual_asset_candidates set asset_id=null where id=$1', [candidate.id]))).rejects.toThrow(/cannot be swapped/i);
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set checksum_sha256=$2 where id=$1", [candidate.id, 'e'.repeat(64)]))).rejects.toThrow(/checksum cannot be rewritten/i);
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set imported_via='downloaded' where id=$1", [candidate.id]))).rejects.toThrow(/cannot be rewritten/i);
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set rights_evidence='A later claim that the file was licensed.' where id=$1", [candidate.id]))).rejects.toThrow(/rights record behind a stored file/i);
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set rights_basis='business_owned_website' where id=$1", [candidate.id]))).rejects.toThrow(/rights record behind a stored file/i);
  // A file from another prospect's vault cannot be attached to this candidate.
  const otherBusiness = (
    await as(db, OWNER, () => rows<{ id: string }>(db, "insert into public.businesses(organization_id,name,category,city,official_website) values($1,'Fictional Second Hotel','Hotel','Cape Coast','https://resource-hotel-two.example.org') returning id", [org]))
  )[0].id;
  const otherProject = (
    await as(db, OWNER, () => rows<{ id: string }>(db, "insert into public.studio_projects(organization_id,business_id,name) values($1,$2,'Second concept') returning id", [org, otherBusiness]))
  )[0].id;
  const otherAsset = (
    await as(db, OWNER, () => rows<{ id: string }>(db, "insert into public.studio_assets(organization_id,project_id,file_name,kind,status,mime_type,bytes,checksum_sha256,storage_path,origin,owner_name,permission_evidence,inspect_permission,store_permission,prototype_permission,export_permission,publish_permission) values($1,$2,'pool.png','venue_photo','candidate','image/png',1000,$3,$4,'third_party','Kofi Mensah','Written permission from the photographer, 31 October 2026.','granted','granted','granted','granted','unknown') returning id", [org, otherProject, 'f'.repeat(64), `${org}/${otherProject}/44444444-4444-4444-8444-444444444444/pool.png`]))
  )[0].id;
  const [second] = await as(db, OWNER, () => insert(org, 'https://resource-hotel.example.org/media/second-concept.jpg'));
  await expect(
    as(db, OWNER, () => db.query(
      "update public.visual_asset_candidates set status='imported', imported_via='uploaded', asset_id=$1, checksum_sha256=$2, rights_basis='written_permission', rights_evidence='The owner supplied this file with written permission on 31 October 2026.' where id=$3",
      [otherAsset, 'a'.repeat(64), second.id],
    )),
  ).rejects.toThrow(/must belong to this prospect’s vault/i);
});

it('leaves no PUBLIC privileges and no write power beyond select, insert and update', async () => {
  const [grants] = await rows<{ candidate_public: boolean; event_public: boolean; candidate_delete: boolean; event_delete: boolean; truncate: boolean; references: boolean }>(
    db,
    `select
       coalesce((select bool_or(grantee = 0) from aclexplode((select relacl from pg_class where oid = 'public.visual_asset_candidates'::regclass))), false) as candidate_public,
       coalesce((select bool_or(grantee = 0) from aclexplode((select relacl from pg_class where oid = 'public.visual_asset_candidate_events'::regclass))), false) as event_public,
       has_table_privilege('authenticated', 'public.visual_asset_candidates', 'DELETE') as candidate_delete,
       has_table_privilege('authenticated', 'public.visual_asset_candidate_events', 'DELETE') as event_delete,
       has_table_privilege('service_role', 'public.visual_asset_candidates', 'TRUNCATE') as truncate,
       has_table_privilege('service_role', 'public.visual_asset_candidates', 'REFERENCES') as references`,
  );
  expect(grants).toEqual({ candidate_public: false, event_public: false, candidate_delete: false, event_delete: false, truncate: false, references: false });
});

it('re-applies cleanly on a populated ledger and keeps every record', async () => {
  const [before] = await rows<{ count: number }>(db, 'select count(*)::int as count from public.visual_asset_candidates');
  expect(before.count).toBeGreaterThan(0);
  await db.exec(readFileSync(join(MIGRATIONS_DIR, '020_visual_asset_acquisition.sql'), 'utf8'));
  const [after] = await rows<{ count: number }>(db, 'select count(*)::int as count from public.visual_asset_candidates');
  expect(after.count).toBe(before.count);
  // The stricter checks survive the replay, and the ledger is still readable to a member.
  await expect(as(db, OWNER, () => db.query("update public.visual_asset_candidates set status='imported' where id=(select id from public.visual_asset_candidates where status='reference_only' limit 1)"))).rejects.toThrow(/check constraint|only move from reference-only/i);
  expect((await as(db, OWNER, () => rows(db, 'select * from public.visual_asset_candidates'))).length).toBe(before.count);
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

