// The Business Asset Vault as the team uses it. Both modes go through here, so demo and cloud apply
// the same rules: a file is validated before it is stored, every decision is an append-only event,
// only an approved, unexpired asset with the right permission can leave in a pack, and a Brand Kit
// can only name files the concept has approved.

import { slug } from '@/lib/utils';
import {
  ASSET_KIND_META,
  assetApprovalProblems,
  assetDownloadName,
  assetExportProblems,
  assetStoragePath,
  brandKitAssetIds,
  brandKitProblems,
  brandKitSummary,
  checkAssetUpload,
  currentBrandKitApproval,
  latestBrandKitVersion,
  parseBrandKitContent,
  type AssetPermissionState,
  type BrandKitContent,
  type StudioAsset,
  type StudioAssetEventAction,
  type StudioAssetKind,
  type StudioAssetOrigin,
  type StudioAssetReference,
  type StudioAssetReferenceSource,
  type StudioBrandKit,
  type StudioBrandKitApproval,
  type StudioBrandKitVersion,
} from '@/lib/domain/studio-assets';
import type { StudioProject } from '@/lib/domain/studio';
import { createZip } from '@/lib/domain/zip';
import type { AssetStorage } from './asset-storage';
import { log, type ServiceContext } from './services';
import { ASSET_VAULT_MIGRATION_REQUIRED, StoreError } from './store';

const now = () => new Date().toISOString();

async function requireVault(ctx: ServiceContext) {
  if (!(await ctx.store.assetVaultAvailable())) throw new StoreError(ASSET_VAULT_MIGRATION_REQUIRED, 'unavailable');
}

function storage(ctx: ServiceContext): AssetStorage {
  if (!ctx.assets) throw new StoreError('File storage is not available in this context.', 'unavailable');
  return ctx.assets;
}

/** The file's fingerprint, stored so a pack can prove what it contained. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export interface AssetUploadInput {
  fileName: string;
  declaredType: string;
  bytes: Uint8Array;
  kind: StudioAssetKind;
  origin: StudioAssetOrigin;
  ownerName: string;
  supplier?: string | null;
  sourceUrl?: string | null;
  licenceName?: string | null;
  licenceReference?: string | null;
  licenceExpiresOn?: string | null;
  attributionRequired?: boolean;
  attributionText?: string | null;
  permissionEvidence: string;
  inspectPermission: AssetPermissionState;
  storePermission: AssetPermissionState;
  prototypePermission: AssetPermissionState;
  exportPermission: AssetPermissionState;
  publishPermission: AssetPermissionState;
  note?: string;
  supersedesId?: string | null;
}

async function recordEvent(ctx: ServiceContext, project: StudioProject, asset: StudioAsset, action: StudioAssetEventAction, note: string | null) {
  return ctx.store.createStudioAssetEvent({ projectId: project.id, assetId: asset.id, action, note });
}

/**
 * Validates, stores and records one file. Bytes are written first and the record second; if the
 * record is refused the stored object is removed, so an orphan cannot accumulate in the bucket.
 */
