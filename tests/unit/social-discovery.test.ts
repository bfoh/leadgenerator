import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assessSocialCandidate,
  buildSocialQueries,
  cleanSocialDisplayName,
  dedupeSocialCandidates,
  parseSocialProfileUrl,
  simulatedSocialCandidates,
  socialCandidateFromHit,
  type SocialCandidate,
  type SocialDiscoveryRequest,
} from '@/lib/domain/social-discovery';
import { ProviderError } from '@/lib/server/providers/discovery';
import { searchSocialCandidates, socialDiscoveryStatus } from '@/lib/server/providers/social-discovery';

// Social discovery without a network: query construction, profile parsing, scoring, duplicate
// handling and the provider contract. No platform API is called and nothing is stored.

const request = (overrides: Partial<SocialDiscoveryRequest> = {}): SocialDiscoveryRequest => ({
  country: 'GH',
  region: 'Greater Accra',
  city: 'Accra',
  category: 'Furniture showroom',
  terms: null,
  platforms: ['instagram', 'facebook', 'tiktok'],
  ...overrides,
});

function candidate(overrides: Partial<SocialCandidate> = {}): SocialCandidate {
  return {
    platform: 'instagram',
    handle: 'adwoafurniture',
    profileUrl: 'https://www.instagram.com/adwoafurniture/',
    displayName: 'Adwoa Furniture',
    snippet: 'Furniture showroom in Accra.',
    sourceQuery: 'site:instagram.com "furniture store" Accra Greater Accra Ghana',
    location: { region: 'Greater Accra', city: 'Accra', country: 'GH' },
    confidence: 0.9,
    verification: 'likely_official',
    evidence: [],
    duplicateOf: null,
    simulated: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('social search queries', () => {
  it('builds one site-scoped query per platform from the category phrase and the chosen place', () => {
    const queries = buildSocialQueries(request());
    expect(queries.map((q) => q.platform)).toEqual(['instagram', 'facebook', 'tiktok']);
    expect(queries[0].query).toBe('site:instagram.com "furniture store" Accra Greater Accra Ghana');
    expect(queries[1].query).toBe('site:facebook.com "furniture store" Accra Greater Accra Ghana');
    expect(queries[2].query).toBe('site:tiktok.com "furniture store" Accra Greater Accra Ghana');
  });

  it('uses custom terms and searches a whole region when no town is chosen', () => {
    const queries = buildSocialQueries(request({ terms: '  office chairs  ', city: null }));
    expect(queries[0].query).toBe('site:instagram.com "office chairs" Greater Accra Ghana');
  });

  it('keeps platform order and drops a repeated platform', () => {
    const queries = buildSocialQueries(request({ platforms: ['tiktok', 'instagram', 'tiktok'] }));
    expect(queries.map((q) => q.platform)).toEqual(['instagram', 'tiktok']);
  });

  it('falls back to the category label when the taxonomy has no phrase', () => {
    const queries = buildSocialQueries(request({ category: 'Hand-painted signage', terms: null }));
    expect(queries[0].query).toContain('"hand-painted signage"');
  });
});

describe('profile URL parsing', () => {
  it('reads handles from profile pages, including posts below a handle', () => {
    expect(parseSocialProfileUrl('https://www.instagram.com/adwoafurniture/')).toMatchObject({
      platform: 'instagram',
      handle: 'adwoafurniture',
      profileUrl: 'https://www.instagram.com/adwoafurniture/',
    });
    expect(parseSocialProfileUrl('https://instagram.com/adwoafurniture/p/CxYz123/')).toMatchObject({ platform: 'instagram', handle: 'adwoafurniture' });
    expect(parseSocialProfileUrl('https://m.facebook.com/AdwoaFurniture')).toMatchObject({
      platform: 'facebook',
      handle: 'AdwoaFurniture',
      profileUrl: 'https://www.facebook.com/adwoafurniture',
    });
    expect(parseSocialProfileUrl('https://www.tiktok.com/@adwoafurniture/video/7312345678901234567')).toMatchObject({
      platform: 'tiktok',
      handle: '@adwoafurniture',
      profileUrl: 'https://www.tiktok.com/@adwoafurniture',
    });
  });

  it('refuses posts, share links, groups and anything that is not a platform profile', () => {
    for (const url of [
      'https://www.instagram.com/reel/CxYz123/',
      'https://www.instagram.com/explore/tags/furniture/',
      'https://www.facebook.com/share/r/abc123/',
      'https://www.facebook.com/groups/123456/',
      'https://www.facebook.com/profile.php?id=100012345',
      'https://www.tiktok.com/tag/furniture',
      'https://adwoafurniture.com/',
      'https://www.instagram.com/',
      'not a url',
    ]) {
      expect(parseSocialProfileUrl(url), url).toBeNull();
    }
  });

  it('ignores query strings and share parameters on a real profile', () => {
    expect(parseSocialProfileUrl('https://www.tiktok.com/@adwoafurniture?lang=en')).toMatchObject({ platform: 'tiktok', handle: '@adwoafurniture' });
  });
});

describe('display names', () => {
  it('strips the platform furniture search titles carry', () => {
    expect(cleanSocialDisplayName('Adwoa Furniture (@adwoafurniture) • Instagram photos and videos')).toBe('Adwoa Furniture');
    expect(cleanSocialDisplayName('Adwoa Furniture | Facebook')).toBe('Adwoa Furniture');
    expect(cleanSocialDisplayName('Adwoa Furniture - Home')).toBe('Adwoa Furniture');
    expect(cleanSocialDisplayName('Adwoa Furniture (@adwoa) on TikTok')).toBe('Adwoa Furniture on TikTok');
  });

  it('returns nothing for a generic platform page', () => {
    expect(cleanSocialDisplayName('Instagram')).toBe('');
    expect(cleanSocialDisplayName('Log in • Instagram')).toBe('');
  });
});

describe('candidate scoring', () => {
  it('rates a category match with matching location as likely official', () => {
    const assessment = assessSocialCandidate({
      platform: 'instagram',
      handle: 'adwoafurniture',
      displayName: 'Adwoa Furniture and Home',
      snippet: 'Furniture showroom in Accra, Greater Accra. Delivery across Ghana.',
      request: request({ terms: 'furniture store' }),
    });
    expect(assessment.verification).toBe('likely_official');
    expect(assessment.confidence).toBeGreaterThanOrEqual(0.65);
    expect(assessment.evidence.join(' ')).toContain('Accra');
  });

  it('flags a same-name profile that plainly belongs elsewhere as another business', () => {
    const assessment = assessSocialCandidate({
      platform: 'instagram',
      handle: 'kumasiautoparts',
      displayName: 'Kumasi Auto Parts',
      snippet: 'Car parts dealer in Kumasi, Ashanti Region.',
      request: request({ terms: 'furniture store' }),
    });
    expect(assessment.verification).toBe('wrong_business');
    expect(assessment.confidence).toBe(0);
    expect(assessment.evidence.join(' ')).toMatch(/Kumasi/i);
  });

  it('keeps a profile with no town or region evidence for review', () => {
    const assessment = assessSocialCandidate({
      platform: 'instagram',
      handle: 'furniturehub',
      displayName: 'Furniture Hub',
      snippet: 'Quality furniture for every home.',
      request: request({ terms: 'furniture store' }),
    });
    // A strong text match alone is not promotion: without place evidence a person must decide.
    expect(assessment.verification).toBe('needs_review');
    expect(assessment.evidence.join(' ')).toContain('No location evidence');
  });

  it('does not promote a profile on country-level evidence alone', () => {
    const assessment = assessSocialCandidate({
      platform: 'instagram',
      handle: 'furnituregh',
      displayName: 'Furniture Ghana',
      snippet: 'Quality furniture for every home in Ghana.',
      request: request({ terms: 'furniture store' }),
    });
    expect(assessment.verification).toBe('needs_review');
    expect(assessment.evidence.join(' ')).toContain('country-level');
  });

  it('cannot score a generic platform page highly', () => {
    const assessment = assessSocialCandidate({
      platform: 'instagram',
      handle: 'instagram',
      displayName: 'Instagram',
      snippet: 'Furniture store Accra Greater Accra Ghana',
      request: request({ terms: 'furniture store' }),
    });
    expect(assessment.confidence).toBeLessThanOrEqual(0.15);
    expect(assessment.verification).toBe('needs_review');
  });
});

describe('duplicate handling', () => {
  it('collapses the same profile reached by two different queries', () => {
    const kept = dedupeSocialCandidates([candidate(), candidate({ sourceQuery: 'site:instagram.com "furniture store" Kumasi' })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].profileUrl).toBe('https://www.instagram.com/adwoafurniture/');
  });

  it('flags a same-platform account that shares a name but not a handle', () => {
    const kept = dedupeSocialCandidates([
      candidate(),
      candidate({
        handle: 'adwoafurnitureofficial',
        profileUrl: 'https://www.instagram.com/adwoafurnitureofficial/',
        confidence: 0.5,
        verification: 'needs_review',
      }),
    ]);
    expect(kept).toHaveLength(2);
    const duplicate = kept.find((c) => c.handle === 'adwoafurnitureofficial');
    expect(duplicate?.verification).toBe('possible_duplicate');
    expect(duplicate?.duplicateOf).toBe('https://www.instagram.com/adwoafurniture/');
    expect(duplicate?.evidence.join(' ')).toMatch(/confirm which profile is official/i);
  });

  it('does not treat the same handle on two platforms as a duplicate', () => {
    const kept = dedupeSocialCandidates([
      candidate(),
      candidate({ platform: 'facebook', handle: 'adwoafurniture', profileUrl: 'https://www.facebook.com/adwoafurniture' }),
    ]);
    expect(kept).toHaveLength(2);
    expect(kept.every((c) => c.verification === 'likely_official')).toBe(true);
  });
});

describe('search hits to candidates', () => {
  it('keeps a profile hit and scores it', () => {
    const c = socialCandidateFromHit(
      {
        title: 'Adwoa Furniture (@adwoafurniture) • Instagram photos and videos',
        url: 'https://www.instagram.com/adwoafurniture/',
        description: 'Furniture showroom in Accra, Greater Accra.',
      },
      'instagram',
      request({ terms: 'furniture store' }),
      'site:instagram.com "furniture store" Accra Greater Accra Ghana',
    );
    expect(c).toMatchObject({
      platform: 'instagram',
      handle: 'adwoafurniture',
      displayName: 'Adwoa Furniture',
      simulated: false,
      duplicateOf: null,
    });
    expect(c?.verification).toBe('likely_official');
  });

  it('drops a hit that is a post, or that belongs to another platform', () => {
    expect(socialCandidateFromHit({ title: 'Reel', url: 'https://www.instagram.com/reel/abc/', description: '' }, 'instagram', request(), 'q')).toBeNull();
    expect(socialCandidateFromHit({ title: 'Adwoa', url: 'https://www.facebook.com/adwoafurniture', description: '' }, 'instagram', request(), 'q')).toBeNull();
  });
});

describe('simulated world', () => {
  it('returns clearly fictional, labelled profiles for each selected platform', () => {
    const candidates = simulatedSocialCandidates(request({ platforms: ['instagram', 'tiktok'], city: 'Kumasi' }));
    expect(candidates.map((c) => c.platform)).toEqual(['instagram', 'tiktok']);
    for (const c of candidates) {
      expect(c.simulated).toBe(true);
      expect(c.displayName).toContain('(fictional demo)');
      expect(c.evidence.join(' ')).toMatch(/not a real business/i);
    }
    expect(candidates[0].profileUrl).toMatch(/^https:\/\/www\.instagram\.com\//);
    expect(candidates[1].profileUrl).toMatch(/^https:\/\/www\.tiktok\.com\/@/);
  });
});

describe('social discovery provider', () => {
  it('answers from the labelled simulated world when external tools are simulated', async () => {
    vi.stubEnv('SIMULATE_EXTERNAL_TOOLS', 'true');
    expect(socialDiscoveryStatus()).toMatchObject({ simulated: true, enabled: true });
    const out = await searchSocialCandidates(request({ platforms: ['instagram'] }), { signal: new AbortController().signal });
    expect(out.simulated).toBe(true);
    expect(out.estimatedCostUsd).toBe(0);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].simulated).toBe(true);
  });

  it('refuses instead of guessing when no key or switch is present', async () => {
    vi.stubEnv('SIMULATE_EXTERNAL_TOOLS', 'false');
    vi.stubEnv('SOCIAL_DISCOVERY_ENABLED', 'false');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
    expect(socialDiscoveryStatus()).toMatchObject({ enabled: false, liveEnabled: false, searchConfigured: false });
    await expect(searchSocialCandidates(request(), { signal: new AbortController().signal })).rejects.toBeInstanceOf(ProviderError);
  });

  it('queries the index once per platform, keeps only profiles, and reports each answered query', async () => {
    vi.stubEnv('SIMULATE_EXTERNAL_TOOLS', 'false');
    vi.stubEnv('SOCIAL_DISCOVERY_ENABLED', 'true');
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'test-key');

    const asked: string[] = [];
    const answered: string[] = [];
    const search = {
      id: 'fake_search',
      name: 'Fake search',
      isConfigured: () => true,
      estimatedCostUsd: () => 0.005,
      search: async (query: string) => {
        asked.push(query);
        if (query.includes('instagram.com')) {
          return [
            {
              title: 'Adwoa Furniture (@adwoafurniture) • Instagram photos and videos',
              url: 'https://www.instagram.com/adwoafurniture/',
              description: 'Furniture showroom in Accra, Greater Accra.',
            },
            { title: 'Reel', url: 'https://www.instagram.com/reel/abc123/', description: '' },
          ];
        }
        return [
          { title: 'Adwoa Furniture | Facebook', url: 'https://www.facebook.com/adwoafurniture', description: 'Furniture store in Accra, Greater Accra.' },
          { title: 'Unrelated directory', url: 'https://example.org/listing/123', description: '' },
        ];
      },
    };

    const out = await searchSocialCandidates(request({ platforms: ['instagram', 'facebook'] }), {
      signal: new AbortController().signal,
      search,
      onQueryAnswered: (query) => {
        answered.push(query.platform);
      },
    });

    expect(asked).toHaveLength(2);
    expect(answered).toEqual(['instagram', 'facebook']);
    expect(out.estimatedCostUsd).toBeCloseTo(0.01);
    expect(out.queries.map((q) => q.platform)).toEqual(['instagram', 'facebook']);
    expect(out.candidates.map((c) => c.profileUrl)).toEqual([
      'https://www.instagram.com/adwoafurniture/',
      'https://www.facebook.com/adwoafurniture',
    ]);
    expect(out.candidates.every((c) => c.simulated === false)).toBe(true);
  });
});
