import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { candidateSourceCheck } from '@/lib/domain/visual-acquisition';
import { hostOf, registrableDomain } from '@/lib/domain/web-research';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { fail, HttpError } from '@/lib/server/http';
import { simulatedPng } from '@/lib/server/resource-fixtures';
import { downloadResourceOriginal, UnsafeUrlError } from '@/lib/server/safe-fetch';
import { resolveAuthorizedSource } from '@/lib/server/visual-source';

export const dynamic = 'force-dynamic';

// A transient thumbnail for a candidate the workspace recorded. The address is read from the
// candidate row, never from the query string, so this route cannot be used to proxy the web. The
// bytes come back with `no-store` and are never written to storage, logs or a ZIP.
//
// A simulated run has no database and no network: the addresses are checked for shape and hosts,
// then a generated placeholder is returned so the flow can be reviewed. Nothing is fetched either way.

const IMAGE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'inline',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/** Simulated runs cannot read the candidate table, so they check the addresses they were given. */
function simulatedPreview(url: string, website: string) {
  if (!url || url.length > 2000 || !website || website.length > 2000) {
    throw new HttpError(400, 'A preview needs an image address and the recorded website.');
  }
  const check = candidateSourceCheck(website, url, website);
  if (!check.ok || check.sourceKind !== 'official_site') {
    throw new HttpError(400, check.problem ?? 'Only images published on the business’s own website can be previewed.');
  }
  return new Response(new Blob([new Uint8Array(simulatedPng(url))], { type: 'image/png' }), { headers: IMAGE_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', { count: 60, windowMs: 60_000 });
    const candidateId = req.nextUrl.searchParams.get('candidateId') ?? '';
    if (!z.uuid().safeParse(candidateId).success) throw new HttpError(400, 'A preview needs a recorded candidate.');

    if (serverEnv.simulateExternalTools()) {
      return simulatedPreview(req.nextUrl.searchParams.get('url') ?? '', req.nextUrl.searchParams.get('website') ?? '');
    }
    if (ctx.mode !== 'cloud') throw new HttpError(403, 'Remote previews require an authenticated workspace.');

    const { candidate, business } = await resolveAuthorizedSource(new SupabaseStore(ctx.supabase, ctx.orgId), candidateId);
    const original = await downloadResourceOriginal(candidate.imageUrl);
    const finalHost = hostOf(original.finalUrl);
    const siteHost = hostOf(business.officialWebsite);
    if (!finalHost || !siteHost || registrableDomain(finalHost) !== registrableDomain(siteHost)) {
      throw new HttpError(400, 'The file redirected away from the business’s own website.');
    }
    return new Response(new Blob([new Uint8Array(original.bytes)], { type: original.mimeType }), { headers: IMAGE_HEADERS });
  } catch (e) {
    return fail(e instanceof UnsafeUrlError ? new HttpError(400, e.message) : e);
  }
}