export async function uploadStudioAsset(ctx: ServiceContext, project: StudioProject, input: AssetUploadInput): Promise<StudioAsset> {
  await requireVault(ctx);
  const files = storage(ctx);
  if (project.status === 'archived') throw new StoreError('This concept is archived. Restore it before adding an asset.', 'conflict');

  const check = checkAssetUpload({ fileName: input.fileName, declaredType: input.declaredType, bytes: input.bytes });
  if (!check.ok || !check.file) throw new StoreError(check.problems[0] ?? 'The file could not be validated.', 'invalid');
  const file = check.file;
  if (!ASSET_KIND_META[input.kind].fileClasses.includes(file.fileClass)) {
    throw new StoreError(`${ASSET_KIND_META[input.kind].label} cannot be a ${file.mimeType} file. Choose a kind that matches the file.`, 'invalid');
  }

  const assetId = crypto.randomUUID();
  const path = assetStoragePath(project.organizationId, project.id, assetId, input.fileName, file.extension);
  const checksum = await sha256Hex(input.bytes);
  await files.put(path, input.bytes, file.mimeType);

  try {
    const asset = await ctx.store.createStudioAsset({
      id: assetId,
      projectId: project.id,
      fileName: input.fileName.trim(),
      kind: input.kind,
      mimeType: file.mimeType,
      bytes: input.bytes.length,
      width: file.width,
      height: file.height,
      checksumSha256: checksum,
      storagePath: path,
      origin: input.origin,
      ownerName: input.ownerName.trim(),
      supplier: input.supplier?.trim() || null,
      sourceUrl: input.sourceUrl?.trim() || null,
      licenceName: input.licenceName?.trim() || null,
      licenceReference: input.licenceReference?.trim() || null,
      licenceExpiresOn: input.licenceExpiresOn || null,
      attributionRequired: input.attributionRequired ?? false,
      attributionText: input.attributionText?.trim() || null,
      permissionEvidence: input.permissionEvidence.trim(),
      inspectPermission: input.inspectPermission,
      storePermission: input.storePermission,
      prototypePermission: input.prototypePermission,
      exportPermission: input.exportPermission,
      publishPermission: input.publishPermission,
      note: input.note ?? '',
      supersedesId: input.supersedesId ?? null,
    });
    await recordEvent(ctx, project, asset, 'uploaded', `${asset.fileName} added to the vault`);
    await log(ctx, project.businessId, 'studio', `Asset added: ${asset.fileName} (${ASSET_KIND_META[asset.kind].label})`, {
      projectId: project.id,
      assetId: asset.id,
      bytes: asset.bytes,
      mimeType: asset.mimeType,
    });
    return asset;
  } catch (error) {
    await files.remove([path]).catch(() => undefined);
    throw error;
  }
}

/** Replacing keeps the old file and its history, and starts the new one as a candidate again. */
export async function replaceStudioAsset(
  ctx: ServiceContext,
  project: StudioProject,
  asset: StudioAsset,
  file: { fileName: string; declaredType: string; bytes: Uint8Array },
  note: string,
): Promise<StudioAsset> {
  await requireVault(ctx);
  if (asset.status === 'superseded') throw new StoreError('This asset was already replaced.', 'conflict');
  const replacement = await uploadStudioAsset(ctx, project, {
    ...file,
    kind: asset.kind,
    origin: asset.origin,
    ownerName: asset.ownerName,
    supplier: asset.supplier,
    sourceUrl: asset.sourceUrl,
    licenceName: asset.licenceName,
    licenceReference: asset.licenceReference,
    licenceExpiresOn: asset.licenceExpiresOn,
    attributionRequired: asset.attributionRequired,
    attributionText: asset.attributionText,
    permissionEvidence: asset.permissionEvidence,
    inspectPermission: asset.inspectPermission,
    storePermission: asset.storePermission,
    prototypePermission: asset.prototypePermission,
    exportPermission: asset.exportPermission,
    publishPermission: asset.publishPermission,
    supersedesId: asset.id,
  });
  const updated = await ctx.store.updateStudioAsset(asset.id, {
    status: 'superseded',
    reviewNote: note.trim() || `Replaced by ${replacement.fileName}.`,
  });
  await recordEvent(ctx, project, updated, 'replaced', `Replaced by ${replacement.fileName}`);
  await log(ctx, project.businessId, 'studio', `Asset replaced: ${asset.fileName} → ${replacement.fileName}`, {
    projectId: project.id,
    assetId: asset.id,
    replacementId: replacement.id,
  });
  return replacement;
}

/** A person approves a candidate, with the reason on record. The permission must already be there. */
export async function approveStudioAsset(ctx: ServiceContext, project: StudioProject, asset: StudioAsset, note: string): Promise<StudioAsset> {
  await requireVault(ctx);
  const problems = assetApprovalProblems(asset);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  const updated = await ctx.store.updateStudioAsset(asset.id, { status: 'approved', reviewNote: note.trim() || null });
  await recordEvent(ctx, project, updated, 'approved', note.trim() || 'Approved');
  await log(ctx, project.businessId, 'studio', `Asset approved: ${asset.fileName}`, { projectId: project.id, assetId: asset.id });
  return updated;
}


