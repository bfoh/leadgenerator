// The real read: with a workspace behind it, the route asks the database where the file lives and
// ignores the addresses in the request. These tests prove a caller cannot point the downloader at a
// host of their choosing, cannot read a candidate twice, and cannot follow a redirect off the
// business's own site. Providers and storage are fakes; no socket is opened.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualCandidate } from '@/lib/domain/visual-acquisition';
import type { Business } from '@/lib/domain/types';
import type { StudioProject } from '@/lib/domain/studio';

const SITE = 'https://resource-hotel.example.org';
const CANDIDATE_ID = '00000000-0000-4000-8000-00000000c001';
const BUSINESS_ID = '00000000-0000-4000-8000-00000000e001';
const PROJECT_ID = '00000000-0000-4000-8000-00000000d001';
const ORG_ID = '00000000-0000-4000-8000-00000000f001';

const WORLD = vi.hoisted(() => ({
  candidate: null as VisualCandidate | null,
  business: null as Business | null,
  project: null as StudioProject | null,
  fetched: [] as string[],
  download: null as { bytes: Uint8Array; mimeType: string; fileName: string; finalUrl: string } | null,
}));

vi.mock('@/lib/server/context', () => ({
  requireContext: async () => ({ mode: 'cloud', key: 'user:test', userId: 'user-1', orgId: ORG_ID, role: 'owner', supabase: {} }),
}));

vi.mock('@/lib/data/supabase-store', () => ({
  SupabaseStore: class {
    async getVisualCandidate() {
      return WORLD.candidate;
    }
    async getBusiness() {
      return WORLD.business;
    }
    async getStudioProject() {
      return WORLD.project;
    }
  },
}));

vi.mock('@/lib/server/usage', () => ({ enforceQuota: async () => undefined, recordUsage: async () => undefined }));

vi.mock('@/lib/server/safe-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/safe-fetch')>();
  return {
    ...actual,
    downloadResourceOriginal: async (url: string) => {
      WORLD.fetched.push(url);
      if (!WORLD.download) throw new Error('No download was staged for this test.');
      return WORLD.download;
    },
  };
});

import { NextRequest } from 'next/server';
import { GET as preview } from '@/app/api/resources/preview/route';
import { POST as original } from '@/app/api/resources/candidates/original/route';

beforeAll(() => {
  delete process.env.SIMULATE_EXTERNAL_TOOLS;
});

beforeEach(() => {
  WORLD.fetched = [];
  WORLD.download = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png', fileName: 'harbour-hotel-logo.png', finalUrl: `${SITE}/media/harbour-hotel-logo.png` };
  WORLD.candidate = candidate();
  WORLD.business = { id: BUSINESS_ID, officialWebsite: SITE } as unknown as Business;
  WORLD.project = { id: PROJECT_ID, businessId: BUSINESS_ID } as unknown as StudioProject;
});

function candidate(overrides: Partial<VisualCandidate> = {}): VisualCandidate {
  return {
    id: CANDIDATE_ID,
    organizationId: ORG_ID,
    businessId: BUSINESS_ID,
    projectId: PROJECT_ID,
    pageUrl: `${SITE}/`,
    imageUrl: `${SITE}/media/harbour-hotel-logo.png`,
    sourceKind: 'official_site',
    imageType: 'logo',
    label: 'Harbour Hotel logo',
    attribution: null,
    relevance: 'Linked from the verified homepage. Publishing it is not permission to reuse it.',
    rightsBasis: 'not_established',
    rightsEvidence: null,
    status: 'reference_only',
    assetId: null,
    importedVia: null,
    checksumSha256: null,
    requestedAt: null,
    requestNote: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdBy: null,
    createdAt: '2026-10-31T00:00:00.000Z',
    updatedAt: '2026-10-31T00:00:00.000Z',
    ...overrides,
  };
}


