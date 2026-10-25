import { afterAll, describe, expect, it } from 'vitest';
import { LIVE_BUDGET_USD, LIVE_ENABLED, reserve, reservedUsd } from './budget';

// One controlled check of the live Resource Collector path: a single Place Details request for the
// prospect named in LIVE_PLACES_PLACE_ID, plus one photo media request when LIVE_PLACES_PHOTO=1.
// Opt-in only (LIVE_INTEGRATION=1) and budget-capped like every other paid check. The Place ID comes
// from Google's free Place ID Finder, so the run costs one or two calls and never a search page.
//
// Evidence is counts and hosts only: Google listing content is display-only, so the name, address,
// phone, hours, provider credits and photo URLs are asserted and never printed or written down. The
// providers are called directly, so no Supabase row, vault file, resource entry or ZIP entry is
// touched - this proves the request path, not the workspace wiring.
//
// Not run while preparing it: no paid request was made and no live key was used.

/** Worst cases, at the published per-call list price rather than the app's lower ledger estimate. */
const DETAILS_WORST_CASE_USD = 0.025; // Enterprise + Atmosphere Place Details, $25 / 1,000
const PHOTO_WORST_CASE_USD = 0.01; // Place Photos, $7 / 1,000, rounded up

describe.skipIf(!LIVE_ENABLED)('live Resource Collector (paid, opt-in)', () => {
  /** Set by the details check, so the photo check costs one photo request and no second lookup. */
  let firstPhoto: string | null = null;

  afterAll(() => {
    console.log(`Live resource checks reserved $${reservedUsd()} of the $${LIVE_BUDGET_USD} budget (worst case; actual usage is lower).`);
  });

  it('Google Places: one Place Details view for a listing with no website', async ({ skip }) => {
    const placeId = process.env.LIVE_PLACES_PLACE_ID;
    if (!placeId || !process.env.GOOGLE_PLACES_API_KEY || !reserve(DETAILS_WORST_CASE_USD)) skip();
    const { RESOURCE_DETAIL_FIELDS, googleResourceDetails } = await import('@/lib/server/providers/google-places');
    // The exact field mask one click sends: identity fields, the contact and hours fields a
    // researcher checks, and the photos/attributions pair that carries Google's own credits.
    expect(RESOURCE_DETAIL_FIELDS).toBe(
      'id,displayName,formattedAddress,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions,websiteUri,googleMapsUri,googleMapsLinks,photos,attributions,businessStatus',
    );
    const listing = await googleResourceDetails(placeId!);
    expect(listing.id).toBe(placeId);
    expect(listing.simulated).toBe(false);
    // Google content must travel with a source link; without it the preview may not be shown.
    expect(listing.mapsUri).toMatch(/^https:\/\/([^/]+\.)?google\.[a-z.]+\//);
    // The point of this prospect: Google lists no website, so collection falls through to the
    // independent website and owner-supplied sources. A listing Google has since given a website
    // to fails here by design - pick another no-website business rather than loosening the check.
    expect(listing.website).toBeNull();
    expect(listing.photos.length).toBeLessThanOrEqual(6);
    for (const photo of listing.photos) {
      // Only this listing's own photos, at a known size, each with a named author credit.
      expect(photo.name.startsWith(`places/${placeId}/photos/`)).toBe(true);
      expect(photo.width).toBeGreaterThan(0);
      expect(photo.authors.length).toBeGreaterThan(0);
      expect(photo.authors.every((a) => a.name.trim().length > 0)).toBe(true);
    }
    firstPhoto = listing.photos[0]?.name ?? null;
    console.log(
      `Place Details ${placeId}: photos ${listing.photos.length}, author credits ${listing.photos.reduce((n, p) => n + p.authors.length, 0)}, hours ${listing.hours.length}, provider credits ${listing.attributions.length}, website listed false, phone listed ${Boolean(listing.phone)}`,
    );
  });

  it('Google Places: one photo media request returns a Google-hosted preview URL', async ({ skip }) => {
    if (process.env.LIVE_PLACES_PHOTO !== '1' || !firstPhoto || !reserve(PHOTO_WORST_CASE_USD)) skip();
    const { googleResourcePhoto } = await import('@/lib/server/providers/google-places');
    const uri = await googleResourcePhoto(firstPhoto!);
    const host = new URL(uri).hostname;
    // The URL is handed to the browser, which loads the bytes from Google's image service: nothing
    // is proxied, resized, cached, optimised or stored here, so no photo can reach a ZIP.
    expect(host).toMatch(/(^|\.)(googleusercontent\.com|ggpht\.com|gstatic\.com)$/);
    console.log(`Photo media: ${host} returned for one photo reference; no bytes fetched, resized or stored.`);
  });
});
