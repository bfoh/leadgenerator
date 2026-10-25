import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { checkAssetUpload } from '@/lib/domain/studio-assets';
import { restrictedResourceUrl } from '@/lib/domain/business-resources';
import { requireContext } from '@/lib/server/context';
import { serverEnv } from '@/lib/server/env';
import { fail, HttpError, ok, readJson } from '@/lib/server/http';
import { downloadResourceOriginal, parsePublicUrl, UnsafeUrlError } from '@/lib/server/safe-fetch';
import { enforceQuota, recordUsage } from '@/lib/server/usage';
export const dynamic = 'force-dynamic';
const schema = z.object({ projectId: z.uuid(), sourceUrl: z.string().max(2000), ownerName: z.string().trim().min(2).max(200), permissionEvidence: z.string().trim().min(15).max(1000), sourceVerified: z.literal(true), inspectAuthorized: z.literal(true), storeAuthorized: z.literal(true) });
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', { count: serverEnv.simulateExternalTools() ? 2000 : 10, windowMs: 60_000 });
    const input = await readJson(req, schema, 6000);
    const sourceUrl = parsePublicUrl(input.sourceUrl).href;
    if (restrictedResourceUrl(sourceUrl)) throw new HttpError(400, 'Google and social-platform previews cannot be imported. Obtain an independent authorized original.');
    if (ctx.mode === 'cloud' && !(await new SupabaseStore(ctx.supabase, ctx.orgId).getStudioProject(input.projectId))) throw new HttpError(404, 'Vault not found in this workspace.');
    if (serverEnv.simulateExternalTools()) return ok({ fileName: 'authorized-original.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', finalUrl: sourceUrl, simulated: true });
    if (ctx.mode === 'demo') throw new HttpError(403, 'Remote imports require an authenticated workspace. Upload the owner-authorized file directly.');
    await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
    await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { purpose: 'authorized_original' } }, { required: true });
    const original = await downloadResourceOriginal(sourceUrl);
    const checked = checkAssetUpload({ fileName: original.fileName, declaredType: original.mimeType, bytes: original.bytes });
    if (!checked.ok) throw new HttpError(400, checked.problems[0]);
    return ok({ ...original, bytes: undefined, base64: Buffer.from(original.bytes).toString('base64'), simulated: false });
  } catch (e) { return fail(e instanceof UnsafeUrlError ? new HttpError(400, e.message) : e); }
}
