// Phase 7 server messaging: webhook signatures and unsubscribe tokens, the Resend and WhatsApp
// adapters against mocked fetch (accepted, rejected and uncertain outcomes), event parsing, webhook
// deduplication and processing, template synchronisation and the dispatch route's logic, all
// against an in-memory Supabase stand-in. No request leaves the process; the credentials below are
// placeholders, not keys.

import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV = vi.hoisted(() => {
  const values = {
    // Read when the Supabase config module loads, so they are set before any import.
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-role',
    RESEND_API_KEY: 're_placeholder_not_a_key',
    MESSAGING_EMAIL_FROM: 'Sandbox Agency <hello@outreach.example.com>',
    MESSAGING_EMAIL_REPLY_TO: 'hello@agency-sandbox.com',
    RESEND_WEBHOOK_SECRET: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
    WHATSAPP_ACCESS_TOKEN: 'placeholder-token',
    WHATSAPP_PHONE_NUMBER_ID: '1234567890',
    WHATSAPP_BUSINESS_ACCOUNT_ID: '9876543210',
    WHATSAPP_APP_SECRET: 'placeholder-app-secret',
    WHATSAPP_VERIFY_TOKEN: 'placeholder-verify-token',
    MESSAGING_TEST_RECIPIENTS: 'owner@agency-sandbox.com, +233 24 412 3456',
    MESSAGING_ORGANIZATION_ID: '11111111-1111-4111-8111-111111111111',
    MESSAGING_UNSUBSCRIBE_SECRET: 'placeholder-unsubscribe-secret-0123456789abcdef',
    APP_URL: 'https://app.example.com/',
  };
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  return { values, previous };
});

import { LocalStore } from '@/lib/data/local-store';
import * as messaging from '@/lib/data/messaging-services';
import type { ServiceContext } from '@/lib/data/services';
import { toRow } from '@/lib/data/supabase-store';
import { sha256Hex } from '@/lib/domain/contacts';
import { DEFAULT_SENDING_POLICY } from '@/lib/domain/sending-policy';
import { messagingStatus, senderConfigIssues } from '@/lib/server/messaging/config';
import { dispatchDue, dispatchMessage } from '@/lib/server/messaging/dispatch';
import type { FetchLike } from '@/lib/server/messaging/provider';
import { parseResendEvent, sendEmail } from '@/lib/server/messaging/resend';
import { signUnsubscribeToken, tokensMatch, verifyMetaSignature, verifySvixSignature, verifyUnsubscribeToken } from '@/lib/server/messaging/signatures';
import { syncWhatsAppTemplates } from '@/lib/server/messaging/template-sync';
import { processResendEvent, processWhatsAppPayload } from '@/lib/server/messaging/webhooks';
import { parseWhatsAppWebhook, sendWhatsApp } from '@/lib/server/messaging/whatsapp';
import { FakeSupabase } from './fake-supabase';
import { PROSPECT_EMAIL, TEST_EMAIL, demoContext, demoEnv, prospect, queued } from './messaging-fixtures';

const ORG = ENV.values.MESSAGING_ORGANIZATION_ID;
const USER = '22222222-2222-4222-8222-222222222222';

afterAll(() => {
  for (const [k, v] of Object.entries(ENV.previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// A weekday morning in Accra, inside the default sending window, so timing rules do not defer.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true, now: new Date('2026-10-22T10:00:00Z') });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A mocked fetch that records each request and answers from the handler. */
function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : {} });
    return handler(url, init);
  };
  return { fn, calls };
}

// ── Signatures ───────────────────────────────────────────────────────────────

