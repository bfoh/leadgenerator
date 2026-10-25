import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/server/providers/discovery';
import {
  BRAVE_COUNTRY_CODES,
  braveCountryCode,
  braveErrorMessage,
  braveSearchProvider,
  buildBraveSearchUrl,
  isBraveCountryCode,
  scrubBraveText,
} from '@/lib/server/providers/web-search';

// A fake key: the tests assert it travels only as a header and never reaches a message or a log.
const FAKE_KEY = 'BSA-test-not-a-real-token-000000000';

/**
 * The exact query the approved Ghana run built (`buildSocialQueries`): the place words are what
 * carries Ghana, because Brave has no Ghana search market to target.
 */
const GHANA_QUERY = 'site:instagram.com "fashion designer" Accra Greater Accra Ghana';

/** Brave's documented `country` enum, as published for /res/v1/web/search. Ghana is not in it. */
const DOCUMENTED = ['AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'GR', 'HK', 'IN', 'ID', 'IT',
  'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US', 'ALL'];

describe('Brave country targeting', () => {
  it('documents the same enum Brave publishes, and Ghana is absent from it', () => {
    expect([...BRAVE_COUNTRY_CODES]).toEqual(DOCUMENTED);
    expect(isBraveCountryCode('GH')).toBe(false);
    expect(isBraveCountryCode('ALL')).toBe(true);
  });

  it('sends ALL for a Ghanaian search and keeps the place words in the query', () => {
    const url = buildBraveSearchUrl(GHANA_QUERY, 'GH');
    expect(url.searchParams.get('country')).toBe('ALL');
    expect(url.searchParams.get('q')).toBe(GHANA_QUERY);
    expect(url.searchParams.get('q')).toContain('Accra');
    expect(url.searchParams.get('q')).toContain('Ghana');
    expect(url.toString()).not.toContain('GH');
  });

  it('never sends a country code outside the documented list', () => {
    for (const hint of ['GH', 'gh', ' GH ', 'NG', 'KE', 'UG', 'CI', 'SN', 'TZ', 'ET', 'XK', 'ZZ', 'ghana', '', null, undefined]) {
      const sent = buildBraveSearchUrl('q', hint).searchParams.get('country');
      expect(DOCUMENTED).toContain(sent);
      expect(sent).not.toBe('GH');
      expect(braveCountryCode(hint)).toBe('ALL');
    }
  });

  it('passes supported hints through and defaults to ALL when none is given', () => {
    expect(braveCountryCode(' us ')).toBe('US');
    expect(braveCountryCode('gb')).toBe('GB');
    expect(braveCountryCode(undefined)).toBe('ALL');
    expect(buildBraveSearchUrl('q', 'GB').searchParams.get('country')).toBe('GB');
    // Omitting the parameter would let Brave default to US, which is why ALL is sent explicitly.
    expect(buildBraveSearchUrl('q').searchParams.get('country')).toBe('ALL');
  });

  it('caps the query at Brave’s 600 character limit', () => {
    expect(buildBraveSearchUrl('x'.repeat(700)).searchParams.get('q')).toHaveLength(600);
  });
});

describe('Brave request path', () => {
  const fetchMock = vi.fn();
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', FAKE_KEY);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a Ghanaian search with country=ALL and the key only in a header', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ web: { results: [{ title: 'A <b>studio</b>', url: 'https://www.instagram.com/example/', description: '&amp; more' }, { title: 'no url' }] } }), { status: 200 }),
    );
    const hits = await braveSearchProvider.search(GHANA_QUERY, AbortSignal.timeout(2000), { country: 'GH' });
    const [request, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const sent = new URL(String(request));
    expect(sent.origin + sent.pathname).toBe('https://api.search.brave.com/res/v1/web/search');
    expect(sent.searchParams.get('country')).toBe('ALL');
    expect(sent.searchParams.get('q')).toBe(GHANA_QUERY);
    expect(String(request)).not.toContain(FAKE_KEY);
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe(FAKE_KEY);
    expect(hits).toEqual([{ title: 'A studio', url: 'https://www.instagram.com/example/', description: 'more' }]);
  });

  it('turns a 422 into the rejected parameter, and logs it without the key', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ type: 'ErrorResponse', error: { id: 'x', status: 422, code: 'VALIDATION', detail: `bad request for ${FAKE_KEY}`, meta: { param: 'country' } } }),
        { status: 422 },
      ),
    );
    const error = (await braveSearchProvider.search('q', AbortSignal.timeout(2000)).catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('country');
    expect(error.message).not.toContain(FAKE_KEY);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('web_search_failed');
    expect(logged).toContain('VALIDATION');
    expect(logged).not.toContain(FAKE_KEY);
  });
});

describe('Brave error reporting', () => {
  // The scrubber redacts the configured key by value, so the test must configure one, as the
  // server does. Without a key there is nothing to leak — but there would also be nothing to hide.
  beforeEach(() => vi.stubEnv('BRAVE_SEARCH_API_KEY', FAKE_KEY));
  afterEach(() => vi.unstubAllEnvs());

  it('names the error code and the rejected parameter', () => {
    const summary = braveErrorMessage(422, {
      type: 'ErrorResponse',
      error: { id: 'abc', status: 422, code: 'VALIDATION', detail: 'Unable to validate request parameter(s)', meta: { param: 'country' } },
    });
    expect(summary).toMatchObject({ code: 'VALIDATION', param: 'country', retryable: false });
    expect(summary.message).toContain('422');
    expect(summary.message).toContain('country');
  });

  it('keeps the key out of the message and the summary', () => {
    const summary = braveErrorMessage(401, { error: { code: 'SUBSCRIPTION_TOKEN_INVALID', detail: `token ${FAKE_KEY} rejected` } });
    expect(summary.detail).toContain('[redacted]');
    expect(summary.message).not.toContain(FAKE_KEY);
    expect(JSON.stringify(summary)).not.toContain(FAKE_KEY);
  });

  it('scrubs header lines, URL query strings and newlines', () => {
    const scrubbed = scrubBraveText(`X-Subscription-Token: ${FAKE_KEY}\nAuthorization: Bearer abc\nsee https://api.search.brave.com/res/v1/web/search?q=secret&token=${FAKE_KEY}`, FAKE_KEY);
    expect(scrubbed).not.toContain(FAKE_KEY);
    expect(scrubbed).not.toContain('Bearer abc');
    expect(scrubbed).not.toContain('?q=secret');
    expect(scrubbed).not.toContain('\n');
    expect(scrubbed).toContain('https://api.search.brave.com/res/v1/web/search');
  });

  it('maps rate limits and outages to retryable, rejections to permanent', () => {
    expect(braveErrorMessage(429, null).retryable).toBe(true);
    expect(braveErrorMessage(503, null).retryable).toBe(true);
    expect(braveErrorMessage(422, null).retryable).toBe(false);
    expect(braveErrorMessage(400, { error: { code: 'BAD_REQUEST', meta: { param: 'q' } } }).message).toContain('q');
  });
});
