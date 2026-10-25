// Creative direction as the team uses it. Both modes go through here: the same gates apply to the
// browser demo and to Supabase. A direction needs an approved Brand Kit, a confirmed brief, and only
// assets the vault has cleared for a private prototype. Approval is always a named person's decision.

import {
  approvedConcept,
  briefProblems,
  briefSummary,
  buildCreativeBrief,
  conceptApprovalProblems,
  currentDirectionApproval,
  directionProblems,
  directionSummary,
  generateCreativeDirection,
  latestBriefConfirmation,
  reviseBrief,
  reviseConcept,
  type BriefPreferences,
  type ConceptEdit,
  type CreativeBriefContent,
  type StudioCreativeBrief,
  type StudioCreativeBriefReview,
  type StudioCreativeDirection,
  type StudioCreativeDirectionReview,
} from '@/lib/domain/creative-direction';
import { currentBrandKitApproval, type StudioAsset, type StudioBrandKitVersion } from '@/lib/domain/studio-assets';
import type { StudioProject } from '@/lib/domain/studio';
import { approvedBrandKit } from './studio-asset-services';
import { log, type ServiceContext } from './services';
import { CREATIVE_DIRECTION_MIGRATION_REQUIRED, StoreError } from './store';

async function requireCreativeDirection(ctx: ServiceContext) {
  if (!(await ctx.store.assetVaultAvailable())) throw new StoreError('The asset vault migration is required before creative direction.', 'unavailable');
  if (!(await ctx.store.creativeDirectionSchemaAvailable())) throw new StoreError(CREATIVE_DIRECTION_MIGRATION_REQUIRED, 'unavailable');
}

async function requireBriefAssets(ctx: ServiceContext, project: StudioProject): Promise<StudioAsset[]> {
  return ctx.store.listStudioAssets(project.id);
}

interface ApprovedKit {
  version: StudioBrandKitVersion;
  approvedAt: string | null;
}

/** The Brand Kit version phase 3 builds from, with the timestamp of its approval. */
export async function creativeKit(ctx: ServiceContext, project: StudioProject): Promise<ApprovedKit> {
  const approved = await approvedBrandKit(ctx, project);
  if (!approved) throw new StoreError('Approve a Brand Kit version before creative direction begins.', 'conflict');
  const approvals = await ctx.store.listStudioBrandKitApprovals(approved.kit.id);
  const approval = currentBrandKitApproval(approvals);
  return { version: approved.version, approvedAt: approval?.approvedAt ?? null };
}

async function latestBriefWithConfirmation(ctx: ServiceContext, project: StudioProject): Promise<{ brief: StudioCreativeBrief; confirmation: StudioCreativeBriefReview }> {
  const briefs = await ctx.store.listStudioCreativeBriefs(project.id);
  const brief = briefs[0];
  if (!brief) throw new StoreError('Write and confirm a Creative Direction Brief first.', 'conflict');
  const reviews = await ctx.store.listStudioCreativeBriefReviews(project.id);
  const confirmation = latestBriefConfirmation(reviews);
  if (!confirmation || confirmation.briefId !== brief.id) throw new StoreError('Confirm the latest Creative Direction Brief before proposing directions.', 'conflict');
  return { brief, confirmation };
}

function nextVersion<T extends { version: number }>(rows: readonly T[]): number {
  return Math.max(0, ...rows.map((row) => row.version)) + 1;
}

/**
 * Builds the brief from the approved kit and the reviewed evidence, or saves a person's revision of
 * it. Existing versions are never edited.
 */
export async function saveCreativeBrief(
  ctx: ServiceContext,
  project: StudioProject,
  options: { content?: CreativeBriefContent; note?: string; preferences?: BriefPreferences } = {},
): Promise<StudioCreativeBrief> {
  await requireCreativeDirection(ctx);
  if (project.status === 'archived') throw new StoreError('This concept is archived. Restore it before writing a brief.', 'conflict');
  const business = await ctx.store.getBusiness(project.businessId);
  if (!business) throw new StoreError('The prospect for this concept no longer exists.', 'not_found');
  const assets = await requireBriefAssets(ctx, project);
  const observations = await ctx.store.listStudioObservations(project.id);
  const reviews = await ctx.store.listStudioReviews(project.id);
  const briefs = await ctx.store.listStudioCreativeBriefs(project.id);
  const kit = (await approvedBrandKit(ctx, project)) ?? null;
  const kitApproval = kit ? currentBrandKitApproval(await ctx.store.listStudioBrandKitApprovals(kit.kit.id)) : null;

  let content = options.content;
  if (!content) {
    if (options.preferences) {
      if (!briefs[0]) throw new StoreError('There is no brief to revise yet.', 'conflict');
      content = reviseBrief(briefs[0].content, options.preferences);
    } else {
      content = buildCreativeBrief({
        project,
        business,
        observations,
        reviews,
        kit: kit ? { versionId: kit.version.id, version: kit.version.version, approvedAt: kitApproval?.approvedAt ?? null, content: kit.version.content } : null,
        assets,
      });
    }
  }

  const problems = briefProblems(content, assets);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  const version = nextVersion(briefs);
  const saved = await ctx.store.createStudioCreativeBrief({ projectId: project.id, version, content, note: (options.note ?? '').trim() });
  await log(ctx, project.businessId, 'studio', `Creative brief version ${version} saved: ${briefSummary(content)}`, {
    projectId: project.id,
    briefId: saved.id,
    version,
  });
  return saved;
}

