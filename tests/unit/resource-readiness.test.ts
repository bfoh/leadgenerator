import { describe, expect, it } from 'vitest';
import type { ResourceEntry } from '@/lib/domain/business-resources';
import { businessDefaults } from '@/lib/domain/records';
import {
  identityStandingOf,
  kitReadiness,
  visualReferenceSheet,
  visualResourceInventory,
  type KitReadinessInput,
} from '@/lib/domain/resource-readiness';
import type { BusinessSocialSource, ResearchObservation } from '@/lib/domain/social-research';
import type { StudioAsset } from '@/lib/domain/studio-assets';
import type { Business } from '@/lib/domain/types';

// Readiness is a claim about evidence, so each case states what is present and asserts the grade
// that follows. Every fixture is synthetic: no Google call, no database and no real business.

const ORG = '11111111-1111-4111-8111-111111111111';
const BUSINESS = '22222222-2222-4222-8222-222222222222';
const STAMP = '2026-10-25T09:00:00.000Z';

const business = (overrides: Partial<Business> = {}): Business =>
  ({
    ...businessDefaults({ name: 'Adwoa House', city: 'Accra' }),
    id: BUSINESS,
    organizationId: ORG,
    createdBy: 'demo-user',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }) as Business;

const entry = (overrides: Partial<ResourceEntry> = {}): ResourceEntry => ({
  id: '33333333-3333-4333-8333-333333333331',
  organizationId: ORG,
  businessId: BUSINESS,
  category: 'service',
  label: 'Celebration cakes',
  value: 'Celebration cakes and bread, as described by the owner.',
  sourceKind: 'business_owner',
  sourceUrl: 'https://adwoa-house.example.org/about',
  evidence: 'Owner email dated 25 October permits independent verification, storage and export.',
  independentlyVerified: true,
  exportPermission: 'granted',
  createdBy: 'demo-user',
  createdAt: STAMP,
  revokedAt: null,
  ...overrides,
});

const asset = (overrides: Partial<StudioAsset> = {}): StudioAsset =>
  ({
    id: '44444444-4444-4444-8444-444444444441',
    organizationId: ORG,
    projectId: '55555555-5555-4555-8555-555555555551',
    fileName: 'shopfront.jpg',
    kind: 'venue_photo',
    status: 'approved',
    mimeType: 'image/jpeg',
    bytes: 2048,
    width: 1600,
    height: 900,
    checksumSha256: 'b'.repeat(64),
    storagePath: `${ORG}/vault/shopfront.jpg`,
    origin: 'client_supplied',
    ownerName: 'Adwoa House',
    supplier: 'Adwoa Mensah',
    sourceUrl: null,
    licenceName: null,
    licenceReference: null,
    licenceExpiresOn: null,
    attributionRequired: false,
    attributionText: null,
    permissionEvidence: 'Owner email, 21 Oct 2026: these are our own photographs.',
    inspectPermission: 'granted',
    storePermission: 'granted',
    prototypePermission: 'granted',
    exportPermission: 'granted',
    publishPermission: 'denied',
    note: '',
    reviewNote: null,
    approvedBy: 'demo-user',
    approvedAt: STAMP,
    revokedAt: null,
    createdBy: 'demo-user',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }) as StudioAsset;

const observation = (overrides: Partial<ResearchObservation> = {}): ResearchObservation => ({
  id: '66666666-6666-4666-8666-666666666661',
  organizationId: ORG,
  businessId: BUSINESS,
  category: 'product_service',
  statement: 'Celebration cakes are listed on the public menu.',
  sourceKind: 'official_website',
  sourceUrl: 'https://adwoa-house.example.org/menu',
  status: 'independently_verified',
  evidence: 'Read on 24 October.',
  capturedBy: 'demo-user',
  capturedAt: STAMP,
  revokedAt: null,
  ...overrides,
});

const socialSource = (overrides: Partial<BusinessSocialSource> = {}): BusinessSocialSource => ({
  id: '77777777-7777-4777-8777-777777777771',
  organizationId: ORG,
  businessId: BUSINESS,
  platform: 'instagram',
  handle: 'adwoa.house',
  profileUrl: 'https://www.instagram.com/adwoa.house/',
  provenance: 'official_website',
  retentionBasis: 'official_website',
  verificationStatus: 'independently_verified',
  verificationEvidence: 'Linked from the business website footer.',
  capturedBy: 'demo-user',
  capturedAt: STAMP,
  verifiedAt: STAMP,
  revokedAt: null,
  ...overrides,
});

