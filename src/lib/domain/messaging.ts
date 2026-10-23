// Messaging (phases 7–8): templates, the outbound queue, received messages, approved-message
// policies and the deterministic eligibility gateway (CONTACT_PERMISSION_MODEL §5). Pure functions
// only: the same gateway runs in the browser when a person approves a message and on the server
// immediately before dispatch. Vocabularies mirror the CHECK constraints in
// supabase/migrations/006_messaging.sql and 007_sending_policy.sql.

import { MODE_META, modeAllows, type AutomationMode } from '@/lib/automation/constants';
import { CLOSED_STAGES, type Role, type Tone } from './constants';
import {
  CLASSIFICATION_LABELS,
  VALIDATION_MAX_AGE_DAYS,
  consentFor,
  dataRights,
  suppressionFor,
  SUPPRESSION_REASON_LABELS,
  validationCurrent,
  type ConsentRecord,
  type ContactPoint,
  type Suppression,
} from './contacts';
import {
  formatLocal,
  localDayBounds,
  nextSendWindow,
  recipientCaps,
  sentOnLocalDay,
  describePolicyWindow,
  type SendingPolicy,
  type SentRecord,
} from './sending-policy';
import type { OrgSettings } from './settings';
import type { Business, Timestamp } from './types';

export const GATEWAY_VERSION = 'gateway-1.1.0';

// ── Vocabularies ─────────────────────────────────────────────────────────────

export const MESSAGE_CHANNELS = ['email', 'whatsapp'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = { email: 'Email', whatsapp: 'WhatsApp' };

export const MESSAGE_PURPOSES = ['introduction', 'follow_up', 'proposal', 'reply'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];
export const MESSAGE_PURPOSE_LABELS: Record<MessagePurpose, string> = {
  introduction: 'Introduction',
  follow_up: 'Follow-up',
  proposal: 'Proposal',
  reply: 'Reply to the business',
};

export const TEMPLATE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'paused', 'disabled'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];
export const TEMPLATE_STATUS_META: Record<TemplateStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending: { label: 'In review at Meta', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  paused: { label: 'Paused', tone: 'warning' },
  disabled: { label: 'Disabled', tone: 'neutral' },
};

