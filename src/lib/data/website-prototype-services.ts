// The save gate for rendered website prototypes. The same rules apply in demo and cloud mode:
// a current approval for the exact concept, a blueprint bound to that direction and the approved
// Brand Kit, only prototype-cleared vault media, and an immutable version number.

import { currentDirectionApproval, prototypeAssets } from '@/lib/domain/creative-direction';
import type { StudioCreativeDirection } from '@/lib/domain/creative-direction';
import type { StudioProject } from '@/lib/domain/studio';
import { blueprintProblems, type WebsiteBlueprint } from '@/lib/domain/website-blueprint';
import { IMAGE_PENDING_ASSET } from '@/lib/domain/website-compositions';
import type { StudioWebsitePrototype } from '@/lib/domain/website-prototype';
import { creativeKit } from './creative-direction-services';
import { log, type ServiceContext } from './services';
import { StoreError, WEBSITE_PROTOTYPE_MIGRATION_REQUIRED } from './store';

async function requirePrototypeStore(ctx: ServiceContext) {
  if (!(await ctx.store.creativeDirectionSchemaAvailable())) {
    throw new StoreError('The creative direction migration is required before a website prototype.', 'unavailable');
  }
  if (!(await ctx.store.websitePrototypeSchemaAvailable())) throw new StoreError(WEBSITE_PROTOTYPE_MIGRATION_REQUIRED, 'unavailable');
}

function nextVersion(rows: readonly StudioWebsitePrototype[]): number {
  return Math.max(0, ...rows.map((row) => row.version)) + 1;
}

/**
 * Saves one rendered blueprint as the next immutable version. It does not publish it: publish
 * permission is a separate check, and the blueprint itself carries `publishReady: false`.
 */
export async function saveWebsitePrototype(
  ctx: ServiceContext,
  project: StudioProject,
  direction: StudioCreativeDirection,
  conceptKey: string,
  blueprint: WebsiteBlueprint,
  note = '',
): Promise<StudioWebsitePrototype> {
  await requirePrototypeStore(ctx);
  if (project.status === 'archived') throw new StoreError('This concept is archived. Restore it before saving a prototype.', 'conflict');
  if (direction.projectId !== project.id) throw new StoreError('That direction belongs to another concept.', 'invalid');
  if (!direction.content.concepts.some((concept) => concept.key === conceptKey)) {
    throw new StoreError('That concept is not in this direction.', 'invalid');
  }
  const reviews = await ctx.store.listStudioCreativeDirectionReviews(project.id);
  const approval = currentDirectionApproval(reviews);
  if (!approval || approval.directionId !== direction.id || approval.conceptKey !== conceptKey) {
    throw new StoreError('Approve this exact direction and concept before rendering a prototype.', 'conflict');
  }
  if (blueprint.format !== 'dof-website-blueprint/1') throw new StoreError('This is not a version 1 website blueprint.', 'invalid');
  if (
    blueprint.direction.directionId !== direction.id ||
    blueprint.direction.directionVersion !== direction.version ||
    blueprint.direction.conceptKey !== conceptKey
  ) {
    throw new StoreError('The blueprint is not bound to the approved direction version and concept.', 'invalid');
  }
  if (
    blueprint.direction.briefVersionId !== direction.content.briefVersionId ||
    blueprint.direction.briefVersion !== direction.content.briefVersion
  ) {
    throw new StoreError('The blueprint and the direction name different brief versions.', 'invalid');
  }
  const kit = await creativeKit(ctx, project);
  if (blueprint.brandKit.versionId !== kit.version.id || blueprint.brandKit.version !== kit.version.version) {
    throw new StoreError('The blueprint was built from a different Brand Kit version. Regenerate it from the current kit.', 'conflict');
  }
  const usable = new Set(prototypeAssets(await ctx.store.listStudioAssets(project.id)).map((asset) => asset.id));
  for (const asset of blueprint.assets) {
    if (asset.permission !== 'prototype') throw new StoreError(`“${asset.fileName}” is not cleared for prototype use.`, 'invalid');
    if (asset.id === IMAGE_PENDING_ASSET.id && asset.sourceKind === 'studio_drawing') continue;
    if (!usable.has(asset.id)) {
      throw new StoreError(`“${asset.fileName}” is not an approved, unexpired prototype asset in this concept’s vault.`, 'invalid');
    }
  }
  const problems = blueprintProblems(blueprint);
  if (problems.length) throw new StoreError(problems[0], 'invalid');
  if (blueprint.readiness.previewReady !== true) throw new StoreError('The blueprint is not preview-ready.', 'invalid');

  const existing = await ctx.store.listStudioWebsitePrototypes(project.id);
  const saved = await ctx.store.createStudioWebsitePrototype({
    projectId: project.id,
    directionId: direction.id,
    conceptKey,
    version: nextVersion(existing),
    content: blueprint,
    note: note.trim().slice(0, 1000),
  });
  await log(ctx, project.businessId, 'studio', `Website prototype saved (version ${saved.version})`, {
    projectId: project.id,
    prototypeId: saved.id,
    directionId: direction.id,
    directionVersion: direction.version,
    conceptKey,
    version: saved.version,
  });
  return saved;
}
