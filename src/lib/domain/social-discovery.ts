// Social discovery: finds public business profiles on Instagram, Facebook and TikTok through an
// independent web-search index, then judges each hit for human review.
//
// Nothing here is persisted. A profile URL reached this way is review material, not a lead: the
// platforms' terms do not license building contact lists from their content, and a profile is
// often a fan page or an unrelated business with a similar name. The UI asks for independent
// verification before any detail is written to the CRM.

import { searchTermForCategory } from './categories';
import { COUNTRIES, countryName, regionForCity } from './geo';

export const SOCIAL_DISCOVERY_PLATFORMS = ['instagram', 'facebook', 'tiktok'] as const;
export type SocialDiscoveryPlatform = (typeof SOCIAL_DISCOVERY_PLATFORMS)[number];

export const SOCIAL_DISCOVERY_LABELS: Record<SocialDiscoveryPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
};

/** Public hosts that serve a platform's profiles. Share/short hosts are deliberately excluded. */
export const SOCIAL_DISCOVERY_HOSTS: Record<SocialDiscoveryPlatform, readonly string[]> = {
  instagram: ['instagram.com'],
  facebook: ['facebook.com', 'fb.com'],
  tiktok: ['tiktok.com'],
};

/** Path segments that are never a profile: posts, reels, share links, numeric profile endpoints. */
const RESERVED_SEGMENTS: Record<SocialDiscoveryPlatform, readonly string[]> = {
  instagram: ['p', 'reel', 'reels', 'explore', 'tv', 'stories', 'accounts', 'direct', 'about', 'legal', 'developer', 'challenge'],
  facebook: [
    'pages',
    'groups',
    'watch',
    'photo',
    'photos',
    'video',
    'videos',
    'events',
    'reel',
    'reels',
    'share',
    'sharer',
    'story',
    'permalink.php',
    'profile.php',
    'media',
    'hashtag',
    'marketplace',
    'help',
    'login',
  ],
  tiktok: ['video', 'discover', 'tag', 'music', 'search', 'login', 'about', 'legal', 'embed'],
};

/** Platform pages that rank for a query but say nothing about a specific business. */
const GENERIC_TITLES = new Set(['instagram', 'facebook', 'tiktok', 'log in', 'login', 'sign up', 'explore', 'watch', 'home', 'discover']);

const PLATFORM_ORDER: Record<SocialDiscoveryPlatform, number> = { instagram: 0, facebook: 1, tiktok: 2 };

export type SocialCandidateVerification = 'likely_official' | 'needs_review' | 'possible_duplicate' | 'wrong_business';

export interface SocialDiscoveryRequest {
  country: string;
  region: string | null;
  city: string | null;
  category: string;
  terms: string | null;
  platforms: SocialDiscoveryPlatform[];
}

export interface SocialCandidate {
  platform: SocialDiscoveryPlatform;
  /** @handle on Instagram and TikTok, page slug on Facebook, without decoration. */
  handle: string;
  /** Canonical public profile URL — the only identifier the UI relies on. */
  profileUrl: string;
  /** Published search title. Transient review material, never stored. */
  displayName: string;
  /** Published search description. Transient review material, never stored. */
  snippet: string;
  /** The query that produced this profile, so a reviewer can see why it appeared. */
  sourceQuery: string;
  location: { region: string | null; city: string | null; country: string };
  /** 0–0.95. A ranking aid for a person, never a decision. */
  confidence: number;
  verification: SocialCandidateVerification;
  evidence: string[];
  /** Profile URL of the primary candidate when this one looks like the same account. */
  duplicateOf: string | null;
  simulated: boolean;
}

export interface SocialQuery {
  platform: SocialDiscoveryPlatform;
  query: string;
}

/** Shown beside every result set. */
export const SOCIAL_DISCOVERY_NOTICE =
  'Public profile results are review material only: nothing is saved, and a person must confirm the profile belongs to the business before its details enter the CRM.';

/** The phrase a search is built from: custom terms first, then the category's own search phrase. */
export function socialSearchSubject(input: Pick<SocialDiscoveryRequest, 'category' | 'terms'>): string {
  const terms = input.terms?.trim();
  if (terms) return terms.slice(0, 80);
  return (searchTermForCategory(input.category) || input.category).slice(0, 80);
}

