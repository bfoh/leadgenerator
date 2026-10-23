// Messaging operations shared by demo and cloud mode (phases 7–8): templates, message policies,
// drafting, the eligibility gateway with stored decisions, approval, scheduling, queueing,
// cancelling and received messages. Sending is not here: in cloud mode the server's dispatch route
// sends (re-running the gateway), and in demo mode simulateDispatch stands in for it and says so.
// Activity entries carry masked hints, never addresses or message text.

import { z } from 'zod';
import type { AutomationMode } from '@/lib/automation/constants';
import type { AutomationSettings } from '@/lib/automation/types';
import type { Role } from '@/lib/domain/constants';
import { contactKey, normalizeContact, sha256Hex, type ContactPoint } from '@/lib/domain/contacts';
import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_CHANNELS,
  MESSAGE_PURPOSE_LABELS,
  MESSAGE_PURPOSES,
  MESSAGE_STATUS_META,
  POLICY_DAILY_CAP_MAX,
  POLICY_DEFAULT_DAYS,
  POLICY_MAX_DAYS,
  SENT_STATUSES,
  agencyIdentityIssues,
  checkEligibility,
  decisionRecord,
  detectOptOut,
  policyTemplateIssues,
  renderTemplate,
  templateVariables,
  validatePersonalNote,
  validateTemplate,
  variableValues,
  whatsappParameters,
  type DecisionStage,
  type EligibilityDecision,
  type GatewayResult,
  type InboundMessage,
  type MessageChannel,
  type MessagePolicy,
  type MessagePurpose,
  type MessageTemplate,
  type OutreachMessage,
  type PolicyStatus,
  type TemplateStatus,
} from '@/lib/domain/messaging';
import { MAX_SCHEDULE_AHEAD_DAYS, formatLocal, type SendingPolicy } from '@/lib/domain/sending-policy';
import type { Business } from '@/lib/domain/types';
import { applyArrival, classifyOnArrival } from './response-services';
import { log, type ServiceContext } from './services';
import { MESSAGING_MIGRATION_REQUIRED, SENDING_MIGRATION_REQUIRED, StoreError } from './store';

const now = () => new Date().toISOString();

export async function requireMessagingSchema(ctx: ServiceContext) {
  if (!(await ctx.store.messagingSchemaAvailable())) throw new StoreError(MESSAGING_MIGRATION_REQUIRED, 'unavailable');
}

/** What the gateway needs from outside the records: workspace policy and sender configuration. */
export interface MessagingEnv {
  mode: AutomationMode;
  outboundStopped: boolean;
  /** public.outbound_available(): false in this version. */
  outboundAvailable: boolean;
  testRecipientHashes: string[];
  senderIssues: Record<MessageChannel, string[]>;
  /** Phase 8: quiet hours, sending days, limits and caps, and the switch that holds all dispatch. */
  sendingPolicy: SendingPolicy;
  sendingPaused: boolean;
}

export type SendingControls = Pick<AutomationSettings, 'mode' | 'outboundStopped' | 'sendingPolicy' | 'sendingPaused'>;

/** Hashes test recipient addresses the same way contact points are hashed. Invalid entries are skipped. */
export async function testRecipientHashes(values: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const raw of values) {
    const type = raw.includes('@') ? 'email' : 'whatsapp';
    const n = normalizeContact(type, raw);
    const key = n.ok ? contactKey(type, n.normalized) : null;
    if (key) out.push(await sha256Hex(key));
  }
  return [...new Set(out)];
}

/** Demo mode: the simulated provider needs only the agency identity; test recipients come from settings. */
export async function demoMessagingEnv(ctx: ServiceContext, automation: SendingControls): Promise<MessagingEnv> {
  return {
    mode: automation.mode,
    outboundStopped: automation.outboundStopped,
    sendingPolicy: automation.sendingPolicy,
    sendingPaused: automation.sendingPaused,
    outboundAvailable: false,
    testRecipientHashes: await testRecipientHashes(ctx.settings.messagingTestRecipients),
    senderIssues: { email: agencyIdentityIssues(ctx.settings, 'email'), whatsapp: agencyIdentityIssues(ctx.settings, 'whatsapp') },
  };
}

