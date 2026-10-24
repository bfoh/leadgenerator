import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Exercises migration 004 (website verification evidence, identity, merges, audit findings and
// score overrides) on PGlite: guards, the merge functions, row-level security and the rollback.

const OWNER = '00000000-0000-4000-8000-0000000004a1';
const RESEARCHER = '00000000-0000-4000-8000-0000000004a2';
const SALES = '00000000-0000-4000-8000-0000000004a3';
const VIEWER = '00000000-0000-4000-8000-0000000004a4';
const OTHER = '00000000-0000-4000-8000-0000000004b1';

let db: PGlite;
let org: string;
let otherOrg: string;
let existing: { business: string; verification: string };

const workspace = async (d: PGlite, user: string) => (await as(d, user, () => rows<{ org_id: string; member_role: string }>(d, 'select * from public.ensure_workspace()')))[0];

async function business(user: string, values: Record<string, unknown> = {}, d = db, organization = org) {
  const cols = ['organization_id', 'name', 'city', ...Object.keys(values)];
  const params = [organization, values.name ?? `Biz ${Math.random().toString(36).slice(2, 7)}`, 'Accra', ...Object.values(values)];
  if ('name' in values) {
    cols.splice(cols.indexOf('name', 2), 1);
    params.splice(3 + Object.keys(values).indexOf('name'), 1);
  }
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(d, `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, params),
  );
  return row.id;
}

const get = async (id: string, d = db) => (await rows<Record<string, unknown>>(d, 'select * from public.businesses where id = $1', [id]))[0];

const AGENT_EVIDENCE = JSON.stringify({ schema: 1, classification: 'social_only_presence', confidenceScore: 82 });

async function agentVerification(user: string | 'service', businessId: string, extra: Record<string, unknown> = {}) {
  const sql = `insert into public.website_verifications (organization_id, business_id, status, evidence_summary, confidence, actor_type, classification, confidence_score, evidence, agent_version, review_status, reviewer_id, reviewer_name)
    values ($1, $2, 'none_found', 'Automated verification', 'high', 'agent', $3, $4, $5::jsonb, 'website-verification-1.0.0', $6, null, 'Website Verification') returning id`;
  const params = [org, businessId, extra.classification ?? 'social_only_presence', extra.confidence_score ?? 82, extra.evidence === undefined ? AGENT_EVIDENCE : extra.evidence, extra.review_status ?? 'pending'];
  const run = () => rows<{ id: string }>(db, sql, params);
  const [row] = user === 'service' ? await asServiceRole(db, run) : await as(db, user, run);
  return row.id;
}

beforeAll(async () => {
  db = await createDatabase({
    // A workspace with research from before migration 004.
    before004: async (d) => {
      await createUser(d, OWNER, 'owner4@example.com');
      const { org_id } = await workspace(d, OWNER);
      const id = await business(OWNER, { name: 'Existing Co' }, d, org_id);
      const [v] = await as(d, OWNER, () =>
        rows<{ id: string }>(d, `insert into public.website_verifications (organization_id, business_id, status, evidence_summary, confidence) values ($1, $2, 'none_found', 'Manual search', 'medium') returning id`, [org_id, id]),
      );
      existing = { business: id, verification: v.id };
    },
  });
  org = (await workspace(db, OWNER)).org_id;
  for (const [id, email] of [
    [RESEARCHER, 'researcher4@example.com'],
    [SALES, 'sales4@example.com'],
    [VIEWER, 'viewer4@example.com'],
    [OTHER, 'other4@example.com'],
  ]) {
    await createUser(db, id, email);
  }
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values ($1, 'researcher4@example.com', 'researcher'), ($1, 'sales4@example.com', 'sales'), ($1, 'viewer4@example.com', 'viewer')`,
      [org],
    ),
  );
  expect((await workspace(db, RESEARCHER)).member_role).toBe('researcher');
  expect((await workspace(db, SALES)).member_role).toBe('sales');
  expect((await workspace(db, VIEWER)).member_role).toBe('viewer');
  otherOrg = (await workspace(db, OTHER)).org_id;
});

describe('existing data', () => {
  it('leaves records from before 004 unchanged and editable', async () => {
    const [v] = await rows<Record<string, unknown>>(db, 'select * from public.website_verifications where id = $1', [existing.verification]);
    expect(v).toMatchObject({ actor_type: 'user', review_status: 'not_required', classification: null, evidence: null });
    const b = await get(existing.business);
    expect(b).toMatchObject({ alternate_names: [], merged_into_id: null, score_override: null });
    const updates = await rows(db, `select 1 from public.audit_events where action = 'update' and organization_id = $1`, [org]);
    expect(updates).toHaveLength(0);
    await as(db, OWNER, () => db.query(`update public.website_verifications set evidence_summary = 'Manual search, corrected' where id = $1`, [existing.verification]));
  });
});

