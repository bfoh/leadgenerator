import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { MemoryAssetStorage } from '@/lib/data/asset-storage';
import type { ServiceContext } from '@/lib/data/services';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import { resourceEntrySchema, restrictedResourceUrl, resourceConflicts, websiteResourceCandidates } from '@/lib/domain/business-resources';
import { assetExportProblems } from '@/lib/domain/studio-assets';
import { addResourceEntry, downloadWebsiteResourceKit, openResourceVault } from '@/lib/data/resource-services';
import { approveStudioAsset, revokeStudioAsset, uploadStudioAsset } from '@/lib/data/studio-asset-services';
import { googleResourceDetails, googleResourcePhoto, googleResourceSearch, RESOURCE_DETAIL_FIELDS } from '@/lib/server/providers/google-places';
import { collectGoogleListing, resourceGoogleStatus, simulatedResourceListing } from '@/lib/server/resource-collector';
import { extractPageFacts } from '@/lib/domain/page-signals';

const entry = { businessId: '00000000-0000-4000-8000-000000000001', category: 'service' as const, label: 'Services', value: 'Original owner-authorized service description', sourceKind: 'business_owner' as const, sourceUrl: 'https://sample.example.org/permission', evidence: 'Owner email dated 25 October permits independent verification, storage and export.', independentlyVerified: true as const, exportPermission: 'granted' as const };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Independent resources and permitted downloads', () => {
  it.each(['https://maps.google.com/place/test', 'https://lh3.googleusercontent.com/image', 'https://maps.app.goo.gl/test', 'https://instagram.com/business', 'javascript:alert(1)', 'https://user:password@official.example.org'])('refuses restricted or unsafe independent source %s', (url) => {
    expect(restrictedResourceUrl(url)).toBe(true);
    expect(resourceEntrySchema.safeParse({ ...entry, sourceUrl: url }).success).toBe(false);
  });
  it('requires independent verification, permission evidence and a non-Google source type', () => {
    expect(resourceEntrySchema.safeParse({ ...entry, sourceKind: 'google' }).success).toBe(false);
    expect(resourceEntrySchema.safeParse({ ...entry, independentlyVerified: false }).success).toBe(false);
    expect(resourceEntrySchema.safeParse({ ...entry, evidence: '' }).success).toBe(false);
  });
  it('deduplicates structural website image references and excludes platform images', () => {
    const facts = extractPageFacts('<title>Bakery</title><img src="/logo.png" alt="Logo"><img src="/logo.png" alt="Logo"><img src="https://lh3.googleusercontent.com/photo" alt="Photo">', 'https://sample.example.org');
    const candidates = websiteResourceCandidates({ url: 'https://sample.example.org', facts, contacts: null, error: null, simulated: false });
    expect(candidates.filter((v) => v.url.includes('logo.png'))).toHaveLength(1);
    expect(candidates.find((v) => v.url.includes('logo.png'))?.kind).toBe('logo');
    expect(candidates.some((v) => v.url.includes('googleusercontent'))).toBe(false);
  });
  it('flags conflicts without overwriting either source', () => {
    const listing = simulatedResourceListing('fictional_no_website');
    const before = JSON.stringify(listing);
    expect(resourceConflicts(listing, [{ ...entry, label: 'Phone', value: '+233 24 123 4567', revokedAt: null } as never])).toHaveLength(1);
    expect(JSON.stringify(listing)).toBe(before);
  });
  it('excludes known Google-origin files even if a legacy asset declares export permission', () => {
    expect(assetExportProblems({ status: 'approved', storePermission: 'granted', exportPermission: 'granted', licenceExpiresOn: null, attributionRequired: false, attributionText: null, sourceUrl: 'https://lh3.googleusercontent.com/preview' }).join(' ')).toMatch(/excluded/);
  });
  it('exports a complete manual kit without a Brand Kit or generated website and rechecks revocations', async () => {
    const store = new LocalStore(new MemoryStorage());
    const ctx: ServiceContext = { store, assets: new MemoryAssetStorage(), userId: 'demo-user', userLabel: 'Tester', settings: DEFAULT_SETTINGS };
    const business = (await store.listBusinesses())[0];
    const resource = await addResourceEntry(ctx, { ...entry, businessId: business.id });
    await expect(addResourceEntry(ctx, { ...entry, businessId: business.id })).rejects.toThrow(/already recorded/);
    await addResourceEntry(ctx, { ...entry, businessId: business.id, label: 'Private note', value: 'DO_NOT_EXPORT_THIS_NOTE', exportPermission: 'denied' });
    const empty = await downloadWebsiteResourceKit(ctx, business.id, null);
    expect(empty.manifest.resources).toHaveLength(1);
    expect(new TextDecoder().decode(empty.zip)).toContain('DEVELOPMENT-BRIEF.md');
    expect(new TextDecoder().decode(empty.zip)).not.toContain('DO_NOT_EXPORT_THIS_NOTE');
    const project = await openResourceVault(ctx, business);
    expect((await openResourceVault(ctx, business)).id).toBe(project.id);
    expect(await store.getStudioBrandKit(project.id)).toBeNull();
    const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
    const input = { fileName: 'authorized-logo.png', declaredType: 'image/png', bytes, kind: 'logo' as const, origin: 'client_supplied' as const, ownerName: 'Fictional sample owner', permissionEvidence: entry.evidence, sourceUrl: entry.sourceUrl, inspectPermission: 'granted' as const, storePermission: 'granted' as const, prototypePermission: 'denied' as const, exportPermission: 'granted' as const, publishPermission: 'denied' as const };
    const put = vi.spyOn(ctx.assets!, 'put');
    await expect(uploadStudioAsset(ctx, project, { ...input, sourceUrl: 'https://lh3.googleusercontent.com/preview' })).rejects.toThrow(/cannot be stored/);
    expect(put).not.toHaveBeenCalled();
    const asset = await uploadStudioAsset(ctx, project, input);
    const candidate = await downloadWebsiteResourceKit(ctx, business.id, project);
    expect(candidate.manifest.assets).toHaveLength(0);
    const approved = await approveStudioAsset(ctx, project, asset, 'Authorized original inspected');
    const copy = await uploadStudioAsset(ctx, project, { ...input, fileName: 'duplicate.png' });
    await approveStudioAsset(ctx, project, copy, 'Duplicate original inspected');
    const kit = await downloadWebsiteResourceKit(ctx, business.id, project);
    expect(kit.manifest.assets).toHaveLength(1);
    expect(kit.manifest.deduplicatedAssets).toBe(1);
    expect(kit.manifest.assets[0].permissionEvidence).toBe(entry.evidence);
    expect(kit.manifest.assets[0].permissions.publish).toBe('denied');
    await revokeStudioAsset(ctx, project, approved, 'Owner withdrew permission');
    await revokeStudioAsset(ctx, project, { ...copy, status: 'approved' }, 'Owner withdrew duplicate');
    await store.revokeResourceEntry(resource.id);
    const revoked = await downloadWebsiteResourceKit(ctx, business.id, project);
    expect(revoked.manifest.assets).toHaveLength(0);
    expect(revoked.manifest.resources).toHaveLength(0);
    await expect(store.revokeResourceEntry(resource.id)).rejects.toThrow();
  });
});

