import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAssetStorage } from '@/lib/data/asset-storage';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import * as studio from '@/lib/data/studio-services';
import * as vault from '@/lib/data/studio-asset-services';
import type { ServiceContext } from '@/lib/data/services';
import type { BusinessForm } from '@/lib/domain/schemas';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { StudioProject } from '@/lib/domain/studio';
import { brandKitSummary, emptyBrandKitContent, type BrandKitContent, type StudioAsset } from '@/lib/domain/studio-assets';
import type { Business } from '@/lib/domain/types';
import { FASHION_BUSINESS, SITE_URL } from './studio-fixtures';

// The vault as the team uses it: validated uploads, append-only decisions, revoked permission that
// keeps its evidence, a Brand Kit that only names approved files, and a pack that contains nothing
// but approved, unexpired, export-authorized copies.

const encoder = new TextEncoder();

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

let ctx: ServiceContext;
let business: Business;
let project: StudioProject;
let storage: MemoryAssetStorage;

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

const activities = async () => (await ctx.store.listActivities(business.id)).map((activity) => activity.summary);

async function approved(overrides: Partial<vault.AssetUploadInput> = {}): Promise<StudioAsset> {
  const asset = await vault.uploadStudioAsset(ctx, project, upload(overrides));
  return vault.approveStudioAsset(ctx, project, asset, 'Checked with the owner.');
}

function kit(logoId: string, photographyAssetIds: string[] = []): BrandKitContent {
  return {
    ...emptyBrandKitContent(),
    logoAssetIds: [logoId],
    palette: [
      { name: 'Ink', hex: '#1B2A41', role: 'Text' },
      { name: 'Kente red', hex: '#7A1F3D', role: 'Accent' },
    ],
    typography: [{ role: 'Display', family: 'Fraunces', weights: '400–700', licence: 'SIL Open Font License 1.1', assetId: null }],
    photographyAssetIds,
    personality: ['Quietly confident', 'Exacting', 'Warm'],
    visualDirection: 'Editorial and unhurried: warm off-white, one deep red, photography given room to breathe and type doing the talking.',
    toneOfVoice: { summary: 'Plain, precise and proud of the craft. Short sentences; no exclamation marks.', do: ['Name the fabric'], dont: ['Best in Ghana'] },
  };
}

beforeEach(async () => {
  storage = new MemoryAssetStorage();
  ctx = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user', assets: storage };
  business = await svc.createBusiness(ctx, form());
  project = await studio.createStudioConcept(ctx, business);
});

