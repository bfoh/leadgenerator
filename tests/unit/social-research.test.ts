import { describe, expect, it } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { downloadWebsiteResourceKit } from '@/lib/data/resource-services';
import type { ServiceContext } from '@/lib/data/services';
import { businessDefaults } from '@/lib/domain/records';
import {
  researchObservationInsertSchema,
  socialSourceInsertSchema,
  buildSocialResearch,
  socialResearchBrief,
} from '@/lib/domain/social-research';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';

const context = () => {
  const store = new LocalStore(new MemoryStorage());
  const ctx: ServiceContext = { store, userId: 'demo-user', userLabel: 'Demo researcher', settings: DEFAULT_SETTINGS };
  return { store, ctx };
};

const source = (businessId: string) => ({
  businessId,
  platform: 'instagram' as const,
  handle: 'research.bakery',
  profileUrl: 'https://www.instagram.com/research.bakery/',
  provenance: 'independent_observation' as const,
  retentionBasis: 'first_party_observation' as const,
  verificationStatus: 'observed' as const,
  verificationEvidence: null,
});

const observation = (businessId: string) => ({
  businessId,
  category: 'product_service' as const,
  statement: 'Cakes and celebration bread are listed on the public profile.',
  sourceKind: 'social_profile' as const,
  sourceUrl: 'https://www.instagram.com/research.bakery/',
  status: 'observed' as const,
  evidence: null,
});

describe('social research schema', () => {
  it('accepts only canonical profile URLs that match the platform and handle', () => {
    const base = { ...source('00000000-0000-4000-8000-000000000001') };
    expect(socialSourceInsertSchema.safeParse(base).success).toBe(true);
    expect(socialSourceInsertSchema.safeParse({ ...base, profileUrl: 'https://www.instagram.com/research.bakery/?igsh=tracking' }).success).toBe(false);
    expect(socialSourceInsertSchema.safeParse({ ...base, platform: 'facebook' }).success).toBe(false);
    expect(socialSourceInsertSchema.safeParse({ ...base, handle: 'someone.else' }).success).toBe(false);
    expect(socialSourceInsertSchema.safeParse({ ...base, profileUrl: 'https://www.instagram.com/p/Cabc123/' }).success).toBe(false);
  });

  it('never lets an observed profile claim verification, or a verified one go without evidence', () => {
    const base = source('00000000-0000-4000-8000-000000000001');
    expect(socialSourceInsertSchema.safeParse({ ...base, verificationEvidence: 'A profile was seen.' }).success).toBe(false);
    expect(socialSourceInsertSchema.safeParse({ ...base, verificationStatus: 'owner_confirmed' }).success).toBe(false);
    expect(
      socialSourceInsertSchema.safeParse({
        ...base,
        provenance: 'owner_supplied',
        retentionBasis: 'owner_supplied',
        verificationStatus: 'owner_confirmed',
        verificationEvidence: 'The owner confirmed this account on 26 October.',
      }).success,
    ).toBe(true);
  });

  it('requires a research gap to stand alone and a verified observation to carry evidence', () => {
    const base = observation('00000000-0000-4000-8000-000000000001');
    expect(researchObservationInsertSchema.safeParse(base).success).toBe(true);
    const gap = researchObservationInsertSchema.safeParse({
      ...base,
      category: 'missing_information',
      statement: 'Owner permission has not been recorded.',
      sourceKind: 'research_gap',
      sourceUrl: null,
    });
    expect(gap.success).toBe(true);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, category: 'missing_information', sourceKind: 'social_profile', sourceUrl: null }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, sourceKind: 'research_gap', sourceUrl: null }).success,
    ).toBe(false);
    expect(researchObservationInsertSchema.safeParse({ ...base, sourceUrl: null }).success).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, status: 'independently_verified' }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, status: 'independently_verified', evidence: 'Confirmed on the owner’s website on 26 October.' }).success,
    ).toBe(true);
  });
});

