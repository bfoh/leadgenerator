import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { checkModel } from '@/lib/server/ai/model-check';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

// Checks the configured model with the Anthropic Models API (free; no tokens are used).
export async function POST(req: NextRequest) {
  try {
    await requireContext(req, 'reports.write', { count: 6, windowMs: 60_000 });
    const { force } = await readJson(req, z.object({ force: z.boolean().optional() }), 1_000);
    return ok({ check: await checkModel(force ?? false) });
  } catch (error) {
    return fail(error);
  }
}
