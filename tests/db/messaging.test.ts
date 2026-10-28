import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, fixtureNow, freezeMessagingClock, rows } from './harness';

// Exercises migration 006 (templates, eligibility decisions, the outbound queue, received messages
// and webhook events) on PGlite: who may move a message between which statuses, approval and
// dispatch against stored decisions, deduplication, automatic suppression, row-level security,
// re-running and the rollback.

const OWNER = '00000000-0000-4000-8000-0000000006a1';
const ADMIN = '00000000-0000-4000-8000-0000000006a2';
const SALES = '00000000-0000-4000-8000-0000000006a3';
const VIEWER = '00000000-0000-4000-8000-0000000006a4';
const OTHER = '00000000-0000-4000-8000-0000000006b1';

let db: PGlite;
let org: string;
let otherOrg: string;
/** An approved email template covered by a message policy (migration 007 requires one). */
let covered: string;

type Actor = string | 'service';
type Row = Record<string, unknown>;

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const bodyHash = (subject: string | null, body: string) => hash(`${subject ?? ''}\n${body}`);
const workspace = async (d: PGlite, user: string) => (await as(d, user, () => rows<{ org_id: string; member_role: string }>(d, 'select * from public.ensure_workspace()')))[0];
const run = <T>(actor: Actor, fn: () => Promise<T>, d = db) => (actor === 'service' ? asServiceRole(d, fn) : as(d, actor, fn));

async function insert(actor: Actor, table: string, values: Row, d = db) {
  const cols = Object.keys(values);
  const [row] = await run(actor, () => rows<Row>(d, `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(values)), d);
  return row;
}

async function update(actor: Actor, table: string, id: unknown, values: Row, d = db) {
  const cols = Object.keys(values);
  const [row] = await run(actor, () => rows<Row>(d, `update public.${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...Object.values(values)]), d);
  return row;
}

/** Queues a message on the fixture clock; a missing `scheduled_for` would be stamped from the wall clock. */
const queue = (actor: Actor, id: unknown) => update(actor, 'outreach_messages', id, { status: 'queued', scheduled_for: fixtureNow() });

async function business(name = `Biz ${Math.random().toString(36).slice(2, 7)}`, d = db, organization = org, user = OWNER) {
  return (await insert(user, 'businesses', { organization_id: organization, name, city: 'Accra' }, d)).id as string;
}

async function emailPoint(businessId: string, email: string) {
  return (await insert(OWNER, 'contact_points', {
    organization_id: org,
    business_id: businessId,
    type: 'email',
    value: email,
    normalized_value: email,
    value_hash: hash(`email:${email}`),
    domain_hash: hash(`domain:${email.split('@')[1]}`),
    hint: `${email[0]}•••@${email.split('@')[1]}`,
    scope: 'business',
    source_type: 'directly_provided',
    source_note: 'Given by the owner',
  })) as { id: string; value_hash: string; hint: string };
}

async function draft(actor: Actor, businessId: string, pointId: string, email: string, extra: Row = {}) {
  return insert(actor, 'outreach_messages', {
    organization_id: org,
    business_id: businessId,
    contact_point_id: pointId,
    channel: 'email',
    purpose: 'introduction',
    subject: 'Ideas for your website',
    body: `Hello, thank you for agreeing to hear from us. ${Math.random()}`,
    recipient_hash: hash(`email:${email}`),
    recipient_hint: `${email[0]}•••@${email.split('@')[1]}`,
    template_id: covered,
    template_version: 1,
    ...extra,
  });
}

function decisionFor(message: Row, stage: 'preview' | 'approval' | 'dispatch', extra: Row = {}): Row {
  return {
    organization_id: org,
    message_id: message.id,
    business_id: message.business_id,
    contact_point_id: message.contact_point_id,
    channel: message.channel,
    purpose: message.purpose,
    stage,
    outcome: 'eligible',
    reasons: '[]',
    checks: JSON.stringify([{ key: 'consent', status: 'pass', detail: 'Granted' }]),
    inputs: '{}',
    body_hash: message.body_hash,
    recipient_hash: message.recipient_hash,
    gateway_version: 'gateway-1.0.0',
    actor_type: 'user',
    ...extra,
  };
}