describe('social research panel and kit', () => {
  it('keeps every derived item honest about its source and status', async () => {
    const { store } = context();
    const business = await store.createBusiness(businessDefaults({ name: 'Fictional Research Bakery', category: 'Bakery', country: 'GH', region: 'Ashanti', city: 'Kumasi' }));
    const savedSource = await store.createSocialSource(source(business.id));
    const savedObservation = await store.createResearchObservation(observation(business.id));
    const current = (await store.getBusiness(business.id))!;
    const research = buildSocialResearch(current, [savedSource], [savedObservation]);
    const flat = research.groups.flatMap((group) => group.items);
    expect(flat.find((item) => item.key === 'business-name')?.status).toBe('observed');
    expect(flat.find((item) => item.key === 'category')?.status).toBe('observed');
    expect(flat.find((item) => item.key === `source-${savedSource.id}`)?.status).toBe('observed');
    expect(flat.find((item) => item.key === `observation-${savedObservation.id}`)?.status).toBe('observed');
    expect(flat.find((item) => item.key === 'contact-permission')?.note).toMatch(/never establishes contact consent/i);
    expect(research.missing).toContain('An independently verified official website.');
    expect(research.missing).toContain('Recorded contact permission before any outreach.');
    expect(research.missing).toContain('Independent verification of the business before its qualification stage advances.');
    // A revoked entry disappears from the panel without rewriting the record.
    await store.revokeSocialSource(savedSource.id);
    const after = buildSocialResearch(current, await store.listSocialSources(business.id), await store.listResearchObservations(business.id));
    expect(after.sources).toHaveLength(0);
    expect(after.observations).toHaveLength(1);
  });

  it('includes permitted references and the research brief in the Website Resource Kit', async () => {
    const { store, ctx } = context();
    const business = await store.createBusiness(businessDefaults({ name: 'Fictional Research Bakery', category: 'Bakery', country: 'GH', region: 'Ashanti', city: 'Kumasi', phone: '+233 24 555 0100' }));
    const savedSource = await store.createSocialSource(source(business.id));
    const savedObservation = await store.createResearchObservation(observation(business.id));
    await store.createResearchObservation({
      businessId: business.id,
      category: 'contact_channel',
      statement: 'A phone number was visible on the profile and must not be exported from a research note.',
      sourceKind: 'social_profile',
      sourceUrl: 'https://www.instagram.com/research.bakery/',
      status: 'observed',
      evidence: null,
    });
    const kit = await downloadWebsiteResourceKit(ctx, business.id, null);
    expect(kit.manifest.socialSources).toHaveLength(1);
    expect(kit.manifest.researchObservations).toHaveLength(1);
    expect(kit.manifest.withheldContactObservations).toBe(1);
    const text = new TextDecoder().decode(kit.zip);
    expect(text).toContain('social-sources.json');
    expect(text).toContain('research-observations.json');
    expect(text).toContain('RESEARCH-BRIEF.md');
    expect(text).toContain('research.bakery');
    expect(text).toContain('Cakes and celebration bread');
    expect(text).toContain('Observed');
    expect(text).toContain('no search-result titles');
    expect(text).toContain('Contact details recorded in the CRM and contact-channel observations are withheld');
    expect(text).not.toContain('+233 24 555 0100');
    expect(text).not.toContain('A phone number was visible on the profile');
    expect(text).not.toContain('data:image');
    expect(text).not.toContain('cdninstagram');

    await store.revokeSocialSource(savedSource.id);
    await store.revokeResearchObservation(savedObservation.id);
    const after = await downloadWebsiteResourceKit(ctx, business.id, null);
    expect(after.manifest.socialSources).toHaveLength(0);
    expect(after.manifest.researchObservations).toHaveLength(0);
    expect(after.manifest.excludedSocialSources).toBe(1);
    expect(after.manifest.excludedResearchObservations).toBe(1);
    expect(after.manifest.withheldContactObservations).toBe(1);
    const afterText = new TextDecoder().decode(after.zip);
    expect(afterText).not.toContain('research.bakery');
    expect(afterText).not.toContain('Cakes and celebration bread');
  });

  it('writes a brief that names statuses and excludes provider material', async () => {
    const { store } = context();
    const business = await store.createBusiness(businessDefaults({ name: 'Fictional Research Bakery', category: 'Bakery', country: 'GH', region: 'Ashanti', city: 'Kumasi' }));
    const brief = socialResearchBrief(business, [], [], new Date('2026-10-26T12:00:00Z'));
    expect(brief).toContain('# Social resource research brief');
    expect(brief).toContain('Observed, Independently verified or Owner confirmed');
    expect(brief).toContain('Search-result titles, snippets or rankings');
    expect(brief).toContain('Social-media images, logos or profile content');
  });
});
