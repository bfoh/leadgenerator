import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, createDatabase, createUser, rows } from './harness';

// Exercises migration 013 on PGlite: the vault's constraints, its append-only history, the Brand Kit's
// immutability, the private storage policies (against a stub of Supabase's storage schema) and the
// rollback. No real file is ever stored; the storage rows are paths.

const OWNER = '00000000-0000-4000-8000-00000000d1a1';
const RESEARCHER = '00000000-0000-4000-8000-00000000d1a2';
const SALES = '00000000-0000-4000-8000-00000000d1a3';
const VIEWER = '00000000-0000-4000-8000-00000000d1a4';
const OTHER = '00000000-0000-4000-8000-00000000d1b1';

/** The parts of Supabase Storage that migration 013's policies rely on. */
const STORAGE_STUB = `
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated, service_role;
  grant select, insert, update, delete on storage.buckets to authenticated, service_role;
`;

let db: PGlite;
let org: string;
let otherOrg: string;

const workspace = async (d: PGlite, user: string) => (await as(d, user, () => rows<{ org_id: string; member_role: string }>(d, 'select * from public.ensure_workspace()')))[0];

async function business(user: string, values: Record<string, unknown> = {}, d = db, organization = org) {
  const v = { name: `Vault Biz ${Math.random().toString(36).slice(2, 7)}`, city: 'Accra', ...values };
  const cols = ['organization_id', ...Object.keys(v)];
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(d, `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [organization, ...Object.values(v)]),
  );
  return row.id;
}

async function project(businessId: string, extra: Record<string, unknown> = {}, d = db, organization = org, user = OWNER) {
  const record = { organization_id: organization, business_id: businessId, name: 'Nsroma Atelier — website concept', ...extra };
  const cols = Object.keys(record);
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(d, `insert into public.studio_projects (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(record)),
  );
  return row.id;
}

type Asset = Record<string, unknown>;
const asset = (projectId: string, organization = org, extra: Asset = {}): Asset => ({
  organization_id: organization,
  project_id: projectId,
  file_name: 'nsroma-logo.png',
  kind: 'logo',
  mime_type: 'image/png',
  bytes: 4096,
  width: 1200,
  height: 800,
  checksum_sha256: 'a'.repeat(64),
  storage_path: `${organization}/${projectId}/${randomUUID()}/nsroma-logo.png`,
  origin: 'client_supplied',
  owner_name: 'Nsroma Atelier',
  permission_evidence: 'Email from the owner, 21 Oct 2026.',
  inspect_permission: 'granted',
  store_permission: 'granted',
  prototype_permission: 'granted',
  export_permission: 'granted',
  publish_permission: 'denied',
  ...extra,
});

async function insertAsset(projectId: string, extra: Asset = {}, user = OWNER, d = db, organization = org) {
  const record = asset(projectId, organization, extra);
  const cols = Object.keys(record);
  const [row] = await as(d, user, () =>
    rows<{ id: string; storage_path: string; status: string }>(
      d,
      `insert into public.studio_assets (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, storage_path, status`,
      Object.values(record),
    ),
  );
  return row;
}

const kitContent = (logoId: string | null, extra: Record<string, unknown> = {}) => ({
  logoAssetIds: logoId ? [logoId] : [],
  palette: [
    { name: 'Ink', hex: '#1B2A41', role: 'Text' },
    { name: 'Kente red', hex: '#7A1F3D', role: 'Accent' },
  ],
  typography: [{ role: 'Display', family: 'Fraunces', weights: '400–700', licence: 'SIL Open Font License 1.1', assetId: null }],
  photographyAssetIds: [],
  personality: ['Quietly confident', 'Exacting', 'Warm'],
  visualDirection: 'Editorial and unhurried: warm off-white, one deep red, photography given room to breathe.',
  toneOfVoice: { summary: 'Plain, precise and proud of the craft.', do: [], dont: [] },
  ...extra,
});

async function insertKit(projectId: string, d = db, organization = org, user = OWNER) {
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(d, `insert into public.studio_brand_kits (organization_id, project_id) values ($1, $2) returning id`, [organization, projectId]),
  );
  return row.id;
}

