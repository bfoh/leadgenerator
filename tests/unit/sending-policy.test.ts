// Phase 8: sending windows across time zones and daylight saving, per-recipient caps, the gateway's
// deferred outcome (quiet hours, sending days, pause, daily limits, policy caps, spacing), message
// policies as mandatory cover, the personal note rules, AI note grounding, and the Outreach
// Drafting agent (consent rejection, proposal messages, idempotency, and no way past the gateway).
// Demo store and fake tools only: no network, no paid API.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentStore } from '@/lib/automation/agent-store';
import type { ToolGateway } from '@/lib/automation/agents/types';
import { processQueue, queueAgent, type EngineContext } from '@/lib/automation/engine';
import { LocalAutomationStore } from '@/lib/automation/local-store';
import { MemoryStorage } from '@/lib/data/local-store';
import * as contacts from '@/lib/data/contact-services';
import * as messaging from '@/lib/data/messaging-services';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { POLICY_MAX_DAYS, validatePersonalNote, type OutreachMessage } from '@/lib/domain/messaging';
import { groundNote } from '@/lib/domain/outreach-note';
import {
  DEFAULT_SENDING_POLICY,
  localDayBounds,
  nextSendWindow,
  recipientCaps,
  resolveSendingPolicy,
  sendingPolicySchema,
  zonedTime,
  type SendingPolicy,
  type SentRecord,
} from '@/lib/domain/sending-policy';
import { PROSPECT_EMAIL, cover, demoContext, demoEnv, prospect, queued } from './messaging-fixtures';

// Thursday 22 October 2026, 10:00 in Accra (UTC+0 all year).
const THURSDAY_10 = new Date('2026-10-22T10:00:00Z');
const at = (iso: string) => vi.setSystemTime(new Date(iso));
/** A second sandbox address, so spacing rules for one recipient do not mix into other checks. */
const SECOND = 'second@agency-sandbox.com';

let ctx: ServiceContext;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: THURSDAY_10 });
  ctx = demoContext();
  ctx.settings.messagingTestRecipients.push(SECOND);
});

afterEach(() => {
  vi.useRealTimers();
});

const policy = (overrides: Partial<SendingPolicy> = {}): SendingPolicy => ({ ...structuredClone(DEFAULT_SENDING_POLICY), ...overrides });

