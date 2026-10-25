import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCreativeBrief, generateCreativeDirection, type CreativeBriefContent, type CreativeDirectionContent } from '@/lib/domain/creative-direction';
import { buildWebsiteBlueprint } from '@/lib/domain/website-compositions';
import type { WebsiteBlueprint } from '@/lib/domain/website-blueprint';
import type { BrandKitContent, StudioAsset } from '@/lib/domain/studio-assets';
import type { StudioObservation, StudioProject } from '@/lib/domain/studio';
import type { Business } from '@/lib/domain/types';
import { MIGRATIONS_DIR, as, createDatabase, createUser, rows } from './harness';

// Migration 014 on PGlite: provenance-aware briefs, three-concept directions, append-only reviews,
// the approval guard, RLS and the rollback. The JSON payloads are produced by the real domain engine,
// so the database is measured against what the Studio actually writes.

const OWNER = '00000000-0000-4000-8000-00000000e1a1';
const RESEARCHER = '00000000-0000-4000-8000-00000000e1a2';
const VIEWER = '00000000-0000-4000-8000-00000000e1a3';
const OTHER = '00000000-0000-4000-8000-00000000e1b1';

const LOGO = '00000000-0000-4000-8000-00000000a001';
const PHOTO = '00000000-0000-4000-8000-00000000a002';
const CANDIDATE = '00000000-0000-4000-8000-00000000a003';

let db: PGlite;
let org: string;
let businessId: string;
let projectId: string;
let briefContent: CreativeBriefContent;
let directionContent: CreativeDirectionContent;
let briefId: string;
let directionId: string;
let kitVersionId: string;
let approvedDirectionId: string;
let approvedConceptKey: string;

const workspace = async (d: PGlite, user: string) => (await as(d, user, () => rows<{ org_id: string; member_role: string }>(d, 'select * from public.ensure_workspace()')))[0];

async function businessRow(organization = org, name = 'Nsroma Atelier') {
  const [row] = await as(db, organization === org ? OWNER : OTHER, () =>
    rows<{ id: string }>(db, "insert into public.businesses (organization_id, name, city, category) values ($1, $2, 'Accra', 'Fashion and tailoring') returning id", [organization, name]),
  );
  return row.id;
}

async function projectRow(business: string, organization = org) {
  const [row] = await as(db, organization === org ? OWNER : OTHER, () =>
    rows<{ id: string }>(db, "insert into public.studio_projects (organization_id, business_id, name, website_url, status, intelligence_status, intelligence_at) values ($1, $2, 'Nsroma Atelier — website concept', 'https://nsromaatelier.example', 'intelligence_ready', 'ready', now()) returning id", [organization, business]),
  );
  return row.id;
}

async function assetRow(id: string, status: string, organization = org, project = projectId, kind = 'logo') {
  await as(db, organization === org ? OWNER : OTHER, () =>
    db.query(
      `insert into public.studio_assets
        (id, organization_id, project_id, file_name, kind, status, mime_type, bytes, width, height,
         checksum_sha256, storage_path, origin, owner_name, permission_evidence,
         inspect_permission, store_permission, prototype_permission, export_permission, publish_permission,
         approved_at)
       values ($1,$2,$3,$4,$5,$6,'image/png',4096,1200,800,$7,$8,'client_supplied','Nsroma Atelier',
         'Email from the owner, 21 Oct 2026.', 'granted','granted','granted','granted','denied', case when $6 = 'approved' then now() else null end)`,
      [id, organization, project, `${id}-${kind}.png`, kind, status, 'a'.repeat(64), `${organization}/${project}/${id}/${kind}.png`],
    ),
  );
}