async function insertVersion(kitId: string, projectId: string, value: unknown, d = db, organization = org, user = OWNER, number = 1) {
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(
      d,
      `insert into public.studio_brand_kit_versions (organization_id, project_id, kit_id, version, content, note)
       values ($1, $2, $3, $4, $5::jsonb, 'First version') returning id`,
      [organization, projectId, kitId, number, JSON.stringify(value)],
    ),
  );
  return row.id;
}

beforeAll(async () => {
  db = await createDatabase({ before: { '013': async (d) => d.exec(STORAGE_STUB) } });
  await createUser(db, OWNER, 'owner13@example.com');
  await createUser(db, RESEARCHER, 'researcher13@example.com');
  await createUser(db, SALES, 'sales13@example.com');
  await createUser(db, VIEWER, 'viewer13@example.com');
  await createUser(db, OTHER, 'other13@example.com');
  org = (await workspace(db, OWNER)).org_id;
  otherOrg = (await workspace(db, OTHER)).org_id;
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values
        ($1, 'researcher13@example.com', 'researcher'),
        ($1, 'sales13@example.com', 'sales'),
        ($1, 'viewer13@example.com', 'viewer')`,
      [org],
    ),
  );
  expect((await workspace(db, RESEARCHER)).member_role).toBe('researcher');
  expect((await workspace(db, SALES)).member_role).toBe('sales');
  expect((await workspace(db, VIEWER)).member_role).toBe('viewer');
});

/** A fresh prospect per test: one live concept per business, as the Studio requires. */
async function newProject() {
  return project(await business(OWNER));
}

describe('the private bucket', () => {
  it('exists, is private and enforces the size and type limits', async () => {
    const [bucket] = await rows<{ id: string; public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      db,
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'studio-assets'`,
    );
    expect(bucket).toMatchObject({ id: 'studio-assets', public: false });
    expect(Number(bucket.file_size_limit)).toBe(26214400);
    expect(bucket.allowed_mime_types).toEqual(expect.arrayContaining(['image/png', 'application/pdf', 'font/woff2', 'video/mp4']));
    expect(bucket.allowed_mime_types).not.toContain('image/svg+xml');
  });

  it('lets a member read only their own organization’s objects', async () => {
    await as(db, OWNER, () => db.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`${org}/${randomUUID()}/logo.png`]));
    const own = await as(db, VIEWER, () => rows(db, `select name from storage.objects`));
    expect(own).toHaveLength(1);
    const foreign = await as(db, OTHER, () => rows(db, `select name from storage.objects`));
    expect(foreign).toEqual([]);
  });

  it('lets the research and sales roles upload, but only into their own tenant', async () => {
    await as(db, RESEARCHER, () => db.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`${org}/${randomUUID()}/photo.png`]));
    await expect(
      as(db, RESEARCHER, () => db.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`${otherOrg}/${randomUUID()}/photo.png`])),
    ).rejects.toThrow(/row-level security|violates/);
    await expect(
      as(db, VIEWER, () => db.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`${org}/${randomUUID()}/x.png`])),
    ).rejects.toThrow(/row-level security|violates/);
    await expect(
      as(db, OWNER, () => db.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`not-a-tenant/x.png`])),
    ).rejects.toThrow(/row-level security|violates/);
  });

  it('only lets owners and admins delete a stored object', async () => {
    await as(db, OWNER, () => db.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`${org}/${randomUUID()}/delete-me.png`]));
    const [row] = await rows<{ id: string }>(db, `select id from storage.objects where name like $1`, [`%delete-me.png`]);
    await as(db, SALES, () => db.query(`delete from storage.objects where id = $1`, [row.id]));
    expect(await rows(db, `select 1 from storage.objects where id = $1`, [row.id])).toHaveLength(1);
    await as(db, OWNER, () => db.query(`delete from storage.objects where id = $1`, [row.id]));
    expect(await rows(db, `select 1 from storage.objects where id = $1`, [row.id])).toEqual([]);
  });
});