export const MESSAGE_STATUSES = [
  'draft',
  'approved',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'bounced',
  'complained',
  'delivery_unknown',
  'blocked',
  'cancelled',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const MESSAGE_STATUS_META: Record<MessageStatus, { label: string; tone: Tone; description: string }> = {
  draft: { label: 'Draft', tone: 'neutral', description: 'Not approved yet. Nothing has been sent.' },
  approved: { label: 'Approved', tone: 'info', description: 'Approved by a person after the eligibility check; not queued yet.' },
  queued: { label: 'Queued', tone: 'info', description: 'Waiting for dispatch. The gateway runs again immediately before sending.' },
  sending: { label: 'Sending', tone: 'warning', description: 'Handed to the provider; waiting for its answer.' },
  sent: { label: 'Sent', tone: 'accent', description: 'Accepted by the provider.' },
  delivered: { label: 'Delivered', tone: 'success', description: 'The provider reported delivery.' },
  read: { label: 'Read', tone: 'success', description: 'WhatsApp reported the message as read.' },
  failed: { label: 'Failed', tone: 'danger', description: 'The provider rejected the message; it was not delivered.' },
  bounced: { label: 'Bounced', tone: 'danger', description: 'The address rejected the email permanently; it is now suppressed.' },
  complained: { label: 'Complaint', tone: 'danger', description: 'The recipient reported the message; they are now suppressed on every channel.' },
  delivery_unknown: { label: 'Delivery unknown', tone: 'warning', description: 'The request left the server but no answer came back. It is never retried automatically; check before doing anything.' },
  blocked: { label: 'Blocked', tone: 'danger', description: 'The gateway refused it at dispatch. Nothing was sent.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', description: 'Cancelled by a person. Nothing was sent.' },
};
export const OPEN_MESSAGE_STATUSES: readonly MessageStatus[] = ['draft', 'approved', 'queued', 'sending'];
/** Statuses that count as contact made (or possibly made) with the recipient. */
export const SENT_STATUSES: readonly MessageStatus[] = ['sending', 'sent', 'delivered', 'read', 'bounced', 'complained', 'delivery_unknown'];
/** Statuses that keep the dedupe key reserved (mirrors outreach_messages_dedupe_idx). */
export const DEDUPE_RESERVED: readonly MessageStatus[] = ['queued', 'sending', 'sent', 'delivered', 'read', 'bounced', 'complained', 'delivery_unknown'];

export const MESSAGE_PROVIDERS = ['resend', 'whatsapp_cloud', 'simulated'] as const;
export type MessageProvider = (typeof MESSAGE_PROVIDERS)[number];
export type InboundProvider = MessageProvider | 'manual';
export const PROVIDER_LABELS: Record<InboundProvider, string> = { resend: 'Resend', whatsapp_cloud: 'WhatsApp Cloud API', simulated: 'Simulated (demo)', manual: 'Logged by a person' };

export type DecisionStage = 'preview' | 'approval' | 'dispatch';

/** Hours after a business's own message in which a reply needs no consent record or template. */
export const REPLY_WINDOW_HOURS: Record<MessageChannel, number> = { whatsapp: 24, email: 14 * 24 };
export const MAX_EMAIL_WORDS = 150;

// ── Records ──────────────────────────────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  organizationId: string;
  channel: MessageChannel;
  name: string;
  purpose: MessagePurpose;
  language: string;
  subject: string | null;
  body: string;
  providerTemplateName: string | null;
  providerTemplateId: string | null;
  providerCategory: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null;
  status: TemplateStatus;
  statusReason: string | null;
  statusCheckedAt: Timestamp | null;
  approvedBy: string | null;
  approvedAt: Timestamp | null;
  version: number;
  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export type TemplateInsert = Pick<MessageTemplate, 'channel' | 'name' | 'purpose' | 'language' | 'subject' | 'body' | 'providerTemplateName'>;
export type TemplatePatch = Partial<TemplateInsert & Pick<MessageTemplate, 'status' | 'statusReason'>>;

export interface OutreachMessage {
  id: string;
  organizationId: string;
  businessId: string;
  contactPointId: string | null;
  channel: MessageChannel;
  purpose: MessagePurpose;
  templateId: string | null;
  templateVersion: number | null;
  /** WhatsApp template parameters by name. */
  parameters: Record<string, string>;
  subject: string | null;
  body: string;
  /** SHA-256 of subject + newline + body (computed by the store). */
  bodyHash: string;
  /** SHA-256 of the contact point's suppression key; the address itself is not copied. */
  recipientHash: string;
  recipientHint: string;
  inReplyTo: string | null;
  status: MessageStatus;
  statusReason: string | null;
  sandbox: boolean;
  dedupeKey: string | null;
  decisionId: string | null;
  dispatchDecisionId: string | null;
  provider: MessageProvider | null;
  providerMessageId: string | null;
  createdBy: string | null;
  agentVersion: string | null;
  approvedBy: string | null;
  approvedAt: Timestamp | null;
  queuedAt: Timestamp | null;
  scheduledFor: Timestamp | null;
  sendingAt: Timestamp | null;
  sentAt: Timestamp | null;
  deliveredAt: Timestamp | null;
  readAt: Timestamp | null;
  failedAt: Timestamp | null;
  cancelledBy: string | null;
  cancelledAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export type OutreachMessageInsert = Pick<
  OutreachMessage,
  'businessId' | 'contactPointId' | 'channel' | 'purpose' | 'templateId' | 'templateVersion' | 'parameters' | 'subject' | 'body' | 'recipientHash' | 'recipientHint' | 'inReplyTo' | 'agentVersion'
>;
/** What a person may change: a draft's text, and the status moves people make. */
export type OutreachMessagePatch = Partial<Pick<OutreachMessage, 'subject' | 'body' | 'parameters' | 'status' | 'statusReason' | 'decisionId' | 'scheduledFor'>>;
/** Dispatch and delivery facts: written by the server (or the demo's simulated provider). */
export type MessageEventPatch = Partial<
  Pick<OutreachMessage, 'status' | 'statusReason' | 'dispatchDecisionId' | 'provider' | 'providerMessageId' | 'sentAt' | 'deliveredAt' | 'readAt' | 'failedAt' | 'scheduledFor'>
>;

export interface GatewayCheck {
  key: 'mode' | 'state' | 'business' | 'suppression' | 'consent' | 'contact' | 'template' | 'policy' | 'sender' | 'duplicate' | 'frequency' | 'volume' | 'schedule' | 'approval';
  passed: boolean;
  detail: string;
  /**
   * Timing failures only (dispatch stage): when the message may go instead. Null holds it until a
   * person acts (sending paused, or a channel's daily limit set to zero). Absent on failures that
   * stop the message for good.
   */
  waitUntil?: Timestamp | null;
}

export type DecisionOutcome = 'eligible' | 'blocked' | 'deferred';

export interface EligibilityDecision {
  id: string;
  organizationId: string;
  messageId: string | null;
  businessId: string | null;
  contactPointId: string | null;
  channel: MessageChannel;
  purpose: MessagePurpose;
  stage: DecisionStage;
  /** Deferred: dispatch only; every failure was a timing rule, so the message stays queued. */
  outcome: DecisionOutcome;
  sandbox: boolean;
  reasons: string[];
  checks: GatewayCheck[];
  inputs: Record<string, unknown>;
  bodyHash: string | null;
  recipientHash: string | null;
  gatewayVersion: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  createdAt: Timestamp;
}
export type DecisionInsert = Omit<EligibilityDecision, 'id' | 'organizationId' | 'createdAt'>;

export interface InboundMessage {
  id: string;
  organizationId: string;
  channel: MessageChannel;
  provider: InboundProvider;
  providerMessageId: string;
  businessId: string | null;
  contactPointId: string | null;
  replyToMessageId: string | null;
  senderHash: string;
  senderHint: string;
  subject: string | null;
  /** Null when the provider's event does not carry the text. */
  body: string | null;
  receivedAt: Timestamp;
  optOut: boolean;
  optOutMatch: string | null;
  handledAt: Timestamp | null;
  handledBy: string | null;
  createdBy: string | null;
  createdAt: Timestamp;
}
export type InboundInsert = Omit<InboundMessage, 'id' | 'organizationId' | 'createdAt' | 'createdBy' | 'handledAt' | 'handledBy'>;
export type InboundPatch = Partial<Pick<InboundMessage, 'businessId' | 'contactPointId' | 'replyToMessageId' | 'handledAt'>>;

// ── Approved-message policies ────────────────────────────────────────────────

// An owner or administrator's standing approval for one message type: one approved template at one
// version, for one purpose, with its own daily cap and an expiry. Every message that is not a reply
// inside the reply window must be covered by an active policy before it can be approved or sent;
// editing the template ends the cover. A person still approves each message in this version.

export const POLICY_STATUSES = ['active', 'paused', 'revoked'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];
export const POLICY_STATUS_META: Record<PolicyStatus, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  revoked: { label: 'Revoked', tone: 'neutral' },
};
export const POLICY_MAX_DAYS = 180;
export const POLICY_DEFAULT_DAYS = 90;
export const POLICY_DAILY_CAP_MAX = 50;

export interface MessagePolicy {
  id: string;
  organizationId: string;
  name: string;
  channel: MessageChannel;
  purpose: Exclude<MessagePurpose, 'reply'>;
  templateId: string;
  templateVersion: number;
  dailyCap: number;
  status: PolicyStatus;
  note: string | null;
  approvedBy: string | null;
  approvedAt: Timestamp;
  expiresAt: Timestamp;
  revokedBy: string | null;
  revokedAt: Timestamp | null;
  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export type MessagePolicyInsert = Pick<MessagePolicy, 'name' | 'templateId' | 'dailyCap' | 'note' | 'expiresAt'>;
export type MessagePolicyPatch = Partial<Pick<MessagePolicy, 'name' | 'dailyCap' | 'note' | 'status'>>;

/** Why a template cannot be covered by a new policy now (empty when it can). */
export function policyTemplateIssues(t: Pick<MessageTemplate, 'status' | 'purpose' | 'name'> & Parameters<typeof validateTemplate>[0]): string[] {
  const issues: string[] = [];
  if (t.status !== 'approved') issues.push(`Template “${t.name}” is ${TEMPLATE_STATUS_META[t.status].label.toLowerCase()}; only approved templates can be covered.`);
  if (t.purpose === 'reply') issues.push('Replies are answered inside the reply window and need no policy.');
  issues.push(...validateTemplate(t).errors);
  return issues;
}

/** The active, unexpired policy covering this exact template version, if any. */
export function coveringPolicy(
  message: Pick<OutreachMessage, 'channel' | 'purpose' | 'templateId' | 'templateVersion'>,
  policies: readonly MessagePolicy[],
  now: Date,
): MessagePolicy | null {
  return (
    policies.find(
      (p) =>
        p.status === 'active' &&
        p.templateId === message.templateId &&
        p.templateVersion === message.templateVersion &&
        p.channel === message.channel &&
        p.purpose === message.purpose &&
        new Date(p.expiresAt) > now,
    ) ?? null
  );
}

/** A policy the gateway would not honour, and why (for the policies list). */
export function policyIssue(p: MessagePolicy, template: MessageTemplate | null, now: Date): string | null {
  if (p.status !== 'active') return null;
  if (new Date(p.expiresAt) <= now) return 'Expired. Create a new policy to keep sending this message type.';
  if (!template) return 'The template was deleted.';
  if (template.version !== p.templateVersion) return `The template changed (now version ${template.version}); messages from the new version need a new policy.`;
  if (template.status !== 'approved') return `The template is ${TEMPLATE_STATUS_META[template.status].label.toLowerCase()}.`;
  return null;
}

// ── Templates ────────────────────────────────────────────────────────────────

export const TEMPLATE_VARIABLES = {
  business_name: 'The business’s name',
  agency_name: 'Your agency’s name (Settings → Agency)',
  sender_name: 'The name of the person approving the message',
  agency_phone: 'Your agency’s phone number',
  agency_email: 'Your agency’s email address',
  agency_website: 'Your agency’s website',
  personal_note: 'One sentence about the business, from its research, written by a person or the drafting agent and reviewed before approval',
} as const;
export type TemplateVariable = keyof typeof TEMPLATE_VARIABLES;
const VARIABLE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Variable names in order of first appearance. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]))];
}

