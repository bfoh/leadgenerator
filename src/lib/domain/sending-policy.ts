// Phase 8 sending policy: when messages may leave, how many, and how often one recipient hears from
// the agency. Pure functions shared by the gateway (browser and server) and mirrored by the
// database's send-policy trigger (supabase/migrations/007_sending_policy.sql), which enforces the
// same limits again when a message moves to sending. Change both together.

import { z } from 'zod';

export const POLICY_TIMEZONES = ['Africa/Accra', 'Africa/Abidjan', 'Africa/Lagos', 'Europe/London', 'UTC'] as const;
export type PolicyTimezone = (typeof POLICY_TIMEZONES)[number];

/** ISO weekday numbers: 1 = Monday … 7 = Sunday. */
export const WEEKDAY_LABELS: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' };

/** A message can be scheduled at most this far ahead (also enforced by the database). */
export const MAX_SCHEDULE_AHEAD_DAYS = 7;
/** Hard ceiling on the daily limit per channel; a workspace can set less. */
export const DAILY_LIMIT_CEILING = 100;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Quiet hours always cover 22:00–06:00: the start can be moved earlier and the end later, never less.
const quietStart = z
  .string()
  .regex(HHMM, 'Use a time such as 19:00')
  .refine((v) => minutesOf(v) >= 17 * 60 && minutesOf(v) <= 22 * 60, 'Quiet hours start between 17:00 and 22:00');
const quietEnd = z
  .string()
  .regex(HHMM, 'Use a time such as 08:00')
  .refine((v) => minutesOf(v) >= 6 * 60 && minutesOf(v) <= 10 * 60, 'Quiet hours end between 06:00 and 10:00');

export const sendingPolicySchema = z.object({
  timezone: z.enum(POLICY_TIMEZONES),
  quietStart,
  quietEnd,
  sendDays: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'Choose at least one sending day')
    .transform((d) => [...new Set(d)].sort()),
  dailyLimit: z.object({
    email: z.number().int().min(0).max(DAILY_LIMIT_CEILING),
    whatsapp: z.number().int().min(0).max(DAILY_LIMIT_CEILING),
  }),
  /** Business-initiated messages to one recipient are at least this many days apart. */
  recipientMinGapDays: z.number().int().min(1).max(60),
  /** And at most this many in any 30 days. */
  recipientMax30Days: z.number().int().min(1).max(10),
  /** Follow-ups after the recipient last wrote (or since the first message, if they never did). */
  maxUnansweredFollowUps: z.number().int().min(0).max(3),
  /** A queued message approved longer ago than this is not sent; a person approves it again. */
  approvalMaxAgeDays: z.number().int().min(MAX_SCHEDULE_AHEAD_DAYS + 1).max(30),
});
export type SendingPolicy = z.infer<typeof sendingPolicySchema>;

/** Ghana time, no sending 19:00–08:00 or on Sundays, 20 per channel per day, one message a week per recipient. */
export const DEFAULT_SENDING_POLICY: SendingPolicy = {
  timezone: 'Africa/Accra',
  quietStart: '19:00',
  quietEnd: '08:00',
  sendDays: [1, 2, 3, 4, 5, 6],
  dailyLimit: { email: 20, whatsapp: 20 },
  recipientMinGapDays: 7,
  recipientMax30Days: 3,
  maxUnansweredFollowUps: 2,
  approvalMaxAgeDays: 14,
};

/** Tolerant: each invalid or missing field falls back to its default. */
export function resolveSendingPolicy(raw: unknown): SendingPolicy {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SendingPolicy = structuredClone(DEFAULT_SENDING_POLICY);
  for (const key of Object.keys(DEFAULT_SENDING_POLICY) as (keyof SendingPolicy)[]) {
    if (!(key in source)) continue;
    const parsed = sendingPolicySchema.shape[key].safeParse(source[key]);
    if (parsed.success) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

// ── Local time ───────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday, 1 = Monday. */
  weekday: number;
}

export function localParts(at: Date, tz: string): LocalParts {
  const p = Object.fromEntries(formatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  const weekday = ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
  return { year, month, day, hour: Number(p.hour), minute: Number(p.minute), weekday };
}

/** The instant at a local wall-clock time (two passes cover daylight-saving offsets). */
export function zonedTime(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const wall = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - shown;
  }
  return new Date(guess);
}

function addLocalDays(p: Pick<LocalParts, 'year' | 'month' | 'day'>, days: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: ((d.getUTCDay() + 6) % 7) + 1 };
}

/** Start of the local day containing `at`, and of the next one. */
export function localDayBounds(at: Date, tz: string): { start: Date; end: Date } {
  const p = localParts(at, tz);
  const next = addLocalDays(p, 1);
  return { start: zonedTime(p.year, p.month, p.day, 0, tz), end: zonedTime(next.year, next.month, next.day, 0, tz) };
}

