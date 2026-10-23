import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';
import { ProviderError } from '@/lib/server/providers/discovery';
import { researchRateLimit, runWebSearch } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'verification.write', researchRateLimit(15));
    const body = await readJson(
      req,
      z.object({ query: z.string().trim().min(2).max(200), jobId: z.string().uuid().nullish(), purpose: z.string().max(40).nullish() }),
      5_000,
    );
    const { hits, provider, simulated, usage } = await runWebSearch(ctx, body.query, { jobId: body.jobId, purpose: body.purpose });
    return ok({ results: hits, provider, simulated, usage, retrievedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ProviderError) return ok({ error: error.message, retryable: error.retryable }, { status: 502 });
    return fail(error);
  }
}