describe('the asset record', () => {
  it('records a candidate with its provenance, permissions and audit entry', async () => {
    const projectId = await newProject();
    const created = await insertAsset(projectId, {}, RESEARCHER);
    const [row] = await as(db, VIEWER, () => rows<Record<string, unknown>>(db, `select * from public.studio_assets where id = $1`, [created.id]));
    expect(row).toMatchObject({ status: 'candidate', created_by: RESEARCHER, store_permission: 'granted', publish_permission: 'denied', bytes: 4096 });
    expect(String(row.storage_path)).toMatch(new RegExp(`^${org}/${projectId}/`));
    const audit = await rows(db, `select action, table_name from public.audit_events where record_id = $1`, [created.id]);
    expect(audit).toEqual([{ action: 'insert', table_name: 'studio_assets' }]);
  });

  it('refuses a path from another tenant, a kind that does not fit the file, and a bad pair of dimensions', async () => {
    const projectId = await newProject();
    await expect(insertAsset(projectId, { storage_path: `${otherOrg}/${projectId}/${randomUUID()}/logo.png` })).rejects.toThrow(/studio_asset_path_tenant/);
    await expect(insertAsset(projectId, { kind: 'video' })).rejects.toThrow(/studio_asset_kind_file/);
    await expect(insertAsset(projectId, { width: 1200, height: null })).rejects.toThrow(/studio_asset_dimensions/);
    await expect(insertAsset(projectId, { mime_type: 'image/svg+xml' })).rejects.toThrow(/studio_assets_mime_type_check/);
    await expect(insertAsset(projectId, { checksum_sha256: 'nope' })).rejects.toThrow(/studio_assets_checksum_sha256_check/);
  });

  it('never clears a file for use when we may not keep it', async () => {
    const projectId = await newProject();
    await expect(insertAsset(projectId, { store_permission: 'denied', publish_permission: 'granted' })).rejects.toThrow(/studio_asset_permission_logic/);
  });

  it('requires a stamp for approval, a reason for rejection and revocation, and a current licence', async () => {
    const projectId = await newProject();
    await expect(insertAsset(projectId, { status: 'approved' })).rejects.toThrow(/studio_asset_approved/);
    await expect(insertAsset(projectId, { status: 'rejected' })).rejects.toThrow(/studio_asset_rejected/);
    await expect(insertAsset(projectId, { status: 'revoked' })).rejects.toThrow(/studio_asset_revoked/);
    await expect(
      insertAsset(projectId, { status: 'approved', approved_at: new Date().toISOString(), licence_expires_on: '2020-01-01' }),
    ).rejects.toThrow(/studio_asset_licence_current/);
    const approved = await insertAsset(projectId, { status: 'approved', approved_at: new Date().toISOString(), licence_expires_on: '2099-01-01' });
    expect(approved.status).toBe('approved');
  });

  // The production failure of 25 Oct 2026: the approval service updated the row with the new status
  // alone, so Postgres refused it. The same statement fails here, and the statement the service now
  // writes succeeds.
  it('refuses an approval update that forgets its timestamp, and accepts the decision the service writes', async () => {
    const projectId = await newProject();
    const candidate = await insertAsset(projectId);

    await expect(
      as(db, OWNER, () => db.query(`update public.studio_assets set status = 'approved' where id = $1`, [candidate.id])),
    ).rejects.toThrow(/studio_asset_approved/);

    const [untouched] = await rows<Record<string, unknown>>(db, `select status, approved_at from public.studio_assets where id = $1`, [candidate.id]);
    expect(untouched).toMatchObject({ status: 'candidate', approved_at: null });

    await as(db, OWNER, () =>
      db.query(`update public.studio_assets set status = 'approved', approved_at = now(), approved_by = $2 where id = $1`, [
        candidate.id,
        OWNER,
      ]),
    );
    const [row] = await rows<Record<string, unknown>>(db, `select status, approved_at, approved_by from public.studio_assets where id = $1`, [candidate.id]);
    expect(row).toMatchObject({ status: 'approved', approved_by: OWNER });
    expect(row.approved_at).not.toBeNull();
  });

  it('refuses the same private path twice in one concept, but allows it in another', async () => {
    const projectId = await newProject();
    const first = await insertAsset(projectId);
    await expect(insertAsset(projectId, { storage_path: first.storage_path })).rejects.toThrow(/studio_assets_project_id_storage_path_key/);
    const second = await project(await business(OWNER));
    const reused = await insertAsset(second, { storage_path: first.storage_path.replace(projectId, second) });
    expect(reused.id).not.toBe(first.id);
  });
});


