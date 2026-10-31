// Visual asset acquisition as the team uses it: discover references on a verified homepage, record a
// rights decision, store an authorized copy through the existing vault, and approve it in bulk.
//
// Both modes go through here. Demo mode keeps the bytes in the browser and the rows in local storage;
// cloud mode uses the private bucket and Row Level Security. The network read itself happens in the
// guarded `/api/resources/original` route, so this service never opens a socket and can be tested
// with fixed bytes.

import { checkAssetUpload } from '@/lib/domain/studio-assets';
import {
  candidateReadyToApprove,
  planVisualDiscovery,
  RIGHTS_BASIS_META,
  visualAssetDraft,
  visualCandidateEventSchema,
  visualImportProblems,
  type VisualCandidate,
  type VisualCandidateDraft,
  type VisualImportRequest,
} from '@/lib/domain/visual-acquisition';
import type { Business } from '@/lib/domain/types';
import type { StudioProject } from '@/lib/domain/studio';
import { hostOf, registrableDomain } from '@/lib/domain/web-research';
import { log, type ServiceContext } from './services';
import { approveStudioAsset, deleteStudioAsset, rejectStudioAsset, revokeStudioAsset, sha256Hex, uploadStudioAsset } from './studio-asset-services';
import { StoreError, VISUAL_ACQUISITION_MIGRATION_REQUIRED } from './store';

const now = () => new Date().toISOString();

async function requireAcquisition(ctx: ServiceContext) {
  if (!(await ctx.store.visualAcquisitionAvailable())) throw new StoreError(VISUAL_ACQUISITION_MIGRATION_REQUIRED, 'unavailable');
}

async function recordEvent(
  ctx: ServiceContext,
  candidateId: string,
  action: 'discovered' | 'imported' | 'authorization_requested' | 'rejected' | 'approved',
  note: string | null,
) {
  const parsed = visualCandidateEventSchema.safeParse({ candidateId, action, note });
  if (!parsed.success) throw new StoreError('The decision could not be recorded.', 'invalid');
  return ctx.store.createVisualCandidateEvent(parsed.data);
}

function assertProject(project: StudioProject, business: Business) {
  if (project.businessId !== business.id) throw new StoreError('The vault belongs to another prospect.', 'invalid');
}

/**
 * Records the image addresses a verified homepage published. Nothing is fetched: the row is an
 * address, what the page says about it, and an explicit "rights not established" state.
 */
export async function discoverVisualCandidates(
  ctx: ServiceContext,
  business: Business,
  project: StudioProject,
  pageUrl: string,
  drafts: VisualCandidateDraft[],
): Promise<{ created: VisualCandidate[]; skipped: { imageUrl: string; reason: string }[] }> {
  await requireAcquisition(ctx);
  assertProject(project, business);
  if (!business.officialWebsite) throw new StoreError('Record and verify the official website before collecting its images.', 'invalid');
  const pageHost = hostOf(pageUrl);
  const siteHost = hostOf(business.officialWebsite);
  if (!pageHost || !siteHost || registrableDomain(pageHost) !== registrableDomain(siteHost)) {
    throw new StoreError('Only the independently verified official website can be collected.', 'invalid');
  }
  const existing = await ctx.store.listVisualCandidates(business.id);
  const plan = planVisualDiscovery({ business, businessId: business.id, projectId: project.id, pageUrl, drafts, existing });
  if (!plan.accepted.length) return { created: [], skipped: plan.skipped };
  const created = await ctx.store.createVisualCandidates(plan.accepted);
  for (const candidate of created) await recordEvent(ctx, candidate.id, 'discovered', `Found on ${pageUrl}`);
  await log(ctx, business.id, 'studio', `Visual candidates recorded: ${created.length}`, { projectId: project.id, skipped: plan.skipped.length });
  return { created, skipped: plan.skipped };
}

export interface VisualOriginal {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  finalUrl: string;
}

