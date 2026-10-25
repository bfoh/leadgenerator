import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Exercises migration 012 (Studio concepts, append-only evidence and reviews) on PGlite: the
// one-live-concept rule, the classification constraints that keep a guess from looking like a fact,
// append-only history for people and the service role alike, workspace roles, the audit trail, and
// the rollback.

const OWNER = '00000000-0000-4000-8000-00000000c1a1';
const RESEARCHER = '00000000-0000-4000-8000-00000000c1a2';
const SALES = '00000000-0000-4000-8000-00000000c1a3';
const VIEWER = '00000000-0000-4000-8000-00000000c1a4';
const OTHER = '00000000-0000-4000-8000-00000000c1b1';

let db: PGlite;
let org: string;
let otherOrg: string;
let shop: string;

const workspace = async (d: PGlite, user: string) => (await as(d, user, () => rows<{ org_id: string; member_role: string }>(d, 'select * from public.ensure_workspace()')))[0];

async function business(user: string, values: Record<string, unknown> = {}, d = db, organization = org) {
  const v = { name: `Studio Biz ${Math.random().toString(36).slice(2, 7)}`, city: 'Accra', ...values };
  const cols = ['organization_id', ...Object.keys(v)];
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(d, `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [organization, ...Object.values(v)]),
  );
  return row.id;
}

type Project = Record<string, unknown>;
const project = (businessId: string, extra: Project = {}): Project => ({
  organization_id: org,
  business_id: businessId,
  name: 'Nsroma Atelier — website concept',
  ...extra,
});

async function insertProject(businessId: string, extra: Project = {}, user = OWNER, d = db) {
  const record = project(businessId, extra);
  const cols = Object.keys(record);
  const [row] = await as(d, user, () =>
    rows<{ id: string; status: string; created_by: string | null }>(d, `insert into public.studio_projects (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, status, created_by`, Object.values(record)),
  );
  return row;
}

type Observation = Record<string, unknown>;
const observation = (projectId: string, extra: Observation = {}): Observation => ({
  organization_id: org,
  project_id: projectId,
  run_number: 1,
  key: 'identity.name',
  classification: 'verified_fact',
  category: 'identity',
  label: 'Business name on the site',
  detail: 'The site gives "Nsroma Atelier" in structured data.',
  confidence: 90,
  reuse_permission: 'permitted',
  source_kind: 'website_page',
  source_url: 'https://nsromaatelier.example',
  observed_at: new Date().toISOString(),
  ...extra,
});

async function insertObservation(projectId: string, extra: Observation = {}, user = OWNER, d = db) {
  const record = observation(projectId, extra);
  const cols = Object.keys(record);
  const [row] = await as(d, user, () =>
    rows<{ id: string; created_by: string | null }>(d, `insert into public.studio_observations (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, created_by`, Object.values(record)),
  );
  return row;
}

beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER, 'owner12@example.com');
  org = (await workspace(db, OWNER)).org_id;
  for (const [id, email] of [
    [RESEARCHER, 'researcher12@example.com'],
    [SALES, 'sales12@example.com'],
    [VIEWER, 'viewer12@example.com'],
    [OTHER, 'other12@example.com'],
  ]) {
    await createUser(db, id, email);
  }
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values ($1, 'researcher12@example.com', 'researcher'), ($1, 'sales12@example.com', 'sales'), ($1, 'viewer12@example.com', 'viewer')`,
      [org],
    ),
  );
  expect((await workspace(db, SALES)).member_role).toBe('sales');
  expect((await workspace(db, VIEWER)).member_role).toBe('viewer');
  expect((await workspace(db, RESEARCHER)).member_role).toBe('researcher');
  otherOrg = (await workspace(db, OTHER)).org_id;
  shop = await business(OWNER, { name: 'Nsroma Atelier', category: 'Fashion and tailoring', official_website: 'https://nsromaatelier.example' });
});


