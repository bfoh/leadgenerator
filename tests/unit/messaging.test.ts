// Phase 7 messaging: the deterministic eligibility gateway (consent, opt-out, expiry, suppression,
// sandbox recipients, mode and emergency stop, template status, sender configuration, duplicates,
// reply windows, approval), the outbound queue's lifecycle and deduplication in the demo store, the
// simulated dispatch, received messages with opt-out detection, template rules, and what agents may
// not do. Simulated provider only: nothing is sent and no network is used.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentStore } from '@/lib/automation/agent-store';
import * as contacts from '@/lib/data/contact-services';
import * as messaging from '@/lib/data/messaging-services';
import type { ServiceContext } from '@/lib/data/services';
import { sha256Hex } from '@/lib/domain/contacts';
import {
  bodyHashInput,
  checkEligibility,
  dedupeKeyInput,
  deliveryTransition,
  detectOptOut,
  renderTemplate,
  replyWindow,
  validateTemplate,
  whatsappParameters,
  type InboundMessage,
  type OutreachMessage,
} from '@/lib/domain/messaging';
import { INTRO_BODY, PROSPECT_EMAIL, TEST_EMAIL, demoContext, demoEnv, grant, introTemplate, prospect, queued } from './messaging-fixtures';

const START = new Date('2026-10-22T10:00:00Z');
let ctx: ServiceContext;
let clock: Date;

const tick = (ms = 1000) => {
  clock = new Date(clock.getTime() + ms);
  vi.setSystemTime(clock);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = START;
  vi.setSystemTime(clock);
  ctx = demoContext();
});

afterEach(() => {
  vi.useRealTimers();
});

async function draftFor(p: Awaited<ReturnType<typeof prospect>>) {
  return messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: p.template });
}

async function approve(message: OutreachMessage, env?: messaging.MessagingEnv, role: 'owner' | 'admin' | 'sales' = 'owner') {
  return messaging.approveMessage(ctx, message, env ?? (await demoEnv(ctx)), role);
}

/** Runs the gateway for the message at a stage without storing anything. */
async function gate(message: OutreachMessage, env: messaging.MessagingEnv, stage: 'preview' | 'approval' | 'dispatch' = 'approval', role: 'owner' | 'sales' | null = 'owner') {
  const inputs = await messaging.gatewayInputs(ctx, message);
  return checkEligibility(message, { ...inputs, stage, now: new Date(), mode: env.mode, outboundStopped: env.outboundStopped, outboundAvailable: env.outboundAvailable, testRecipientHashes: env.testRecipientHashes, senderIssues: env.senderIssues[message.channel], approverRole: role, sendingPolicy: env.sendingPolicy, sendingPaused: env.sendingPaused });
}

