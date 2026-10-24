import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyListedLink } from '@/lib/domain/links';
import { ProviderError } from '@/lib/server/providers/discovery';
import { googlePlacesProvider, placesErrorMessage } from '@/lib/server/providers/google-places';

// A fake key: the tests assert it is sent only as a header and never appears in errors.
const FAKE_KEY = 'AIzaTEST-not-a-real-key-000000000000000';
const query = { country: 'GH', region: 'Ashanti', city: 'Kumasi', neighborhood: null, category: 'Furniture showroom', terms: null, limit: 20, pageToken: null };

function googleError(status: number, reason: string, code = 'PERMISSION_DENIED') {
  return new Response(JSON.stringify({ error: { code: status, status: code, message: `details mention ${FAKE_KEY}`, details: [{ reason }] } }), { status });
}

describe('Google Places API (New) provider', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('GOOGLE_PLACES_API_KEY', FAKE_KEY);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('calls searchText with the key in a header, a minimal field mask and Ghana region', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            { id: 'ChIJ_with_site_123', displayName: { text: 'Orca Deco Kumasi' }, formattedAddress: 'Off Atonsu Road, Kumasi', websiteUri: 'http://www.orcadeco.com.gh/', businessStatus: 'OPERATIONAL' },
            { id: 'ChIJ_no_site_4567', displayName: { text: 'Home Style Furniture' }, formattedAddress: 'Kumasi', businessStatus: 'OPERATIONAL' },
          ],
          nextPageToken: 'next-1',
        }),
        { status: 200 },
      ),
    );
    const page = await googlePlacesProvider.search(query, AbortSignal.timeout(1000));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(url).not.toContain(FAKE_KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe(FAKE_KEY);
    expect(headers['X-Goog-FieldMask'].split(',')).toEqual([
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.websiteUri',
      'places.googleMapsUri',
      'places.businessStatus',
      'places.primaryTypeDisplayName',
      'nextPageToken',
    ]);
    expect(JSON.parse(String(init.body))).toMatchObject({ textQuery: 'furniture store in Kumasi, Ghana', pageSize: 20, regionCode: 'GH' });
    expect(page.nextPageToken).toBe('next-1');
    expect(page.results.map((r) => r.websiteUri)).toEqual(['http://www.orcadeco.com.gh/', null]);
    expect(page.results.every((r) => !r.isDemo && r.providerId === 'google_places')).toBe(true);
  });

  it('forwards the page token for the next page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ places: [] }), { status: 200 }));
    await googlePlacesProvider.search({ ...query, pageToken: 'next-1' }, AbortSignal.timeout(1000));
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).pageToken).toBe('next-1');
  });

  it.each([
    [403, 'SERVICE_DISABLED', /Places API \(New\) is not enabled/],
    [403, 'BILLING_DISABLED', /Billing is not enabled/],
    [400, 'API_KEY_INVALID', /invalid or expired/],
    [403, 'API_KEY_HTTP_REFERRER_BLOCKED', /application restrictions/],
    [403, 'API_KEY_SERVICE_BLOCKED', /restricted to other APIs/],
  ])('explains HTTP %i %s without echoing Google’s message or the key', async (status, reason, expected) => {
    fetchMock.mockResolvedValue(googleError(status, reason));
    const error = await googlePlacesProvider.search(query, AbortSignal.timeout(1000)).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toMatch(expected);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.retryable).toBe(false);
  });

  it('marks rate limits and outages as retryable', () => {
    expect(placesErrorMessage(429, { error: { status: 'RESOURCE_EXHAUSTED' } }).retryable).toBe(true);
    expect(placesErrorMessage(503, null).retryable).toBe(true);
  });

  it('reports network failures without details', async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for key=${FAKE_KEY}`));
    const error = await googlePlacesProvider.search(query, AbortSignal.timeout(1000)).catch((e) => e);
    expect(error.message).toMatch(/Could not reach Google Places/);
    expect(error.message).not.toContain(FAKE_KEY);
    expect(error.retryable).toBe(true);
  });

  it('narrows a mapped category with a verified Table A type, and never with a guessed one', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ places: [] }), { status: 200 })));
    // Furniture showroom is mapped to furniture_store, a Table A type copied from Google's list.
    await googlePlacesProvider.search(query, AbortSignal.timeout(1000));
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ includedType: 'furniture_store' });

    // Custom terms win: a strict type filter could hide exactly what the researcher asked for.
    await googlePlacesProvider.search({ ...query, terms: 'office furniture' }, AbortSignal.timeout(1000));
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).not.toHaveProperty('includedType');

    // A category with no verified mapping still searches by phrase.
    await googlePlacesProvider.search({ ...query, category: 'Mammy wagon transport' }, AbortSignal.timeout(1000));
    const body = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    expect(body).not.toHaveProperty('includedType');
    expect(body.textQuery).toBe('mammy wagon transport in Kumasi, Ghana');
  });

  it('rejects malformed place references before calling Google', async () => {
    await expect(googlePlacesProvider.getDetails('../../etc', AbortSignal.timeout(1000))).rejects.toThrow(/Invalid place reference/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches by phrase when a type filter would hide the businesses the category covers', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ places: [] }), { status: 200 })));
    const textOnly = ['Chop bar', 'Waakye joint', 'Market trader', 'Street food vendor', 'Clinic', 'Fashion boutique'];
    for (const category of textOnly) {
      fetchMock.mockClear();
      await googlePlacesProvider.search({ ...query, category }, AbortSignal.timeout(1000));
      const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      expect(body, category).not.toHaveProperty('includedType');
      expect(body.textQuery, category).toContain('in Kumasi, Ghana');
    }
    // A whole-group search uses the group's phrase and never a category type.
    fetchMock.mockClear();
    await googlePlacesProvider.search({ ...query, category: 'Food, Drink & Catering' }, AbortSignal.timeout(1000));
    const groupBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(groupBody).not.toHaveProperty('includedType');
    expect(groupBody.textQuery).toBe('food and drink business in Kumasi, Ghana');
  });
});

describe('listed website classification', () => {
  it.each([
    [null, 'none'],
    ['http://www.orcadeco.com.gh/', 'website'],
    ['https://www.instagram.com/spendloveboutique_1?igsh=abc', 'social'],
    ['https://m.facebook.com/somebusiness', 'social'],
    ['https://wa.me/233200000000', 'social'],
    ['https://linktr.ee/shop', 'social'],
    ['https://instagram.com.example.org', 'website'],
  ])('%s → %s', (url, kind) => expect(classifyListedLink(url)).toBe(kind));
});