/** One query per platform keeps the `site:` operator precise and lets each result be attributed. */
export function buildSocialQueries(input: SocialDiscoveryRequest): SocialQuery[] {
  const subject = socialSearchSubject(input);
  const place = [input.city?.trim(), input.region?.trim(), countryName(input.country)].filter(Boolean).join(' ');
  return uniquePlatforms(input.platforms).map((platform) => ({
    platform,
    query: `site:${SOCIAL_DISCOVERY_HOSTS[platform][0]} "${subject}" ${place}`.replace(/\s+/g, ' ').trim(),
  }));
}

export function uniquePlatforms(platforms: readonly SocialDiscoveryPlatform[]): SocialDiscoveryPlatform[] {
  const wanted = new Set(platforms);
  return SOCIAL_DISCOVERY_PLATFORMS.filter((p) => wanted.has(p));
}

/** The canonical profile URL for a platform handle. */
export function profileUrlFor(platform: SocialDiscoveryPlatform, handle: string): string {
  const bare = handle.replace(/^@/, '').toLowerCase();
  if (platform === 'instagram') return `https://www.instagram.com/${bare}/`;
  if (platform === 'facebook') return `https://www.facebook.com/${bare}`;
  return `https://www.tiktok.com/@${bare}`;
}

export interface ParsedProfile {
  platform: SocialDiscoveryPlatform;
  handle: string;
  profileUrl: string;
}

/** Reads a profile out of a search hit, or returns null when the URL is not a profile page. */
export function parseSocialProfileUrl(raw: string): ParsedProfile | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const platform = SOCIAL_DISCOVERY_PLATFORMS.find((p) => SOCIAL_DISCOVERY_HOSTS[p].some((h) => host === h || host.endsWith(`.${h}`)));
  if (!platform) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  const reserved = RESERVED_SEGMENTS[platform];

  let handle: string;
  if (platform === 'tiktok') {
    const tag = segments.find((s) => s.startsWith('@'));
    if (!tag) return null;
    handle = tag;
  } else {
    const first = segments[0];
    if (reserved.includes(first.toLowerCase())) return null;
    handle = first;
  }
  // Handles are letters, digits, dots and underscores (TikTok adds a leading @).
  if (!/^@?[A-Za-z0-9._-]{2,80}$/.test(handle)) return null;
  return { platform, handle, profileUrl: profileUrlFor(platform, handle) };
}

/**
 * Strips the platform furniture search titles carry:
 * `“Adwoa's Boutique (@adwoasboutique) • Instagram photos and videos”` becomes `Adwoa's Boutique`.
 * An empty result means the hit was a generic platform page, not a business.
 */
export function cleanSocialDisplayName(title: string): string {
  const name = title
    .replace(/\s*\(@[^)]{1,80}\)/g, ' ')
    .replace(/\s*[|•·]\s*(instagram|facebook|tiktok)\b.*$/i, '')
    .replace(/\s*[-–—]\s*(photos?\s*(and|&)\s*videos?|videos?|reels?|home|official)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return GENERIC_TITLES.has(name.toLowerCase()) ? '' : name;
}

interface PlaceNames {
  regions: Set<string>;
  cities: Set<string>;
}

const placeCache = new Map<string, PlaceNames>();

function placeNames(country: string): PlaceNames {
  const cached = placeCache.get(country);
  if (cached) return cached;
  const entry = COUNTRIES.find((c) => c.code === country);
  const names: PlaceNames = {
    regions: new Set((entry?.regions ?? []).map((r) => r.name.toLowerCase())),
    cities: new Set((entry?.regions ?? []).flatMap((r) => r.cities.map((c) => c.name.toLowerCase()))),
  };
  placeCache.set(country, names);
  return names;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word mentions only: a short town name must not match inside an unrelated word. */
function mentions(text: string, names: Iterable<string>): string[] {
  const found: string[] = [];
  for (const name of names) {
    if (name.length < 4) continue;
    if (new RegExp(`(^|[^a-z])${escapeRegExp(name)}([^a-z]|$)`).test(text)) found.push(name);
  }
  return found;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'shop',
  'shops',
  'store',
  'stores',
  'service',
  'services',
  'ltd',
  'limited',
  'company',
  'enterprise',
  'ghana',
  'supplies',
]);