describe('the eligibility gateway', () => {
  it('lets an eligible sandbox message reach the queue, and records each decision', async () => {
    const p = await prospect(ctx);
    const draft = await draftFor(p);
    expect(draft).toMatchObject({ status: 'draft', channel: 'email', subject: 'Ideas for Kofi Bakes', templateVersion: 1, recipientHint: p.point.hint });
    expect(draft.body).toContain('I’m Ama Mensah from Sandbox Agency'.replace('’', "'"));
    expect(draft.bodyHash).toBe(await sha256Hex(bodyHashInput(draft.subject, draft.body)));

    const preview = await messaging.evaluateMessage(ctx, draft, await demoEnv(ctx));
    expect(preview.result.eligible).toBe(true);
    expect(preview.result.sandbox).toBe(true);
    expect(preview.decision).toMatchObject({ stage: 'preview', outcome: 'eligible', actorType: 'user', actorId: 'demo-user', gatewayVersion: 'gateway-1.1.0' });

    const approval = await approve(draft);
    expect(approval.approved).toBe(true);
    expect(approval.message).toMatchObject({ status: 'approved', approvedBy: 'demo-user', decisionId: approval.decision.id });
    const queuedMessage = await messaging.queueMessage(ctx, approval.message);
    expect(queuedMessage.status).toBe('queued');
    expect(queuedMessage.dedupeKey).toBe(await sha256Hex(dedupeKeyInput('demo-org', queuedMessage)));
    expect((await ctx.store.listDecisions(draft.id)).map((d) => d.stage).sort()).toEqual(['approval', 'preview']);
  });

  it('blocks a message without consent, even to a verified channel', async () => {
    const p = await prospect(ctx, { consent: false });
    const r = await approve(await draftFor(p));
    expect(r.approved).toBe(false);
    expect(r.result.reasons).toContain('No email consent on file.');
    expect(r.decision).toMatchObject({ stage: 'approval', outcome: 'blocked' });
    expect((await ctx.store.getOutreachMessage(r.message.id))!.status).toBe('draft');
  });

  it('blocks a message after an opt-out, and the suppression wins over the earlier consent', async () => {
    const p = await prospect(ctx);
    const draft = await draftFor(p);
    tick();
    await contacts.recordConsent(ctx, p.business, grant({ status: 'withdrawn', lawfulBasis: null, capturedVia: 'email', evidence: 'Replied “please stop emailing us”.', wording: null, contactPointId: p.point.id }));
    const r = await approve(draft);
    expect(r.approved).toBe(false);
    expect(r.result.reasons).toEqual(expect.arrayContaining(['Consent was withdrawn.', expect.stringMatching(/^On the suppression list/)]));
  });

  it('blocks a message once consent has expired', async () => {
    const p = await prospect(ctx, { consent: { expiresAt: new Date(START.getTime() + 86_400_000).toISOString() } });
    const draft = await draftFor(p);
    tick(2 * 86_400_000);
    const r = await approve(draft);
    expect(r.result.reasons).toContain('Consent has expired; ask the business to confirm it again.');
  });

  it('blocks a suppressed address even with consent on file', async () => {
    const p = await prospect(ctx);
    await contacts.addSuppression(ctx, { kind: 'email', value: TEST_EMAIL, channel: null, reason: 'refused', note: null });
    const r = await approve(await draftFor(p));
    expect(r.approved).toBe(false);
    expect(r.result.checks.find((c) => c.key === 'suppression')).toMatchObject({ passed: false });
  });

  it('blocks every message to a business in this version, whatever else is in order', async () => {
    const p = await prospect(ctx, { email: PROSPECT_EMAIL });
    const draft = await draftFor(p);
    const r = await approve(draft);
    expect(r.approved).toBe(false);
    expect(r.result.sandbox).toBe(false);
    expect(r.result.reasons).toEqual([
      'Sending to businesses is not available in this version; only sandbox test recipients can receive messages.',
      'The workspace is in Research only mode; messages to businesses need Approval-based outreach.',
      'The outbound emergency stop is engaged.',
    ]);
    // Only the mode check stands between this message and the queue; it stays shut until a later version opens it.
    const open = await gate(draft, { ...(await demoEnv(ctx)), mode: 'approval_based_outreach', outboundStopped: false, outboundAvailable: true });
    expect(open.eligible).toBe(true);
    const stopped = await gate(draft, { ...(await demoEnv(ctx)), mode: 'approval_based_outreach', outboundStopped: true, outboundAvailable: true });
    expect(stopped.reasons).toEqual(['The outbound emergency stop is engaged.']);
  });

  it('does not waive consent, suppression or approval for sandbox recipients', async () => {
    const p = await prospect(ctx, { consent: false });
    const draft = await draftFor(p);
    const r = await gate(draft, await demoEnv(ctx), 'approval', 'sales');
    expect(r.sandbox).toBe(true);
    expect(r.reasons).toEqual(expect.arrayContaining(['No email consent on file.', 'Only owners and administrators approve messages.']));
    expect(r.checks.find((c) => c.key === 'mode')).toMatchObject({ passed: true });
  });

  it('checks the template’s status and version', async () => {
    const p = await prospect(ctx);
    const draft = await draftFor(p);
    const paused = await messaging.setTemplateStatus(ctx, p.template, 'paused');
    expect((await gate(draft, await demoEnv(ctx))).reasons).toContain('Template “Introduction” is paused.');
    await messaging.setTemplateStatus(ctx, paused, 'approved');
    const edited = await messaging.saveTemplate(ctx, { channel: 'email', name: 'Introduction', purpose: 'introduction', language: 'en', subject: 'New ideas for {{business_name}}', body: INTRO_BODY, providerTemplateName: '' }, await introTemplate(ctx));
    expect(edited).toMatchObject({ status: 'draft', version: 2 });
    await messaging.setTemplateStatus(ctx, edited, 'approved');
    expect((await gate(draft, await demoEnv(ctx))).reasons).toEqual(['The template changed after this message was drafted; draft it again.']);
    await expect(messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: null })).rejects.toThrow(/approved template/);
  });

  it('reports sender configuration errors', async () => {
    const p = await prospect(ctx);
    const draft = await draftFor(p);
    const env = await demoEnv(ctx);
    const r = await gate(draft, { ...env, senderIssues: { ...env.senderIssues, email: ['RESEND_API_KEY is not set.'] } });
    expect(r.reasons).toEqual(['RESEND_API_KEY is not set.']);
    ctx.settings.agency.address = '';
    expect((await demoEnv(ctx)).senderIssues.email).toEqual(['Add your agency’s postal address in Settings → Agency; marketing emails include it.']);
  });

  it('refuses a second message with the same text to the same recipient', async () => {
    const p = await prospect(ctx);
    const first = await queued(ctx, p);
    const again = await draftFor(p);
    expect(again.bodyHash).toBe(first.bodyHash);
    const r = await approve(again);
    expect(r.result.reasons).toEqual(['The same text was already queued or sent to this recipient.']);
    // The store refuses it too, whatever the gateway said.
    const forced = await ctx.store.createDecision({ ...(await messaging.evaluateMessage(ctx, again, await demoEnv(ctx), 'approval', 'owner')).decision, stage: 'approval', outcome: 'eligible', reasons: [] });
    const approved = await ctx.store.updateOutreachMessage(again.id, { status: 'approved', decisionId: forced.id });
    await expect(messaging.queueMessage(ctx, approved)).rejects.toThrow(/already queued or sent/);
    await messaging.cancelMessage(ctx, first, 'Replaced');
    expect((await messaging.queueMessage(ctx, approved)).status).toBe('queued');
  });

  it('allows a free-text reply only inside the reply window opened by a provider-received message', async () => {
    const p = await prospect(ctx, { consent: false });
    const env = await demoEnv(ctx);
    const reply = (inReplyTo: InboundMessage) => messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'reply', template: null, body: 'Thanks for your message. Tuesday at 10 works for us.', inReplyTo });

    const logged = await messaging.recordReply(ctx, { business: p.business, point: p.point, text: 'Can you call me?', provider: 'manual' });
    const blocked = await gate(await reply(logged), env);
    expect(blocked.reasons).toEqual(expect.arrayContaining(['No email consent on file.', 'A reply without consent must answer a message the business sent in the last 14 days.', 'Messages that do not reply to the business use an approved template.']));

    const received = await messaging.recordReply(ctx, { business: p.business, point: p.point, text: 'Interested, tell me more', subject: 'Your website ideas', provider: 'simulated' });
    const draft = await reply(received);
    expect(draft.subject).toBe('Re: Your website ideas');
    expect((await gate(draft, env)).eligible).toBe(true);
    tick(15 * 86_400_000);
    expect((await gate(draft, env)).eligible).toBe(false);
  });

  it('needs an approval before dispatch and a queued message', async () => {
    const p = await prospect(ctx);
    const draft = await draftFor(p);
    const r = await gate(draft, await demoEnv(ctx), 'dispatch', null);
    expect(r.reasons).toEqual(expect.arrayContaining(['The message is draft; this check needs a queued message.', 'No person approved this message.']));
  });
});