/** Drafts a message, stores an approval decision as the approver and approves it. */
async function approved(approver = OWNER) {
  const b = await business();
  const email = `info-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const point = await emailPoint(b, email);
  const m = await draft(SALES, b, point.id, email);
  const d = await insert(approver, 'eligibility_decisions', decisionFor(m, 'approval'));
  return { message: await update(approver, 'outreach_messages', m.id, { status: 'approved', decision_id: d.id }), businessId: b, point, email };
}

async function dispatchDecision(message: Row, extra: Row = {}) {
  return insert('service', 'eligibility_decisions', decisionFor(message, 'dispatch', { actor_id: OWNER, sandbox: true, ...extra }));
}

beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER, 'owner6@example.com');
  org = (await workspace(db, OWNER)).org_id;
  for (const [id, email] of [
    [ADMIN, 'admin6@example.com'],
    [SALES, 'sales6@example.com'],
    [VIEWER, 'viewer6@example.com'],
    [OTHER, 'other6@example.com'],
  ]) {
    await createUser(db, id, email);
  }
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values ($1, 'admin6@example.com', 'admin'), ($1, 'sales6@example.com', 'sales'), ($1, 'viewer6@example.com', 'viewer')`,
      [org],
    ),
  );
  expect((await workspace(db, ADMIN)).member_role).toBe('admin');
  expect((await workspace(db, SALES)).member_role).toBe('sales');
  expect((await workspace(db, VIEWER)).member_role).toBe('viewer');
  otherOrg = (await workspace(db, OTHER)).org_id;

  await freezeMessagingClock(db);
  const t = await insert(OWNER, 'message_templates', { organization_id: org, channel: 'email', name: 'Covered introduction', purpose: 'introduction', subject: 'Hello', body: 'Hello {{business_name}}' });
  await update(OWNER, 'message_templates', t.id, { status: 'approved' });
  // A policy's expiry is checked against approved_at = now(), the record clock, so it stays relative to
  // the wall clock; the policy clock only has to see it as unexpired, which it always will.
  await insert(OWNER, 'message_policies', { organization_id: org, name: 'Introductions', template_id: t.id, template_version: 1, channel: 'email', purpose: 'introduction', daily_cap: 50, expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString() });
  covered = t.id as string;
});

