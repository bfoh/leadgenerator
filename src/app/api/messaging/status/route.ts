import type { NextRequest } from 'next/server';
import { requireContext } from '@/lib/server/context';
import { fail, ok } from '@/lib/server/http';
import { messagingStatus } from '@/lib/server/messaging/config';

export const dynamic = 'force-dynamic';

// Messaging configuration for the Outreach page: which settings are missing, never their values.
// Test recipients are returned masked, with the hashes the gateway compares (members only).
export async function GET(req: NextRequest) {
  try {
    await requireContext(req, 'outreach.write', { count: 60, windowMs: 60_000 });
    return ok(await messagingStatus());
  } catch (error) {
    return fail(error);
  }
}