describe('concepts', () => {
  it('allow one live concept per prospect, but keep archived ones without limit', async () => {
    const first = await insertProject(shop);
    expect(first.status).toBe('draft');
    expect(first.created_by).toBe(OWNER);
    await expect(insertProject(shop)).rejects.toThrow(/studio_projects_business_uidx|duplicate key/);

    // Archived concepts stay as history and do not block a new one.
    await as(db, OWNER, () => db.query(`update public.studio_projects set status = 'archived' where id = $1`, [first.id]));
    const second = await insertProject(shop);
    expect(second.status).toBe('draft');
    await as(db, OWNER, () => db.query(`update public.studio_projects set status = 'archived' where id = $1`, [second.id]));
    await expect(insertProject(shop, { status: 'archived' })).resolves.toBeTruthy();
  });

  it('stamp a recorded analysis outcome with the time it happened', async () => {
    const b = await business(OWNER);
    await expect(insertProject(b, { intelligence_status: 'ready' })).rejects.toThrow(/studio_project_analysis_stamped/);
    const ready = await insertProject(b, { intelligence_status: 'unavailable', intelligence_at: new Date().toISOString() });
    expect(ready.status).toBe('draft');
  });

  it('validate the name, address and brief, and audit every change', async () => {
    const b = await business(OWNER);
    await expect(insertProject(b, { name: '   ' })).rejects.toThrow(/name/);
    await expect(insertProject(b, { website_url: 'nsromaatelier.example' })).rejects.toThrow(/website_url/);
    await expect(insertProject(b, { brief: 'x'.repeat(5001) })).rejects.toThrow(/brief/);
    const created = await insertProject(b, { brief: 'Rebuild around WhatsApp orders.' });
    await as(db, OWNER, () => db.query(`update public.studio_projects set brief = 'Rebuild around WhatsApp orders and delivery.' where id = $1`, [created.id]));
    const audit = await rows<{ action: string; changes: Record<string, unknown> }>(
      db,
      `select action, changes from public.audit_events where table_name = 'studio_projects' and record_id = $1 order by id`,
      [created.id],
    );
    expect(audit.map((row) => row.action)).toEqual(['insert', 'update']);
    expect(Object.keys(audit[1].changes)).toEqual(['brief']);
  });

  it('announce a concept on the prospect timeline', async () => {
    const b = await business(OWNER);
    await as(db, OWNER, () => db.query(`insert into public.activities (organization_id, business_id, type, summary) values ($1, $2, 'studio', 'Website concept started')`, [org, b]));
    expect(await rows(db, `select 1 from public.activities where business_id = $1 and type = 'studio'`, [b])).toHaveLength(1);
  });
});

