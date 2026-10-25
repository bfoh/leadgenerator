import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAssetStorage } from '@/lib/data/asset-storage';
import * as creative from '@/lib/data/creative-direction-services';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import * as studio from '@/lib/data/studio-services';
import * as vault from '@/lib/data/studio-asset-services';
import type { ServiceContext } from '@/lib/data/services';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { StudioProject } from '@/lib/domain/studio';
import { emptyBrandKitContent, type BrandKitContent, type StudioAsset } from '@/lib/domain/studio-assets';
import type { BusinessForm } from '@/lib/domain/schemas';
import type { Business } from '@/lib/domain/types';
import { FASHION_BUSINESS, SITE_URL } from './studio-fixtures';

// The Creative Director as the team uses it: an approved kit, a confirmed brief, three concepts,
// feedback and a named approval. Nothing is generated before the gates are met.

function png(width = 1200, height = 800): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

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
    socialProfiles: [],
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

const upload = (overrides: Partial<vault.AssetUploadInput> = {}): vault.AssetUploadInput => ({
  fileName: 'nsroma-logo.png',
  declaredType: 'image/png',
  bytes: png(1200, 800),
  kind: 'logo',
  origin: 'client_supplied',
  ownerName: 'Nsroma Atelier',
  supplier: 'Ama Mensah',
  sourceUrl: null,
  licenceName: null,
  licenceReference: null,
  licenceExpiresOn: null,
  attributionRequired: false,
  attributionText: null,
  permissionEvidence: 'Email from the owner, 21 Oct 2026: these are our own files.',
  inspectPermission: 'granted',
  storePermission: 'granted',
  prototypePermission: 'granted',
  exportPermission: 'granted',
  publishPermission: 'denied',
  note: '',
  ...overrides,
});

function kitContent(logoId: string): BrandKitContent {
  return {
    ...emptyBrandKitContent(),
    logoAssetIds: [logoId],
    palette: [
      { name: 'Ink', hex: '#241E1A', role: 'Text' },
      { name: 'Kente red', hex: '#7A1F3D', role: 'Accent' },
      { name: 'Warm paper', hex: '#F4EDE3', role: 'Background' },
    ],
    typography: [{ role: 'Display', family: 'Fraunces', weights: '400–700', licence: 'SIL Open Font License 1.1', assetId: null }],
    photographyAssetIds: [],
    personality: ['quietly confident', 'exacting', 'warm'],
    visualDirection: 'Editorial and unhurried: warm off-white, one deep red, photography given room to breathe and type doing the talking.',
    toneOfVoice: { summary: 'Plain, precise and proud of the craft. Short sentences; no exclamation marks.', do: ['Name the cloth'], dont: ['Best in Ghana'] },
  };
}

let ctx: ServiceContext;
let business: Business;
let project: StudioProject;
let logo: StudioAsset;

async function approveKit() {
  const version = await vault.saveBrandKitVersion(ctx, project, kitContent(logo.id), 'First kit');
  await vault.approveBrandKitVersion(ctx, project, version.version, 'Agreed with the owner on 25 October.');
  return version.version;
}

beforeEach(async () => {
  ctx = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user', assets: new MemoryAssetStorage() };
  business = await svc.createBusiness(ctx, form());
  project = await studio.createStudioConcept(ctx, business);
  logo = await vault.uploadStudioAsset(ctx, project, upload());
  logo = await vault.approveStudioAsset(ctx, project, logo, 'Checked with the owner.');
});