describe('adding a file', () => {
  it('validates, stores and records a candidate with its provenance and permissions', async () => {
    const asset = await vault.uploadStudioAsset(ctx, project, upload());
    expect(asset).toMatchObject({
      projectId: project.id,
      fileName: 'nsroma-logo.png',
      kind: 'logo',
      status: 'candidate',
      mimeType: 'image/png',
      width: 1200,
      height: 800,
      bytes: 33,
      origin: 'client_supplied',
      ownerName: 'Nsroma Atelier',
      storePermission: 'granted',
      publishPermission: 'denied',
    });
    expect(asset.storagePath).toBe(`${project.organizationId}/${project.id}/${asset.id}/nsroma-logo.png`);
    expect(asset.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await storage.count()).toBe(1);
    const stored = await storage.get(asset.storagePath);
    expect(stored?.contentType).toBe('image/png');
    expect(stored?.bytes).toEqual(png(1200, 800));
    expect((await ctx.store.listStudioAssetEvents(project.id))[0]).toMatchObject({ assetId: asset.id, action: 'uploaded' });
    expect((await activities())[0]).toContain('Asset added: nsroma-logo.png');
  });

  it('refuses a file whose bytes do not match its type, and stores nothing', async () => {
    await expect(vault.uploadStudioAsset(ctx, project, upload({ declaredType: 'image/jpeg' }))).rejects.toThrow(/contents are image\/png/);
    expect(await storage.count()).toBe(0);
    expect(await ctx.store.listStudioAssets(project.id)).toEqual([]);
  });

  it('refuses an SVG and a kind that does not fit the file', async () => {
    await expect(
      vault.uploadStudioAsset(ctx, project, upload({ fileName: 'mark.svg', declaredType: 'image/svg+xml', bytes: encoder.encode('<svg/>') })),
    ).rejects.toThrow(/not accepted/);
    await expect(vault.uploadStudioAsset(ctx, project, upload({ kind: 'video' }))).rejects.toThrow(/Approved video cannot be a image\/png file/);
    expect(await storage.count()).toBe(0);
  });

  it('refuses an upload to an archived concept', async () => {
    const archived = await studio.archiveStudioConcept(ctx, project);
    await expect(vault.uploadStudioAsset(ctx, archived, upload())).rejects.toThrow(/archived/);
  });

  it('removes the stored object when the record is refused', async () => {
    await expect(vault.uploadStudioAsset(ctx, project, upload({ permissionEvidence: 'no' }))).rejects.toThrow(/evidence/);
    expect(await storage.count()).toBe(0);
  });

  it('fingerprints the exact bytes', async () => {
    expect(await vault.sha256Hex(encoder.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});


describe('reviewing an asset', () => {
  it('approves a candidate only when the evidence and permission are in place', async () => {
    const asset = await vault.uploadStudioAsset(ctx, project, upload({ storePermission: 'unknown' }));
    await expect(vault.approveStudioAsset(ctx, project, asset, 'Fine.')).rejects.toThrow(/permission to keep/);
    const fixed = await ctx.store.updateStudioAsset(asset.id, { storePermission: 'granted' });
    const approvedAsset = await vault.approveStudioAsset(ctx, project, fixed, 'Owned by the business.');
    expect(approvedAsset.status).toBe('approved');
    expect(approvedAsset.approvedAt).not.toBeNull();
    expect(approvedAsset.reviewNote).toBe('Owned by the business.');
    expect((await ctx.store.listStudioAssetEvents(project.id)).map((event) => event.action)).toEqual(['approved', 'uploaded']);
  });

  it('rejects with a reason, keeping the file and the history', async () => {
    const asset = await vault.uploadStudioAsset(ctx, project, upload());
    await expect(vault.rejectStudioAsset(ctx, project, asset, '')).rejects.toThrow(/Explain/);
    const rejected = await vault.rejectStudioAsset(ctx, project, asset, 'It is a screenshot, not the original logo.');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedReason).toBe('It is a screenshot, not the original logo.');
    expect(await storage.count()).toBe(1);
    expect((await ctx.store.listStudioAssetEvents(project.id))[0]).toMatchObject({ action: 'rejected' });
  });

  it('revokes an approved asset, denies every use and names the kits that relied on it', async () => {
    const logo = await approved();
    await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'First draft.');
    const revoked = await vault.revokeStudioAsset(ctx, project, logo, 'The photographer withdrew the licence.');
    expect(revoked.status).toBe('revoked');
    expect(revoked).toMatchObject({ prototypePermission: 'denied', exportPermission: 'denied', publishPermission: 'denied' });
    expect(await storage.count()).toBe(1);
    const summary = (await activities())[0];
    expect(summary).toContain('Asset permission revoked: nsroma-logo.png');
    expect(summary).toContain('1 brand kit version');
    await expect(vault.revokeStudioAsset(ctx, project, revoked, 'Again.')).rejects.toThrow(/Only an approved asset/);
  });

  it('annotates without changing the decision', async () => {
    const asset = await vault.uploadStudioAsset(ctx, project, upload());
    const noted = await vault.annotateStudioAsset(ctx, project, asset, 'Ask for the vector original.');
    expect(noted.note).toBe('Ask for the vector original.');
    expect(noted.status).toBe('candidate');
    expect((await ctx.store.listStudioAssetEvents(project.id))[0].action).toBe('annotated');
  });

  it('replaces a file with a new candidate and keeps the old one as history', async () => {
    const first = await approved();
    const replacement = await vault.replaceStudioAsset(
      ctx,
      project,
      first,
      { fileName: 'nsroma-logo-large.png', declaredType: 'image/png', bytes: png(2400, 1600) },
      'A larger export from the designer.',
    );
    expect(replacement).toMatchObject({ status: 'candidate', supersedesId: first.id, width: 2400, height: 1600, ownerName: first.ownerName, exportPermission: first.exportPermission });
    const stored = await ctx.store.listStudioAssets(project.id);
    expect(stored.find((asset) => asset.id === first.id)?.status).toBe('superseded');
    expect(await storage.count()).toBe(2);
    expect((await activities())[0]).toContain('Asset replaced: nsroma-logo.png → nsroma-logo-large.png');
    await expect(
      vault.replaceStudioAsset(ctx, project, { ...first, status: 'superseded' }, { fileName: 'x.png', declaredType: 'image/png', bytes: png() }, ''),
    ).rejects.toThrow(/already replaced/);
  });

  it('deletes the record and the stored bytes', async () => {
    const asset = await approved();
    await vault.deleteStudioAsset(ctx, project, asset);
    expect(await ctx.store.getStudioAsset(asset.id)).toBeNull();
    expect(await storage.count()).toBe(0);
    expect((await activities())[0]).toContain('Asset deleted');
  });
});


describe('remote references', () => {
  it('records an address without fetching it, and refuses a duplicate', async () => {
    const reference = await vault.recordStudioAssetReference(ctx, project, {
      address: 'https://maps.google.com/place/nsroma',
      label: 'Shopfront photograph on their Maps listing',
      source: 'platform_listing',
      note: 'Could inform the exterior shot; the file is not ours.',
    });
    expect(reference).toMatchObject({ status: 'recorded', projectId: project.id, source: 'platform_listing' });
    expect((await activities())[0]).toContain('Reference recorded, not imported');
    await expect(
      vault.recordStudioAssetReference(ctx, project, { address: 'https://maps.google.com/place/nsroma', label: 'Again', source: 'platform_listing' }),
    ).rejects.toThrow(/already recorded/);
  });

  it('declines a reference and keeps it in the ledger', async () => {
    const reference = await vault.recordStudioAssetReference(ctx, project, {
      address: 'https://instagram.com/p/abc',
      label: 'A photograph from their Instagram',
      source: 'social_profile',
    });
    const declined = await vault.declineStudioAssetReference(ctx, project, reference, 'Not relevant to the direction.');
    expect(declined.status).toBe('declined');
    expect((await ctx.store.listStudioAssetReferences(project.id))[0].status).toBe('declined');
  });

  it('refuses an address that is not a web page', async () => {
    await expect(vault.recordStudioAssetReference(ctx, project, { address: 'javascript:alert(1)', label: 'Bad', source: 'public_page' })).rejects.toThrow(/http/);
    await expect(vault.recordStudioAssetReference(ctx, project, { address: 'data:image/png;base64,AAAA', label: 'Bad', source: 'public_page' })).rejects.toThrow(/http/);
  });
});

describe('the Brand Kit', () => {
  it('saves versioned content that names only approved files', async () => {
    const logo = await approved();
    const { version } = await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'First direction.');
    expect(version.version).toBe(1);
    expect(brandKitSummary(version.content)).toContain('1 logo');
    const second = await vault.saveBrandKitVersion(ctx, project, { ...kit(logo.id), personality: ['Quiet', 'Exacting', 'Warm'] }, 'Tightened.');
    expect(second.version.version).toBe(2);
    expect((await activities())[0]).toContain('Brand Kit version 2 saved');
  });

  it('refuses a candidate, a stranger or an unapproved file in the kit', async () => {
    const candidate = await vault.uploadStudioAsset(ctx, project, upload());
    await expect(vault.saveBrandKitVersion(ctx, project, kit(candidate.id), 'Draft.')).rejects.toThrow(/not approved/);
    await expect(vault.saveBrandKitVersion(ctx, project, kit('99999999-9999-4999-8999-999999999999'), 'Draft.')).rejects.toThrow(/not in this concept/);
  });

  it('approves a complete version with a named person and keeps it immutable', async () => {
    const logo = await approved();
    const { version } = await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'First direction.');
    const approval = await vault.approveBrandKitVersion(ctx, project, version, 'Agreed with the owner on 25 October.');
    expect(approval).toMatchObject({ versionId: version.id, note: 'Agreed with the owner on 25 October.', approvedBy: 'demo-user' });
    expect((await activities())[0]).toContain('Brand Kit version 1 approved');
    const approvedKit = await vault.approvedBrandKit(ctx, project);
    expect(approvedKit?.version.id).toBe(version.id);
    // The content row is untouched by approval; history is the approval itself.
    expect((await ctx.store.listStudioBrandKitVersions(version.kitId))[0].content).toEqual(version.content);
  });

  it('refuses an incomplete kit at approval, and an older version after a newer approval', async () => {
    const logo = await approved();
    const incomplete = await vault.saveBrandKitVersion(ctx, project, { ...kit(logo.id), typography: [], palette: [] }, 'Rough.');
    await expect(vault.approveBrandKitVersion(ctx, project, incomplete.version, 'Not ready.')).rejects.toThrow(/two colours|typeface/);

    const good = await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'Complete.');
    await vault.approveBrandKitVersion(ctx, project, good.version, 'Approved.');
    const later = await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'Another.');
    await expect(vault.approveBrandKitVersion(ctx, project, good.version, 'Again.')).rejects.toThrow(/already approved/);
    await vault.approveBrandKitVersion(ctx, project, later.version, 'Newer.');
    await expect(vault.approveBrandKitVersion(ctx, project, good.version, 'Older.')).rejects.toThrow(/already approved/);
  });

  it('requires the approval reason and the licence for every typeface', async () => {
    const logo = await approved();
    const { version } = await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'First.');
    await expect(vault.approveBrandKitVersion(ctx, project, version, '')).rejects.toThrow(/Explain/);
    const unlicensed = await vault.saveBrandKitVersion(
      ctx,
      project,
      { ...kit(logo.id), typography: [{ role: 'Display', family: 'Fraunces', weights: '', licence: '', assetId: null }] },
      'No licence.',
    );
    await expect(vault.approveBrandKitVersion(ctx, project, unlicensed.version, 'Checked.')).rejects.toThrow(/web licence/);
  });
});