describe('agent verifications', () => {
  it('require a classification, confidence, evidence and agent version', async () => {
    const b = await business(RESEARCHER);
    await expect(agentVerification(RESEARCHER, b, { evidence: null })).rejects.toThrow(/agent_record/);
    await expect(agentVerification(RESEARCHER, b, { classification: 'definitely_no_website' })).rejects.toThrow(/classification/);
    await expect(agentVerification(RESEARCHER, b, { confidence_score: 140 })).rejects.toThrow(/confidence_score/);
    expect(await agentVerification('service', b)).toBeTruthy();
  });

  it('cannot be edited, only confirmed or rejected, and the reviewer is stamped', async () => {
    const b = await business(RESEARCHER);
    const id = await agentVerification('service', b);
    await expect(as(db, OWNER, () => db.query(`update public.website_verifications set status = 'verified_official' where id = $1`, [id]))).rejects.toThrow(/cannot be edited/);
    await expect(as(db, OWNER, () => db.query(`update public.website_verifications set actor_type = 'user' where id = $1`, [id]))).rejects.toThrow(/author/);
    await as(db, SALES, () => db.query(`update public.website_verifications set review_status = 'confirmed', review_note = 'Checked the profile', reviewed_by = $2 where id = $1`, [id, OWNER]));
    const [v] = await rows<Record<string, unknown>>(db, 'select review_status, reviewed_by, reviewed_at from public.website_verifications where id = $1', [id]);
    expect(v.review_status).toBe('confirmed');
    expect(v.reviewed_by).toBe(SALES);
    expect(v.reviewed_at).toBeTruthy();
    await expect(as(db, VIEWER, () => rows(db, `update public.website_verifications set review_status = 'rejected' where id = $1 returning id`, [id]))).resolves.toHaveLength(0);
  });
});

describe('score override', () => {
  it('needs a research lead and a justification, and is stamped and audited', async () => {
    const b = await business(OWNER);
    const override = (o: number, text: string) => JSON.stringify({ opportunity: o, justification: text, by: OTHER, byName: 'Someone' });
    await expect(as(db, SALES, () => db.query('update public.businesses set score_override = $2::jsonb where id = $1', [b, override(80, 'Owner asked for a booking site.')]))).rejects.toThrow(/override scores/);
    await expect(as(db, RESEARCHER, () => db.query('update public.businesses set score_override = $2::jsonb where id = $1', [b, override(80, 'too short')]))).rejects.toThrow(/score_override/);
    await expect(as(db, RESEARCHER, () => db.query('update public.businesses set score_override = $2::jsonb where id = $1', [b, override(180, 'Owner asked for a booking site.')]))).rejects.toThrow(/score_override/);
    await as(db, RESEARCHER, () => db.query('update public.businesses set score_override = $2::jsonb, opportunity_score = 80 where id = $1', [b, override(80, 'Owner asked for a booking site.')]));
    const row = await get(b);
    expect(row.score_override).toMatchObject({ opportunity: 80, by: RESEARCHER });
    // Sales can still edit everything else.
    await as(db, SALES, () => db.query(`update public.businesses set notes = 'Called back' where id = $1`, [b]));
    const audit = await rows<{ changes: Record<string, unknown>; actor_id: string }>(db, `select changes, actor_id from public.audit_events where record_id = $1 and action = 'update' order by created_at`, [b]);
    expect(audit.some((a) => 'score_override' in a.changes && a.actor_id === RESEARCHER)).toBe(true);
  });
});

