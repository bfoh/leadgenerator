// Replies and conversion (phase 9), shared by demo and cloud mode, the agents and the server's
// webhooks: what a received message means, the interested-lead alerts and CRM updates it causes, the
// follow-up plan, the meeting brief and proposal change requests. Nothing here sends a message, lifts
// a suppression or decides commercial terms: replies become tasks for people, and change requests
// wait for an owner or admin. Activity entries carry masked hints and intent labels, never message text.

import { z } from 'zod';
import {
  CHANGE_KIND_LABELS,
  CHANGE_KINDS,
  CHANGE_STATUS_META,
  meetingBrief,
  planFollowUps,
  type ChangeRequest,
  type ChangeStatus,
  type MeetingBrief,
  type PlannedTask,
} from '@/lib/domain/conversion';
import { INTEREST_LABELS, type Role } from '@/lib/domain/constants';
import { MESSAGE_CHANNEL_LABELS, type InboundMessage } from '@/lib/domain/messaging';
import {
  HOT_INTENTS,
  REPLY_INTENT_META,
  REPLY_INTENTS,
  RULES_VERSION,
  classifyReply,
  cleanSummary,
  replyTaskTitle,
  latestClassifications,
  reconcile,
  type AiClassification,
  type ReplyClassification,
  type ReplyIntent,
} from '@/lib/domain/replies';
import { DEFAULT_SENDING_POLICY, type SendingPolicy } from '@/lib/domain/sending-policy';
import type { Business, Proposal } from '@/lib/domain/types';
import { collectEvidence } from './report-services';
import { log, type ServiceContext } from './services';
import { CONVERSION_MIGRATION_REQUIRED, StoreError } from './store';

const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

export async function requireConversionSchema(ctx: ServiceContext) {
  if (!(await ctx.store.conversionSchemaAvailable())) throw new StoreError(CONVERSION_MIGRATION_REQUIRED, 'unavailable');
}

/** Interest a reading may record automatically: people's corrections always apply, classifiers only when fairly sure. */
const AUTO_INTEREST_CONFIDENCE = 70;

export interface Reading {
  intent: ReplyIntent;
  confidence: number;
  source: ReplyClassification['source'];
  summary: string | null;
}

/** Applies a reading to the CRM: an alert task, the interest level and the last interaction. Never contact. */
async function applyReading(ctx: ServiceContext, message: InboundMessage, business: Business, reading: Reading, opts: { arrival: boolean }) {
  const meta = REPLY_INTENT_META[reading.intent];
  const title = replyTaskTitle(reading.intent, message);
  if (title) {
    const open = (await ctx.store.listTasks()).some((t) => t.businessId === business.id && !t.completedAt && t.title === title);
    if (!open) await ctx.store.createTask({ businessId: business.id, projectId: null, title, dueDate: meta.hot || reading.intent === 'opt_out' ? today() : null, completedAt: null, assigneeId: null });
  }
  const patch: Partial<Business> = {};
  if (meta.interest && business.interestLevel !== meta.interest && (reading.source === 'person' || reading.confidence >= AUTO_INTEREST_CONFIDENCE)) patch.interestLevel = meta.interest;
  // A real reply is contact the business made; a simulated one is not.
  if (opts.arrival && message.provider !== 'simulated' && (!business.lastInteractionAt || business.lastInteractionAt < message.receivedAt)) patch.lastInteractionAt = message.receivedAt;
  if (Object.keys(patch).length) await ctx.store.updateBusiness(business.id, patch);
  if (patch.interestLevel) {
    await log(ctx, business.id, 'system', `Interest level set to ${INTEREST_LABELS[patch.interestLevel].toLowerCase()} from the reply from ${message.senderHint} (${meta.label.toLowerCase()}).`, {
      inboundId: message.id,
      intent: reading.intent,
      source: reading.source,
    });
  }
}

/**
 * Runs the deterministic rules on a message as it arrives and records the reading (when migration 008
 * is applied). Opt-outs were already suppressed by the database; this only labels them.
 */
