// From reply to client (phase 9): proposal change requests, the deterministic follow-up plan (tasks
// for people, never scheduled messages) and the meeting brief. Everything here reads stored records
// only; nothing is estimated or invented, and commercial terms stay with owners and admins.

import { PROPOSAL_STATUS_META, STAGE_LABELS, WEBSITE_STATUS_META, type Tone } from './constants';
import type { EvidencePack } from './evidence';
import { MESSAGE_CHANNEL_LABELS, SENT_STATUSES, type InboundMessage, type OutreachMessage } from './messaging';
import { HOT_INTENTS, REPLY_INTENT_META, replyTaskTitle, type ReplyClassification } from './replies';
import type { ReportContent } from './report';
import type { Activity, Business, Proposal, Task } from './types';

// ── Change requests ──────────────────────────────────────────────────────────

export const CHANGE_KINDS = ['price', 'scope', 'timeline', 'payment_terms', 'contract_terms', 'other'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  price: 'Price or discount',
  scope: 'Scope (add or remove work)',
  timeline: 'Timeline',
  payment_terms: 'Payment terms',
  contract_terms: 'Contract terms',
  other: 'Other',
};

export const CHANGE_STATUSES = ['open', 'approved', 'declined', 'withdrawn'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_STATUS_META: Record<ChangeStatus, { label: string; tone: Tone }> = {
  open: { label: 'Awaiting decision', tone: 'warning' },
  approved: { label: 'Agreed', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export interface ChangeRequest {
  id: string;
  organizationId: string;
  proposalId: string;
  businessId: string | null;
  inboundMessageId: string | null;
  kind: ChangeKind;
  summary: string;
  status: ChangeStatus;
  decisionNote: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type ChangeRequestInsert = Pick<ChangeRequest, 'proposalId' | 'inboundMessageId' | 'kind' | 'summary'>;
export type ChangeRequestPatch = Pick<ChangeRequest, 'status' | 'decisionNote'>;

/**
 * Why a proposal cannot be recorded as accepted yet (mirrors guard_proposal_acceptance): an open
 * change request, or an agreed change that has not been written into a revised, re-approved proposal.
 */
export function acceptanceBlockers(proposal: Pick<Proposal, 'id' | 'approvedAt'>, requests: readonly ChangeRequest[]): string[] {
  const mine = requests.filter((r) => r.proposalId === proposal.id);
  const out: string[] = [];
  const open = mine.filter((r) => r.status === 'open').length;
  if (open) out.push(`Decide the ${open === 1 ? 'open change request' : `${open} open change requests`} before recording acceptance.`);
  if (mine.some((r) => r.status === 'approved' && (!proposal.approvedAt || (r.decidedAt ?? '') > proposal.approvedAt))) {
    out.push('An agreed change is not in the proposal yet: revise it, approve it again and issue it before recording acceptance.');
  }
  return out;
}

// ── Follow-up plan ───────────────────────────────────────────────────────────

export const FOLLOW_UP_VERSION = 'follow-up-1.0.0';

export interface PlannedTask {
  /** Stable per situation, so the plan never opens the same task twice. */
  title: string;
  dueDate: string;
  reason: string;
}

export interface FollowUpInput {
  business: Business;
  messages: readonly OutreachMessage[];
  inbound: readonly InboundMessage[];
  classifications: ReadonlyMap<string, ReplyClassification>;
  proposals: readonly Proposal[];
  activities: readonly Activity[];
  tasks: readonly Task[];
  changeRequests: readonly ChangeRequest[];
  maxUnansweredFollowUps: number;
  recipientMinGapDays: number;
  now: Date;
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - new Date(from).getTime()) / DAY);

/**
 * What a person should do next for one prospect, as tasks. The plan never schedules a message: a
 * follow-up is a task to draft one (which the gateway then checks), and silence is never interest.
 */
export function planFollowUps(input: FollowUpInput): PlannedTask[] {
  const { business: b, now } = input;
  const today = isoDay(now);
  const plan: PlannedTask[] = [];
  if (b.contactPermission === 'opted_out' || ['won', 'lost', 'archived'].includes(b.stage)) return plan;

  const sent = input.messages.filter((m) => m.businessId === b.id && m.sentAt && SENT_STATUSES.includes(m.status)).sort((x, y) => x.sentAt!.localeCompare(y.sentAt!));
  const replies = input.inbound.filter((m) => m.businessId === b.id).sort((x, y) => x.receivedAt.localeCompare(y.receivedAt));
  const lastReply = replies.at(-1) ?? null;
  const reading = (m: InboundMessage) => input.classifications.get(m.id)?.intent ?? null;

  // Unanswered hot replies: today, under the same title as the alert task the reply created.
  for (const m of replies.filter((r) => !r.handledAt)) {
    const intent = reading(m);
    const title = intent && HOT_INTENTS.includes(intent) ? replyTaskTitle(intent, m) : null;
    if (intent && title) plan.push({ title, dueDate: today, reason: REPLY_INTENT_META[intent].next });
  }

  // Silence after our last message: a follow-up task, or a stop.
  const last = sent.at(-1);
  if (last && (!lastReply || lastReply.receivedAt < last.sentAt!)) {
    const waited = daysBetween(last.sentAt!, now);
    if (waited >= input.recipientMinGapDays) {
      const unanswered = sent.filter((m) => m.purpose === 'follow_up' && (!lastReply || m.sentAt! > lastReply.receivedAt)).length;
      if (unanswered >= input.maxUnansweredFollowUps) {
        plan.push({
          title: `Stop messaging ${b.name}: no reply after ${unanswered + 1} messages`,
          dueDate: today,
          reason: `The sending policy allows ${input.maxUnansweredFollowUps} follow-up${input.maxUnansweredFollowUps === 1 ? '' : 's'} without a reply. Leave it, or mark the prospect lost.`,
        });
      } else {
        plan.push({
          title: `Decide on a follow-up to ${b.name} (no reply since ${last.sentAt!.slice(0, 10)})`,
          dueDate: today,
          reason: 'No reply is not interest. If a follow-up is still appropriate, draft one from an approved template; the gateway checks consent, spacing and limits.',
        });
      }
    }
  }

  // "Not now": check back in about a month, by hand.
  if (lastReply && reading(lastReply) === 'not_now') {
    const due = new Date(new Date(lastReply.receivedAt).getTime() + 30 * DAY);
    plan.push({ title: `Check back with ${b.name} (they said not now on ${lastReply.receivedAt.slice(0, 10)})`, dueDate: isoDay(due), reason: 'Do not message before then unless they write first.' });
  }

  // Interest without a meeting: arrange one (an open meeting request already has its own task).
  const interested = replies.some((m) => reading(m) === 'interested' || (reading(m) === 'meeting_request' && m.handledAt));
  const meetings = input.activities.filter((a) => a.businessId === b.id && a.type === 'meeting');
  if (interested && !meetings.length && b.stage !== 'discovery_meeting') {
    plan.push({ title: `Arrange a discovery meeting with ${b.name}`, dueDate: today, reason: 'They showed interest. Agree a time, log it as a meeting and use the meeting brief.' });
  }

  // Proposals.
  const mine = input.proposals.filter((p) => p.businessId === b.id);
  const met = meetings.some((a) => new Date(a.scheduledFor ?? a.occurredAt) <= now);
  if (met && !mine.some((p) => p.status !== 'withdrawn' && p.status !== 'declined')) {
    plan.push({ title: `Prepare a proposal for ${b.name} after the meeting`, dueDate: today, reason: 'Draft it from the report and the meeting notes; prices come only from your packages and price list.' });
  }
  for (const p of mine) {
    if (p.status === 'approved' && p.approvedAt && daysBetween(p.approvedAt, now) >= 3) {
      plan.push({ title: `Issue or withdraw the approved proposal “${p.title}”`, dueDate: today, reason: 'It was approved more than three days ago and has not been issued.' });
    }
    if (p.status === 'sent' && p.sentAt && daysBetween(p.sentAt, now) >= 7 && !replies.some((m) => m.receivedAt > p.sentAt!)) {
      plan.push({ title: `Ask ${b.name} about the proposal sent on ${p.sentAt.slice(0, 10)}`, dueDate: today, reason: 'No reply in a week. A call or a message from an approved follow-up template; never a new price without approval.' });
    }
  }
  for (const r of input.changeRequests.filter((c) => c.businessId === b.id && c.status === 'open' && daysBetween(c.createdAt, now) >= 2)) {
    const p = mine.find((x) => x.id === r.proposalId);
    plan.push({ title: `Decide the change request on “${p?.title ?? 'the proposal'}”`, dueDate: today, reason: 'An owner or admin approves or declines it; the client is waiting.' });
  }

  // Never twice: skip anything already open as a task.
  const open = new Set(input.tasks.filter((t) => t.businessId === b.id && !t.completedAt).map((t) => t.title));
  const seen = new Set<string>();
  return plan.filter((t) => !open.has(t.title) && !seen.has(t.title) && seen.add(t.title));
}

// ── Meeting brief ────────────────────────────────────────────────────────────

export interface MeetingBrief {
  title: string;
  generatedAt: string;
  overview: { label: string; value: string }[];
  known: { text: string; evidence: string[] }[];
  website: string;
  conversation: { at: string; channel: string; intent: string; summary: string | null }[];
  proposal: { title: string; status: string; total: string | null; validUntil: string | null; openChanges: number } | null;
  questions: string[];
  agenda: string[];
  cautions: string[];
}

const money = (n: number | null, currency: string) => (n == null ? null : `${currency} ${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`);

/**
 * A one-page brief for a meeting, assembled only from records: report statements a source supports,
 * the website position as recorded, the conversation so far and the issued proposal. What is not
 * known becomes a question, never a statement.
 */
export function meetingBrief(input: {
  business: Business;
  pack: EvidencePack;
  report: ReportContent | null;
  proposals: readonly Proposal[];
  inbound: readonly InboundMessage[];
  classifications: ReadonlyMap<string, ReplyClassification>;
  changeRequests: readonly ChangeRequest[];
  now: Date;
}): MeetingBrief {
  const { business: b, report } = input;
  const statements = report
    ? [report.businessOverview, report.researchSummary, report.websiteFindings, report.digitalPresence].flatMap((s) => s.statements)
    : [];
  const known = statements
    .filter((s) => (s.kind === 'verified_fact' || s.kind === 'evidence_supported') && s.evidenceIds.length)
    .slice(0, 8)
    .map((s) => ({ text: s.text, evidence: s.evidenceIds }));
  const proposal = [...input.proposals].filter((p) => p.businessId === b.id && p.status !== 'withdrawn').sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0] ?? null;
  const conversation = input.inbound
    .filter((m) => m.businessId === b.id)
    .sort((x, y) => y.receivedAt.localeCompare(x.receivedAt))
    .slice(0, 5)
    .map((m) => {
      const c = input.classifications.get(m.id);
      return { at: m.receivedAt, channel: MESSAGE_CHANNEL_LABELS[m.channel], intent: c ? REPLY_INTENT_META[c.intent].label : 'Not classified', summary: c?.summary ?? null };
    });

  const questions = [
    ...(report?.limitations ?? []).map((l) => `${l.item}${l.howToConfirm ? ` (${l.howToConfirm})` : ''}`),
    ...input.pack.unknowns,
    'Who decides, and who else should be involved?',
    'What would make this worthwhile for them in the next three months?',
  ];
  const website = b.websiteStatus === 'none_found'
    ? 'No official website was found after documented checks. Ask how customers find them online today; do not tell them they have no website.'
    : b.websiteStatus === 'unverified'
      ? 'The website position is not verified. Ask, rather than assume.'
      : `Recorded as: ${WEBSITE_STATUS_META[b.websiteStatus].label}${b.officialWebsite ? ` (${b.officialWebsite})` : ''}.`;

  return {
    title: `Meeting brief: ${b.name}`,
    generatedAt: input.now.toISOString(),
    overview: [
      { label: 'Business', value: [b.name, b.category, [b.neighborhood, b.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ') },
      { label: 'Stage', value: STAGE_LABELS[b.stage] },
      { label: 'Contact permission', value: b.contactPermission === 'granted' ? 'Granted (recorded)' : b.contactPermission === 'opted_out' ? 'Opted out: do not contact' : 'Not recorded' },
      { label: 'Recorded needs', value: b.serviceNeeds.length ? b.serviceNeeds.join(', ') : 'None recorded yet' },
    ],
    known,
    website,
    conversation,
    proposal: proposal
      ? {
          title: proposal.title,
          status: PROPOSAL_STATUS_META[proposal.status].label,
          total: proposal.status === 'draft' ? null : money(proposal.oneTimeTotal, proposal.currency),
          validUntil: proposal.content.validUntil,
          openChanges: input.changeRequests.filter((r) => r.proposalId === proposal.id && r.status === 'open').length,
        }
      : null,
    questions: [...new Set(questions)].slice(0, 10),
    agenda: [
      'Thank them for their time and confirm how long they have.',
      'Their goals, customers and how they get enquiries today.',
      'What we noticed (only the points above), and what they think.',
      proposal && proposal.status !== 'draft' ? 'Walk through the issued proposal: scope, phases, payments.' : 'Options and rough scope; a proposal follows after the meeting.',
      'Agree the next step and who does what.',
    ],
    cautions: [
      'Quote only prices from an issued proposal or your price list. Any discount, change of scope or terms is recorded as a change request for an owner or admin.',
      'Do not promise results (more sales, rankings, customers).',
      'Do not state anything about the business that is not listed above; ask instead.',
      'Do not agree to custom contract terms in the meeting.',
    ],
  };
}
