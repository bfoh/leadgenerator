import type { NextRequest } from 'next/server';
import { restrictedResourceUrl } from '@/lib/domain/business-resources';
import { hostOf, registrableDomain } from '@/lib/domain/web-research';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { fail, HttpError } from '@/lib/server/http';
import { simulatedPng } from '@/lib/server/resource-fixtures';
import { downloadResourceOriginal, parsePublicUrl, UnsafeUrlError } from '@/lib/server/safe-fetch';

export const dynamic = 'force-dynamic';

// A transient thumbnail for a reference the verified homepage published. The bytes are read once,
// returned with `no-store`, and never written to storage, logs or a ZIP. Google and social hosts are
// refused, and so is any address outside the recorded official website: the point of the preview is
// to help someone decide about the business's own material, not to proxy the web.

export async function GET(req: NextRequest) {
  try {
    await requireContext(req, 'studio.write', { count: 60, windowMs: 60_000 });
    const url = req.nextUrl.searchParams.get('url') ?? '';
    const website = req.nextUrl.searchParams.get('website') ?? '';
    if (!url || url.length > 2000 || !website || website.length > 2000) throw new HttpError(400, 'A preview needs an image address and the recorded website.');
    let source: URL;
    let site: URL;
    try {
      source = parsePublicUrl(url);
      site = parsePublicUrl(website);
    } catch {
      throw new HttpError(400, 'Use public http(s) addresses.');
    }
    if (restrictedResourceUrl(source.href)) throw new HttpError(400, 'Google and social-platform images are not previewed.');
    const sourceHost = hostOf(source.href);
    const siteHost = hostOf(site.href);
    if (!sourceHost || !siteHost || registrableDomain(sourceHost) !== registrableDomain(siteHost)) {
      throw new HttpError(400, 'Only images published on the business’s own website can be previewed.');
    }
    const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' };
    if (serverEnv.simulateExternalTools()) {
      return new Response(new Blob([new Uint8Array(simulatedPng(source.href))], { type: 'image/png' }), { headers });
    }
    const original = await downloadResourceOriginal(source.href);
    const finalHost = hostOf(original.finalUrl);
    if (!finalHost || registrableDomain(finalHost) !== registrableDomain(siteHost)) {
      throw new HttpError(400, 'The file redirected away from the business’s own website.');
    }
    return new Response(new Blob([new Uint8Array(original.bytes)], { type: original.mimeType }), { headers });
  } catch (e) {
    return fail(e instanceof UnsafeUrlError ? new HttpError(400, e.message) : e);
  }
}
