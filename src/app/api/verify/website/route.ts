import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { HttpError, fail, ok, readJson } from '@/lib/server/http';
import { researchRateLimit, runInspection } from '@/lib/server/research-tools';
import { UnsafeUrlError, checkWebsite, parsePublicUrl } from '@/lib/server/safe-fetch';
import { enforceQuota, recordUsage } from '@/lib/server/usage';

export const dynamic = 'force-dynamic';

// `inspect: true` is the agents' check: robots.txt is honoured and structural page facts are
// returned (never stored as page text). Without it, this is a person's one-off status check.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'verification.write', researchRateLimit(20));
    const { url, inspect } = await readJson(req, z.object({ url: z.string().trim().min(3).max(2000), inspect: z.boolean().default(false) }), 5_000);
    if (inspect) {
      const { check, facts, robots, simulated, usage } = await runInspection(ctx, url);
      return ok({ check, facts, robots, simulated, usage });
    }
    try {
      parsePublicUrl(url);
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new HttpError(400, e.message);
      throw e;
    }
    await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
    const check = await checkWebsite(url);
    const usage = await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0 });
    return ok({ check, usage });
  } catch (error) {
    return fail(error);
  }
}
