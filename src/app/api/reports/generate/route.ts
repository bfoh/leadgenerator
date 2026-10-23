import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { evidencePackSchema } from '@/lib/domain/evidence';
import { aiReportEstimateUsd } from '@/lib/automation/pricing';
import { generateAiReport, isAiConfigured } from '@/lib/server/ai/report-generator';
import { enforceBudget } from '@/lib/server/budget';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/providers/discovery';
import { enforceQuota, recordUsage } from '@/lib/server/usage';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'reports.write', { count: 6, windowMs: 60_000 });
    const { pack, jobId } = await readJson(req, z.object({ pack: evidencePackSchema, jobId: z.string().uuid().optional() }), 150_000);
    if (!isAiConfigured()) throw new HttpError(503, 'AI reports are not configured (ANTHROPIC_API_KEY). The rule-based generator is available.');
    await enforceQuota(ctx, 'ai_report', serverEnv.quota.aiReports());
    await enforceBudget(ctx, { anthropic: aiReportEstimateUsd(serverEnv.anthropicModel()) });
    const result = await generateAiReport(pack);
    const usage = await recordUsage(ctx, {
      provider: 'anthropic',
      operation: 'ai_report',
      units: 1,
      estimatedCostUsd: result.usage.estimatedCostUsd,
      metadata: { model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, ...(jobId ? { jobId } : {}) },
    });
    return ok({ ...result, charge: usage });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}