export async function classifyOnArrival(ctx: ServiceContext, message: InboundMessage): Promise<Reading> {
  const rules = classifyReply(message);
  const reading: Reading = { intent: rules.intent, confidence: rules.confidence, source: 'rules', summary: null };
  if (await ctx.store.conversionSchemaAvailable()) {
    await ctx.store.createReplyClassification({
      inboundMessageId: message.id,
      intent: reading.intent,
      confidence: reading.confidence,
      source: 'rules',
      summary: null,
      classifierVersion: RULES_VERSION,
      model: null,
      actorType: 'system',
    });
  }
  return reading;
}

/** After a message is recorded (demo, manual logging or a webhook): the reading, a log entry, an alert task and CRM updates. */
export async function applyArrival(ctx: ServiceContext, message: InboundMessage, businessId: string, reading: Reading) {
  const label = MESSAGE_CHANNEL_LABELS[message.channel];
  if (message.optOut) {
    await log(ctx, businessId, 'permission', `Opt-out reply from ${message.senderHint} (${label}, matched “${message.optOutMatch}”). The contact is suppressed on every channel.`, { inboundId: message.id });
  } else {
    const meta = REPLY_INTENT_META[reading.intent];
    await log(
      ctx,
      businessId,
      message.provider === 'simulated' ? 'system' : message.channel,
      `${label} reply received from ${message.senderHint}${message.provider === 'simulated' ? ' (simulated)' : ''}: ${meta.label.toLowerCase()}${meta.hot ? ' — needs an answer today' : ''}.`,
      { inboundId: message.id, intent: reading.intent, confidence: reading.confidence, classifier: RULES_VERSION },
    );
  }
  const business = await ctx.store.getBusiness(businessId);
  if (business) await applyReading(ctx, message, business, reading, { arrival: true });
}

export interface ReclassifyInput {
  message: InboundMessage;
  /** Who reads it again: the rules (for messages recorded before migration 008), the AI classifier (with the rules' reading reconciled in) or a person. */
  by:
    | { kind: 'rules'; actorType: 'user' | 'agent' }
    | { kind: 'ai'; result: AiClassification; model: string; actorType: 'user' | 'agent'; version: string }
    | { kind: 'person'; intent: ReplyIntent; summary?: string | null };
}

/**
 * Records a new reading of a received message. Suppression first: a message the rules read as an
 * opt-out stays one (the database refuses anything else), and a new opt-out reading adds a
 * suppression that only an owner or admin can lift against fresh consent.
 */
export async function reclassifyReply(ctx: ServiceContext, input: ReclassifyInput): Promise<{ classification: ReplyClassification; reading: Reading; suppressed: boolean }> {
  await requireConversionSchema(ctx);
  const { message } = input;
  const rules = classifyReply(message);
  let reading: Reading;
  let classifierVersion: string;
  let model: string | null = null;
  let actorType: ReplyClassification['actorType'] = 'user';
  if (input.by.kind === 'rules') {
    reading = { intent: rules.intent, confidence: rules.confidence, source: 'rules', summary: null };
    classifierVersion = RULES_VERSION;
    actorType = input.by.actorType;
  } else if (input.by.kind === 'ai') {
    const r = reconcile(rules, input.by.result);
    reading = { ...r };
    classifierVersion = r.source === 'ai' ? input.by.version : RULES_VERSION;
    model = r.source === 'ai' ? input.by.model : null;
    actorType = input.by.actorType;
  } else {
    if (!REPLY_INTENTS.includes(input.by.intent)) throw new StoreError('Choose what the reply means.', 'invalid');
    if (rules.intent === 'opt_out' && input.by.intent !== 'opt_out') throw new StoreError('This reply is an opt-out; it cannot be classified as anything else.', 'invalid');
    reading = { intent: input.by.intent, confidence: 100, source: 'person', summary: cleanSummary(input.by.summary) };
    classifierVersion = 'person';
  }
  const previous = latestClassifications(await ctx.store.listReplyClassifications([message.id])).get(message.id) ?? null;
  const classification = await ctx.store.createReplyClassification({
    inboundMessageId: message.id,
    intent: reading.intent,
    confidence: reading.confidence,
    source: reading.source,
    summary: reading.summary,
    classifierVersion,
    model,
    actorType,
  });

  let suppressed = false;
  if (reading.intent === 'opt_out' && !message.optOut) suppressed = await suppressSender(ctx, message, reading.source);

  if (message.businessId) {
    const meta = REPLY_INTENT_META[reading.intent];
    const by =
      reading.source === 'person'
        ? `by ${ctx.userLabel}`
        : reading.source === 'ai'
          ? `by the AI classifier (${reading.confidence}%)`
          : input.by.kind === 'ai'
            ? 'by the rules (the AI reading was not confident enough)'
            : 'by the rules';
    const changed = previous && previous.intent !== reading.intent ? ` (was ${REPLY_INTENT_META[previous.intent].label.toLowerCase()})` : '';
    await log(ctx, message.businessId, 'system', `Reply from ${message.senderHint} read as ${meta.label.toLowerCase()}${changed} ${by}.${suppressed ? ' The sender is now suppressed.' : ''}`, {
      inboundId: message.id,
      intent: reading.intent,
      source: reading.source,
      classifier: classifierVersion,
    });
    const business = await ctx.store.getBusiness(message.businessId);
    if (business) await applyReading(ctx, message, business, reading, { arrival: false });
  }
  return { classification, reading, suppressed };
}

