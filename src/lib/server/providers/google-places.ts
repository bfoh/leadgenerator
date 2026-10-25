import 'server-only';
import type { GoogleResourceListing } from '@/lib/domain/business-resources';

import { countryName } from '@/lib/domain/geo';
import { searchTermForCategory } from '@/lib/domain/categories';
import { includedTypeForCategory } from '@/lib/domain/places-filters';
import { serverEnv } from '../env';
import { ProviderError, searchArea, type DiscoveryPage, type DiscoveryProvider, type DiscoveryQuery, type DiscoveryResult } from './discovery';

// Google Places API (New). Results are displayed transiently; only the Place ID may be stored.
// https://developers.google.com/maps/documentation/places/web-service/policies

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');
const DETAIL_FIELDS = 'id,displayName,formattedAddress,websiteUri,googleMapsUri,businessStatus,primaryTypeDisplayName,nationalPhoneNumber';

// A separate explicit resource-viewer request, never added to ordinary discovery field masks.
export const RESOURCE_DETAIL_FIELDS = 'id,displayName,formattedAddress,nationalPhoneNumber,regularOpeningHours.weekdayDescriptions,websiteUri,googleMapsUri,googleMapsLinks,photos,attributions,businessStatus';
export async function googleResourceSearch(query: string, country: string) {
  const data = await call(SEARCH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': serverEnv.placesKey(), 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress' }, body: JSON.stringify({ textQuery: query, regionCode: country, languageCode: 'en', pageSize: 3 }) }, AbortSignal.timeout(10_000)) as { places?: PlaceJson[] };
  return (data.places ?? []).filter((p) => p.id).slice(0, 3).map((p) => ({ id: p.id!, name: p.displayName?.text ?? 'Unnamed place', address: p.formattedAddress ?? null }));
}
const httpLink = (raw?: string): string | null => {
  try { const u = new URL(raw?.startsWith('//') ? `https:${raw}` : raw ?? ''); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
};

export async function googleResourceDetails(id: string): Promise<GoogleResourceListing> {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) throw new ProviderError('Invalid Place ID.', false);
  const p = await call(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, { headers: { 'X-Goog-Api-Key': serverEnv.placesKey(), 'X-Goog-FieldMask': RESOURCE_DETAIL_FIELDS } }, AbortSignal.timeout(10_000)) as PlaceJson & {
    regularOpeningHours?: { weekdayDescriptions?: string[] }; googleMapsLinks?: { directionsUri?: string };
    attributions?: { provider?: string; providerUri?: string }[];
    photos?: { name?: string; widthPx?: number; heightPx?: number; googleMapsUri?: string; authorAttributions?: { displayName?: string; uri?: string; photoUri?: string }[] }[];
  };
  return { id: p.id ?? id, name: p.displayName?.text ?? 'Unnamed place', address: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? null, website: httpLink(p.websiteUri), mapsUri: httpLink(p.googleMapsUri), directionsUri: httpLink(p.googleMapsLinks?.directionsUri),
    status: p.businessStatus ?? null, hours: p.regularOpeningHours?.weekdayDescriptions ?? [],
    attributions: (p.attributions ?? []).map((a) => ({ provider: a.provider ?? '', uri: httpLink(a.providerUri) })),
    // Google requires the photo's author credit (avatar, name, profile link) and a direct link to the
    // source photo on Google Maps; `name` is a display-only reference and is never stored.
    photos: (p.photos ?? []).slice(0, 6).filter((a) => a.name?.startsWith(`places/${id}/photos/`)).map((a) => ({
      name: a.name!, width: a.widthPx ?? 0, height: a.heightPx ?? 0, googleMapsUri: httpLink(a.googleMapsUri),
      authors: (a.authorAttributions ?? []).map((v) => ({ name: v.displayName ?? 'Photo contributor', uri: httpLink(v.uri), photoUri: httpLink(v.photoUri) })),
    })), simulated: false };
}

