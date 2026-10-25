import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAssetStorage } from '@/lib/data/asset-storage';
import * as creative from '@/lib/data/creative-direction-services';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import * as studio from '@/lib/data/studio-services';
import * as vault from '@/lib/data/studio-asset-services';
import { saveWebsitePrototype } from '@/lib/data/website-prototype-services';
import type { ServiceContext } from '@/lib/data/services';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import { emptyBrandKitContent, type BrandKitContent, type StudioAsset } from '@/lib/domain/studio-assets';
import type { StudioProject } from '@/lib/domain/studio';
import type { StudioCreativeBrief } from '@/lib/domain/creative-direction';
import type { BusinessForm } from '@/lib/domain/schemas';
import type { Business } from '@/lib/domain/types';
import { buildWebsiteBlueprint, IMAGE_PENDING_ASSET } from '@/lib/domain/website-compositions';
import { FASHION_BUSINESS, SITE_URL } from './studio-fixtures';

// The prototype save gate: a current approval for the exact concept, a blueprint bound to that
// direction and kit, prototype-cleared media, and an append-only version number.

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
let kitVersionId: string;
let direction: Awaited<ReturnType<typeof creative.saveCreativeDirection>>;

async function approvedProject() {
  const savedKit = await vault.saveBrandKitVersion(ctx, project, kitContent(logo.id), 'First kit');
  kitVersionId = savedKit.version.id;
  await vault.approveBrandKitVersion(ctx, project, savedKit.version, 'Agreed with the owner on 25 October.');
  const brief = await creative.saveCreativeBrief(ctx, project);
  await creative.confirmCreativeBrief(ctx, project, brief, 'The brief reflects what we know; open questions are recorded.');
  direction = await creative.saveCreativeDirection(ctx, project);
  const concept = direction.content.concepts[0];
  await creative.approveDirectionConcept(ctx, project, direction, concept.key, 'Approved by the design lead for a rendered prototype.');
  return { brief, concept };
}

async function blueprintFrom(activeDirection: typeof direction, briefContent: StudioCreativeBrief | null, conceptKey: string) {
  if (!briefContent) throw new Error('No brief');
  return buildWebsiteBlueprint({
    project,
    business,
    brief: briefContent.content,
    direction: { id: activeDirection.id, version: activeDirection.version, content: activeDirection.content },
    conceptKey,
    kit: { versionId: kitVersionId, version: 1 },
    assets: await ctx.store.listStudioAssets(project.id),
    roleAssets: {},
    availableMediaIds: [],
    synthetic: false,
    generatedAt: '2026-10-25T09:00:00.000Z',
  });
}

async function blueprintFor(conceptKey: string) {
  const approved = await creative.approvedCreativeDirection(ctx, project);
  if (!approved) throw new Error('No approved direction');
  const brief = await ctx.store.getStudioCreativeBrief(approved.direction.briefId);
  return blueprintFrom(approved.direction, brief, conceptKey);
}

beforeEach(async () => {
  ctx = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user', assets: new MemoryAssetStorage() };
  business = await svc.createBusiness(ctx, form());
  project = await studio.createStudioConcept(ctx, business);
  logo = await vault.uploadStudioAsset(ctx, project, upload());
  logo = await vault.approveStudioAsset(ctx, project, logo, 'Checked with the owner.');
});