describe('message templates', () => {
  const email = (extra: Row = {}): Row => ({ organization_id: org, channel: 'email', name: `Intro ${Math.random()}`, purpose: 'introduction', subject: 'Hello', body: 'Hello {{business_name}}', ...extra });
  const whatsapp = (extra: Row = {}): Row => ({ organization_id: org, channel: 'whatsapp', name: `wa ${Math.random()}`, purpose: 'introduction', provider_template_name: 'intro_v1', body: 'Hello {{business_name}}. Reply STOP to opt out.', ...extra });

  it('are written by owners and admins and always start as drafts', async () => {
    await expect(insert(SALES, 'message_templates', email())).rejects.toThrow(/row-level security/);
    const t = await insert(ADMIN, 'message_templates', email({ status: 'approved', approved_by: ADMIN, version: 7 }));
    expect(t).toMatchObject({ status: 'draft', approved_by: null, version: 1, created_by: ADMIN });
    await expect(insert(OWNER, 'message_templates', email({ subject: null }))).rejects.toThrow(/channel_fields_check/);
    await expect(insert(OWNER, 'message_templates', whatsapp({ provider_template_name: null }))).rejects.toThrow(/channel_fields_check/);
    await expect(insert(OWNER, 'message_templates', whatsapp({ subject: 'No subjects on WhatsApp' }))).rejects.toThrow(/channel_fields_check/);
    await expect(insert(OWNER, 'message_templates', email({ name: t.name }))).rejects.toThrow(/message_templates_name_key/);
  });

  it('need a person to approve email templates, and editing content sends them back to draft', async () => {
    const t = await insert(OWNER, 'message_templates', email());
    await expect(update('service', 'message_templates', t.id, { status: 'approved' })).rejects.toThrow(/approved by a person/);
    await expect(update(OWNER, 'message_templates', t.id, { status: 'pending' })).rejects.toThrow(/not allowed|email_status_check/);
    const ok = await update(OWNER, 'message_templates', t.id, { status: 'approved' });
    expect(ok).toMatchObject({ status: 'approved', approved_by: OWNER });
    const edited = await update(ADMIN, 'message_templates', t.id, { body: 'Hello again {{business_name}}' });
    expect(edited).toMatchObject({ status: 'draft', version: 2, approved_by: null, approved_at: null });
    await expect(update(OWNER, 'message_templates', t.id, { channel: 'whatsapp', provider_template_name: 'x', subject: null })).rejects.toThrow(/keeps its channel/);
  });

  it('take WhatsApp status only from the server; a sync never re-enables a disabled template', async () => {
    const t = await insert('service', 'message_templates', whatsapp({ status: 'approved', provider_template_id: '123', provider_category: 'MARKETING' }));
    expect(t).toMatchObject({ status: 'approved', created_by: null, provider_template_id: '123' });
    await expect(update(OWNER, 'message_templates', t.id, { status: 'paused' })).rejects.toThrow(/comes from Meta/);
    expect(await update(OWNER, 'message_templates', t.id, { provider_template_id: 'forged', provider_category: 'UTILITY' })).toMatchObject({ provider_template_id: '123', provider_category: 'MARKETING' });
    expect(await update(OWNER, 'message_templates', t.id, { status: 'disabled' })).toMatchObject({ status: 'disabled' });
    expect(await update('service', 'message_templates', t.id, { status: 'approved', status_checked_at: new Date().toISOString() })).toMatchObject({ status: 'disabled' });
    // New text from Meta does not re-enable it either.
    expect(await update('service', 'message_templates', t.id, { status: 'approved', body: 'Hello {{business_name}}! Reply STOP to opt out.' })).toMatchObject({ status: 'disabled', version: 2 });
    expect(await update(OWNER, 'message_templates', t.id, { status: 'pending' })).toMatchObject({ status: 'pending' });
    expect(await update('service', 'message_templates', t.id, { status: 'approved' })).toMatchObject({ status: 'approved' });
  });
});