export async function rejectStudioAsset(ctx: ServiceContext, project: StudioProject, asset: StudioAsset, reason: string): Promise<StudioAsset> {
  await requireVault(ctx);
  if (reason.trim().length < 3) throw new StoreError('Explain why the asset was rejected.', 'invalid');
  if (asset.status === 'superseded') throw new StoreError('A replaced asset cannot be rejected.', 'conflict');
  const updated = await ctx.store.updateStudioAsset(asset.id, { status: 'rejected', rejectedReason: reason.trim(), reviewNote: reason.trim() });
  await recordEvent(ctx, project, updated, 'rejected', reason.trim());
  await log(ctx, project.businessId, 'studio', `Asset rejected: ${asset.fileName}`, { projectId: project.id, assetId: asset.id, reason: reason.trim() });
  return updated;
}

/** Revoking is not deleting: the file stays as evidence that permission was withdrawn. */
export async function revokeStudioAsset(ctx: ServiceContext, project: StudioProject, asset: StudioAsset, reason: string): Promise<StudioAsset> {
  await requireVault(ctx);
  if (reason.trim().length < 3) throw new StoreError('Explain why the permission was revoked.', 'invalid');
  if (asset.status !== 'approved') throw new StoreError('Only an approved asset can have its permission revoked.', 'conflict');
  const updated = await ctx.store.updateStudioAsset(asset.id, {
    status: 'revoked',
    revokedReason: reason.trim(),
    reviewNote: reason.trim(),
    publishPermission: 'denied',
    exportPermission: 'denied',
    prototypePermission: 'denied',
  });
  await recordEvent(ctx, project, updated, 'revoked', reason.trim());
  const kit = await ctx.store.getStudioBrandKit(project.id);
  const versions = kit ? await ctx.store.listStudioBrandKitVersions(kit.id) : [];
  const affected = versions.filter((version) => brandKitAssetIds(version.content).includes(asset.id)).length;
  await log(
    ctx,
    project.businessId,
    'studio',
    `Asset permission revoked: ${asset.fileName}${affected ? ` (${affected} brand kit version${affected === 1 ? '' : 's'} referenced it)` : ''}`,
    { projectId: project.id, assetId: asset.id, reason: reason.trim(), affectedKitVersions: affected },
  );
  return updated;
}

export async function annotateStudioAsset(ctx: ServiceContext, project: StudioProject, asset: StudioAsset, note: string): Promise<StudioAsset> {
  await requireVault(ctx);
  if (note.trim().length < 3) throw new StoreError('Write a note of at least three characters.', 'invalid');
  if (note.length > 2000) throw new StoreError('A note is limited to 2,000 characters.', 'invalid');
  const updated = await ctx.store.updateStudioAsset(asset.id, { note: note.trim() });
  await recordEvent(ctx, project, updated, 'annotated', note.trim());
  return updated;
}

/** Deletes the record and the stored bytes. Owners and admins only (RLS, and the UI). */
export async function deleteStudioAsset(ctx: ServiceContext, project: StudioProject, asset: StudioAsset): Promise<void> {
  await requireVault(ctx);
  await storage(ctx).remove([asset.storagePath]);
  await ctx.store.deleteStudioAsset(asset.id);
  await log(ctx, project.businessId, 'studio', `Asset deleted: ${asset.fileName}`, { projectId: project.id, assetId: asset.id, deleted: true });
}

// ── Remote references ──────────────────────────────────────────────────────────────────────────

/** Records where someone else's material lives. No bytes are fetched, and nothing is rendered. */
export async function recordStudioAssetReference(
  ctx: ServiceContext,
  project: StudioProject,
  input: { address: string; label: string; source: StudioAssetReferenceSource; note?: string | null },
): Promise<StudioAssetReference> {
  await requireVault(ctx);
  const reference = await ctx.store.createStudioAssetReference({
    projectId: project.id,
    address: input.address.trim(),
    label: input.label.trim(),
    source: input.source,
    note: input.note?.trim() || null,
    status: 'recorded',
  });
  await log(ctx, project.businessId, 'studio', `Reference recorded, not imported: ${reference.label}`, { projectId: project.id, referenceId: reference.id, host: safeHost(reference.address) });
  return reference;
}

