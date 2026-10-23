import 'server-only';

import type { DeliveryEvent } from '@/lib/domain/messaging';
import { postJson, providerDetail, type FetchLike, type SendOutcome } from './provider';

// Resend email API (https://resend.com/docs/api-reference/emails/send-email) and its webhook events.

export interface EmailSend {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo: string | null;
  headers: Record<string, string>;
  /** Our message ID, echoed back in webhook events. */
  messageId: string;
}

export async function sendEmail(input: EmailSend, opts: { apiKey: string; fetchImpl?: FetchLike; timeoutMs?: number }): Promise<SendOutcome> {
  const res = await postJson(opts.fetchImpl ?? fetch, 'https://api.resend.com/emails', {
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Idempotency-Key': `outreach-${input.messageId}` },
    body: {
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      headers: input.headers,
      tags: [{ name: 'message_id', value: input.messageId }],
    },
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
  if ('error' in res) return { ok: false, kind: 'uncertain', status: null, detail: res.error };
  const id = (res.body as { id?: unknown } | null)?.id;
  if (res.status >= 200 && res.status < 300) {
    return typeof id === 'string' && id ? { ok: true, providerMessageId: id } : { ok: false, kind: 'uncertain', status: res.status, detail: 'Resend accepted the request but returned no message ID.' };
  }
  // 409: another request with the same idempotency key is in progress or differs; 5xx: unknown.
  const kind = res.status === 409 || res.status >= 500 ? 'uncertain' : 'rejected';
  return { ok: false, kind, status: res.status, detail: providerDetail(res.body, `Resend answered ${res.status}.`) };
}

export type ResendEvent =
  | { kind: 'delivery'; type: string; providerMessageId: string | null; messageId: string | null; event: DeliveryEvent | 'suppressed' | null; detail: string | null }
  | { kind: 'inbound'; type: string; providerMessageId: string; from: string; subject: string | null; receivedAt: string }
  | { kind: 'other'; type: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Our message ID from the event's tags, whichever shape Resend uses (object or list). */
function taggedMessageId(tags: unknown): string | null {
  let value: unknown = null;
  if (Array.isArray(tags)) value = (tags.find((t) => (t as { name?: unknown })?.name === 'message_id') as { value?: unknown } | undefined)?.value;
  else if (tags && typeof tags === 'object') value = (tags as Record<string, unknown>).message_id;
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

const DELIVERY: Record<string, DeliveryEvent | 'suppressed' | null> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.suppressed': 'suppressed',
  // Open and click tracking stay off; these are recorded and ignored if they arrive.
  'email.opened': null,
  'email.clicked': null,
  'email.scheduled': null,
};

export function parseResendEvent(json: unknown): ResendEvent {
  const e = (json ?? {}) as { type?: unknown; created_at?: unknown; data?: Record<string, unknown> };
  const type = typeof e.type === 'string' ? e.type.slice(0, 80) : 'unknown';
  const data = e.data ?? {};
  const emailId = typeof data.email_id === 'string' ? data.email_id.slice(0, 200) : null;
  if (type === 'email.received' && emailId && typeof data.from === 'string') {
    return {
      kind: 'inbound',
      type,
      providerMessageId: emailId,
      from: data.from.slice(0, 400),
      subject: typeof data.subject === 'string' ? data.subject.slice(0, 300) : null,
      receivedAt: typeof data.created_at === 'string' ? data.created_at : typeof e.created_at === 'string' ? e.created_at : new Date().toISOString(),
    };
  }
  if (type in DELIVERY) {
    const bounce = (data.bounce ?? {}) as { type?: unknown; subType?: unknown; message?: unknown };
    let event = DELIVERY[type];
    // A transient bounce is a delay, not a permanent rejection.
    if (event === 'bounced' && typeof bounce.type === 'string' && /transient/i.test(bounce.type)) event = 'delayed';
    const detail = [bounce.type, bounce.subType, bounce.message, (data.failed as { reason?: unknown } | undefined)?.reason].filter((v) => typeof v === 'string').join(' — ').slice(0, 500) || null;
    return { kind: 'delivery', type, providerMessageId: emailId, messageId: taggedMessageId(data.tags), event, detail };
  }
  return { kind: 'other', type };
}

/** "Name <a@b.c>" or "a@b.c" → "a@b.c". */
export function addressOf(from: string) {
  return (from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? from).trim();
}
