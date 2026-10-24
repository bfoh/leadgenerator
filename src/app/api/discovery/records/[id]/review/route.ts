import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { campaignHttpError, requireCloud } from '@/lib/server/campaigns/api';
import { requireContext } from '@/lib/server/context';
import { promoteDiscoveredRecord, rejectDiscoveredRecord } from '@/lib/server/discovery/service';
import { DiscoveryProviderError } from '@/lib/server/discovery/provider';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';

// Human review of a provider record. Owners and admins decide; a promotion creates a canonical
// prospect with provider provenance, and the campaign's next run may research it.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

const reviewSchema = z.object({
  action: z.enum(['promote', 'reject']),
  note: z.string().trim().max(1000).nullable().optional(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireContext(req, 'automation.manage', { count: 30, windowMs: 60_000 });
    requireCloud(ctx);
    if (!ctx.userId) throw new HttpError(403, 'Sign in to review a discovery record.');
    const { id } = await params;
    if (!UUID.test(id)) throw new HttpError(400, 'Unknown discovery record.');
    const input = await readJson(req, reviewSchema, 5_000);
    if (input.action === 'promote') {
      const { businessId } = await promoteDiscoveredRecord(ctx.supabase, {
        organizationId: ctx.orgId,
        recordId: id,
        actorId: ctx.userId,
        note: input.note ?? null,
      });
      return ok({ promoted: true, businessId });
    }
    await rejectDiscoveredRecord(ctx.supabase, {
      organizationId: ctx.orgId,
      recordId: id,
      actorId: ctx.userId,
      note: input.note ?? null,
    });
    return ok({ rejected: true });
  } catch (error) {
    if (error instanceof DiscoveryProviderError) {
      const status = error.kind === 'forbidden' ? 403 : error.kind === 'invalid' ? 400 : 503;
      return fail(new HttpError(status, error.message));
    }
    return fail(campaignHttpError(error));
  }
}