/**
 * A person's confirmation is the gate to phase 3. Blocking licence and kit gaps must be resolved; open
 * questions about the business may remain, because they are recorded as questions rather than filled
 * with assumptions.
 */
export async function confirmCreativeBrief(ctx: ServiceContext, project: StudioProject, brief: StudioCreativeBrief, note: string): Promise<StudioCreativeBriefReview> {
  await requireCreativeDirection(ctx);
  if (note.trim().length < 3) throw new StoreError('Explain what you are confirming.', 'invalid');
  const assets = await requireBriefAssets(ctx, project);
  const problems = briefProblems(brief.content, assets);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  if (!brief.content.brandKit) throw new StoreError('Approve a Brand Kit before confirming the brief.', 'conflict');
  const licenceGap = brief.content.missingInformation.find((item) => item.blocking && item.source === 'licence');
  if (licenceGap) throw new StoreError(licenceGap.question, 'conflict');
  const review = await ctx.store.createStudioCreativeBriefReview({ projectId: project.id, briefId: brief.id, decision: 'confirm', note: note.trim() });
  await log(ctx, project.businessId, 'studio', `Creative brief version ${brief.version} confirmed`, { projectId: project.id, briefId: brief.id, version: brief.version });
  return review;
}

export async function reviewCreativeBrief(
  ctx: ServiceContext,
  project: StudioProject,
  brief: StudioCreativeBrief,
  decision: 'reject' | 'note',
  note: string,
): Promise<StudioCreativeBriefReview> {
  await requireCreativeDirection(ctx);
  const review = await ctx.store.createStudioCreativeBriefReview({ projectId: project.id, briefId: brief.id, decision, note: note.trim() });
  await log(ctx, project.businessId, 'studio', `Creative brief version ${brief.version} ${decision === 'reject' ? 'rejected' : 'noted'}`, {
    projectId: project.id,
    briefId: brief.id,
    decision,
  });
  return review;
}

export async function saveCreativeDirection(
  ctx: ServiceContext,
  project: StudioProject,
  options: { seed?: string; note?: string } = {},
): Promise<StudioCreativeDirection> {
  await requireCreativeDirection(ctx);
  if (project.status === 'archived') throw new StoreError('This concept is archived. Restore it before proposing directions.', 'conflict');
  const business = await ctx.store.getBusiness(project.businessId);
  if (!business) throw new StoreError('The prospect for this concept no longer exists.', 'not_found');
  const { brief } = await latestBriefWithConfirmation(ctx, project);
  const kit = await creativeKit(ctx, project);
  const assets = await requireBriefAssets(ctx, project);
  const briefCheck = briefProblems(brief.content, assets);
  if (briefCheck.length) throw new StoreError(briefCheck[0], 'invalid');
  if (brief.content.brandKit?.versionId !== kit.version.id) {
    throw new StoreError('The brief was written against a different Brand Kit version. Save and confirm a new brief.', 'conflict');
  }

  const content = generateCreativeDirection({
    project,
    business,
    brief: brief.content,
    briefVersionId: brief.id,
    briefVersion: brief.version,
    kit: { versionId: kit.version.id, version: kit.version.version, content: kit.version.content },
    assets,
    seed: options.seed,
  });
  const problems = directionProblems(content, brief.content, assets);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  const directions = await ctx.store.listStudioCreativeDirections(project.id);
  const version = nextVersion(directions);
  const saved = await ctx.store.createStudioCreativeDirection({
    projectId: project.id,
    briefId: brief.id,
    version,
    content,
    generatedBy: 'deterministic',
    derivedFromId: null,
    note: (options.note ?? '').trim(),
  });
  await log(ctx, project.businessId, 'studio', `Creative direction version ${version} proposed: ${directionSummary(content)}`, {
    projectId: project.id,
    directionId: saved.id,
    version,
    briefVersion: brief.version,
  });
  return saved;
}