/** Every refusal a person can act on, before a byte is stored. */
function importChecks(candidate: VisualCandidate, project: StudioProject, request: VisualImportRequest, original: VisualOriginal) {
  if (candidate.projectId !== project.id) throw new StoreError('That candidate belongs to another vault.', 'invalid');
  const problems = visualImportProblems(candidate, request);
  if (problems.length) throw new StoreError(problems[0], request.rightsBasis === 'not_established' ? 'forbidden' : 'invalid');
  const check = checkAssetUpload({ fileName: original.fileName, declaredType: original.mimeType, bytes: original.bytes });
  if (!check.ok || !check.file) throw new StoreError(check.problems[0] ?? 'The file could not be validated.', 'invalid');
  return check.file;
}

async function storeAuthorizedCopy(
  ctx: ServiceContext,
  business: Business,
  project: StudioProject,
  candidate: VisualCandidate,
  request: VisualImportRequest,
  original: VisualOriginal,
  importedVia: 'downloaded' | 'uploaded',
) {
  await requireAcquisition(ctx);
  assertProject(project, business);
  const file = importChecks(candidate, project, request, original);
  const checksum = await sha256Hex(original.bytes);
  const [assets, candidates] = await Promise.all([ctx.store.listStudioAssets(project.id), ctx.store.listVisualCandidates(business.id)]);
  const existingFile = assets.find((a) => a.checksumSha256 === checksum && !['rejected', 'superseded'].includes(a.status));
  if (existingFile) throw new StoreError(`This exact file is already in the vault as “${existingFile.fileName}”.`, 'conflict');
  const duplicate = candidates.find((c) => c.id !== candidate.id && c.checksumSha256 === checksum && c.status === 'imported');
  if (duplicate) throw new StoreError(`This exact file is already stored for “${duplicate.label}”.`, 'conflict');

  const asset = await uploadStudioAsset(ctx, project, {
    ...visualAssetDraft(candidate, request),
    fileName: original.fileName,
    declaredType: file.mimeType,
    bytes: original.bytes,
  });
  const updated = await ctx.store
    .updateVisualCandidate(candidate.id, {
      status: 'imported',
      rightsBasis: request.rightsBasis,
      rightsEvidence: request.evidence.trim(),
      assetId: asset.id,
      importedVia,
      checksumSha256: checksum,
      reviewedBy: ctx.userLabel,
      reviewedAt: now(),
      reviewNote: `Stored as a candidate on ${ctx.userLabel}’s rights record. Approval is separate.`,
    })
    // The bytes reached the bucket before the ledger could record them (for example a second import
    // of the same candidate won a race). Take both back, so a failed import never leaves a vault row
    // that no candidate points at and nobody approved.
    .catch(async (error: unknown) => {
      await deleteStudioAsset(ctx, project, asset).catch(() => undefined);
      throw error;
    });
  await recordEvent(ctx, candidate.id, 'imported', `${RIGHTS_BASIS_META[request.rightsBasis].label}: ${original.fileName} (${importedVia})`);
  await log(ctx, business.id, 'studio', `Visual candidate stored: ${original.fileName}`, {
    projectId: project.id,
    candidateId: candidate.id,
    assetId: asset.id,
    exportAuthorized: request.exportAuthorized,
  });
  return { candidate: updated, asset };
}

/** Copies an authorized file from the business's own verified site into the vault. */
export async function importVisualCandidate(
  ctx: ServiceContext,
  business: Business,
  project: StudioProject,
  candidate: VisualCandidate,
  request: VisualImportRequest,
  original: VisualOriginal,
) {
  if (candidate.sourceKind !== 'official_site') {
    throw new StoreError('This file is served by a third party. Upload their authorized original instead.', 'forbidden');
  }
  // A redirect may leave the verified site; then the bytes are no longer the business's own.
  const finalHost = hostOf(original.finalUrl);
  const siteHost = hostOf(business.officialWebsite);
  if (!finalHost || !siteHost || registrableDomain(finalHost) !== registrableDomain(siteHost)) {
    throw new StoreError('The file redirected away from the business’s own website, so it was not stored.', 'invalid');
  }
  return storeAuthorizedCopy(ctx, business, project, candidate, request, original, 'downloaded');
}

/** Stores a file someone with authority supplied, for a candidate that cannot be downloaded. */
export async function attachAuthorizedVisualOriginal(
  ctx: ServiceContext,
  business: Business,
  project: StudioProject,
  candidate: VisualCandidate,
  request: VisualImportRequest,
  file: { fileName: string; declaredType: string; bytes: Uint8Array },
) {
  return storeAuthorizedCopy(
    ctx,
    business,
    project,
    candidate,
    request,
    { ...file, mimeType: file.declaredType, finalUrl: candidate.imageUrl },
    'uploaded',
  );
}