// ── Templates ────────────────────────────────────────────────────────────────

export const templateFormSchema = z
  .object({
    channel: z.enum(MESSAGE_CHANNELS),
    name: z.string().trim().min(1, 'Give the template a name').max(120),
    purpose: z.enum(MESSAGE_PURPOSES),
    language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Use a language code such as en or en_US'),
    subject: z.string().trim().max(200),
    body: z.string().trim().min(1, 'Write the message').max(5000),
    providerTemplateName: z.string().trim().max(512),
  })
  .superRefine((v, c) => {
    if (v.channel === 'email' && !v.subject) c.addIssue({ code: 'custom', path: ['subject'], message: 'An email needs a subject' });
    if (v.channel === 'whatsapp' && !/^[a-z0-9_]{1,512}$/.test(v.providerTemplateName)) {
      c.addIssue({ code: 'custom', path: ['providerTemplateName'], message: 'Use the exact template name from WhatsApp Manager (lowercase letters, digits, underscores)' });
    }
  });
export type TemplateForm = z.infer<typeof templateFormSchema>;

export async function saveTemplate(ctx: ServiceContext, form: TemplateForm, existing?: MessageTemplate | null) {
  await requireMessagingSchema(ctx);
  const v = templateFormSchema.parse(form);
  const input = {
    channel: v.channel,
    name: v.name,
    purpose: v.purpose,
    language: v.language,
    subject: v.channel === 'email' ? v.subject : null,
    body: v.body,
    providerTemplateName: v.channel === 'whatsapp' ? v.providerTemplateName : null,
  };
  return existing ? ctx.store.updateTemplate(existing.id, input) : ctx.store.createTemplate(input);
}

/** Email templates: owners/admins approve, pause or disable. WhatsApp templates: only disable locally. */
export async function setTemplateStatus(ctx: ServiceContext, template: MessageTemplate, status: TemplateStatus) {
  if (status === 'approved') {
    const { errors } = validateTemplate(template);
    if (errors.length) throw new StoreError(`Fix the template before approving it: ${errors.join(' ')}`, 'invalid');
  }
  return ctx.store.updateTemplate(template.id, { status });
}

// ── Approved-message policies ────────────────────────────────────────────────

export const policyFormSchema = z.object({
  templateId: z.string().min(1, 'Choose an approved template'),
  name: z.string().trim().min(1, 'Give the policy a name').max(120),
  dailyCap: z.coerce.number().int().min(1, 'At least 1 a day').max(POLICY_DAILY_CAP_MAX, `At most ${POLICY_DAILY_CAP_MAX} a day`),
  days: z.coerce.number().int().min(1).max(POLICY_MAX_DAYS, `At most ${POLICY_MAX_DAYS} days`),
  note: z.string().trim().max(1000),
});
export type PolicyForm = z.input<typeof policyFormSchema>;
export const DEFAULT_POLICY_FORM: PolicyForm = { templateId: '', name: '', dailyCap: 10, days: POLICY_DEFAULT_DAYS, note: '' };

/** Owners/admins: a standing approval for one approved template version. */
export async function createPolicy(ctx: ServiceContext, form: PolicyForm, templates: MessageTemplate[]) {
  if (!(await ctx.store.sendingSchemaAvailable())) throw new StoreError(SENDING_MIGRATION_REQUIRED, 'unavailable');
  const v = policyFormSchema.parse(form);
  const template = templates.find((t) => t.id === v.templateId);
  if (!template) throw new StoreError('Template not found.', 'not_found');
  const issues = policyTemplateIssues(template);
  if (issues.length) throw new StoreError(issues[0], 'invalid');
  return ctx.store.createMessagePolicy({
    templateId: template.id,
    name: v.name,
    dailyCap: v.dailyCap,
    note: v.note || null,
    expiresAt: new Date(Date.now() + v.days * 86_400_000).toISOString(),
  });
}

export async function setPolicyStatus(ctx: ServiceContext, policy: MessagePolicy, status: PolicyStatus) {
  return ctx.store.updateMessagePolicy(policy.id, { status });
}

// ── Drafting ─────────────────────────────────────────────────────────────────