describe('webhook signatures and unsubscribe tokens', () => {
  it('verifies Svix signatures (Resend) with the published test vector', () => {
    const input = { secret: 'whsec_plJ3nmyCDGBKInavdOK15jsl', id: 'msg_loFOjxBNrRLzqYUf', timestamp: '1731705121', body: '{"event_type":"ping","data":{"success":true}}', nowSeconds: 1731705121 };
    const signature = 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=';
    expect(verifySvixSignature({ ...input, signature })).toBe(true);
    expect(verifySvixSignature({ ...input, signature: `v1,bogus ${signature}` })).toBe(true);
    expect(verifySvixSignature({ ...input, signature, body: input.body.replace('true', 'false') })).toBe(false);
    expect(verifySvixSignature({ ...input, signature, secret: 'whsec_c2VjcmV0' })).toBe(false);
    expect(verifySvixSignature({ ...input, signature, nowSeconds: 1731705121 + 600 })).toBe(false);
    expect(verifySvixSignature({ ...input, signature: signature.replace('v1', 'v2') })).toBe(false);
    expect(verifySvixSignature({ ...input, signature: null })).toBe(false);
  });

  it('verifies Meta signatures and verify tokens in constant time', () => {
    const body = '{"object":"whatsapp_business_account"}';
    const signature = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`;
    expect(verifyMetaSignature({ appSecret: 'app-secret', signature, body })).toBe(true);
    expect(verifyMetaSignature({ appSecret: 'app-secret', signature: signature.toUpperCase().replace('SHA256=', 'sha256='), body })).toBe(true);
    expect(verifyMetaSignature({ appSecret: 'other', signature, body })).toBe(false);
    expect(verifyMetaSignature({ appSecret: 'app-secret', signature, body: `${body} ` })).toBe(false);
    expect(verifyMetaSignature({ appSecret: 'app-secret', signature: null, body })).toBe(false);
    expect(verifyMetaSignature({ appSecret: '', signature, body })).toBe(false);
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abd', 'abc')).toBe(false);
    expect(tokensMatch(null, 'abc')).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
  });

  it('signs unsubscribe links per message and rejects tampering', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const token = signUnsubscribeToken('secret-one', id);
    expect(verifyUnsubscribeToken('secret-one', token)).toBe(id);
    expect(verifyUnsubscribeToken('secret-two', token)).toBeNull();
    expect(verifyUnsubscribeToken('secret-one', token.replace(id, '44444444-4444-4444-8444-444444444444'))).toBeNull();
    expect(verifyUnsubscribeToken('secret-one', `${token}x`)).toBeNull();
    expect(verifyUnsubscribeToken('secret-one', null)).toBeNull();
    expect(token).not.toMatch(/@/);
  });
});

// ── Adapters ─────────────────────────────────────────────────────────────────

describe('the Resend adapter', () => {
  const send = { from: 'A <a@outreach.example.com>', to: TEST_EMAIL, subject: 'Hi', text: 'Hello', replyTo: null, headers: { 'List-Unsubscribe': '<https://x>' }, messageId: '55555555-5555-4555-8555-555555555555' };

  it('sends with an idempotency key and our message ID as a tag', async () => {
    const f = mockFetch(() => json(200, { id: 're_abc' }));
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: f.fn })).toEqual({ ok: true, providerMessageId: 're_abc' });
    expect(f.calls[0].url).toBe('https://api.resend.com/emails');
    expect(f.calls[0].init.headers).toMatchObject({ Authorization: 'Bearer k', 'Idempotency-Key': `outreach-${send.messageId}` });
    expect(f.calls[0].init.redirect).toBe('error');
    expect(f.calls[0].body).toMatchObject({ to: [TEST_EMAIL], tags: [{ name: 'message_id', value: send.messageId }] });
  });

  it('tells rejected requests from uncertain ones', async () => {
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: mockFetch(() => json(422, { name: 'validation_error', message: 'Invalid from' })).fn })).toMatchObject({ ok: false, kind: 'rejected', status: 422, detail: 'validation_error — Invalid from' });
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: mockFetch(() => json(409, {})).fn })).toMatchObject({ ok: false, kind: 'uncertain' });
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: mockFetch(() => json(503, {})).fn })).toMatchObject({ ok: false, kind: 'uncertain' });
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: mockFetch(() => json(200, {})).fn })).toMatchObject({ ok: false, kind: 'uncertain' });
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: mockFetch(() => Promise.reject(new TypeError('fetch failed'))).fn })).toMatchObject({ ok: false, kind: 'uncertain', detail: 'The connection failed (TypeError).' });
    const hang: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    expect(await sendEmail(send, { apiKey: 'k', fetchImpl: hang, timeoutMs: 20 })).toMatchObject({ ok: false, kind: 'uncertain', detail: 'The provider did not answer in time.' });
  });

  it('parses delivery, bounce and inbound events', () => {
    const id = send.messageId;
    expect(parseResendEvent({ type: 'email.delivered', data: { email_id: 're_1', tags: { message_id: id } } })).toMatchObject({ kind: 'delivery', event: 'delivered', messageId: id, providerMessageId: 're_1' });
    expect(parseResendEvent({ type: 'email.delivered', data: { email_id: 're_1', tags: [{ name: 'message_id', value: id }] } })).toMatchObject({ messageId: id });
    expect(parseResendEvent({ type: 'email.delivered', data: { email_id: 're_1', tags: { message_id: 'not-a-uuid' } } })).toMatchObject({ messageId: null });
    expect(parseResendEvent({ type: 'email.bounced', data: { email_id: 're_1', bounce: { type: 'Permanent', subType: 'General', message: 'No such user' } } })).toMatchObject({ event: 'bounced', detail: 'Permanent — General — No such user' });
    expect(parseResendEvent({ type: 'email.bounced', data: { email_id: 're_1', bounce: { type: 'Transient' } } })).toMatchObject({ event: 'delayed' });
    expect(parseResendEvent({ type: 'email.opened', data: { email_id: 're_1' } })).toMatchObject({ kind: 'delivery', event: null });
    expect(parseResendEvent({ type: 'email.received', data: { email_id: 'in_1', from: 'Kofi <kofi@kofibakes.com>', subject: 'Re: hi', created_at: '2026-10-22T10:00:00Z' } })).toMatchObject({ kind: 'inbound', from: 'Kofi <kofi@kofibakes.com>', subject: 'Re: hi' });
    expect(parseResendEvent({ type: 'domain.updated' })).toEqual({ kind: 'other', type: 'domain.updated' });
    expect(parseResendEvent(null)).toEqual({ kind: 'other', type: 'unknown' });
  });
});

describe('the WhatsApp Cloud API adapter', () => {
  const cfg = (fetchImpl: FetchLike) => ({ token: 't', phoneNumberId: '1234567890', graphVersion: 'v24.0', fetchImpl });

  it('sends approved templates with named parameters, and free text only as replies', async () => {
    const f = mockFetch(() => json(200, { messages: [{ id: 'wamid.1' }] }));
    const id = '66666666-6666-4666-8666-666666666666';
    expect(await sendWhatsApp({ to: '+233244123456', messageId: id, template: { name: 'intro_v1', language: 'en', parameters: [{ name: 'business_name', text: 'Kofi Bakes' }] } }, cfg(f.fn))).toEqual({ ok: true, providerMessageId: 'wamid.1' });
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v24.0/1234567890/messages');
    expect(f.calls[0].body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '233244123456',
      biz_opaque_callback_data: id,
      type: 'template',
      template: { name: 'intro_v1', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', parameter_name: 'business_name', text: 'Kofi Bakes' }] }] },
    });
    await sendWhatsApp({ to: '+233244123456', messageId: id, text: 'Thanks!' }, cfg(f.fn));
    expect(f.calls[1].body).toMatchObject({ type: 'text', text: { preview_url: false, body: 'Thanks!' } });
    expect(await sendWhatsApp({ to: '+233244123456', messageId: id, text: 'x' }, cfg(mockFetch(() => json(400, { error: { code: 131047, message: 'Re-engagement message' } })).fn))).toMatchObject({ ok: false, kind: 'rejected', detail: '131047 — Re-engagement message' });
    expect(await sendWhatsApp({ to: '+233244123456', messageId: id, text: 'x' }, cfg(mockFetch(() => json(500, {})).fn))).toMatchObject({ ok: false, kind: 'uncertain' });
  });

  it('parses statuses and messages for our number only', () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const parsed = parseWhatsAppWebhook(
      {
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: '1234567890' },
                  statuses: [
                    { id: 'wamid.1', status: 'delivered', biz_opaque_callback_data: id },
                    { id: 'wamid.2', status: 'failed', errors: [{ code: 131050, title: 'User stopped marketing messages' }] },
                  ],
                  messages: [
                    { id: 'wamid.in1', from: '233244123456', timestamp: '1761127200', type: 'text', text: { body: 'STOP' } },
                    { id: 'wamid.in2', from: '233244123456', type: 'button', button: { text: 'Interested' } },
                    { id: 'wamid.in3', from: '233244123456', type: 'image' },
                    { id: 'wamid.bad', from: 'not-a-number', type: 'text', text: { body: 'x' } },
                  ],
                },
              },
              { field: 'messages', value: { metadata: { phone_number_id: '999' }, messages: [{ id: 'other', from: '233200000000', text: { body: 'hi' } }] } },
            ],
          },
        ],
      },
      '1234567890',
    );
    expect(parsed.ignored).toBe(1);
    expect(parsed.statuses).toEqual([
      { eventId: 'status:wamid.1:delivered', providerMessageId: 'wamid.1', messageId: id, event: 'delivered', errorCode: null, detail: null },
      { eventId: 'status:wamid.2:failed', providerMessageId: 'wamid.2', messageId: null, event: 'failed', errorCode: 131050, detail: '131050 — User stopped marketing messages' },
    ]);
    expect(parsed.messages.map((m) => [m.from, m.text])).toEqual([
      ['+233244123456', 'STOP'],
      ['+233244123456', 'Interested'],
      ['+233244123456', '[image message]'],
    ]);
    expect(parsed.messages[0].receivedAt).toBe('2025-10-22T10:00:00.000Z');
  });
});

// ── Configuration ────────────────────────────────────────────────────────────

describe('sender configuration', () => {
  it('reports what is missing, never the values', async () => {
    expect(senderConfigIssues('email')).toEqual([]);
    expect(senderConfigIssues('whatsapp')).toEqual([]);
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('MESSAGING_EMAIL_FROM', 'not an address');
    vi.stubEnv('MESSAGING_UNSUBSCRIBE_SECRET', 'short');
    vi.stubEnv('APP_URL', 'http://insecure.example.com');
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    expect(senderConfigIssues('email')).toEqual([
      'RESEND_API_KEY is not set.',
      'MESSAGING_EMAIL_FROM is not set (for example "Agency <hello@outreach.yourdomain.com>" on a domain verified in Resend).',
      'MESSAGING_UNSUBSCRIBE_SECRET is not set (at least 32 random characters).',
      'APP_URL must be the https address of this app, for unsubscribe links.',
    ]);
    expect(senderConfigIssues('whatsapp')).toEqual(['WHATSAPP_APP_SECRET is not set, so webhook signatures cannot be verified.']);
    const status = await messagingStatus();
    expect(status.testRecipients.hints).toEqual(['o•••@agency-sandbox.com', '+233 ••• 456']);
    expect(JSON.stringify(status)).not.toMatch(/placeholder|owner@agency-sandbox\.com|244123456/);
  });
});

// ── Webhooks and dispatch against the in-memory Supabase stand-in ───────────

/** A cloud copy of a demo workspace: the same records, in snake_case rows under a real-looking org ID. */
async function cloudCopy(ctx: ServiceContext) {
  const s = ctx.store as LocalStore;
  const fake = new FakeSupabase();
  fake.unique = { channel_events: [['provider', 'event_id']], inbound_messages: [['organization_id', 'provider', 'provider_message_id']] };
  fake.defaults = { channel_events: { outcome: 'received' } };
  fake.rpcs = { outbound_available: false };
  const copy = (table: string, items: object[]) => (fake.tables[table] = items.map((i) => ({ ...toRow(i), organization_id: ORG })));
  copy('businesses', await s.listBusinesses());
  copy('contact_points', await s.listContactPoints());
  copy('consent_records', await s.listConsentRecords());
  copy('suppressions', await s.listSuppressions());
  copy('message_templates', await s.listTemplates());
  copy('message_policies', await s.listMessagePolicies());
  copy('outreach_messages', await s.listOutreachMessages());
  copy('eligibility_decisions', await s.listDecisions());
  copy('inbound_messages', await s.listInboundMessages());
  fake.tables.organizations = [{ id: ORG, settings: ctx.settings }];
  fake.tables.automation_settings = [{ organization_id: ORG, mode: 'research_only', outbound_stopped: true, sending_policy: DEFAULT_SENDING_POLICY, sending_paused: false }];
  return fake;
}

const deps = (fake: FakeSupabase, fetchImpl: FetchLike) => ({ userSupabase: fake.client, serviceSupabase: fake.client, orgId: ORG, userId: USER, userLabel: 'Ama Mensah', fetchImpl });
const row = (fake: FakeSupabase, table: string, id: unknown) => fake.rows(table).find((r) => r.id === id)!;

describe('dispatch (server)', () => {
  let ctx: ServiceContext;
  beforeEach(() => {
    ctx = demoContext();
  });

  it('sends a queued sandbox message once, with the footer and one-click unsubscribe', async () => {
    const message = await queued(ctx, await prospect(ctx));
    const fake = await cloudCopy(ctx);
    const f = mockFetch(() => json(200, { id: 're_sent_1' }));
    const [a, b] = await Promise.all([dispatchMessage(deps(fake, f.fn), message.id), dispatchMessage(deps(fake, f.fn), message.id)]);
    expect(f.calls).toHaveLength(1);
    expect([a, b].filter((r) => r.duplicate)).toHaveLength(1);
    expect([a, b].find((r) => !r.duplicate)).toMatchObject({ status: 'sent', sandbox: true, providerMessageId: 're_sent_1' });
    expect(row(fake, 'outreach_messages', message.id)).toMatchObject({ status: 'sent', provider: 'resend', provider_message_id: 're_sent_1' });

    const { body, init } = f.calls[0];
    expect(body.to).toEqual([TEST_EMAIL]);
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${ENV.values.RESEND_API_KEY}`, 'Idempotency-Key': `outreach-${message.id}` });
    expect(body.text).toContain('Sandbox Agency');
    expect(body.text).toContain('12 Example Street, Accra');
    expect(body.text).toMatch(/unsubscribe here: https:\/\/app\.example\.com\/api\/messaging\/unsubscribe\?t=/);
    const headers = body.headers as Record<string, string>;
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const token = headers['List-Unsubscribe'].match(/t=([^>]+)>/)![1];
    expect(verifyUnsubscribeToken(ENV.values.MESSAGING_UNSUBSCRIBE_SECRET, token)).toBe(message.id);
    expect(headers['List-Unsubscribe']).toContain('mailto:hello@agency-sandbox.com?subject=unsubscribe');

    const decisions = fake.rows('eligibility_decisions').filter((d) => d.message_id === message.id && d.stage === 'dispatch');
    expect(decisions.every((d) => d.outcome === 'eligible' && d.actor_id === USER && d.sandbox === true)).toBe(true);
    // A later retry of the job finds the message sent and sends nothing.
    await expect(dispatchMessage(deps(fake, f.fn), message.id)).rejects.toThrow(/Only queued messages are dispatched/);
    expect(f.calls).toHaveLength(1);
  });

  it('makes a message wait outside the sending window, then dispatches it once it is due', async () => {
    const message = await queued(ctx, await prospect(ctx));
    const fake = await cloudCopy(ctx);
    const f = mockFetch(() => json(200, { id: 're_due_1' }));
    vi.setSystemTime(new Date('2026-10-22T20:00:00Z'));
    const night = await dispatchMessage(deps(fake, f.fn), message.id);
    expect(night).toMatchObject({ status: 'queued', deferred: true, scheduledFor: '2026-10-23T08:00:00.000Z' });
    expect(night.reasons[0]).toMatch(/^Outside the sending window/);
    expect(f.calls).toHaveLength(0);
    expect(row(fake, 'outreach_messages', message.id)).toMatchObject({ status: 'queued', scheduled_for: '2026-10-23T08:00:00.000Z' });
    expect(fake.rows('eligibility_decisions').filter((d) => d.message_id === message.id && d.stage === 'dispatch').map((d) => d.outcome)).toEqual(['deferred']);
    expect(await dispatchDue(deps(fake, f.fn))).toMatchObject({ checked: 0, sent: 0 });

    vi.setSystemTime(new Date('2026-10-23T08:00:00Z'));
    expect(await dispatchDue(deps(fake, f.fn))).toMatchObject({ checked: 1, sent: 1, deferred: 0, blocked: 0 });
    expect(f.calls).toHaveLength(1);
    expect(row(fake, 'outreach_messages', message.id)).toMatchObject({ status: 'sent', provider_message_id: 're_due_1' });
  });

  it('holds every due message while sending is paused', async () => {
    const message = await queued(ctx, await prospect(ctx));
    const fake = await cloudCopy(ctx);
    fake.tables.automation_settings[0].sending_paused = true;
    const f = mockFetch(() => json(200, { id: 'never' }));
    expect(await dispatchDue(deps(fake, f.fn))).toMatchObject({ paused: true, checked: 0 });
    const held = await dispatchMessage(deps(fake, f.fn), message.id);
    expect(held).toMatchObject({ status: 'queued', deferred: true });
    expect(f.calls).toHaveLength(0);
  });

  it('never sends to a prospect in this version', async () => {
    const p = await prospect(ctx, { email: PROSPECT_EMAIL });
    const draft = await messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: p.template });
    // Force the message into the queue past the browser's gateway, as a tampered client might.
    const s = ctx.store as LocalStore;
    const decision = await s.createDecision({ ...(await messaging.evaluateMessage(ctx, draft, await demoEnv(ctx), 'approval', 'owner')).decision, outcome: 'eligible', reasons: [] });
    await s.updateOutreachMessage(draft.id, { status: 'approved', decisionId: decision.id });
    await s.updateOutreachMessage(draft.id, { status: 'queued' });
    const fake = await cloudCopy(ctx);
    const f = mockFetch(() => json(200, { id: 'never' }));
    const r = await dispatchMessage(deps(fake, f.fn), draft.id);
    expect(f.calls).toHaveLength(0);
    expect(r).toMatchObject({ status: 'blocked', sandbox: false });
    expect(r.reasons[0]).toMatch(/not available in this version/);
    expect(row(fake, 'outreach_messages', draft.id)).toMatchObject({ status: 'blocked' });
  });

  it('blocks on a sender configuration error before calling the provider', async () => {
    const message = await queued(ctx, await prospect(ctx));
    const fake = await cloudCopy(ctx);
    vi.stubEnv('RESEND_API_KEY', '');
    const f = mockFetch(() => json(200, { id: 'x' }));
    const r = await dispatchMessage(deps(fake, f.fn), message.id);
    expect(f.calls).toHaveLength(0);
    expect(r).toMatchObject({ status: 'blocked', reasons: ['RESEND_API_KEY is not set.'] });
  });

  it('blocks when the stored address no longer matches the approved recipient', async () => {
    const message = await queued(ctx, await prospect(ctx));
    const fake = await cloudCopy(ctx);
    row(fake, 'contact_points', message.contactPointId).normalized_value = 'someone-else@agency-sandbox.com';
    const f = mockFetch(() => json(200, { id: 'x' }));
    const r = await dispatchMessage(deps(fake, f.fn), message.id);
    expect(f.calls).toHaveLength(0);
    expect(r.reasons).toEqual(['The contact detail no longer matches the approved recipient.']);
  });

  it('marks an uncertain send as delivery unknown and never retries it; a rejected one as failed', async () => {
    const p = await prospect(ctx);
    const message = await queued(ctx, p);
    const fake = await cloudCopy(ctx);
    const r = await dispatchMessage(deps(fake, mockFetch(() => Promise.reject(new TypeError('socket hang up'))).fn), message.id);
    expect(r.status).toBe('delivery_unknown');
    expect(String(row(fake, 'outreach_messages', message.id).status_reason)).toMatch(/never retried automatically/);
    await expect(dispatchMessage(deps(fake, mockFetch(() => json(200, { id: 'x' })).fn), message.id)).rejects.toThrow(/Only queued/);

    const ctx2 = demoContext();
    const m2 = await queued(ctx2, await prospect(ctx2));
    const fake2 = await cloudCopy(ctx2);
    expect((await dispatchMessage(deps(fake2, mockFetch(() => json(422, { name: 'validation_error', message: 'Domain not verified' })).fn), m2.id)).status).toBe('failed');
    expect(row(fake2, 'outreach_messages', m2.id).status_reason).toBe('Rejected by the provider: validation_error — Domain not verified');
  });
});

