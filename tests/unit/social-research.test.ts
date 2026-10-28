import { describe, expect, it } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { downloadWebsiteResourceKit } from '@/lib/data/resource-services';
import type { ServiceContext } from '@/lib/data/services';
import { businessDefaults } from '@/lib/domain/records';
import {
  researchObservationInsertSchema,
  socialSourceInsertSchema,
  buildSocialResearch,
  containsContactDetails,
  observationHasContactDetails,
  redactContactDetails,
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
    // A leading `@` and mixed case are normalised before the store or database sees the handle.
    expect(socialSourceInsertSchema.parse({ ...base, handle: '@Research.Bakery' }).handle).toBe('research.bakery');
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

  it('starts a source at the status its retention basis supports', () => {
    const base = source('00000000-0000-4000-8000-000000000001');
    expect(
      socialSourceInsertSchema.safeParse({
        ...base,
        verificationStatus: 'owner_confirmed',
        verificationEvidence: 'The owner confirmed this account on 26 October.',
      }).success,
    ).toBe(false);
    expect(
      socialSourceInsertSchema.safeParse({
        ...base,
        provenance: 'owner_supplied',
        retentionBasis: 'owner_supplied',
        verificationStatus: 'observed',
      }).success,
    ).toBe(false);
    expect(
      socialSourceInsertSchema.safeParse({
        ...base,
        provenance: 'licensed_directory',
        retentionBasis: 'licensed_directory',
        verificationStatus: 'independently_verified',
        verificationEvidence: 'Checked against the directory licence on 26 October.',
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

  it('never accepts a Google pointer or a social link as an official observation source', () => {
    const base = observation('00000000-0000-4000-8000-000000000001');
    const official = { ...base, sourceKind: 'official_website' as const };
    expect(
      researchObservationInsertSchema.safeParse({ ...official, sourceUrl: 'https://www.google.com/maps/place/Fictional+Bakery' }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...official, sourceUrl: 'https://fictionalbakery.business.site/' }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...official, sourceUrl: 'https://www.instagram.com/research.bakery/' }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...official, sourceUrl: 'https://www.fictionalbakery.example/menu' }).success,
    ).toBe(true);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, sourceKind: 'licensed_directory' as const, sourceUrl: 'https://maps.google.com/?cid=123' }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, sourceKind: 'business_owner' as const, sourceUrl: 'https://g.page/fictional-bakery' }).success,
    ).toBe(false);
    expect(
      researchObservationInsertSchema.safeParse({ ...base, category: 'missing_information' as const, sourceKind: 'research_gap' as const, sourceUrl: 'https://www.google.com/search?q=bakery' }).success,
    ).toBe(false);
  });

  it('detects and redacts contact details without mistaking a date for a phone', () => {
    expect(containsContactDetails('Call +233 24 555 0100')).toBe(true);
    expect(containsContactDetails('Email hello@example.org for wholesale orders.')).toBe(true);
    expect(containsContactDetails('Captured on 2026-10-25.')).toBe(false);
    expect(redactContactDetails('Call +233 24 555 0100 or hello@example.org on 2026-10-25.')).toBe(
      'Call [phone withheld] or [email withheld] on 2026-10-25.',
    );
    // A number in a link is just as exportable as one in the sentence.
    expect(
      observationHasContactDetails({
        statement: 'Wholesale orders are handled by chat.',
        evidence: null,
        sourceUrl: 'https://wa.me/233245550100',
      }),
    ).toBe(true);
    // A messaging link is a contact channel even when no phone number appears in the URL.
    expect(
      observationHasContactDetails({
        statement: 'Wholesale orders are handled by chat.',
        evidence: null,
        sourceUrl: 'https://wa.me/message/FICTIONAL',
      }),
    ).toBe(true);
    expect(containsContactDetails('Message https://wa.me/message/FICTIONAL')).toBe(true);
    expect(redactContactDetails('Message https://wa.me/message/FICTIONAL')).toBe('Message [contact link withheld]');
    // Percent-encoded contact details are still contact details.
    expect(containsContactDetails('Email owner%40example.org')).toBe(true);
    expect(redactContactDetails('Email owner%40example.org')).toBe('Email [email withheld]');
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
    // A harmless-looking category is not a way around the contact rule: the number is withheld from
    // both the JSON and the brief, while the collector keeps the original observation.
    await store.createResearchObservation({
      businessId: business.id,
      category: 'description',
      statement: 'The owner asks buyers to call +233 24 555 0100 for celebration orders.',
      sourceKind: 'social_profile',
      sourceUrl: 'https://www.instagram.com/research.bakery/',
      status: 'observed',
      evidence: null,
    });
    await store.createResearchObservation({
      businessId: business.id,
      category: 'identity',
      statement: 'A contact address was published on the profile.',
      sourceKind: 'social_profile',
      sourceUrl: 'https://www.instagram.com/research.bakery/',
      status: 'observed',
      evidence: 'Email hello@researchbakery.example for wholesale orders.',
    });
    // A contact link in the source URL is contact material too; the observation belongs in the
    // collector, never in the kit, and it must not reappear under a non-contact heading.
    await store.createResearchObservation({
      businessId: business.id,
      category: 'product_service',
      statement: 'Wholesale orders are handled through a chat link.',
      sourceKind: 'business_owner',
      sourceUrl: 'https://wa.me/message/FICTIONAL',
      status: 'observed',
      evidence: null,
    });
    const kit = await downloadWebsiteResourceKit(ctx, business.id, null);
    expect(kit.manifest.socialSources).toHaveLength(1);
    expect(kit.manifest.researchObservations).toHaveLength(1);
    expect(kit.manifest.withheldContactObservations).toBe(4);
    const text = new TextDecoder().decode(kit.zip);
    expect(text).toContain('social-sources.json');
    expect(text).toContain('research-observations.json');
    expect(text).toContain('RESEARCH-BRIEF.md');
    expect(text).toContain('research.bakery');
    expect(text).toContain('Cakes and celebration bread');
    expect(text).toContain('Observed');
    expect(text).toContain('no search-result titles');
    expect(text).toContain('Contact details recorded in the CRM');
    expect(text).not.toContain('+233 24 555 0100');
    expect(text).not.toContain('hello@researchbakery.example');
    expect(text).not.toContain('A phone number was visible on the profile');
    expect(text).not.toContain('The owner asks buyers to call');
    expect(text).not.toContain('A contact address was published');
    expect(text).not.toContain('Wholesale orders are handled through a chat link');
    expect(text).not.toContain('wa.me/message/FICTIONAL');
    expect(text).not.toContain('data:image');
    expect(text).not.toContain('cdninstagram');

    await store.revokeSocialSource(savedSource.id);
    await store.revokeResearchObservation(savedObservation.id);
    const after = await downloadWebsiteResourceKit(ctx, business.id, null);
    expect(after.manifest.socialSources).toHaveLength(0);
    expect(after.manifest.researchObservations).toHaveLength(0);
    expect(after.manifest.excludedSocialSources).toBe(1);
    expect(after.manifest.excludedResearchObservations).toBe(1);
    expect(after.manifest.withheldContactObservations).toBe(4);
    const afterText = new TextDecoder().decode(after.zip);
    expect(afterText).not.toContain('research.bakery');
    expect(afterText).not.toContain('Cakes and celebration bread');
  });

  it('redacts contact details from verification evidence instead of exporting them', async () => {
    const { store, ctx } = context();
    const business = await store.createBusiness(businessDefaults({ name: 'Fictional Evidence Bakery +233 24 555 0199', category: 'Bakery', country: 'GH', region: 'Ashanti', city: 'Kumasi' }));
    await store.createSocialSource({
      ...source(business.id),
      provenance: 'official_website',
      retentionBasis: 'official_website',
      verificationStatus: 'independently_verified',
      verificationEvidence: 'The business website links this profile. Call +233 24 555 0199 to confirm ownership.',
    });
    const kit = await downloadWebsiteResourceKit(ctx, business.id, null);
    const text = new TextDecoder().decode(kit.zip);
    expect(kit.filename).toBe('fictional-evidence-bakery-phone-withheld-website-resource-kit.zip');
    expect(kit.filename).not.toContain('233-24-555-0199');
    expect(kit.manifest.socialSources[0].verificationEvidence).toContain('[phone withheld]');
    expect(kit.manifest.socialSources[0].verificationEvidence).not.toContain('+233 24 555 0199');
    expect(text).toContain('[phone withheld]');
    expect(text).not.toContain('+233 24 555 0199');
  });

  it('withholds a social reference whose handle is a phone number', async () => {
    const { store, ctx } = context();
    const business = await store.createBusiness(businessDefaults({ name: 'Fictional Numeric Handle Bakery', category: 'Bakery', country: 'GH', region: 'Ashanti', city: 'Kumasi' }));
    await store.createSocialSource({
      ...source(business.id),
      handle: '233245550188',
      profileUrl: 'https://www.instagram.com/233245550188/',
      provenance: 'official_website',
      retentionBasis: 'official_website',
      verificationStatus: 'independently_verified',
      verificationEvidence: 'The business website links this profile, checked on 26 October.',
    });
    const kit = await downloadWebsiteResourceKit(ctx, business.id, null);
    const text = new TextDecoder().decode(kit.zip);
    expect(kit.manifest.socialSources).toHaveLength(0);
    expect(kit.manifest.withheldContactSources).toBe(1);
    expect(text).not.toContain('233245550188');
  });

  it('writes a brief that names statuses and excludes provider material', async () => {
    const { store } = context();
    const business = await store.createBusiness(businessDefaults({ name: 'Fictional Research Bakery', category: 'Bakery', country: 'GH', region: 'Ashanti', city: 'Kumasi' }));
    const brief = socialResearchBrief(business, [], [], new Date('2026-10-26T12:00:00Z'));
    expect(brief).toContain('# Social resource research brief');
    expect(brief).toContain('Observed, Independently verified or Owner confirmed');
    expect(brief).toContain('Search-result titles, snippets or rankings');
    expect(brief).toContain('Social-media images, logos or profile content');
    // A phone number recorded in the prospect name is still a contact detail, not a heading.
    const contactBrief = socialResearchBrief(
      { ...business, name: 'Fictional Research Bakery +233 24 555 0177' },
      [],
      [],
      new Date('2026-10-26T12:00:00Z'),
    );
    expect(contactBrief).toContain('Business: Fictional Research Bakery [phone withheld]');
    expect(contactBrief).not.toContain('+233 24 555 0177');
  });
});