describe('merge and undo', () => {
  it('only owners and administrators merge, and merged_into_id cannot be set directly', async () => {
    const a = await business(OWNER);
    const b = await business(OWNER);
    await expect(as(db, RESEARCHER, () => db.query(`select public.merge_businesses($1, $2, '{}', null)`, [a, b]))).rejects.toThrow(/Only owners and administrators/);
    await expect(as(db, OWNER, () => db.query(`update public.businesses set merged_into_id = $2, stage = 'archived' where id = $1`, [b, a]))).rejects.toThrow(/Use merge/);
    await expect(as(db, OWNER, () => db.query(`select public.merge_businesses($1, $1, '{}', null)`, [a]))).rejects.toThrow(/two different/);
    await expect(as(db, OWNER, () => db.query(`select public.merge_businesses($1, $2, array['contact_permission'], null)`, [a, b]))).rejects.toThrow(/cannot be merged/);
    await expect(as(db, OTHER, () => db.query(`select public.merge_businesses($1, $2, '{}', null)`, [a, b]))).rejects.toThrow(/not found/);
  });

  it('merges atomically, carries an opt-out over, and undo restores the records', async () => {
    const primary = await business(OWNER, { name: 'Kente Beads', email: 'shop@kentebeads.com', stage: 'qualified' });
    const secondary = await business(OWNER, {
      name: 'Kente Beads Accra',
      phone: '+233 20 000 0000',
      email: 'other@kentebeads.com',
      stage: 'verification_pending',
      contact_permission: 'opted_out',
      opted_out_at: '2026-10-01T00:00:00Z',
    });
    const [{ r }] = await as(db, OWNER, () => rows<{ r: { copiedFields: string[] } }>(db, `select public.merge_businesses($1, $2, array['phone', 'email'], 'Listed twice') as r`, [primary, secondary]));
    expect(r.copiedFields).toEqual(['phone']);
    const p = await get(primary);
    const s = await get(secondary);
    expect(p).toMatchObject({ phone: '+233 20 000 0000', email: 'shop@kentebeads.com', contact_permission: 'opted_out', alternate_names: ['Kente Beads Accra'] });
    expect(s).toMatchObject({ stage: 'archived', merged_into_id: primary, phone: '+233 20 000 0000' });
    const [link] = await rows<Record<string, unknown>>(db, 'select * from public.identity_links where business_id = $1 and other_business_id = $2', [primary, secondary]);
    expect(link).toMatchObject({ relation: 'same_business', status: 'confirmed', decided_by: OWNER, note: 'Listed twice' });
    // A merged record stays archived.
    await expect(as(db, OWNER, () => db.query(`update public.businesses set stage = 'qualified' where id = $1`, [secondary]))).rejects.toThrow(/merged_archived/);
    await expect(as(db, OWNER, () => db.query(`select public.merge_businesses($1, $2, '{}', null)`, [primary, secondary]))).rejects.toThrow(/already been merged/);

    await expect(as(db, SALES, () => db.query('select public.undo_business_merge($1)', [secondary]))).rejects.toThrow(/Only owners and administrators/);
    await as(db, OWNER, () => db.query('select public.undo_business_merge($1)', [secondary]));
    const p2 = await get(primary);
    const s2 = await get(secondary);
    expect(s2).toMatchObject({ stage: 'verification_pending', merged_into_id: null });
    expect(p2).toMatchObject({ phone: null, alternate_names: [], contact_permission: 'opted_out' });
    const [after] = await rows<Record<string, unknown>>(db, 'select relation, status from public.identity_links where id = $1', [link.id]);
    expect(after).toEqual({ relation: 'distinct', status: 'confirmed' });
  });

  it('keeps a copied value that was edited after the merge', async () => {
    const primary = await business(OWNER, { name: 'Ama Foods' });
    const secondary = await business(OWNER, { name: 'Ama Foods Osu', phone: '+233 24 111 1111' });
    await as(db, OWNER, () => db.query(`select public.merge_businesses($1, $2, array['phone'], null)`, [primary, secondary]));
    await as(db, OWNER, () => db.query(`update public.businesses set phone = '+233 24 222 2222' where id = $1`, [primary]));
    await as(db, OWNER, () => db.query('select public.undo_business_merge($1)', [secondary]));
    expect((await get(primary)).phone).toBe('+233 24 222 2222');
  });
});

describe('identity links', () => {
  it('are one row per pair, isolated per workspace, and "same business" is reserved for merges', async () => {
    const a = await business(RESEARCHER);
    const b = await business(RESEARCHER);
    const insert = (user: string, x: string, y: string, relation = 'possible_duplicate', status = 'suggested') =>
      as(db, user, () => db.query(`insert into public.identity_links (organization_id, business_id, other_business_id, relation, status) values ($1, $2, $3, $4, $5)`, [org, x, y, relation, status]));
    await expect(insert(RESEARCHER, a, b, 'same_business', 'confirmed')).rejects.toThrow(/Use merge/);
    await insert(RESEARCHER, a, b);
    await expect(insert(RESEARCHER, b, a)).rejects.toThrow(/duplicate key|identity_links_pair/);
    await expect(insert(RESEARCHER, a, a)).rejects.toThrow(/distinct_pair/);
    await expect(insert(VIEWER, a, await business(RESEARCHER))).rejects.toThrow(/row-level security/);
    await as(db, SALES, () => db.query(`update public.identity_links set relation = 'branch', status = 'confirmed' where business_id = $1`, [a]));
    const [link] = await rows<Record<string, unknown>>(db, 'select relation, decided_by from public.identity_links where business_id = $1', [a]);
    expect(link).toEqual({ relation: 'branch', decided_by: SALES });
    await expect(as(db, SALES, () => db.query(`update public.identity_links set relation = 'same_business' where business_id = $1`, [a]))).rejects.toThrow(/Use merge/);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.identity_links'))).toHaveLength(0);
    await expect(as(db, OTHER, () => db.query(`insert into public.identity_links (organization_id, business_id, other_business_id) values ($1, $2, $3)`, [otherOrg, a, b]))).rejects.toThrow();
  });
});