export interface DraftInput {
  business: Business;
  point: ContactPoint;
  purpose: MessagePurpose;
  template: MessageTemplate | null;
  /** Free text: replies inside the reply window only. */
  subject?: string;
  body?: string;
  inReplyTo?: InboundMessage | null;
  agentVersion?: string | null;
  /** {{personal_note}}: one reviewed sentence about the business (validatePersonalNote). */
  personalNote?: string;
}

export const usesPersonalNote = (t: Pick<MessageTemplate, 'body' | 'subject'> | null) => Boolean(t && templateVariables(`${t.subject ?? ''}\n${t.body}`).includes('personal_note'));

export function channelForPoint(point: Pick<ContactPoint, 'type'>): MessageChannel | null {
  return point.type === 'email' ? 'email' : point.type === 'whatsapp' ? 'whatsapp' : null;
}

/** Renders a template (or takes a reply's free text) into a draft addressed to one contact point. */
export async function draftMessage(ctx: ServiceContext, input: DraftInput): Promise<OutreachMessage> {
  await requireMessagingSchema(ctx);
  const { business, point, template } = input;
  const channel = channelForPoint(point);
  if (!channel) throw new StoreError('Messages go to an email address or a WhatsApp number recorded as such.', 'invalid');
  if (point.businessId !== business.id) throw new StoreError('That contact point belongs to another prospect.', 'invalid');
  if (!point.valueHash) throw new StoreError('Contact hash missing.', 'invalid');

  let subject: string | null = null;
  let body: string;
  let parameters: Record<string, string> = {};
  if (template) {
    if (template.channel !== channel) throw new StoreError(`Template “${template.name}” is for ${MESSAGE_CHANNEL_LABELS[template.channel]}.`, 'invalid');
    const note = (input.personalNote ?? '').trim();
    if (usesPersonalNote(template)) {
      const noteErrors = validatePersonalNote(note);
      if (noteErrors.length) throw new StoreError(`Personal note: ${noteErrors.join(' ')}`, 'invalid');
    }
    const values = variableValues(ctx.settings, business, ctx.userLabel, note);
    const renderedBody = renderTemplate(template.body, values);
    const renderedSubject = template.subject ? renderTemplate(template.subject, values) : { text: '', missing: [] };
    const missing = [...new Set([...renderedBody.missing, ...renderedSubject.missing])];
    if (missing.length) throw new StoreError(`Fill in ${missing.map((m) => `{{${m}}}`).join(', ')} first (Settings → Agency for agency details).`, 'invalid');
    body = renderedBody.text;
    subject = channel === 'email' ? renderedSubject.text : null;
    if (channel === 'whatsapp') parameters = Object.fromEntries(whatsappParameters(template.body, values).map((p) => [p.name, p.text]));
  } else {
    if (input.purpose !== 'reply') throw new StoreError('Choose an approved template; free text is only for replies to a business’s message.', 'invalid');
    body = (input.body ?? '').trim();
    if (!body) throw new StoreError('Write the reply.', 'invalid');
    if (channel === 'email') subject = (input.subject ?? '').trim() || `Re: ${input.inReplyTo?.subject ?? `your message to ${ctx.settings.agency.name || 'us'}`}`.slice(0, 200);
  }

  const message = await ctx.store.createOutreachMessage({
    businessId: business.id,
    contactPointId: point.id,
    channel,
    purpose: input.purpose,
    templateId: template?.id ?? null,
    templateVersion: template?.version ?? null,
    parameters,
    subject,
    body,
    recipientHash: point.valueHash,
    recipientHint: point.hint,
    inReplyTo: input.inReplyTo?.id ?? null,
    agentVersion: input.agentVersion ?? null,
  });
  await log(ctx, business.id, 'system', `${MESSAGE_CHANNEL_LABELS[channel]} draft (${MESSAGE_PURPOSE_LABELS[input.purpose].toLowerCase()}) prepared for ${point.hint}. Nothing has been sent.`, {
    messageId: message.id,
  });
  return message;
}