/** A person's edit becomes a new immutable direction version; the brief and asset references do not change. */
export async function saveDirectionRevision(
  ctx: ServiceContext,
  project: StudioProject,
  direction: StudioCreativeDirection,
  conceptKey: string,
  edit: ConceptEdit,
  note: string,
): Promise<StudioCreativeDirection> {
  await requireCreativeDirection(ctx);
  if (note.trim().length < 3) throw new StoreError('Explain what changed and why.', 'invalid');
  const { brief } = await latestBriefWithConfirmation(ctx, project);
  if (brief.id !== direction.briefId) throw new StoreError('The brief has changed. Propose new directions from the confirmed brief.', 'conflict');
  const kit = await creativeKit(ctx, project);
  const assets = await requireBriefAssets(ctx, project);
  let content;
  try {
    content = reviseConcept(direction.content, conceptKey, edit, brief.content);
  } catch (error) {
    throw new StoreError(error instanceof Error ? error.message : 'The concept could not be edited.', 'invalid');
  }
  const problems = directionProblems(content, brief.content, assets);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  const directions = await ctx.store.listStudioCreativeDirections(project.id);
  const saved = await ctx.store.createStudioCreativeDirection({
    projectId: project.id,
    briefId: brief.id,
    version: nextVersion(directions),
    content,
    generatedBy: 'deterministic',
    derivedFromId: direction.id,
    note: note.trim(),
  });
  await log(ctx, project.businessId, 'studio', `Creative direction revised (version ${saved.version})`, {
    projectId: project.id,
    directionId: saved.id,
    derivedFromId: direction.id,
    conceptKey,
    kitVersion: kit.version.version,
  });
  return saved;
}

export async function recordDirectionFeedback(
  ctx: ServiceContext,
  project: StudioProject,
  direction: StudioCreativeDirection,
  conceptKey: string,
  decision: 'feedback' | 'request_changes' | 'reject',
  note: string,
): Promise<StudioCreativeDirectionReview> {
  await requireCreativeDirection(ctx);
  const review = await ctx.store.createStudioCreativeDirectionReview({ projectId: project.id, directionId: direction.id, conceptKey, decision, note: note.trim() });
  const concept = direction.content.concepts.find((entry) => entry.key === conceptKey)?.name ?? conceptKey;
  const label = decision === 'feedback' ? 'Feedback recorded' : decision === 'request_changes' ? 'Changes requested' : 'Concept rejected';
  await log(ctx, project.businessId, 'studio', `${label} on ${concept}`, { projectId: project.id, directionId: direction.id, conceptKey, decision });
  return review;
}

/** Approval names the person, the direction version and the concept; a later request revokes it. */
export async function approveDirectionConcept(
  ctx: ServiceContext,
  project: StudioProject,
  direction: StudioCreativeDirection,
  conceptKey: string,
  note: string,
): Promise<StudioCreativeDirectionReview> {
  await requireCreativeDirection(ctx);
  const { brief } = await latestBriefWithConfirmation(ctx, project);
  if (brief.id !== direction.briefId) throw new StoreError('The brief has changed. Approve a direction built from the confirmed brief.', 'conflict');
  const assets = await requireBriefAssets(ctx, project);
  const directionIssues = directionProblems(direction.content, brief.content, assets);
  if (directionIssues.length) throw new StoreError(directionIssues[0], 'invalid');
  const problems = conceptApprovalProblems(direction.content, conceptKey);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  const concept = direction.content.concepts.find((entry) => entry.key === conceptKey);
  const review = await ctx.store.createStudioCreativeDirectionReview({ projectId: project.id, directionId: direction.id, conceptKey, decision: 'approve', note: note.trim() });
  await log(ctx, project.businessId, 'studio', `Concept approved: ${concept?.name ?? conceptKey} (direction version ${direction.version})`, {
    projectId: project.id,
    directionId: direction.id,
    conceptKey,
    version: direction.version,
  });
  return review;
}

/** The approved direction and concept the build phase would consume. */
export async function approvedCreativeDirection(
  ctx: ServiceContext,
  project: StudioProject,
): Promise<{ direction: StudioCreativeDirection; concept: NonNullable<ReturnType<typeof approvedConcept>>; approval: StudioCreativeDirectionReview } | null> {
  const directions = await ctx.store.listStudioCreativeDirections(project.id);
  const reviews = await ctx.store.listStudioCreativeDirectionReviews(project.id);
  for (const direction of directions) {
    const scoped = reviews.filter((review) => review.directionId === direction.id);
    const approval = currentDirectionApproval(scoped);
    if (!approval) continue;
    const concept = approvedConcept(direction.content, scoped);
    if (concept) return { direction, concept, approval };
  }
  return null;
}