describe('the approved pack', () => {
  it('includes only approved files with export permission, their licence and their credit', async () => {
    const logo = await approved({
      licenceName: 'Client ownership declaration',
      licenceReference: 'Email 21 Oct 2026',
      attributionRequired: true,
      attributionText: 'Logo © Nsroma Atelier, used with permission.',
    });
    const candidate = await vault.uploadStudioAsset(ctx, project, upload({ fileName: 'sketch.png' }));
    const rejected = await vault.uploadStudioAsset(ctx, project, upload({ fileName: 'screenshot.png' }));
    await vault.rejectStudioAsset(ctx, project, rejected, 'A screenshot, not the original.');

    const pack = await vault.exportStudioAssetPack(ctx, project);
    expect(pack.included).toBe(1);
    expect(pack.excluded).toBe(2);
    expect(pack.manifest.assets.map((asset) => asset.fileName)).toEqual(['nsroma-logo.png']);
    expect(pack.manifest.assets[0]).toMatchObject({
      kind: 'logo',
      sha256: logo.checksumSha256,
      licence: { name: 'Client ownership declaration', reference: 'Email 21 Oct 2026' },
      attribution: { required: true, text: 'Logo © Nsroma Atelier, used with permission.' },
      permissions: { export: 'granted', publish: 'denied' },
    });
    expect(pack.filename).toBe('nsroma-atelier-website-concept-asset-pack-' + pack.manifest.generatedAt.slice(0, 10) + '.zip');
    expect(pack.manifest.excludedCount).toBe(2);
    expect(candidate.status).toBe('candidate');
    const text = new TextDecoder().decode(pack.zip);
    expect(text).toContain('manifest.json');
    expect(text).toContain('ATTRIBUTION.txt');
    expect(text).toContain('Logo © Nsroma Atelier, used with permission.');
    expect(text).toContain('assets/001-nsroma-logo.png');
    expect(text).not.toContain('assets/002-sketch.png');
    expect((await activities())[0]).toContain('Asset pack exported: 1 file, 2 excluded');
  });

  it('leaves out an approved file whose export permission is not recorded', async () => {
    await approved({ exportPermission: 'unknown', fileName: 'no-export.png' });
    await expect(vault.exportStudioAssetPack(ctx, project)).rejects.toThrow(/nothing in this pack/);
  });

  it('refuses an export when an approved file has disappeared from storage', async () => {
    const logo = await approved();
    await storage.remove([logo.storagePath]);
    await expect(vault.exportStudioAssetPack(ctx, project)).rejects.toThrow(/stored file is missing/);
  });

  it('names the approved Brand Kit version in the manifest', async () => {
    const logo = await approved();
    const { version } = await vault.saveBrandKitVersion(ctx, project, kit(logo.id), 'First.');
    await vault.approveBrandKitVersion(ctx, project, version, 'Agreed.');
    const pack = await vault.exportStudioAssetPack(ctx, project);
    expect(pack.manifest.approvedBrandKit?.version).toBe(1);
    expect(pack.manifest.note).toMatch(/does not grant permission/);
    expect((await vault.approvedBrandKit(ctx, project))?.version.version).toBe(1);
  });
});