export async function editDraft(ctx: ServiceContext, message: OutreachMessage, edit: { subject?: string | null; body: string }) {
  const body = edit.body.trim();
  if (!body) throw new StoreError('Write the message.', 'invalid');
  return ctx.store.updateOutreachMessage(message.id, { body, ...(message.channel === 'email' ? { subject: edit.subject?.trim() || message.subject } : {}) });
}

// ── Gateway ──────────────────────────────────────────────────────────────────

/** Loads everything the gateway reads for one message, fresh from the store. */
export async function gatewayInputs(ctx: ServiceContext, message: OutreachMessage) {
  const [business, points, templates, consents, suppressions, inbound, history, policies] = await Promise.all([
    ctx.store.getBusiness(message.businessId),
    ctx.store.listContactPoints(message.businessId),
    message.templateId ? ctx.store.listTemplates() : Promise.resolve([]),
    ctx.store.listConsentRecords(message.businessId),
    ctx.store.listSuppressions(),
    ctx.store.listInboundMessages(),
    ctx.store.listOutreachMessages(),
    message.templateId ? ctx.store.listMessagePolicies() : Promise.resolve([]),
  ]);
  if (!business) throw new StoreError('Prospect not found.', 'not_found');
  return {
    business,
    point: points.find((p) => p.id === message.contactPointId) ?? null,
    template: templates.find((t) => t.id === message.templateId) ?? null,
    consents,
    suppressions,
    inbound: inbound.filter((m) => m.senderHash === message.recipientHash),
    history: history.filter((m) => m.recipientHash === message.recipientHash),
    policies,
    outbound: history.filter((m) => m.sendingAt && SENT_STATUSES.includes(m.status)),
  };
}

/** Runs the gateway and stores the decision (append-only) with its checks and inputs. */
export async function evaluateMessage(
  ctx: ServiceContext,
  message: OutreachMessage,
  env: MessagingEnv,
  stage: DecisionStage = 'preview',
  approverRole: Role | null = null,
): Promise<{ result: GatewayResult; decision: EligibilityDecision }> {
  await requireMessagingSchema(ctx);
  const inputs = await gatewayInputs(ctx, message);
  const result = checkEligibility(message, {
    ...inputs,
    stage,
    now: new Date(),
    mode: env.mode,
    outboundStopped: env.outboundStopped,
    outboundAvailable: env.outboundAvailable,
    testRecipientHashes: env.testRecipientHashes,
    senderIssues: env.senderIssues[message.channel],
    approverRole,
    sendingPolicy: env.sendingPolicy,
    sendingPaused: env.sendingPaused,
  });
  const decision = await ctx.store.createDecision(decisionRecord(message, result, stage, { type: 'user', id: ctx.userId }));
  return { result, decision };
}

/** Owners/admins. Approves only when the gateway passes; otherwise the decision records why not. */
export async function approveMessage(ctx: ServiceContext, message: OutreachMessage, env: MessagingEnv, role: Role | null) {
  const { result, decision } = await evaluateMessage(ctx, message, env, 'approval', role);
  if (!result.eligible) {
    await log(ctx, message.businessId, 'system', `Approval blocked by the eligibility gateway for ${message.recipientHint}: ${result.reasons[0]}`, { messageId: message.id, decisionId: decision.id });
    return { approved: false as const, result, decision, message };
  }
  const updated = await ctx.store.updateOutreachMessage(message.id, { status: 'approved', decisionId: decision.id });
  await log(ctx, message.businessId, 'system', `${MESSAGE_CHANNEL_LABELS[message.channel]} message to ${message.recipientHint} approved by ${ctx.userLabel} after the eligibility check${result.sandbox ? ' (sandbox test recipient)' : ''}.`, {
    messageId: message.id,
    decisionId: decision.id,
  });
  return { approved: true as const, result, decision, message: updated };
}

export async function returnToDraft(ctx: ServiceContext, message: OutreachMessage) {
  return ctx.store.updateOutreachMessage(message.id, { status: 'draft' });
}