/** An opt-out read by a person or the AI (not by the rules): suppress the sender on every channel. */
async function suppressSender(ctx: ServiceContext, message: InboundMessage, source: Reading['source']) {
  const kind = message.channel === 'email' ? 'email' : 'phone';
  const existing = (await ctx.store.listSuppressions()).find((s) => !s.liftedAt && s.kind === kind && s.valueHash === message.senderHash && s.channel === null);
  if (existing) return false;
  await ctx.store.createSuppression({
    kind,
    valueHash: message.senderHash,
    businessId: null,
    channel: null,
    hint: message.senderHint,
    reason: 'opted_out',
    source: source === 'person' ? 'manual' : 'agent',
    consentRecordId: null,
    note: `The reply was read as an opt-out ${source === 'person' ? 'by a person' : source === 'ai' ? 'by the AI classifier' : 'by the opt-out rules'}.`,
  });
  return true;
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export interface LeadAlert {
  message: InboundMessage;
  classification: ReplyClassification;
}

/** Interested-lead alerts: unhandled replies whose current reading needs a person today. */
export function leadAlerts(inbound: readonly InboundMessage[], classifications: readonly ReplyClassification[]): LeadAlert[] {
  const latest = latestClassifications(classifications);
  return inbound
    .filter((m) => !m.handledAt && !m.optOut)
    .map((message) => ({ message, classification: latest.get(message.id)! }))
    .filter((a) => a.classification && HOT_INTENTS.includes(a.classification.intent))
    .sort((a, b) => b.message.receivedAt.localeCompare(a.message.receivedAt));
}

// ── Follow-up plan ───────────────────────────────────────────────────────────

async function conversationOf(ctx: ServiceContext, business: Business) {
  const conversion = await ctx.store.conversionSchemaAvailable();
  const messaging = await ctx.store.messagingSchemaAvailable();
  const [messages, inbound, proposals, activities, tasks, changeRequests] = await Promise.all([
    messaging ? ctx.store.listOutreachMessages(business.id) : [],
    messaging ? ctx.store.listInboundMessages(business.id) : [],
    ctx.store.listProposals(),
    ctx.store.listActivities(business.id),
    ctx.store.listTasks(),
    conversion ? ctx.store.listChangeRequests(business.id) : [],
  ]);
  const classifications = conversion && inbound.length ? await ctx.store.listReplyClassifications(inbound.map((m) => m.id)) : [];
  return { messages, inbound, proposals: proposals.filter((p) => p.businessId === business.id), activities, tasks, changeRequests, classifications: latestClassifications(classifications) };
}

/** What a person should do next for one prospect (no records are changed). */
export async function previewFollowUps(ctx: ServiceContext, business: Business, policy: SendingPolicy = DEFAULT_SENDING_POLICY, now = new Date()): Promise<PlannedTask[]> {
  const c = await conversationOf(ctx, business);
  return planFollowUps({ business, ...c, maxUnansweredFollowUps: policy.maxUnansweredFollowUps, recipientMinGapDays: policy.recipientMinGapDays, now });
}

/** Creates the planned tasks that are not open yet. Tasks only: a follow-up message is drafted by a person or the drafting agent and checked by the gateway. */
export async function applyFollowUps(ctx: ServiceContext, business: Business, policy: SendingPolicy = DEFAULT_SENDING_POLICY, now = new Date()) {
  const plan = await previewFollowUps(ctx, business, policy, now);
  for (const t of plan) await ctx.store.createTask({ businessId: business.id, projectId: null, title: t.title.slice(0, 200), dueDate: t.dueDate, completedAt: null, assigneeId: null });
  if (plan.length) await log(ctx, business.id, 'system', `Follow-up plan: ${plan.length} task${plan.length === 1 ? '' : 's'} added.`, { titles: plan.map((t) => t.title) });
  return plan;
}

// ── Meeting brief ────────────────────────────────────────────────────────────

export async function loadMeetingBrief(ctx: ServiceContext, business: Business, now = new Date()): Promise<MeetingBrief> {
  const [pack, reports, c] = await Promise.all([collectEvidence(ctx, business, now), ctx.store.listReports(business.id), conversationOf(ctx, business)]);
  return meetingBrief({ business, pack, report: reports[0]?.content ?? null, proposals: c.proposals, inbound: c.inbound, classifications: c.classifications, changeRequests: c.changeRequests, now });
}

// ── Change requests ──────────────────────────────────────────────────────────

export const changeRequestFormSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  summary: z.string().trim().min(5, 'Describe what the client asked to change.').max(1000),
  inboundMessageId: z.string().min(1).nullable().default(null),
});
export type ChangeRequestForm = z.input<typeof changeRequestFormSchema>;

