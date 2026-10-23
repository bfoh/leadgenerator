import { NextResponse, type NextRequest } from 'next/server';
import { log } from '@/lib/data/services';
import { StoreError } from '@/lib/data/store';
import { SupabaseStore, fromRow } from '@/lib/data/supabase-store';
import type { OutreachMessage } from '@/lib/domain/messaging';
import { clientIp } from '@/lib/server/http';
import { messagingEnv } from '@/lib/server/messaging/config';
import { verifyUnsubscribeToken } from '@/lib/server/messaging/signatures';
import { rateLimit } from '@/lib/server/rate-limit';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { serviceRoleKey, serviceSupabase } from '@/lib/supabase/service';
import { logEvent } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

// The unsubscribe link in every email. GET shows a confirmation button (so link scanners do not
// unsubscribe anyone); POST unsubscribes, including RFC 8058 one-click requests from mail apps. The
// token names the message, never the address; the page never shows who the recipient is.

const page = (status: number, title: string, text: string, form?: string) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:48px 16px;background:#f7f7f5;color:#1c1c1a}main{max-width:480px;margin:auto;background:#fff;border:1px solid #e3e3df;border-radius:12px;padding:24px}button{font:inherit;padding:10px 16px;border-radius:8px;border:0;background:#1c1c1a;color:#fff;cursor:pointer}@media (prefers-color-scheme:dark){body{background:#151513;color:#ecece8}main{background:#1e1e1c;border-color:#33332f}button{background:#ecece8;color:#151513}}</style></head>
<body><main><h1 style="font-size:20px;margin-top:0">${title}</h1><p>${text}</p>${form ?? ''}</main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" } },
  );

const invalid = () => page(400, 'Link not valid', 'This unsubscribe link is not valid. Reply to the email with the word STOP and we will remove you.');
const configured = () => Boolean(isSupabaseConfigured() && serviceRoleKey() && messagingEnv.unsubscribeSecret().length >= 32);

export async function GET(req: NextRequest) {
  if (!configured()) return page(503, 'Unsubscribe unavailable', 'Unsubscribing by link is not available right now. Reply to the email with the word STOP and we will remove you.');
  const token = req.nextUrl.searchParams.get('t');
  if (!verifyUnsubscribeToken(messagingEnv.unsubscribeSecret(), token)) return invalid();
  const action = `/api/messaging/unsubscribe?t=${encodeURIComponent(token!)}`;
  return page(200, 'Unsubscribe', 'Stop receiving emails from us?', `<form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(req: NextRequest) {
  if (!configured()) return page(503, 'Unsubscribe unavailable', 'Unsubscribing by link is not available right now. Reply to the email with the word STOP and we will remove you.');
  if (!rateLimit(`unsubscribe:${clientIp(req)}`, 20, 60_000).allowed) return page(429, 'Try again shortly', 'Too many requests. Please try again in a minute.');
  const messageId = verifyUnsubscribeToken(messagingEnv.unsubscribeSecret(), req.nextUrl.searchParams.get('t'));
  if (!messageId) return invalid();
  const sb = serviceSupabase();
  const { data } = await sb.from('outreach_messages').select('*').eq('id', messageId).maybeSingle();
  if (data) {
    const message = fromRow<OutreachMessage>(data);
    const store = new SupabaseStore(sb, message.organizationId);
    let added = true;
    try {
      await store.createSuppression({
        kind: message.channel === 'email' ? 'email' : 'phone',
        valueHash: message.recipientHash,
        businessId: null,
        channel: message.channel,
        hint: message.recipientHint,
        reason: 'unsubscribed',
        source: 'inbound_opt_out',
        consentRecordId: null,
        note: 'Unsubscribe link in an email',
      });
    } catch (error) {
      if (!(error instanceof StoreError && error.code === 'conflict')) {
        void logEvent('error', 'unsubscribe_failed', { error: error instanceof Error ? error.name : 'unknown' });
        return page(500, 'Something went wrong', 'We could not record this. Reply to the email with the word STOP and we will remove you.');
      }
      added = false;
    }
    if (added) {
      const ctx = { store, settings: await store.getSettings(), userId: 'unsubscribe-link', userLabel: 'Unsubscribe link' };
      await log(ctx, message.businessId, 'permission', `${message.recipientHint} unsubscribed from email using the link in a message. The address is suppressed.`, { messageId: message.id });
      await store.createTask({ businessId: message.businessId, projectId: null, title: `Confirm the unsubscribe from ${message.recipientHint} and record the withdrawal`, dueDate: null, completedAt: null, assigneeId: null });
    }
  }
  // The same answer whether or not the message still exists.
  return page(200, 'You are unsubscribed', 'You will not receive further emails from us at this address.');
}
