import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { fail, ok, readJson } from '@/lib/server/http';
import { researchRateLimit, runContactPage } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';

// The Contact Research agent's read of one page of a business's own website (robots.txt first).
// Returns the contact details the page publishes; nothing is stored here.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'contacts.write', researchRateLimit(20));
    const { url } = await readJson(req, z.object({ url: z.string().trim().min(3).max(2000) }), 5_000);
    const { check, robots, contacts, simulated, usage } = await runContactPage(ctx, url);
    return ok({ check, robots, contacts, simulated, usage });
  } catch (error) {
    return fail(error);
  }
}