/** What the client asked to change, recorded against an approved or issued proposal. Nothing is agreed by recording it. */
export async function recordChangeRequest(ctx: ServiceContext, proposal: Proposal, form: ChangeRequestForm) {
  await requireConversionSchema(ctx);
  if (proposal.status !== 'approved' && proposal.status !== 'sent') throw new StoreError('Change requests are recorded against an approved or issued proposal.', 'invalid');
  const f = changeRequestFormSchema.parse(form);
  const request = await ctx.store.createChangeRequest({ proposalId: proposal.id, inboundMessageId: f.inboundMessageId, kind: f.kind, summary: f.summary });
  await log(ctx, proposal.businessId, 'proposal', `Change requested (${CHANGE_KIND_LABELS[f.kind].toLowerCase()}) on “${proposal.title}”. An owner or admin decides it.`, {
    proposalId: proposal.id,
    changeRequestId: request.id,
    kind: f.kind,
  });
  return request;
}

/** Owners and admins approve or decline (with a note); the person who recorded it may withdraw it. The database checks the role again. */
export async function decideChangeRequest(ctx: ServiceContext, request: ChangeRequest, proposal: Proposal, status: Exclude<ChangeStatus, 'open'>, note: string, role: Role | null) {
  await requireConversionSchema(ctx);
  if (request.status !== 'open') throw new StoreError('This change request has been decided; record a new one.', 'invalid');
  const decides = status === 'approved' || status === 'declined';
  if (decides && role !== 'owner' && role !== 'admin') throw new StoreError('Only owners and administrators decide change requests.', 'forbidden');
  if (status === 'withdrawn' && role !== 'owner' && role !== 'admin' && request.requestedBy !== ctx.userId) {
    throw new StoreError('Only the person who recorded it, an owner or an administrator withdraws a change request.', 'forbidden');
  }
  const trimmed = note.trim();
  if (decides && !trimmed) throw new StoreError('Explain the decision.', 'invalid');
  const updated = await ctx.store.updateChangeRequest(request.id, { status, decisionNote: trimmed || null });
  const next =
    status === 'approved'
      ? proposal.status === 'draft'
        ? ' Put the change in the draft, then approve and issue it.'
        : ' Revise the proposal to include it, then approve and issue it again before recording acceptance.'
      : '';
  await log(ctx, proposal.businessId, 'proposal', `Change request ${CHANGE_STATUS_META[status].label.toLowerCase()} (${CHANGE_KIND_LABELS[request.kind].toLowerCase()}) on “${proposal.title}”.${next}`, {
    proposalId: proposal.id,
    changeRequestId: request.id,
    status,
  });
  return updated;
}

/** Days a change request has been open. */
export const openDays = (r: Pick<ChangeRequest, 'createdAt'>, now = new Date()) => Math.max(0, Math.floor((now.getTime() - new Date(r.createdAt).getTime()) / DAY));
