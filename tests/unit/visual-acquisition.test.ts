import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAssetStorage } from '@/lib/data/asset-storage';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { downloadWebsiteResourceKit } from '@/lib/data/resource-services';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import * as studio from '@/lib/data/studio-services';
import * as acquisition from '@/lib/data/visual-acquisition-services';
import type { BusinessForm } from '@/lib/domain/schemas';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { StudioProject } from '@/lib/domain/studio';
import { assetUsableInPrototype } from '@/lib/domain/studio-assets';
import {
  candidateReadyToApprove,
  classifyVisualImage,
  planVisualDiscovery,
  visualAcquisitionSummary,
  visualCandidateExportState,
  visualRequirementStatus,
  visualRequirementsFor,
  type VisualCandidate,
  type VisualImportRequest,
} from '@/lib/domain/visual-acquisition';
import type { Business } from '@/lib/domain/types';

// The acquisition pipeline against the demo adapters: discovery records addresses only, a rights
// basis is required before bytes are stored, duplicates are refused, approval is explicit, and the
// kit carries exactly the four export-cleared files. Every fixture is synthetic.

const SITE = 'https://resource-hotel.example.org';
const PHOTOGRAPHER = 'https://cdn.fictional-photographer.example.net';

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

const form = (): BusinessForm => ({
  name: 'Fictional Harbour Hotel',
  category: 'Hotel',
  country: 'GH',
  region: 'Greater Accra',
  districtCode: null,
  city: 'Cape Coast',
  neighborhood: null,
  address: '1 Sample Quay',
  businessStatus: 'active',
  officialWebsite: SITE,
  socialProfiles: [],
  enquiryChannel: null,
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
});

const DRAFTS = [
  { imageUrl: `${SITE}/media/harbour-hotel-logo.png`, label: 'Harbour Hotel logo', alt: 'Harbour Hotel logo' },
  { imageUrl: `${SITE}/media/hotel-exterior.jpg`, label: 'Hotel exterior at dusk', alt: 'Hotel exterior at dusk' },
  { imageUrl: `${SITE}/media/suite-bedroom.jpg`, label: 'Deluxe suite bedroom', alt: 'Deluxe suite bedroom' },
  { imageUrl: `${SITE}/media/restaurant-dish.jpg`, label: 'Jollof rice served in the hotel restaurant', alt: 'Jollof rice served in the hotel restaurant' },
  { imageUrl: `${PHOTOGRAPHER}/harbour/guest-lounge.jpg`, label: 'Guest lounge photograph by Kofi Mensah', alt: 'Guest lounge photograph by Kofi Mensah' },
  { imageUrl: `${PHOTOGRAPHER}/harbour/pool.jpg`, label: 'Pool photograph by Kofi Mensah', alt: 'Pool photograph by Kofi Mensah' },
];

let ctx: ServiceContext;
let business: Business;
let project: StudioProject;

const request = (overrides: Partial<VisualImportRequest> = {}): VisualImportRequest => ({
  rightsBasis: 'business_owned_website',
  evidence: 'Read on the verified homepage on 31 October 2026; the business publishes its own hotel photography there.',
  businessOwnershipConfirmed: true,
  exportAuthorized: true,
  ...overrides,
});

async function discover(): Promise<VisualCandidate[]> {
  const result = await acquisition.discoverVisualCandidates(ctx, business, project, SITE, DRAFTS);
  return result.created;
}

