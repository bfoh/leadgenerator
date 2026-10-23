import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { afterInbound } from '@/lib/data/messaging-services';
import type { ServiceContext } from '@/lib/data/services';
import { StoreError } from '@/lib/data/store';
import { SupabaseStore, fromRow } from '@/lib/data/supabase-store';
import { contactKey, maskContact, normalizeContact, sha256Hex } from '@/lib/domain/contacts';
import { detectOptOut, deliveryTransition, type DeliveryEvent, type MessageChannel, type MessageProvider, type OutreachMessage } from '@/lib/domain/messaging';
import { inboundOrganizationId, messagingEnv } from './config';
import { addressOf, parseResendEvent } from './resend';
import { WHATSAPP_OPT_OUT_CODES, parseWhatsAppWebhook } from './whatsapp';

// Webhook processing with the service-role client (no person is signed in). Every event is recorded
// once in channel_events, so provider retries (Resend via Svix, Meta for up to seven days) are
// deduplicated; processing is also idempotent, so a retry after a failure is safe. Payloads are not
// stored, and inbound text is kept only in inbound_messages.

type Provider = 'resend' | 'whatsapp_cloud';
const ACTOR = 'Provider webhook';

async function claimEvent(sb: SupabaseClient, provider: Provider, eventId: string, eventType: string, organizationId: string | null) {
  const { data, error } = await sb
    .from('channel_events')
    .upsert({ provider, event_id: eventId, event_type: eventType, organization_id: organizationId }, { onConflict: 'provider,event_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new StoreError('The webhook event log is unavailable.', 'unavailable');
  if (data?.length) return { id: data[0].id as string, duplicate: false };
  const existing = await sb.from('channel_events').select('id, outcome').eq('provider', provider).eq('event_id', eventId).maybeSingle();
  if (existing.error || !existing.data) throw new StoreError('The webhook event log is unavailable.', 'unavailable');
  // A previous attempt that failed half-way is processed again; everything below is idempotent.
  return { id: existing.data.id as string, duplicate: existing.data.outcome === 'processed' || existing.data.outcome === 'ignored' };
}

async function finishEvent(sb: SupabaseClient, id: string, outcome: 'processed' | 'ignored' | 'failed', detail: string | null, messageId: string | null = null) {
  await sb.from('channel_events').update({ outcome, detail: detail?.slice(0, 500) ?? null, message_id: messageId, processed_at: new Date().toISOString() }).eq('id', id);
}

/** Our message for a provider event: by the ID we sent along (tag or callback data), else by the provider's ID. */
async function findMessage(sb: SupabaseClient, provider: MessageProvider, ref: { messageId: string | null; providerMessageId: string | null }) {
  if (ref.messageId) {
    const { data } = await sb.from('outreach_messages').select('*').eq('id', ref.messageId).maybeSingle();
    if (data) return fromRow<OutreachMessage>(data);
  }
  if (!ref.providerMessageId) return null;
  const { data } = await sb.from('outreach_messages').select('*').eq('provider', provider).eq('provider_message_id', ref.providerMessageId).maybeSingle();
  return data ? fromRow<OutreachMessage>(data) : null;
}

/** Moves the message forward if the event says something new; compare-and-set, retried once on a race. */
async function applyDelivery(sb: SupabaseClient, message: OutreachMessage, provider: MessageProvider, event: DeliveryEvent, detail: string | null, providerMessageId: string | null) {
  const store = new SupabaseStore(sb, message.organizationId);
  let current = message;
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = deliveryTransition(current.status, event);
    if (!next) return current.status;
    const ids = current.providerMessageId || !providerMessageId ? {} : { provider, providerMessageId };
    const updated = await store.recordMessageEvent(current.id, { status: next, statusReason: detail, ...ids }, current.status);
    if (updated) return updated.status;
    const reloaded = await store.getOutreachMessage(current.id);
    if (!reloaded) return null;
    current = reloaded;
  }
  return current.status;
}

async function suppress(sb: SupabaseClient, message: OutreachMessage, reason: 'bounced' | 'opted_out', note: string) {
  try {
    await new SupabaseStore(sb, message.organizationId).createSuppression({
      kind: message.channel === 'email' ? 'email' : 'phone',
      valueHash: message.recipientHash,
      businessId: null,
      channel: message.channel,
      hint: message.recipientHint,
      reason,
      source: 'provider_event',
      consentRecordId: null,
      note,
    });
  } catch (error) {
    if (!(error instanceof StoreError && error.code === 'conflict')) throw error;
  }
}

/** Records a received message for the inbound workspace, linking it to the one prospect whose contact point matches. */
async function recordInbound(
  sb: SupabaseClient,
  orgId: string,
  input: { channel: MessageChannel; provider: Provider; providerMessageId: string; normalized: string; subject: string | null; body: string | null; receivedAt: string; contextProviderId?: string | null },
) {
  const type = input.channel === 'email' ? 'email' : 'whatsapp';
  const senderHash = await sha256Hex(contactKey(type, input.normalized)!);
  const store = new SupabaseStore(sb, orgId);
  const { data: points } = await sb.from('contact_points').select('id, business_id').eq('organization_id', orgId).eq('value_hash', senderHash).limit(5);
  const businesses = [...new Set((points ?? []).map((p) => p.business_id as string))];
  const point = businesses.length === 1 ? (points ?? []).find((p) => p.business_id === businesses[0]) : null;
  let replyTo: string | null = null;
  if (input.contextProviderId) replyTo = (await findMessage(sb, input.provider, { messageId: null, providerMessageId: input.contextProviderId }))?.id ?? null;
  if (!replyTo) {
    const { data } = await sb.from('outreach_messages').select('id').eq('organization_id', orgId).eq('recipient_hash', senderHash).not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(1);
    replyTo = (data?.[0]?.id as string | undefined) ?? null;
  }
  const optOut = detectOptOut(`${input.subject ?? ''}\n${input.body ?? ''}`);
  const { message, created } = await store.createInboundMessage({
    channel: input.channel,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    businessId: (point?.business_id as string | undefined) ?? null,
    contactPointId: (point?.id as string | undefined) ?? null,
    replyToMessageId: replyTo,
    senderHash,
    senderHint: maskContact(type, input.normalized),
    subject: input.subject,
    body: input.body,
    receivedAt: input.receivedAt,
    optOut: optOut.optOut,
    optOutMatch: optOut.match,
  });
  if (created) {
    const ctx: ServiceContext = { store, settings: await store.getSettings(), userId: ACTOR, userLabel: ACTOR };
    await afterInbound(ctx, message, message.businessId);
  }
  return message;
}

// ── Resend ───────────────────────────────────────────────────────────────────

export async function processResendEvent(sb: SupabaseClient, svixId: string, json: unknown) {
  const ev = parseResendEvent(json);
  if (ev.kind === 'other') {
    const claim = await claimEvent(sb, 'resend', svixId, ev.type, null);
    if (!claim.duplicate) await finishEvent(sb, claim.id, 'ignored', 'Event type not used.');
    return { outcome: 'ignored' as const };
  }
  if (ev.kind === 'inbound') {
    const orgId = inboundOrganizationId();
    const claim = await claimEvent(sb, 'resend', svixId, ev.type, orgId);
    if (claim.duplicate) return { outcome: 'duplicate' as const };
    const n = normalizeContact('email', addressOf(ev.from));
    if (!orgId || !n.ok) {
      await finishEvent(sb, claim.id, 'ignored', orgId ? 'Sender address could not be read.' : 'MESSAGING_ORGANIZATION_ID is not set.');
      return { outcome: 'ignored' as const };
    }
    // Resend's event carries the subject but not the text; the subject still catches "unsubscribe" mail.
    const message = await recordInbound(sb, orgId, { channel: 'email', provider: 'resend', providerMessageId: ev.providerMessageId, normalized: n.normalized, subject: ev.subject, body: null, receivedAt: ev.receivedAt });
    await finishEvent(sb, claim.id, 'processed', message.optOut ? 'Opt-out reply' : 'Reply recorded');
    return { outcome: 'processed' as const };
  }
  const message = await findMessage(sb, 'resend', { messageId: ev.messageId, providerMessageId: ev.providerMessageId });
  const claim = await claimEvent(sb, 'resend', svixId, ev.type, message?.organizationId ?? null);
  if (claim.duplicate) return { outcome: 'duplicate' as const };
  if (!message || !ev.event) {
    await finishEvent(sb, claim.id, 'ignored', message ? 'Tracking events are not used.' : 'No matching message.', message?.id ?? null);
    return { outcome: 'ignored' as const };
  }
  if (ev.event === 'suppressed') {
    await applyDelivery(sb, message, 'resend', 'failed', 'Resend did not send it: the address is on Resend’s suppression list after an earlier bounce or complaint.', ev.providerMessageId);
    await suppress(sb, message, 'bounced', 'Resend suppression list');
  } else await applyDelivery(sb, message, 'resend', ev.event, ev.detail, ev.providerMessageId);
  await finishEvent(sb, claim.id, 'processed', ev.type, message.id);
  return { outcome: 'processed' as const };
}

// ── WhatsApp ─────────────────────────────────────────────────────────────────

export async function processWhatsAppPayload(sb: SupabaseClient, json: unknown) {
  const parsed = parseWhatsAppWebhook(json, messagingEnv.whatsappPhoneNumberId());
  const counts = { statuses: 0, messages: 0, duplicates: 0, ignored: parsed.ignored };
  for (const s of parsed.statuses) {
    const message = await findMessage(sb, 'whatsapp_cloud', { messageId: s.messageId, providerMessageId: s.providerMessageId });
    const claim = await claimEvent(sb, 'whatsapp_cloud', s.eventId, `status.${s.event ?? 'other'}`, message?.organizationId ?? null);
    if (claim.duplicate) {
      counts.duplicates++;
      continue;
    }
    if (!message || !s.event) {
      await finishEvent(sb, claim.id, 'ignored', message ? 'Status not used.' : 'No matching message.', message?.id ?? null);
      counts.ignored++;
      continue;
    }
    await applyDelivery(sb, message, 'whatsapp_cloud', s.event, s.detail, s.providerMessageId);
    if (s.errorCode !== null && WHATSAPP_OPT_OUT_CODES.has(s.errorCode)) await suppress(sb, message, 'opted_out', 'WhatsApp: the person stopped marketing messages from this business');
    await finishEvent(sb, claim.id, 'processed', s.event, message.id);
    counts.statuses++;
  }
  const orgId = inboundOrganizationId();
  for (const m of parsed.messages) {
    const claim = await claimEvent(sb, 'whatsapp_cloud', m.eventId, 'message', orgId);
    if (claim.duplicate) {
      counts.duplicates++;
      continue;
    }
    const n = normalizeContact('whatsapp', m.from);
    if (!orgId || !n.ok) {
      await finishEvent(sb, claim.id, 'ignored', orgId ? 'Sender number could not be read.' : 'MESSAGING_ORGANIZATION_ID is not set.');
      counts.ignored++;
      continue;
    }
    const message = await recordInbound(sb, orgId, { channel: 'whatsapp', provider: 'whatsapp_cloud', providerMessageId: m.providerMessageId, normalized: n.normalized, subject: null, body: m.text, receivedAt: m.receivedAt, contextProviderId: m.contextMessageId });
    await finishEvent(sb, claim.id, 'processed', message.optOut ? 'Opt-out reply' : 'Reply recorded');
    counts.messages++;
  }
  return counts;
}