describe('roles, isolation and history', () => {
  it('lets members read, researchers and sales write, and only owners or admins delete', async () => {
    const projectId = await newProject();
    const created = await insertAsset(projectId, {}, RESEARCHER);
    expect(await as(db, VIEWER, () => rows(db, `select id from public.studio_assets where id = $1`, [created.id]))).toHaveLength(1);
    await as(db, SALES, () => db.query(`update public.studio_assets set note = 'Ask for the vector original.' where id = $1`, [created.id]));
    expect((await as(db, VIEWER, () => db.query(`update public.studio_assets set note = 'no' where id = $1`, [created.id]))).affectedRows).toBe(0);
    expect((await as(db, RESEARCHER, () => db.query(`delete from public.studio_assets where id = $1`, [created.id]))).affectedRows).toBe(0);
    expect(await rows(db, `select 1 from public.studio_assets where id = $1`, [created.id])).toHaveLength(1);
    await as(db, OWNER, () => db.query(`delete from public.studio_assets where id = $1`, [created.id]));
    expect(await rows(db, `select 1 from public.studio_assets where id = $1`, [created.id])).toEqual([]);
  });

  it('keeps one organization’s vault invisible to another', async () => {
    const projectId = await newProject();
    const created = await insertAsset(projectId);
    expect(await as(db, OTHER, () => rows(db, `select id from public.studio_assets where id = $1`, [created.id]))).toEqual([]);
    const otherShop = await business(OTHER, {}, db, otherOrg);
    const otherProject = await project(otherShop, {}, db, otherOrg, OTHER);
    await expect(insertAsset(otherProject, { project_id: projectId }, OTHER, db, otherOrg)).rejects.toThrow(/foreign key|studio_assets_project_fk/);
  });

  it('records history that cannot be rewritten or filed against another concept', async () => {
    const projectId = await newProject();
    const otherProject = await project(await business(OWNER));
    const created = await insertAsset(projectId);
    const [event] = await as(db, OWNER, () =>
      rows<{ id: string }>(
        db,
        `insert into public.studio_asset_events (organization_id, project_id, asset_id, action, note) values ($1, $2, $3, 'uploaded', 'Added') returning id`,
        [org, projectId, created.id],
      ),
    );
    await expect(
      as(db, OWNER, () => db.query(`insert into public.studio_asset_events (organization_id, project_id, asset_id, action) values ($1, $2, $3, 'approved')`, [org, otherProject, created.id])),
    ).rejects.toThrow(/foreign key/);
    await expect(as(db, OWNER, () => db.query(`update public.studio_asset_events set note = 'edited' where id = $1`, [event.id]))).rejects.toThrow(/permission denied|append-only/);
    await expect(as(db, OWNER, () => db.query(`delete from public.studio_asset_events where id = $1`, [event.id]))).rejects.toThrow(/permission denied|append-only/);
    await as(db, OWNER, () => db.query(`delete from public.studio_assets where id = $1`, [created.id]));
    expect(await rows(db, `select 1 from public.studio_asset_events where id = $1`, [event.id])).toEqual([]);
  });

  it('records remote references as addresses only, and can decline them', async () => {
    const projectId = await newProject();
    const [reference] = await as(db, SALES, () =>
      rows<{ id: string; status: string }>(
        db,
        `insert into public.studio_asset_references (organization_id, project_id, address, label, source, note)
         values ($1, $2, 'https://maps.google.com/place/nsroma', 'Shopfront photograph', 'platform_listing', 'Not ours to download.') returning id, status`,
        [org, projectId],
      ),
    );
    expect(reference.status).toBe('recorded');
    await expect(
      as(db, SALES, () =>
        db.query(
          `insert into public.studio_asset_references (organization_id, project_id, address, label, source)
           values ($1, $2, 'https://maps.google.com/place/nsroma', 'Again', 'platform_listing')`,
          [org, projectId],
        ),
      ),
    ).rejects.toThrow(/studio_asset_references_project_id_address_key/);
    await expect(
      as(db, SALES, () =>
        db.query(
          `insert into public.studio_asset_references (organization_id, project_id, address, label, source)
           values ($1, $2, 'ftp://x', 'Bad', 'public_page')`,
          [org, projectId],
        ),
      ),
    ).rejects.toThrow(/studio_asset_references_address_check/);
    await as(db, SALES, () => db.query(`update public.studio_asset_references set status = 'declined' where id = $1`, [reference.id]));
    expect(await as(db, VIEWER, () => rows(db, `select status from public.studio_asset_references where id = $1`, [reference.id]))).toEqual([{ status: 'declined' }]);
    const viewerUpdate = await as(db, VIEWER, () => db.query(`update public.studio_asset_references set status = 'recorded' returning id`));
    expect(viewerUpdate.rows).toEqual([]);
  });

  it('deletes the whole vault with its concept, and the concept with its prospect', async () => {
    const projectId = await newProject();
    const created = await insertAsset(projectId, { status: 'approved', approved_at: new Date().toISOString() });
    const kitId = await insertKit(projectId);
    const versionId = await insertVersion(kitId, projectId, kitContent(created.id));
    await as(db, OWNER, () =>
      db.query(`insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1, $2, $3, $4, 'Agreed.')`, [org, projectId, kitId, versionId]),
    );
    await as(db, OWNER, () => db.query(`delete from public.studio_projects where id = $1`, [projectId]));
    for (const table of ['studio_assets', 'studio_asset_events', 'studio_asset_references', 'studio_brand_kits', 'studio_brand_kit_versions', 'studio_brand_kit_approvals']) {
      expect(await rows(db, `select 1 from public.${table} where project_id = $1`, [projectId])).toEqual([]);
    }
  });
});


