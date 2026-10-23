import { NextResponse, type NextRequest } from 'next/server';
import { messagingEnv } from '@/lib/server/messaging/config';
import { tokensMatch, verifyMetaSignature } from '@/lib/server/messaging/signatures';
import { processWhatsAppPayload } from '@/lib/server/messaging/webhooks';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { serviceRoleKey, serviceSupabase } from '@/lib/supabase/service';
import { logEvent } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 1_000_000;
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Meta's subscription check: echo hub.challenge only when the verify token matches.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = messagingEnv.whatsappVerifyToken();
  const challenge = p.get('hub.challenge') ?? '';
  if (!expected || p.get('hub.mode') !== 'subscribe' || !tokensMatch(p.get('hub.verify_token'), expected) || !/^[\w-]{1,200}$/.test(challenge)) {
    return new NextResponse('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

// Status updates and received messages (signed with the app secret). Meta batches up to 1,000
// updates and retries for up to seven days; the event log deduplicates them.
export async function POST(req: NextRequest) {
  const appSecret = messagingEnv.whatsappAppSecret();
  if (!appSecret || !messagingEnv.whatsappPhoneNumberId() || !isSupabaseConfigured() || !serviceRoleKey()) return reply(503, { error: 'WhatsApp webhooks are not configured.' });
  const body = await req.text();
  if (body.length > MAX_BYTES) return reply(413, { error: 'Payload too large.' });
  if (!verifyMetaSignature({ appSecret, signature: req.headers.get('x-hub-signature-256'), body })) return reply(401, { error: 'Invalid signature.' });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reply(400, { error: 'Invalid JSON.' });
  }
  try {
    const counts = await processWhatsAppPayload(serviceSupabase(), json);
    return reply(200, { ok: true, ...counts });
  } catch (error) {
    void logEvent('error', 'webhook_failed', { channel: 'whatsapp', error: error instanceof Error ? error.name : 'unknown' });
    return reply(500, { error: 'Processing failed.' });
  }
}
