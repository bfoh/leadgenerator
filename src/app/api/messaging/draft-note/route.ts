import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { aiNoteEstimateUsd } from '@/lib/automation/pricing';
import { evidencePackSchema } from '@/lib/domain/evidence';
import { generateOutreachNote } from '@/lib/server/ai/outreach-note';
import { isAiConfigured } from '@/lib/server/ai/report-generator';
import { enforceBudget } from '@/lib/server/budget';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/providers/discovery';
import { enforceQuota, paidCall, tokenCharge } from '@/lib/server/usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Writes the one-sentence {{personal_note}} for a message draft from a prospect's evidence pack.
// Returns text only; the drafting agent puts it in a draft, which a person reviews and approves.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'outreach.write', { count: 10, windowMs: 60_000 });
    const { pack, jobId } = await readJson(req, z.object({ pack: evidencePackSchema, jobId: z.string().uuid().optional() }), 150_000);
    if (!isAiConfigured()) throw new HttpError(503, 'AI notes are not configured (ANTHROPIC_API_KEY). Write the note by hand.');
    await enforceQuota(ctx, 'ai_note', serverEnv.quota.aiNotes());
    const maxCostUsd = aiNoteEstimateUsd(serverEnv.anthropicModel());
    await enforceBudget(ctx, { anthropic: maxCostUsd });
    const spec = { provider: 'anthropic', operation: 'ai_note', maxCostUsd, metadata: jobId ? { jobId } : {} };
    const { result, charge } = await paidCall(ctx, spec, () => generateOutreachNote(pack), tokenCharge);
    return ok({ ...result, charge });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}