function significantTokens(phrase: string): string[] {
  return [...new Set(phrase.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t)))];
}

interface LocationEvidence {
  matched: 'city' | 'region' | 'country' | null;
  conflict: string | null;
}

function locationEvidence(text: string, request: SocialDiscoveryRequest): LocationEvidence {
  const country = COUNTRIES.find((c) => c.code === request.country);
  const region = request.region ?? (request.city ? regionForCity(request.city, request.country) : null);
  const allowedCities = new Set(
    [request.city, ...(country?.regions.find((r) => r.name.toLowerCase() === region?.toLowerCase())?.cities.map((c) => c.name) ?? [])]
      .filter(Boolean)
      .map((c) => c!.toLowerCase()),
  );
  const requested = new Set([request.city?.toLowerCase(), region?.toLowerCase()].filter(Boolean) as string[]);
  const countryNameLower = countryName(request.country).toLowerCase();

  const names = placeNames(request.country);
  const cityMentions = mentions(text, allowedCities);
  const regionMentions = mentions(text, requested);
  const foreign = mentions(text, names.cities);
  const foreignRegions = mentions(text, names.regions).filter((r) => !requested.has(r));

  const conflict = foreign.find((c) => !allowedCities.has(c) && !requested.has(c)) ?? foreignRegions[0] ?? null;

  if (cityMentions.length) return { matched: 'city', conflict };
  if (regionMentions.length) return { matched: 'region', conflict };
  if (text.includes(countryNameLower)) return { matched: 'country', conflict };
  return { matched: null, conflict };
}

export interface CandidateAssessmentInput {
  platform: SocialDiscoveryPlatform;
  handle: string;
  displayName: string;
  snippet: string;
  request: SocialDiscoveryRequest;
}

export interface CandidateAssessment {
  confidence: number;
  verification: SocialCandidateVerification;
  evidence: string[];
}

/**
 * Scores a hit for a human reviewer. The weights are deliberately conservative: clearing 0.65
 * needs both a category match and location evidence, because a same-name profile elsewhere in the
 * country is the usual failure mode.
 */
export function assessSocialCandidate(input: CandidateAssessmentInput): CandidateAssessment {
  const subject = socialSearchSubject(input.request);
  const subjectTokens = significantTokens(subject);
  const text = `${input.displayName} ${input.snippet}`.toLowerCase();
  const handle = input.handle.toLowerCase().replace(/^@/, '');
  const evidence: string[] = [];

  const matchedTokens = subjectTokens.filter((t) => text.includes(t));
  const subjectRatio = subjectTokens.length ? matchedTokens.length / subjectTokens.length : 0;
  const handleMatch = subjectTokens.some((t) => handle.includes(t));

  let confidence = 0.3;

  if (subjectRatio >= 0.6) {
    confidence += 0.3;
    evidence.push(`Result text mentions “${matchedTokens[0]}”.`);
  } else if (subjectRatio > 0) {
    confidence += 0.15;
    evidence.push(`Result text only partly matches “${subject}”.`);
  } else {
    evidence.push(`No mention of “${subject}” in the result text.`);
  }

  if (handleMatch) {
    confidence += 0.1;
    evidence.push('Handle resembles the search phrase.');
  }

  const place = locationEvidence(text, input.request);
  const expected = [input.request.city, input.request.region ?? (input.request.city ? regionForCity(input.request.city, input.request.country) : null)]
    .filter(Boolean)
    .join(', ');
  if (place.matched === 'city') {
    confidence += 0.2;
    evidence.push(`Location evidence matches ${input.request.city}.`);
  } else if (place.matched === 'region') {
    confidence += 0.12;
    evidence.push(`Region evidence matches ${input.request.region ?? expected}.`);
  } else if (place.matched === 'country') {
    confidence += 0.05;
    evidence.push(`Only country-level location evidence (${countryName(input.request.country)}).`);
  } else {
    evidence.push('No location evidence in the result text.');
  }

  if (place.conflict) {
    confidence -= 0.35;
    evidence.push(`Location evidence points to ${place.conflict}, not ${expected || countryName(input.request.country)}.`);
  }

  if (GENERIC_TITLES.has(input.displayName.trim().toLowerCase())) {
    confidence = Math.min(confidence, 0.15);
    evidence.push('Generic platform page, not a business profile.');
  }

  confidence = Math.round(Math.min(0.95, Math.max(0, confidence)) * 100) / 100;

  // Promotion needs a category match *and* town or region evidence. Country-level evidence alone
  // (a profile that only says "Ghana") is not enough: that is how unrelated businesses get merged.
  const located = place.matched === 'city' || place.matched === 'region';
  const verification: SocialCandidateVerification =
    place.conflict && subjectRatio === 0 ? 'wrong_business' : confidence >= 0.65 && located ? 'likely_official' : 'needs_review';

  return { confidence, verification, evidence };
}

