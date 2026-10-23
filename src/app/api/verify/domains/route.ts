import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireContext } from '@/lib/server/context';
import { candidateDomains } from '@/lib/server/domains';
import { fail, ok, readJson } from '@/lib/server/http';
import { researchRateLimit, runDomainProbes } from '@/lib/server/research-tools';

export const dynamic = 'force-dynamic';

// Either a business name (plausible domains are derived from it, plus up to four extra) or an
// explicit list of domains an agent wants to probe.
const schema = z.union([
  z.object({ name: z.string().trim().min(2).max(200), extra: z.array(z.string().max(253)).max(4).default([]) }),
  z.object({ domains: z.array(z.string().max(253)).min(1).max(10) }),
]);

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'verification.write', researchRateLimit(10));
    const body = await readJson(req, schema, 5_000);
    const domains = 'domains' in body ? body.domains : [...body.extra, ...candidateDomains(body.name)];
    const { results, simulated, usage } = await runDomainProbes(ctx, domains);
    // The manual tool shows a hint next to each result.
    const withNotes = results.map((r) => ({ ...r, note: r.resolves ? 'Resolves — ownership unknown. Check the site before recording it.' : 'Does not resolve.' }));
    return ok({ results: withNotes, simulated, usage });
  } catch (error) {
    return fail(error);
  }
}