describe('webhooks (server)', () => {
  let ctx: ServiceContext;
  let fake: FakeSupabase;
  let messageId: string;
  beforeEach(async () => {
    ctx = demoContext();
    const message = await queued(ctx, await prospect(ctx));
    messageId = message.id;
    fake = await cloudCopy(ctx);
    await dispatchMessage(deps(fake, mockFetch(() => json(200, { id: 're_sent_1' })).fn), message.id);
    // The database's guard stamps sent_at; the stand-in runs no triggers.
    row(fake, 'outreach_messages', messageId).sent_at = new Date().toISOString();
  });

  const delivered = () => ({ type: 'email.delivered', data: { email_id: 're_sent_1', tags: { message_id: messageId } } });

  it('process each Resend event once and move delivery only forward', async () => {
    expect(await processResendEvent(fake.client, 'msg_1', delivered())).toEqual({ outcome: 'processed' });
    expect(row(fake, 'outreach_messages', messageId).status).toBe('delivered');
    const writes = fake.writes.length;
    expect(await processResendEvent(fake.client, 'msg_1', delivered())).toEqual({ outcome: 'duplicate' });
    expect(fake.writes.length).toBe(writes + 1); // only the ignored upsert of the event key
    expect(await processResendEvent(fake.client, 'msg_2', { type: 'email.sent', data: { email_id: 're_sent_1' } })).toEqual({ outcome: 'processed' });
    expect(row(fake, 'outreach_messages', messageId).status).toBe('delivered');
    expect(fake.rows('channel_events').map((e) => [e.event_id, e.outcome])).toEqual([
      ['msg_1', 'processed'],
      ['msg_2', 'processed'],
    ]);
  });

  it('reprocess an event whose earlier attempt did not finish, and ignore unknown messages and tracking', async () => {
    fake.rows('channel_events').push({ id: 'ev-half', provider: 'resend', event_id: 'msg_retry', event_type: 'email.delivered', outcome: 'received' });
    expect(await processResendEvent(fake.client, 'msg_retry', delivered())).toEqual({ outcome: 'processed' });
    expect(row(fake, 'channel_events', 'ev-half').outcome).toBe('processed');
    expect(await processResendEvent(fake.client, 'msg_3', { type: 'email.delivered', data: { email_id: 're_unknown' } })).toEqual({ outcome: 'ignored' });
    expect(await processResendEvent(fake.client, 'msg_4', { type: 'email.opened', data: { email_id: 're_sent_1' } })).toEqual({ outcome: 'ignored' });
    expect(row(fake, 'outreach_messages', messageId).status).toBe('delivered');
  });

  it('suppress the recipient when Resend reports its own suppression', async () => {
    await processResendEvent(fake.client, 'msg_5', { type: 'email.suppressed', data: { email_id: 're_sent_1' } });
    expect(row(fake, 'outreach_messages', messageId).status).toBe('failed');
    const recipient = await sha256Hex(`email:${TEST_EMAIL}`);
    expect(fake.rows('suppressions').filter((s) => s.value_hash === recipient)).toEqual([expect.objectContaining({ kind: 'email', channel: 'email', reason: 'bounced', source: 'provider_event' })]);
  });

  it('record received email once, linked to the prospect, with opt-out detection on the subject', async () => {
    const event = { type: 'email.received', data: { email_id: 'in_1', from: `Owner <${TEST_EMAIL.toUpperCase()}>`, subject: 'Unsubscribe', created_at: '2026-10-22T11:00:00Z' } };
    expect(await processResendEvent(fake.client, 'msg_in', event)).toEqual({ outcome: 'processed' });
    expect(await processResendEvent(fake.client, 'msg_in', event)).toEqual({ outcome: 'duplicate' });
    const inbound = fake.rows('inbound_messages').filter((m) => m.provider === 'resend');
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ opt_out: true, body: null, reply_to_message_id: messageId, sender_hint: 'o•••@agency-sandbox.com' });
    expect(inbound[0].business_id).toBe(row(fake, 'outreach_messages', messageId).business_id);
    expect(fake.rows('tasks').some((t) => /Confirm the opt-out/.test(String(t.title)))).toBe(true);
    // Without a configured workspace, received messages are recorded as ignored and not filed anywhere.
    vi.stubEnv('MESSAGING_ORGANIZATION_ID', '');
    expect(await processResendEvent(fake.client, 'msg_in2', { ...event, data: { ...event.data, email_id: 'in_2' } })).toEqual({ outcome: 'ignored' });
  });

  it('process WhatsApp statuses and replies once, and suppress after a marketing opt-out code', async () => {
    const recipient = await sha256Hex('phone:+233244123456');
    fake.rows('outreach_messages').push({ ...row(fake, 'outreach_messages', messageId), id: '77777777-7777-4777-8777-777777777777', channel: 'whatsapp', provider: 'whatsapp_cloud', provider_message_id: 'wamid.out', status: 'sent', sent_at: new Date().toISOString(), recipient_hash: recipient, recipient_hint: '+233 ••• 456' });
    const payload = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1234567890' },
                statuses: [{ id: 'wamid.out', status: 'failed', errors: [{ code: 131050, title: 'User stopped marketing messages' }] }],
                messages: [{ id: 'wamid.in', from: '233244123456', timestamp: '1761130800', type: 'text', text: { body: 'Stop' } }],
              },
            },
          ],
        },
      ],
    };
    expect(await processWhatsAppPayload(fake.client, payload)).toEqual({ statuses: 1, messages: 1, duplicates: 0, ignored: 0 });
    expect(await processWhatsAppPayload(fake.client, payload)).toEqual({ statuses: 0, messages: 0, duplicates: 2, ignored: 0 });
    expect(row(fake, 'outreach_messages', '77777777-7777-4777-8777-777777777777')).toMatchObject({ status: 'failed' });
    expect(fake.rows('suppressions').filter((s) => s.value_hash === recipient)).toEqual([expect.objectContaining({ kind: 'phone', channel: 'whatsapp', reason: 'opted_out', source: 'provider_event' })]);
    expect(fake.rows('inbound_messages').filter((m) => m.provider === 'whatsapp_cloud')).toEqual([expect.objectContaining({ opt_out: true, opt_out_match: 'STOP', reply_to_message_id: '77777777-7777-4777-8777-777777777777' })]);
    // Phase 9: the server reads each new reply with the rules only (no AI on webhooks), once.
    const inboundId = fake.rows('inbound_messages').find((m) => m.provider === 'whatsapp_cloud')!.id;
    expect(fake.rows('reply_classifications')).toEqual([expect.objectContaining({ inbound_message_id: inboundId, intent: 'opt_out', confidence: 100, source: 'rules', classifier_version: 'reply-rules-1.0.0', model: null, actor_type: 'system' })]);
    const priced = { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1234567890' }, messages: [{ id: 'wamid.in2', from: '233244123456', timestamp: '1761130900', type: 'text', text: { body: 'How much is a website?' } }] } }] }] };
    await processWhatsAppPayload(fake.client, priced);
    expect(fake.rows('reply_classifications').map((r) => r.intent)).toEqual(['opt_out', 'pricing_question']);
  });
});