export async function declineStudioAssetReference(ctx: ServiceContext, project: StudioProject, reference: StudioAssetReference, note: string): Promise<StudioAssetReference> {
  await requireVault(ctx);
  const updated = await ctx.store.updateStudioAssetReference(reference.id, { status: 'declined', note: note.trim() || reference.note });
  await log(ctx, project.businessId, 'studio', `Reference declined: ${reference.label}`, { projectId: project.id, referenceId: reference.id });
  return updated;
}

function safeHost(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}


// ── Brand Kit ──────────────────────────────────────────────────────────────────────────────────

/** Saves the next immutable version. Drafts may be incomplete; approving one has its own gate. */
export async function saveBrandKitVersion(
  ctx: ServiceContext,
  project: StudioProject,
  content: BrandKitContent,
  note: string,
): Promise<{ kit: StudioBrandKit; version: StudioBrandKitVersion }> {
  await requireVault(ctx);
  const kit = (await ctx.store.getStudioBrandKit(project.id)) ?? (await ctx.store.createStudioBrandKit(project.id));
  const versions = await ctx.store.listStudioBrandKitVersions(kit.id);
  const next = (latestBrandKitVersion(versions)?.version ?? 0) + 1;
  const version = await ctx.store.createStudioBrandKitVersion({
    kitId: kit.id,
    projectId: project.id,
    version: next,
    content: parseBrandKitContent(content),
    note: note.trim(),
  });
  await log(ctx, project.businessId, 'studio', `Brand Kit version ${next} saved: ${brandKitSummary(version.content)}`, {
    projectId: project.id,
    kitId: kit.id,
    versionId: version.id,
    version: next,
  });
  return { kit, version };
}

/** Approving names the person and the version the later design phases must build from. */
export async function approveBrandKitVersion(
  ctx: ServiceContext,
  project: StudioProject,
  version: StudioBrandKitVersion,
  note: string,
): Promise<StudioBrandKitApproval> {
  await requireVault(ctx);
  if (note.trim().length < 3) throw new StoreError('Explain what was approved.', 'invalid');
  const kit = await ctx.store.getStudioBrandKit(project.id);
  if (!kit || kit.id !== version.kitId) throw new StoreError('That Brand Kit version does not belong to this concept.', 'invalid');
  const assets = await ctx.store.listStudioAssets(project.id);
  const problems = brandKitProblems(version.content, assets, { forApproval: true });
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  const approval = await ctx.store.createStudioBrandKitApproval({
    kitId: kit.id,
    projectId: project.id,
    versionId: version.id,
    note: note.trim(),
  });
  await log(ctx, project.businessId, 'studio', `Brand Kit version ${version.version} approved: ${brandKitSummary(version.content)}`, {
    projectId: project.id,
    kitId: kit.id,
    versionId: version.id,
    version: version.version,
  });
  return approval;
}

/** The version the design phases should use: the latest approved one, or null. */
export async function approvedBrandKit(ctx: ServiceContext, project: StudioProject): Promise<{ kit: StudioBrandKit; version: StudioBrandKitVersion } | null> {
  const kit = await ctx.store.getStudioBrandKit(project.id);
  if (!kit) return null;
  const approvals = await ctx.store.listStudioBrandKitApprovals(kit.id);
  const current = currentBrandKitApproval(approvals);
  if (!current) return null;
  const versions = await ctx.store.listStudioBrandKitVersions(kit.id);
  const version = versions.find((v) => v.id === current.versionId);
  return version ? { kit, version } : null;
}

// ── Approved export ────────────────────────────────────────────────────────────────────────────

export interface AssetPackManifest {
  format: 'dof-asset-pack/1';
  generatedAt: string;
  concept: { name: string; websiteUrl: string | null };
  approvedBrandKit: { version: number; approvedAt: string | null } | null;
  assets: {
    path: string;
    fileName: string;
    kind: StudioAssetKind;
    mimeType: string;
    bytes: number;
    sha256: string;
    origin: StudioAssetOrigin;
    ownerName: string;
    licence: { name: string; reference: string | null; expiresOn: string | null } | null;
    attribution: { required: boolean; text: string | null };
    permissions: { prototype: string; export: string; publish: string };
    approvedAt: string | null;
  }[];
  /** Files left out because they are unapproved, replaced, expired or not exportable. */
  excludedCount: number;
  note: string;
}

