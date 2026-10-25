import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import * as studio from '@/lib/data/studio-services';
import type { ServiceContext } from '@/lib/data/services';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { BusinessForm } from '@/lib/domain/schemas';
import type { Business } from '@/lib/domain/types';
import { buildBrandIntelligence } from '@/lib/domain/studio';
import { FASHION_BUSINESS, SITE_URL, TODAY, fashionFacts } from './studio-fixtures';

// The Studio as the team uses it: one concept per prospect, evidence runs that only ever append, and
// reviews that record a decision instead of editing what the page said.

function form(overrides: Partial<BusinessForm> = {}): BusinessForm {
  return {
    name: FASHION_BUSINESS.name,
    category: FASHION_BUSINESS.category,
    country: 'GH',
    region: 'Greater Accra',
    districtCode: null,
    city: FASHION_BUSINESS.city,
    neighborhood: 'Osu',
    address: null,
    businessStatus: 'active',
    officialWebsite: SITE_URL,
    socialProfiles: [{ platform: 'instagram', url: 'https://instagram.com/nsromaatelier' }],
    enquiryChannel: 'WhatsApp',
    phone: null,
    email: null,
    contactSource: null,
    interestLevel: 'medium',
    budgetSignal: 'unknown',
    serviceNeeds: ['Website rebuild'],
    estimatedValue: null,
    expectedCloseDate: null,
    nextAction: null,
    nextActionDue: null,
    notes: '',
    sourceUrl: null,
    sourceKind: 'manual',
    placesPlaceId: null,
    ...overrides,
  };
}

let ctx: ServiceContext;
let business: Business;

beforeEach(async () => {
  ctx = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user' };
  business = await svc.createBusiness(ctx, form());
});

const activities = async () => (await ctx.store.listActivities(business.id)).map((activity) => activity.summary);

describe('starting a concept', () => {
  it('opens one concept from the prospect, using the website the record holds', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    expect(project).toMatchObject({
      businessId: business.id,
      name: `${FASHION_BUSINESS.name} — website concept`,
      status: 'draft',
      intelligenceStatus: 'not_started',
      websiteUrl: SITE_URL,
      brief: '',
    });
    expect(await studio.studioSiteUrl(project, business)).toBe(SITE_URL);
    expect((await activities())[0]).toContain('Website concept started for Nsroma Atelier');
  });

  it('refuses a second live concept for the same prospect', async () => {
    await studio.createStudioConcept(ctx, business);
    await expect(studio.createStudioConcept(ctx, business)).rejects.toThrow(/already has a live concept/);
    expect(await ctx.store.listStudioProjects(business.id)).toHaveLength(1);
  });

  it('allows a new concept once the old one is archived, keeping the archived one as history', async () => {
    const first = await studio.createStudioConcept(ctx, business);
    await studio.archiveStudioConcept(ctx, first);
    const second = await studio.createStudioConcept(ctx, business);
    expect(second.id).not.toBe(first.id);
    const projects = await ctx.store.listStudioProjects(business.id);
    expect(projects.map((p) => p.status).sort()).toEqual(['archived', 'draft']);
  });

  it('falls back to the prospect site when the concept has no address of its own', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const edited = await studio.updateStudioConcept(ctx, { ...project, websiteUrl: null }, { websiteUrl: null });
    expect(studio.studioSiteUrl(edited, business)).toBe(SITE_URL);
    expect(studio.studioSiteUrl({ ...edited, websiteUrl: 'https://example.org' }, business)).toBe('https://example.org');
  });
});