describe('WhatsApp template synchronisation (server)', () => {
  it('copies Meta’s status, adds new templates and flags missing ones, without re-enabling disabled ones', async () => {
    const ctx = demoContext();
    await prospect(ctx);
    const fake = await cloudCopy(ctx);
    const base = { organization_id: ORG, channel: 'whatsapp', purpose: 'introduction', language: 'en', body: 'Hello {{business_name}}. Reply STOP to opt out.', version: 1 };
    fake.rows('message_templates').push({ ...base, id: 't-intro', name: 'Intro', provider_template_name: 'intro_v1', status: 'pending' }, { ...base, id: 't-gone', name: 'Gone', provider_template_name: 'gone_v1', status: 'approved' });
    const f = mockFetch(() =>
      json(200, {
        data: [
          { id: '111', name: 'intro_v1', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hello {{business_name}}. Reply STOP to opt out.' }] },
          { id: '222', name: 'follow_up_v1', language: 'en', status: 'REJECTED', category: 'MARKETING', rejected_reason: 'PROMOTIONAL', components: [{ type: 'BODY', text: 'Following up. Reply STOP to opt out.' }] },
        ],
      }),
    );
    // The adapter is given the mocked fetch through the sync's own parameter; only GET requests are made.
    const counts = await syncWhatsAppTemplates(fake.client, ORG, async (url, init) => f.fn(url, { ...init, body: undefined }));
    expect(counts).toEqual({ updated: 1, added: 1, missing: 1 });
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v24.0/9876543210/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100');
    expect(row(fake, 'message_templates', 't-intro')).toMatchObject({ status: 'approved', provider_template_id: '111', provider_category: 'MARKETING' });
    expect(row(fake, 'message_templates', 't-gone')).toMatchObject({ status: 'draft' });
    expect(fake.rows('message_templates').find((t) => t.name === 'follow_up_v1')).toMatchObject({ status: 'rejected', status_reason: 'PROMOTIONAL' });
  });
});