/** Keeps a candidate as a link and records that the owner was asked for permission. */
export async function requestVisualAuthorization(ctx: ServiceContext, candidate: VisualCandidate, note: string): Promise<VisualCandidate> {
  await requireAcquisition(ctx);
  if (candidate.status === 'rejected') throw new StoreError('This candidate was rejected.', 'conflict');
  const clean = note.trim();
  if (clean.length < 10) throw new StoreError('Say who was asked, when and how (at least 10 characters).', 'invalid');
  const updated = await ctx.store.updateVisualCandidate(candidate.id, {
    requestedAt: now(),
    requestNote: clean.slice(0, 1000),
  });
  await recordEvent(ctx, candidate.id, 'authorization_requested', clean);
  return updated;
}

/** Closes a candidate. A stored file is rejected or revoked too, so it cannot be exported later. */
export async function rejectVisualCandidate(
  ctx: ServiceContext,
  business: Business,
  project: StudioProject,
  candidate: VisualCandidate,
  reason: string,
): Promise<VisualCandidate> {
  await requireAcquisition(ctx);
  assertProject(project, business);
  const clean = reason.trim();
  if (clean.length < 5) throw new StoreError('Say why this image cannot be used (at least 5 characters).', 'invalid');
  if (candidate.assetId) {
    const asset = await ctx.store.getStudioAsset(candidate.assetId);
    if (asset && asset.status === 'candidate') await rejectStudioAsset(ctx, project, asset, clean);
    else if (asset && asset.status === 'approved') await revokeStudioAsset(ctx, project, asset, clean);
  }
  const updated = await ctx.store.updateVisualCandidate(candidate.id, {
    status: 'rejected',
    reviewedBy: ctx.userLabel,
    reviewedAt: now(),
    reviewNote: clean.slice(0, 1000),
  });
  await recordEvent(ctx, candidate.id, 'rejected', clean);
  await log(ctx, business.id, 'studio', `Visual candidate rejected: ${candidate.label}`, { projectId: project.id, candidateId: candidate.id });
  return updated;
}

export interface BulkApprovalResult {
  approved: VisualCandidate[];
  skipped: { candidateId: string; label: string; reason: string }[];
}

/**
 * Approves selected candidates that are already stored, permitted for export and awaiting review.
 * Anything else is skipped with the reason the vault would have given, so a bulk action never hides
 * a licence gap behind a count.
 */
export async function approveVisualCandidates(
  ctx: ServiceContext,
  business: Business,
  project: StudioProject,
  candidates: VisualCandidate[],
  note = 'Approved from the visual asset queue.',
): Promise<BulkApprovalResult> {
  await requireAcquisition(ctx);
  assertProject(project, business);
  if (!candidates.length) throw new StoreError('Select at least one image to approve.', 'invalid');
  if (candidates.length > 50) throw new StoreError('Approve at most 50 images at a time.', 'invalid');
  const assets = await ctx.store.listStudioAssets(project.id);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const result: BulkApprovalResult = { approved: [], skipped: [] };
  const clean = note.trim().slice(0, 1000) || 'Approved from the visual asset queue.';
  for (const candidate of candidates) {
    const asset = candidate.assetId ? byId.get(candidate.assetId) : null;
    const problems = candidateReadyToApprove(candidate, asset);
    if (problems.length) {
      result.skipped.push({ candidateId: candidate.id, label: candidate.label, reason: problems[0] });
      continue;
    }
    await approveStudioAsset(ctx, project, asset!, clean);
    const updated = await ctx.store.updateVisualCandidate(candidate.id, {
      reviewedBy: ctx.userLabel,
      reviewedAt: now(),
      reviewNote: clean,
    });
    await recordEvent(ctx, candidate.id, 'approved', clean);
    result.approved.push(updated);
  }
  await log(ctx, business.id, 'studio', `Visual assets approved: ${result.approved.length}${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`, {
    projectId: project.id,
    approved: result.approved.length,
    skipped: result.skipped.length,
  });
  return result;
}

