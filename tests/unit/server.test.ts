import { describe, expect, it } from 'vitest';
import { candidateDomains } from '@/lib/server/domains';
import { guardedLookup, inspectHtml, isPrivateAddress, parsePublicUrl, checkWebsite } from '@/lib/server/safe-fetch';
import { rateLimit, resetRateLimits } from '@/lib/server/rate-limit';
import { placesTextQuery } from '@/lib/server/providers/google-places';
import { demoProvider } from '@/lib/server/providers/demo-provider';
import { googlePlacesProvider } from '@/lib/server/providers/google-places';

describe('SSRF guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1'])(
    'blocks %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '41.215.160.1', '2001:4860:4860::8888'])('allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it('rejects unsafe URLs before any network access', () => {
    expect(() => parsePublicUrl('ftp://example.com')).toThrow(/http/);
    expect(() => parsePublicUrl('http://localhost/admin')).toThrow();
    expect(() => parsePublicUrl('http://169.254.169.254/latest/meta-data')).toThrow(/Private/);
    expect(() => parsePublicUrl('https://user:pw@example.com')).toThrow(/credentials/);
    expect(() => parsePublicUrl('https://example.com:8080')).toThrow(/ports/);
    expect(() => parsePublicUrl('http://intranet')).toThrow();
    expect(parsePublicUrl('example.com.gh').href).toBe('https://example.com.gh/');
  });

  it('refuses hostnames that resolve to private addresses at connect time', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => guardedLookup('localhost', { all: true }, (e) => resolve(e)));
    expect(err?.code).toBe('EBLOCKED');
  });

  it('reports blocked targets as a failed check instead of fetching them', async () => {
    await expect(checkWebsite('http://127.0.0.1')).rejects.toThrow(/Private/);
  });

  it('extracts title, viewport and generator from HTML', () => {
    const meta = inspectHtml('<html><head><title> Asante &amp; Sons </title><meta name="viewport" content="width=device-width"><meta name="generator" content="WordPress 6.5"></head></html>');
    expect(meta).toEqual({ title: 'Asante & Sons', hasViewport: true, generator: 'WordPress 6.5' });
  });
});

describe('domain candidates', () => {
  it('derives a bounded list of plausible domains', () => {
    const list = candidateDomains('The KingsMen Ghana Ltd');
    expect(list).toContain('kingsmen.com');
    expect(list).toContain('kingsmen.com.gh');
    expect(list.length).toBeLessThanOrEqual(8);
    expect(candidateDomains('!!!')).toEqual([]);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit per window', () => {
    resetRateLimits();
    const t = 1_000_000;
    expect(rateLimit('k', 2, 1000, t).allowed).toBe(true);
    expect(rateLimit('k', 2, 1000, t).allowed).toBe(true);
    expect(rateLimit('k', 2, 1000, t).allowed).toBe(false);
    expect(rateLimit('k', 2, 1000, t + 1001).allowed).toBe(true);
  });
});

describe('discovery providers', () => {
  it('builds Places text queries from structured input', () => {
    expect(placesTextQuery({ country: 'GH', region: null, city: 'Kumasi', neighborhood: 'Adum', category: 'Furniture showroom', terms: null, limit: 10, pageToken: null })).toBe(
      'furniture store in Adum, Kumasi, Ghana',
    );
    // A town keeps the query it always had; the region is added only when no town is given.
    const q = { country: 'GH', region: 'Ashanti', city: 'Kumasi', neighborhood: null, category: 'Pharmacy', terms: null, limit: 20, pageToken: null };
    expect(placesTextQuery(q)).toBe('pharmacy in Kumasi, Ghana');
    expect(placesTextQuery({ ...q, city: null })).toBe('pharmacy in Ashanti Region, Ghana');
    expect(placesTextQuery({ ...q, city: null, region: 'Greater Accra', category: 'Herbal clinic' })).toBe('herbal clinic in Greater Accra Region, Ghana');
    expect(placesTextQuery({ ...q, city: null, region: 'North East Region', category: 'Clinic' })).toBe('medical clinic in North East Region, Ghana');
  });

  it('declares that only Place IDs may be stored', () => {
    expect(googlePlacesProvider.getRetentionRules().storableFields).toEqual(['externalId']);
    expect(googlePlacesProvider.getCapabilities().emailField).toBe(false);
  });

  it('demo provider returns clearly fictional, paginated results', async () => {
    const page = await demoProvider.search(
      { country: 'GH', region: null, city: 'Accra', neighborhood: null, category: 'Bakery', terms: null, limit: 5, pageToken: null },
      AbortSignal.timeout(1000),
    );
    expect(page.results).toHaveLength(5);
    expect(page.results.every((r) => r.isDemo && r.name.includes('fictional'))).toBe(true);
    expect(page.nextPageToken).toBe('5');

    const region = await demoProvider.search(
      { country: 'GH', region: 'Volta', city: null, neighborhood: null, category: 'Hospital', terms: null, limit: 3, pageToken: null },
      AbortSignal.timeout(1000),
    );
    expect(region.results.map((r) => r.address)).toEqual(Array(3).fill('Fictional address, Volta Region'));
  });
});
