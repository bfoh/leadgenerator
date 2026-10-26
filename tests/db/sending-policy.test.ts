import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, as, asServiceRole, createDatabase, createUser, freezeMessagingClock, rows } from './harness';

// Exercises migration 007 on PGlite: the workspace sending policy and pause switch, approved-message
// policies, deferred decisions and the send-policy trigger that enforces quiet hours, sending days,
// daily limits, policy caps and per-recipient spacing independently of the application.

const OWNER = '00000000-0000-4000-8000-0000000007a1';
const ADMIN = '00000000-0000-4000-8000-0000000007a2';
const SALES = '00000000-0000-4000-8000-0000000007a3';

type Actor = string | 'service';
type Row = Record<string, unknown>;

let db: PGlite;
let org: string;

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
const run = <T>(actor: Actor, fn: () => Promise<T>) => (actor === 'service' ? asServiceRole(db, fn) : as(db, actor, fn));
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

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
async function settings(actor: Actor, values: Row) {
  const cols = Object.keys(values);
  const [row] = await run(actor, () =>
    rows<Row>(db, `update public.automation_settings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where organization_id = $1 returning *`, [org, ...Object.values(values)]),
  );
  return row;
}

async function template(purpose = 'introduction', approve = true) {
  const t = await insert(OWNER, 'message_templates', { organization_id: org, channel: 'email', name: `T ${Math.random()}`, purpose, subject: 'Hello', body: 'Hello {{business_name}}' });
  return approve ? update(OWNER, 'message_templates', t.id, { status: 'approved' }) : t;
}
async function policy(t: Row, extra: Row = {}) {
  return insert(OWNER, 'message_policies', { organization_id: org, name: 'Introductions', template_id: t.id, template_version: t.version, channel: t.channel, purpose: t.purpose, daily_cap: 50, expires_at: days(90), ...extra });
}