export interface AssetPack {
  zip: Uint8Array;
  filename: string;
  manifest: AssetPackManifest;
  included: number;
  excluded: number;
}

const encoder = new TextEncoder();

/**
 * Builds a pack from approved, unexpired, export-authorized files only. Rejected, restricted,
 * replaced and expired assets are counted but never read, so no excluded file can slip into the ZIP.
 */
export async function exportStudioAssetPack(ctx: ServiceContext, project: StudioProject): Promise<AssetPack> {
  await requireVault(ctx);
  const files = storage(ctx);
  const assets = await ctx.store.listStudioAssets(project.id);
  const eligible = assets.filter((asset) => assetExportProblems(asset).length === 0);
  const excluded = assets.length - eligible.length;
  if (!eligible.length) throw new StoreError('There is nothing in this pack yet: no asset is approved with export permission and a current licence.', 'conflict');

  const approvedKit = await approvedBrandKit(ctx, project);
  const ordered = [...eligible].sort((a, b) => a.kind.localeCompare(b.kind) || a.fileName.localeCompare(b.fileName));
  const entries: { name: string; data: Uint8Array }[] = [];
  const manifestAssets: AssetPackManifest['assets'] = [];

  for (const [index, asset] of ordered.entries()) {
    const stored = await files.get(asset.storagePath);
    if (!stored) throw new StoreError(`“${asset.fileName}” is approved but its stored file is missing. Replace it before exporting.`, 'unavailable');
    const path = `assets/${String(index + 1).padStart(3, '0')}-${assetDownloadName(asset)}`;
    entries.push({ name: path, data: stored.bytes });
    manifestAssets.push({
      path,
      fileName: asset.fileName,
      kind: asset.kind,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      sha256: asset.checksumSha256,
      origin: asset.origin,
      ownerName: asset.ownerName,
      licence: asset.licenceName ? { name: asset.licenceName, reference: asset.licenceReference, expiresOn: asset.licenceExpiresOn } : null,
      attribution: { required: asset.attributionRequired, text: asset.attributionText },
      permissions: { prototype: asset.prototypePermission, export: asset.exportPermission, publish: asset.publishPermission },
      approvedAt: asset.approvedAt,
    });
  }

  const attributed = ordered.filter((asset) => asset.attributionRequired && asset.attributionText);
  if (attributed.length) {
    entries.push({
      name: 'ATTRIBUTION.txt',
      data: encoder.encode(
        [
          `Attribution required for ${project.name}`,
          '',
          ...attributed.map((asset) => `${asset.fileName} — ${asset.attributionText}`),
          '',
          'These credits must appear where the material is published.',
        ].join('\n'),
      ),
    });
  }

  const manifest: AssetPackManifest = {
    format: 'dof-asset-pack/1',
    generatedAt: now(),
    concept: { name: project.name, websiteUrl: project.websiteUrl },
    approvedBrandKit: approvedKit ? { version: approvedKit.version.version, approvedAt: currentBrandKitApproval(await ctx.store.listStudioBrandKitApprovals(approvedKit.kit.id))?.approvedAt ?? null } : null,
    assets: manifestAssets,
    excludedCount: excluded,
    note: 'Only approved assets with export permission and a current licence are included. A brand kit version does not grant permission to publish any file.',
  };
  entries.push({ name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest, null, 2)) });

  const zip = createZip(entries, new Date(manifest.generatedAt));
  const manifestHash = await sha256Hex(encoder.encode(JSON.stringify(manifest)));
  await log(ctx, project.businessId, 'studio', `Asset pack exported: ${ordered.length} file${ordered.length === 1 ? '' : 's'}${excluded ? `, ${excluded} excluded` : ''}`, {
    projectId: project.id,
    included: ordered.length,
    excluded,
    manifestSha256: manifestHash,
  });

  return {
    zip,
    filename: `${slug(project.name)}-asset-pack-${manifest.generatedAt.slice(0, 10)}.zip`,
    manifest,
    included: ordered.length,
    excluded,
  };
}