/** Returns Google's URL; never proxies, caches, optimizes or stores the image bytes. */
export async function googleResourcePhoto(name: string): Promise<string> {
  if (!/^places\/[A-Za-z0-9_-]{10,300}\/photos\/[A-Za-z0-9_-]{1,1500}$/.test(name)) throw new ProviderError('Invalid photo reference. Refresh the listing.', false);
  const p = await call(`https://places.googleapis.com/v1/${name}/media?maxHeightPx=800&maxWidthPx=800&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': serverEnv.placesKey() } }, AbortSignal.timeout(10_000)) as { photoUri?: string };
  const uri = httpLink(p.photoUri);
  if (!uri || !/(^|\.)(googleusercontent\.com|ggpht\.com|gstatic\.com)$/.test(new URL(uri).hostname)) throw new ProviderError('The photo service returned an unavailable image. Refresh the listing.', true);
  return uri;
}

interface PlaceJson {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
  nationalPhoneNumber?: string;
}

function toResult(p: PlaceJson): DiscoveryResult {
  return {
    providerId: 'google_places',
    externalId: p.id ?? '',
    name: p.displayName?.text ?? 'Unnamed place',
    address: p.formattedAddress ?? null,
    websiteUri: p.websiteUri ?? null,
    mapsUri: p.googleMapsUri ?? null,
    businessStatus: p.businessStatus ?? null,
    primaryType: p.primaryTypeDisplayName?.text ?? null,
    phone: p.nationalPhoneNumber ?? null,
    isDemo: false,
  };
}

interface GoogleErrorBody {
  error?: { code?: number; status?: string; details?: { reason?: string }[] };
}

/**
 * Maps a Google error response to a safe, actionable message. Google's own message text is not
 * passed through (it can include project identifiers); the API key is never part of any message.
 */
export function placesErrorMessage(status: number, body: GoogleErrorBody | null): { message: string; retryable: boolean } {
  const reason = body?.error?.details?.find((d) => d.reason)?.reason ?? '';
  const code = body?.error?.status ?? '';
  if (reason === 'SERVICE_DISABLED' || reason === 'ACCESS_NOT_CONFIGURED') {
    return { message: 'Places API (New) is not enabled for the API key’s Google Cloud project. Enable “Places API (New)” in the Cloud console (APIs & Services → Library), wait a few minutes, then retry.', retryable: false };
  }
  if (reason === 'BILLING_DISABLED') return { message: 'Billing is not enabled on the API key’s Google Cloud project. Places API (New) requires an active billing account.', retryable: false };
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED') return { message: 'Google rejected the Places API key as invalid or expired. Check GOOGLE_PLACES_API_KEY in the server environment.', retryable: false };
  if (reason === 'API_KEY_HTTP_REFERRER_BLOCKED' || reason === 'API_KEY_IP_ADDRESS_BLOCKED' || reason === 'API_KEY_ANDROID_APP_BLOCKED' || reason === 'API_KEY_IOS_APP_BLOCKED') {
    return { message: 'The Places API key’s application restrictions block server requests. For this server-side key use “IP addresses” (or no application restriction) rather than website referrers.', retryable: false };
  }
  if (reason === 'API_KEY_SERVICE_BLOCKED') return { message: 'The Places API key is restricted to other APIs. Add “Places API (New)” to the key’s API restrictions.', retryable: false };
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return { message: 'Google Places quota or rate limit reached. Wait and retry, or raise the quota in the Cloud console.', retryable: true };
  if (status >= 500) return { message: `Google Places is temporarily unavailable (${status}). Try again shortly.`, retryable: true };
  if (status === 400 && code === 'INVALID_ARGUMENT') return { message: 'Google Places rejected the search parameters. Change the search and try again.', retryable: false };
  if (status === 401 || status === 403) return { message: `Google Places denied the request (${status}). Check that Places API (New) is enabled, billing is active and the key’s restrictions allow this server.`, retryable: false };
  return { message: `Google Places rejected the request (${status}).`, retryable: false };
}

async function call(url: string, init: RequestInit, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal, cache: 'no-store' });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ProviderError(timedOut ? 'Google Places did not respond within 10 seconds. Try again.' : 'Could not reach Google Places. Check the server’s internet connection.', true);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as GoogleErrorBody | null;
    const { message, retryable } = placesErrorMessage(res.status, body);
    throw new ProviderError(message, retryable);
  }
  return res.json();
}

export function placesTextQuery(q: DiscoveryQuery) {
  const what = q.terms?.trim() || searchTermForCategory(q.category);
  const where = [searchArea(q), countryName(q.country)].filter(Boolean).join(', ');
  return `${what} in ${where}`;
}

/**
 * The reviewed Table A type to narrow a search, or null when there is nothing honest to send.
 * Custom terms always win: if the researcher typed a phrase, a strict type filter could hide the
 * very businesses they are looking for. Only pairs audited in `places-filters.ts` are sent — a
 * narrower Google type would otherwise silently exclude businesses the category plainly covers.
 * The text query is sent either way, so an unfiltered category still searches normally.
 */
export function placesIncludedType(q: Pick<DiscoveryQuery, 'category' | 'terms'>): string | null {
  if (q.terms?.trim()) return null;
  return includedTypeForCategory(q.category);
}

export const googlePlacesProvider: DiscoveryProvider = {
  id: 'google_places',
  name: 'Google Places API (New)',
  isConfigured: () => Boolean(serverEnv.placesKey()),
  getCapabilities: () => ({ search: true, details: true, websiteField: true, phoneInDetails: true, emailField: false, maxPageSize: 20, isDemo: false }),
  getAttributionRequirements: () => ({
    text: 'Results from Google Maps',
    url: 'https://www.google.com/maps',
    notes: 'Show Google Maps attribution with results. Link to the Google Maps listing for full details.',
  }),
  getRetentionRules: () => ({
    storableFields: ['externalId'],
    displayOnlyFields: ['name', 'address', 'websiteUri', 'mapsUri', 'businessStatus', 'primaryType', 'phone'],
    cacheSeconds: 0,
    policyUrl: 'https://developers.google.com/maps/documentation/places/web-service/policies',
    notes:
      'Only the Place ID may be stored. Names, addresses, phone numbers and website fields are for on-screen display and must be confirmed from an independent source before entering them in the CRM. A missing website field is not evidence that no website exists.',
  }),
  estimatedCostUsd: (op) => (op === 'search' ? serverEnv.cost.placesSearch() : serverEnv.cost.placesDetails()),

  async search(q, signal): Promise<DiscoveryPage> {
    const includedType = placesIncludedType(q);
    const data = (await call(
      SEARCH_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': serverEnv.placesKey(), 'X-Goog-FieldMask': SEARCH_FIELDS },
        body: JSON.stringify({
          textQuery: placesTextQuery(q),
          pageSize: Math.min(20, Math.max(1, q.limit)),
          regionCode: q.country,
          languageCode: 'en',
          ...(includedType ? { includedType } : {}),
          ...(q.pageToken ? { pageToken: q.pageToken } : {}),
        }),
      },
      signal,
    )) as { places?: PlaceJson[]; nextPageToken?: string };
    return { results: (data.places ?? []).map(toResult).filter((r) => r.externalId), nextPageToken: data.nextPageToken ?? null };
  },

  async getDetails(externalId, signal) {
    if (!/^[A-Za-z0-9_-]{10,300}$/.test(externalId)) throw new ProviderError('Invalid place reference.', false);
    const data = (await call(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(externalId)}`,
      { headers: { 'X-Goog-Api-Key': serverEnv.placesKey(), 'X-Goog-FieldMask': DETAIL_FIELDS } },
      signal,
    )) as PlaceJson;
    return data?.id ? toResult(data) : null;
  },
};
