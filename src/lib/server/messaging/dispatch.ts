import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutomationMode } from '@/lib/automation/constants';
import { deferralReason, dueMessages, evaluateMessage, testRecipientHashes, type DueRunSummary, type MessagingEnv } from '@/lib/data/messaging-services';
import { log, type ServiceContext } from '@/lib/data/services';
import { StoreError } from '@/lib/data/store';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { contactKey, sha256Hex } from '@/lib/domain/contacts';
import { MESSAGE_CHANNEL_LABELS, agencyIdentityIssues, emailFooter, whatsappParameters, type MessageStatus } from '@/lib/domain/messaging';
import { DEFAULT_SENDING_POLICY, resolveSendingPolicy, type SendingPolicy } from '@/lib/domain/sending-policy';
import { messagingEnv, senderConfigIssues } from './config';
import type { FetchLike, SendOutcome } from './provider';
import { sendEmail } from './resend';
import { signUnsubscribeToken } from './signatures';
import { sendWhatsApp } from './whatsapp';

// Dispatch of one queued message (cloud mode). Reads go through the signed-in person's client, so
// row-level security applies to everything the gateway sees; only the facts the database reserves
// for the server (sending, sent, failed, delivery unknown) are written with the service-role
// client, scoped to the person's organization. The gateway runs again here, immediately before the
// provider call, whatever the browser decided earlier.

export interface DispatchDeps {
  userSupabase: SupabaseClient;
  serviceSupabase: SupabaseClient;
  orgId: string;
  userId: string;
  userLabel: string;
  fetchImpl?: FetchLike;
}

export interface DispatchResult {
  status: MessageStatus;
  sandbox: boolean;
  reasons: string[];
  duplicate?: boolean;
  /** Timing rules only: still queued, for scheduledFor (null while sending is paused). */
  deferred?: boolean;
  scheduledFor?: string | null;
  providerMessageId?: string;
}

const MISSING = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

interface AutomationPolicy {
  mode: AutomationMode;
  outboundStopped: boolean;
  outboundAvailable: boolean;
  sendingPolicy: SendingPolicy;
  sendingPaused: boolean;
}

async function automationPolicy(sb: SupabaseClient, orgId: string): Promise<AutomationPolicy> {
  const read = (columns: string) => sb.from('automation_settings').select(columns).eq('organization_id', orgId).maybeSingle();
  const [first, available] = await Promise.all([read('mode, outbound_stopped, sending_policy, sending_paused'), sb.rpc('outbound_available')]);
  // Before migration 007 the sending columns are absent: the default policy applies.
  const settings = first.error?.code === '42703' ? await read('mode, outbound_stopped') : first;
  if (settings.error && !MISSING.has(settings.error.code)) throw new StoreError('Workspace automation settings are unavailable.', 'unavailable');
  const row = (settings.data ?? null) as Record<string, unknown> | null;
  return {
    mode: (row?.mode as AutomationMode | undefined) ?? 'research_only',
    outboundStopped: row?.outbound_stopped !== false,
    outboundAvailable: !available.error && available.data === true,
    sendingPolicy: row && 'sending_policy' in row ? resolveSendingPolicy(row.sending_policy) : structuredClone(DEFAULT_SENDING_POLICY),
    sendingPaused: row?.sending_paused === true,
  };
}

export async function serverMessagingEnv(sb: SupabaseClient, orgId: string, ctx: ServiceContext): Promise<MessagingEnv> {
  return {
    ...(await automationPolicy(sb, orgId)),
    testRecipientHashes: await testRecipientHashes(messagingEnv.testRecipients()),
    senderIssues: {
      email: [...senderConfigIssues('email'), ...agencyIdentityIssues(ctx.settings, 'email')],
      whatsapp: [...senderConfigIssues('whatsapp'), ...agencyIdentityIssues(ctx.settings, 'whatsapp')],
    },
  };
}

