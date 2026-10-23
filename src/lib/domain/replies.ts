// What a reply means (phase 9). The deterministic rules run on every received message and are the
// only thing that recognises an opt-out; the optional AI classifier may refine the other intents but
// can never turn an opt-out into anything else. A person can correct a classification, except an
// opt-out. Classifications create tasks and suggestions for people; they never send anything.

import { z } from 'zod';
import type { InterestLevel, Tone } from './constants';
import { MESSAGE_CHANNEL_LABELS, detectOptOut, type InboundMessage } from './messaging';

export const REPLY_INTENTS = [
  'interested',
  'meeting_request',
  'pricing_question',
  'proposal_question',
  'more_information',
  'not_now',
  'not_interested',
  'opt_out',
  'wrong_contact',
  'auto_reply',
  'unclear',
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export interface IntentMeta {
  label: string;
  tone: Tone;
  /** Needs a person today: an interested-lead alert. */
  hot: boolean;
  /** What a person should do next. */
  next: string;
  /** Interest level the CRM records, when the reply says something about it. */
  interest: InterestLevel | null;
}

export const REPLY_INTENT_META: Record<ReplyIntent, IntentMeta> = {
  interested: { label: 'Interested', tone: 'success', hot: true, next: 'Answer today and offer a short discovery call.', interest: 'high' },
  meeting_request: { label: 'Meeting request', tone: 'success', hot: true, next: 'Agree a time, log the meeting and prepare with the meeting brief.', interest: 'high' },
  pricing_question: {
    label: 'Pricing question',
    tone: 'accent',
    hot: true,
    next: 'Answer from the issued proposal or your price list only. Any discount or change of terms needs an owner or admin.',
    interest: 'medium',
  },
  proposal_question: {
    label: 'Proposal question',
    tone: 'accent',
    hot: true,
    next: 'Answer from the proposal. Record anything they want changed as a change request for an owner or admin to decide.',
    interest: 'medium',
  },
  more_information: { label: 'Wants more information', tone: 'info', hot: false, next: 'Reply with what they asked for (examples, how it works); no prices beyond your price list.', interest: 'medium' },
  not_now: { label: 'Not now', tone: 'neutral', hot: false, next: 'Do not message again for now; a task reminds you to check back in about a month.', interest: 'low' },
  not_interested: { label: 'Not interested', tone: 'neutral', hot: false, next: 'Thank them if appropriate and stop. Mark the prospect lost when you agree.', interest: 'none' },
  opt_out: { label: 'Opt-out', tone: 'danger', hot: false, next: 'Suppressed on every channel. Confirm and record the withdrawal on the prospect.', interest: null },
  wrong_contact: { label: 'Wrong contact', tone: 'warning', hot: false, next: 'Mark the contact detail as wrong or outdated; do not message it again.', interest: null },
  auto_reply: { label: 'Automatic reply', tone: 'neutral', hot: false, next: 'No action: an out-of-office or automatic answer.', interest: null },
  unclear: { label: 'Unclear', tone: 'warning', hot: false, next: 'Read it and set the intent yourself.', interest: null },
};

export const HOT_INTENTS: readonly ReplyIntent[] = REPLY_INTENTS.filter((i) => REPLY_INTENT_META[i].hot);

export const RULES_VERSION = 'reply-rules-1.0.0';

export type ClassificationSource = 'rules' | 'ai' | 'person';

export interface ReplyClassification {
  id: string;
  organizationId: string;
  inboundMessageId: string;
  intent: ReplyIntent;
  /** 0–100 */
  confidence: number;
  source: ClassificationSource;
  /** One line about what they asked for (AI or person); never contact details. */
  summary: string | null;
  classifierVersion: string;
  model: string | null;
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  createdAt: string;
}
export type ClassificationInsert = Pick<ReplyClassification, 'inboundMessageId' | 'intent' | 'confidence' | 'source' | 'summary' | 'classifierVersion' | 'model'> & {
  actorType?: ReplyClassification['actorType'];
};

// ── Rules ────────────────────────────────────────────────────────────────────

// Checked in order; the first match wins. Specific readings come before general interest, so
// "not interested" and "how much?" are not read as "interested".
const RULES: { intent: Exclude<ReplyIntent, 'opt_out' | 'unclear'>; confidence: number; patterns: RegExp[] }[] = [
  {
    intent: 'auto_reply',
    confidence: 90,
    patterns: [/\bout of (the )?office\b/i, /\bauto(matic)?[\s-]?(reply|response)\b/i, /\b(i am|i'm|im) (currently )?(away|on leave|out of the country)\b/i, /\bon (annual |maternity )?leave until\b/i, /\bthis (mailbox|inbox) is not monitored\b/i],
  },
  {
    intent: 'wrong_contact',
    confidence: 80,
    patterns: [/\bwrong (number|person|email|address|contact)\b/i, /\bno longer (work|works|with|at)\b/i, /\bnot the right person\b/i, /\b(i|we) (do not|don['’]?t) (work|own|run) (at|for|the)\b/i, /\byou have the wrong\b/i],
  },
  {
    intent: 'not_interested',
    confidence: 80,
    patterns: [
      /\bnot interested\b/i,
      /\bno,? thank(s| you)\b/i,
      /\b(we|i) (already )?have (a|our own) (website|web designer|developer|agency|someone)\b/i,
      /\bnot (for|right for) us\b/i,
      /\b(we|i)['’]?(re| are| am|m) (fine|ok|okay|good),? (for now|thanks|thank you)\b/i,
      /\bnot looking for\b/i,
    ],
  },
  {
    intent: 'meeting_request',
    confidence: 80,
    patterns: [
      /\b(call|ring|phone) me\b/i,
      /\bgive (me|us) a call\b/i,
      /\b(can|could|shall) we (meet|talk|speak|have a call)\b/i,
      /\b(set up|schedule|book|arrange) (a )?(meeting|call|appointment|time)\b/i,
      /\b(come|pass) (by|round|to) (our|the) (shop|office|store|place)\b/i,
      /\bvisit (us|our)\b/i,
      /\b(zoom|google meet|teams) (call|meeting)?\b/i,
      /\bavailable (on|this|next|tomorrow)\b/i,
      /\b(meet|talk) (on|this|next|tomorrow)\b/i,
    ],
  },
  {
    intent: 'pricing_question',
    confidence: 75,
    patterns: [/\bhow much\b/i, /\b(price|prices|pricing|cost|costs|charge|charges|fee|fees|quote|quotation|budget)\b/i, /\b(ghs|gh₵|cedis?)\b/i, /\bis it (expensive|affordable)\b/i],
  },
  {
    intent: 'proposal_question',
    confidence: 70,
    patterns: [/\b(the|your) (proposal|offer|document|quote you sent)\b[\s\S]*\?/i, /\bin the proposal\b/i, /\b(change|adjust|remove|add) .* (proposal|package|scope)\b/i],
  },
  {
    intent: 'more_information',
    confidence: 70,
    patterns: [/\btell me more\b/i, /\bmore (information|info|details)\b/i, /\bsend (me|us) (the )?(details|examples|samples|your portfolio)\b/i, /\b(examples|samples|portfolio) of (your )?work\b/i, /\bwhat (exactly )?(do you|would you) (do|offer)\b/i, /\bhow does (it|this) work\b/i],
  },
  {
    intent: 'not_now',
    confidence: 70,
    patterns: [/\bnot (right )?now\b/i, /\bmaybe later\b/i, /\b(next|in a few) (week|weeks|month|months|year)\b/i, /\b(after|until) (christmas|easter|the holidays|the new year)\b/i, /\b(too )?busy (at the moment|right now|now)\b/i, /\b(i|we)['’]?ll get back to you\b/i],
  },
  {
    intent: 'interested',
    confidence: 75,
    patterns: [/\binterested\b/i, /\bsounds (good|great|interesting)\b/i, /\byes,? please\b/i, /\blet['’]?s (do it|go|proceed|talk)\b/i, /\bgo ahead\b/i, /\b(we|i)['’]?d (like|love) (to|that|it)\b/i, /\b(we|i) want (a|the|to)\b/i, /\bgreat idea\b/i],
  },
];

export interface RulesResult {
  intent: ReplyIntent;
  confidence: number;
  /** The words that decided it. */
  matched: string | null;
}

/** The deterministic reading of a reply. Opt-outs use the same rules that suppress the sender. */
export function classifyReply(message: Pick<InboundMessage, 'subject' | 'body' | 'optOut' | 'optOutMatch'>): RulesResult {
  if (message.optOut) return { intent: 'opt_out', confidence: 100, matched: message.optOutMatch };
  const text = `${message.subject ?? ''}\n${message.body ?? ''}`.trim();
  if (!text) return { intent: 'unclear', confidence: 0, matched: null };
  const optOut = detectOptOut(text);
  if (optOut.optOut) return { intent: 'opt_out', confidence: 100, matched: optOut.match };
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      const m = text.match(re);
      if (m) return { intent: rule.intent, confidence: rule.confidence, matched: m[0].slice(0, 60) };
    }
  }
  return { intent: 'unclear', confidence: 30, matched: null };
}

/** The task a reading creates for a person, or null when nobody needs to act (an automatic reply). */
export function replyTaskTitle(intent: ReplyIntent, message: Pick<InboundMessage, 'channel' | 'senderHint'>): string | null {
  const from = message.senderHint;
  const label = MESSAGE_CHANNEL_LABELS[message.channel].toLowerCase();
  switch (intent) {
    case 'interested':
      return `Answer the interested reply from ${from} today`;
    case 'meeting_request':
      return `Agree a meeting time with ${from}`;
    case 'pricing_question':
      return `Answer the pricing question from ${from}`;
    case 'proposal_question':
      return `Answer the proposal question from ${from}`;
    case 'more_information':
      return `Send ${from} the information they asked for`;
    case 'not_now':
      return `Read the "not now" reply from ${from}`;
    case 'not_interested':
      return `Read the "not interested" reply from ${from} and decide whether to close`;
    case 'wrong_contact':
      return `Check the contact detail ${from}: the reply says it is the wrong contact`;
    case 'opt_out':
      return `Confirm the opt-out from ${from} and record the withdrawal`;
    case 'auto_reply':
      return null;
    case 'unclear':
      return `Read and answer the ${label} reply from ${from}`;
  }
}

// ── AI reading ───────────────────────────────────────────────────────────────

/** What the AI classifier returns (structured output). */
export const aiClassificationSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().max(400),
});
export type AiClassification = z.infer<typeof aiClassificationSchema>;

/** Version of the AI classifier's instructions, stored with each AI reading. */
export const AI_CLASSIFIER_VERSION = 'reply-ai-1.0.0';

/** Below this the AI reading is not used. */
export const AI_MIN_CONFIDENCE = 60;

/** One line, no contact details: summaries are shown to the team and kept in the history. */
export function cleanSummary(text: string | null | undefined): string | null {
  const s = (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '[number]')
    .replace(/https?:\/\/\S+/g, '[link]')
    .trim();
  return s ? s.slice(0, 300) : null;
}

/**
 * Combines the rules with an AI reading. Suppression first: a rules opt-out always stands, and an AI
 * opt-out is taken (it adds a suppression a person reviews; the AI can only make contact less likely).
 * A low-confidence AI reading falls back to the rules.
 */
export function reconcile(rules: RulesResult, ai: AiClassification | null): { intent: ReplyIntent; confidence: number; source: 'rules' | 'ai'; summary: string | null } {
  if (rules.intent === 'opt_out' || !ai) return { intent: rules.intent, confidence: rules.confidence, source: 'rules', summary: null };
  if (ai.intent === 'opt_out') return { intent: 'opt_out', confidence: Math.max(ai.confidence, 60), source: 'ai', summary: cleanSummary(ai.summary) };
  if (ai.confidence < AI_MIN_CONFIDENCE) return { intent: rules.intent, confidence: rules.confidence, source: 'rules', summary: cleanSummary(ai.summary) };
  return { intent: ai.intent, confidence: ai.confidence, source: 'ai', summary: cleanSummary(ai.summary) };
}

/** Readings recorded at the same instant: a person's correction comes after the AI's, which comes after the rules'. */
const SOURCE_ORDER: Record<ClassificationSource, number> = { rules: 0, ai: 1, person: 2 };

/** The current reading of each received message: the latest classification. */
export function latestClassifications(rows: readonly ReplyClassification[]): Map<string, ReplyClassification> {
  const out = new Map<string, ReplyClassification>();
  for (const r of rows) {
    const prev = out.get(r.inboundMessageId);
    const newer = !prev || r.createdAt > prev.createdAt || (r.createdAt === prev.createdAt && (SOURCE_ORDER[r.source] - SOURCE_ORDER[prev.source] || r.id.localeCompare(prev.id)) > 0);
    if (newer) out.set(r.inboundMessageId, r);
  }
  return out;
}
