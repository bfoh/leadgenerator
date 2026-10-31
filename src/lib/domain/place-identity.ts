// Identifying a Place-ID-only reference.
//
// A Google reference keeps a Place ID, the workspace's own search filters and nothing else, so the
// first question about it is simply "who is this?". This module answers that from independent public
// sources only: a few bounded searches, one homepage read per candidate site, and a reading of the
// name the site publishes. Nothing Google returned is used or kept, and a reading becomes a proposal
// only when a site names the business itself and supports the place on the record.

import { z } from 'zod';
import { googleHostedUrl } from './business-resources';
import type { Tone } from './constants';
import { findIndustryCategory } from './industry-taxonomy';
import type { PageFacts } from './page-signals';
import { GHANA_PLACES, classifyUrl, nameCoverage, registrableDomain } from './web-research';
import {
  VERDICT_LABELS,
  planQueries,
  type AssessBusiness,
  type CandidateCheck,
  type CandidateVerdict,
  type ConfidenceBand,
  type QueryPurpose,
  type SearchHit,
} from './website-assessment';

// ── Bounds ───────────────────────────────────────────────────────────────────

/** Searches per check: the name with its town, a variation, and the name with Ghana. */
export const PLACE_IDENTITY_QUERY_LIMIT = 3;
/** Homepages per check: a shortlist, because every one is a separate bounded read. */
export const PLACE_IDENTITY_INSPECTION_LIMIT = 3;
/** Ownership evidence a site needs before it may stand in for the reference. */
export const PLACE_IDENTITY_MIN_SCORE = 50;
/** How long a reading stays usable, so a stale check cannot rewrite a profile much later. */
export const PLACE_IDENTITY_MAX_AGE_DAYS = 7;

export type PlaceIdentityStatus = 'identified' | 'ambiguous' | 'not_found';

export const PLACE_IDENTITY_STATUS_META: Record<PlaceIdentityStatus, { label: string; description: string; tone: Tone }> = {
  identified: {
    label: 'Identified',
    description: 'One independent site publishes the business name and supports the place on this record.',
    tone: 'success',
  },
  ambiguous: {
    label: 'Needs a person',
    description: 'The sources disagree, or more than one site could be this business. Nothing changes until someone decides.',
    tone: 'warning',
  },
  not_found: {
    label: 'Nothing found',
    description: 'No independent site could be read for this name. The reference stays exactly as it is.',
    tone: 'neutral',
  },
};

// ── The record a check runs against ──────────────────────────────────────────

/**
 * The record as it stood when the check ran. It is part of the evidence, so acceptance can refuse a
 * profile that has been edited in the meantime instead of overwriting someone's change.
 */
export const identityProfileSchema = z.object({
  name: z.string().trim().max(200),
  city: z.string().trim().max(120),
  region: z.string().trim().max(120).nullable(),
  neighborhood: z.string().trim().max(120).nullable(),
  category: z.string().trim().max(120),
  country: z.string().trim().length(2),
  /** Empty when the record has no website yet: a reading may then fill it. */
  website: z.string().trim().max(2000),
});
export type IdentityProfile = z.infer<typeof identityProfileSchema>;

// ── What one page published ──────────────────────────────────────────────────

export const IDENTITY_NAME_SOURCES = ['structured_data', 'site_name', 'main_heading', 'page_title'] as const;
export type IdentityNameSource = (typeof IDENTITY_NAME_SOURCES)[number];

export const IDENTITY_NAME_SOURCE_LABELS: Record<IdentityNameSource, string> = {
  structured_data: 'structured data',
  site_name: 'site name',
  main_heading: 'main heading',
  page_title: 'page title',
};

/** Titles that name a page rather than a business. */
const NOT_A_NAME = new Set(['home', 'home page', 'homepage', 'welcome', 'index', 'untitled', 'site', 'website', 'new page', 'coming soon']);