describe('the creative direction service', () => {
  it('refuses to confirm or generate before the Brand Kit is approved', async () => {
    const brief = await creative.saveCreativeBrief(ctx, project);
    expect(brief.content.brandKit).toBeNull();
    await expect(creative.confirmCreativeBrief(ctx, project, brief, 'Ready to start.')).rejects.toThrow(/Approve a Brand Kit/);
    await expect(creative.saveCreativeDirection(ctx, project)).rejects.toThrow(/Confirm the latest Creative Direction Brief/);
  });

  it('builds a brief, confirms it and proposes three concepts', async () => {
    const kitVersion = await approveKit();
    const brief = await creative.saveCreativeBrief(ctx, project);
    expect(brief.version).toBe(1);
    expect(brief.content.brandKit?.version).toBe(kitVersion.version);
    await creative.confirmCreativeBrief(ctx, project, brief, 'The brief reflects what we know; open questions are recorded.');

    const direction = await creative.saveCreativeDirection(ctx, project);
    expect(direction.version).toBe(1);
    expect(direction.content.concepts).toHaveLength(3);
    expect(direction.content.brandKitVersion).toBe(kitVersion.version);
    expect(new Set(direction.content.concepts.map((concept) => concept.composition.family)).size).toBe(3);

    const activities = (await ctx.store.listActivities(business.id)).map((activity) => activity.summary);
    expect(activities.some((summary) => summary.includes('Creative brief version 1 saved'))).toBe(true);
    expect(activities.some((summary) => summary.includes('Creative direction version 1 proposed'))).toBe(true);
  });

  it('requires a new brief version to be confirmed before another direction', async () => {
    await approveKit();
    const brief = await creative.saveCreativeBrief(ctx, project);
    await creative.confirmCreativeBrief(ctx, project, brief, 'Confirmed.');
    await creative.saveCreativeDirection(ctx, project);

    const revised = await creative.saveCreativeBrief(ctx, project, { preferences: { atmosphere: 'Night light, quiet room, one deep red.' }, note: 'Closer to how Ama describes it.' });
    expect(revised.version).toBe(2);
    await expect(creative.saveCreativeDirection(ctx, project)).rejects.toThrow(/Confirm the latest Creative Direction Brief/);
    await creative.confirmCreativeBrief(ctx, project, revised, 'The revised atmosphere is agreed.');
    const second = await creative.saveCreativeDirection(ctx, project);
    expect(second.version).toBe(2);
  });

  it('approves one concept by name and revokes the approval with a change request', async () => {
    await approveKit();
    const brief = await creative.saveCreativeBrief(ctx, project);
    await creative.confirmCreativeBrief(ctx, project, brief, 'Confirmed.');
    const direction = await creative.saveCreativeDirection(ctx, project);
    const concept = direction.content.concepts[1];
    await creative.recordDirectionFeedback(ctx, project, direction, concept.key, 'feedback', 'The team prefers this territory to the first.');
    await creative.approveDirectionConcept(ctx, project, direction, concept.key, 'Approved by the design lead for phase 4.');
    const approved = await creative.approvedCreativeDirection(ctx, project);
    expect(approved?.concept.key).toBe(concept.key);
    expect(approved?.approval.note).toContain('design lead');

    await creative.recordDirectionFeedback(ctx, project, direction, concept.key, 'request_changes', 'The photography direction needs a lower-light treatment.');
    expect(await creative.approvedCreativeDirection(ctx, project)).toBeNull();

    await creative.approveDirectionConcept(ctx, project, direction, concept.key, 'Re-approved after the photography note was addressed.');
    expect((await creative.approvedCreativeDirection(ctx, project))?.approval.note).toContain('Re-approved');
  });

  it('refuses a direction with three concepts that share a composition', async () => {
    await approveKit();
    const brief = await creative.saveCreativeBrief(ctx, project);
    await creative.confirmCreativeBrief(ctx, project, brief, 'Confirmed.');
    const direction = await creative.saveCreativeDirection(ctx, project);
    const broken = structuredClone(direction.content);
    broken.concepts[1].composition = { ...broken.concepts[0].composition };
    await expect(
      ctx.store.createStudioCreativeDirection({
        projectId: project.id,
        briefId: direction.briefId,
        version: 2,
        content: broken,
        generatedBy: 'deterministic',
        derivedFromId: direction.id,
        note: '',
      }),
    ).rejects.toThrow(/composition/);
  });

  it('creates a revised direction version and refuses to approve it if it cites a revoked asset', async () => {
    await approveKit();
    const brief = await creative.saveCreativeBrief(ctx, project);
    await creative.confirmCreativeBrief(ctx, project, brief, 'Confirmed.');
    const direction = await creative.saveCreativeDirection(ctx, project);
    const target = direction.content.concepts[0];
    const revised = await creative.saveDirectionRevision(ctx, project, direction, target.key, { name: 'A Sharper Archive', primaryCta: 'Begin a commission' }, 'Sharpened the name and the action.');
    expect(revised.version).toBe(2);
    expect(revised.derivedFromId).toBe(direction.id);
    expect(revised.content.concepts[0].name).toBe('A Sharper Archive');

    await vault.revokeStudioAsset(ctx, project, logo, 'The owner withdrew permission for the mark.');
    await expect(creative.approveDirectionConcept(ctx, project, revised, target.key, 'Approved.')).rejects.toThrow(/approv|permission|cites/i);
  });

  it('will not write a brief or direction into an archived concept', async () => {
    await approveKit();
    const archived = await studio.archiveStudioConcept(ctx, project);
    await expect(creative.saveCreativeBrief(ctx, archived)).rejects.toThrow(/archived/);
    await expect(creative.saveCreativeDirection(ctx, archived)).rejects.toThrow(/archived/);
  });
});