beforeEach(async () => {
  ctx = { store: new LocalStore(new MemoryStorage()), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user', assets: new MemoryAssetStorage() };
  business = await svc.createBusiness(ctx, form());
  project = await studio.createStudioConcept(ctx, business);
});

describe('domain rules', () => {
  it('classifies images from the page labels and refuses to call a reference a licence', () => {
    expect(classifyVisualImage({ imageUrl: `${SITE}/x.png`, alt: 'Harbour Hotel logo' })).toBe('logo');
    expect(classifyVisualImage({ imageUrl: `${SITE}/suite-bedroom.jpg`, alt: null })).toBe('rooms');
    expect(classifyVisualImage({ imageUrl: `${SITE}/dish.jpg`, alt: 'Jollof rice served in the restaurant' })).toBe('product');
    expect(classifyVisualImage({ imageUrl: `${SITE}/team.jpg`, alt: null })).toBe('staff');
  });

  it('plans discovery from the recorded site only and refuses Google and social hosts', () => {
    const plan = planVisualDiscovery({
      business,
      businessId: business.id,
      projectId: project.id,
      pageUrl: SITE,
      drafts: [
        ...DRAFTS,
        { imageUrl: 'https://lh3.googleusercontent.com/places/photo', label: 'Google photo', alt: null },
        { imageUrl: 'https://cdninstagram.com/photo.jpg', label: 'Instagram photo', alt: null },
      ],
      existing: [],
    });
    expect(plan.accepted).toHaveLength(6);
    expect(plan.accepted.every((c) => c.rightsBasis === 'not_established' && c.status === 'reference_only')).toBe(true);
    expect(plan.skipped.filter((s) => /Google and social-platform/.test(s.reason))).toHaveLength(2);
    expect(plan.accepted.filter((c) => c.sourceKind === 'third_party_reference')).toHaveLength(2);
  });

  it('requires a hotel to supply a logo, exterior, interior, room and staff photograph', () => {
    const requirements = visualRequirementsFor('Hotel');
    expect(requirements.map((r) => r.key)).toEqual(['logo', 'exterior', 'interior', 'rooms', 'staff']);
    const status = visualRequirementStatus(requirements, []);
    expect(status.every((r) => !r.met)).toBe(true);
  });
});

describe('discovery', () => {
  it('records every reference with its source, type, relevance and an unestablished rights state', async () => {
    const created = await discover();
    expect(created).toHaveLength(6);
    expect(created.map((c) => c.imageType)).toEqual(['logo', 'exterior', 'rooms', 'product', 'interior', 'gallery']);
    expect(created.every((c) => c.rightsBasis === 'not_established' && c.status === 'reference_only')).toBe(true);
    expect(created.every((c) => c.assetId === null && c.checksumSha256 === null)).toBe(true);
    expect(created[0].relevance).toMatch(/business publishes the file itself/);
    expect(created[4].relevance).toMatch(/third party/);
    expect(await ctx.store.listVisualCandidateEvents(created[0].id)).toHaveLength(1);
    // Re-running the same page reports duplicates rather than recording them twice.
    const again = await acquisition.discoverVisualCandidates(ctx, business, project, SITE, DRAFTS);
    expect(again.created).toHaveLength(0);
    expect(again.skipped.every((s) => /Already recorded/.test(s.reason))).toBe(true);
  });

  it('refuses a page that is not the recorded official website', async () => {
    await expect(acquisition.discoverVisualCandidates(ctx, business, project, 'https://elsewhere.example.com', DRAFTS)).rejects.toThrow(/verified official website/);
  });
});

describe('authorization and import', () => {
  it('refuses to copy anything without a recorded rights basis or ownership confirmation', async () => {
    const [logo] = await discover();
    const original = { bytes: png(900, 300), fileName: 'harbour-hotel-logo.png', mimeType: 'image/png', finalUrl: logo.imageUrl };
    await expect(
      acquisition.importVisualCandidate(ctx, business, project, logo, request({ rightsBasis: 'not_established' }), original),
    ).rejects.toThrow(/rights basis/i);
    await expect(
      acquisition.importVisualCandidate(ctx, business, project, logo, request({ businessOwnershipConfirmed: false }), original),
    ).rejects.toThrow(/own website/);
    expect(await ctx.store.listStudioAssets(project.id)).toHaveLength(0);
    expect((await ctx.store.getVisualCandidate(logo.id))?.status).toBe('reference_only');
  });

  it('takes the stored file back out when the ledger cannot record it', async () => {
    const [logo] = await discover();
    const original = { bytes: png(900, 300), fileName: 'harbour-hotel-logo.png', mimeType: 'image/png', finalUrl: logo.imageUrl };
    const update = ctx.store.updateVisualCandidate;
    ctx.store.updateVisualCandidate = (async () => {
      throw new Error('The ledger is unavailable.');
    }) as typeof update;
    await expect(acquisition.importVisualCandidate(ctx, business, project, logo, request(), original)).rejects.toThrow(/ledger is unavailable/i);
    ctx.store.updateVisualCandidate = update;
    // No orphan vault file, and the candidate is still an undecided reference.
    expect(await ctx.store.listStudioAssets(project.id)).toHaveLength(0);
    expect((await ctx.store.getVisualCandidate(logo.id))?.status).toBe('reference_only');
  });

  it('never downloads a third party image; only an uploaded original can be stored', async () => {
    const created = await discover();
    const thirdParty = created.find((c) => c.sourceKind === 'third_party_reference')!;
    await expect(
      acquisition.importVisualCandidate(ctx, business, project, thirdParty, request({ rightsBasis: 'written_permission' }), {
        bytes: png(800, 600),
        fileName: 'guest-lounge.jpg',
        mimeType: 'image/png',
        finalUrl: thirdParty.imageUrl,
      }),
    ).rejects.toThrow(/third party/i);
    const uploaded = await acquisition.attachAuthorizedVisualOriginal(ctx, business, project, thirdParty, request({ rightsBasis: 'written_permission', exportAuthorized: false }), {
      fileName: 'guest-lounge.png',
      declaredType: 'image/png',
      bytes: png(800, 600),
    });
    expect(uploaded.candidate).toMatchObject({ status: 'imported', importedVia: 'uploaded', rightsBasis: 'written_permission' });
    expect(uploaded.asset).toMatchObject({ status: 'candidate', exportPermission: 'unknown', publishPermission: 'unknown', kind: 'venue_photo' });
  });

  it('stores an authorized copy through the vault with its provenance, then refuses the same bytes twice', async () => {
    const [logo, exterior] = await discover();
    const saved = await acquisition.importVisualCandidate(ctx, business, project, logo, request(), {
      bytes: png(900, 300),
      fileName: 'harbour-hotel-logo.png',
      mimeType: 'image/png',
      finalUrl: logo.imageUrl,
    });
    expect(saved.asset).toMatchObject({ kind: 'logo', origin: 'client_supplied', exportPermission: 'granted', publishPermission: 'unknown', status: 'candidate' });
    expect(saved.candidate).toMatchObject({ status: 'imported', importedVia: 'downloaded', rightsBasis: 'business_owned_website' });
    expect(saved.candidate.checksumSha256).toHaveLength(64);
    await expect(
      acquisition.importVisualCandidate(ctx, business, project, exterior, request(), {
        bytes: png(900, 300),
        fileName: 'exterior.png',
        mimeType: 'image/png',
        finalUrl: exterior.imageUrl,
      }),
    ).rejects.toThrow(/already in the vault/);
    expect(await ctx.store.listStudioAssets(project.id)).toHaveLength(1);
  });

  it('refuses bytes that redirect away from the verified site', async () => {
    const [logo] = await discover();
    await expect(
      acquisition.importVisualCandidate(ctx, business, project, logo, request(), {
        bytes: png(900, 300),
        fileName: 'logo.png',
        mimeType: 'image/png',
        finalUrl: 'https://elsewhere.example.com/logo.png',
      }),
    ).rejects.toThrow(/redirected away/);
  });
});


describe('approval queue and export', () => {
  it('approves only export-cleared candidates and explains every skip', async () => {
    const created = await discover();
    const logo = created[0];
    const exterior = created[1];
    const lounge = created[4];
    await acquisition.importVisualCandidate(ctx, business, project, logo, request(), { bytes: png(900, 300), fileName: 'logo.png', mimeType: 'image/png', finalUrl: logo.imageUrl });
    await acquisition.importVisualCandidate(ctx, business, project, exterior, request({ exportAuthorized: false }), { bytes: png(1600, 900), fileName: 'exterior.png', mimeType: 'image/png', finalUrl: exterior.imageUrl });
    await acquisition.attachAuthorizedVisualOriginal(ctx, business, project, lounge, request({ rightsBasis: 'written_permission', exportAuthorized: false }), {
      fileName: 'lounge.png',
      declaredType: 'image/png',
      bytes: png(800, 600),
    });
    const refreshed = await ctx.store.listVisualCandidates(business.id);
    const result = await acquisition.approveVisualCandidates(ctx, business, project, refreshed.filter((c) => c.status === 'imported'));
    expect(result.approved.map((c) => c.label)).toEqual(['Harbour Hotel logo']);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].reason).toMatch(/Export permission/);
    const assets = await ctx.store.listStudioAssets(project.id);
    const logoAsset = assets.find((a) => a.id === result.approved[0].assetId)!;
    expect(logoAsset.status).toBe('approved');
    const candidates = await ctx.store.listVisualCandidates(business.id);
    expect(visualAcquisitionSummary(candidates, assets)).toMatchObject({ total: 6, referenceOnly: 3, imported: 3, exportable: 1, awaitingReview: 0, blocked: 2 });
    const exteriorCandidate = candidates.find((c) => c.label === 'Hotel exterior at dusk')!;
    expect(visualCandidateExportState(exteriorCandidate, assets.find((a) => a.id === exteriorCandidate.assetId)!)).toBe('not_exportable');
    expect(candidateReadyToApprove(exteriorCandidate, assets.find((a) => a.id === exteriorCandidate.assetId)!)[0]).toMatch(/Export permission/);
  });

  it('puts exactly the authorized logo and three photographs in assets/, and leaves references out', async () => {
    const created = await discover();
    const origins: [VisualCandidate, Uint8Array, string][] = [
      [created[0], png(900, 300), 'harbour-hotel-logo.png'],
      [created[1], png(1600, 900), 'hotel-exterior.png'],
      [created[2], png(1600, 901), 'suite-bedroom.png'],
      [created[3], png(1600, 902), 'restaurant-dish.png'],
    ];
    for (const [candidate, bytes, fileName] of origins) {
      await acquisition.importVisualCandidate(ctx, business, project, candidate, request(), { bytes, fileName, mimeType: 'image/png', finalUrl: candidate.imageUrl });
    }
    const stored = (await ctx.store.listVisualCandidates(business.id)).filter((c) => c.status === 'imported');
    const approved = await acquisition.approveVisualCandidates(ctx, business, project, stored);
    expect(approved.approved).toHaveLength(4);
    expect(approved.skipped).toHaveLength(0);

    const kit = await downloadWebsiteResourceKit(ctx, business.id, project);
    const decoded = new TextDecoder('latin1').decode(kit.zip);
    const assetPaths = kit.manifest.assets.map((a) => a.path).sort();
    expect(assetPaths).toHaveLength(4);
    expect(assetPaths.every((p) => /^assets\/\d{3}-/.test(p))).toBe(true);
    for (const path of assetPaths) expect(decoded).toContain(path);
    expect(kit.manifest.assets.map((a) => a.fileName).sort()).toEqual(['harbour-hotel-logo.png', 'hotel-exterior.png', 'restaurant-dish.png', 'suite-bedroom.png']);
    // The two reference-only photographs were never stored and are nowhere in the archive.
    expect(decoded).not.toContain('guest-lounge');
    expect(decoded).not.toContain('pool');
    expect(kit.manifest.assets.every((a) => a.permissions.export === 'granted' && a.permissions.publish !== 'granted')).toBe(true);
    expect(kit.readiness.visual.images).toBe(4);
    expect(kit.readiness.visual.groups.find((g) => g.key === 'business_owned')?.exportable).toBe(4);
    // The Studio reads the vault itself, so a file is design-usable only after approval.
    const assets = await ctx.store.listStudioAssets(project.id);
    expect(assets).toHaveLength(4);
    expect(assets.every((asset) => assetUsableInPrototype(asset))).toBe(true);
  });

  it('keeps a rejected candidate and its stored file out of the kit', async () => {
    const created = await discover();
    const saved = await acquisition.importVisualCandidate(ctx, business, project, created[0], request(), { bytes: png(900, 300), fileName: 'logo.png', mimeType: 'image/png', finalUrl: created[0].imageUrl });
    const stored = (await ctx.store.listVisualCandidates(business.id)).find((c) => c.status === 'imported')!;
    expect(stored.assetId).toBe(saved.asset.id);
    await acquisition.rejectVisualCandidate(ctx, business, project, stored, 'The logo belongs to a former brand.');
    const after = (await ctx.store.getVisualCandidate(stored.id))!;
    expect(after.status).toBe('rejected');
    expect((await ctx.store.getStudioAsset(saved.asset.id))?.status).toBe('rejected');
    await expect(
      ctx.store.updateVisualCandidate(after.id, { status: 'imported' }),
    ).rejects.toThrow(/stays rejected/i);
    const kit = await downloadWebsiteResourceKit(ctx, business.id, project);
    expect(kit.manifest.assets).toHaveLength(0);
  });

  it('records an authorization request without copying the file', async () => {
    const created = await discover();
    const lounge = created[4];
    const updated = await acquisition.requestVisualAuthorization(ctx, lounge, 'Asked the hotel manager by email on 31 October 2026 for the lounge photograph.');
    expect(updated.status).toBe('reference_only');
    expect(updated.requestedAt).toBeTruthy();
    expect(updated.rightsBasis).toBe('not_established');
    expect(await ctx.store.listStudioAssets(project.id)).toHaveLength(0);
    await expect(acquisition.requestVisualAuthorization(ctx, lounge, 'asked')).rejects.toThrow(/at least 10 characters/);
  });
});