describe('saving a rendered website prototype', () => {
  it('saves an immutable version from the approved concept and uses labelled media when no photo exists', async () => {
    const { concept } = await approvedProject();
    const blueprint = await blueprintFor(concept.key);
    expect(blueprint.readiness.previewReady).toBe(true);
    expect(blueprint.assets.map((asset) => asset.id)).toContain(IMAGE_PENDING_ASSET.id);

    const first = await saveWebsitePrototype(ctx, project, direction, concept.key, blueprint, 'First render from the approved archive concept.');
    expect(first.version).toBe(1);
    expect(first.conceptKey).toBe(concept.key);
    expect(first.content.format).toBe('dof-website-blueprint/1');
    expect(await ctx.store.listStudioWebsitePrototypes(project.id)).toHaveLength(1);

    const second = await saveWebsitePrototype(ctx, project, direction, concept.key, blueprint, 'Re-rendered without changing the direction.');
    expect(second.version).toBe(2);
    const activities = (await ctx.store.listActivities(business.id)).map((activity) => activity.summary);
    expect(activities.some((summary) => summary.includes('Website prototype saved (version 1)'))).toBe(true);
  });

  it('refuses to render without a current approval or after a change request revokes it', async () => {
    const savedKit = await vault.saveBrandKitVersion(ctx, project, kitContent(logo.id), 'First kit');
    kitVersionId = savedKit.version.id;
    await vault.approveBrandKitVersion(ctx, project, savedKit.version, 'Agreed with the owner.');
    const brief = await creative.saveCreativeBrief(ctx, project);
    await creative.confirmCreativeBrief(ctx, project, brief, 'Confirmed.');
    direction = await creative.saveCreativeDirection(ctx, project);
    const concept = direction.content.concepts[1];
    const blueprint = await blueprintFrom(direction, brief, concept.key);

    await expect(saveWebsitePrototype(ctx, project, direction, concept.key, blueprint, 'No approval yet.')).rejects.toThrow(/Approve this exact direction/i);
    await creative.approveDirectionConcept(ctx, project, direction, concept.key, 'Approved for the prototype.');
    await creative.recordDirectionFeedback(ctx, project, direction, concept.key, 'request_changes', 'The photography direction needs a lower-light treatment.');
    await expect(saveWebsitePrototype(ctx, project, direction, concept.key, blueprint, 'After the change request.')).rejects.toThrow(/Approve this exact direction/i);
  });

  it('refuses a blueprint bound to another direction, kit or unapproved asset', async () => {
    const { concept } = await approvedProject();
    const blueprint = await blueprintFor(concept.key);

    const wrongDirection = structuredClone(blueprint);
    wrongDirection.direction.directionId = 'another-direction';
    await expect(saveWebsitePrototype(ctx, project, direction, concept.key, wrongDirection, 'Wrong direction.')).rejects.toThrow(/bound to the approved direction/i);

    const wrongKit = structuredClone(blueprint);
    wrongKit.brandKit.versionId = 'another-kit';
    await expect(saveWebsitePrototype(ctx, project, direction, concept.key, wrongKit, 'Wrong kit.')).rejects.toThrow(/different Brand Kit/i);

    const fakeAsset = structuredClone(blueprint);
    fakeAsset.assets.push({
      id: 'not-in-the-vault',
      fileName: 'not-approved.jpg',
      kind: 'product_photo',
      mimeType: 'image/jpeg',
      width: 1000,
      height: 1000,
      alt: 'An invented asset that is not in the vault.',
      caption: null,
      credit: null,
      licence: { name: 'Unknown', reference: null, expiresOn: null, url: null },
      permission: 'prototype',
      sourceKind: 'licensed_concept',
      sourcePath: '/showcase/nsroma/not-approved.jpg',
      sourceUrl: null,
      checksum: null,
    });
    await expect(saveWebsitePrototype(ctx, project, direction, concept.key, fakeAsset, 'Fake asset.')).rejects.toThrow(/not an approved|not cleared/i);
  });

  it('refuses an archived concept', async () => {
    const { concept } = await approvedProject();
    const blueprint = await blueprintFor(concept.key);
    const archived = await studio.archiveStudioConcept(ctx, project);
    await expect(saveWebsitePrototype(ctx, archived, direction, concept.key, blueprint, 'Archived.')).rejects.toThrow(/archived/i);
  });

  it('refuses another concept’s blueprint', async () => {
    const { concept } = await approvedProject();
    const otherConcept = direction.content.concepts.find((entry) => entry.key !== concept.key)!;
    const blueprint = await blueprintFor(otherConcept.key);
    await expect(saveWebsitePrototype(ctx, project, direction, concept.key, blueprint, 'Wrong concept.')).rejects.toThrow(/bound|concept/i);
  });
});