describe('evidence', () => {
  it('keeps a reference and its kind together, and only on a restricted entry', async () => {
    const { id } = await insertProject(await business(OWNER));
    const logo = await insertObservation(id, {
      key: 'asset.logo.1',
      classification: 'restricted',
      category: 'logo',
      label: 'Logo reference 1',
      reuse_permission: 'reference_only',
      asset_url: 'https://static.wixstatic.com/media/nsroma-logo.png',
      asset_kind: 'logo',
    });
    expect(logo.id).toBeTruthy();
    await expect(insertObservation(id, { key: 'asset.logo.2', classification: 'restricted', asset_url: 'https://example.org/a.png' })).rejects.toThrow(/asset_pair|asset_kind/);
    await expect(insertObservation(id, { key: 'identity.fake', asset_url: 'https://example.org/a.png', asset_kind: 'image' })).rejects.toThrow(/asset_restricted/);
  });

  it('never attributes our own suggestions to the page', async () => {
    const { id } = await insertProject(await business(OWNER));
    await expect(
      insertObservation(id, { key: 'suggestion.hero', classification: 'creative_suggestion', category: 'content', source_kind: 'website_page' }),
    ).rejects.toThrow(/suggestion_source/);
    const suggestion = await insertObservation(id, {
      key: 'suggestion.hero',
      classification: 'creative_suggestion',
      category: 'content',
      label: 'Homepage opening',
      reuse_permission: 'permitted',
      source_kind: 'system',
      source_url: null,
    });
    expect(suggestion.id).toBeTruthy();
  });

  it('keeps the address that page-derived evidence came from', async () => {
    const { id } = await insertProject(await business(OWNER));
    for (const classification of ['verified_fact', 'placeholder', 'restricted']) {
      await expect(insertObservation(id, { key: `no-source.${classification}`, classification, source_url: null })).rejects.toThrow(/page_provenance/);
    }
    await expect(
      insertObservation(id, { key: 'unknown.location', classification: 'unknown', category: 'identity', label: 'Second location', source_url: null, reuse_permission: 'unknown' }),
    ).resolves.toBeTruthy();
  });

  it('allows one entry per key in a run, numbered from 1 to 100', async () => {
    const { id } = await insertProject(await business(OWNER));
    await insertObservation(id);
    await expect(insertObservation(id)).rejects.toThrow(/studio_observations_project_id_run_number_key_key|duplicate key/);
    await expect(insertObservation(id, { key: 'identity.name', run_number: 2 })).resolves.toBeTruthy();
    await expect(insertObservation(id, { key: 'elsewhere', run_number: 0 })).rejects.toThrow(/run_number/);
    await expect(insertObservation(id, { key: 'elsewhere', run_number: 101 })).rejects.toThrow(/run_number/);
  });

  it('rejects values the Studio does not classify that way', async () => {
    const { id } = await insertProject(await business(OWNER));
    await expect(insertObservation(id, { classification: 'guess' })).rejects.toThrow(/classification/);
    await expect(insertObservation(id, { category: 'vibes' })).rejects.toThrow(/category/);
    await expect(insertObservation(id, { confidence: 101 })).rejects.toThrow(/confidence/);
    await expect(insertObservation(id, { reuse_permission: 'free' })).rejects.toThrow(/reuse_permission/);
    await expect(insertObservation(id, { label: ' ' })).rejects.toThrow(/label/);
    await expect(insertObservation(id, { detail: 'x'.repeat(2001) })).rejects.toThrow(/detail/);
  });
});


