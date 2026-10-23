import 'server-only';

import { testRecipientHashes } from '@/lib/data/messaging-services';
import { maskContact, normalizeContact } from '@/lib/domain/contacts';
import type { MessageChannel } from '@/lib/domain/messaging';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { serviceRoleKey } from '@/lib/supabase/service';

// Messaging configuration (phase 7). Server-only; read at call time. Nothing here is ever sent to the
// browser except booleans, counts, masked hints and the hashes of the agency's own test recipients.

export const messagingEnv = {
  resendKey: () => process.env.RESEND_API_KEY || '',
  /** "Agency name <hello@outreach.example.com>" on a domain verified in Resend. */
  emailFrom: () => process.env.MESSAGING_EMAIL_FROM || '',
  emailReplyTo: () => process.env.MESSAGING_EMAIL_REPLY_TO || '',
  resendWebhookSecret: () => process.env.RESEND_WEBHOOK_SECRET || '',
  whatsappToken: () => process.env.WHATSAPP_ACCESS_TOKEN || '',
  whatsappPhoneNumberId: () => process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  whatsappBusinessAccountId: () => process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  whatsappAppSecret: () => process.env.WHATSAPP_APP_SECRET || '',
  whatsappVerifyToken: () => process.env.WHATSAPP_VERIFY_TOKEN || '',
  graphVersion: () => (/^v\d{1,3}\.\d$/.test(process.env.WHATSAPP_GRAPH_VERSION ?? '') ? process.env.WHATSAPP_GRAPH_VERSION! : 'v24.0'),
  /** Comma-separated addresses and numbers owned by the agency. The only recipients the server sends to in this version. */
  testRecipients: () =>
    (process.env.MESSAGING_TEST_RECIPIENTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10),
  /** The workspace that receives inbound email and WhatsApp messages (single-workspace deployments). */
  organizationId: () => process.env.MESSAGING_ORGANIZATION_ID || '',
  unsubscribeSecret: () => process.env.MESSAGING_UNSUBSCRIBE_SECRET || '',
  /** Public https address of this app, for unsubscribe links. */
  appUrl: () => (process.env.APP_URL || '').replace(/\/+$/, ''),
};

const FROM = /^(?:[^<>@]{1,80} )?<?[^\s<>@]+@[a-z0-9.-]+\.[a-z]{2,}>?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Configuration problems that block sending on a channel (the gateway's sender check). */
export function senderConfigIssues(channel: MessageChannel): string[] {
  const issues: string[] = [];
  if (!isSupabaseConfigured()) issues.push('Sending needs cloud mode (Supabase); demo mode only simulates it.');
  if (!serviceRoleKey()) issues.push('SUPABASE_SERVICE_ROLE_KEY is not set; the server records dispatch and delivery with it.');
  if (channel === 'email') {
    if (!messagingEnv.resendKey()) issues.push('RESEND_API_KEY is not set.');
    if (!FROM.test(messagingEnv.emailFrom())) issues.push('MESSAGING_EMAIL_FROM is not set (for example "Agency <hello@outreach.yourdomain.com>" on a domain verified in Resend).');
    if (!messagingEnv.resendWebhookSecret()) issues.push('RESEND_WEBHOOK_SECRET is not set, so bounces and complaints would not be tracked.');
    if (messagingEnv.unsubscribeSecret().length < 32) issues.push('MESSAGING_UNSUBSCRIBE_SECRET is not set (at least 32 random characters).');
    if (!/^https:\/\/[^\s/]+/.test(messagingEnv.appUrl())) issues.push('APP_URL must be the https address of this app, for unsubscribe links.');
  } else {
    if (!messagingEnv.whatsappToken()) issues.push('WHATSAPP_ACCESS_TOKEN is not set.');
    if (!/^\d{5,20}$/.test(messagingEnv.whatsappPhoneNumberId())) issues.push('WHATSAPP_PHONE_NUMBER_ID is not set.');
    if (!/^\d{5,20}$/.test(messagingEnv.whatsappBusinessAccountId())) issues.push('WHATSAPP_BUSINESS_ACCOUNT_ID is not set; templates cannot be synchronised.');
    if (!messagingEnv.whatsappAppSecret()) issues.push('WHATSAPP_APP_SECRET is not set, so webhook signatures cannot be verified.');
    if (!messagingEnv.whatsappVerifyToken()) issues.push('WHATSAPP_VERIFY_TOKEN is not set.');
  }
  return issues;
}

export function inboundOrganizationId(): string | null {
  const id = messagingEnv.organizationId();
  return UUID.test(id) ? id : null;
}

/** What the browser may know about the configuration. */
export async function messagingStatus() {
  const recipients = messagingEnv.testRecipients();
  const hints = recipients.map((raw) => {
    const type = raw.includes('@') ? 'email' : 'whatsapp';
    const n = normalizeContact(type, raw);
    return n.ok ? maskContact(type, n.normalized) : 'invalid entry';
  });
  return {
    mode: isSupabaseConfigured() ? ('cloud' as const) : ('demo' as const),
    outboundToBusinesses: false,
    email: { provider: 'Resend', issues: senderConfigIssues('email'), webhook: Boolean(messagingEnv.resendWebhookSecret()) },
    whatsapp: { provider: 'WhatsApp Cloud API', graphVersion: messagingEnv.graphVersion(), issues: senderConfigIssues('whatsapp'), webhook: Boolean(messagingEnv.whatsappAppSecret() && messagingEnv.whatsappVerifyToken()) },
    inbound: { organizationConfigured: Boolean(inboundOrganizationId()) },
    testRecipients: { hints, hashes: await testRecipientHashes(recipients) },
  };
}
export type MessagingStatus = Awaited<ReturnType<typeof messagingStatus>>;