/** The earliest instant at or after `from` on a sending day and outside quiet hours. */
export function nextSendWindow(from: Date, policy: SendingPolicy): Date {
  const tz = policy.timezone;
  const today = localParts(from, tz);
  for (let i = 0; i < 8; i++) {
    const d = addLocalDays(today, i);
    if (!policy.sendDays.includes(d.weekday)) continue;
    const opens = zonedTime(d.year, d.month, d.day, minutesOf(policy.quietEnd), tz);
    const closes = zonedTime(d.year, d.month, d.day, minutesOf(policy.quietStart), tz);
    if (from < closes) return from > opens ? from : opens;
  }
  // Unreachable with at least one sending day; fall back to a week later.
  return new Date(from.getTime() + 7 * 86_400_000);
}

export function inSendWindow(at: Date, policy: SendingPolicy) {
  return nextSendWindow(at, policy).getTime() === at.getTime();
}

/** “Mon 21 Oct, 08:00 (Africa/Accra)” */
export function formatLocal(at: Date | string, tz: string) {
  const d = typeof at === 'string' ? new Date(at) : at;
  const text = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${text} (${tz === 'UTC' ? 'UTC' : tz.split('/')[1].replace('_', ' ')} time)`;
}

export function describePolicyWindow(policy: SendingPolicy) {
  const days = policy.sendDays.length === 7 ? 'every day' : policy.sendDays.map((d) => WEEKDAY_LABELS[d].slice(0, 3)).join(', ');
  return `${policy.quietEnd}–${policy.quietStart} ${policy.timezone === 'UTC' ? 'UTC' : `${policy.timezone.split('/')[1].replace('_', ' ')} time`}, ${days}`;
}

// ── Counting ─────────────────────────────────────────────────────────────────

/** A message that left (or may have left) the agency: what caps count. */
export interface SentRecord {
  id: string;
  channel: 'email' | 'whatsapp';
  purpose: 'introduction' | 'follow_up' | 'proposal' | 'reply';
  recipientHash: string;
  templateId: string | null;
  sendingAt: string | null;
}

export function sentOnLocalDay<T extends SentRecord>(records: readonly T[], at: Date, tz: string, filter: (r: T) => boolean) {
  const { start, end } = localDayBounds(at, tz);
  return records.filter((r) => r.sendingAt && new Date(r.sendingAt) >= start && new Date(r.sendingAt) < end && filter(r)).length;
}

export interface CapResult {
  /** Failures that stop the message for good (a person decides what next). */
  blocking: string[];
  /** Failures that pass with time, each with when. */
  waits: { detail: string; until: Date }[];
}

/**
 * Per-recipient frequency rules for one business-initiated message. Replies to the business are
 * not capped: they answer a message it sent.
 */
export function recipientCaps(
  message: Pick<SentRecord, 'id' | 'purpose' | 'recipientHash'>,
  sent: readonly SentRecord[],
  receivedAt: readonly string[],
  policy: SendingPolicy,
  now: Date,
): CapResult {
  const out: CapResult = { blocking: [], waits: [] };
  if (message.purpose === 'reply') return out;
  const prior = sent
    .filter((r) => r.id !== message.id && r.recipientHash === message.recipientHash && r.sendingAt && r.purpose !== 'reply')
    .map((r) => ({ ...r, at: new Date(r.sendingAt!) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (message.purpose === 'follow_up') {
    if (!prior.length) out.blocking.push('A follow-up needs an earlier message to this recipient.');
    const lastHeard = receivedAt.reduce<string | null>((max, r) => (!max || r > max ? r : max), null);
    const unanswered = prior.filter((r) => r.purpose === 'follow_up' && (!lastHeard || r.at.toISOString() > lastHeard)).length;
    if (unanswered >= policy.maxUnansweredFollowUps) {
      out.blocking.push(
        policy.maxUnansweredFollowUps === 0
          ? 'The sending policy allows no follow-ups without a reply.'
          : `${unanswered} follow-up${unanswered === 1 ? '' : 's'} already sent without a reply; the sending policy stops at ${policy.maxUnansweredFollowUps}.`,
      );
    }
  }

  const last = prior.at(-1);
  if (last) {
    const until = new Date(last.at.getTime() + policy.recipientMinGapDays * 86_400_000);
    if (now < until) out.waits.push({ detail: `This recipient was messaged on ${last.at.toISOString().slice(0, 10)}; messages are at least ${policy.recipientMinGapDays} days apart.`, until });
  }
  const windowStart = now.getTime() - 30 * 86_400_000;
  const recent = prior.filter((r) => r.at.getTime() > windowStart);
  if (recent.length >= policy.recipientMax30Days) {
    const freeing = recent[recent.length - policy.recipientMax30Days];
    out.waits.push({ detail: `${recent.length} messages to this recipient in the last 30 days (limit ${policy.recipientMax30Days}).`, until: new Date(freeing.at.getTime() + 30 * 86_400_000) });
  }
  return out;
}
