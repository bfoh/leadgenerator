// The Studio turns one prospect into a website concept built from evidence about the site that
// business has today. Both modes go through here, so demo and cloud apply the same rules: the
// analysis is deterministic, evidence is append-only, and a concept for an archived project cannot
// quietly start collecting new runs.

import type { PageFacts } from '@/lib/domain/page-signals';
import {
  buildBrandIntelligence,
  countClassifications,
  intelligenceSummary,
  latestRunNumber,
  type ReviewDecision,
  type StudioObservation,
  type StudioProject,
  type StudioProjectPatch,
  type StudioReview,
} from '@/lib/domain/studio';
import type { Business } from '@/lib/domain/types';
import { log, type ServiceContext } from './services';
import { STUDIO_MIGRATION_REQUIRED, StoreError } from './store';

const now = () => new Date().toISOString();

async function requireStudioSchema(ctx: ServiceContext) {
  if (!(await ctx.store.studioSchemaAvailable())) throw new StoreError(STUDIO_MIGRATION_REQUIRED, 'unavailable');
}

/** The site the concept is built from: what the concept records, else what the prospect records. */
export function studioSiteUrl(project: StudioProject, business: Business): string | null {
  return project.websiteUrl ?? business.officialWebsite ?? null;
}

/** One live concept per prospect; an archived concept stays as history and does not block a new one. */
export async function createStudioConcept(ctx: ServiceContext, business: Business): Promise<StudioProject> {
  await requireStudioSchema(ctx);
  const existing = (await ctx.store.listStudioProjects(business.id)).find((p) => p.status !== 'archived');
  if (existing) throw new StoreError(`This prospect already has a live concept: ${existing.name}. Archive it before starting another.`, 'conflict');
  const project = await ctx.store.createStudioProject({
    businessId: business.id,
    name: `${business.name} — website concept`,
    websiteUrl: business.officialWebsite ?? null,
    brief: '',
  });
  await log(ctx, business.id, 'studio', `Website concept started for ${business.name}`, { projectId: project.id });
  return project;
}

export async function updateStudioConcept(ctx: ServiceContext, project: StudioProject, patch: StudioProjectPatch): Promise<StudioProject> {
  await requireStudioSchema(ctx);
  return ctx.store.updateStudioProject(project.id, patch);
}

/**
 * Records one analysis run from a homepage reading. `facts` is null when the site could not be read:
 * the concept then says so instead of pretending it has evidence.
 */
export async function analyseStudioConcept(
  ctx: ServiceContext,
  project: StudioProject,
  facts: PageFacts | null,
  options: { note?: string | null; simulated?: boolean } = {},
): Promise<{ project: StudioProject; observations: StudioObservation[] }> {
  await requireStudioSchema(ctx);
  if (project.status === 'archived') throw new StoreError('This concept is archived. Restore it before analysing the site again.', 'conflict');
  const business = await ctx.store.getBusiness(project.businessId);
  if (!business) throw new StoreError('The prospect for this concept no longer exists.', 'not_found');
  const siteUrl = studioSiteUrl(project, business);
  const at = now();
  const extra = options.note?.trim() || null;

  if (!facts || !siteUrl) {
    const updated = await ctx.store.updateStudioProject(project.id, {
      intelligenceStatus: 'unavailable',
      intelligenceAt: at,
      intelligenceNote:
        extra ?? 'The homepage could not be read, so no evidence was recorded. Check the address, or ask the business for their current site.',
    });
    await log(ctx, business.id, 'studio', `Website analysis could not read ${siteUrl ?? 'a site'}`, { projectId: project.id });
    return { project: updated, observations: [] };
  }

  const previous = await ctx.store.listStudioObservations(project.id);
  const latest = latestRunNumber(previous);
  if (latest >= 100) throw new StoreError('This concept has already had 100 analyses. Start a new concept to begin again.', 'conflict');
  const runNumber = latest + 1;
  // The analysis is pure: the same reading always produces the same evidence, and gaps become unknowns.
  const drafts = buildBrandIntelligence({
    business: { name: business.name, category: business.category, city: business.city },
    facts,
    siteUrl,
    today: at,
  });
  const observations = await ctx.store.createStudioObservations(drafts.map((draft) => ({ ...draft, projectId: project.id, runNumber, observedAt: at })));
  const summary = intelligenceSummary(countClassifications(observations));
  // A simulated reading (demo mode) must never look like a real one, so the concept says so.
  const note = [options.simulated ? 'Simulated reading (demo mode): no page was actually fetched.' : null, summary, extra].filter(Boolean).join(' ');
  const updated = await ctx.store.updateStudioProject(project.id, {
    status: 'intelligence_ready',
    intelligenceStatus: 'ready',
    intelligenceAt: at,
    intelligenceNote: note.slice(0, 2000),
  });
  await log(ctx, business.id, 'studio', `Website analysis run ${runNumber}${options.simulated ? ' (simulated)' : ''}: ${summary}`, { projectId: project.id, runNumber });
  return { project: updated, observations };
}

/**
 * A person's decision about one entry. The evidence itself never changes: a correction is a new
 * entry in the next run, and a review explains why the team trusts or rejects what was recorded.
 */
export async function reviewStudioObservation(
  ctx: ServiceContext,
  project: StudioProject,
  observation: StudioObservation | null,
  decision: ReviewDecision,
  note: string,
): Promise<StudioReview> {
  await requireStudioSchema(ctx);
  const review = await ctx.store.createStudioReview({
    projectId: project.id,
    observationId: observation?.id ?? null,
    decision,
    note: note.trim(),
  });
  const what = observation ? `“${observation.label}”` : project.name;
  const verb = decision === 'confirm' ? 'Confirmed' : decision === 'reject' ? 'Rejected' : 'Noted';
  await log(ctx, project.businessId, 'studio', `${verb} ${what}`, { projectId: project.id, observationId: observation?.id ?? null, decision });
  return review;
}

export async function archiveStudioConcept(ctx: ServiceContext, project: StudioProject): Promise<StudioProject> {
  await requireStudioSchema(ctx);
  if (project.status === 'archived') return project;
  const updated = await ctx.store.updateStudioProject(project.id, { status: 'archived' });
  await log(ctx, project.businessId, 'studio', `Website concept archived: ${project.name}`, { projectId: project.id });
  return updated;
}

export async function restoreStudioConcept(ctx: ServiceContext, project: StudioProject): Promise<StudioProject> {
  await requireStudioSchema(ctx);
  const updated = await ctx.store.updateStudioProject(project.id, { status: project.intelligenceAt ? 'intelligence_ready' : 'draft' });
  await log(ctx, project.businessId, 'studio', `Website concept restored: ${project.name}`, { projectId: project.id });
  return updated;
}

/** Removes the concept with its evidence and reviews. Only an owner or admin may do this. */
export async function deleteStudioConcept(ctx: ServiceContext, project: StudioProject): Promise<void> {
  await requireStudioSchema(ctx);
  await ctx.store.deleteStudioProject(project.id);
  await log(ctx, project.businessId, 'studio', `Website concept deleted: ${project.name}`, { projectId: project.id, deleted: true });
}
