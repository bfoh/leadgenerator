import 'server-only';

import { countryName } from '@/lib/domain/geo';
import { placesTypeForCategory, searchTermForCategory } from '@/lib/domain/categories';
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
 * The validated Table A type to narrow a search, or null when there is nothing honest to send.
 * Custom terms always win: if the researcher typed a phrase, a strict type filter could hide the
 * very businesses they are looking for. The text query is sent either way, so an unmapped
 * category still searches normally.
 */
export function placesIncludedType(q: Pick<DiscoveryQuery, 'category' | 'terms'>): string | null {
  if (q.terms?.trim()) return null;
  return placesTypeForCategory(q.category);
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