const post = (overrides: Record<string, unknown> = {}) =>
  original(new NextRequest('https://app.example.org/api/resources/candidates/original', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      candidateId: CANDIDATE_ID,
      sourceUrl: 'https://attacker.example/steal.png',
      pageUrl: 'https://attacker.example/',
      businessWebsite: 'https://attacker.example',
      permissionEvidence: 'The owner confirmed by email on 31 October 2026 that the site and its images are theirs.',
      confirmed: true,
      ...overrides,
    }),
  }));

const get = (candidateId = CANDIDATE_ID) =>
  preview(new NextRequest(`https://app.example.org/api/resources/preview?candidateId=${candidateId}&url=${encodeURIComponent('https://attacker.example/steal.png')}&website=${encodeURIComponent('https://attacker.example')}`));

describe('the stored candidate, not the request, decides what is read', () => {
  it('ignores the addresses in the body and fetches the candidate’s own file', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(WORLD.fetched).toEqual([`${SITE}/media/harbour-hotel-logo.png`]);
    const payload = (await response.json()) as { simulated: boolean; mimeType: string };
    expect(payload.simulated).toBe(false);
    expect(payload.mimeType).toBe('image/png');
  });

  it('ignores the query string for a preview too', async () => {
    expect((await get()).status).toBe(200);
    expect(WORLD.fetched).toEqual([`${SITE}/media/harbour-hotel-logo.png`]);
  });

  it('refuses a candidate whose file is served by a third party, and one on Google or social', async () => {
    WORLD.candidate = candidate({ imageUrl: 'https://cdn.fictional-photographer.example.net/harbour/pool.jpg', sourceKind: 'third_party_reference' });
    expect((await post()).status).toBe(400);
    expect((await get()).status).toBe(400);
    WORLD.candidate = candidate({ imageUrl: 'https://lh3.googleusercontent.com/places/photo', sourceKind: 'official_site' });
    expect((await post()).status).toBe(400);
    expect(WORLD.fetched).toEqual([]);
  });

  it('refuses a candidate whose page is not the recorded website', async () => {
    WORLD.candidate = candidate({ pageUrl: 'https://elsewhere.example/' });
    expect((await post()).status).toBe(400);
    expect((await get()).status).toBe(400);
    expect(WORLD.fetched).toEqual([]);
  });

  it('refuses to read a candidate that has already been decided', async () => {
    WORLD.candidate = candidate({ status: 'imported', assetId: '00000000-0000-4000-8000-00000000a001' });
    expect((await post()).status).toBe(409);
    expect((await get()).status).toBe(409);
    WORLD.candidate = candidate({ status: 'rejected' });
    expect((await post()).status).toBe(409);
    expect(WORLD.fetched).toEqual([]);
  });

  it('refuses a candidate or prospect outside this workspace, or a vault for another prospect', async () => {
    WORLD.candidate = null;
    expect((await post()).status).toBe(404);
    WORLD.candidate = candidate();
    WORLD.business = null;
    expect((await post()).status).toBe(404);
    WORLD.business = { id: BUSINESS_ID, officialWebsite: SITE } as unknown as Business;
    WORLD.project = { id: PROJECT_ID, businessId: '00000000-0000-4000-8000-0000000000ff' } as unknown as StudioProject;
    expect((await post()).status).toBe(404);
    WORLD.project = null;
    expect((await post()).status).toBe(404);
    expect(WORLD.fetched).toEqual([]);
  });

  it('refuses a file that redirects away from the business’s own website', async () => {
    WORLD.download = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', fileName: 'logo.png', finalUrl: 'https://attacker.example/steal.png' };
    expect((await post()).status).toBe(400);
    expect((await get()).status).toBe(400);
  });

  it('refuses an unrecorded website on the prospect', async () => {
    WORLD.business = { id: BUSINESS_ID, officialWebsite: null } as unknown as Business;
    expect((await post()).status).toBe(400);
    expect(WORLD.fetched).toEqual([]);
  });
});
