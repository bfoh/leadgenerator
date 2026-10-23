import 'server-only';

import type { DeliveryEvent, TemplateStatus } from '@/lib/domain/messaging';
import { postJson, providerDetail, type FetchLike, type SendOutcome } from './provider';

// WhatsApp Business Platform, Cloud API (Graph API). Only the official API: no unofficial clients,
// no wa.me automation. Sending: POST /{phone-number-id}/messages. Templates: GET /{waba-id}/message_templates.

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export interface WhatsAppSend {
  /** E.164 number. */
  to: string;
  /** Business-initiated: an approved template with named body parameters. */
  template?: { name: string; language: string; parameters: { name: string; text: string }[] };
  /** Replies inside the 24-hour customer service window only. */
  text?: string;
  /** Our message ID, echoed back in status webhooks. */
  messageId: string;
}

export async function sendWhatsApp(input: WhatsAppSend, cfg: WhatsAppConfig): Promise<SendOutcome> {
  const content = input.template
    ? {
        type: 'template',
        template: {
          name: input.template.name,
          language: { code: input.template.language },
          ...(input.template.parameters.length
            ? { components: [{ type: 'body', parameters: input.template.parameters.map((p) => ({ type: 'text', parameter_name: p.name, text: p.text })) }] }
            : {}),
        },
      }
    : { type: 'text', text: { preview_url: false, body: input.text ?? '' } };
  const res = await postJson(cfg.fetchImpl ?? fetch, `https://graph.facebook.com/${cfg.graphVersion}/${cfg.phoneNumberId}/messages`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: input.to.replace(/^\+/, ''), biz_opaque_callback_data: input.messageId, ...content },
    timeoutMs: cfg.timeoutMs ?? 15_000,
  });
  if ('error' in res) return { ok: false, kind: 'uncertain', status: null, detail: res.error };
  const id = (res.body as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id;
  if (res.status >= 200 && res.status < 300) {
    return typeof id === 'string' && id ? { ok: true, providerMessageId: id } : { ok: false, kind: 'uncertain', status: res.status, detail: 'WhatsApp accepted the request but returned no message ID.' };
  }
  return { ok: false, kind: res.status >= 500 ? 'uncertain' : 'rejected', status: res.status, detail: providerDetail(res.body, `WhatsApp answered ${res.status}.`) };
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export interface WhatsAppStatus {
  eventId: string;
  providerMessageId: string;
  messageId: string | null;
  event: DeliveryEvent | null;
  errorCode: number | null;
  detail: string | null;
}
export interface WhatsAppInbound {
  eventId: string;
  providerMessageId: string;
  /** E.164 with a leading +. */
  from: string;
  text: string;
  receivedAt: string;
  contextMessageId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, DeliveryEvent> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
/** Error codes meaning the person does not want marketing messages from the business. */
export const WHATSAPP_OPT_OUT_CODES = new Set([131050]);

const iso = (unixSeconds: unknown) => (typeof unixSeconds === 'string' && /^\d{9,11}$/.test(unixSeconds) ? new Date(Number(unixSeconds) * 1000).toISOString() : new Date().toISOString());

/** Statuses and messages for our phone number from a (possibly batched) webhook payload. */
export function parseWhatsAppWebhook(json: unknown, phoneNumberId: string): { statuses: WhatsAppStatus[]; messages: WhatsAppInbound[]; ignored: number } {
  const statuses: WhatsAppStatus[] = [];
  const messages: WhatsAppInbound[] = [];
  let ignored = 0;
  const entries = ((json as { entry?: unknown[] } | null)?.entry ?? []).slice(0, 100);
  for (const entry of entries) {
    for (const change of ((entry as { changes?: unknown[] })?.changes ?? []).slice(0, 100)) {
      const c = change as { field?: unknown; value?: Record<string, unknown> };
      const value = c.value ?? {};
      const metadata = (value.metadata ?? {}) as { phone_number_id?: unknown };
      if (c.field !== 'messages' || metadata.phone_number_id !== phoneNumberId) {
        ignored++;
        continue;
      }
      for (const raw of ((value.statuses as unknown[]) ?? []).slice(0, 1000)) {
        const s = raw as { id?: unknown; status?: unknown; biz_opaque_callback_data?: unknown; errors?: { code?: unknown; title?: unknown; message?: unknown }[] };
        if (typeof s.id !== 'string' || typeof s.status !== 'string') continue;
        const err = s.errors?.[0];
        statuses.push({
          eventId: `status:${s.id}:${s.status}`.slice(0, 300),
          providerMessageId: s.id.slice(0, 200),
          messageId: typeof s.biz_opaque_callback_data === 'string' && UUID.test(s.biz_opaque_callback_data) ? s.biz_opaque_callback_data : null,
          event: STATUS[s.status] ?? null,
          errorCode: typeof err?.code === 'number' ? err.code : null,
          detail: err ? [err.code, err.title, err.message].filter((v) => v !== undefined).join(' — ').slice(0, 500) : null,
        });
      }
      for (const raw of ((value.messages as unknown[]) ?? []).slice(0, 1000)) {
        const m = raw as { id?: unknown; from?: unknown; timestamp?: unknown; type?: unknown; text?: { body?: unknown }; button?: { text?: unknown; payload?: unknown }; interactive?: Record<string, { title?: unknown }>; context?: { id?: unknown } };
        if (typeof m.id !== 'string' || typeof m.from !== 'string' || !/^\d{6,15}$/.test(m.from)) continue;
        const interactive = m.interactive ? Object.values(m.interactive).find((v) => typeof v?.title === 'string')?.title : null;
        const text =
          typeof m.text?.body === 'string'
            ? m.text.body
            : typeof m.button?.text === 'string'
              ? m.button.text
              : typeof interactive === 'string'
                ? interactive
                : `[${typeof m.type === 'string' ? m.type.slice(0, 30) : 'unsupported'} message]`;
        messages.push({
          eventId: `message:${m.id}`.slice(0, 300),
          providerMessageId: m.id.slice(0, 200),
          from: `+${m.from}`,
          text: text.slice(0, 10_000),
          receivedAt: iso(m.timestamp),
          contextMessageId: typeof m.context?.id === 'string' ? m.context.id.slice(0, 200) : null,
        });
      }
    }
  }
  return { statuses, messages, ignored };
}

// ── Templates ────────────────────────────────────────────────────────────────

export interface RemoteTemplate {
  id: string;
  name: string;
  language: string;
  status: TemplateStatus;
  rawStatus: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null;
  body: string | null;
  reason: string | null;
}

const TEMPLATE_STATUS: Record<string, TemplateStatus> = { APPROVED: 'approved', PENDING: 'pending', IN_APPEAL: 'pending', REJECTED: 'rejected', PAUSED: 'paused' };

export async function listWhatsAppTemplates(cfg: Omit<WhatsAppConfig, 'phoneNumberId'> & { businessAccountId: string }): Promise<RemoteTemplate[]> {
  const out: RemoteTemplate[] = [];
  let url: string | null = `https://graph.facebook.com/${cfg.graphVersion}/${cfg.businessAccountId}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
  for (let page = 0; url && page < 10; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await (cfg.fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: controller.signal, redirect: 'error' });
    } finally {
      clearTimeout(timer);
    }
    const body = (await res.json().catch(() => null)) as { data?: unknown[]; paging?: { next?: unknown } } | null;
    if (!res.ok) throw new Error(providerDetail(body, `WhatsApp answered ${res.status}.`));
    for (const raw of body?.data ?? []) {
      const t = raw as { id?: unknown; name?: unknown; language?: unknown; status?: unknown; category?: unknown; rejected_reason?: unknown; components?: { type?: unknown; text?: unknown }[] };
      if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.language !== 'string' || typeof t.status !== 'string') continue;
      const category = t.category === 'MARKETING' || t.category === 'UTILITY' || t.category === 'AUTHENTICATION' ? t.category : null;
      const text = t.components?.find((c) => c.type === 'BODY')?.text;
      out.push({
        id: t.id,
        name: t.name,
        language: t.language,
        status: TEMPLATE_STATUS[t.status] ?? 'disabled',
        rawStatus: t.status,
        category,
        body: typeof text === 'string' ? text.slice(0, 5000) : null,
        reason: typeof t.rejected_reason === 'string' && t.rejected_reason !== 'NONE' ? t.rejected_reason.slice(0, 200) : null,
      });
    }
    const next = body?.paging?.next;
    url = typeof next === 'string' && next.startsWith('https://graph.facebook.com/') ? next : null;
  }
  return out;
}
