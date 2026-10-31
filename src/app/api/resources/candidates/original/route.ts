import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { restrictedResourceUrl } from '@/lib/domain/business-resources';
import { hostOf, registrableDomain } from '@/lib/domain/web-research';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { fail, HttpError, ok, readJson } from '@/lib/server/http';
import { simulatedFileName, simulatedPng } from '@/lib/server/resource-fixtures';
import { downloadResourceOriginal, parsePublicUrl, UnsafeUrlError } from '@/lib/server/safe-fetch';
import { enforceQuota, recordUsage } from '@/lib/server/usage';

export const dynamic = 'force-dynamic';

// The acquisition flow's own read. It exists separately from /api/resources/original so the Studio's
// established import keeps its exact behaviour (including its simulated fixture name). Bytes are read
// once, validated, and returned to the caller; nothing is stored here. The service stores them only
// after a person records a rights basis.

const schema = z.object({
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

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', { count: 30, windowMs: 60_000 });
    const input = await readJson(req, schema, 6000);
    let source: URL;
    let page: URL;
    let site: URL;
    try {
      source = parsePublicUrl(input.sourceUrl);
      page = parsePublicUrl(input.pageUrl);
      site = parsePublicUrl(input.businessWebsite);
    } catch {
      throw new HttpError(400, 'Use public http(s) addresses for the image, the page and the official website.');
    }
    if (restrictedResourceUrl(source.href)) throw new HttpError(400, 'Google and social-platform images are never downloaded. Use the business’s own site or an uploaded authorized original.');
    // The page must be the recorded website, and the image must sit on the same site: anything else
    // is a third party's file and belongs in the reference queue, not the vault.
    if (!sameSite(page.href, site.href)) throw new HttpError(400, 'The page read is not the recorded official website.');
    if (!sameSite(source.href, site.href)) throw new HttpError(400, 'That image is served by a third party. Ask the owner for the original, or upload it with permission.');

    if (serverEnv.simulateExternalTools()) {
      const bytes = simulatedPng(source.href);
      return ok({
        fileName: simulatedFileName(source.href),
        mimeType: 'image/png',
        base64: Buffer.from(bytes).toString('base64'),
        finalUrl: source.href,
        simulated: true,
      });
    }
    if (ctx.mode === 'demo') throw new HttpError(403, 'Remote downloads require an authenticated workspace. Upload the authorized original instead.');
    await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
    await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { purpose: 'visual_candidate' } }, { required: true });
    const original = await downloadResourceOriginal(source.href);
    if (!sameSite(original.finalUrl, site.href)) throw new HttpError(400, 'The file redirected away from the business’s own website, so it was not loaded.');
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