describe('the outbound queue (demo store)', () => {
  it('dispatches a queued sandbox message once through the simulated provider', async () => {
    const p = await prospect(ctx);
    const message = await queued(ctx, p);
    const env = await demoEnv(ctx);
    const [a, b] = await Promise.all([messaging.simulateDispatch(ctx, message, env), messaging.simulateDispatch(ctx, message, env)]);
    expect([a.sent, b.sent].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.sent)).toMatchObject({ duplicate: true });
    const after = (await ctx.store.getOutreachMessage(message.id))!;
    expect(after).toMatchObject({ status: 'delivered', provider: 'simulated', sandbox: true, statusReason: 'Simulated delivery — nothing was sent.' });
    expect(after.providerMessageId).toMatch(/^sim_/);
    // A later retry of the same job does nothing.
    const again = await messaging.simulateDispatch(ctx, message, env);
    expect(again.sent).toBe(false);
    expect((await ctx.store.getOutreachMessage(message.id))!.providerMessageId).toBe(after.providerMessageId);
    const sends = (await ctx.store.listActivities(p.business.id)).filter((x) => /Simulated email send/.test(x.summary));
    expect(sends).toHaveLength(1);
  });

  it('blocks at dispatch when something changed after approval', async () => {
    const p = await prospect(ctx);
    const message = await queued(ctx, p);
    tick();
    await contacts.recordConsent(ctx, p.business, grant({ status: 'withdrawn', lawfulBasis: null, capturedVia: 'email', evidence: 'Asked us to stop.', wording: null }));
    const r = await messaging.simulateDispatch(ctx, message, await demoEnv(ctx));
    expect(r.sent).toBe(false);
    expect(r.message).toMatchObject({ status: 'blocked' });
    expect(r.message.statusReason).toMatch(/Consent was withdrawn/);
  });

  it('keeps people to the moves they may make, and fixes the content once approved', async () => {
    const p = await prospect(ctx);
    const draft = await draftFor(p);
    await expect(ctx.store.updateOutreachMessage(draft.id, { status: 'approved' })).rejects.toThrow(/eligibility decision/);
    await expect(ctx.store.updateOutreachMessage(draft.id, { status: 'queued' })).rejects.toThrow();
    const { message } = await approve(draft);
    await expect(messaging.editDraft(ctx, message, { body: 'Changed' })).rejects.toThrow(/Only a draft/);
    const back = await messaging.returnToDraft(ctx, message);
    expect(back).toMatchObject({ status: 'draft', approvedBy: null, decisionId: null });
    expect((await messaging.editDraft(ctx, back, { body: 'Changed text' })).bodyHash).toBe(await sha256Hex(bodyHashInput(back.subject, 'Changed text')));
  });

  it('runs the store checks in demo mode only for simulated sends', async () => {
    const p = await prospect(ctx);
    const message = await queued(ctx, p);
    const cloudish = { ...ctx, store: new Proxy(ctx.store, { get: (t, k) => (k === 'mode' ? 'cloud' : Reflect.get(t, k, t)) }) };
    await expect(messaging.simulateDispatch(cloudish, message, await demoEnv(ctx))).rejects.toThrow(/server dispatches/);
  });
});