/** The same string with its obvious site furniture removed. */
function nameVariants(raw: string): string[] {
  const text = raw.replace(/\s+/g, ' ').trim();
  const out = [text];
  // "Adom Bridal House | Accra", "Adom Bridal House — Home", "Adom Bridal House · Bridal wear".
  for (const sep of [/\s+[|–—·•]\s+/, /\s+-\s+/]) {
    const head = text.split(sep)[0];
    if (head && head !== text) out.push(head.trim());
  }
  // "Welcome to Adom Bridal House", "Official website of Adom Bridal House".
  for (const variant of [...out]) {
    const stripped = variant.replace(/^(welcome to|home of|official (website|site) of|the)\s+/i, '').trim();
    if (stripped && stripped !== variant) out.push(stripped);
  }
  return out.filter((v) => v.length >= 2 && v.length <= 120 && /[a-z]/i.test(v) && !NOT_A_NAME.has(v.toLowerCase()));
}

function bestVariant(raw: string, searched: string): string | null {
  const variants = nameVariants(raw);
  if (!variants.length) return null;
  // The variant that covers the searched name best, and the shortest when two tie.
  return [...variants].sort((a, b) => nameCoverage(searched, b) - nameCoverage(searched, a) || a.length - b.length)[0] ?? null;
}

/**
 * The name a page publishes, and where it says so. Structured data wins, then the declared site
 * name, then the main heading, then the title. A page that names something else still reports that
 * name, so a person sees the conflict instead of a blank.
 */
export function publishedNameOf(facts: PageFacts | null, searched: string): { name: string; from: IdentityNameSource; coverage: number } | null {
  if (!facts) return null;
  const places: { raw: string | null | undefined; from: IdentityNameSource }[] = [
    { raw: facts.schemaNames[0], from: 'structured_data' },
    { raw: facts.siteName, from: 'site_name' },
    { raw: facts.h1[0], from: 'main_heading' },
    { raw: facts.title, from: 'page_title' },
  ];
  const scored = places
    .map((p) => {
      const name = p.raw ? bestVariant(p.raw, searched) : null;
      return name ? { name, from: p.from, coverage: nameCoverage(searched, name) } : null;
    })
    .filter((v): v is { name: string; from: IdentityNameSource; coverage: number } => v !== null)
    .sort((a, b) => b.coverage - a.coverage);
  return scored.find((s) => s.coverage >= 0.75) ?? scored[0] ?? null;
}