describe('Official transient Google resource provider', () => {
  it('searches once with only choice fields, a three-result cap and the prospect country', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'FAKE_SERVER_KEY');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [{ id: 'fictional_place_12345', displayName: { text: 'Fictional bakery' }, formattedAddress: 'Sample street' }] })));
    vi.stubGlobal('fetch', fetch);
    expect(await googleResourceSearch('Fictional bakery Berlin', 'DE')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('places.id,places.displayName,places.formattedAddress');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ textQuery: 'Fictional bakery Berlin', regionCode: 'DE', pageSize: 3 });
  });
  it.each([false, true])('reads a listing with website=%s using an explicit bounded field mask and required attribution', async (withSite) => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'FAKE_SERVER_KEY');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'fictional_place_12345', displayName: { text: 'Test Bakery' }, websiteUri: withSite ? 'https://sample.example.org' : undefined,
      regularOpeningHours: { weekdayDescriptions: ['Monday: 8–5'] }, googleMapsUri: 'https://maps.google.com/test',
      photos: Array.from({ length: 9 }, (_, i) => ({ name: `places/fictional_place_12345/photos/photo${i}`, authorAttributions: [{ displayName: 'Sample photographer', uri: 'https://maps.google.com/contrib/test' }] })), attributions: [{ provider: 'Provider credit', providerUri: 'https://example.org' }] })));
    vi.stubGlobal('fetch', fetch);
    const listing = await googleResourceDetails('fictional_place_12345');
    expect(listing.website).toBe(withSite ? 'https://sample.example.org/' : null);
    expect(simulatedResourceListing(withSite ? 'fictional_place_with_website' : 'fictional_place_no_website').website).toBe(withSite ? 'https://resource-bakery.example.org' : null);
    expect(listing.photos).toHaveLength(6);
    expect(listing.photos[0].authors[0].name).toBe('Sample photographer');
    expect(listing.attributions[0].provider).toBe('Provider credit');
    const [url, init] = fetch.mock.calls[0];
    expect(url).not.toContain('FAKE_SERVER_KEY');
    expect(init).toMatchObject({ cache: 'no-store', headers: { 'X-Goog-FieldMask': RESOURCE_DETAIL_FIELDS, 'X-Goog-Api-Key': 'FAKE_SERVER_KEY' } });
  });
  it('uses the official photo service without proxying bytes and rejects unrelated image URLs', async () => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'FAKE_SERVER_KEY');
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ photoUri: 'https://lh3.googleusercontent.com/sample' }))).mockResolvedValueOnce(new Response(JSON.stringify({ photoUri: 'https://evil.example.org/preview' })));
    vi.stubGlobal('fetch', fetch);
    expect(await googleResourcePhoto('places/fictional_place_12345/photos/sample')).toBe('https://lh3.googleusercontent.com/sample');
    expect(fetch.mock.calls[0][0]).toContain('maxWidthPx=800&skipHttpRedirect=true');
    await expect(googleResourcePhoto('places/fictional_place_12345/photos/sample')).rejects.toThrow(/unavailable/);
    await expect(googleResourcePhoto('https://evil.example.org')).rejects.toThrow(/Invalid photo/);
  });
  it('fails closed for live calls until explicitly configured, with no network request', async () => {
    vi.stubEnv('SIMULATE_EXTERNAL_TOOLS', 'false'); vi.stubEnv('RESOURCE_GOOGLE_ENABLED', 'false');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(resourceGoogleStatus().enabled).toBe(false);
    await expect(collectGoogleListing({ mode: 'demo', key: 'test' }, 'fictional_place_12345')).rejects.toThrow(/disabled/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
