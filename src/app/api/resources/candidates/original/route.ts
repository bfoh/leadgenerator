import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { candidateSourceCheck } from '@/lib/domain/visual-acquisition';
import { hostOf, registrableDomain } from '@/lib/domain/web-research';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { fail, HttpError, ok, readJson } from '@/lib/server/http';
import { simulatedFileName, simulatedPng } from '@/lib/server/resource-fixtures';
import { downloadResourceOriginal, UnsafeUrlError } from '@/lib/server/safe-fetch';
import { enforceQuota, recordUsage } from '@/lib/server/usage';
import { resolveAuthorizedSource } from '@/lib/server/visual-source';

export const dynamic = 'force-dynamic';

// The acquisition flow's own read. It exists separately from /api/resources/original so the Studio's
// established import keeps its exact behaviour (including its simulated fixture name).
//
// A real read is driven by the stored candidate: the service looks the row up, proves the file sits
// on the prospect's recorded website and that nobody has decided about it yet, and only then fetches
// that one address. The addresses in the body are used by simulated runs alone, which have no
// database and no network. Nothing is stored here; the service stores the bytes only after a person
// records a rights basis.

const schema = z.object({
  candidateId: z.uuid(),
  sourceUrl: z.string().trim().max(2000),
  pageUrl: z.string().trim().max(2000),
  businessWebsite: z.string().trim().max(2000),
  permissionEvidence: z.string().trim().min(15).max(1000),
  confirmed: z.literal(true),
});

const sameSite = (a: string, b: string) => {
  const left = hostOf(a);
  const right = hostOf(b);
  return Boolean(left && right && registrableDomain(left) === registrableDomain(right));
};

/** Simulated runs have no candidate table, so the addresses they were given are checked instead. */
function simulatedOriginal(sourceUrl: string, pageUrl: string, businessWebsite: string) {
  const check = candidateSourceCheck(pageUrl, sourceUrl, businessWebsite);
  if (!check.ok) throw new HttpError(400, check.problem ?? 'That image cannot be read from this address.');
  if (!sameSite(pageUrl, businessWebsite)) throw new HttpError(400, 'The page read is not the recorded official website.');
  if (check.sourceKind !== 'official_site') {
    throw new HttpError(400, 'That image is served by a third party. Ask the owner for the original, or upload it with permission.');
  }
  const bytes = simulatedPng(sourceUrl);
  return ok({
    fileName: simulatedFileName(sourceUrl),
    mimeType: 'image/png',
    base64: Buffer.from(bytes).toString('base64'),
    finalUrl: sourceUrl,
    simulated: true,
  });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', { count: 30, windowMs: 60_000 });
    const input = await readJson(req, schema, 6000);

    if (serverEnv.simulateExternalTools()) {
      return simulatedOriginal(input.sourceUrl, input.pageUrl, input.businessWebsite);
    }
    if (ctx.mode !== 'cloud') throw new HttpError(403, 'Remote downloads require an authenticated workspace. Upload the authorized original instead.');

    const { candidate, business } = await resolveAuthorizedSource(new SupabaseStore(ctx.supabase, ctx.orgId), input.candidateId);
    await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
    await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { purpose: 'visual_candidate' } }, { required: true });
    const original = await downloadResourceOriginal(candidate.imageUrl);
    const finalHost = hostOf(original.finalUrl);
    const siteHost = hostOf(business.officialWebsite);
    if (!finalHost || !siteHost || registrableDomain(finalHost) !== registrableDomain(siteHost)) {
      throw new HttpError(400, 'The file redirected away from the business’s own website, so it was not loaded.');
    }
    return ok({
      fileName: original.fileName,
      mimeType: original.mimeType,
      base64: Buffer.from(original.bytes).toString('base64'),
      finalUrl: original.finalUrl,
      simulated: false,
    });
  } catch (e) {
    return fail(e instanceof UnsafeUrlError ? new HttpError(400, e.message) : e);
  }
}
