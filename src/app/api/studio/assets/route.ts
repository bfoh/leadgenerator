import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { SupabaseAssetStorage } from '@/lib/data/asset-storage';
import { SupabaseStore } from '@/lib/data/supabase-store';
import { uploadStudioAsset } from '@/lib/data/studio-asset-services';
import {
  ASSET_KINDS,
  ASSET_ORIGINS,
  MAX_ASSET_BYTES,
  PERMISSION_STATES,
  formatBytes,
} from '@/lib/domain/studio-assets';
import { requireContext } from '@/lib/server/context';
import { HttpError, fail, ok } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

// Cloud-mode uploads pass through here rather than straight from the browser, so the declared type,
// the bytes, the size and the concept are checked on the server before anything is stored. Demo mode
// never calls this route: its files stay in the browser and go through the same service directly.

const metaSchema = z.object({
  projectId: z.uuid(),
  kind: z.enum(ASSET_KINDS),
  origin: z.enum(ASSET_ORIGINS),
  ownerName: z.string().trim().min(2).max(200),
  supplier: z.string().trim().max(200).nullish(),
  sourceUrl: z.string().trim().max(2000).nullish(),
  licenceName: z.string().trim().max(200).nullish(),
  licenceReference: z.string().trim().max(500).nullish(),
  licenceExpiresOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  attributionRequired: z.boolean().optional(),
  attributionText: z.string().trim().max(400).nullish(),
  permissionEvidence: z.string().trim().min(10).max(1000),
  inspectPermission: z.enum(PERMISSION_STATES),
  storePermission: z.enum(PERMISSION_STATES),
  prototypePermission: z.enum(PERMISSION_STATES),
  exportPermission: z.enum(PERMISSION_STATES),
  publishPermission: z.enum(PERMISSION_STATES),
  note: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContext(req, 'studio.write', { count: 20, windowMs: 60_000 });
    if (ctx.mode !== 'cloud') {
      throw new HttpError(400, 'Demo mode keeps asset files in this browser. Upload from the Studio directly.');
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, 'Send the file as multipart form data.');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose a file to upload.');
    if (!file.size) throw new HttpError(400, 'The file is empty.');
    if (file.size > MAX_ASSET_BYTES) throw new HttpError(413, `The file is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_ASSET_BYTES)}.`);

    const raw = form.get('metadata');
    if (typeof raw !== 'string') throw new HttpError(400, 'The asset details are missing.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'The asset details must be JSON.');
    }
    const meta = metaSchema.parse(parsed);

    const store = new SupabaseStore(ctx.supabase, ctx.orgId);
    const project = await store.getStudioProject(meta.projectId);
    if (!project) throw new HttpError(404, 'Website concept not found.');
    const settings = await store.getSettings();
    const userLabel = (await ctx.supabase.auth.getUser()).data.user?.email ?? 'Team member';
    const bytes = new Uint8Array(await file.arrayBuffer());

    const asset = await uploadStudioAsset(
      { store, settings, userId: ctx.userId, userLabel, assets: new SupabaseAssetStorage(ctx.supabase) },
      project,
      {
        ...meta,
        fileName: file.name,
        declaredType: file.type || 'application/octet-stream',
        bytes,
        supplier: meta.supplier ?? null,
        sourceUrl: meta.sourceUrl ?? null,
        licenceName: meta.licenceName ?? null,
        licenceReference: meta.licenceReference ?? null,
        licenceExpiresOn: meta.licenceExpiresOn ?? null,
        attributionText: meta.attributionText ?? null,
      },
    );
    return ok({ asset }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