async function kitRows(project: string, organization = org) {
  const kitId = randomUUID();
  const versionId = randomUUID();
  const content: BrandKitContent = {
    logoAssetIds: [LOGO],
    palette: [
      { name: 'Ink', hex: '#241E1A', role: 'Text' },
      { name: 'Kente red', hex: '#7A1F3D', role: 'Accent' },
      { name: 'Warm paper', hex: '#F4EDE3', role: 'Background' },
    ],
    typography: [{ role: 'Display', family: 'Fraunces', weights: '400–700', licence: 'SIL Open Font License 1.1', assetId: null }],
    photographyAssetIds: [PHOTO],
    personality: ['quietly confident', 'exacting', 'warm'],
    visualDirection: 'Editorial and unhurried: warm off-white, one deep red, photography given room to breathe and type doing the talking.',
    toneOfVoice: { summary: 'Plain, precise and proud of the craft. Short sentences; no exclamation marks.', do: ['Name the cloth'], dont: ['Best in Ghana'] },
  };
  await as(db, organization === org ? OWNER : OTHER, async () => {
    await db.query('insert into public.studio_brand_kits (id, organization_id, project_id) values ($1,$2,$3)', [kitId, organization, project]);
    await db.query('insert into public.studio_brand_kit_versions (id, organization_id, project_id, kit_id, version, content, note) values ($1,$2,$3,$4,1,$5,$6)', [
      versionId,
      organization,
      project,
      kitId,
      JSON.stringify(content),
      'First kit',
    ]);
    await db.query("insert into public.studio_brand_kit_approvals (organization_id, project_id, kit_id, version_id, note) values ($1,$2,$3,$4,'Agreed with the owner.')", [
      organization,
      project,
      kitId,
      versionId,
    ]);
  });
  return { kitId, versionId, content };
}

async function insertObservations(project: string, observations: readonly StudioObservation[]) {
  for (const observation of observations) {
    await as(db, OWNER, () =>
      db.query(
        `insert into public.studio_observations
          (id, organization_id, project_id, run_number, key, classification, category, label, detail, confidence,
           reuse_permission, source_kind, source_url, observed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'website_page','https://nsromaatelier.example', now())`,
        [
          observation.id,
          org,
          project,
          observation.runNumber,
          observation.key,
          observation.classification,
          observation.category,
          observation.label,
          observation.detail,
          observation.confidence,
          observation.reusePermission,
        ],
      ),
    );
  }
}

function observation(id: string, key: string, label: string, detail: string, category: StudioObservation['category'] = 'identity'): StudioObservation {
  return {
    id,
    organizationId: org,
    projectId,
    runNumber: 1,
    key,
    classification: 'verified_fact',
    category,
    label,
    detail,
    confidence: 90,
    reusePermission: 'permitted',
    sourceKind: 'website_page',
    sourceUrl: 'https://nsromaatelier.example',
    assetUrl: null,
    assetKind: null,
    observedAt: new Date().toISOString(),
    createdBy: null,
    createdAt: new Date().toISOString(),
  };
}