describe('append-only history', () => {
  it('refuses to edit evidence, for people and the service role', async () => {
    const { id } = await insertProject(await business(OWNER));
    const entry = await insertObservation(id);
    // People only hold select and insert on evidence; the trigger stops the service role too.
    await expect(as(db, OWNER, () => db.query(`update public.studio_observations set label = 'Rewritten' where id = $1`, [entry.id]))).rejects.toThrow(/permission denied/);
    await expect(
      asServiceRole(db, () => db.query(`update public.studio_observations set confidence = 100 where id = $1`, [entry.id])),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to delete evidence while the concept exists, and lets the concept take it with it', async () => {
    const b = await business(OWNER);
    const { id } = await insertProject(b);
    const entry = await insertObservation(id);
    await expect(as(db, OWNER, () => db.query(`delete from public.studio_observations where id = $1`, [entry.id]))).rejects.toThrow(/permission denied/);
    await expect(
      asServiceRole(db, () => db.query(`delete from public.studio_observations where id = $1`, [entry.id])),
    ).rejects.toThrow(/delete the project/);

    await as(db, OWNER, () => db.query(`delete from public.studio_projects where id = $1`, [id]));
    expect(await rows(db, `select 1 from public.studio_observations where project_id = $1`, [id])).toEqual([]);
  });

  it('deletes concepts with the business they were made for', async () => {
    const b = await business(OWNER);
    const { id } = await insertProject(b);
    await insertObservation(id);
    await as(db, OWNER, () => db.query(`insert into public.studio_reviews (organization_id, project_id, decision, note) values ($1, $2, 'note', 'Worth a second look')`, [org, id]));
    await as(db, OWNER, () => db.query(`delete from public.businesses where id = $1`, [b]));
    expect(await rows(db, `select 1 from public.studio_projects where id = $1`, [id])).toEqual([]);
    expect(await rows(db, `select 1 from public.studio_observations where project_id = $1`, [id])).toEqual([]);
    expect(await rows(db, `select 1 from public.studio_reviews where project_id = $1`, [id])).toEqual([]);
  });
});

describe('reviews', () => {
  it('need a reason unless they simply confirm an entry', async () => {
    const { id } = await insertProject(await business(OWNER));
    const entry = await insertObservation(id);
    const review = (decision: string, note: string, observationId: string | null = entry.id) =>
      as(db, OWNER, () =>
        db.query(`insert into public.studio_reviews (organization_id, project_id, observation_id, decision, note) values ($1, $2, $3, $4, $5)`, [org, id, observationId, decision, note]),
      );
    await expect(review('confirm', '')).resolves.toBeTruthy();
    await expect(review('reject', '  ')).rejects.toThrow(/studio_review_note_required/);
    await expect(review('note', '')).rejects.toThrow(/studio_review_note_required/);
    await expect(review('reject', 'The page says Tema, not Accra.')).resolves.toBeTruthy();
    await expect(review('approve', 'Looks fine to me')).rejects.toThrow(/decision/);
  });

  it('can be filed against the concept as a whole', async () => {
    const { id } = await insertProject(await business(OWNER));
    await as(db, OWNER, () =>
      db.query(`insert into public.studio_reviews (organization_id, project_id, observation_id, decision, note) values ($1, $2, null, 'note', 'The brief needs the owner’s voice')`, [org, id]),
    );
    expect(await rows(db, `select 1 from public.studio_reviews where project_id = $1 and observation_id is null`, [id])).toHaveLength(1);
  });

  it('only judge evidence from their own concept', async () => {
    const { id } = await insertProject(await business(OWNER));
    const other = await insertProject(await business(OWNER));
    const entry = await insertObservation(other.id);
    await expect(
      as(db, OWNER, () =>
        db.query(`insert into public.studio_reviews (organization_id, project_id, observation_id, decision, note) values ($1, $2, $3, 'note', 'Cross-project review')`, [org, id, entry.id]),
      ),
    ).rejects.toThrow(/studio_reviews_observation_id_project_id_organization_id_fkey|foreign key/);
  });

  it('are append-only, for people and the service role', async () => {
    const { id } = await insertProject(await business(OWNER));
    const [review] = await as(db, OWNER, () =>
      rows<{ id: string }>(db, `insert into public.studio_reviews (organization_id, project_id, decision, note) values ($1, $2, 'note', 'First pass') returning id`, [org, id]),
    );
    await expect(as(db, OWNER, () => db.query(`update public.studio_reviews set note = 'Edited' where id = $1`, [review.id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, OWNER, () => db.query(`delete from public.studio_reviews where id = $1`, [review.id]))).rejects.toThrow(/permission denied/);
    await expect(asServiceRole(db, () => db.query(`delete from public.studio_reviews where id = $1`, [review.id]))).rejects.toThrow(/delete the project/);
  });
});


describe('workspace roles', () => {
  it('let members read, and researchers and sales build the concept', async () => {
    const b = await business(OWNER);
    const created = await insertProject(b, {}, SALES);
    expect(created.id).toBeTruthy();

    // A viewer sees the concept and its evidence but cannot add either.
    expect(await as(db, VIEWER, () => rows(db, `select 1 from public.studio_projects where id = $1`, [created.id]))).toHaveLength(1);
    await expect(insertProject(await business(OWNER), {}, VIEWER)).rejects.toThrow(/row-level security|permission/);
    await expect(insertObservation(created.id, {}, VIEWER)).rejects.toThrow(/row-level security|permission/);

    const entry = await insertObservation(created.id, {}, RESEARCHER);
    await expect(
      as(db, VIEWER, () => db.query(`insert into public.studio_reviews (organization_id, project_id, observation_id, decision, note) values ($1, $2, $3, 'note', 'Not my call')`, [org, created.id, entry.id])),
    ).rejects.toThrow(/row-level security|permission/);
  });

  it('keep concepts private to their workspace', async () => {
    expect(otherOrg).not.toBe(org);
    const b = await business(OWNER);
    const { id } = await insertProject(b);
    await as(db, OTHER, async () => {
      expect(await rows(db, `select 1 from public.studio_projects where id = $1`, [id])).toEqual([]);
      await expect(
        db.query(`insert into public.studio_projects (organization_id, business_id, name) values ($1, $2, 'Someone else’s concept')`, [org, b]),
      ).rejects.toThrow(/row-level security|permission/);
    });
  });

  it('only let owners and admins delete a concept', async () => {
    const b = await business(OWNER);
    const { id } = await insertProject(b);
    await as(db, SALES, () => db.query(`delete from public.studio_projects where id = $1`, [id]));
    expect(await rows(db, `select 1 from public.studio_projects where id = $1`, [id])).toHaveLength(1);
    await as(db, RESEARCHER, () => db.query(`delete from public.studio_projects where id = $1`, [id]));
    expect(await rows(db, `select 1 from public.studio_projects where id = $1`, [id])).toHaveLength(1);
    await as(db, OWNER, () => db.query(`delete from public.studio_projects where id = $1`, [id]));
    expect(await rows(db, `select 1 from public.studio_projects where id = $1`, [id])).toEqual([]);
  });
});

describe('re-running, independence and rollback', () => {
  it('applies again without changing data', async () => {
    const b = await business(OWNER);
    const { id } = await insertProject(b);
    await insertObservation(id);
    const count = async () => (await rows<{ n: number }>(db, 'select (select count(*) from public.studio_projects) + (select count(*) from public.studio_observations) as n'))[0].n;
    const before = await count();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '012_studio_brand_intelligence.sql'), 'utf8'));
    expect(await count()).toBe(before);
  });

  it('applies on the workspace model alone', async () => {
    const d = await createDatabase({ skip: ['003', '004', '005', '006', '007', '008', '009', '010', '011'] });
    await createUser(d, OWNER, 'owner12@example.com');
    const { org_id } = await workspace(d, OWNER);
    const b = await business(OWNER, {}, d, org_id);
    const { id } = await insertProject(b, { organization_id: org_id }, OWNER, d);
    await insertObservation(id, { organization_id: org_id }, OWNER, d);
    expect(await rows(d, `select 1 from public.studio_observations where project_id = $1`, [id])).toHaveLength(1);
    await d.close();
  });

  it('removes itself cleanly, and can be applied again', async () => {
    const d = await createDatabase();
    await createUser(d, OWNER, 'owner12@example.com');
    const { org_id } = await workspace(d, OWNER);
    const b = await business(OWNER, { name: 'Keep Me' }, d, org_id);
    await insertProject(b, { organization_id: org_id }, OWNER, d);
    await as(d, OWNER, () => d.query(`insert into public.activities (organization_id, business_id, type, summary) values ($1, $2, 'studio', 'Website concept started')`, [org_id, b]));
    await as(d, OWNER, () => d.query(`insert into public.activities (organization_id, business_id, type, summary) values ($1, $2, 'note', 'Called the owner')`, [org_id, b]));

    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '012_studio_brand_intelligence_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name::text from information_schema.tables where table_schema = 'public' and table_name in ('studio_projects', 'studio_observations', 'studio_reviews')
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guard_studio_observation_append_only', 'guard_studio_review_append_only')
       -- Only migration 012's triggers: later Studio migrations keep their own triggers when this
       -- rollback is applied on its own.
       union all select tgname::text from pg_trigger
         where tgname like 'studio_%' and tgrelid::regclass::text in ('studio_projects', 'studio_observations', 'studio_reviews')`,
    );
    expect(leftovers).toEqual([]);
    // Only the Studio entries go; the prospect's other history is untouched.
    expect(await rows(d, `select type from public.activities where business_id = $1 order by type`, [b])).toEqual([{ type: 'note' }]);

    await d.exec(readFileSync(join(MIGRATIONS_DIR, '012_studio_brand_intelligence.sql'), 'utf8'));
    const again = await insertProject(b, { organization_id: org_id }, OWNER, d);
    expect(again.status).toBe('draft');
    await d.close();
  });
});
