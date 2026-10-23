import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Exercises migration 005 (contact points with provenance, append-only consent records and the
// suppression list) on PGlite: constraints, guards, automatic suppression, lifting rules, cascades,
// row-level security, re-running and the rollback.

const OWNER = '00000000-0000-4000-8000-0000000005a1';
const RESEARCHER = '00000000-0000-4000-8000-0000000005a2';
const SALES = '00000000-0000-4000-8000-0000000005a3';
const VIEWER = '00000000-0000-4000-8000-0000000005a4';
const OTHER = '00000000-0000-4000-8000-0000000005b1';

let db: PGlite;
let org: string;
let otherOrg: string;
let preOptedOut: string;

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const workspace = async (d: PGlite, user: string) => (await as(d, user, () => rows<{ org_id: string; member_role: string }>(d, 'select * from public.ensure_workspace()')))[0];

async function business(user: string, values: Record<string, unknown> = {}, d = db, organization = org) {
  const v = { name: `Biz ${Math.random().toString(36).slice(2, 7)}`, city: 'Accra', ...values };
  const cols = ['organization_id', ...Object.keys(v)];
  const [row] = await as(d, user, () =>
    rows<{ id: string }>(d, `insert into public.businesses (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, [organization, ...Object.values(v)]),
  );
  return row.id;
}

type Point = Record<string, unknown>;
const emailPoint = (businessId: string, email: string, extra: Point = {}): Point => ({
  organization_id: org,
  business_id: businessId,
  type: 'email',
  value: email,
  normalized_value: email,
  value_hash: hash(`email:${email}`),
  domain_hash: hash(`domain:${email.split('@')[1]}`),
  hint: `${email[0]}•••@${email.split('@')[1]}`,
  scope: 'business',
  source_type: 'business_website',
  source_url: `https://${email.split('@')[1]}/contact`,
  ...extra,
});
const phonePoint = (businessId: string, e164: string, extra: Point = {}): Point => ({
  organization_id: org,
  business_id: businessId,
  type: 'phone',
  value: e164,
  normalized_value: e164,
  value_hash: hash(`phone:${e164}`),
  hint: `+233 ••• ${e164.slice(-3)}`,
  scope: 'business',
  phone_kind: 'landline',
  source_type: 'directly_provided',
  source_note: 'Given by the owner at the trade fair',
  ...extra,
});

async function insertPoint(user: string | 'service', point: Point, d = db) {
  const cols = Object.keys(point);
  const run = () => rows<{ id: string; acquired_by: string | null }>(d, `insert into public.contact_points (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, acquired_by`, Object.values(point));
  const [row] = user === 'service' ? await asServiceRole(d, run) : await as(d, user, run);
  return row;
}

type Consent = Record<string, unknown>;
const consent = (businessId: string, extra: Consent = {}): Consent => ({
  organization_id: org,
  business_id: businessId,
  channel: 'email',
  status: 'granted',
  lawful_basis: 'consent',
  purpose: 'direct_marketing',
  evidence: 'Signed up on the agency website newsletter form',
  captured_via: 'web_form',
  captured_at: new Date(Date.now() - 60_000).toISOString(),
  wording: 'Yes, send me occasional emails about website services.',
  recorded_by_name: 'Test Person',
  ...extra,
});

async function insertConsent(user: string | 'service', record: Consent, d = db) {
  const cols = Object.keys(record);
  const run = () => rows<{ id: string; recorded_by: string }>(d, `insert into public.consent_records (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id, recorded_by`, Object.values(record));
  const [row] = user === 'service' ? await asServiceRole(d, run) : await as(d, user, run);
  return row;
}

const suppressionsFor = (where: string, params: unknown[]) => rows<Record<string, unknown>>(db, `select * from public.suppressions where ${where} order by created_at`, params);

beforeAll(async () => {
  db = await createDatabase({
    // A business that opted out before migration 005.
    before005: async (d) => {
      await createUser(d, OWNER, 'owner5@example.com');
      const { org_id } = await workspace(d, OWNER);
      preOptedOut = await business(OWNER, { name: 'Already Opted Out Ltd', contact_permission: 'opted_out', opted_out_at: new Date().toISOString() }, d, org_id);
    },
  });
  org = (await workspace(db, OWNER)).org_id;
  for (const [id, email] of [
    [RESEARCHER, 'researcher5@example.com'],
    [SALES, 'sales5@example.com'],
    [VIEWER, 'viewer5@example.com'],
    [OTHER, 'other5@example.com'],
  ]) {
    await createUser(db, id, email);
  }
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values ($1, 'researcher5@example.com', 'researcher'), ($1, 'sales5@example.com', 'sales'), ($1, 'viewer5@example.com', 'viewer')`,
      [org],
    ),
  );
  expect((await workspace(db, SALES)).member_role).toBe('sales');
  expect((await workspace(db, VIEWER)).member_role).toBe('viewer');
  expect((await workspace(db, RESEARCHER)).member_role).toBe('researcher');
  otherOrg = (await workspace(db, OTHER)).org_id;
});

describe('existing data', () => {
  it('suppresses businesses that opted out before the migration, and changes nothing else', async () => {
    const list = await suppressionsFor('business_id = $1', [preOptedOut]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'business', value_hash: null, reason: 'opted_out', source: 'business_opt_out', hint: 'Already Opted Out Ltd', lifted_at: null });
    const [b] = await rows<Record<string, unknown>>(db, 'select contact_permission from public.businesses where id = $1', [preOptedOut]);
    expect(b.contact_permission).toBe('opted_out');
  });
});

describe('contact points', () => {
  it('record who added them, and refuse restricted sources and missing provenance', async () => {
    const b = await business(RESEARCHER);
    const row = await insertPoint(RESEARCHER, emailPoint(b, 'info@kofi-bakes.com', { acquired_by: OWNER }));
    expect(row.acquired_by).toBe(RESEARCHER); // stamped from the session, whatever the client sends

    await expect(insertPoint(RESEARCHER, phonePoint(b, '+233302000111', { source_type: 'google_places' }))).rejects.toThrow(/source_type_check/);
    await expect(insertPoint(RESEARCHER, phonePoint(b, '+233302000112', { source_type: 'search_results' }))).rejects.toThrow(/source_type_check/);
    await expect(insertPoint(RESEARCHER, phonePoint(b, '+233302000113', { source_note: null }))).rejects.toThrow(/provenance/);
    await expect(insertPoint(RESEARCHER, emailPoint(b, 'sales@kofi-bakes.com', { source_url: null, source_note: 'from the site' }))).rejects.toThrow(/provenance/);
    await expect(insertPoint(RESEARCHER, phonePoint(b, '+233302000114', { source_type: 'licensed_dataset', source_provider: 'Example B2B' }))).rejects.toThrow(/provenance/);
    await insertPoint(RESEARCHER, phonePoint(b, '+233302000115', { source_type: 'licensed_dataset', source_provider: 'Example B2B', source_licence: 'Contract 2026-14, B2B outreach permitted' }));
    await expect(insertPoint(RESEARCHER, emailPoint(b, 'info@kofi-bakes.com'))).rejects.toThrow(/contact_points_value_key/);
    await expect(insertPoint(RESEARCHER, emailPoint(b, 'hello@kofi-bakes.com', { domain_hash: null }))).rejects.toThrow(/email_hash_check/);
    await expect(insertPoint(RESEARCHER, phonePoint(b, '+233302000116', { value_hash: null }))).rejects.toThrow(/contact_points_hash_check/);
  });

  it('need a named role and purpose for personal work contacts', async () => {
    const b = await business(SALES);
    await expect(insertPoint(SALES, emailPoint(b, 'ama@kofi-bakes.com', { scope: 'person' }))).rejects.toThrow(/person_check/);
    await expect(insertPoint(SALES, emailPoint(b, 'ama@kofi-bakes.com', { scope: 'person', person_name: 'Ama Owusu', person_role: 'Manager' }))).rejects.toThrow(/person_check/);
    await insertPoint(SALES, emailPoint(b, 'ama@kofi-bakes.com', { scope: 'person', person_name: 'Ama Owusu', person_role: 'Manager', purpose: 'enquiry_response' }));
  });

  it('need an agent version when an automated worker adds them', async () => {
    const b = await business(OWNER);
    await expect(insertPoint('service', emailPoint(b, 'info@yaa-prints.com'))).rejects.toThrow(/actor_check/);
    const row = await insertPoint('service', emailPoint(b, 'info@yaa-prints.com', { agent_version: 'contact-research-1.0.0' }));
    expect(row.acquired_by).toBeNull();
  });

  it('keep their provenance fixed; validation and review fields can change', async () => {
    const b = await business(RESEARCHER);
    const { id } = await insertPoint(RESEARCHER, phonePoint(b, '+233302000221'));
    for (const change of [`source_type = 'crm_record'`, `source_note = 'something else'`, `value = '+233302000999'`, `acquired_by = null`, `acquired_at = now() - interval '1 year'`, `business_id = '${b}'::uuid, organization_id = '${otherOrg}'::uuid`]) {
      await expect(as(db, RESEARCHER, () => db.query(`update public.contact_points set ${change} where id = $1`, [id]))).rejects.toThrow(/cannot be changed|foreign key|violates/);
    }
    await as(db, RESEARCHER, () =>
      db.query(`update public.contact_points set classification = 'verified_business_channel', validated_at = now(), validation = '{"result":"valid"}'::jsonb, retention_until = current_date + 30, review_note = 'Checked' where id = $1`, [id]),
    );
    const [row] = await rows<Record<string, unknown>>(db, 'select classification, source_note from public.contact_points where id = $1', [id]);
    expect(row).toEqual({ classification: 'verified_business_channel', source_note: 'Given by the owner at the trade fair' });
  });

  it('follow workspace roles: viewers read, owners and admins delete, other workspaces see nothing', async () => {
    const b = await business(OWNER);
    const { id } = await insertPoint(SALES, phonePoint(b, '+233302000331'));
    await expect(insertPoint(VIEWER, phonePoint(b, '+233302000332'))).rejects.toThrow(/row-level security/);
    expect(await as(db, VIEWER, () => rows(db, 'select 1 from public.contact_points where id = $1', [id]))).toHaveLength(1);
    expect(await as(db, SALES, () => rows(db, 'delete from public.contact_points where id = $1 returning id', [id]))).toHaveLength(0);
    expect(await as(db, RESEARCHER, () => rows(db, 'delete from public.contact_points where id = $1 returning id', [id]))).toHaveLength(0);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.contact_points'))).toHaveLength(0);
    await expect(insertPoint(OTHER, { ...phonePoint(b, '+233302000333'), organization_id: otherOrg })).rejects.toThrow();
    await expect(insertPoint(OTHER, phonePoint(b, '+233302000334'))).rejects.toThrow(/row-level security/);
    expect(await as(db, OWNER, () => rows(db, 'delete from public.contact_points where id = $1 returning id', [id]))).toHaveLength(1);
  });
});

describe('consent records', () => {
  it('are recorded by signed-in people with the right role, never by automated workers', async () => {
    const b = await business(SALES);
    const row = await insertConsent(SALES, consent(b, { recorded_by: OWNER }));
    expect(row.recorded_by).toBe(SALES);
    await expect(insertConsent('service', consent(b))).rejects.toThrow(/automated workers cannot record it/);
    await expect(insertConsent(RESEARCHER, consent(b))).rejects.toThrow(/row-level security/);
    await expect(insertConsent(VIEWER, consent(b))).rejects.toThrow(/row-level security/);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.consent_records'))).toHaveLength(0);
  });

  it('need prior written consent for direct marketing (Act 843 s.40) and a basis for every grant', async () => {
    const b = await business(SALES);
    await expect(insertConsent(SALES, consent(b, { captured_via: 'phone_call' }))).rejects.toThrow(/written_check/);
    await expect(insertConsent(SALES, consent(b, { wording: null }))).rejects.toThrow(/written_check/);
    await insertConsent(SALES, consent(b, { captured_via: 'phone_call', wording: null, purpose: 'enquiry_response', lawful_basis: 'business_initiated' }));
    await expect(insertConsent(SALES, consent(b, { lawful_basis: null }))).rejects.toThrow(/basis_check/);
    await expect(insertConsent(SALES, consent(b, { status: 'withdrawn' }))).rejects.toThrow(/basis_check/);
    await expect(insertConsent(SALES, consent(b, { evidence: 'ok' }))).rejects.toThrow(/evidence_check/);
    await expect(insertConsent(SALES, consent(b, { expires_at: new Date(Date.now() - 120_000).toISOString() }))).rejects.toThrow(/dates_check/);
    await expect(insertConsent(SALES, consent(b, { captured_at: new Date(Date.now() + 86_400_000).toISOString() }))).rejects.toThrow(/dates_check/);
  });

  it('are append-only, for owners and the service role too', async () => {
    const b = await business(OWNER);
    const { id } = await insertConsent(OWNER, consent(b));
    await expect(as(db, OWNER, () => db.query(`update public.consent_records set evidence = 'Changed my mind about this' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, OWNER, () => db.query('delete from public.consent_records where id = $1', [id]))).rejects.toThrow(/permission denied/);
    await expect(asServiceRole(db, () => db.query(`update public.consent_records set status = 'withdrawn' where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(asServiceRole(db, () => db.query('delete from public.consent_records where id = $1', [id]))).rejects.toThrow(/permission denied/);
    // Even the table owner's direct edits are refused by the guard.
    await expect(db.query(`update public.consent_records set evidence = 'Edited by an administrator' where id = $1`, [id])).rejects.toThrow(/never edited/);
  });

  it('keep their history when the contact point is deleted', async () => {
    const b = await business(OWNER);
    const { id: point } = await insertPoint(OWNER, emailPoint(b, 'info@akua-hair.com'));
    const { id } = await insertConsent(OWNER, consent(b, { contact_point_id: point, contact_hint: 'i•••@akua-hair.com' }));
    await as(db, OWNER, () => db.query('delete from public.contact_points where id = $1', [point]));
    const [row] = await rows<Record<string, unknown>>(db, 'select contact_point_id, contact_hint, status from public.consent_records where id = $1', [id]);
    expect(row).toEqual({ contact_point_id: null, contact_hint: 'i•••@akua-hair.com', status: 'granted' });
  });

  it('cannot reference a contact point of another business', async () => {
    const a = await business(OWNER);
    const b = await business(OWNER);
    const { id: point } = await insertPoint(OWNER, emailPoint(a, 'info@ekow-auto.com'));
    await expect(insertConsent(OWNER, consent(b, { contact_point_id: point }))).rejects.toThrow(/foreign key/);
  });
});

describe('suppression', () => {
  it('follows a withdrawal: the withdrawn channel’s contact points are suppressed', async () => {
    const b = await business(SALES);
    const email = await insertPoint(SALES, emailPoint(b, 'info@esi-tailoring.com'));
    await insertPoint(SALES, emailPoint(b, 'orders@esi-tailoring.com'));
    await insertPoint(SALES, phonePoint(b, '+233302000441'));
    const wa = await insertPoint(SALES, phonePoint(b, '+233244000442', { type: 'whatsapp', phone_kind: 'mobile', value_hash: hash('phone:+233244000442') }));

    const one = await insertConsent(SALES, consent(b, { status: 'withdrawn', lawful_basis: null, contact_point_id: email.id, captured_via: 'email', evidence: 'Replied asking us to stop emailing' }));
    let list = await suppressionsFor('consent_record_id = $1', [one.id]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'email', channel: 'email', value_hash: hash('email:info@esi-tailoring.com'), reason: 'opted_out', source: 'consent_withdrawal', created_by: SALES });

    const all = await insertConsent(SALES, consent(b, { status: 'withdrawn', lawful_basis: null, channel: 'whatsapp', captured_via: 'whatsapp_message', evidence: 'Sent STOP on WhatsApp business chat' }));
    list = await suppressionsFor('consent_record_id = $1', [all.id]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'phone', channel: 'whatsapp', value_hash: hash('phone:+233244000442') });
    expect(wa.id).toBeTruthy();

    // Withdrawing again does not duplicate active entries.
    const again = await insertConsent(SALES, consent(b, { status: 'withdrawn', lawful_basis: null, contact_point_id: email.id, captured_via: 'email', evidence: 'Asked again to stop emailing' }));
    expect(await suppressionsFor('consent_record_id = $1', [again.id])).toHaveLength(0);
  });

  it('follows a business opt-out, on update and on insert, without duplicates', async () => {
    const b = await business(RESEARCHER, { name: 'Opt Out Bakery' });
    await insertPoint(RESEARCHER, emailPoint(b, 'info@optout-bakery.com'));
    await insertPoint(RESEARCHER, phonePoint(b, '+233302000551'));
    await insertPoint(RESEARCHER, phonePoint(b, '+233302000551', { type: 'whatsapp', phone_kind: 'mobile' })); // same number, both channels
    expect(await suppressionsFor('business_id = $1', [b])).toHaveLength(0);

    await as(db, SALES, () => db.query(`update public.businesses set contact_permission = 'opted_out', opted_out_at = now() where id = $1`, [b]));
    const byBusiness = await suppressionsFor('business_id = $1', [b]);
    expect(byBusiness).toHaveLength(1);
    expect(byBusiness[0]).toMatchObject({ kind: 'business', source: 'business_opt_out', hint: 'Opt Out Bakery', created_by: SALES });
    const values = await suppressionsFor('value_hash in ($1, $2)', [hash('email:info@optout-bakery.com'), hash('phone:+233302000551')]);
    expect(values.map((s) => s.kind).sort()).toEqual(['email', 'phone']);
    expect(values.every((s) => s.channel === null)).toBe(true);

    await as(db, SALES, () => db.query(`update public.businesses set notes = 'still opted out', contact_permission = 'opted_out' where id = $1`, [b]));
    expect(await suppressionsFor('business_id = $1', [b])).toHaveLength(1);

    const inserted = await business(OWNER, { name: 'Born Opted Out', contact_permission: 'opted_out', opted_out_at: new Date().toISOString() });
    expect(await suppressionsFor('business_id = $1', [inserted])).toHaveLength(1);
  });

  it('can be added by people who work on prospects, never edited or deleted', async () => {
    const value = hash('email:complaints@example-shop.com');
    const sql = `insert into public.suppressions (organization_id, kind, value_hash, hint, reason, created_by, lifted_at) values ($1, 'email', $2, 'c•••@example-shop.com', 'complaint', $3, now()) returning id, created_by, lifted_at`;
    await expect(as(db, VIEWER, () => db.query(sql, [org, value, VIEWER]))).rejects.toThrow(/row-level security/);
    const [row] = await as(db, RESEARCHER, () => rows<Record<string, unknown>>(db, sql, [org, value, OWNER]));
    expect(row).toMatchObject({ created_by: RESEARCHER, lifted_at: null });
    await expect(as(db, SALES, () => db.query(sql, [org, value, SALES]))).rejects.toThrow(/suppressions_active_idx/);
    await expect(as(db, OWNER, () => db.query(`update public.suppressions set reason = 'other' where id = $1`, [row.id]))).rejects.toThrow(/never edited/);
    await expect(as(db, OWNER, () => db.query(`update public.suppressions set hint = 'x' where id = $1`, [row.id]))).rejects.toThrow(/never edited/);
    await expect(as(db, OWNER, () => db.query('delete from public.suppressions where id = $1', [row.id]))).rejects.toThrow(/permission denied/);
    await expect(asServiceRole(db, () => db.query('delete from public.suppressions where id = $1', [row.id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, RESEARCHER, () => db.query(`insert into public.suppressions (organization_id, kind, hint, reason) values ($1, 'business', 'No business', 'other')`, [org]))).rejects.toThrow(/names the business/);
    await expect(as(db, RESEARCHER, () => db.query(`insert into public.suppressions (organization_id, kind, hint, reason) values ($1, 'email', 'No value', 'other')`, [org]))).rejects.toThrow(/target_check/);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.suppressions'))).toHaveLength(0);
  });

  it('are lifted only by owners and admins, against a current consent record made afterwards for that contact', async () => {
    const b = await business(SALES);
    const point = await insertPoint(SALES, emailPoint(b, 'info@lift-me.com'));
    const other = await insertPoint(SALES, emailPoint(b, 'billing@lift-me.com'));
    const oldConsent = await insertConsent(SALES, consent(b, { contact_point_id: point.id }));
    const withdrawal = await insertConsent(SALES, consent(b, { status: 'withdrawn', lawful_basis: null, contact_point_id: point.id, captured_via: 'email', evidence: 'Asked to stop emailing for now' }));
    const [s] = await suppressionsFor('consent_record_id = $1', [withdrawal.id]);
    const lift = (user: string, consentId: string | null, reason = 'They asked to hear from us again in writing') =>
      as(db, user, () => rows(db, `update public.suppressions set lift_consent_id = $2, lift_reason = $3, lifted_at = now(), lifted_by = $4 where id = $1 returning id, lifted_by`, [s.id, consentId, reason, user]));

    expect(await lift(SALES, null)).toHaveLength(0); // RLS: not an owner/admin
    await expect(lift(OWNER, null)).rejects.toThrow(/current consent record made after it/);
    await expect(lift(OWNER, oldConsent.id)).rejects.toThrow(/current consent record made after it/);
    await expect(lift(OWNER, withdrawal.id)).rejects.toThrow(/current consent record made after it/);
    const expired = await insertConsent(SALES, consent(b, { contact_point_id: point.id, captured_at: new Date(Date.now() - 4 * 60_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() }));
    await expect(lift(OWNER, expired.id)).rejects.toThrow(/current consent record made after it/);
    const wrongContact = await insertConsent(SALES, consent(b, { contact_point_id: other.id }));
    await expect(lift(OWNER, wrongContact.id)).rejects.toThrow(/must cover the suppressed contact/);
    const wrongChannel = await insertConsent(SALES, consent(b, { channel: 'phone', purpose: 'enquiry_response', lawful_basis: 'business_initiated', captured_via: 'phone_call', wording: null }));
    await expect(lift(OWNER, wrongChannel.id)).rejects.toThrow(/must cover the suppressed contact/);
    const fresh = await insertConsent(SALES, consent(b, { contact_point_id: point.id }));
    await expect(lift(OWNER, fresh.id, 'short')).rejects.toThrow(/at least 10 characters/);

    const [lifted] = await lift(OWNER, fresh.id);
    expect(lifted).toMatchObject({ lifted_by: OWNER });
    await expect(lift(OWNER, fresh.id)).rejects.toThrow(/already lifted/);
    await expect(as(db, OWNER, () => db.query(`update public.suppressions set lift_reason = 'A different reason entirely' where id = $1`, [s.id]))).rejects.toThrow(/already lifted/);
    // A new entry can be added once the old one is lifted.
    await insertConsent(SALES, consent(b, { status: 'withdrawn', lawful_basis: null, contact_point_id: point.id, captured_via: 'email', evidence: 'Stopped again a week later' }));
    expect((await suppressionsFor('value_hash = $1 and lifted_at is null', [hash('email:info@lift-me.com')])).length).toBe(1);
  });

  it('cannot be lifted by an automated worker', async () => {
    const b = await business(SALES);
    await as(db, SALES, () => db.query(`update public.businesses set contact_permission = 'opted_out', opted_out_at = now() where id = $1`, [b]));
    const [s] = await suppressionsFor('business_id = $1', [b]);
    await expect(asServiceRole(db, () => db.query(`update public.suppressions set lift_reason = 'Automated lift attempt here', lifted_at = now() where id = $1`, [s.id]))).rejects.toThrow(/Only owners and administrators/);
  });

  it('outlive the business and its contact details', async () => {
    const b = await business(OWNER, { name: 'Gone Soon Co' });
    await insertPoint(OWNER, emailPoint(b, 'info@gone-soon.com'));
    const withdrawal = await insertConsent(OWNER, consent(b, { status: 'withdrawn', lawful_basis: null, captured_via: 'email', evidence: 'Unsubscribe link used on our email' }));
    await as(db, OWNER, () => db.query(`update public.businesses set contact_permission = 'opted_out', opted_out_at = now() where id = $1`, [b]));
    const before = await suppressionsFor(`value_hash = $1 or business_id = $2`, [hash('email:info@gone-soon.com'), b]);
    expect(before.length).toBeGreaterThanOrEqual(2);

    await as(db, OWNER, () => db.query('delete from public.businesses where id = $1', [b]));
    expect(await rows(db, 'select 1 from public.contact_points where business_id = $1', [b])).toHaveLength(0);
    expect(await rows(db, 'select 1 from public.consent_records where business_id = $1', [b])).toHaveLength(0);
    const after = await rows<Record<string, unknown>>(db, 'select id, kind, business_id, consent_record_id, value_hash from public.suppressions where id = any($1)', [before.map((s) => s.id)]);
    expect(after).toHaveLength(before.length);
    expect(after.every((s) => s.business_id === null && s.consent_record_id === null)).toBe(true);
    expect(after.find((s) => s.kind === 'email')?.value_hash).toBe(hash('email:info@gone-soon.com'));
    expect(withdrawal.id).toBeTruthy();
    // No leftovers of the deleted records' contents in the audit trail.
    const audit = await rows<{ changes: unknown }>(db, `select changes from public.audit_events where table_name = 'contact_points' and changes::text like '%gone-soon%'`);
    expect(audit).toHaveLength(0);
  });
});

describe('re-running, independence and rollback', () => {
  it('can be applied again without changing data', async () => {
    const count = async () => (await rows<{ n: number }>(db, 'select (select count(*) from public.contact_points) + (select count(*) from public.consent_records) + (select count(*) from public.suppressions) as n'))[0].n;
    const before = await count();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '005_contact_intelligence.sql'), 'utf8'));
    expect(await count()).toBe(before);
  });

  it('applies without migrations 003 and 004', async () => {
    const d = await createDatabase({ skip: ['003', '004', '007'] });
    await createUser(d, OWNER, 'owner5@example.com');
    const { org_id } = await workspace(d, OWNER);
    const b = await business(OWNER, {}, d, org_id);
    await insertPoint(OWNER, { ...phonePoint(b, '+233302000661'), organization_id: org_id }, d);
    await as(d, OWNER, () => d.query(`update public.businesses set contact_permission = 'opted_out', opted_out_at = now() where id = $1`, [b]));
    expect(await rows(d, 'select 1 from public.suppressions where organization_id = $1', [org_id])).toHaveLength(2);
    await d.close();
  });

  it('removes migration 005 cleanly, keeps opt-outs working, and can be re-applied', async () => {
    const d = await createDatabase();
    await createUser(d, OWNER, 'owner5@example.com');
    const { org_id } = await workspace(d, OWNER);
    const keep = await business(OWNER, { name: 'Keep Me' }, d, org_id);
    // Rollbacks run newest first: 006 builds on these tables.
    await expect(d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '005_contact_intelligence_down.sql'), 'utf8'))).rejects.toThrow(/Run supabase\/rollback\/006_messaging_down.sql first/);
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '008_response_conversion_down.sql'), 'utf8'));
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '007_sending_policy_down.sql'), 'utf8'));
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '006_messaging_down.sql'), 'utf8'));
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '005_contact_intelligence_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name::text from information_schema.tables where table_schema = 'public' and table_name in ('contact_points', 'consent_records', 'suppressions')
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guard_contact_point', 'guard_consent_record', 'guard_suppression', 'suppress_on_withdrawal', 'suppress_on_business_opt_out')
       union all select tgname::text from pg_trigger where tgname = 'businesses_opt_out_suppression'`,
    );
    expect(leftovers).toEqual([]);
    await as(d, OWNER, () => d.query(`update public.businesses set contact_permission = 'opted_out', opted_out_at = now() where id = $1`, [keep]));
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '005_contact_intelligence.sql'), 'utf8'));
    expect(await rows(d, `select 1 from public.suppressions where business_id = $1 and kind = 'business'`, [keep])).toHaveLength(1);
    await d.close();
  });
});