/** The kind of business a page's structured data claims, in this workspace's own taxonomy. */
export function categoryFromFacts(facts: PageFacts | null): string | null {
  for (const type of facts?.schemaTypes ?? []) {
    const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    const category = findIndustryCategory(words);
    if (category) return category.label;
  }
  return null;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** The town a page's structured data claims, when it is a known Ghanaian place. */
export function cityFromFacts(facts: PageFacts | null): string | null {
  const locality = facts?.schemaLocality?.trim().toLowerCase();
  if (!locality) return null;
  const known = GHANA_PLACES.find((p) => p === locality);
  return known ? titleCase(known) : null;
}

/** The comparable part of a prospect: name, place, category and website, never Google's content. */
export function identityProfileOf(b: {
  name: string;
  city: string;
  region: string | null;
  neighborhood: string | null;
  category: string;
  country: string;
  officialWebsite: string | null;
}): IdentityProfile {
  return identityProfileSchema.parse({
    name: b.name ?? '',
    city: b.city ?? '',
    region: b.region,
    neighborhood: b.neighborhood,
    category: b.category ?? '',
    country: (b.country || 'GH').trim().slice(0, 2).toUpperCase() || 'GH',
    website: b.officialWebsite ?? '',
  });
}

// ── Searches ─────────────────────────────────────────────────────────────────

/**
 * The record as the website rules expect it, with the name being checked in place of the record's
 * own placeholder. A placeholder has no phone, email or social profile of its own to match with.
 */
export function assessBusinessFor(
  profile: IdentityProfile,
  name: string,
  channels: Pick<AssessBusiness, 'phone' | 'email' | 'socialProfiles'> = { phone: null, email: null, socialProfiles: [] },
): AssessBusiness {
  return {
    name: name.trim().slice(0, 200),
    city: profile.city,
    region: profile.region,
    neighborhood: profile.neighborhood,
    category: profile.category,
    officialWebsite: profile.website || null,
    socialProfiles: channels.socialProfiles,
    phone: channels.phone,
    email: channels.email,
  };
}

/**
 * The searches one check runs: the same bounded queries the website rules use, with the name being
 * checked in place of the record's placeholder. None of the results are stored.
 */
export function planIdentityQueries(profile: IdentityProfile, name: string): { query: string; purpose: QueryPurpose }[] {
  return planQueries(assessBusinessFor(profile, name)).slice(0, PLACE_IDENTITY_QUERY_LIMIT);
}

/**
 * One judged page, reduced to the readings a person needs. The page's own text, technical detail and
 * ownership signals stay in the run; only what the review shows is carried forward.
 */
export function toIdentityCandidate(c: CandidateCheck, searched: string): IdentityCandidate {
  const published = publishedNameOf(c.facts, searched);
  return {
    site: c.site,
    url: c.url,
    verdict: c.verdict,
    ownershipScore: c.ownershipScore,
    publishedName: published?.name ?? null,
    publishedNameFrom: published?.from ?? null,
    nameMatch: published ? Math.round(published.coverage * 100) / 100 : 0,
    describesCity: Boolean(c.signals?.city),
    elsewhereInGhana: [...(c.signals?.otherGhanaPlaces ?? [])].slice(0, 5),
    foreign: Boolean(c.signals?.foreign),
    category: categoryFromFacts(c.facts),
    locality: cityFromFacts(c.facts),
    failure: c.failure,
  };
}

/** Public pages other than the candidate sites that use the name. Hosts and kinds only. */
export function corroboratingSources(
  hits: SearchHit[],
  name: string,
  options: { max?: number; excludeHosts?: string[] } = {},
): { kind: string; host: string }[] {
  const { max = 8, excludeHosts = [] } = options;
  // The sites that were read for this check are the evidence itself, not corroboration of it.
  const skip = new Set(excludeHosts.map((h) => h.toLowerCase()));
  const seen = new Map<string, { kind: string; host: string }>();
  for (const hit of hits) {
    const found = classifyUrl(hit.url);
    // Search engines and encyclopaedias repeat a name without anyone vouching for it, and nothing
    // Google hosts may be carried into the evidence at all: it is transient preview material.
    if (!found || found.kind === 'reference' || googleHostedUrl(hit.url)) continue;
    if (skip.has(found.host) || skip.has(registrableDomain(found.host))) continue;
    if (nameCoverage(name, hit.title) < 0.75) continue;
    if (!seen.has(found.host)) seen.set(found.host, { kind: found.kind, host: found.host });
  }
  return [...seen.values()].slice(0, max);
}



// ── Evidence ─────────────────────────────────────────────────────────────────

/** What one candidate site said about itself. No page text is kept, only these readings. */
export interface IdentityCandidate {
  site: string;
  url: string;
  verdict: CandidateVerdict;
  /** 0–100 ownership evidence, as the website-assessment rules already judge it. */
  ownershipScore: number;
  /** The name the site publishes, when a heading or title reads as one. */
  publishedName: string | null;
  publishedNameFrom: IdentityNameSource | null;
  /** How much of the searched name that published name covers, 0–1. */
  nameMatch: number;
  /** The site's own text names the town on this record. */
  describesCity: boolean;
  /** Other Ghanaian places the site names; it may be another branch. */
  elsewhereInGhana: string[];
  foreign: boolean;
  /** The kind of business its structured data claims, in this workspace's taxonomy. */
  category: string | null;
  /** The town its structured data claims, when that is a known Ghanaian place. */
  locality: string | null;
  /** Why the page could not be read, when it could not. */
  failure: string | null;
}

export interface IdentityQueryRecord {
  purpose: QueryPurpose;
  resultCount: number;
  ok: boolean;
}

/**
 * Everything a person review can show, and everything acceptance re-reads. It holds no query text,
 * no result snippets and nothing from Google: hosts, published names and counts only.
 */
export interface PlaceIdentityEvidence {
  schema: 1;
  checkedAt: string;
  profile: IdentityProfile;
  queries: IdentityQueryRecord[];
  candidates: IdentityCandidate[];
  /** Other public pages that use this name, by host. */
  corroboration: { kind: string; host: string }[];
}

const verdictKeys = Object.keys(VERDICT_LABELS) as [CandidateVerdict, ...CandidateVerdict[]];

const candidateSchema = z.object({
  site: z.string().trim().min(3).max(200),
  url: z.string().trim().min(3).max(2000),
  verdict: z.enum(verdictKeys),
  ownershipScore: z.number().int().min(0).max(100),
  publishedName: z.string().trim().min(1).max(120).nullable(),
  publishedNameFrom: z.enum(IDENTITY_NAME_SOURCES).nullable(),
  nameMatch: z.number().min(0).max(1),
  describesCity: z.boolean(),
  elsewhereInGhana: z.array(z.string().trim().min(1).max(80)).max(10),
  foreign: z.boolean(),
  category: z.string().trim().max(120).nullable(),
  locality: z.string().trim().max(120).nullable(),
  failure: z.string().trim().max(40).nullable(),
});

/** Evidence arriving from a browser is bounded and stripped to the fields the rules read. */
export const placeIdentityEvidenceSchema = z.object({
  schema: z.literal(1),
  checkedAt: z.string().trim().max(40),
  profile: identityProfileSchema,
  queries: z
    .array(
      z.object({
        purpose: z.enum(['exact_name_city', 'name_variation', 'ghana_location', 'official_domain']),
        resultCount: z.number().int().min(0).max(1000),
        ok: z.boolean(),
      }),
    )
    .max(PLACE_IDENTITY_QUERY_LIMIT),
  candidates: z.array(candidateSchema).max(PLACE_IDENTITY_INSPECTION_LIMIT),
  corroboration: z.array(z.object({ kind: z.string().trim().max(40), host: z.string().trim().max(200) })).max(8),
});

/** Parses evidence that came back from a client, refusing anything the rules would not read. */
export function parsePlaceIdentityEvidence(raw: unknown): PlaceIdentityEvidence {
  return placeIdentityEvidenceSchema.parse(raw);
}

// ── The reading ──────────────────────────────────────────────────────────────

/** The profile change one site supports. Everything else on the record is left alone. */
export interface IdentityProposal {
  name: string;
  nameMatch: number;
  website: string | null;
  category: string | null;
  city: string | null;
  site: string;
  url: string;
  publishedName: string | null;
  publishedNameFrom: IdentityNameSource | null;
}

/** One judged site, as a review shows it: what it published and why it scored as it did. */
export interface IdentityCheck {
  site: string;
  url: string;
  verdict: CandidateVerdict;
  score: number;
  nameMatch: number;
  publishedName: string | null;
  reasons: string[];
}

export interface PlaceIdentityReading {
  status: PlaceIdentityStatus;
  confidence: ConfidenceBand;
  /** 0–100, only ever used to rank the shortlist. */
  score: number;
  proposal: IdentityProposal;
  /** What a person should still check before accepting, worst first. */
  concerns: string[];
  checks: IdentityCheck[];
  queryCount: number;
}

const round = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Ranking always puts the most defensible site first; it is not a confidence claim. */
function rankOf(c: IdentityCandidate): number {
  return round(55 + c.ownershipScore * 0.25 + c.nameMatch * 20);
}

/** A site that names the business and shows enough ownership evidence to stand in its place. */
function supports(c: IdentityCandidate): boolean {
  return names(c) && c.ownershipScore >= PLACE_IDENTITY_MIN_SCORE && (c.verdict === 'owned' || c.verdict === 'probable');
}

/**
 * A site that publishes the searched name, whether or not it supports the place yet. The workspace's
 * own reference label does not count: no site publishes "Unverified place …", so a page that appears
 * to is echoing the record rather than naming a business.
 */
function names(c: IdentityCandidate): boolean {
  return !c.failure && c.publishedName !== null && c.nameMatch >= 0.75 && !looksLikePlaceholderName(c.publishedName);
}

/** One judged site, reduced to what the review shows about it. */
function checksFor(c: IdentityCandidate, profile: IdentityProfile): IdentityCheck {
  const reasons: string[] = [];
  if (c.failure) reasons.push(`No page could be read (${c.failure.replace(/_/g, ' ')}).`);
  if (c.publishedName) {
    const from = c.publishedNameFrom ? IDENTITY_NAME_SOURCE_LABELS[c.publishedNameFrom] : 'page';
    reasons.push(
      c.nameMatch >= 0.75
        ? `Names “${c.publishedName}” in the ${from}.`
        : `Publishes “${c.publishedName}” instead, in the ${from}.`,
    );
  } else if (!c.failure) {
    reasons.push('No heading, title or structured data names the business.');
  }
  const town = profile.city.trim();
  if (town && c.describesCity) reasons.push(`Names ${town} on the page.`);
  if (c.category) reasons.push(`Calls itself ${c.category}.`);
  if (c.elsewhereInGhana.length) reasons.push(`Also names ${c.elsewhereInGhana.slice(0, 3).join(', ')}.`);
  if (c.foreign) reasons.push('The page is written for another country.');
  if (!c.failure) reasons.push(`Ownership evidence ${c.ownershipScore}/100.`);
  return {
    site: c.site,
    url: c.url,
    verdict: c.verdict,
    score: c.ownershipScore,
    nameMatch: c.nameMatch,
    publishedName: c.publishedName,
    reasons: reasons.slice(0, 4),
  };
}

function confidenceFor(c: IdentityCandidate, blocked: boolean, corroborated: boolean): ConfidenceBand {
  if (blocked) return 'further_verification';
  if (c.verdict === 'owned' && c.nameMatch >= 0.99 && c.describesCity && c.ownershipScore >= 85 && corroborated) return 'strong';
  if (c.verdict === 'owned' && c.nameMatch >= 0.9 && c.describesCity) return 'high';
  return 'further_verification';
}

const emptyProposal = (profile: IdentityProfile): IdentityProposal => ({
  name: profile.name,
  nameMatch: 0,
  website: null,
  category: null,
  city: null,
  site: '',
  url: '',
  publishedName: null,
  publishedNameFrom: null,
});

const proposalFrom = (c: IdentityCandidate): IdentityProposal => ({
  name: c.publishedName ?? '',
  nameMatch: c.nameMatch,
  website: c.url,
  category: c.category,
  city: c.locality,
  site: c.site,
  url: c.url,
  publishedName: c.publishedName,
  publishedNameFrom: c.publishedNameFrom,
});

/**
 * Reads a stored check. The rules are re-applied here rather than trusted from the search step, so a
 * tampered or outdated record cannot slip a name past acceptance.
 */
export function readPlaceIdentity(evidence: PlaceIdentityEvidence): PlaceIdentityReading {
  const profile = evidence.profile;
  const checks = evidence.candidates.map((c) => checksFor(c, profile));
  const queryCount = evidence.queries.filter((q) => q.ok).length;
  const ranked = [...evidence.candidates].sort((a, b) => rankOf(b) - rankOf(a));
  const best = ranked[0] ?? null;
  const supporters = ranked.filter(supports);
  const namers = ranked.filter(names);
  const concerns: string[] = [];

  const finish = (status: PlaceIdentityStatus, candidate: IdentityCandidate | null, confidence: ConfidenceBand, score: number): PlaceIdentityReading => ({
    status,
    confidence,
    score,
    proposal: candidate ? proposalFrom(candidate) : emptyProposal(profile),
    concerns,
    checks,
    queryCount,
  });

  if (!best || !namers.length) {
    // A site that was read but names something else is worth saying out loud: it may be a namesake.
    for (const c of ranked) {
      if (!c.failure && c.publishedName && c.nameMatch < 0.75) concerns.push(`${c.site} publishes “${c.publishedName}”, not this name.`);
    }
    const failed = ranked.filter((c) => c.failure);
    if (failed.length) concerns.push(`${failed.length} site${failed.length === 1 ? '' : 's'} could not be read.`);
    if (queryCount === 0) concerns.push('No search returned usable results.');
    return finish('not_found', null, 'inconclusive', 0);
  }

  const top = supporters[0] ?? namers[0]!;
  if (supporters.length === 0) {
    // Sites use the name but none of them supports the place on this record.
    concerns.push('Sites use this name, but none of them shows enough ownership evidence to stand for this place.');
    for (const c of namers.slice(0, 3)) concerns.push(`${c.site} scores ${c.ownershipScore}/100 for ownership evidence.`);
    return finish('ambiguous', top, 'inconclusive', rankOf(top));
  }

  if (supporters.length > 1) {
    concerns.push(`${supporters.length} independent sites could be this business.`);
    for (const c of supporters.slice(1, 4)) concerns.push(`${c.site} also publishes “${c.publishedName}”.`);
  }

  if (top.foreign) concerns.push('The site is written for another country, not Ghana.');
  const town = profile.city.trim();
  const otherBranch = Boolean(town) && !top.describesCity && top.elsewhereInGhana.length > 0;
  if (otherBranch) {
    concerns.push(`The site names ${top.elsewhereInGhana.slice(0, 3).join(', ')}, not ${town}: it may be another branch.`);
  }
  if (top.nameMatch < 1) concerns.push(`The site publishes “${top.publishedName}”, which is close to but not the same as the name searched.`);
  if (top.verdict === 'probable') concerns.push('The ownership evidence is partial, so confirm the business before relying on it.');

  const blocked = supporters.length > 1 || top.foreign || otherBranch;
  const status: PlaceIdentityStatus = blocked ? 'ambiguous' : 'identified';
  return finish(status, top, confidenceFor(top, blocked, evidence.corroboration.length > 0), rankOf(top));
}

/** Whether a stored check is still current enough to accept without running it again. */
export function identityIsStale(evidence: PlaceIdentityEvidence, now = new Date()): boolean {
  const at = Date.parse(evidence.checkedAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > PLACE_IDENTITY_MAX_AGE_DAYS * 86_400_000;
}

/** Whether the record changed since the check ran, so the evidence no longer describes it. */
export function profileChanged(then: IdentityProfile, current: IdentityProfile): boolean {
  return (Object.keys(then) as (keyof IdentityProfile)[]).some((key) => (then[key] ?? '') !== (current[key] ?? ''));
}

// ── Applying a reading ───────────────────────────────────────────────────────

/** Categories that say nothing about the business, so a reading may replace them. */
const UNINFORMATIVE_CATEGORIES = new Set(['', 'other', 'unknown', 'not sure', 'n/a']);

/**
 * The fields acceptance would write. A null means "leave what is there": a name, website, category or
 * town someone already recorded is theirs to change, not a reading's.
 */
export interface IdentityPatch {
  name: string;
  officialWebsite: string | null;
  category: string | null;
  city: string | null;
  /** True when the record's name changes, which is the point of identifying a placeholder. */
  renames: boolean;
}

export function identityPatch(profile: IdentityProfile, proposal: IdentityProposal): IdentityPatch {
  const name = proposal.name.trim().slice(0, 200) || profile.name.trim();
  const current = profile.category.trim();
  return {
    name,
    officialWebsite: profile.website.trim() ? null : proposal.url.trim() || null,
    category: proposal.category && UNINFORMATIVE_CATEGORIES.has(current.toLowerCase()) ? proposal.category.trim() : null,
    city: profile.city.trim() ? null : proposal.city?.trim() || null,
    renames: name.toLowerCase() !== profile.name.trim().toLowerCase(),
  };
}

/** The name a placeholder carries, so a reading is never asked to search for it. */
export function looksLikePlaceholderName(name: string): boolean {
  return /^unverified place\b/i.test(name.trim());
}

// ── Acceptance ───────────────────────────────────────────────────────────────

export type IdentityAcceptance = { ok: true; reading: PlaceIdentityReading; patch: IdentityPatch } | { ok: false; reason: string };

/**
 * Whether a stored check may still change the record, and what it would write. Everything is
 * re-derived here: the reading is re-run from the evidence and the patch is rebuilt against the
 * record as it stands now, so a hand-edited payload or an edited profile cannot be applied.
 */
export function acceptanceFor(evidence: PlaceIdentityEvidence, current: IdentityProfile, now = new Date()): IdentityAcceptance {
  if (identityIsStale(evidence, now)) {
    return { ok: false, reason: 'This check is more than a week old. Run it again before accepting it.' };
  }
  if (profileChanged(evidence.profile, current)) {
    return { ok: false, reason: 'This record changed after the check ran. Run the check again so the evidence matches the record.' };
  }
  const reading = readPlaceIdentity(evidence);
  if (reading.status !== 'identified') return { ok: false, reason: PLACE_IDENTITY_STATUS_META[reading.status].description };
  if (!reading.proposal.name.trim() || looksLikePlaceholderName(reading.proposal.name)) {
    return { ok: false, reason: 'The site publishes a reference name rather than a business name.' };
  }
  const patch = identityPatch(current, reading.proposal);
  if (!patch.renames && !patch.officialWebsite && !patch.category && !patch.city) {
    return { ok: false, reason: 'This record already has these details, so nothing would change.' };
  }
  return { ok: true, reading, patch };
}