/** A draft for a new (or given) recipient from template t, approved against a stored decision. */
async function approvedMessage(t: Row | null, opts: { email?: string; purpose?: string } = {}) {
  const email = opts.email ?? `p-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const b = await insert(OWNER, 'businesses', { organization_id: org, name: `Biz ${Math.random()}`, city: 'Accra' });
  const point = await insert(OWNER, 'contact_points', {
    organization_id: org,
    business_id: b.id,
    type: 'email',
    value: email,
    normalized_value: email,
    value_hash: hash(`email:${email}`),
    domain_hash: hash(`domain:${email.split('@')[1]}`),
    hint: `${email[0]}•••@${email.split('@')[1]}`,
    scope: 'business',
    source_type: 'directly_provided',
    source_note: 'Given by the owner',
  });
  const m = await insert(SALES, 'outreach_messages', {
    organization_id: org,
    business_id: b.id,
    contact_point_id: point.id,
    channel: 'email',
    purpose: opts.purpose ?? (t?.purpose as string) ?? 'introduction',
    subject: 'Hello',
    body: `Hello ${Math.random()}`,
    recipient_hash: hash(`email:${email}`),
    recipient_hint: 'p•••@example.com',
    template_id: t?.id ?? null,
    template_version: t?.version ?? null,
  });
  const d = await insert(OWNER, 'eligibility_decisions', decision(m, 'approval'));
  return { message: m, decision: d, approve: () => update(OWNER, 'outreach_messages', m.id, { status: 'approved', decision_id: d.id }), email };
}

function decision(m: Row, stage: string, extra: Row = {}): Row {
  return {
    organization_id: org,
    message_id: m.id,
    business_id: m.business_id,
    contact_point_id: m.contact_point_id,
    channel: m.channel,
    purpose: m.purpose,
    stage,
    outcome: 'eligible',
    reasons: '[]',
    checks: '[]',
    inputs: '{}',
    body_hash: m.body_hash,
    recipient_hash: m.recipient_hash,
    gateway_version: 'gateway-1.1.0',
    actor_type: 'user',
    ...extra,
  };
}

/** Approves and queues the message, then moves it to sending as the server (the guarded step). */
async function send(m: Row, approve: () => Promise<Row>) {
  await approve();
  await update(OWNER, 'outreach_messages', m.id, { status: 'queued' });
  const d = await insert('service', 'eligibility_decisions', decision(m, 'dispatch', { actor_id: OWNER, sandbox: true }));
  return update('service', 'outreach_messages', m.id, { status: 'sending', dispatch_decision_id: d.id });
}

/** Moves a sent message's dispatch time onto the frozen clock's day (the guard stamps real time). */
const sentAt = (id: unknown, at: string) => update('service', 'outreach_messages', id, { sending_at: at });

beforeAll(async () => {
  db = await createDatabase();
  await createUser(db, OWNER, 'owner7@example.com');
  await createUser(db, ADMIN, 'admin7@example.com');
  await createUser(db, SALES, 'sales7@example.com');
  org = (await as(db, OWNER, () => rows<{ org_id: string }>(db, 'select * from public.ensure_workspace()')))[0].org_id;
  await as(db, OWNER, () => db.query(`insert into public.organization_invitations (organization_id, email, role) values ($1, 'admin7@example.com', 'admin'), ($1, 'sales7@example.com', 'sales')`, [org]));
  await as(db, ADMIN, () => db.query('select * from public.ensure_workspace()'));
  await as(db, SALES, () => db.query('select * from public.ensure_workspace()'));
});

beforeEach(async () => {
  await freezeMessagingClock(db);
});

describe('workspace sending policy', () => {
  it('starts every workspace on the default policy, unpaused', async () => {
    const [s] = await rows<Row>(db, 'select sending_policy, sending_paused from public.automation_settings where organization_id = $1', [org]);
    expect(s.sending_paused).toBe(false);
    expect(s.sending_policy).toMatchObject({ timezone: 'Africa/Accra', quietStart: '19:00', quietEnd: '08:00', sendDays: [1, 2, 3, 4, 5, 6], dailyLimit: { email: 20, whatsapp: 20 } });
  });

  it('accepts only valid policies whose quiet hours cover 22:00–06:00', async () => {
    const base = { timezone: 'Africa/Accra', quietStart: '20:00', quietEnd: '07:30', sendDays: [1, 2, 3, 4, 5], dailyLimit: { email: 10, whatsapp: 5 }, recipientMinGapDays: 10, recipientMax30Days: 2, maxUnansweredFollowUps: 1, approvalMaxAgeDays: 10 };
    expect((await settings(ADMIN, { sending_policy: JSON.stringify(base) })).sending_policy).toMatchObject({ quietStart: '20:00', dailyLimit: { email: 10 } });
    for (const bad of [
      { quietStart: '23:00' },
      { quietEnd: '05:00' },
      { quietStart: '7pm' },
      { sendDays: [] },
      { sendDays: [0] },
      { dailyLimit: { email: 500 } },
      { dailyLimit: { sms: 5 } },
      { timezone: 'Mars/Base' },
      { recipientMinGapDays: 0 },
      { approvalMaxAgeDays: 7 },
      { surprise: true },
    ]) {
      await expect(settings(ADMIN, { sending_policy: JSON.stringify({ ...base, ...bad }) })).rejects.toThrow(/sending_policy_check/);
    }
    // Sales cannot change automation settings; the server cannot change the policy.
    expect(await settings(SALES, { sending_policy: JSON.stringify({ ...base, dailyLimit: { email: 1, whatsapp: 1 } }) })).toBeUndefined();
    await expect(settings('service', { sending_policy: JSON.stringify({ ...base, dailyLimit: { email: 1, whatsapp: 1 } }) })).rejects.toThrow(/Only owners and administrators change the sending policy/);
    // Missing keys fall back to the defaults.
    await settings(OWNER, { sending_policy: JSON.stringify({}) });
    const audit = await rows<Row>(db, `select changes from public.audit_events where organization_id = $1 and table_name = 'automation_settings' and changes ? 'sending_policy'`, [org]);
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it('can be paused at once; resuming needs a new reason', async () => {
    const paused = await settings(ADMIN, { sending_paused: true, sending_pause_reason: null });
    expect(paused).toMatchObject({ sending_paused: true, sending_pause_reason: 'Sending paused.', sending_paused_by: ADMIN });
    expect(paused.sending_paused_at).toBeTruthy();
    await expect(settings(OWNER, { sending_paused: false })).rejects.toThrow(/why sending is being resumed/);
    await expect(settings(OWNER, { sending_paused: false, sending_pause_reason: 'Sending paused.' })).rejects.toThrow(/why sending is being resumed/);
    // The reason and stamps change only with the switch.
    expect((await settings(OWNER, { sending_pause_reason: 'Edited', sending_paused_by: SALES })).sending_pause_reason).toBe('Sending paused.');
    expect(await settings(SALES, { sending_paused: false, sending_pause_reason: 'Sales says go' })).toBeUndefined();
    await expect(settings('service', { sending_paused: false, sending_pause_reason: 'Worker says go' })).rejects.toThrow(/pause or resume/);
    expect(await settings(OWNER, { sending_paused: false, sending_pause_reason: 'Checked the bounce; resuming.' })).toMatchObject({ sending_paused: false, sending_paused_by: OWNER });
  });
});

describe('approved-message policies', () => {
  it('cover one approved template version and are stamped by the database', async () => {
    const t = await template();
    await expect(insert(SALES, 'message_policies', { organization_id: org, name: 'x', template_id: t.id, template_version: 1, channel: 'email', purpose: 'introduction', expires_at: days(30) })).rejects.toThrow(
      /row-level security/,
    );
    await expect(insert('service', 'message_policies', { organization_id: org, name: 'x', template_id: t.id, template_version: 1, channel: 'email', purpose: 'introduction', expires_at: days(30) })).rejects.toThrow(
      /permission denied|set by people/,
    );
    const p = await policy(t, { template_version: 9, channel: 'whatsapp', purpose: 'follow_up', status: 'revoked', approved_by: SALES });
    expect(p).toMatchObject({ template_version: t.version, channel: 'email', purpose: 'introduction', status: 'active', approved_by: OWNER, created_by: OWNER, revoked_at: null });
    await expect(policy(t)).rejects.toThrow(/message_policies_cover_idx/);
    await expect(policy(await template('introduction', false))).rejects.toThrow(/Only an approved template/);
    await expect(policy(await template('reply'))).rejects.toThrow(/need no message policy/);
    await expect(policy(await template(), { expires_at: days(200) })).rejects.toThrow(/message_policies_expiry_check/);
  });

  it('keep their terms; pause, resume and a final revoke; never deleted', async () => {
    const t = await template();
    const p = await policy(t);
    await expect(update(OWNER, 'message_policies', p.id, { expires_at: days(170) })).rejects.toThrow(/keeps its template, version, approver and expiry/);
    await expect(update(OWNER, 'message_policies', p.id, { template_version: 2 })).rejects.toThrow(/keeps its template/);
    expect(await update(SALES, 'message_policies', p.id, { status: 'paused' })).toBeUndefined();
    expect(await update(ADMIN, 'message_policies', p.id, { status: 'paused', daily_cap: 5 })).toMatchObject({ status: 'paused', daily_cap: 5 });
    expect(await update(ADMIN, 'message_policies', p.id, { status: 'active' })).toMatchObject({ status: 'active' });
    // Editing the template ends the cover: the paused policy cannot be resumed.
    await update(OWNER, 'message_policies', p.id, { status: 'paused' });
    await update(OWNER, 'message_templates', t.id, { body: 'Hello again {{business_name}}' });
    await expect(update(OWNER, 'message_policies', p.id, { status: 'active' })).rejects.toThrow(/template changed or is no longer approved/);
    const revoked = await update(OWNER, 'message_policies', p.id, { status: 'revoked' });
    expect(revoked).toMatchObject({ status: 'revoked', revoked_by: OWNER });
    await expect(update(OWNER, 'message_policies', p.id, { status: 'active' })).rejects.toThrow(/revoked policy is final/);
    await expect(run(OWNER, () => db.query('delete from public.message_policies where id = $1', [p.id]))).rejects.toThrow(/permission denied/);
    await expect(run(OWNER, () => db.query('delete from public.message_templates where id = $1', [t.id]))).rejects.toThrow(/message_policies_template_id_fkey/);
    const audit = await rows<Row>(db, `select action from public.audit_events where table_name = 'message_policies' and record_id = $1 order by created_at`, [p.id]);
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update', 'update', 'update', 'update']);
  });
});

describe('deferred decisions', () => {
  it('exist only at dispatch, and always carry their reasons', async () => {
    const t = await template();
    await policy(t);
    const { message } = await approvedMessage(t);
    await expect(insert(OWNER, 'eligibility_decisions', decision(message, 'approval', { outcome: 'deferred', reasons: '["Quiet hours"]' }))).rejects.toThrow(/outcome_check/);
    await expect(insert('service', 'eligibility_decisions', decision(message, 'dispatch', { outcome: 'deferred', actor_id: OWNER }))).rejects.toThrow(/outcome_reasons_check/);
    expect(await insert('service', 'eligibility_decisions', decision(message, 'dispatch', { outcome: 'deferred', reasons: '["Quiet hours"]', actor_id: OWNER }))).toMatchObject({ outcome: 'deferred' });
  });
});

describe('the send-policy trigger', () => {
  it('needs an active policy for the exact template version to approve and to send', async () => {
    const t = await template();
    const uncovered = await approvedMessage(t);
    await expect(uncovered.approve()).rejects.toThrow(/No active message policy covers this template version/);
    const free = await approvedMessage(null, { purpose: 'introduction' });
    await expect(free.approve()).rejects.toThrow(/need a template covered by a message policy/);

    const p = await policy(t);
    const covered = await approvedMessage(t);
    await covered.approve();
    await update(OWNER, 'outreach_messages', covered.message.id, { status: 'queued' });
    // Paused between approval and dispatch: the send is refused.
    await update(OWNER, 'message_policies', p.id, { status: 'paused' });
    const d = await insert('service', 'eligibility_decisions', decision(covered.message, 'dispatch', { actor_id: OWNER, sandbox: true }));
    await expect(update('service', 'outreach_messages', covered.message.id, { status: 'sending', dispatch_decision_id: d.id })).rejects.toThrow(/No active message policy/);
    await update(OWNER, 'message_policies', p.id, { status: 'active' });
    expect(await update('service', 'outreach_messages', covered.message.id, { status: 'sending', dispatch_decision_id: d.id })).toMatchObject({ status: 'sending' });
  });

  it('refuses a schedule more than 7 days ahead', async () => {
    const t = await template();
    await policy(t);
    const m = await approvedMessage(t);
    await m.approve();
    // Schedules are relative to the frozen clock the trigger reads, not the wall clock: `days()` would
    // drift out of the 7-day window a week after FIXED_MESSAGING_NOW and fail this test for the wrong reason.
    await expect(update(OWNER, 'outreach_messages', m.message.id, { status: 'queued', scheduled_for: '2026-10-29 10:00:00+00' })).rejects.toThrow(/up to 7 days ahead/);
    expect(await update(OWNER, 'outreach_messages', m.message.id, { status: 'queued', scheduled_for: '2026-10-23 10:00:00+00' })).toMatchObject({ status: 'queued' });
  });

  it('holds every send while the workspace is paused, and outside the sending window', async () => {
    const t = await template();
    await policy(t);
    await settings(OWNER, { sending_paused: true, sending_pause_reason: 'Checking a complaint' });
    const a = await approvedMessage(t);
    await expect(send(a.message, a.approve)).rejects.toThrow(/Sending is paused/);
    await settings(OWNER, { sending_paused: false, sending_pause_reason: 'Complaint resolved' });

    for (const at of ['2026-10-21 19:30:00+00', '2026-10-21 07:59:00+00', '2026-10-25 10:00:00+00']) {
      // 19:30 and 07:59 are quiet hours in Accra; 25 October 2026 is a Sunday.
      await freezeMessagingClock(db, at);
      const m = await approvedMessage(t);
      await expect(send(m.message, m.approve)).rejects.toThrow(/Outside the sending window/);
    }
    await freezeMessagingClock(db, '2026-10-21 18:59:00+00');
    const late = await approvedMessage(t);
    expect(await send(late.message, late.approve)).toMatchObject({ status: 'sending' });
  });

  it('enforces the daily limit per channel and the policy’s own daily cap', async () => {
    await freezeMessagingClock(db, '2026-10-22 11:00:00+00');
    const policyJson = (email: number) => JSON.stringify({ timezone: 'Africa/Accra', quietStart: '19:00', quietEnd: '08:00', sendDays: [1, 2, 3, 4, 5, 6], dailyLimit: { email, whatsapp: 20 } });
    const t = await template();
    const p = await policy(t, { daily_cap: 1 });
    const first = await approvedMessage(t);
    await sentAt((await send(first.message, first.approve)).id, '2026-10-22 09:00:00+00');
    const second = await approvedMessage(t);
    await expect(send(second.message, second.approve)).rejects.toThrow(/daily cap of message policy "Introductions"/);
    await update(OWNER, 'message_policies', p.id, { daily_cap: 10 });

    await settings(OWNER, { sending_policy: policyJson(2) });
    const third = await approvedMessage(t);
    await expect(send(third.message, third.approve)).resolves.toMatchObject({ status: 'sending' });
    await sentAt(third.message.id, '2026-10-22 10:00:00+00');
    const fourth = await approvedMessage(t);
    await expect(send(fourth.message, fourth.approve)).rejects.toThrow(/daily email limit/);
    // Yesterday's sends do not count.
    await sentAt(first.message.id, '2026-10-21 09:00:00+00');
    await sentAt(third.message.id, '2026-10-21 10:00:00+00');
    const fifth = await approvedMessage(t);
    expect(await send(fifth.message, fifth.approve)).toMatchObject({ status: 'sending' });
    await settings(OWNER, { sending_policy: policyJson(20) });
  });

  it('spaces business-initiated messages to one recipient; replies are not capped', async () => {
    await freezeMessagingClock(db, '2026-10-23 10:00:00+00');
    const intro = await template();
    await policy(intro);
    const followUp = await template('follow_up');
    await policy(followUp);
    const first = await approvedMessage(intro);
    await sentAt((await send(first.message, first.approve)).id, '2026-10-20 10:00:00+00');
    const tooSoon = await approvedMessage(followUp, { email: first.email });
    await expect(send(tooSoon.message, tooSoon.approve)).rejects.toThrow(/messaged too recently/);
    const reply = await approvedMessage(null, { email: first.email, purpose: 'reply' });
    expect(await send(reply.message, reply.approve)).toMatchObject({ status: 'sending' });

    // A week later the follow-up may go; a third business-initiated message in 30 days may not.
    await freezeMessagingClock(db, '2026-10-28 10:00:00+00');
    const later = await approvedMessage(followUp, { email: first.email });
    await sentAt((await send(later.message, later.approve)).id, '2026-10-28 09:00:00+00');
    await settings(OWNER, { sending_policy: JSON.stringify({ recipientMinGapDays: 1, recipientMax30Days: 2 }) });
    await freezeMessagingClock(db, '2026-10-30 10:00:00+00');
    const third = await approvedMessage(followUp, { email: first.email });
    await expect(send(third.message, third.approve)).rejects.toThrow(/most messages the sending policy allows in 30 days/);
    await settings(OWNER, { sending_policy: JSON.stringify({}) });
  });
});

describe('re-running and rollback', () => {
  it('can be applied again without changing data', async () => {
    const count = async () => (await rows<{ n: number }>(db, 'select (select count(*) from public.message_policies) + (select count(*) from public.eligibility_decisions) as n'))[0].n;
    const before = await count();
    await db.exec(readFileSync(join(MIGRATIONS_DIR, '007_sending_policy.sql'), 'utf8'));
    expect(await count()).toBe(before);
  });

  it('removes migration 007 cleanly and can be re-applied', async () => {
    const d = await createDatabase();
    await createUser(d, OWNER, 'owner7@example.com');
    await d.exec(readFileSync(join(process.cwd(), 'supabase', 'rollback', '007_sending_policy_down.sql'), 'utf8'));
    const leftovers = await rows(
      d,
      `select table_name::text from information_schema.tables where table_schema = 'public' and table_name = 'message_policies'
       union all select column_name::text from information_schema.columns where table_schema = 'public' and table_name = 'automation_settings' and column_name like 'sending%'
       union all select proname::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('enforce_send_policy', 'guard_sending_controls', 'guard_message_policy', 'valid_sending_policy', 'hhmm_minutes', 'messaging_now')`,
    );
    expect(leftovers).toEqual([]);
    await d.exec(readFileSync(join(MIGRATIONS_DIR, '007_sending_policy.sql'), 'utf8'));
    expect(await rows(d, `select 1 from information_schema.tables where table_schema = 'public' and table_name = 'message_policies'`)).toHaveLength(1);
    await d.close();
  });
});
