// What the two acquisition routes will and will not read. A simulated run has no database, so these
// exercise the boundary checks that still apply: Google and social hosts, third-party files, a page
// that is not the recorded site, and a request that names no candidate at all. The real path, where
// the address comes from the stored candidate instead of the request, is covered by
// visual-acquisition-source.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as preview } from '@/app/api/resources/preview/route';
import { POST as original } from '@/app/api/resources/candidates/original/route';

const SITE = 'https://resource-hotel.example.org';
const CANDIDATE = '00000000-0000-4000-8000-00000000c001';
const PREVIOUS = { DEMO_SERVER_TOOLS: process.env.DEMO_SERVER_TOOLS, SIMULATE_EXTERNAL_TOOLS: process.env.SIMULATE_EXTERNAL_TOOLS };

beforeAll(() => {
  process.env.DEMO_SERVER_TOOLS = 'true';
  process.env.SIMULATE_EXTERNAL_TOOLS = 'true';
});

afterAll(() => {
  for (const [key, value] of Object.entries(PREVIOUS)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const previewRequest = (query: string, ip = '203.0.113.10') =>
  new NextRequest(`https://app.example.org/api/resources/preview?${query}`, { headers: { 'x-forwarded-for': ip } });

const originalRequest = (body: Record<string, unknown>, ip = '203.0.113.11') =>
  new NextRequest('https://app.example.org/api/resources/candidates/original', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });

const body = (overrides: Record<string, unknown> = {}) => ({
  candidateId: CANDIDATE,
  sourceUrl: `${SITE}/media/harbour-hotel-logo.png`,
  pageUrl: SITE,
  businessWebsite: SITE,
  permissionEvidence: 'The owner confirmed by email on 31 October 2026 that the site and its images are theirs.',
  confirmed: true,
  ...overrides,
});

describe('preview route boundary', () => {
  it.each([
    'https://lh3.googleusercontent.com/places/photo',
    'https://scontent.cdninstagram.com/photo.jpg',
    'https://cdn.example.net/photo.jpg',
    'javascript:alert(1)',
  ])('refuses %s', async (url) => {
    const response = await preview(previewRequest(`candidateId=${CANDIDATE}&url=${encodeURIComponent(url)}&website=${encodeURIComponent(SITE)}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('needs a recorded candidate and a recorded website', async () => {
    expect((await preview(previewRequest(`url=${encodeURIComponent(`${SITE}/logo.png`)}&website=${encodeURIComponent(SITE)}`))).status).toBe(400);
    expect((await preview(previewRequest(`candidateId=not-a-uuid&url=${encodeURIComponent(`${SITE}/logo.png`)}&website=${encodeURIComponent(SITE)}`))).status).toBe(400);
    expect((await preview(previewRequest(`candidateId=${CANDIDATE}&url=${encodeURIComponent(`${SITE}/logo.png`)}`))).status).toBe(400);
  });

  it('returns a transient placeholder for the business’s own site, with no sniffing or reuse', async () => {
    const response = await preview(previewRequest(`candidateId=${CANDIDATE}&url=${encodeURIComponent(`${SITE}/media/harbour-hotel-logo.png`)}&website=${encodeURIComponent(SITE)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

describe('original route boundary', () => {
  it('refuses a third-party file on the page it claims to have read', async () => {
    const response = await original(originalRequest(body({ sourceUrl: 'https://cdn.example.net/photo.jpg' }), '203.0.113.12'));
    expect(response.status).toBe(400);
  });

  it('refuses Google and social hosts, and a page that is not the recorded site', async () => {
    for (const url of ['https://lh3.googleusercontent.com/places/photo', 'https://scontent.cdninstagram.com/photo.jpg', 'https://x.com/photo.jpg']) {
      expect((await original(originalRequest(body({ sourceUrl: url }), '203.0.113.13'))).status).toBe(400);
    }
    expect((await original(originalRequest(body({ pageUrl: 'https://elsewhere.example/' }), '203.0.113.14'))).status).toBe(400);
  });

  it('needs a candidate id and an explicit rights statement', async () => {
    const noCandidate = { ...body(), candidateId: undefined };
    expect((await original(originalRequest(noCandidate, '203.0.113.15'))).status).toBe(400);
    expect((await original(originalRequest(body({ permissionEvidence: 'too short' }), '203.0.113.16'))).status).toBe(400);
    expect((await original(originalRequest(body({ confirmed: false }), '203.0.113.17'))).status).toBe(400);
  });

  it('returns the placeholder bytes for the business’s own site', async () => {
    const response = await original(originalRequest(body(), '203.0.113.18'));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { base64: string; mimeType: string; simulated: boolean };
    expect(payload.simulated).toBe(true);
    expect(payload.mimeType).toBe('image/png');
    expect(Buffer.from(payload.base64, 'base64').subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