describe('eligibility decisions', () => {
  it('are append-only and name the person they were made for', async () => {
    const b = await business();
    const point = await emailPoint(b, 'decisions@example.com');
    const m = await draft(SALES, b, point.id, 'decisions@example.com');
    const d = await insert(SALES, 'eligibility_decisions', decisionFor(m, 'preview', { actor_type: 'system', actor_id: OWNER }));
    expect(d).toMatchObject({ actor_type: 'user', actor_id: SALES });
    await expect(as(db, OWNER, () => db.query(`update public.eligibility_decisions set outcome = 'blocked' where id = $1`, [d.id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, OWNER, () => db.query('delete from public.eligibility_decisions where id = $1', [d.id]))).rejects.toThrow(/permission denied/);
    await expect(asServiceRole(db, () => db.query('delete from public.eligibility_decisions where id = $1', [d.id]))).rejects.toThrow(/permission denied/);
    await expect(insert('service', 'eligibility_decisions', decisionFor(m, 'dispatch'))).rejects.toThrow(/names that person/);
    await expect(insert(SALES, 'eligibility_decisions', decisionFor(m, 'preview', { reasons: '["No consent"]' }))).rejects.toThrow(/outcome_reasons_check/);
    await expect(insert(VIEWER, 'eligibility_decisions', decisionFor(m, 'preview'))).rejects.toThrow(/row-level security/);
  });
});

describe('outreach messages', () => {
  it('start as drafts with a body hash computed by the database', async () => {
    const b = await business();
    const point = await emailPoint(b, 'drafts@example.com');
    const m = await draft(SALES, b, point.id, 'drafts@example.com', { body: 'Hello there' });
    expect(m).toMatchObject({ status: 'draft', created_by: SALES, body_hash: bodyHash('Ideas for your website', 'Hello there'), sandbox: false, dedupe_key: null });
    await expect(draft(SALES, b, point.id, 'drafts@example.com', { status: 'queued' })).rejects.toThrow(/start as drafts/);
    await expect(draft('service', b, point.id, 'drafts@example.com')).rejects.toThrow(/agent version/);
    expect(await draft('service', b, point.id, 'drafts@example.com', { agent_version: 'outreach-drafting-1.0.0' })).toMatchObject({ created_by: null });
    await expect(draft(VIEWER, b, point.id, 'drafts@example.com')).rejects.toThrow(/row-level security/);
    await expect(draft(SALES, b, point.id, 'drafts@example.com', { subject: null })).rejects.toThrow(/channel_fields_check/);
    const edited = await update(SALES, 'outreach_messages', m.id, { body: 'Hello again' });
    expect(edited.body_hash).toBe(bodyHash('Ideas for your website', 'Hello again'));
  });

  it('need an eligible approval decision for the exact text, made by the approving owner or admin', async () => {
    const b = await business();
    const point = await emailPoint(b, 'approve@example.com');
    const m = await draft(SALES, b, point.id, 'approve@example.com');
    await expect(update(OWNER, 'outreach_messages', m.id, { status: 'approved' })).rejects.toThrow(/current eligibility decision/);

    const preview = await insert(OWNER, 'eligibility_decisions', decisionFor(m, 'preview'));
    await expect(update(OWNER, 'outreach_messages', m.id, { status: 'approved', decision_id: preview.id })).rejects.toThrow(/current eligibility decision/);
    const blocked = await insert(OWNER, 'eligibility_decisions', decisionFor(m, 'approval', { outcome: 'blocked', reasons: '["No consent"]' }));
    await expect(update(OWNER, 'outreach_messages', m.id, { status: 'approved', decision_id: blocked.id })).rejects.toThrow(/current eligibility decision/);
    const stale = await insert(OWNER, 'eligibility_decisions', decisionFor(m, 'approval', { body_hash: hash('other text') }));
    await expect(update(OWNER, 'outreach_messages', m.id, { status: 'approved', decision_id: stale.id })).rejects.toThrow(/current eligibility decision/);
    const admins = await insert(ADMIN, 'eligibility_decisions', decisionFor(m, 'approval'));
    await expect(update(OWNER, 'outreach_messages', m.id, { status: 'approved', decision_id: admins.id })).rejects.toThrow(/current eligibility decision/);
    const sales = await insert(SALES, 'eligibility_decisions', decisionFor(m, 'approval'));
    await expect(update(SALES, 'outreach_messages', m.id, { status: 'approved', decision_id: sales.id })).rejects.toThrow(/Only owners and administrators/);

    const ok = await insert(OWNER, 'eligibility_decisions', decisionFor(m, 'approval'));
    const row = await update(OWNER, 'outreach_messages', m.id, { status: 'approved', decision_id: ok.id, approved_by: SALES, sandbox: true, provider_message_id: 'forged' });
    expect(row).toMatchObject({ status: 'approved', approved_by: OWNER, decision_id: ok.id, sandbox: false, provider_message_id: null });
    expect(row.approved_at).not.toBeNull();

    await expect(update(OWNER, 'outreach_messages', m.id, { body: 'Changed after approval' })).rejects.toThrow(/Only a draft can be edited/);
    expect(await update(SALES, 'outreach_messages', m.id, { status: 'draft' })).toMatchObject({ status: 'draft', approved_by: null, approved_at: null, decision_id: null });
  });

  it('leave sending and delivery to the server', async () => {
    const { message } = await approved();
    const queued = await queue(SALES, message.id);
    expect(queued.queued_at).not.toBeNull();
    for (const status of ['sending', 'sent', 'delivered', 'failed', 'blocked']) {
      await expect(update(OWNER, 'outreach_messages', message.id, { status })).rejects.toThrow(/recorded by the server/);
    }
    await expect(update('service', 'outreach_messages', message.id, { status: 'sending' })).rejects.toThrow(/Dispatch needs a current eligibility decision/);
    const old = await insert(OWNER, 'eligibility_decisions', decisionFor(queued, 'approval'));
    await expect(update('service', 'outreach_messages', message.id, { status: 'sending', dispatch_decision_id: old.id })).rejects.toThrow(/Dispatch needs a current eligibility decision/);

    const d = await dispatchDecision(queued);
    expect(d).toMatchObject({ actor_type: 'user', actor_id: OWNER, sandbox: true });
    const sending = await update('service', 'outreach_messages', message.id, { status: 'sending', dispatch_decision_id: d.id });
    expect(sending).toMatchObject({ status: 'sending', sandbox: true });
    expect(sending.sending_at).not.toBeNull();
    await expect(update('service', 'outreach_messages', message.id, { status: 'sent' })).rejects.toThrow(/sent_check/);
    await update('service', 'outreach_messages', message.id, { status: 'sent', provider: 'resend', provider_message_id: `re_${message.id}` });
    const delivered = await update('service', 'outreach_messages', message.id, { status: 'delivered' });
    expect(delivered.delivered_at).not.toBeNull();
    await expect(update('service', 'outreach_messages', message.id, { status: 'sent' })).rejects.toThrow(/not allowed \(delivered>sent\)/);
    await expect(update(OWNER, 'outreach_messages', message.id, { status: 'cancelled' })).rejects.toThrow(/not allowed/);
    // Sent messages are the record of contact: nobody deletes them.
    expect(await as(db, OWNER, () => rows(db, 'delete from public.outreach_messages where id = $1 returning id', [message.id]))).toHaveLength(0);
  });

  it('cannot be queued twice with the same text for the same recipient', async () => {
    const { message, businessId, point, email } = await approved();
    const first = await queue(SALES, message.id);
    expect(first.dedupe_key).toBe(hash(`${org}:email:${hash(`email:${email}`)}:${first.body_hash}`));

    const again = await draft(SALES, businessId, point.id, email, { body: message.body });
    const d = await insert(OWNER, 'eligibility_decisions', decisionFor(again, 'approval'));
    await update(OWNER, 'outreach_messages', again.id, { status: 'approved', decision_id: d.id });
    await expect(queue(SALES, again.id)).rejects.toThrow(/outreach_messages_dedupe_idx/);

    await update(SALES, 'outreach_messages', first.id, { status: 'cancelled' });
    expect(await queue(SALES, again.id)).toMatchObject({ status: 'queued' });
  });

  it('suppress the recipient after a bounce (that channel) or a complaint (every channel)', async () => {
    for (const outcome of ['bounced', 'complained'] as const) {
      const { message } = await approved();
      const queued = await queue(SALES, message.id);
      await update('service', 'outreach_messages', message.id, { status: 'sending', dispatch_decision_id: (await dispatchDecision(queued)).id });
      await update('service', 'outreach_messages', message.id, { status: outcome, status_reason: `Provider reported ${outcome}`, provider: 'resend', provider_message_id: `re_${message.id}` });
      const [s] = await rows<Row>(db, 'select kind, channel, reason, source, hint from public.suppressions where value_hash = $1 and lifted_at is null', [message.recipient_hash]);
      expect(s).toEqual({ kind: 'email', channel: outcome === 'bounced' ? 'email' : null, reason: outcome === 'bounced' ? 'bounced' : 'complaint', source: 'provider_event', hint: message.recipient_hint });
    }
  });

  it('are deleted only as unsent drafts by owners and admins, and stay inside their workspace', async () => {
    const b = await business();
    const point = await emailPoint(b, 'delete@example.com');
    const m = await draft(SALES, b, point.id, 'delete@example.com');
    expect(await as(db, SALES, () => rows(db, 'delete from public.outreach_messages where id = $1 returning id', [m.id]))).toHaveLength(0);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.outreach_messages'))).toHaveLength(0);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.eligibility_decisions'))).toHaveLength(0);
    expect(await as(db, OTHER, () => rows(db, 'update public.outreach_messages set status = $2 where id = $1 returning id', [m.id, 'cancelled']))).toHaveLength(0);
    await expect(insert(OTHER, 'outreach_messages', { organization_id: org, business_id: b, channel: 'email', purpose: 'introduction', subject: 'x', body: 'x', recipient_hash: hash('x'), recipient_hint: 'x' })).rejects.toThrow(/row-level security/);
    expect(await as(db, VIEWER, () => rows(db, 'select 1 from public.outreach_messages where id = $1', [m.id]))).toHaveLength(1);
    expect(await as(db, ADMIN, () => rows(db, 'delete from public.outreach_messages where id = $1 returning id', [m.id]))).toHaveLength(1);
  });

  it('are audited, and deleting a business removes its messages but keeps the decisions', async () => {
    const { message, businessId } = await approved();
    const audit = await rows<{ action: string }>(db, `select action from public.audit_events where table_name = 'outreach_messages' and record_id = $1 order by id`, [message.id]);
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update']);
    await as(db, OWNER, () => db.query('delete from public.businesses where id = $1', [businessId]));
    expect(await rows(db, 'select 1 from public.outreach_messages where id = $1', [message.id])).toHaveLength(0);
    expect(await rows<Row>(db, 'select business_id from public.eligibility_decisions where message_id = $1', [message.id])).toEqual([{ business_id: null }]);
  });
});