describe('the Brand Kit', () => {
  it('keeps one kit per concept and only lets approved files into a version', async () => {
    const projectId = await newProject();
    const kitId = await insertKit(projectId);
    await expect(insertKit(projectId)).rejects.toThrow(/studio_brand_kits_project_id_key/);
    const candidate = await insertAsset(projectId);
    await expect(insertVersion(kitId, projectId, kitContent(candidate.id))).rejects.toThrow(/not an approved asset/);
    const approved = await insertAsset(projectId, { status: 'approved', approved_at: new Date().toISOString() });
    const versionId = await insertVersion(kitId, projectId, kitContent(approved.id));
    expect(await rows(db, `select 1 from public.studio_brand_kit_versions where id = $1`, [versionId])).toHaveLength(1);
  });

  it('refuses a version missing a section, and one numbered twice', async () => {
    const projectId = await newProject();
    const kitId = await insertKit(projectId);
    const incomplete = { ...kitContent(null) } as Record<string, unknown>;
    delete incomplete.palette;
    await expect(insertVersion(kitId, projectId, incomplete)).rejects.toThrow(/needs logos, a palette/);
    await insertVersion(kitId, projectId, kitContent(null), db, org, OWNER, 1);
    await expect(insertVersion(kitId, projectId, kitContent(null), db, org, OWNER, 1)).rejects.toThrow(/studio_brand_kit_versions_kit_id_version_key/);
  });

  it('keeps versions and approvals immutable, with the reason on the approval', async () => {
    const projectId = await newProject();
    const kitId = await insertKit(projectId);
    const approved = await insertAsset(projectId, { status: 'approved', approved_at: new Date().toISOString() });
    const versionId = await insertVersion(kitId, projectId, kitContent(approved.id));
    await expect(as(db, OWNER, () => db.query(`update public.studio_brand_kit_versions set note = 'edited' where id = $1`, [versionId]))).rejects.toThrow(/permission denied|immutable/);
    await expect(as(db, OWNER, () => db.query(`delete from public.studio_brand_kit_versions where id = $1`, [versionId]))).rejects.toThrow(/permission denied|immutable/);
    await expect(
      as(db, OWNER, () =>
        db.query(`insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1, $2, $3, $4, 'no')`, [org, projectId, kitId, versionId]),
      ),
    ).rejects.toThrow(/studio_brand_kit_approvals_note_check/);
    const [approval] = await as(db, OWNER, () =>
      rows<{ id: string; approved_by: string }>(
        db,
        `insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1, $2, $3, $4, 'Agreed on 25 October.') returning id, approved_by`,
        [org, projectId, kitId, versionId],
      ),
    );
    expect(approval.approved_by).toBe(OWNER);
    await expect(
      as(db, OWNER, () =>
        db.query(`insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1, $2, $3, $4, 'Again.')`, [org, projectId, kitId, versionId]),
      ),
    ).rejects.toThrow(/studio_brand_kit_approvals_version_id_key/);
    await expect(as(db, OWNER, () => db.query(`update public.studio_brand_kit_approvals set note = 'edited' where id = $1`, [approval.id]))).rejects.toThrow(/permission denied|append-only/);
    await expect(as(db, OWNER, () => db.query(`delete from public.studio_brand_kit_approvals where id = $1`, [approval.id]))).rejects.toThrow(/permission denied|append-only/);
  });

  it('refuses to approve an older version after a newer one', async () => {
    const projectId = await newProject();
    const kitId = await insertKit(projectId);
    const approved = await insertAsset(projectId, { status: 'approved', approved_at: new Date().toISOString() });
    const first = await insertVersion(kitId, projectId, kitContent(approved.id), db, org, OWNER, 1);
    const second = await insertVersion(kitId, projectId, kitContent(approved.id), db, org, OWNER, 2);
    await as(db, OWNER, () =>
      db.query(`insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1, $2, $3, $4, 'Latest.')`, [org, projectId, kitId, second]),
    );
    await expect(
      as(db, OWNER, () =>
        db.query(`insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1, $2, $3, $4, 'Older.')`, [org, projectId, kitId, first]),
      ),
    ).rejects.toThrow(/older than the approved version/);
  });

  it('lets members read the kit and only writers write it', async () => {
    const projectId = await newProject();
    const kitId = await insertKit(projectId, db, org, RESEARCHER);
    expect(await as(db, VIEWER, () => rows(db, `select id from public.studio_brand_kits where id = $1`, [kitId]))).toHaveLength(1);
    await expect(insertVersion(kitId, projectId, kitContent(null), db, org, VIEWER)).rejects.toThrow(/row-level security|violates/);
    expect(await insertVersion(kitId, projectId, kitContent(null), db, org, RESEARCHER)).toBeTruthy();
  });
});