const input = (overrides: Partial<KitReadinessInput> = {}): KitReadinessInput => ({
  business: business(),
  resources: [],
  socialSources: [],
  observations: [],
  assets: [],
  hasVault: false,
  ...overrides,
});

describe('identity standing', () => {
  it('treats a Google Place ID reference label as a placeholder rather than a name', () => {
    expect(identityStandingOf({ name: 'Unverified place in Accra', sourceUrl: null }, []).standing).toBe('reference_only');
  });
  it('does not count a Google or social link as an independent source of record', () => {
    expect(identityStandingOf({ name: 'Adwoa House', sourceUrl: 'https://maps.google.com/place/x' }, []).standing).toBe('recorded');
    expect(identityStandingOf({ name: 'Adwoa House', sourceUrl: 'https://www.instagram.com/adwoa.house/' }, []).standing).toBe('recorded');
  });
  it('accepts an independent source of record or a verified identity observation', () => {
    expect(identityStandingOf({ name: 'Adwoa House', sourceUrl: 'https://adwoa-house.example.org' }, []).standing).toBe('verified');
    expect(identityStandingOf({ name: 'Unverified place in Accra', sourceUrl: null }, [observation({ category: 'identity' })]).standing).toBe('verified');
  });
  it('ignores a revoked identity observation', () => {
    const revoked = observation({ category: 'identity', revokedAt: STAMP });
    expect(identityStandingOf({ name: 'Adwoa House', sourceUrl: null }, [revoked]).standing).toBe('recorded');
  });
});

describe('visual resource inventory', () => {
  it('counts only approved, export-permitted files and states how many are withheld', () => {
    const inventory = visualResourceInventory({
      socialSources: [],
      assets: [
        asset({ id: 'logo', kind: 'logo' }),
        asset({ id: 'shopfront', kind: 'venue_photo' }),
        asset({ id: 'preview', kind: 'venue_photo', sourceUrl: 'https://lh3.googleusercontent.com/preview' }),
        asset({ id: 'candidate', kind: 'product_photo', status: 'candidate' }),
      ],
    });
    expect(inventory.images).toBe(2);
    expect(inventory.logo).toBe(1);
    expect(inventory.photography).toBe(1);
    expect(inventory.groups.find((g) => g.key === 'business_owned')).toMatchObject({ exportable: 2, withheld: 2 });
    // A withheld file is counted against its own group, so the licence group is not blamed for it.
    expect(inventory.groups.find((g) => g.key === 'licensed_imagery')?.withheld).toBe(0);
    expect(inventory.groups.find((g) => g.key === 'google_preview')).toMatchObject({ exportable: 0, links: 0, withheld: 0 });
  });
  it('separates licensed and concept imagery from the business\'s own files', () => {
    const inventory = visualResourceInventory({
      socialSources: [],
      assets: [
        asset({ kind: 'licensed_image', licenceName: 'Commercial stock licence' }),
        asset({ id: 'concept', kind: 'illustration', origin: 'our_work', licenceName: null }),
      ],
    });
    expect(inventory.licensedImages).toBe(1);
    expect(inventory.conceptImages).toBe(1);
    expect(inventory.licenceGaps).toBe(0);
    expect(inventory.groups.find((g) => g.key === 'business_owned')?.exportable).toBe(0);
  });
  it('records a licence gap when a licensed file names no licence', () => {
    expect(visualResourceInventory({ socialSources: [], assets: [asset({ kind: 'licensed_image', licenceName: null })] }).licenceGaps).toBe(1);
  });
  it('keeps social profiles as links only and withholds one that exposes contact details', () => {
    const inventory = visualResourceInventory({
      socialSources: [socialSource(), socialSource({ id: 'phone', handle: '0501234567', profileUrl: 'https://www.instagram.com/0501234567/' })],
      assets: [],
    });
    expect(inventory.groups.find((g) => g.key === 'social_reference')).toMatchObject({ exportable: 0, links: 1, withheld: 1 });
  });
});


