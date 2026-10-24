import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { aiClassifyEstimateUsd } from '@/lib/automation/pricing';
import { MESSAGE_CHANNELS } from '@/lib/domain/messaging';
import { classifyReplyWithAi } from '@/lib/server/ai/reply-classifier';
import { isAiConfigured } from '@/lib/server/ai/report-generator';
import { enforceBudget } from '@/lib/server/budget';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/providers/discovery';
import { enforceQuota, paidCall, tokenCharge } from '@/lib/server/usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  channel: z.enum(MESSAGE_CHANNELS),
  subject: z.string().max(500).nullable(),
  body: z.string().min(1).max(10_000),
  jobId: z.string().uuid().optional(),
});

// Reads one received message with the AI classifier. Returns a reading only: the caller reconciles it
// with the deterministic rules (an opt-out can never be overruled) and records it for people to act on.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'outreach.write', { count: 20, windowMs: 60_000 });
    const { jobId, ...message } = await readJson(req, bodySchema, 40_000);
    if (!isAiConfigured()) throw new HttpError(503, 'AI classification is not configured (ANTHROPIC_API_KEY). Set the intent yourself.');
    await enforceQuota(ctx, 'ai_classify', serverEnv.quota.aiClassifications());
    const maxCostUsd = aiClassifyEstimateUsd(serverEnv.anthropicModel());
    await enforceBudget(ctx, { anthropic: maxCostUsd });
    const spec = { provider: 'anthropic', operation: 'ai_classify', maxCostUsd, metadata: jobId ? { jobId } : {} };
    const { result, charge } = await paidCall(ctx, spec, () => classifyReplyWithAi(message), tokenCharge);
    return ok({ ...result, charge });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}