describe('re-running and rollback', () => {
  it('applies again without changing data', async () => {
    const projectId = await newProject();
    const created = await insertAsset(projectId);
    const count = async () => (await rows<{ n: number }>(db, 'select (select count(*) from public.studio_assets) + (select count(*) from public.studio_asset_references) as n'))[0].n;
    const before = await count();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '013_studio_asset_vault.sql'), 'utf8'));
    expect(await count()).toBe(before);
    expect(await rows(db, `select 1 from public.studio_assets where id = $1`, [created.id])).toHaveLength(1);
  });

  it('removes itself, its bucket and its policies, and can be applied again', async () => {
    const d = await createDatabase({ before: { '013': async (client) => client.exec(STORAGE_STUB) } });
    await createUser(d, OWNER, 'owner13b@example.com');
    const localOrg = (await workspace(d, OWNER)).org_id;
    const localShop = await business(OWNER, { name: 'Keep Me' }, d, localOrg);
    const projectId = await project(localShop, {}, d, localOrg);
    await insertAsset(projectId, {}, OWNER, d, localOrg);
    await d.query(`insert into storage.objects (bucket_id, name) values ('studio-assets', $1)`, [`${localOrg}/${projectId}/${randomUUID()}/logo.png`]);

    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '013_studio_asset_vault_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name::text from information_schema.tables where table_schema = 'public' and table_name like 'studio_asset%'
       union all select table_name::text from information_schema.tables where table_schema = 'public' and table_name like 'studio_brand_kit%'
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'guard_studio_asset%'
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname like 'guard_studio_brand_kit%'
       union all select policyname::text from pg_policies where schemaname = 'storage' and policyname like 'studio_assets_storage%'
       union all select id::text from storage.buckets where id = 'studio-assets'`,
    );
    expect(leftovers).toEqual([]);
    expect(await rows(d, `select 1 from public.studio_projects where id = $1`, [projectId])).toHaveLength(1);

    await d.exec(readFileSync(join(MIGRATIONS_DIR, '013_studio_asset_vault.sql'), 'utf8'));
    const again = await insertAsset(projectId, {}, OWNER, d, localOrg);
    expect(again.status).toBe('candidate');
    expect(await rows(d, `select id from storage.buckets where id = 'studio-assets'`)).toHaveLength(1);
    await d.close();
  });
});