describe('sending windows', () => {
  it('opens at the end of quiet hours on sending days only', () => {
    const p = policy();
    expect(nextSendWindow(new Date('2026-10-22T10:00:00Z'), p).toISOString()).toBe('2026-10-22T10:00:00.000Z');
    expect(nextSendWindow(new Date('2026-10-22T07:59:00Z'), p).toISOString()).toBe('2026-10-22T08:00:00.000Z');
    expect(nextSendWindow(new Date('2026-10-22T19:00:00Z'), p).toISOString()).toBe('2026-10-23T08:00:00.000Z');
    // Saturday evening: Sunday is not a sending day, so Monday morning.
    expect(nextSendWindow(new Date('2026-10-24T19:30:00Z'), p).toISOString()).toBe('2026-10-26T08:00:00.000Z');
    expect(nextSendWindow(new Date('2026-10-25T12:00:00Z'), p).toISOString()).toBe('2026-10-26T08:00:00.000Z');
    expect(nextSendWindow(new Date('2026-10-25T12:00:00Z'), policy({ sendDays: [1, 2, 3, 4, 5, 6, 7] })).toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });

  it('uses local wall-clock time, including across a daylight-saving change', () => {
    expect(zonedTime(2026, 10, 22, 8 * 60, 'Africa/Lagos').toISOString()).toBe('2026-10-22T07:00:00.000Z');
    // London leaves summer time on Sunday 25 October 2026.
    expect(zonedTime(2026, 10, 24, 8 * 60, 'Europe/London').toISOString()).toBe('2026-10-24T07:00:00.000Z');
    expect(zonedTime(2026, 10, 26, 8 * 60, 'Europe/London').toISOString()).toBe('2026-10-26T08:00:00.000Z');
    const london = policy({ timezone: 'Europe/London' });
    expect(nextSendWindow(new Date('2026-10-24T18:30:00Z'), london).toISOString()).toBe('2026-10-26T08:00:00.000Z');
    const day = localDayBounds(new Date('2026-10-25T12:00:00Z'), 'Europe/London');
    expect(day.end.getTime() - day.start.getTime()).toBe(25 * 3_600_000);
  });

  it('validates policies: quiet hours must cover the night, and limits are bounded', () => {
    expect(sendingPolicySchema.safeParse(DEFAULT_SENDING_POLICY).success).toBe(true);
    expect(sendingPolicySchema.safeParse(policy({ quietStart: '23:00' })).success).toBe(false);
    expect(sendingPolicySchema.safeParse(policy({ quietEnd: '05:00' })).success).toBe(false);
    expect(sendingPolicySchema.safeParse(policy({ sendDays: [] })).success).toBe(false);
    expect(sendingPolicySchema.safeParse(policy({ dailyLimit: { email: 101, whatsapp: 0 } })).success).toBe(false);
    expect(sendingPolicySchema.safeParse({ ...DEFAULT_SENDING_POLICY, timezone: 'America/New_York' }).success).toBe(false);
    // Stored values that do not validate fall back key by key.
    expect(resolveSendingPolicy({ quietStart: '21:00', dailyLimit: 'lots' })).toMatchObject({ quietStart: '21:00', dailyLimit: DEFAULT_SENDING_POLICY.dailyLimit });
    expect(resolveSendingPolicy(null)).toEqual(DEFAULT_SENDING_POLICY);
  });
});

describe('per-recipient caps', () => {
  const sent = (daysAgo: number, purpose: SentRecord['purpose'] = 'introduction', id = `m${daysAgo}`): SentRecord => ({
    id,
    channel: 'email',
    purpose,
    recipientHash: 'r1',
    templateId: 't1',
    sendingAt: new Date(THURSDAY_10.getTime() - daysAgo * 86_400_000).toISOString(),
  });
  const caps = (purpose: SentRecord['purpose'], history: SentRecord[], received: string[] = []) => recipientCaps({ id: 'new', purpose, recipientHash: 'r1' }, history, received, policy(), THURSDAY_10);

  it('stops a follow-up with no earlier message, or after too many unanswered', () => {
    expect(caps('follow_up', []).blocking).toEqual(['A follow-up needs an earlier message to this recipient.']);
    const history = [sent(28), sent(20, 'follow_up'), sent(10, 'follow_up')];
    expect(caps('follow_up', history).blocking[0]).toMatch(/2 follow-ups already sent without a reply/);
    // A reply from the business resets the count.
    expect(caps('follow_up', history, [new Date(THURSDAY_10.getTime() - 9 * 86_400_000).toISOString()]).blocking).toEqual([]);
  });

  it('makes a message wait for the minimum gap and the 30-day maximum; replies are exempt', () => {
    const recent = caps('introduction', [sent(3)]);
    expect(recent.blocking).toEqual([]);
    expect(recent.waits[0].until?.toISOString()).toBe(new Date(THURSDAY_10.getTime() + 4 * 86_400_000).toISOString());
    const busy = caps('introduction', [sent(29), sent(20), sent(10)]);
    expect(busy.waits.map((w) => w.detail)).toEqual([expect.stringMatching(/3 messages to this recipient in the last 30 days/)]);
    expect(busy.waits[0].until?.toISOString()).toBe(new Date(THURSDAY_10.getTime() + 86_400_000).toISOString());
    expect(caps('reply', [sent(1), sent(2), sent(3)])).toEqual({ blocking: [], waits: [] });
  });
});

describe('the gateway with a sending policy (demo store)', () => {
  it('blocks approval without a covering message policy, and after the policy is revoked', async () => {
    const p = await prospect(ctx);
    const [policyRecord] = await ctx.store.listMessagePolicies();
    await messaging.setPolicyStatus(ctx, policyRecord, 'revoked');
    const draft = await messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: p.template });
    const approval = await messaging.approveMessage(ctx, draft, await demoEnv(ctx), 'owner');
    expect(approval.approved).toBe(false);
    expect(approval.result.checks.find((c) => c.key === 'policy')).toMatchObject({ passed: false, detail: expect.stringMatching(/No active message policy covers “Introduction” \(version 1\)/) });
    // Revoked is final; a new policy restores cover.
    await expect(messaging.setPolicyStatus(ctx, { ...policyRecord, status: 'revoked' }, 'active')).rejects.toThrow();
    await cover(ctx, p.template);
    expect((await messaging.approveMessage(ctx, draft, await demoEnv(ctx), 'owner')).approved).toBe(true);
  });

  it('refuses policies for unapproved or reply templates, and terms beyond the maximum', async () => {
    const draftTemplate = await messaging.saveTemplate(ctx, { channel: 'email', name: 'Draft intro', purpose: 'introduction', language: 'en', subject: 'Hi {{business_name}}', body: 'Hello {{business_name}}, this is {{sender_name}} from {{agency_name}}. Reply if you would like to talk; if not, we will not follow up.', providerTemplateName: '' });
    await expect(cover(ctx, draftTemplate)).rejects.toThrow(/only approved templates can be covered/);
    const approved = await messaging.setTemplateStatus(ctx, draftTemplate, 'approved');
    await expect(messaging.createPolicy(ctx, { templateId: approved.id, name: 'Too long', dailyCap: 5, days: POLICY_MAX_DAYS + 1, note: '' }, [approved])).rejects.toThrow(/At most 180 days/);
    await expect(messaging.createPolicy(ctx, { templateId: approved.id, name: 'Too many', dailyCap: 51, days: 30, note: '' }, [approved])).rejects.toThrow(/At most 50 a day/);
  });

  it('approves at night but makes the message wait for the sending window at dispatch', async () => {
    at('2026-10-22T20:30:00Z');
    const p = await prospect(ctx);
    const draft = await messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: p.template });
    const env = await demoEnv(ctx);
    const approval = await messaging.approveMessage(ctx, draft, env, 'owner');
    expect(approval.approved).toBe(true);
    expect(approval.result.checks.find((c) => c.key === 'schedule')?.detail).toMatch(/^At dispatch: Outside the sending window .* It would wait until Fri 23 Oct, 08:00/);
    const message = await messaging.queueMessage(ctx, approval.message);

    const night = await messaging.simulateDispatch(ctx, message, env);
    expect(night).toMatchObject({ sent: false, deferred: true });
    expect(night.result).toMatchObject({ outcome: 'deferred', deferUntil: '2026-10-23T08:00:00.000Z' });
    const waiting = (await ctx.store.getOutreachMessage(message.id))!;
    expect(waiting).toMatchObject({ status: 'queued', scheduledFor: '2026-10-23T08:00:00.000Z' });
    expect(waiting.statusReason).toMatch(/^Waiting: Outside the sending window/);
    expect((await ctx.store.listDecisions(message.id)).at(-1)).toMatchObject({ stage: 'dispatch', outcome: 'deferred' });
    expect(messaging.dueMessages([waiting])).toHaveLength(0);

    at('2026-10-23T08:00:00Z');
    expect(messaging.dueMessages([waiting])).toHaveLength(1);
    expect(await messaging.simulateDueDispatch(ctx, env)).toMatchObject({ checked: 1, sent: 1, deferred: 0, blocked: 0 });
    expect((await ctx.store.getOutreachMessage(message.id))!.status).toBe('delivered');
  });

  it('holds every dispatch while sending is paused, without moving the time', async () => {
    const message = await queued(ctx, await prospect(ctx));
    const paused = await demoEnv(ctx, { sendingPaused: true });
    expect(await messaging.simulateDueDispatch(ctx, paused)).toMatchObject({ paused: true, checked: 0 });
    const r = await messaging.simulateDispatch(ctx, message, paused);
    expect(r.result).toMatchObject({ outcome: 'deferred', deferUntil: null });
    expect(r.result.reasons).toEqual(['Sending is paused for this workspace. It waits until a person acts.']);
    expect(await ctx.store.getOutreachMessage(message.id)).toMatchObject({ status: 'queued', scheduledFor: message.scheduledFor });
  });

  it('applies the daily channel limit and the policy’s daily cap', async () => {
    const first = await queued(ctx, await prospect(ctx));
    const second = await queued(ctx, await prospect(ctx, { name: 'Ama Fabrics', email: SECOND }));
    const limited = await demoEnv(ctx, { sendingPolicy: policy({ dailyLimit: { email: 1, whatsapp: 20 } }) });
    expect(await messaging.simulateDueDispatch(ctx, limited)).toMatchObject({ checked: 2, sent: 1, deferred: 1 });
    const held = (await ctx.store.getOutreachMessage(second.id))!;
    expect(held).toMatchObject({ status: 'queued', scheduledFor: '2026-10-23T08:00:00.000Z' });
    expect(held.statusReason).toMatch(/1 email message sent today \(daily limit 1\)/);
    expect((await ctx.store.getOutreachMessage(first.id))!.status).toBe('delivered');

    // The policy's own cap: replace the Introduction policy with one that allows one a day.
    const ctx2 = demoContext();
    ctx2.settings.messagingTestRecipients.push(SECOND);
    const p = await prospect(ctx2);
    const [original] = await ctx2.store.listMessagePolicies();
    await messaging.setPolicyStatus(ctx2, original, 'revoked');
    await cover(ctx2, p.template, 1);
    const a = await queued(ctx2, p);
    const b = await queued(ctx2, await prospect(ctx2, { name: 'Ama Fabrics', email: SECOND }));
    expect(await messaging.simulateDueDispatch(ctx2, await demoEnv(ctx2))).toMatchObject({ sent: 1, deferred: 1 });
    expect((await ctx2.store.getOutreachMessage(b.id))!.statusReason).toMatch(/1 sent today under policy “Introduction policy” \(its daily cap is 1\)/);
    expect((await ctx2.store.getOutreachMessage(a.id))!.status).toBe('delivered');
  });

  it('blocks a dispatch whose approval is older than the policy allows', async () => {
    const message = await queued(ctx, await prospect(ctx));
    at('2026-11-06T10:00:00Z'); // 15 days later, a Friday
    const r = await messaging.simulateDispatch(ctx, message, await demoEnv(ctx));
    expect(r.result.outcome).toBe('blocked');
    expect(r.result.reasons).toContain('Approved more than 14 days ago; cancel it and approve a fresh draft.');
  });

  it('checks a requested time: future, and at most seven days ahead', async () => {
    expect(messaging.scheduleIssue('2026-10-22T09:00:00Z')).toMatch(/in the future/);
    expect(messaging.scheduleIssue('2026-10-30T10:00:00Z')).toMatch(/up to 7 days ahead/);
    expect(messaging.scheduleIssue('2026-10-23T09:00:00Z')).toBeNull();
    const p = await prospect(ctx);
    const draft = await messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: p.template });
    const { message } = await messaging.approveMessage(ctx, draft, await demoEnv(ctx), 'owner');
    const scheduled = await messaging.queueMessage(ctx, message, { scheduledFor: '2026-10-23T09:00:00Z' });
    expect(messaging.dueMessages([scheduled])).toHaveLength(0);
  });
});