describe('received messages', () => {
  it('suppress the sender on every channel when they opt out, and never answer automatically', async () => {
    const p = await prospect(ctx);
    const stop = await messaging.recordReply(ctx, { business: p.business, point: p.point, text: 'STOP', provider: 'simulated' });
    expect(stop).toMatchObject({ optOut: true, optOutMatch: 'STOP' });
    const s = (await ctx.store.listSuppressions()).find((x) => x.valueHash === p.point.valueHash);
    expect(s).toMatchObject({ kind: 'email', channel: null, reason: 'opted_out', source: 'inbound_opt_out' });
    expect((await ctx.store.listTasks()).some((t) => /Confirm the opt-out/.test(t.title))).toBe(true);
    expect((await ctx.store.listOutreachMessages()).length).toBe(0);
    const r = await approve(await draftFor(p));
    expect(r.result.checks.find((c) => c.key === 'suppression')).toMatchObject({ passed: false });
  });

  it('create a follow-up task for an ordinary reply and can be marked handled', async () => {
    const p = await prospect(ctx);
    const m = await messaging.recordReply(ctx, { business: p.business, point: p.point, text: 'Sounds good, call me on Monday', provider: 'simulated' });
    expect(m.optOut).toBe(false);
    // Phase 9: the rules read it as a meeting request, and the task says what to do.
    expect((await ctx.store.listReplyClassifications([m.id]))[0]).toMatchObject({ intent: 'meeting_request', source: 'rules' });
    expect((await ctx.store.listTasks()).some((t) => /Agree a meeting time with/.test(t.title))).toBe(true);
    const unclear = await messaging.recordReply(ctx, { business: p.business, point: p.point, text: 'Received.', provider: 'simulated' });
    expect((await ctx.store.listReplyClassifications([unclear.id]))[0]).toMatchObject({ intent: 'unclear' });
    expect((await ctx.store.listTasks()).some((t) => /Read and answer the email reply/.test(t.title))).toBe(true);
    const handled = await messaging.setInboundHandled(ctx, m, true);
    expect(handled.handledBy).toBe('demo-user');
    // Received text is never edited: the store takes only the handling and prospect fields.
    await ctx.store.updateInboundMessage(m.id, { body: 'edited' } as never);
    expect((await ctx.store.listInboundMessages()).find((x) => x.id === m.id)!.body).toBe('Sounds good, call me on Monday');
  });

  it('are linked to the message they answer', async () => {
    const p = await prospect(ctx);
    const message = await queued(ctx, p);
    await messaging.simulateDispatch(ctx, message, await demoEnv(ctx));
    const reply = await messaging.recordReply(ctx, { business: p.business, point: p.point, text: 'Thanks!', provider: 'simulated' });
    expect(reply.replyToMessageId).toBe(message.id);
  });
});