function asset(id: string, kind: StudioAsset['kind']): StudioAsset {
  return {
    id,
    organizationId: org,
    projectId,
    fileName: `${kind}.png`,
    kind,
    status: 'approved',
    mimeType: 'image/png',
    bytes: 4096,
    width: 1200,
    height: 800,
    checksumSha256: 'a'.repeat(64),
    storagePath: `${org}/${projectId}/${id}/${kind}.png`,
    origin: 'client_supplied',
    ownerName: 'Nsroma Atelier',
    supplier: null,
    sourceUrl: null,
    licenceName: null,
    licenceReference: null,
    licenceExpiresOn: null,
    attributionRequired: false,
    attributionText: null,
    permissionEvidence: 'Email from the owner, 21 Oct 2026.',
    inspectPermission: 'granted',
    storePermission: 'granted',
    prototypePermission: 'granted',
    exportPermission: 'granted',
    publishPermission: 'denied',
    note: '',
    reviewNote: null,
    approvedBy: OWNER,
    approvedAt: new Date().toISOString(),
    rejectedBy: null,
    rejectedAt: null,
    rejectedReason: null,
    revokedBy: null,
    revokedAt: null,
    revokedReason: null,
    supersedesId: null,
    createdBy: OWNER,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const OBS = [
  observation('00000000-0000-4000-8000-00000000c001', 'identity.name', 'Trading name', 'Nsroma Atelier'),
  observation('00000000-0000-4000-8000-00000000c002', 'contact.routes', 'Contact routes published', 'The homepage publishes a WhatsApp link and a tap-to-call phone link.', 'contact'),
];

beforeAll(async () => {
  db = await createDatabase();
  for (const [id, email] of [
    [OWNER, 'owner@studio.test'],
    [RESEARCHER, 'researcher@studio.test'],
    [VIEWER, 'viewer@studio.test'],
    [OTHER, 'other@studio.test'],
  ] as const) {
    await createUser(db, id, email);
  }
  org = (await workspace(db, OWNER)).org_id;
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values
        ($1, 'researcher@studio.test', 'researcher'),
        ($1, 'viewer@studio.test', 'viewer')`,
      [org],
    ),
  );
  expect((await workspace(db, RESEARCHER)).member_role).toBe('researcher');
  expect((await workspace(db, VIEWER)).member_role).toBe('viewer');
  businessId = await businessRow();
  projectId = await projectRow(businessId);
  await assetRow(LOGO, 'approved', org, projectId, 'logo');
  await assetRow(PHOTO, 'approved', org, projectId, 'product_photo');
  await assetRow(CANDIDATE, 'candidate', org, projectId, 'illustration');
  const kit = await kitRows(projectId);
  kitVersionId = kit.versionId;
  await insertObservations(projectId, OBS);

  const business = { id: businessId, name: 'Nsroma Atelier', category: 'Fashion and tailoring', city: 'Accra', officialWebsite: 'https://nsromaatelier.example' } as Business;
  const project = {
    id: projectId,
    organizationId: org,
    businessId,
    name: 'Nsroma Atelier — website concept',
    status: 'intelligence_ready',
    websiteUrl: 'https://nsromaatelier.example',
    brief: '',
    intelligenceStatus: 'ready',
    intelligenceAt: new Date().toISOString(),
    intelligenceNote: null,
    createdBy: OWNER,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as StudioProject;
  const assets = [asset(LOGO, 'logo'), asset(PHOTO, 'product_photo'), { ...asset(CANDIDATE, 'illustration'), status: 'candidate' as const }];
  briefContent = buildCreativeBrief({
    project,
    business,
    observations: OBS,
    reviews: [],
    kit: { versionId: kit.versionId, version: 1, approvedAt: new Date().toISOString(), content: kit.content },
    assets,
  });
  const [brief] = await as(db, OWNER, () =>
    rows<{ id: string }>(db, 'insert into public.studio_creative_briefs (organization_id, project_id, version, content, note) values ($1,$2,1,$3,$4) returning id', [
      org,
      projectId,
      JSON.stringify(briefContent),
      'First brief',
    ]),
  );
  briefId = brief.id;
  await as(db, OWNER, () =>
    db.query("insert into public.studio_creative_brief_reviews (organization_id, project_id, brief_id, decision, note) values ($1,$2,$3,'confirm','Confirmed for direction.')", [org, projectId, briefId]),
  );

  directionContent = generateCreativeDirection({
    project,
    business,
    brief: briefContent,
    briefVersionId: briefId,
    briefVersion: 1,
    kit: { versionId: kit.versionId, version: 1, content: kit.content },
    assets,
  });
  const [direction] = await as(db, OWNER, () =>
    rows<{ id: string }>(db, 'insert into public.studio_creative_directions (organization_id, project_id, brief_id, version, content) values ($1,$2,$3,1,$4) returning id', [
      org,
      projectId,
      briefId,
      JSON.stringify(directionContent),
    ]),
  );
  directionId = direction.id;
});

async function insertDirection(content: unknown, version = 2) {
  const [row] = await as(db, OWNER, () =>
    rows<{ id: string }>(db, 'insert into public.studio_creative_directions (organization_id, project_id, brief_id, version, content) values ($1,$2,$3,$4,$5) returning id', [
      org,
      projectId,
      briefId,
      version,
      JSON.stringify(content),
    ]),
  );
  return row.id;
}

describe('the creative direction schema', () => {
  it('stores the engine’s brief and three concepts', async () => {
    const [brief] = await as(db, VIEWER, () => rows<{ version: number; content: CreativeBriefContent }>(db, 'select version, content from public.studio_creative_briefs where id = $1', [briefId]));
    expect(brief.version).toBe(1);
    expect(brief.content.provenance.verified).toBeGreaterThan(0);
    expect(brief.content.missingInformation.length).toBeGreaterThan(0);

    const [direction] = await as(db, VIEWER, () => rows<{ content: CreativeDirectionContent }>(db, 'select content from public.studio_creative_directions where id = $1', [directionId]));
    expect(direction.content.concepts).toHaveLength(3);
    expect(new Set(direction.content.concepts.map((concept) => concept.composition.family)).size).toBe(3);
  });

  it('lets members read, writers write and viewers only read', async () => {
    const visible = await as(db, VIEWER, () => rows(db, 'select id from public.studio_creative_briefs where project_id = $1', [projectId]));
    expect(visible).toHaveLength(1);

    await expect(
      as(db, VIEWER, () =>
        db.query('insert into public.studio_creative_brief_reviews (organization_id, project_id, brief_id, decision, note) values ($1,$2,$3,\'note\',\'Viewer note\')', [org, projectId, briefId]),
      ),
    ).rejects.toThrow(/policy|permission/i);

    const review = await as(db, RESEARCHER, () =>
      rows<{ id: string }>(db, "insert into public.studio_creative_brief_reviews (organization_id, project_id, brief_id, decision, note) values ($1,$2,$3,'note','Checked the evidence.') returning id", [org, projectId, briefId]),
    );
    expect(review).toHaveLength(1);

    const foreign = await as(db, OTHER, () => rows(db, 'select id from public.studio_creative_briefs where project_id = $1', [projectId]));
    expect(foreign).toHaveLength(0);
    await expect(
      as(db, OTHER, () => db.query('select * from public.studio_creative_directions where project_id = $1', [projectId])),
    ).resolves.toBeDefined();
    await expect(
      as(db, OTHER, () =>
        db.query('insert into public.studio_creative_briefs (organization_id, project_id, version, content) values ($1,$2,2,$3)', [org, projectId, JSON.stringify(briefContent)]),
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('keeps briefs, directions and reviews immutable', async () => {
    await expect(as(db, OWNER, () => db.query("update public.studio_creative_briefs set note = 'edited' where id = $1", [briefId]))).rejects.toThrow(/immutable|permission denied/i);
    await expect(as(db, OWNER, () => db.query("update public.studio_creative_directions set note = 'edited' where id = $1", [directionId]))).rejects.toThrow(/immutable|permission denied/i);
    await expect(as(db, OWNER, () => db.query('delete from public.studio_creative_briefs where id = $1', [briefId]))).rejects.toThrow(/immutable|permission denied/i);
    await expect(as(db, OWNER, () => db.query("update public.studio_creative_brief_reviews set note = 'edited' where brief_id = $1", [briefId]))).rejects.toThrow(/append-only|permission denied/i);
  });

  it('refuses a direction whose concepts are one layout with different colours', async () => {
    const broken = structuredClone(directionContent);
    broken.concepts[1].composition = { ...broken.concepts[0].composition };
    await expect(insertDirection(broken)).rejects.toThrow(/distinct keys|composition/i);
  });

  it('refuses an unapproved asset, foreign evidence, a missing concept and an unapproved kit', async () => {
    const unapproved = structuredClone(directionContent);
    unapproved.concepts[0].imagery.assetIds = [CANDIDATE];
    await expect(insertDirection(unapproved)).rejects.toThrow(/not approved/i);

    const foreignEvidence = structuredClone(directionContent);
    foreignEvidence.concepts[0].rationale.evidence.observationIds = ['00000000-0000-4000-8000-00000000dead'];
    await expect(insertDirection(foreignEvidence)).rejects.toThrow(/Evidence|observation/i);

    const two = structuredClone(directionContent);
    two.concepts = two.concepts.slice(0, 2);
    await expect(insertDirection(two)).rejects.toThrow(/check|concepts|violates/i);

    const wrongKit = structuredClone(directionContent);
    wrongKit.brandKitVersionId = '00000000-0000-4000-8000-00000000beef';
    await expect(insertDirection(wrongKit)).rejects.toThrow(/Brand Kit/i);
  });

  it('numbers briefs and directions without gaps', async () => {
    await expect(
      as(db, OWNER, () => db.query('insert into public.studio_creative_briefs (organization_id, project_id, version, content) values ($1,$2,3,$3)', [org, projectId, JSON.stringify(briefContent)])),
    ).rejects.toThrow(/next brief version is 2/i);
    await expect(insertDirection(directionContent, 5)).rejects.toThrow(/next direction version is 2/i);
  });

  it('requires a confirmed brief and refuses an older approval after a newer one', async () => {
    const second = await insertDirection(directionContent, 2);
    const conceptKey = directionContent.concepts[0].key;
    await as(db, OWNER, () =>
      db.query("insert into public.studio_creative_direction_reviews (organization_id, project_id, direction_id, concept_key, decision, note) values ($1,$2,$3,$4,'approve','Approved by the design lead.')", [org, projectId, second, conceptKey]),
    );
    approvedDirectionId = second;
    approvedConceptKey = conceptKey;

    await expect(
      as(db, OWNER, () =>
        db.query("insert into public.studio_creative_direction_reviews (organization_id, project_id, direction_id, concept_key, decision, note) values ($1,$2,$3,$4,'approve','Trying an older version.')", [org, projectId, directionId, conceptKey]),
      ),
    ).rejects.toThrow(/older than the approved version/i);

    await expect(
      as(db, OWNER, () =>
        db.query("insert into public.studio_creative_direction_reviews (organization_id, project_id, direction_id, concept_key, decision, note) values ($1,$2,$3,'not_a_concept','approve','Wrong concept.')", [org, projectId, second]),
      ),
    ).rejects.toThrow(/not in this direction/i);
  });

  it('stores an immutable rendered prototype only while the concept approval is current', async () => {
    const business = { id: businessId, name: 'Nsroma Atelier', category: 'Fashion and tailoring', city: 'Accra', officialWebsite: 'https://nsromaatelier.example' } as Business;
    const project = {
      id: projectId,
      organizationId: org,
      businessId,
      name: 'Nsroma Atelier — website concept',
      status: 'intelligence_ready',
      websiteUrl: 'https://nsromaatelier.example',
      brief: '',
      intelligenceStatus: 'ready',
      intelligenceAt: new Date().toISOString(),
      intelligenceNote: null,
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as StudioProject;
    const assets = [asset(LOGO, 'logo'), asset(PHOTO, 'product_photo')];
    const blueprint = buildWebsiteBlueprint({
      project,
      business,
      brief: briefContent,
      direction: { id: approvedDirectionId, version: 2, content: directionContent },
      conceptKey: approvedConceptKey,
      kit: { versionId: kitVersionId, version: 1 },
      assets,
      roleAssets: { hero: PHOTO, portrait: PHOTO, detail: PHOTO },
      availableMediaIds: [LOGO, PHOTO],
      synthetic: false,
      generatedAt: '2026-10-25T09:00:00.000Z',
    });
    expect(blueprint.readiness.previewReady).toBe(true);

    const [saved] = await as(db, OWNER, () =>
      rows<{ id: string; version: number }>(
        db,
        'insert into public.studio_website_prototypes (organization_id, project_id, direction_id, concept_key, version, content, note) values ($1,$2,$3,$4,1,$5,$6) returning id, version',
        [org, projectId, approvedDirectionId, approvedConceptKey, JSON.stringify(blueprint), 'First rendered prototype.'],
      ),
    );
    expect(saved.version).toBe(1);

    const visible = await as(db, VIEWER, () => rows<{ content: WebsiteBlueprint }>(db, 'select content from public.studio_website_prototypes where id = $1', [saved.id]));
    expect(visible[0].content.format).toBe('dof-website-blueprint/1');
    expect(visible[0].content.readiness.publishReady).toBe(false);
    const foreign = await as(db, OTHER, () => rows(db, 'select id from public.studio_website_prototypes where project_id = $1', [projectId]));
    expect(foreign).toHaveLength(0);

    await expect(
      as(db, VIEWER, () =>
        db.query('insert into public.studio_website_prototypes (organization_id, project_id, direction_id, concept_key, version, content) values ($1,$2,$3,$4,2,$5)', [
          org,
          projectId,
          approvedDirectionId,
          approvedConceptKey,
          JSON.stringify(blueprint),
        ]),
      ),
    ).rejects.toThrow(/policy|permission/i);

    await expect(as(db, OWNER, () => db.query("update public.studio_website_prototypes set note = 'edited' where id = $1", [saved.id]))).rejects.toThrow(/immutable|permission denied/i);
    await expect(as(db, OWNER, () => db.query('delete from public.studio_website_prototypes where id = $1', [saved.id]))).rejects.toThrow(/immutable|permission denied/i);

    await expect(
      as(db, OWNER, () =>
        db.query('insert into public.studio_website_prototypes (organization_id, project_id, direction_id, concept_key, version, content) values ($1,$2,$3,$4,3,$5)', [
          org,
          projectId,
          approvedDirectionId,
          approvedConceptKey,
          JSON.stringify(blueprint),
        ]),
      ),
    ).rejects.toThrow(/next prototype version is 2/i);

    const misbound = structuredClone(blueprint);
    misbound.direction.directionId = directionId;
    await expect(
      as(db, OWNER, () =>
        db.query('insert into public.studio_website_prototypes (organization_id, project_id, direction_id, concept_key, version, content) values ($1,$2,$3,$4,2,$5)', [
          org,
          projectId,
          approvedDirectionId,
          approvedConceptKey,
          JSON.stringify(misbound),
        ]),
      ),
    ).rejects.toThrow(/not bound to this direction/i);
  });

  it('deletes a concept together with its briefs, directions and reviews', async () => {
    const [ownerOrg] = await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()'));
    expect(ownerOrg.org_id).toBe(org);
    await as(db, OWNER, () => db.query('delete from public.studio_projects where id = $1', [projectId]));
    for (const table of ['studio_creative_briefs', 'studio_creative_brief_reviews', 'studio_creative_directions', 'studio_creative_direction_reviews', 'studio_website_prototypes']) {
      const remaining = await as(db, OWNER, () => rows(db, `select id from public.${table} where project_id = $1`, [projectId]));
      expect(remaining, table).toHaveLength(0);
    }
  });
});

describe('migration 014 rollback', () => {
  it('drops only the creative direction objects and can be applied again', async () => {
    const d = await createDatabase();
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '015_studio_website_prototypes_down.sql'), 'utf8'));
    const rollback = readFileSync(join(process.cwd(), 'supabase', 'rollback', '014_studio_creative_direction_down.sql'), 'utf8');
    await d.exec(rollback);
    const [gone] = await rows<{ briefs: string | null; directions: string | null }>(d, "select to_regclass('public.studio_creative_briefs') as briefs, to_regclass('public.studio_creative_directions') as directions");
    expect(gone.briefs).toBeNull();
    expect(gone.directions).toBeNull();
    const [still] = await rows<{ projects: string | null; kits: string | null }>(d, "select to_regclass('public.studio_projects') as projects, to_regclass('public.studio_brand_kits') as kits");
    expect(still.projects).toBeTruthy();
    expect(still.kits).toBeTruthy();

    await d.exec(readFileSync(join(MIGRATIONS_DIR, '014_studio_creative_direction.sql'), 'utf8'));
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '015_studio_website_prototypes.sql'), 'utf8'));
    const [again] = await rows<{ briefs: string | null; prototypes: string | null }>(
      d,
      "select to_regclass('public.studio_creative_briefs') as briefs, to_regclass('public.studio_website_prototypes') as prototypes",
    );
    expect(again.briefs).toBeTruthy();
    expect(again.prototypes).toBeTruthy();
    await d.close();
  });
});

describe('migration 015 rollback', () => {
  it('drops only the rendered prototype table and can be applied again', async () => {
    const d = await createDatabase();
    const rollback = readFileSync(join(process.cwd(), 'supabase', 'rollback', '015_studio_website_prototypes_down.sql'), 'utf8');
    await d.exec(rollback);
    const [gone] = await rows<{ prototypes: string | null; directions: string | null }>(
      d,
      "select to_regclass('public.studio_website_prototypes') as prototypes, to_regclass('public.studio_creative_directions') as directions",
    );
    expect(gone.prototypes).toBeNull();
    expect(gone.directions).toBeTruthy();

    await d.exec(readFileSync(join(MIGRATIONS_DIR, '015_studio_website_prototypes.sql'), 'utf8'));
    const [again] = await rows<{ prototypes: string | null }>(d, "select to_regclass('public.studio_website_prototypes') as prototypes");
    expect(again.prototypes).toBeTruthy();
    await d.close();
  });
});




