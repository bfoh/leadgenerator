import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { StoreError } from '@/lib/data/store';
import { requireContext } from '@/lib/server/context';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { dispatchDue, dispatchMessage } from '@/lib/server/messaging/dispatch';
import { serviceRoleKey, serviceSupabase } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const STATUS: Record<StoreError['code'], number> = { not_found: 404, forbidden: 403, conflict: 409, invalid: 400, unavailable: 503 };

// Sends one queued message ({ messageId }) or the workspace's due queued messages ({ due: true })
// after re-running the eligibility gateway on the server for each. Owners and admins only. Quiet
// hours, limits and caps defer a message (it stays queued for later) rather than block it. In this
// version the gateway lets through only the agency's own sandbox test recipients
// (MESSAGING_TEST_RECIPIENTS); every message to a business is blocked.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'outreach.approve', { count: 10, windowMs: 60_000 });
    if (ctx.mode !== 'cloud') throw new HttpError(400, 'Demo mode simulates dispatch in the browser; nothing is sent from the server.');
    if (!serviceRoleKey()) throw new HttpError(503, 'Dispatch needs SUPABASE_SERVICE_ROLE_KEY on the server.');
    const body = await readJson(req, z.union([z.object({ messageId: z.uuid() }).strict(), z.object({ due: z.literal(true), limit: z.number().int().min(1).max(10).optional() }).strict()]), 1_000);
    const { data } = await ctx.supabase.auth.getUser();
    const label = (data.user?.user_metadata?.full_name as string | undefined) || data.user?.email || 'A team member';
    const deps = { userSupabase: ctx.supabase, serviceSupabase: serviceSupabase(), orgId: ctx.orgId, userId: ctx.userId, userLabel: label };
    try {
      return ok('messageId' in body ? await dispatchMessage(deps, body.messageId) : await dispatchDue(deps, body.limit ?? 10));
    } catch (error) {
      if (error instanceof StoreError) throw new HttpError(STATUS[error.code], error.message);
      throw error;
    }
  } catch (error) {
    return fail(error);
  }
}