/** Checks a requested send time: in the future and at most MAX_SCHEDULE_AHEAD_DAYS ahead. */
export function scheduleIssue(scheduledFor: string | null | undefined, now = new Date()): string | null {
  if (!scheduledFor) return null;
  const at = new Date(scheduledFor);
  if (Number.isNaN(at.getTime())) return 'Choose a valid date and time.';
  if (at <= now) return 'Choose a time in the future, or send as soon as the policy allows.';
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) return `Messages can be scheduled up to ${MAX_SCHEDULE_AHEAD_DAYS} days ahead.`;
  return null;
}

/**
 * Approved → queued, optionally for a later time. The store stamps the dedupe key, so the same text
 * cannot be queued twice. Quiet hours, limits and caps are applied at dispatch, not here.
 */
export async function queueMessage(ctx: ServiceContext, message: OutreachMessage, options: { scheduledFor?: string | null; timezone?: string } = {}) {
  const issue = scheduleIssue(options.scheduledFor);
  if (issue) throw new StoreError(issue, 'invalid');
  const scheduledFor = options.scheduledFor ? new Date(options.scheduledFor).toISOString() : undefined;
  const updated = await ctx.store.updateOutreachMessage(message.id, { status: 'queued', ...(scheduledFor ? { scheduledFor } : {}) });
  const when = scheduledFor ? ` for ${formatLocal(scheduledFor, options.timezone ?? 'Africa/Accra')}` : '';
  await log(ctx, message.businessId, 'system', `Message to ${message.recipientHint} queued${when}; the gateway checks it again before dispatch.`, { messageId: message.id });
  return updated;
}

/** Queued messages whose time has come, oldest first. */
export function dueMessages(messages: readonly OutreachMessage[], now = new Date()) {
  return messages
    .filter((m) => m.status === 'queued' && (!m.scheduledFor || new Date(m.scheduledFor) <= now))
    .sort((a, b) => (a.scheduledFor ?? a.queuedAt ?? '').localeCompare(b.scheduledFor ?? b.queuedAt ?? ''));
}

/** Short explanation stored on a deferred message. */
export function deferralReason(result: Pick<GatewayResult, 'reasons'>) {
  return `Waiting: ${result.reasons.join(' ')}`.slice(0, 1000);
}

export async function cancelMessage(ctx: ServiceContext, message: OutreachMessage, reason: string) {
  const updated = await ctx.store.updateOutreachMessage(message.id, { status: 'cancelled', statusReason: reason.trim().slice(0, 1000) || null });
  await log(ctx, message.businessId, 'system', `Message to ${message.recipientHint} cancelled. Nothing was sent.`, { messageId: message.id });
  return updated;
}

export async function deleteDraft(ctx: ServiceContext, message: OutreachMessage) {
  await ctx.store.deleteOutreachMessage(message.id);
}

/**
 * Demo mode's stand-in for the server's dispatch: the same dispatch-stage gateway, the same
 * compare-and-set on the queued status, then a simulated provider. Nothing leaves the browser.
 */
export async function simulateDispatch(ctx: ServiceContext, message: OutreachMessage, env: MessagingEnv) {
  if (ctx.store.mode !== 'demo') throw new StoreError('In cloud mode the server dispatches messages.', 'invalid');
  const { result, decision } = await evaluateMessage(ctx, message, env, 'dispatch');
  if (result.outcome === 'deferred') {
    // Timing rules only: it stays queued, moved to when it may go (or held while sending is paused).
    const held = await ctx.store.recordMessageEvent(
      message.id,
      { statusReason: deferralReason(result), dispatchDecisionId: decision.id, ...(result.deferUntil ? { scheduledFor: result.deferUntil } : {}) },
      'queued',
    );
    return { sent: false as const, deferred: true as const, result, message: held ?? message };
  }
  if (!result.eligible) {
    const blocked = await ctx.store.recordMessageEvent(message.id, { status: 'blocked', statusReason: result.reasons.join(' ').slice(0, 1000), dispatchDecisionId: decision.id }, 'queued');
    return { sent: false as const, result, message: blocked ?? message };
  }
  const claimed = await ctx.store.recordMessageEvent(message.id, { status: 'sending', dispatchDecisionId: decision.id }, 'queued');
  if (!claimed) return { sent: false as const, result, message, duplicate: true as const };
  const providerMessageId = `sim_${globalThis.crypto.randomUUID()}`;
  await ctx.store.recordMessageEvent(message.id, { status: 'sent', provider: 'simulated', providerMessageId }, 'sending');
  const delivered = (await ctx.store.recordMessageEvent(message.id, { status: 'delivered', statusReason: 'Simulated delivery — nothing was sent.' }, 'sent')) ?? claimed;
  await log(ctx, message.businessId, 'system', `Simulated ${MESSAGE_CHANNEL_LABELS[message.channel].toLowerCase()} send to ${message.recipientHint} (demo mode) — nothing was sent.`, { messageId: message.id });
  return { sent: true as const, result, message: delivered };
}

