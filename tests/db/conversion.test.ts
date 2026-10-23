import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, rows } from './harness';

// Exercises migration 008 on PGlite: the append-only reply classifications (an opt-out stays one),
// proposal change requests decided only by owners and admins, the acceptance guard and the approval
// time the database stamps, row-level security across workspaces, and rollback.

const OWNER = '00000000-0000-4000-8000-0000000008a1';
const ADMIN = '00000000-0000-4000-8000-0000000008a2';
const SALES = '00000000-0000-4000-8000-0000000008a3';
const SALES2 = '00000000-0000-4000-8000-0000000008a4';
const VIEWER = '00000000-0000-4000-8000-0000000008a5';
const OUTSIDER = '00000000-0000-4000-8000-0000000008a6';

type Actor = string | 'service';
type Row = Record<string, unknown>;

let db: PGlite;
let org: string;

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const run = <T>(actor: Actor, fn: () => Promise<T>) => (actor === 'service' ? asServiceRole(db, fn) : as(db, actor, fn));

async function insert(actor: Actor, table: string, values: Row) {
  const cols = Object.keys(values);
  const [row] = await run(actor, () => rows<Row>(db, `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(values)));
  return row;
}
async function update(actor: Actor, table: string, id: unknown, values: Row) {
  const cols = Object.keys(values);
  const [row] = await run(actor, () => rows<Row>(db, `update public.${table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1 returning *`, [id, ...Object.values(values)]));
  return row;
}

const inbound = (extra: Row = {}): Row => ({
  organization_id: org,
  channel: 'email',
  provider: 'resend',
  provider_message_id: `in_${Math.random()}`,
  sender_hash: hash(`email:client-${Math.random()}@example.com`),
  sender_hint: 'c•••@example.com',
  body: 'How much would it cost?',
  received_at: new Date().toISOString(),
  ...extra,
});
const reading = (messageId: unknown, extra: Row = {}): Row => ({
  organization_id: org,
  inbound_message_id: messageId,
  intent: 'pricing_question',
  confidence: 75,
  source: 'rules',
  classifier_version: 'reply-rules-1.0.0',
  ...extra,
});

/** A business with a proposal moved to the given status the way the app does it (approval stamps the time). */
async function proposal(status: 'draft' | 'approved' | 'sent' = 'sent') {
  const b = await insert(OWNER, 'businesses', { organization_id: org, name: `Biz ${Math.random()}`, city: 'Accra', contact_permission: 'granted', lawful_basis: 'consent' });
  let p = await insert(SALES, 'proposals', { organization_id: org, business_id: b.id, title: 'Website', content: '{"a":1}' });
  if (status !== 'draft') p = await update(OWNER, 'proposals', p.id, { status: 'approved' });
  if (status === 'sent') p = await update(OWNER, 'proposals', p.id, { status: 'sent', sent_at: new Date().toISOString() });
  return { business: b, proposal: p };
}

beforeAll(async () => {
  db = await createDatabase();
  for (const [id, email] of [
    [OWNER, 'owner8@example.com'],
    [ADMIN, 'admin8@example.com'],
    [SALES, 'sales8@example.com'],
    [SALES2, 'sales8b@example.com'],
    [VIEWER, 'viewer8@example.com'],
    [OUTSIDER, 'outsider8@example.com'],
  ]) {
    await createUser(db, id, email);
  }
  org = (await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  await as(db, OWNER, () =>
    db.query(
      `insert into public.organization_invitations (organization_id, email, role) values ($1, 'admin8@example.com', 'admin'), ($1, 'sales8@example.com', 'sales'), ($1, 'sales8b@example.com', 'sales'), ($1, 'viewer8@example.com', 'viewer')`,
      [org],
    ),
  );
  for (const id of [ADMIN, SALES, SALES2, VIEWER, OUTSIDER]) await as(db, id, () => db.query('select * from public.ensure_workspace()'));
});

describe('reply classifications', () => {
  it('are recorded by the server (rules) and by members, with the actor and time stamped by the database', async () => {
    const m = await insert('service', 'inbound_messages', inbound());
    const rules = await insert('service', 'reply_classifications', reading(m.id, { actor_type: 'user', actor_id: OWNER, created_at: '2001-01-01T00:00:00Z' }));
    expect(rules).toMatchObject({ actor_type: 'system', actor_id: null });
    expect(new Date(rules.created_at as string).getFullYear()).toBeGreaterThan(2001);
    const ai = await insert(SALES, 'reply_classifications', reading(m.id, { intent: 'interested', confidence: 88, source: 'ai', model: 'claude-sonnet-5-5', classifier_version: 'reply-ai-1.0.0', actor_type: 'system' }));
    expect(ai).toMatchObject({ actor_type: 'user', actor_id: SALES });
    const agent = await insert(SALES, 'reply_classifications', reading(m.id, { actor_type: 'agent' }));
    expect(agent).toMatchObject({ actor_type: 'agent', actor_id: SALES });
    const person = await insert(SALES, 'reply_classifications', reading(m.id, { intent: 'meeting_request', confidence: 100, source: 'person', classifier_version: 'person', summary: 'Wants a call' }));
    expect(person).toMatchObject({ source: 'person', actor_id: SALES });
    // A correction is a signed-in person's.
    await expect(insert('service', 'reply_classifications', reading(m.id, { source: 'person' }))).rejects.toThrow(/signed-in person/);
    await expect(insert(SALES, 'reply_classifications', reading(m.id, { source: 'person', actor_type: 'agent' }))).rejects.toThrow(/signed-in person/);
  });

  it('are append-only, valid, and limited to members who work on replies', async () => {
    const m = await insert('service', 'inbound_messages', inbound());
    const r = await insert('service', 'reply_classifications', reading(m.id));
    await expect(update('service', 'reply_classifications', r.id, { intent: 'interested' })).rejects.toThrow(/permission denied/);
    await expect(update(OWNER, 'reply_classifications', r.id, { intent: 'interested' })).rejects.toThrow(/permission denied/);
    await expect(run(OWNER, () => rows(db, 'delete from public.reply_classifications where id = $1', [r.id]))).rejects.toThrow(/permission denied/);
    await expect(run('service', () => rows(db, 'delete from public.reply_classifications where id = $1', [r.id]))).rejects.toThrow(/permission denied/);
    await expect(insert(VIEWER, 'reply_classifications', reading(m.id))).rejects.toThrow(/row-level security/);
    await expect(insert(SALES, 'reply_classifications', reading(m.id, { intent: 'very_keen' }))).rejects.toThrow(/intent_check/);
    await expect(insert(SALES, 'reply_classifications', reading(m.id, { confidence: 101 }))).rejects.toThrow(/confidence_check/);
    await expect(insert(SALES, 'reply_classifications', reading('00000000-0000-4000-8000-000000000000'))).rejects.toThrow(/not found/);
  });

  it('keep an opt-out reply an opt-out, whoever reads it', async () => {
    const m = await insert('service', 'inbound_messages', inbound({ body: 'STOP', opt_out: true, opt_out_match: 'STOP' }));
    expect(await insert('service', 'reply_classifications', reading(m.id, { intent: 'opt_out', confidence: 100 }))).toMatchObject({ intent: 'opt_out' });
    await expect(insert(OWNER, 'reply_classifications', reading(m.id, { intent: 'interested', source: 'person', classifier_version: 'person' }))).rejects.toThrow(/opt-out; it cannot be classified as anything else/);
    await expect(insert(SALES, 'reply_classifications', reading(m.id, { intent: 'interested', source: 'ai', classifier_version: 'reply-ai-1.0.0' }))).rejects.toThrow(/opt-out/);
  });

  it('are invisible to other workspaces', async () => {
    const m = await insert('service', 'inbound_messages', inbound());
    await insert('service', 'reply_classifications', reading(m.id));
    expect(await as(db, OUTSIDER, () => rows(db, 'select id from public.reply_classifications'))).toEqual([]);
    expect(await as(db, OUTSIDER, () => rows(db, 'select id from public.proposal_change_requests'))).toEqual([]);
    const theirs = (await as(db, OUTSIDER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
    await expect(insert(OUTSIDER, 'reply_classifications', { ...reading(m.id), organization_id: theirs })).rejects.toThrow(/not found/);
    // Another workspace's member cannot even see the message to classify it.
    await expect(insert(OUTSIDER, 'reply_classifications', reading(m.id))).rejects.toThrow(/row-level security|not found/);
  });
});

describe('proposal change requests', () => {
  it('are recorded by people against an approved or issued proposal, starting open', async () => {
    const draft = await proposal('draft');
    await expect(insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: draft.proposal.id, kind: 'price', summary: 'Discount' })).rejects.toThrow(/approved or issued proposal/);
    const { proposal: p, business } = await proposal('sent');
    await expect(insert('service', 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'price', summary: 'Discount' })).rejects.toThrow(/permission denied/);
    await expect(insert(VIEWER, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'price', summary: 'Discount' })).rejects.toThrow(/row-level security/);
    const r = await insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'price', summary: '10% off', status: 'approved', decided_by: SALES, decided_at: new Date().toISOString(), decision_note: 'self-approved' });
    expect(r).toMatchObject({ status: 'open', business_id: business.id, requested_by: SALES, decided_by: null, decided_at: null, decision_note: null });
    await expect(insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'free_upgrade', summary: 'x' })).rejects.toThrow(/kind_check/);
    await expect(insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'scope', summary: '  ' })).rejects.toThrow(/summary_check/);
  });

  it('are decided by owners and admins with a note, once, and never edited or deleted', async () => {
    const { proposal: p } = await proposal('sent');
    const r = await insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'payment_terms', summary: 'Pay in three parts' });
    await expect(update(SALES, 'proposal_change_requests', r.id, { status: 'approved', decision_note: 'ok' })).rejects.toThrow(/Only owners and administrators decide/);
    await expect(update(ADMIN, 'proposal_change_requests', r.id, { status: 'approved', decision_note: '  ' })).rejects.toThrow(/Explain the decision/);
    await expect(update(ADMIN, 'proposal_change_requests', r.id, { summary: 'Pay in six parts' })).rejects.toThrow(/keeps what the client asked for/);
    await expect(update(ADMIN, 'proposal_change_requests', r.id, { status: 'open' })).rejects.toThrow(/Approve, decline or withdraw/);
    const decided = await update(ADMIN, 'proposal_change_requests', r.id, { status: 'approved', decision_note: 'Three parts agreed', decided_by: OWNER });
    expect(decided).toMatchObject({ status: 'approved', decided_by: ADMIN, decision_note: 'Three parts agreed' });
    await expect(update(OWNER, 'proposal_change_requests', r.id, { status: 'declined', decision_note: 'No' })).rejects.toThrow(/has been decided/);
    await expect(run(OWNER, () => rows(db, 'delete from public.proposal_change_requests where id = $1', [r.id]))).rejects.toThrow(/permission denied/);
    const audit = await rows<Row>(db, `select action from public.audit_events where table_name = 'proposal_change_requests' and record_id = $1 order by created_at`, [r.id]);
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update']);
  });

  it('are withdrawn by the person who recorded them or an owner or admin', async () => {
    const { proposal: p } = await proposal('sent');
    const r = await insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'timeline', summary: 'Ready by December' });
    await expect(update(SALES2, 'proposal_change_requests', r.id, { status: 'withdrawn' })).rejects.toThrow(/Only the person who recorded it/);
    expect(await update(SALES, 'proposal_change_requests', r.id, { status: 'withdrawn' })).toMatchObject({ status: 'withdrawn', decided_by: SALES });
  });
});

describe('the acceptance guard', () => {
  it('waits for open requests, then for an agreed change to be approved into the proposal again', async () => {
    const { proposal: p } = await proposal('sent');
    const r = await insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: p.id, kind: 'scope', summary: 'Add online booking' });
    await expect(update(SALES, 'proposals', p.id, { status: 'accepted', decided_at: new Date().toISOString() })).rejects.toThrow(/Decide the open change requests/);
    await update(OWNER, 'proposal_change_requests', r.id, { status: 'approved', decision_note: 'Booking page added at the listed add-on price' });
    await expect(update(SALES, 'proposals', p.id, { status: 'accepted' })).rejects.toThrow(/agreed change is not in the proposal yet/);
    // Moving the approval time by hand does not get round it, alone or with the acceptance.
    await expect(update(SALES, 'proposals', p.id, { approved_at: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toThrow(/approval time is set when the proposal is approved/);
    await expect(update(SALES, 'proposals', p.id, { status: 'accepted', approved_at: new Date(Date.now() + 86_400_000).toISOString() })).rejects.toThrow(/approval time|not in the proposal yet/);
    // Revise, approve again (the database stamps the time), issue, accept.
    await update(SALES, 'proposals', p.id, { status: 'draft', approved_at: null });
    await update(SALES, 'proposals', p.id, { content: '{"a":2,"booking":true}' });
    const approved = await update(OWNER, 'proposals', p.id, { status: 'approved', approved_at: '2001-01-01T00:00:00Z' });
    expect(new Date(approved.approved_at as string).getFullYear()).toBeGreaterThan(2001);
    await update(OWNER, 'proposals', p.id, { status: 'sent' });
    expect(await update(SALES, 'proposals', p.id, { status: 'accepted', decided_at: new Date().toISOString() })).toMatchObject({ status: 'accepted' });
  });

  it('does not affect proposals without change requests, and declined requests do not block', async () => {
    const plain = await proposal('sent');
    expect(await update(SALES, 'proposals', plain.proposal.id, { status: 'accepted' })).toMatchObject({ status: 'accepted' });
    const declined = await proposal('sent');
    const r = await insert(SALES, 'proposal_change_requests', { organization_id: org, proposal_id: declined.proposal.id, kind: 'price', summary: 'Half price' });
    await update(OWNER, 'proposal_change_requests', r.id, { status: 'declined', decision_note: 'Prices are as listed' });
    expect(await update(SALES, 'proposals', declined.proposal.id, { status: 'accepted' })).toMatchObject({ status: 'accepted' });
  });
});

describe('re-running and rollback', () => {
  it('can be applied again without changing data', async () => {
    const count = async () => (await rows<{ n: number }>(db, 'select (select count(*) from public.reply_classifications) + (select count(*) from public.proposal_change_requests) as n'))[0].n;
    const before = await count();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '008_response_conversion.sql'), 'utf8'));
    expect(await count()).toBe(before);
  });

  it('is rolled back before 006, removes itself cleanly and can be re-applied', async () => {
    const d = await createDatabase();
    await expect(d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '006_messaging_down.sql'), 'utf8'))).rejects.toThrow(/008_response_conversion_down/);
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '008_response_conversion_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name::text from information_schema.tables where table_schema = 'public' and table_name in ('reply_classifications', 'proposal_change_requests')
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('guard_reply_classification', 'guard_proposal_change_request', 'guard_proposal_acceptance')
       union all select tgname::text from pg_trigger where tgname = 'proposals_acceptance_guard'`,
    );
    expect(leftovers).toEqual([]);
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '008_response_conversion.sql'), 'utf8'));
    expect(await rows(d, `select 1 from information_schema.tables where table_schema = 'public' and table_name in ('reply_classifications', 'proposal_change_requests')`)).toHaveLength(2);
    await d.close();
  });
});