describe('audit findings', () => {
  const finding = (businessId: string, evidence: unknown) => [
    org,
    businessId,
    JSON.stringify(evidence),
  ];
  const insertSql = `insert into public.audit_findings (organization_id, business_id, finding_key, category, kind, title, evidence, severity, confidence, agent_version)
    values ($1, $2, 'no_https', 'technical', 'verified_issue', 'Website is not served over HTTPS', $3::jsonb, 'medium', 85, 'digital-audit-1.0.0') returning id`;

  it('need evidence, and only their review can change', async () => {
    const b = await business(RESEARCHER);
    await expect(as(db, RESEARCHER, () => db.query(insertSql, finding(b, [])))).rejects.toThrow(/evidence/);
    const [{ id }] = await asServiceRole(db, () => rows<{ id: string }>(db, insertSql, finding(b, [{ statement: 'Final URL is http://', source: 'http://example.com', observedAt: '2026-10-22' }])));
    await expect(as(db, OWNER, () => db.query(`update public.audit_findings set severity = 'high' where id = $1`, [id]))).rejects.toThrow(/only their review/);
    await as(db, SALES, () => db.query(`update public.audit_findings set review_status = 'dismissed', review_note = 'Moving to HTTPS next week' where id = $1`, [id]));
    const [row] = await rows<Record<string, unknown>>(db, 'select review_status, reviewed_by from public.audit_findings where id = $1', [id]);
    expect(row).toEqual({ review_status: 'dismissed', reviewed_by: SALES });
    await expect(as(db, VIEWER, () => db.query(insertSql, finding(b, [{ statement: 'x', source: null, observedAt: null }])))).rejects.toThrow(/row-level security/);
    expect(await as(db, SALES, () => rows(db, 'delete from public.audit_findings where id = $1 returning id', [id]))).toHaveLength(0);
    expect(await as(db, VIEWER, () => rows(db, 'select 1 from public.audit_findings where id = $1', [id]))).toHaveLength(1);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.audit_findings'))).toHaveLength(0);
  });

  it('are deleted with their business', async () => {
    const b = await business(OWNER);
    await asServiceRole(db, () => db.query(insertSql, finding(b, [{ statement: 'Final URL is http://', source: null, observedAt: null }])));
    await as(db, OWNER, () => db.query('delete from public.businesses where id = $1', [b]));
    expect(await rows(db, 'select 1 from public.audit_findings where business_id = $1', [b])).toHaveLength(0);
  });
});

describe('independence from migration 003, and rollback', () => {
  it('applies and merges without migration 003', async () => {
    const d = await createDatabase({ skip: ['003', '007', '009'] });
    await createUser(d, OWNER, 'owner4@example.com');
    const { org_id } = await workspace(d, OWNER);
    const a = await business(OWNER, { name: 'Solo One' }, d, org_id);
    const b = await business(OWNER, { name: 'Solo One Ltd' }, d, org_id);
    await as(d, OWNER, () => d.query(`select public.merge_businesses($1, $2, '{}', null)`, [a, b]));
    expect((await get(b, d)).merged_into_id).toBe(a);
    await d.close();
  });

  it('removes migration 004 cleanly, keeps the pre-004 app working, and can be re-applied', async () => {
    const d = await createDatabase();
    await createUser(d, OWNER, 'owner4@example.com');
    const { org_id } = await workspace(d, OWNER);
    const keep = await business(OWNER, { name: 'Keep Me' }, d, org_id);
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '004_research_verification_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name from information_schema.tables where table_schema = 'public' and table_name in ('identity_links', 'audit_findings')
       union all select column_name from information_schema.columns where table_schema = 'public' and table_name = 'website_verifications' and column_name in ('actor_type', 'classification', 'evidence', 'review_status')
       union all select column_name from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name in ('alternate_names', 'merged_into_id', 'score_override')
       union all select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('merge_businesses', 'undo_business_merge', 'guard_verification_update', 'guard_business_research_fields')`,
    );
    expect(leftovers).toEqual([]);
    await as(d, OWNER, () => d.query(`update public.businesses set stage = 'qualified' where id = $1`, [keep]));
    await as(d, OWNER, () => d.query(`insert into public.website_verifications (organization_id, business_id, status, evidence_summary, confidence) values ($1, $2, 'none_found', 'Manual', 'low')`, [org_id, keep]));
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '004_research_verification.sql'), 'utf8'));
    await d.exec('grant all on all tables in schema public to service_role;');
    expect((await get(keep, d)).stage).toBe('qualified');
    await d.close();
  });
});