describe('the personal note', () => {
  it('accepts one plain, specific sentence', () => {
    expect(validatePersonalNote('I enjoyed the photos of your wedding cakes on Instagram, especially the gold-leaf designs.')).toEqual([]);
  });

  it.each([
    ['', /Write the personal note/],
    ['Our starter site costs GHS 2,500.', /prices/],
    ['See www.example.com for ideas.', /links/],
    ['Call us on 024 412 3456.', /links, addresses or phone numbers/],
    ['Your sales grew 40% last year.', /figures/],
    ['I noticed you have no website yet.', /no website/],
    ['We guarantee more customers.', /promise results/],
    ['Act now, this offer ends soon.', /pressure/],
    ['Hello {{business_name}}', /template variables/],
    ['Line one.\nLine two.', /one line/],
    [Array.from({ length: 41 }, () => 'word').join(' '), /40 words/],
  ])('rejects %j', (note, error) => {
    expect(validatePersonalNote(note).join(' ')).toMatch(error);
  });

  it('grounds AI notes in recorded evidence only', () => {
    const pack = { items: [{ id: 'E1' }, { id: 'E2' }] } as Parameters<typeof groundNote>[1];
    const note = 'I saw your bakery’s new Osu branch on your Instagram page.';
    expect(groundNote({ insufficient: false, note, evidenceIds: ['E2', 'E9', 'E2'] }, pack)).toEqual({ ok: true, note, evidenceIds: ['E2'] });
    expect(groundNote({ insufficient: true, note: '', evidenceIds: [] }, pack)).toMatchObject({ ok: false, reason: expect.stringMatching(/does not support/) });
    expect(groundNote({ insufficient: false, note, evidenceIds: ['E7'] }, pack)).toMatchObject({ ok: false, reason: expect.stringMatching(/did not cite any recorded evidence/) });
    expect(groundNote({ insufficient: false, note: 'You have no website, so visit www.agency.com.', evidenceIds: ['E1'] }, pack)).toMatchObject({ ok: false, reason: expect.stringMatching(/broke the message rules/) });
  });
});