describe('message rules', () => {
  it('detects opt-outs deterministically', () => {
    for (const text of ['STOP', 'stop.', ' Unsubscribe ', 'Please remove me from your list', 'Do not contact us again', "don't message me", 'opt-out', 'Take me off your list', 'No more emails please', 'Stop messaging this number']) {
      expect(detectOptOut(text).optOut, text).toBe(true);
    }
    for (const text of ['Stop by our shop on Monday', 'We cannot stop thinking about your proposal', 'Please call me', '', null]) {
      expect(detectOptOut(text).optOut, String(text)).toBe(false);
    }
  });

  it('moves delivery status only forward', () => {
    expect(deliveryTransition('sending', 'delivered')).toBe('delivered');
    expect(deliveryTransition('sent', 'delivered')).toBe('delivered');
    expect(deliveryTransition('delivered', 'sent')).toBeNull();
    expect(deliveryTransition('read', 'delivered')).toBeNull();
    expect(deliveryTransition('delivered', 'complained')).toBe('complained');
    expect(deliveryTransition('delivered', 'bounced')).toBe('bounced');
    expect(deliveryTransition('read', 'bounced')).toBeNull();
    expect(deliveryTransition('delivery_unknown', 'sent')).toBe('sent');
    expect(deliveryTransition('sent', 'delayed')).toBeNull();
    expect(deliveryTransition('failed', 'delivered')).toBeNull();
    expect(deliveryTransition('bounced', 'complained')).toBeNull();
  });

  it('validates templates', () => {
    expect(validateTemplate({ channel: 'email', subject: 'Hi', body: INTRO_BODY, providerTemplateName: null, purpose: 'introduction' })).toEqual({ errors: [], warnings: [] });
    const bad = validateTemplate({ channel: 'email', subject: '', body: `Hello {{owner_name}}, only GHS 1,500 this week! ${'word '.repeat(150)}`, providerTemplateName: null, purpose: 'introduction' });
    expect(bad.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Unknown variables: \{\{owner_name\}\}/), expect.stringMatching(/do not quote prices/), 'An email template needs a subject.', expect.stringMatching(/150 words or fewer/)]));
    expect(bad.warnings).toEqual(expect.arrayContaining(['Address the business by name ({{business_name}}).']));
    const wa = validateTemplate({ channel: 'whatsapp', subject: null, body: 'Hello {{business_name}}', providerTemplateName: null, purpose: 'introduction' });
    expect(wa.errors).toEqual(expect.arrayContaining([expect.stringMatching(/template name/), expect.stringMatching(/how to opt out/)]));
  });

  it('renders variables and WhatsApp named parameters', () => {
    expect(renderTemplate('Hi {{business_name}} from {{agency_name}}', { business_name: 'Kofi Bakes' })).toEqual({ text: 'Hi Kofi Bakes from ', missing: ['agency_name'] });
    expect(whatsappParameters('Hi {{business_name}}, {{sender_name}} here', { business_name: 'Kofi Bakes', sender_name: 'Ama' })).toEqual([
      { name: 'business_name', text: 'Kofi Bakes' },
      { name: 'sender_name', text: 'Ama' },
    ]);
  });

  it('does not count manual entries or opt-outs as opening a reply window', () => {
    const base = { id: 'i1', organizationId: 'o', channel: 'whatsapp', provider: 'whatsapp_cloud', providerMessageId: 'w1', businessId: null, contactPointId: null, replyToMessageId: null, senderHash: 'h', senderHint: '+233 ••• 111', subject: null, body: 'Hi', receivedAt: START.toISOString(), optOut: false, optOutMatch: null, handledAt: null, handledBy: null, createdBy: null, createdAt: START.toISOString() } satisfies InboundMessage;
    const msg = { channel: 'whatsapp' as const, recipientHash: 'h' };
    expect(replyWindow(msg, [base], new Date(START.getTime() + 23 * 3_600_000))?.id).toBe('i1');
    expect(replyWindow(msg, [base], new Date(START.getTime() + 25 * 3_600_000))).toBeNull();
    expect(replyWindow(msg, [{ ...base, provider: 'manual' }], START)).toBeNull();
    expect(replyWindow(msg, [{ ...base, optOut: true, optOutMatch: 'STOP' }], START)).toBeNull();
  });

  it('hashes test recipients like contact points and skips invalid entries', async () => {
    const hashes = await messaging.testRecipientHashes([' Owner@Agency-Sandbox.com ', '024 412 3456', 'not an address']);
    expect(hashes).toEqual([await sha256Hex('email:owner@agency-sandbox.com'), await sha256Hex('phone:+233244123456')]);
  });
});