export interface DueRunSummary {
  checked: number;
  sent: number;
  deferred: number;
  blocked: number;
  /** Stopped early because sending is paused. */
  paused: boolean;
}

/**
 * Demo mode: runs every due queued message through simulateDispatch, one at a time (each one
 * re-reads what was sent, so daily limits hold within the batch). Stops at `limit`.
 */
export async function simulateDueDispatch(ctx: ServiceContext, env: MessagingEnv, limit = 10): Promise<DueRunSummary> {
  const summary: DueRunSummary = { checked: 0, sent: 0, deferred: 0, blocked: 0, paused: env.sendingPaused };
  if (env.sendingPaused) return summary;
  for (const m of dueMessages(await ctx.store.listOutreachMessages()).slice(0, limit)) {
    const r = await simulateDispatch(ctx, m, env);
    summary.checked++;
    if (r.sent) summary.sent++;
    else if ('deferred' in r) summary.deferred++;
    else if (!('duplicate' in r)) summary.blocked++;
  }
  return summary;
}

// ── Received messages ────────────────────────────────────────────────────────

/** Records a reply (simulated in demo mode, or logged by a person) and applies the opt-out rules. */
export async function recordReply(
  ctx: ServiceContext,
  input: { business: Business; point: ContactPoint; text: string; subject?: string | null; provider: 'simulated' | 'manual'; receivedAt?: string },
) {
  await requireMessagingSchema(ctx);
  const channel = channelForPoint(input.point);
  if (!channel || !input.point.valueHash) throw new StoreError('Replies are recorded against an email address or WhatsApp number.', 'invalid');
  if (input.provider === 'simulated' && ctx.store.mode !== 'demo') throw new StoreError('Simulated replies exist only in demo mode.', 'invalid');
  const text = input.text.trim();
  if (!text) throw new StoreError('Paste or type the reply.', 'invalid');
  const optOut = detectOptOut(`${input.subject ?? ''}\n${text}`);
  const sent = (await ctx.store.listOutreachMessages(input.business.id)).find((m) => m.recipientHash === input.point.valueHash && m.sentAt);
  const { message, created } = await ctx.store.createInboundMessage({
    channel,
    provider: input.provider,
    providerMessageId: `${input.provider}_${globalThis.crypto.randomUUID()}`,
    businessId: input.business.id,
    contactPointId: input.point.id,
    replyToMessageId: sent?.id ?? null,
    senderHash: input.point.valueHash,
    senderHint: input.point.hint,
    subject: channel === 'email' ? input.subject?.trim() || null : null,
    body: text.slice(0, 10_000),
    receivedAt: input.receivedAt ?? now(),
    optOut: optOut.optOut,
    optOutMatch: optOut.match,
  });
  if (created) await afterInbound(ctx, message, input.business.id);
  return message;
}

/**
 * Shared by the demo, manual logging and (on the server) webhooks: the rules' reading of the reply
 * (phase 9), a log entry, a task for a person and CRM updates; never an automatic reply.
 */
export async function afterInbound(ctx: ServiceContext, message: InboundMessage, businessId: string | null) {
  const reading = await classifyOnArrival(ctx, message);
  if (businessId) await applyArrival(ctx, message, businessId, reading);
}

export async function setInboundHandled(ctx: ServiceContext, message: InboundMessage, handled: boolean) {
  return ctx.store.updateInboundMessage(message.id, { handledAt: handled ? now() : null });
}

export const messageStatusLabel = (m: Pick<OutreachMessage, 'status'>) => MESSAGE_STATUS_META[m.status].label;
