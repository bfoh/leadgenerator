import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';
import { researchRateLimit, runMxLookups } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';

// Mail-server (MX) lookups for email domains: DNS only, no mailbox is ever probed.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'contacts.write', researchRateLimit(20));
    const { domains } = await readJson(req, z.object({ domains: z.array(z.string().max(253)).min(1).max(10) }), 5_000);
    const { results, simulated, usage } = await runMxLookups(ctx, domains);
    return ok({ results, simulated, usage });
  } catch (error) {
    return fail(error);
  }
}