export interface SocialSearchHit {
  title: string;
  url: string;
  description: string;
}

/** Turns one search hit into a scored candidate, or drops it when it is not a profile. */
export function socialCandidateFromHit(
  hit: SocialSearchHit,
  platform: SocialDiscoveryPlatform,
  request: SocialDiscoveryRequest,
  sourceQuery: string,
): SocialCandidate | null {
  const parsed = parseSocialProfileUrl(hit.url);
  if (!parsed || parsed.platform !== platform) return null;
  const displayName = cleanSocialDisplayName(hit.title) || parsed.handle;
  const assessment = assessSocialCandidate({ platform, handle: parsed.handle, displayName, snippet: hit.description, request });
  return {
    platform,
    handle: parsed.handle,
    profileUrl: parsed.profileUrl,
    displayName,
    snippet: hit.description.slice(0, 400),
    sourceQuery,
    location: { region: request.region, city: request.city, country: request.country },
    confidence: assessment.confidence,
    verification: assessment.verification,
    evidence: assessment.evidence,
    duplicateOf: null,
    simulated: false,
  };
}

/**
 * Collapses the same profile reached by two queries, then flags accounts on one platform that share
 * a display name but not a handle — usually a repost page or a fan account.
 */
export function dedupeSocialCandidates(candidates: readonly SocialCandidate[]): SocialCandidate[] {
  const ordered = [...candidates].sort(
    (a, b) => b.confidence - a.confidence || PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform] || a.handle.localeCompare(b.handle),
  );
  const seen = new Set<string>();
  const kept: SocialCandidate[] = [];
  for (const candidate of ordered) {
    const key = `${candidate.platform}:${candidate.handle.toLowerCase().replace(/^@/, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(candidate);
  }

  const primaries = new Map<string, SocialCandidate>();
  return kept.map((candidate) => {
    const name = candidate.displayName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!name) return candidate;
    const key = `${candidate.platform}:${name}`;
    const primary = primaries.get(key);
    if (!primary) {
      primaries.set(key, candidate);
      return candidate;
    }
    return {
      ...candidate,
      verification: 'possible_duplicate' as const,
      duplicateOf: primary.profileUrl,
      evidence: [...candidate.evidence, `Shares a name with ${primary.handle}; confirm which profile is official.`],
    };
  });
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'business'
  );
}

/**
 * The labelled simulated world used when external tools are simulated (demo and browser tests).
 * Clearly fictional, so it can never be mistaken for a real business or contacted.
 */
export function simulatedSocialCandidates(input: SocialDiscoveryRequest): SocialCandidate[] {
  const subject = socialSearchSubject(input);
  const place = input.city?.trim() || input.region?.trim() || countryName(input.country);
  return uniquePlatforms(input.platforms).map((platform, index) => {
    const handle = `${slugify(subject)}-${slugify(place)}-${index + 1}-demo`;
    return {
      platform,
      handle: platform === 'tiktok' ? `@${handle}` : handle,
      profileUrl: profileUrlFor(platform, handle),
      displayName: `${subject.replace(/\b\w/g, (c) => c.toUpperCase())} ${place} ${index + 1} (fictional demo)`,
      snippet: `Fictional ${SOCIAL_DISCOVERY_LABELS[platform]} profile for ${place}, used to practise the review step. Not a real business.`,
      sourceQuery: `simulated:${platform}`,
      location: { region: input.region, city: input.city, country: input.country },
      confidence: 0.4,
      verification: 'needs_review',
      evidence: ['Fictional demo profile', 'Not a real business — do not contact'],
      duplicateOf: null,
      simulated: true,
    };
  });
}