export async function dispatchMessage(deps: DispatchDeps, messageId: string): Promise<DispatchResult> {
  const userStore = new SupabaseStore(deps.userSupabase, deps.orgId);
  const serverStore = new SupabaseStore(deps.serviceSupabase, deps.orgId);
  const ctx: ServiceContext = { store: userStore, settings: await userStore.getSettings(), userId: deps.userId, userLabel: deps.userLabel };

  const message = await userStore.getOutreachMessage(messageId);
  if (!message) throw new StoreError('Message not found.', 'not_found');
  if (message.status !== 'queued') throw new StoreError(`Only queued messages are dispatched; this one is ${message.status.replace('_', ' ')}.`, 'conflict');

  const env = await serverMessagingEnv(deps.userSupabase, deps.orgId, ctx);
  const { result, decision } = await evaluateMessage(ctx, message, env, 'dispatch');
  if (result.outcome === 'deferred') {
    // Timing rules only: the message stays queued for when it may go. Writing the new time is a
    // server fact (people set the time only when they queue).
    const held = await serverStore.recordMessageEvent(
      message.id,
      { statusReason: deferralReason(result), dispatchDecisionId: decision.id, ...(result.deferUntil ? { scheduledFor: result.deferUntil } : {}) },
      'queued',
    );
    return { status: held?.status ?? message.status, sandbox: result.sandbox, reasons: result.reasons, deferred: true, scheduledFor: held?.scheduledFor ?? message.scheduledFor };
  }
  const block = async (reasons: string[]) => {
    const blocked = await serverStore.recordMessageEvent(message.id, { status: 'blocked', statusReason: reasons.join(' ').slice(0, 1000), dispatchDecisionId: decision.id }, 'queued');
    await log(ctx, message.businessId, 'system', `Dispatch blocked by the eligibility gateway for ${message.recipientHint}: ${reasons[0]}`, { messageId: message.id, decisionId: decision.id });
    return { status: blocked?.status ?? message.status, sandbox: result.sandbox, reasons };
  };
  if (!result.eligible) return block(result.reasons);

  // The address is resolved only now, from the contact point, and must still match the hash.
  const [points, templates] = await Promise.all([userStore.listContactPoints(message.businessId), message.templateId ? userStore.listTemplates() : Promise.resolve([])]);
  const point = points.find((p) => p.id === message.contactPointId);
  const key = point ? contactKey(point.type, point.normalizedValue) : null;
  if (!point || !key || (await sha256Hex(key)) !== message.recipientHash) return block(['The contact detail no longer matches the approved recipient.']);
  const template = templates.find((t) => t.id === message.templateId) ?? null;

  // Compare-and-set: only one dispatcher moves a queued message to sending.
  const claimed = await serverStore.recordMessageEvent(message.id, { status: 'sending', dispatchDecisionId: decision.id }, 'queued');
  if (!claimed) return { status: (await userStore.getOutreachMessage(message.id))?.status ?? message.status, sandbox: result.sandbox, reasons: [], duplicate: true };

  let outcome: SendOutcome;
  const provider = message.channel === 'email' ? ('resend' as const) : ('whatsapp_cloud' as const);
  if (message.channel === 'email') {
    const replyTo = messagingEnv.emailReplyTo() || null;
    const unsubscribeUrl = `${messagingEnv.appUrl()}/api/messaging/unsubscribe?t=${signUnsubscribeToken(messagingEnv.unsubscribeSecret(), message.id)}`;
    const footer = emailFooter({ agencyName: ctx.settings.agency.name, senderName: ctx.userLabel, address: ctx.settings.agency.address, unsubscribeUrl, reply: message.purpose === 'reply' });
    outcome = await sendEmail(
      {
        from: messagingEnv.emailFrom(),
        to: point.normalizedValue,
        subject: message.subject ?? '',
        text: `${message.body}\n\n${footer}`,
        replyTo,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>${replyTo ? `, <mailto:${replyTo}?subject=unsubscribe>` : ''}`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        messageId: message.id,
      },
      { apiKey: messagingEnv.resendKey(), fetchImpl: deps.fetchImpl },
    );
  } else {
    outcome = await sendWhatsApp(
      {
        to: point.normalizedValue,
        messageId: message.id,
        ...(template?.providerTemplateName
          ? { template: { name: template.providerTemplateName, language: template.language, parameters: whatsappParameters(template.body, message.parameters) } }
          : { text: message.body }),
      },
      { token: messagingEnv.whatsappToken(), phoneNumberId: messagingEnv.whatsappPhoneNumberId(), graphVersion: messagingEnv.graphVersion(), fetchImpl: deps.fetchImpl },
    );
  }

  const label = `${result.sandbox ? 'Sandbox ' : ''}${MESSAGE_CHANNEL_LABELS[message.channel].toLowerCase()}`;
  if (outcome.ok) {
    // A webhook may already have moved it on (and recorded the provider ID); then this is a no-op.
    const sent = await serverStore.recordMessageEvent(message.id, { status: 'sent', provider, providerMessageId: outcome.providerMessageId }, 'sending');
    await log(ctx, message.businessId, result.sandbox ? 'system' : message.channel, `${label} message sent to ${message.recipientHint}${result.sandbox ? ' (agency test recipient)' : ''}.`, { messageId: message.id });
    return { status: sent?.status ?? 'sent', sandbox: result.sandbox, reasons: [], providerMessageId: outcome.providerMessageId };
  }
  const status = outcome.kind === 'uncertain' ? ('delivery_unknown' as const) : ('failed' as const);
  const reason = outcome.kind === 'uncertain' ? `Delivery unknown: ${outcome.detail} Check the provider before doing anything; it is never retried automatically.` : `Rejected by the provider: ${outcome.detail}`;
  await serverStore.recordMessageEvent(message.id, { status, statusReason: reason.slice(0, 1000) }, 'sending');
  await log(ctx, message.businessId, 'system', `${label} message to ${message.recipientHint}: ${status === 'failed' ? 'not sent' : 'delivery unknown'}.`, { messageId: message.id });
  return { status, sandbox: result.sandbox, reasons: [reason] };
}

/**
 * Dispatches the workspace's due queued messages one at a time, each through dispatchMessage (and
 * so the gateway and the database's send-policy trigger). Stops early while sending is paused.
 */
export async function dispatchDue(deps: DispatchDeps, limit = 10): Promise<DueRunSummary & { results: (DispatchResult & { messageId: string })[] }> {
  const policy = await automationPolicy(deps.userSupabase, deps.orgId);
  const out = { checked: 0, sent: 0, deferred: 0, blocked: 0, paused: policy.sendingPaused, results: [] as (DispatchResult & { messageId: string })[] };
  if (policy.sendingPaused) return out;
  const store = new SupabaseStore(deps.userSupabase, deps.orgId);
  for (const m of dueMessages(await store.listOutreachMessages()).slice(0, limit)) {
    let r: DispatchResult;
    try {
      r = await dispatchMessage(deps, m.id);
    } catch (error) {
      // Another dispatcher moved it on first.
      if (error instanceof StoreError && error.code === 'conflict') continue;
      throw error;
    }
    out.checked++;
    out.results.push({ ...r, messageId: m.id });
    if (r.deferred) out.deferred++;
    else if (r.status === 'blocked') out.blocked++;
    else if (!r.duplicate && !r.reasons.length) out.sent++;
  }
  return out;
}