export function renderTemplate(text: string, values: Partial<Record<string, string>>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(VARIABLE, (_, name: string) => {
    const v = values[name]?.trim();
    if (!v) missing.add(name);
    return v ?? '';
  });
  return { text: out, missing: [...missing] };
}

export function variableValues(settings: Pick<OrgSettings, 'agency'>, business: Pick<Business, 'name'>, senderName: string, personalNote = ''): Record<TemplateVariable, string> {
  return {
    business_name: business.name,
    agency_name: settings.agency.name,
    sender_name: senderName,
    agency_phone: settings.agency.phone,
    agency_email: settings.agency.email,
    agency_website: settings.agency.website,
    personal_note: personalNote,
  };
}

export const PERSONAL_NOTE_MAX_WORDS = 40;
export const PERSONAL_NOTE_MAX_CHARS = 280;
const NOTE_URL = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|org|net|gh|io|co)\b)/i;
const NOTE_CONTACT = /@|\+?\d[\d\s-]{7,}\d/;
const NOTE_NUMBERS = /\b\d+(\.\d+)?\s?(%|percent|per cent)|\b(revenue|profit|turnover|sales figures?|customers? (a|per) (day|week|month))\b/i;
const NOTE_ABSENCE = /\b(no|without( a)?|lack(s|ing)?( a)?|do(es)?n['’]?t have( a)?|missing( a)?) (official )?(website|web ?site|online presence)\b/i;
const NOTE_GUARANTEE = /\b(guarantee[ds]?|double|triple|skyrocket|boost your (sales|revenue))\b/i;

/**
 * Rules for the one-sentence personal note (human or AI): short, plain text, no prices, links,
 * contact details, figures, guarantees, pressure, or claims that the business has no website. The
 * note goes into a template a person has approved; it is reviewed again with the whole message.
 */
export function validatePersonalNote(note: string): string[] {
  const errors: string[] = [];
  const text = note.trim();
  if (!text) return ['Write the personal note, or choose a template without one.'];
  if (/[\r\n]/.test(text)) errors.push('Keep the note to one line.');
  if (text.length > PERSONAL_NOTE_MAX_CHARS || wordCount(text) > PERSONAL_NOTE_MAX_WORDS) errors.push(`Keep the note to ${PERSONAL_NOTE_MAX_WORDS} words or fewer.`);
  if (/[{}<>]/.test(text)) errors.push('The note cannot contain template variables or markup.');
  if (PRICE.test(text)) errors.push('The note cannot mention prices.');
  if (NOTE_URL.test(text) || NOTE_CONTACT.test(text)) errors.push('The note cannot contain links, addresses or phone numbers.');
  if (NOTE_NUMBERS.test(text)) errors.push('The note cannot state figures about the business (revenue, sales, percentages).');
  if (NOTE_ABSENCE.test(text)) errors.push('The note cannot say the business has no website; that is easy to get wrong in a first message.');
  if (NOTE_GUARANTEE.test(text) || PRESSURE.test(text)) errors.push('The note cannot promise results or use pressure wording.');
  return errors;
}

const PRICE = /(GH[S₵¢]|₵|\bcedis?\b|US\$|\$|\bUSD\b)\s?\d|\d[\d,.]*\s?(GH[S₵¢]|₵|\bcedis?\b|\bUSD\b)/i;
const PRESSURE = /\b(act now|limited time|last chance|urgent(ly)?|today only|hurry|don['’]t miss)\b/i;
const OPT_OUT_INSTRUCTION = /\bSTOP\b/;
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export interface TemplateValidation {
  errors: string[];
  warnings: string[];
}

/** Message quality rules (OUTREACH_COMPLIANCE §4) that can be checked mechanically. */
export function validateTemplate(t: Pick<MessageTemplate, 'channel' | 'subject' | 'body' | 'providerTemplateName' | 'purpose'>): TemplateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = `${t.subject ?? ''}\n${t.body}`;
  const unknown = templateVariables(text).filter((v) => !(v in TEMPLATE_VARIABLES));
  if (unknown.length) errors.push(`Unknown variables: ${unknown.map((v) => `{{${v}}}`).join(', ')}. Use only ${Object.keys(TEMPLATE_VARIABLES).map((v) => `{{${v}}}`).join(', ')}.`);
  if (PRICE.test(text)) errors.push('Messages do not quote prices; prices belong in an approved proposal.');
  if (PRESSURE.test(text)) warnings.push('Avoid urgency and pressure wording.');
  if (!templateVariables(t.body).includes('business_name')) warnings.push('Address the business by name ({{business_name}}).');
  if (t.channel === 'email') {
    if (!t.subject?.trim()) errors.push('An email template needs a subject.');
    if (wordCount(t.body) > MAX_EMAIL_WORDS) errors.push(`Keep emails to ${MAX_EMAIL_WORDS} words or fewer (this one has ${wordCount(t.body)}).`);
  } else {
    if (!t.providerTemplateName) errors.push('A WhatsApp template needs the template name used in your WhatsApp Business Account.');
    if (!OPT_OUT_INSTRUCTION.test(t.body)) errors.push('WhatsApp messages tell the recipient how to opt out (for example “Reply STOP to opt out”).');
  }
  return { errors, warnings };
}

/** Named body parameters for a WhatsApp template send, in order of appearance. */
export function whatsappParameters(body: string, values: Partial<Record<string, string>>): { name: string; text: string }[] {
  return templateVariables(body).map((name) => ({ name, text: values[name] ?? '' }));
}

/** The identity and opt-out block appended to every email at dispatch (never stored in the body). */
export function emailFooter(input: { agencyName: string; senderName: string; address: string; unsubscribeUrl: string; reply: boolean }) {
  const why = input.reply ? `you wrote to ${input.agencyName}` : `you agreed to hear from ${input.agencyName}`;
  return [
    '—',
    `${input.senderName}, ${input.agencyName}`,
    input.address,
    `You are receiving this email because ${why}. To stop receiving emails from us, reply STOP or unsubscribe here: ${input.unsubscribeUrl}`,
  ].join('\n');
}

/** Identity details the agency profile must have before a channel can be used. */
export function agencyIdentityIssues(settings: Pick<OrgSettings, 'agency'>, channel: MessageChannel): string[] {
  const issues: string[] = [];
  if (!settings.agency.name.trim()) issues.push('Add your agency name in Settings → Agency; every message names the sender.');
  if (channel === 'email' && !settings.agency.address.trim()) issues.push('Add your agency’s postal address in Settings → Agency; marketing emails include it.');
  return issues;
}

// ── Received messages ────────────────────────────────────────────────────────

// Deterministic opt-out rules (OUTREACH_COMPLIANCE §3). A whole-message keyword or one of the
// phrases anywhere. Local-language equivalents are added here once the team has agreed them.
const OPT_OUT_KEYWORDS = new Set(['stop', 'stop all', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'opt out', 'optout', 'remove', 'remove me']);
const OPT_OUT_PHRASES = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bstop (messaging|texting|sending|contacting|emailing|calling)\b/i,
  /\b(do not|don['’]?t|dont) (contact|message|text|email|call|send)\b/i,
  /\bremove (me|us|my (number|email|address))\b/i,
  /\btake (me|us) off\b/i,
  /\bno more (messages|emails)\b/i,
];

export function detectOptOut(text: string | null | undefined): { optOut: boolean; match: string | null } {
  if (!text) return { optOut: false, match: null };
  const whole = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (OPT_OUT_KEYWORDS.has(whole)) return { optOut: true, match: whole.toUpperCase() };
  for (const re of OPT_OUT_PHRASES) {
    const m = text.match(re);
    if (m) return { optOut: true, match: m[0].slice(0, 60) };
  }
  return { optOut: false, match: null };
}

// ── Delivery ─────────────────────────────────────────────────────────────────

export type DeliveryEvent = 'sent' | 'delivered' | 'read' | 'failed' | 'bounced' | 'complained' | 'delayed';
const POSITIVE: Partial<Record<MessageStatus, number>> = { sent: 1, delivered: 2, read: 3 };

/**
 * The status a provider event moves a message to, or null when it changes nothing. Events arrive
 * out of order and more than once, so a status only moves forward; a complaint overrides delivery.
 */
export function deliveryTransition(current: MessageStatus, event: DeliveryEvent): MessageStatus | null {
  const open = current === 'sending' || current === 'delivery_unknown';
  switch (event) {
    case 'delayed':
      return null;
    case 'complained':
      return open || current in POSITIVE ? 'complained' : null;
    case 'bounced':
      return open || current === 'sent' || current === 'delivered' ? 'bounced' : null;
    case 'failed':
      return open || current === 'sent' ? 'failed' : null;
    default: {
      if (open) return event;
      const rank = POSITIVE[current];
      return rank !== undefined && POSITIVE[event]! > rank ? event : null;
    }
  }
}

// ── Eligibility gateway ──────────────────────────────────────────────────────

export interface GatewayContext {
  stage: DecisionStage;
  now: Date;
  business: Business;
  /** The contact point the message was drafted for, as stored now (null if deleted). */
  point: ContactPoint | null;
  template: MessageTemplate | null;
  consents: ConsentRecord[];
  suppressions: Suppression[];
  /** Messages received from this recipient. */
  inbound: InboundMessage[];
  /** Other messages to this recipient (for duplicates). */
  history: OutreachMessage[];
  mode: AutomationMode;
  outboundStopped: boolean;
  /** public.outbound_available(): false in this version. */
  outboundAvailable: boolean;
  /** Recipient hashes of the agency's own sandbox test addresses (server environment; demo settings). */
  testRecipientHashes: readonly string[];
  /** Sender configuration problems for the message's channel. */
  senderIssues: readonly string[];
  /** Approval stage: the role of the person approving. */
  approverRole?: Role | null;
  /** Phase 8: the workspace's sending policy and pause switch. */
  sendingPolicy: SendingPolicy;
  sendingPaused: boolean;
  /** Approved-message policies (all statuses; the gateway picks the one that covers the message). */
  policies: readonly MessagePolicy[];
  /** Every message in the workspace that reached sending (daily limits and per-policy caps). */
  outbound: readonly SentRecord[];
}

export interface GatewayResult {
  eligible: boolean;
  outcome: DecisionOutcome;
  /** Deferred: when to try again (already inside a sending window). Null holds it until a person acts. */
  deferUntil: Timestamp | null;
  sandbox: boolean;
  checks: GatewayCheck[];
  reasons: string[];
  inputs: Record<string, unknown>;
}

type GatewayMessage = Pick<
  OutreachMessage,
  | 'id'
  | 'businessId'
  | 'contactPointId'
  | 'channel'
  | 'purpose'
  | 'templateId'
  | 'templateVersion'
  | 'bodyHash'
  | 'recipientHash'
  | 'status'
  | 'approvedBy'
  | 'approvedAt'
  | 'inReplyTo'
  | 'scheduledFor'
>;

/** The latest provider-received message from the recipient on the channel inside the reply window. */
export function replyWindow(message: Pick<OutreachMessage, 'channel' | 'recipientHash'>, inbound: InboundMessage[], now: Date): InboundMessage | null {
  const since = now.getTime() - REPLY_WINDOW_HOURS[message.channel] * 3_600_000;
  return (
    inbound
      .filter((m) => m.channel === message.channel && m.senderHash === message.recipientHash && m.provider !== 'manual' && !m.optOut && new Date(m.receivedAt).getTime() >= since)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0] ?? null
  );
}

const hours = (n: number) => (n % 24 === 0 ? `${n / 24} days` : `${n} hours`);

/**
 * Every check from CONTACT_PERMISSION_MODEL §5. Deterministic: the same inputs give the same
 * decision, and nothing here can be overridden by an agent. Timing rules (schedule, quiet hours,
 * sending days, pause, daily limits, per-recipient spacing) only defer a message at dispatch; at
 * preview and approval they are reported as information, because approving at night is fine.
 */
export function checkEligibility(message: GatewayMessage, ctx: GatewayContext): GatewayResult {
  const checks: GatewayCheck[] = [];
  const add = (key: GatewayCheck['key'], failures: string[], passDetail: string) => {
    if (failures.length) for (const detail of failures) checks.push({ key, passed: false, detail });
    else checks.push({ key, passed: true, detail: passDetail });
  };
  const dispatch = ctx.stage === 'dispatch';
  const policy = ctx.sendingPolicy;
  const tz = policy.timezone;
  const when = (d: Date) => formatLocal(d, tz);
  // Timing rule: a deferral at dispatch, information before.
  const wait = (key: GatewayCheck['key'], waits: { detail: string; until: Date | null }[], passDetail: string) => {
    if (!waits.length) return checks.push({ key, passed: true, detail: passDetail });
    for (const w of waits) {
      const until = w.until ? nextSendWindow(w.until, policy) : null;
      const tail = until ? ` It waits until ${when(until)}.` : ' It waits until a person acts.';
      if (dispatch) checks.push({ key, passed: false, detail: `${w.detail}${tail}`, waitUntil: until?.toISOString() ?? null });
      else checks.push({ key, passed: true, detail: `At dispatch: ${w.detail}${tail.replace('It waits', 'It would wait')}` });
    }
  };
  const b = ctx.business;
  const point = ctx.point;
  const channelLabel = MESSAGE_CHANNEL_LABELS[message.channel];
  // Mid-sentence: “email” but “WhatsApp”.
  const channelWord = message.channel === 'email' ? 'email' : 'WhatsApp';

  // 1. Mode and emergency stop. Sandbox tests go only to the agency's own configured addresses.
  const sandbox = ctx.testRecipientHashes.includes(message.recipientHash);
  const mode: string[] = [];
  if (!sandbox) {
    if (!ctx.outboundAvailable) mode.push('Sending to businesses is not available in this version; only sandbox test recipients can receive messages.');
    if (!modeAllows(ctx.mode, 'approval_based_outreach')) mode.push(`The workspace is in ${MODE_META[ctx.mode].label} mode; messages to businesses need Approval-based outreach.`);
    if (ctx.outboundStopped) mode.push('The outbound emergency stop is engaged.');
  }
  add('mode', mode, sandbox ? 'Sandbox test recipient (one of the agency’s own test addresses); messages to businesses stay blocked.' : 'Outreach mode is on and the emergency stop is lifted.');

  // Status the stage expects.
  const expected = ctx.stage === 'dispatch' ? 'queued' : 'draft';
  add('state', message.status === expected ? [] : [`The message is ${MESSAGE_STATUS_META[message.status].label.toLowerCase()}; this check needs a ${expected} message.`], `The message is ${expected}.`);

  // 2. The business.
  const business: string[] = [];
  if (b.contactPermission === 'opted_out') business.push('The business opted out of all contact.');
  if (CLOSED_STAGES.includes(b.stage) && b.stage !== 'won') business.push('The prospect is closed or archived.');
  if (b.mergedIntoId) business.push('The prospect was merged into another record.');
  if (b.id !== message.businessId) business.push('The message belongs to a different prospect.');
  add('business', business, 'The business has not opted out and the prospect is open.');

  // Suppression always takes precedence: business, address and (for email) domain.
  const target = { businessId: b.id, type: message.channel === 'email' ? ('email' as const) : ('whatsapp' as const), valueHash: message.recipientHash, domainHash: point?.domainHash ?? null };
  const suppressed = suppressionFor(target, ctx.suppressions, message.channel);
  add('suppression', suppressed ? [`On the suppression list (${SUPPRESSION_REASON_LABELS[suppressed.reason].toLowerCase()}, ${suppressed.hint}).`] : [], 'Not on the suppression list.');

  // 3. Consent, or a reply inside the window the business opened by writing to us.
  const consent = consentFor(b.id, message.channel, point?.id ?? message.contactPointId, ctx.consents, ctx.now);
  const window = message.purpose === 'reply' ? replyWindow(message, ctx.inbound, ctx.now) : null;
  const consentFailures: string[] = [];
  if (consent.state === 'withdrawn') consentFailures.push('Consent was withdrawn.');
  else if (consent.state !== 'granted' && !window) {
    consentFailures.push(consent.state === 'expired' ? 'Consent has expired; ask the business to confirm it again.' : `No ${channelWord} consent on file.`);
    if (message.purpose === 'reply') consentFailures.push(`A reply without consent must answer a message the business sent in the last ${hours(REPLY_WINDOW_HOURS[message.channel])}.`);
  }
  if (consent.state === 'granted' && b.contactPermission !== 'granted') consentFailures.push('Business-level permission is not recorded as granted.');
  add(
    'consent',
    consentFailures,
    consent.state === 'granted' ? `${channelLabel} consent on file (captured ${consent.record!.capturedAt.slice(0, 10)}).` : `Reply to the business’s message of ${window?.receivedAt.slice(0, 16).replace('T', ' ')}.`,
  );

  // 4. The contact point.
  const contact: string[] = [];
  if (!point) contact.push('The contact point was deleted or is not recorded.');
  else {
    if (point.valueHash !== message.recipientHash) contact.push('The contact detail changed after drafting; draft the message again.');
    if ((message.channel === 'email' && point.type !== 'email') || (message.channel === 'whatsapp' && point.type !== 'whatsapp')) contact.push(`The contact point is not ${message.channel === 'email' ? 'an email address' : 'a WhatsApp number'}.`);
    if (point.classification !== 'verified_business_channel' && point.classification !== 'source_confirmed') contact.push(`The contact point is ${CLASSIFICATION_LABELS[point.classification].toLowerCase()}.`);
    else if (!validationCurrent(point, ctx.now)) contact.push(`Not validated in the last ${VALIDATION_MAX_AGE_DAYS} days.`);
    if (dataRights(point) !== 'permitted') contact.push('Data rights for this source are not confirmed.');
  }
  add('contact', contact, 'Usable, recently validated contact point with permitted data rights.');

  // 5. Channel rules: approved template (or a reply inside the window) and a configured sender.
  const template: string[] = [];
  const t = ctx.template;
  if (message.templateId) {
    if (!t || t.id !== message.templateId) template.push('The template was deleted.');
    else {
      if (t.channel !== message.channel) template.push('The template is for a different channel.');
      if (t.status !== 'approved') template.push(`Template “${t.name}” is ${TEMPLATE_STATUS_META[t.status].label.toLowerCase()}.`);
      if (t.version !== message.templateVersion) template.push('The template changed after this message was drafted; draft it again.');
      template.push(...validateTemplate(t).errors);
    }
  } else if (!(message.purpose === 'reply' && window)) {
    template.push(message.channel === 'whatsapp' ? 'Business-initiated WhatsApp messages use a template approved by Meta.' : 'Messages that do not reply to the business use an approved template.');
  }
  add('template', template, t ? `Approved template “${t.name}” (version ${t.version}).` : 'Free-text reply inside the reply window.');

  // Approved-message policy: an owner's or admin's standing approval for this message type.
  const freeReply = !message.templateId && message.purpose === 'reply' && window;
  const cover = message.templateId ? coveringPolicy(message, ctx.policies, ctx.now) : null;
  add(
    'policy',
    freeReply || cover
      ? []
      : [
          message.templateId
            ? `No active message policy covers ${t ? `“${t.name}” (version ${message.templateVersion})` : 'this template'} for ${MESSAGE_PURPOSE_LABELS[message.purpose].toLowerCase()}s. An owner or administrator sets one in Outreach → Policies.`
            : 'Messages that do not reply to the business need a template covered by a message policy.',
        ],
    cover ? `Covered by policy “${cover.name}” until ${cover.expiresAt.slice(0, 10)}.` : 'Reply inside the reply window; no message policy needed.',
  );
  add('sender', [...ctx.senderIssues], `${channelLabel} sender configured.`);

  // 6. No duplicate of a message already queued or sent to this recipient.
  const duplicate = ctx.history.find((m) => m.id !== message.id && m.recipientHash === message.recipientHash && m.bodyHash === message.bodyHash && DEDUPE_RESERVED.includes(m.status));
  add('duplicate', duplicate ? ['The same text was already queued or sent to this recipient.'] : [], 'Not a duplicate.');

  // 7. Per-recipient frequency: follow-up limits stop a message; spacing makes it wait.
  // Counted like the database backstop: only messages that reached sending.
  const caps = recipientCaps(message, ctx.history.filter((m) => SENT_STATUSES.includes(m.status)), ctx.inbound.map((m) => m.receivedAt), policy, ctx.now);
  if (caps.blocking.length || !caps.waits.length) add('frequency', caps.blocking, message.purpose === 'reply' ? 'Replies to the business are not frequency-capped.' : 'Within the per-recipient limits.');
  if (caps.waits.length) wait('frequency', caps.waits, '');

  // 8. Workspace volume: daily limit per channel, and the policy's own daily cap.
  const volume: { detail: string; until: Date | null }[] = [];
  const nextDay = localDayBounds(ctx.now, tz).end;
  const limit = policy.dailyLimit[message.channel];
  const today = sentOnLocalDay(ctx.outbound, ctx.now, tz, (r) => r.id !== message.id && r.channel === message.channel);
  if (limit === 0) volume.push({ detail: `${channelLabel} sending is set to 0 messages a day.`, until: null });
  else if (today >= limit) volume.push({ detail: `${today} ${channelWord} message${today === 1 ? '' : 's'} sent today (daily limit ${limit}).`, until: nextDay });
  if (cover) {
    const underPolicy = sentOnLocalDay(ctx.outbound, ctx.now, tz, (r) => r.id !== message.id && r.templateId === cover.templateId);
    if (underPolicy >= cover.dailyCap) volume.push({ detail: `${underPolicy} sent today under policy “${cover.name}” (its daily cap is ${cover.dailyCap}).`, until: nextDay });
  }
  wait('volume', volume, `${today} of ${limit} ${channelWord} messages sent today.`);

  // 9. When: pause switch, the requested time, quiet hours and sending days.
  const timing: { detail: string; until: Date | null }[] = [];
  if (ctx.sendingPaused) timing.push({ detail: 'Sending is paused for this workspace.', until: null });
  if (message.scheduledFor && new Date(message.scheduledFor) > ctx.now) timing.push({ detail: `Scheduled for ${when(new Date(message.scheduledFor))}.`, until: new Date(message.scheduledFor) });
  const window_ = nextSendWindow(ctx.now, policy);
  if (window_ > ctx.now) timing.push({ detail: `Outside the sending window (${describePolicyWindow(policy)}).`, until: window_ });
  wait('schedule', timing, `Inside the sending window (${describePolicyWindow(policy)}).`);

  // 10. A person approves; dispatch needs that approval, and a recent one.
  const approval: string[] = [];
  if (ctx.stage === 'approval' && ctx.approverRole !== 'owner' && ctx.approverRole !== 'admin') approval.push('Only owners and administrators approve messages.');
  if (dispatch && !(message.approvedBy && message.approvedAt)) approval.push('No person approved this message.');
  if (dispatch && message.approvedAt && ctx.now.getTime() - new Date(message.approvedAt).getTime() > policy.approvalMaxAgeDays * 86_400_000) {
    approval.push(`Approved more than ${policy.approvalMaxAgeDays} days ago; cancel it and approve a fresh draft.`);
  }
  add('approval', approval, ctx.stage === 'preview' ? 'An owner or administrator still has to approve it.' : 'Approved by a person.');

  const failed = checks.filter((c) => !c.passed);
  const reasons = failed.map((c) => c.detail);
  const outcome: DecisionOutcome = !failed.length ? 'eligible' : failed.some((c) => c.waitUntil === undefined) ? 'blocked' : 'deferred';
  const untils = failed.map((c) => c.waitUntil);
  const deferUntil = outcome === 'deferred' && !untils.includes(null) ? untils.reduce<string>((max, u) => (u! > max ? u! : max), '') || null : null;
  return {
    eligible: outcome === 'eligible',
    outcome,
    deferUntil,
    sandbox,
    checks,
    reasons,
    inputs: {
      stage: ctx.stage,
      mode: ctx.mode,
      outboundStopped: ctx.outboundStopped,
      outboundAvailable: ctx.outboundAvailable,
      sandbox,
      consent: { state: consent.state, recordId: consent.record?.id ?? null, capturedAt: consent.record?.capturedAt ?? null, expiresAt: consent.record?.expiresAt ?? null },
      replyWindowMessageId: window?.id ?? null,
      suppressionId: suppressed?.id ?? null,
      contact: point ? { id: point.id, classification: point.classification, validatedAt: point.validatedAt, sourceType: point.sourceType } : null,
      template: t ? { id: t.id, status: t.status, version: t.version } : null,
      senderIssues: ctx.senderIssues.length,
      duplicateOf: duplicate?.id ?? null,
      approverRole: ctx.approverRole ?? null,
      businessPermission: b.contactPermission,
      policyId: cover?.id ?? null,
      sendingPolicy: policy,
      sendingPaused: ctx.sendingPaused,
      sentToday: { channel: today, limit },
      scheduledFor: message.scheduledFor,
      deferUntil,
      checkedAt: ctx.now.toISOString(),
    },
  };
}

/** What the store needs to record a decision. */
export function decisionRecord(message: GatewayMessage, result: GatewayResult, stage: DecisionStage, actor: { type: EligibilityDecision['actorType']; id: string | null }): DecisionInsert {
  return {
    messageId: message.id,
    businessId: message.businessId,
    contactPointId: message.contactPointId,
    channel: message.channel,
    purpose: message.purpose,
    stage,
    outcome: result.outcome,
    sandbox: result.sandbox,
    reasons: result.reasons,
    checks: result.checks,
    inputs: result.inputs,
    bodyHash: message.bodyHash,
    recipientHash: message.recipientHash,
    gatewayVersion: GATEWAY_VERSION,
    actorType: actor.type,
    actorId: actor.id,
  };
}

/** SHA-256 hex of the text the database hashes for body_hash (subject, newline, body). */
export function bodyHashInput(subject: string | null, body: string) {
  return `${subject ?? ''}\n${body}`;
}

/** The dedupe key the database stamps when a message is queued. */
export function dedupeKeyInput(organizationId: string, message: Pick<OutreachMessage, 'channel' | 'recipientHash' | 'bodyHash'>) {
  return `${organizationId}:${message.channel}:${message.recipientHash}:${message.bodyHash}`;
}
