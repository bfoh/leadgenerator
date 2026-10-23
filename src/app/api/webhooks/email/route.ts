import { NextResponse, type NextRequest } from 'next/server';
import { messagingEnv } from '@/lib/server/messaging/config';
import { verifySvixSignature } from '@/lib/server/messaging/signatures';
import { processResendEvent } from '@/lib/server/messaging/webhooks';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { serviceRoleKey, serviceSupabase } from '@/lib/supabase/service';
import { logEvent } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 256_000;
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

// Resend delivery events and received email (signed with Svix). Unsigned or stale requests are
// rejected before anything is parsed. Responses carry no record data.
export async function POST(req: NextRequest) {
  const secret = messagingEnv.resendWebhookSecret();
  if (!secret || !isSupabaseConfigured() || !serviceRoleKey()) return reply(503, { error: 'Email webhooks are not configured.' });
  const body = await req.text();
  if (body.length > MAX_BYTES) return reply(413, { error: 'Payload too large.' });
  const id = req.headers.get('svix-id');
  if (!verifySvixSignature({ secret, id, timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature'), body })) {
    return reply(401, { error: 'Invalid signature.' });
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reply(400, { error: 'Invalid JSON.' });
  }
  try {
    const result = await processResendEvent(serviceSupabase(), id!, json);
    return reply(200, { ok: true, outcome: result.outcome });
  } catch (error) {
    // A non-2xx answer makes Resend retry; the event log makes the retry safe.
    void logEvent('error', 'webhook_failed', { channel: 'email', error: error instanceof Error ? error.name : 'unknown' });
    return reply(500, { error: 'Processing failed.' });
  }
}
