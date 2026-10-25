import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';
import { researchRateLimit, runInspection } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';

// The Studio's one server call: read a business's homepage and return the structural facts only
// (never page text). It goes through the same guarded check the agents use — public address only,
// robots.txt first, size and time limited — and counts against the workspace's website-check quota.
// Reading it here rather than in the browser keeps the address check and the quota on the server,
// and lets a salesperson with studio.write analyse a site without website-verification rights.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', researchRateLimit(20));
    const { url } = await readJson(req, z.object({ url: z.string().trim().min(3).max(2000) }), 5_000);
    const { check, facts, robots, simulated, usage } = await runInspection(ctx, url);
    return ok({ check, facts, robots, simulated, usage });
  } catch (error) {
    return fail(error);
  }
}