// ── The Outreach Drafting agent ──────────────────────────────────────────────

const NOTE_BODY = `Hello {{business_name}} team,

{{personal_note}}

I'm {{sender_name}} from {{agency_name}}. Would a short call next week suit you? If not, just reply and we will not follow up.`;

describe('the Outreach Drafting agent', () => {
  let automation: LocalAutomationStore;
  let noteCalls: number;

  function tools(overrides: Partial<ToolGateway> = {}): ToolGateway {
    return {
      aiConfigured: true,
      aiModel: 'claude-sonnet-5-5',
      async aiReport() {
        throw new Error('not used');
      },
      async aiOutreachNote() {
        noteCalls++;
        return {
          note: 'I enjoyed the photos of your wedding cakes on Instagram.',
          evidenceIds: ['E1'],
          reason: null,
          model: 'claude-sonnet-5-5',
          usage: { inputTokens: 3000, outputTokens: 60, estimatedCostUsd: 0.01 },
          call: { provider: 'anthropic', operation: 'ai_note', units: 1, estimatedCostUsd: 0.01, ok: true },
        };
      },
      research: { available: false, simulated: false, search: { configured: false, provider: null, costPerQueryUsd: 0 } },
      async webSearch() {
        throw new Error('not used');
      },
      async probeDomains() {
        return [];
      },
      async inspectWebsite() {
        throw new Error('not used');
      },
      contacts: { available: false, simulated: false },
      async readContactPage() {
        throw new Error('not used');
      },
      async lookupMx() {
        return [];
      },
      ...overrides,
    };
  }

  const engine = (t: ToolGateway = tools()): EngineContext => ({ automation, svc: ctx, tools: t, workerId: 'test', clock: () => new Date(), random: () => 1 });

  async function run(businessId: string, payload: Record<string, unknown> = {}, t?: ToolGateway) {
    await queueAgent(engine(t), await automation.getSettings(), { agent: 'outreach_drafting', businessId, payload, idempotencyKey: `test:${Math.random()}` });
    const [outcome] = (await processQueue(engine(t), { maxJobs: 1 })).outcomes;
    return outcome;
  }

  const agentDrafts = async (businessId: string) => (await ctx.store.listOutreachMessages(businessId)).filter((m) => m.agentVersion);

  beforeEach(async () => {
    automation = new LocalAutomationStore(new MemoryStorage(), { clock: () => new Date() });
    await automation.updateSettings({ mode: 'research_and_proposals', budgets: { anthropic: { dailyUsd: 1, monthlyUsd: 10 } } });
    noteCalls = 0;
  });

  it('needs Research + proposals mode', async () => {
    const p = await prospect(ctx);
    await automation.updateSettings({ mode: 'research_only' });
    await expect(queueAgent(engine(), await automation.getSettings(), { agent: 'outreach_drafting', businessId: p.business.id })).rejects.toThrow(/needs Research \+ proposals mode/);
  });

  it('writes one draft for a contact with consent and a covered template, and never a second', async () => {
    const p = await prospect(ctx);
    const outcome = await run(p.business.id);
    expect(outcome).toMatchObject({ outcome: 'succeeded', message: expect.stringMatching(/Email introduction draft written for .* Nothing has been sent/) });
    const [draft] = await agentDrafts(p.business.id);
    expect(draft).toMatchObject({ status: 'draft', agentVersion: 'outreach-drafting-1.0.0', templateId: p.template.id, contactPointId: p.point.id, approvedBy: null });
    expect(noteCalls).toBe(0);

    const again = await run(p.business.id);
    expect(again.message).toMatch(/already a draft, approved or queued/);
    expect(await agentDrafts(p.business.id)).toHaveLength(1);
  });

  it('writes nothing without consent, for a suppressed address, or without a covering policy', async () => {
    const noConsent = await prospect(ctx, { consent: false, email: PROSPECT_EMAIL });
    expect((await run(noConsent.business.id)).message).toMatch(/No introduction draft written: No email consent on file\./);

    const suppressed = await prospect(ctx, { name: 'Ama Fabrics', email: SECOND });
    await contacts.addSuppression(ctx, { kind: 'email', value: SECOND, channel: null, reason: 'opted_out', note: null });
    expect((await run(suppressed.business.id)).message).toMatch(/On the suppression list/);

    const uncovered = await prospect(ctx, { name: 'Esi Salon' });
    for (const policyRecord of await ctx.store.listMessagePolicies()) await messaging.setPolicyStatus(ctx, policyRecord, 'revoked');
    expect((await run(uncovered.business.id)).message).toMatch(/No active message policy covers/);

    for (const b of [noConsent, suppressed, uncovered]) expect(await agentDrafts(b.business.id)).toHaveLength(0);
  });

  it('drafts a proposal message only once a person has approved the proposal', async () => {
    const p = await prospect(ctx);
    const template = await messaging.setTemplateStatus(
      ctx,
      await messaging.saveTemplate(ctx, { channel: 'email', name: 'Proposal ready', purpose: 'proposal', language: 'en', subject: 'Your proposal from {{agency_name}}', body: 'Hello {{business_name}} team, this is {{sender_name}} from {{agency_name}}. The proposal we discussed is ready; reply if you would like us to send it, or if you would rather we did not follow up.', providerTemplateName: '' }),
      'approved',
    );
    await cover(ctx, template);
    expect((await run(p.business.id, { purpose: 'proposal' })).message).toMatch(/needs a proposal that a person has approved or issued/);

    const pkg = ctx.settings.packages[0];
    let proposal = await svc.createProposal(ctx, p.business, pkg, null);
    proposal = await svc.saveProposalContent(ctx, proposal, { ...proposal.content, lineItems: proposal.content.lineItems.map((l) => ({ ...l, unitPrice: 100 })) }, proposal.title);
    await svc.transitionProposal(ctx, proposal, (await ctx.store.getBusiness(p.business.id))!, 'approved');
    expect((await run(p.business.id, { purpose: 'proposal' })).outcome).toBe('succeeded');
    expect(await agentDrafts(p.business.id)).toEqual([expect.objectContaining({ purpose: 'proposal', templateId: template.id, status: 'draft' })]);
  });

  it('fills the personal note only when asked, and only with a note that passes the rules', async () => {
    const p = await prospect(ctx);
    // Replace the Introduction template with one that has a personal note.
    for (const policyRecord of await ctx.store.listMessagePolicies()) await messaging.setPolicyStatus(ctx, policyRecord, 'revoked');
    const noted = await messaging.setTemplateStatus(ctx, await messaging.saveTemplate(ctx, { channel: 'email', name: 'Noted intro', purpose: 'introduction', language: 'en', subject: 'Ideas for {{business_name}}', body: NOTE_BODY, providerTemplateName: '' }), 'approved');
    await cover(ctx, noted);

    expect((await run(p.business.id)).message).toMatch(/need a personal note. Run again with the AI note/);
    expect(noteCalls).toBe(0);

    // A tool that returns a note breaking the rules cannot get it into a draft.
    const rogue = tools({
      async aiOutreachNote() {
        noteCalls++;
        return { note: 'Visit www.example.com and act now.', evidenceIds: ['E1'], reason: null, model: 'm', usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }, call: { provider: 'anthropic', operation: 'ai_note', units: 1, estimatedCostUsd: 0, ok: true } };
      },
    });
    const refused = await run(p.business.id, { ai: true }, rogue);
    expect(refused).toMatchObject({ outcome: 'failed', message: expect.stringMatching(/Personal note: .*links/) });
    expect(await agentDrafts(p.business.id)).toHaveLength(0);

    const ok = await run(p.business.id, { ai: true });
    expect(ok.outcome).toBe('succeeded');
    const [draft] = await agentDrafts(p.business.id);
    expect(draft.body).toContain('I enjoyed the photos of your wedding cakes on Instagram.');
    expect(draft.templateId).toBe(noted.id);
    const runs = await automation.listRuns({ businessId: p.business.id });
    expect(runs.some((r) => r.providerCalls.some((c) => c.operation === 'ai_note'))).toBe(true);
  });

  it('cannot approve, queue or send, or set message policies, through the agent store', async () => {
    const p = await prospect(ctx);
    await run(p.business.id);
    const [draft] = await agentDrafts(p.business.id);
    const store = agentStore(ctx.store);
    await expect(store.updateOutreachMessage(draft.id, { status: 'approved' })).rejects.toThrow(/may not approve, queue or send/);
    await expect(store.updateOutreachMessage(draft.id, { scheduledFor: '2026-10-23T09:00:00Z' } as Partial<OutreachMessage>)).rejects.toThrow(/may not approve, queue or send/);
    await expect(store.recordMessageEvent(draft.id, { status: 'sending' }, 'draft')).rejects.toThrow(/send messages or record their delivery/);
    await expect(store.createMessagePolicy({ templateId: p.template.id, name: 'Agent policy', dailyCap: 50, note: null, expiresAt: '2027-01-01T00:00:00Z' })).rejects.toThrow(/set message policies/);
    const [policyRecord] = await ctx.store.listMessagePolicies();
    await expect(store.updateMessagePolicy(policyRecord.id, { status: 'paused' })).rejects.toThrow(/set message policies/);
  });
});