describe('kit readiness', () => {
  const grade = (overrides: Partial<KitReadinessInput> = {}) => kitReadiness(input(overrides));
  const supported = business({ sourceUrl: 'https://adwoa-house.example.org' });

  it('grades a record with no export-permitted evidence as empty', () => {
    const readiness = grade();
    expect(readiness.state).toBe('empty');
    expect(readiness.complete).toBe(false);
    expect(readiness.summary).toMatch(/nothing to build from/);
    expect(readiness.permissionGaps.join(' ')).toMatch(/No Asset Vault has been opened/);
  });

  it('keeps a Place ID reference at research pending even when entries exist', () => {
    const readiness = grade({ business: business({ name: 'Unverified place in Accra', sourceUrl: null }), resources: [entry()], observations: [observation()] });
    expect(readiness.identity.standing).toBe('reference_only');
    expect(readiness.state).toBe('research_pending');
    expect(readiness.missing.map((m) => m.key)).toContain('identity');
  });

  it('grades supported evidence without a photograph as partial and names what is missing', () => {
    const readiness = grade({ business: supported, resources: [entry()], observations: [observation()] });
    expect(readiness.state).toBe('partial');
    const missing = readiness.missing.map((m) => m.key);
    expect(missing).toEqual(expect.arrayContaining(['logo', 'photography']));
    expect(missing).not.toContain('services');
  });

  it('grades a verified identity with a logo, a photograph and an observation as ready', () => {
    const readiness = grade({
      business: supported,
      resources: [entry()],
      observations: [observation()],
      assets: [asset({ kind: 'logo' }), asset()],
      hasVault: true,
    });
    expect(readiness.state).toBe('ready');
    expect(readiness.complete).toBe(true);
    expect(readiness.counts).toMatchObject({ images: 2, logo: 1, photography: 1 });
    expect(readiness.studio.ready).toBe(true);
  });

  it('never lets a withheld file or entry count towards ready', () => {
    const readiness = grade({
      business: supported,
      resources: [entry({ exportPermission: 'denied' })],
      observations: [observation()],
      assets: [asset({ kind: 'logo', status: 'candidate' }), asset({ sourceUrl: 'https://lh3.googleusercontent.com/preview' })],
      hasVault: true,
    });
    expect(readiness.state).toBe('partial');
    expect(readiness.counts.images).toBe(0);
    expect(readiness.permissionGaps.join(' ')).toMatch(/2 files in the vault cannot be exported/);
    expect(readiness.permissionGaps.join(' ')).toMatch(/1 independent entry is withheld/);
  });

  it('tells Studio to wait until an identity and one observation are supported', () => {
    expect(grade({ business: supported }).studio.ready).toBe(false);
    expect(grade({ business: supported, observations: [observation()] }).studio.ready).toBe(true);
  });
});

describe('the visual-reference sheet', () => {
  it('describes Google previews and social images as excluded instead of including them', () => {
    const socialSources = [socialSource()];
    const readiness = kitReadiness(
      input({
        business: business({ sourceUrl: 'https://adwoa-house.example.org' }),
        socialSources,
        observations: [observation()],
        assets: [asset(), asset({ id: 'google', kind: 'venue_photo', sourceUrl: 'https://lh3.googleusercontent.com/preview' })],
        hasVault: true,
      }),
    );
    const sheet = visualReferenceSheet({
      businessId: BUSINESS,
      generatedAt: STAMP,
      readiness,
      socialSources,
      assets: [{ path: 'visuals/shopfront.jpg', fileName: 'shopfront.jpg', kind: 'venue_photo', origin: 'client_supplied', licence: null, attribution: null }],
      unapprovedFiles: 1,
    });
    expect(sheet.format).toBe('dof-visual-references/1');
    expect(sheet.excluded).toMatchObject({ googlePreviews: true, socialImages: true, unapprovedFiles: 1 });
    expect(sheet.groups.find((g) => g.key === 'google_preview')).toMatchObject({ included: false, files: [], links: [] });
    expect(sheet.groups.find((g) => g.key === 'social_reference')?.links).toEqual([
      { platform: 'instagram', profileUrl: 'https://www.instagram.com/adwoa.house/', status: 'independently_verified' },
    ]);
    expect(sheet.groups.find((g) => g.key === 'business_owned')?.files.map((f) => f.path)).toEqual(['visuals/shopfront.jpg']);
    expect(JSON.stringify(sheet)).not.toContain('googleusercontent');
  });
});