describe('received messages', () => {
  const inbound = (extra: Row = {}): Row => ({
    organization_id: org,
    channel: 'email',
    provider: 'resend',
    provider_message_id: `in_${Math.random()}`,
    sender_hash: hash('email:replier@example.com'),
    sender_hint: 'r•••@example.com',
    body: 'Thanks, tell me more',
    received_at: new Date().toISOString(),
    ...extra,
  });

  it('come from the server, or are logged by a person as manual', async () => {
    await expect(insert(SALES, 'inbound_messages', inbound())).rejects.toThrow(/recorded by the server|row-level security/);
    await expect(insert('service', 'inbound_messages', inbound({ provider: 'manual' }))).rejects.toThrow(/signed-in person/);
    const manual = await insert(SALES, 'inbound_messages', inbound({ provider: 'manual', handled_at: new Date().toISOString() }));
    expect(manual).toMatchObject({ created_by: SALES, handled_at: null });
    await expect(insert(VIEWER, 'inbound_messages', inbound({ provider: 'manual' }))).rejects.toThrow(/row-level security/);
    const m = await insert('service', 'inbound_messages', inbound());
    await expect(insert('service', 'inbound_messages', inbound({ provider_message_id: m.provider_message_id }))).rejects.toThrow(/inbound_messages_provider_key/);
    await expect(insert('service', 'inbound_messages', inbound({ received_at: new Date(Date.now() + 3_600_000).toISOString() }))).rejects.toThrow(/future/);
    await expect(insert('service', 'inbound_messages', inbound({ opt_out: true }))).rejects.toThrow(/opt_out_check/);
  });

  it('keep their content; only handling and the prospect link change', async () => {
    const m = await insert('service', 'inbound_messages', inbound());
    await expect(update(SALES, 'inbound_messages', m.id, { body: 'Edited' })).rejects.toThrow(/not edited/);
    const handled = await update(SALES, 'inbound_messages', m.id, { handled_at: '2001-01-01T00:00:00Z' });
    expect(handled.handled_by).toBe(SALES);
    expect(new Date(handled.handled_at as string).getFullYear()).toBeGreaterThan(2001);
    expect(await update(SALES, 'inbound_messages', m.id, { handled_at: null })).toMatchObject({ handled_at: null, handled_by: null });
  });

  it('suppress the sender on every channel when the reply opts out', async () => {
    const sender = hash('email:stop-me@example.com');
    await insert('service', 'inbound_messages', inbound({ sender_hash: sender, sender_hint: 's•••@example.com', body: 'STOP', opt_out: true, opt_out_match: 'stop' }));
    const [s] = await rows<Row>(db, 'select kind, channel, reason, source, business_id from public.suppressions where value_hash = $1', [sender]);
    expect(s).toEqual({ kind: 'email', channel: null, reason: 'opted_out', source: 'inbound_opt_out', business_id: null });
    // A second opt-out from the same sender does not duplicate the suppression.
    await insert('service', 'inbound_messages', inbound({ sender_hash: sender, sender_hint: 's•••@example.com', body: 'stop', opt_out: true, opt_out_match: 'stop' }));
    expect(await rows(db, 'select 1 from public.suppressions where value_hash = $1', [sender])).toHaveLength(1);
  });
});