describe('analysing the current site', () => {
  it('records the first run and says what it found in words', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { project: ready, observations } = await studio.analyseStudioConcept(ctx, project, fashionFacts());
    expect(ready).toMatchObject({ status: 'intelligence_ready', intelligenceStatus: 'ready' });
    expect(ready.intelligenceNote).toContain('verified fact');
    expect(ready.intelligenceAt).not.toBeNull();
    expect(observations.length).toBeGreaterThan(10);
    expect(observations.every((o) => o.runNumber === 1)).toBe(true);
    expect(observations.find((o) => o.key === 'identity.name')?.detail).toContain(FASHION_BUSINESS.name);
  });

  it('appends a second run and leaves the first one untouched', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const first = await studio.analyseStudioConcept(ctx, project, fashionFacts());
    const { project: after, observations } = await studio.analyseStudioConcept(ctx, first.project, fashionFacts({ themeColor: null, colors: [] }));
    expect(after.status).toBe('intelligence_ready');
    const all = await ctx.store.listStudioObservations(project.id);
    expect(all).toHaveLength(first.observations.length + observations.length);
    expect(new Set(all.map((o) => o.runNumber))).toEqual(new Set([1, 2]));
    expect(observations.some((o) => o.key === 'unknown.palette')).toBe(true);
    expect(all.find((o) => o.runNumber === 1 && o.key === 'palette.declared')).toBeTruthy();
    expect((await activities())[0]).toContain('Website analysis run 2');
  });

  it('labels a simulated reading so it cannot pass for a real one', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { project: ready } = await studio.analyseStudioConcept(ctx, project, fashionFacts(), { simulated: true });
    expect(ready.intelligenceNote?.startsWith('Simulated reading (demo mode)')).toBe(true);
    expect((await activities())[0]).toContain('(simulated)');
  });

  it('records that the page could not be read instead of inventing evidence', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { project: after, observations } = await studio.analyseStudioConcept(ctx, project, null, { note: 'The site refuses automated visits (robots.txt).' });
    expect(after).toMatchObject({ intelligenceStatus: 'unavailable', status: 'draft' });
    expect(after.intelligenceNote).toContain('robots.txt');
    expect(after.intelligenceAt).not.toBeNull();
    expect(observations).toEqual([]);
    expect(await ctx.store.listStudioObservations(project.id)).toEqual([]);
  });

  it('will not collect new runs for an archived concept', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    await studio.archiveStudioConcept(ctx, project);
    await expect(studio.analyseStudioConcept(ctx, { ...project, status: 'archived' }, fashionFacts())).rejects.toThrow(/archived/);
  });

  it('stops at the hundredth run and points the team at a new concept', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const drafts = buildBrandIntelligence({ business: FASHION_BUSINESS, facts: fashionFacts(), siteUrl: SITE_URL, today: TODAY });
    const at = new Date().toISOString();
    await ctx.store.createStudioObservations(drafts.map((draft) => ({ ...draft, projectId: project.id, runNumber: 100, observedAt: at })));
    await expect(studio.analyseStudioConcept(ctx, project, fashionFacts())).rejects.toThrow(/100 analyses/);
  });
});

describe('reviewing evidence', () => {
  it('confirms an entry and records who decided what', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { observations } = await studio.analyseStudioConcept(ctx, project, fashionFacts());
    const target = observations.find((o) => o.key === 'identity.name')!;
    const review = await studio.reviewStudioObservation(ctx, project, target, 'confirm', '');
    expect(review).toMatchObject({ observationId: target.id, decision: 'confirm', reviewerId: 'demo-user' });
    expect((await activities())[0]).toContain('Confirmed');
  });

  it('requires a reason when rejecting, and never edits the evidence itself', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { observations } = await studio.analyseStudioConcept(ctx, project, fashionFacts());
    const target = observations.find((o) => o.key === 'contact.routes')!;
    await expect(studio.reviewStudioObservation(ctx, project, target, 'reject', '  ')).rejects.toThrow(/Explain the decision/);
    await studio.reviewStudioObservation(ctx, project, target, 'reject', 'That number belongs to the tailor next door.');
    const stored = await ctx.store.listStudioObservations(project.id);
    expect(stored.find((o) => o.id === target.id)).toEqual(target);
    expect((await ctx.store.listStudioReviews(project.id))[0].note).toBe('That number belongs to the tailor next door.');
  });

  it('keeps a review note without treating it as a decision', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const review = await studio.reviewStudioObservation(ctx, project, null, 'note', 'Owner prefers WhatsApp to calls.');
    expect(review.observationId).toBeNull();
    expect((await activities())[0]).toContain('Noted');
  });
});

describe('archiving and deleting', () => {
  it('archives, then restores to the state the evidence supports', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { project: ready } = await studio.analyseStudioConcept(ctx, project, fashionFacts());
    const archived = await studio.archiveStudioConcept(ctx, ready);
    expect(archived.status).toBe('archived');
    // Archiving twice is a no-op, not an error.
    expect((await studio.archiveStudioConcept(ctx, archived)).status).toBe('archived');
    const restored = await studio.restoreStudioConcept(ctx, archived);
    expect(restored.status).toBe('intelligence_ready');
    expect((await activities())[0]).toContain('restored');
  });

  it('restores an unanalysed concept to draft', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const restored = await studio.restoreStudioConcept(ctx, await studio.archiveStudioConcept(ctx, project));
    expect(restored.status).toBe('draft');
  });

  it('deletes the concept with its evidence and reviews, and logs that it happened', async () => {
    const project = await studio.createStudioConcept(ctx, business);
    const { observations } = await studio.analyseStudioConcept(ctx, project, fashionFacts());
    await studio.reviewStudioObservation(ctx, project, observations[0], 'confirm', '');
    await studio.deleteStudioConcept(ctx, project);
    expect(await ctx.store.getStudioProject(project.id)).toBeNull();
    expect(await ctx.store.listStudioObservations(project.id)).toEqual([]);
    expect(await ctx.store.listStudioReviews(project.id)).toEqual([]);
    expect((await activities())[0]).toContain('Website concept deleted');
  });
});