describe('what agents may not do with messages', () => {
  it('may draft (naming their version) and record previews, but not approve, queue, send or record replies', async () => {
    const p = await prospect(ctx);
    const store = agentStore(ctx.store);
    const draft = await draftFor(p);
    await expect(store.createOutreachMessage({ ...draft, agentVersion: null })).rejects.toThrow(/agent version/);
    expect((await store.createOutreachMessage({ ...draft, body: 'Agent draft', agentVersion: 'outreach-drafting-0.1.0' })).agentVersion).toBe('outreach-drafting-0.1.0');
    await expect(store.updateOutreachMessage(draft.id, { status: 'approved' })).rejects.toThrow(/may not approve, queue or send/);
    await expect(store.updateOutreachMessage(draft.id, { status: 'queued' })).rejects.toThrow(/may not approve, queue or send/);
    await expect(store.recordMessageEvent(draft.id, { status: 'sending' })).rejects.toThrow(/may not send messages/);
    await expect(store.createDecision({ ...(await ctx.store.listDecisions())[0], stage: 'approval' } as never)).rejects.toThrow(/preview decisions only/);
    await expect(store.createInboundMessage({} as never)).rejects.toThrow(/may not record received messages/);
    await expect(store.updateTemplate(p.template.id, { status: 'approved' })).rejects.toThrow(/may not manage message templates/);
    await expect(store.deleteOutreachMessage(draft.id)).rejects.toThrow(/may not delete messages/);
    expect((await store.updateOutreachMessage(draft.id, { status: 'cancelled' })).status).toBe('cancelled');
  });
});