describe('webhook events', () => {
  it('are written once per provider event, only by the server', async () => {
    const event = { organization_id: org, provider: 'resend', event_id: 'msg_abc', event_type: 'email.delivered' };
    await expect(as(db, OWNER, () => db.query(`insert into public.channel_events (organization_id, provider, event_id, event_type) values ($1, 'resend', 'x', 'y')`, [org]))).rejects.toThrow(/permission denied/);
    const e = await insert('service', 'channel_events', event);
    await expect(insert('service', 'channel_events', event)).rejects.toThrow(/channel_events_event_key/);
    expect(await update('service', 'channel_events', e.id, { outcome: 'processed', processed_at: new Date().toISOString() })).toMatchObject({ outcome: 'processed' });
    await expect(asServiceRole(db, () => db.query('delete from public.channel_events where id = $1', [e.id]))).rejects.toThrow(/permission denied/);
    expect(await as(db, VIEWER, () => rows(db, 'select 1 from public.channel_events where id = $1', [e.id]))).toHaveLength(1);
    expect(await as(db, OTHER, () => rows(db, 'select 1 from public.channel_events'))).toHaveLength(0);
    expect(otherOrg).not.toBe(org);
  });
});

describe('re-running and rollback', () => {
  it('can be applied again without changing data', async () => {
    const count = async () =>
      (await rows<{ n: number }>(db, 'select (select count(*) from public.message_templates) + (select count(*) from public.outreach_messages) + (select count(*) from public.eligibility_decisions) + (select count(*) from public.inbound_messages) as n'))[0].n;
    const before = await count();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '006_messaging.sql'), 'utf8'));
    expect(await count()).toBe(before);
  });

  it('removes migration 006 cleanly, keeps the suppressions it caused, and can be re-applied', async () => {
    const d = await createDatabase();
    await createUser(d, OWNER, 'owner6@example.com');
    const { org_id } = await workspace(d, OWNER);
    await asServiceRole(d, () =>
      d.query(`insert into public.inbound_messages (organization_id, channel, provider, provider_message_id, sender_hash, sender_hint, body, received_at, opt_out, opt_out_match) values ($1, 'whatsapp', 'whatsapp_cloud', 'wamid.1', $2, '+233 ••• 111', 'STOP', now(), true, 'stop')`, [
        org_id,
        hash('phone:+233200000111'),
      ]),
    );
    // Rollbacks run newest first: 007 and 008 build on these tables.
    await expect(d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '006_messaging_down.sql'), 'utf8'))).rejects.toThrow(/Run supabase\/rollback\/008_response_conversion_down.sql first/);
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '008_response_conversion_down.sql'), 'utf8'));
    await expect(d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '006_messaging_down.sql'), 'utf8'))).rejects.toThrow(/Run supabase\/rollback\/007_sending_policy_down.sql first/);
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '007_sending_policy_down.sql'), 'utf8'));
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '006_messaging_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name::text from information_schema.tables where table_schema = 'public' and table_name in ('message_templates', 'eligibility_decisions', 'outreach_messages', 'inbound_messages', 'channel_events')
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guard_message_template', 'guard_eligibility_decision', 'guard_outreach_message', 'suppress_on_delivery_failure', 'guard_inbound_message', 'suppress_on_inbound_opt_out')`,
    );
    expect(leftovers).toEqual([]);
    expect(await rows<Row>(d, 'select source from public.suppressions where organization_id = $1', [org_id])).toEqual([{ source: 'inbound_opt_out' }]);
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '006_messaging.sql'), 'utf8'));
    expect(await rows(d, `select 1 from information_schema.tables where table_schema = 'public' and table_name = 'outreach_messages'`)).toHaveLength(1);
    await d.close();
  });
});
