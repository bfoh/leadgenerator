// Website verification decisions. The agent gathers evidence (licensed search, DNS, one homepage
// fetch per candidate); this module judges it deterministically: ownership of each candidate, the
// brief's nine classifications, a 0–100 evidence confidence with its factors, and contradictions.
// Confidence bands are internal guidelines, not statistical certainty.

import { z } from 'zod';
import type { Tone, VerificationMethod, VerificationOutcome } from './constants';
import { extractPageFacts, storablePageFacts, type PageFacts } from './page-signals';
import type { SocialProfile, TechnicalCheck, WebsiteVerification } from './types';
import { classifyUrl, domainNameMatch, hostOf, locationSignals, nameCoverage, nameTokens, phoneKey, registrableDomain, siteKey, type ResultKind } from './web-research';

export const WEBSITE_CLASSIFICATIONS = [
  'verified_official_website',
  'probable_official_website',
  'social_only_presence',
  'no_official_website_discovered',
  'broken_or_unavailable_website',
  'outdated_website_potential',
  'identity_uncertain',
  'insufficient_evidence',
  'human_review_required',
] as const;
export type WebsiteClassification = (typeof WEBSITE_CLASSIFICATIONS)[number];

export const CLASSIFICATION_META: Record<WebsiteClassification, { label: string; description: string; tone: Tone }> = {
  verified_official_website: { label: 'Verified official website', description: 'A working site with independent ownership evidence.', tone: 'info' },
  probable_official_website: { label: 'Probable official website', description: 'A likely site whose ownership is not fully confirmed.', tone: 'warning' },
  social_only_presence: { label: 'Social-only presence', description: 'Social or link-in-bio profiles, but no official website discovered.', tone: 'success' },
  no_official_website_discovered: {
    label: 'No official website discovered',
    description: 'None found after a documented multi-source search. Not proof that none exists.',
    tone: 'success',
  },
  broken_or_unavailable_website: { label: 'Broken or unavailable website', description: 'The identified site does not respond, errors, or has lapsed.', tone: 'accent' },
  outdated_website_potential: { label: 'Outdated website (potential)', description: 'A working official site with technical signs of age. Not judged on looks.', tone: 'accent' },
  identity_uncertain: { label: 'Identity uncertain', description: 'Evidence may describe a different business or branch.', tone: 'warning' },
  insufficient_evidence: { label: 'Insufficient evidence', description: 'The checks so far do not support a conclusion.', tone: 'neutral' },
  human_review_required: { label: 'Human review required', description: 'Contradictory evidence needs a person to decide.', tone: 'danger' },
};

export type ConfidenceBand = 'strong' | 'high' | 'further_verification' | 'inconclusive';
export const CONFIDENCE_BAND_META: Record<ConfidenceBand, { label: string; range: string; tone: Tone }> = {
  strong: { label: 'Strong evidence', range: '90–100', tone: 'success' },
  high: { label: 'High confidence', range: '75–89', tone: 'info' },
  further_verification: { label: 'Further verification recommended', range: '50–74', tone: 'warning' },
  inconclusive: { label: 'Inconclusive', range: 'below 50', tone: 'neutral' },
};
export function confidenceBand(score: number): ConfidenceBand {
  return score >= 90 ? 'strong' : score >= 75 ? 'high' : score >= 50 ? 'further_verification' : 'inconclusive';
}

// ── Evidence records ─────────────────────────────────────────────────────────

export const QUERY_PURPOSES = ['exact_name_city', 'name_variation', 'ghana_location', 'official_domain'] as const;
export type QueryPurpose = (typeof QUERY_PURPOSES)[number];
export const QUERY_PURPOSE_LABELS: Record<QueryPurpose, string> = {
  exact_name_city: 'Exact name and city',
  name_variation: 'Name variation',
  ghana_location: 'Ghana location terms',
  official_domain: 'Possible official domain',
};

export interface SearchQueryRecord {
  query: string;
  purpose: QueryPurpose;
  resultCount: number;
  at: string;
  ok: boolean;
  error: string | null;
}

/** A search result held in memory during a run. Never stored (provider terms allow transient use only). */
export interface SearchHit {
  title: string;
  url: string;
  description: string;
}

export type CandidateOrigin = 'recorded_website' | 'search_result' | 'name_derived' | 'linked_from_site';
export const ORIGIN_LABELS: Record<CandidateOrigin, string> = {
  recorded_website: 'Recorded on the profile',
  search_result: 'Search result',
  name_derived: 'Domain derived from the name',
  linked_from_site: 'Linked from the business’s site',
};
export type CandidateVerdict = 'owned' | 'probable' | 'unrelated' | 'parked' | 'unreachable' | 'not_inspected';
export const VERDICT_LABELS: Record<CandidateVerdict, string> = {
  owned: 'Belongs to the business',
  probable: 'Probably the business’s site',
  unrelated: 'Appears unrelated',
  parked: 'Parked or placeholder',
  unreachable: 'Not reachable',
  not_inspected: 'Not inspected',
};
export type FailureKind = 'dns' | 'http_error' | 'temporary' | 'tls' | 'blocked';

export interface OwnershipSignals {
  brandPlaces: string[];
  domainMatch: number;
  city: boolean;
  ghana: boolean;
  otherGhanaPlaces: string[];
  foreign: boolean;
  /** null when the profile has no phone (or email) to compare with. */
  phoneMatch: boolean | null;
  emailDomainMatch: boolean | null;
  linksToDeclaredSocial: boolean | null;
  parked: boolean;
  placeholder: boolean;
}

export interface CandidateCheck {
  site: string;
  url: string;
  origins: CandidateOrigin[];
  dns: 'resolves' | 'no_record' | null;
  robots: 'allowed' | 'disallowed' | 'unavailable' | 'not_checked';
  check: TechnicalCheck | null;
  facts: PageFacts | null;
  signals: OwnershipSignals | null;
  ownershipScore: number;
  verdict: CandidateVerdict;
  failure: FailureKind | null;
}

export interface ResultSummary {
  total: number;
  byKind: Partial<Record<ResultKind, number>>;
  socialPlatforms: string[];
  nameMatched: number;
  nameMatchedInCity: number;
  otherCities: string[];
}

export interface ConfidenceFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface VerificationStep {
  n: number;
  label: string;
  status: 'done' | 'skipped' | 'not_applicable';
  detail: string;
}

export interface WebsiteEvidence {
  schema: 1;
  agentVersion: string;
  startedAt: string;
  finishedAt: string;
  search: { provider: string | null; simulated: boolean; skippedReason: string | null; queries: SearchQueryRecord[]; summary: ResultSummary };
  candidates: CandidateCheck[];
  domainProbes: { domain: string; resolves: boolean }[];
  declaredSocial: string[];
  socialFound: string[];
  contradictions: string[];
  notes: string[];
  factors: ConfidenceFactor[];
  steps: VerificationStep[];
  classification: WebsiteClassification;
  confidenceScore: number;
  band: ConfidenceBand;
  decision: string;
  reviewRequired: boolean;
  reviewReasons: string[];
  failure: { site: string; kind: FailureKind; firstSeenAt: string; persistent: boolean } | null;
}

/** Loose read-side check so older or hand-edited evidence never breaks a page. */
export const websiteEvidenceSchema = z
  .object({
    schema: z.literal(1),
    agentVersion: z.string(),
    classification: z.enum(WEBSITE_CLASSIFICATIONS),
    confidenceScore: z.number().min(0).max(100),
    decision: z.string(),
    search: z.object({ queries: z.array(z.object({ query: z.string(), purpose: z.enum(QUERY_PURPOSES), resultCount: z.number() }).passthrough()) }).passthrough(),
    candidates: z.array(z.object({ site: z.string(), verdict: z.string() }).passthrough()),
    factors: z.array(z.object({ key: z.string(), label: z.string(), points: z.number(), max: z.number(), detail: z.string() })),
    steps: z.array(z.object({ n: z.number(), label: z.string(), status: z.string(), detail: z.string() })),
    contradictions: z.array(z.string()),
  })
  .passthrough();

export function readEvidence(value: unknown): WebsiteEvidence | null {
  return websiteEvidenceSchema.safeParse(value).success ? (value as WebsiteEvidence) : null;
}

// ── Planning ─────────────────────────────────────────────────────────────────

export interface AssessBusiness {
  name: string;
  city: string;
  region: string | null;
  neighborhood: string | null;
  category: string;
  officialWebsite: string | null;
  socialProfiles: SocialProfile[];
  phone: string | null;
  email: string | null;
}

/** Up to three name-based queries; the domain query is added once candidate domains are known. */
export function planQueries(b: AssessBusiness): { query: string; purpose: QueryPurpose }[] {
  const name = b.name.trim().replace(/"/g, '');
  const variation = nameTokens(name).join(' ');
  const place = b.neighborhood?.trim() || b.region?.trim() || '';
  const out: { query: string; purpose: QueryPurpose }[] = [{ query: `"${name}" ${b.city}`, purpose: 'exact_name_city' }];
  out.push(
    variation && variation !== name.toLowerCase()
      ? { query: `${variation} ${b.category} ${b.city}`.slice(0, 200), purpose: 'name_variation' }
      : { query: `${name} ${b.category} ${b.city}`.slice(0, 200), purpose: 'name_variation' },
  );
  out.push({ query: `"${name}" ${place && place.toLowerCase() !== b.city.toLowerCase() ? `${place} ` : ''}Ghana`.slice(0, 200), purpose: 'ghana_location' });
  return out;
}

const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'ymail.com', 'mail.com', 'protonmail.com', 'proton.me']);

export function summarizeHits(hits: SearchHit[], b: AssessBusiness): ResultSummary {
  const byKind: ResultSummary['byKind'] = {};
  const platforms = new Set<string>();
  const otherCities = new Set<string>();
  let nameMatched = 0;
  let nameMatchedInCity = 0;
  const joined = nameTokens(b.name).join('');
  for (const h of hits) {
    const c = classifyUrl(h.url);
    if (!c) continue;
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    const handle = h.url.toLowerCase().replace(/[^a-z0-9]/g, '');
    const named = nameCoverage(b.name, `${h.title} ${h.description}`) >= 0.75 || (joined.length >= 5 && handle.includes(joined));
    if (!named) continue;
    nameMatched++;
    if (c.kind === 'social' || c.kind === 'link_in_bio') platforms.add(c.platform ?? 'other');
    const loc = locationSignals(`${h.title} ${h.description}`, b, c.host);
    if (loc.city) nameMatchedInCity++;
    else loc.otherGhanaPlaces.forEach((p) => otherCities.add(p));
  }
  return { total: hits.length, byKind, socialPlatforms: [...platforms], nameMatched, nameMatchedInCity, otherCities: [...otherCities].slice(0, 5) };
}

/** Candidate sites worth one homepage fetch: results that look like the business's own site. */
export function searchCandidates(hits: SearchHit[], b: AssessBusiness, max = 3): { site: string; url: string }[] {
  const scored = new Map<string, { site: string; url: string; score: number }>();
  for (const h of hits) {
    const c = classifyUrl(h.url);
    if (!c || (c.kind !== 'candidate' && c.kind !== 'builder_site')) continue;
    const site = siteKey(h.url)!;
    const score = domainNameMatch(b.name, c.host) + nameCoverage(b.name, h.title);
    if (score < 0.6) continue;
    const prev = scored.get(site);
    if (!prev || score > prev.score) scored.set(site, { site, url: `https://${c.host}/`, score });
  }
  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

/** Name-matched social and link-in-bio platforms among the results (counts only). */
export function socialPresenceFromHits(hits: SearchHit[], b: AssessBusiness): string[] {
  return summarizeHits(hits, b).socialPlatforms;
}

export function failureKind(check: TechnicalCheck | null): FailureKind | null {
  if (!check || check.ok) return null;
  const e = check.error ?? '';
  if (/does not resolve/i.test(e)) return 'dns';
  if (/private|reserved|cannot be checked|not allowed|Only /i.test(e)) return 'blocked';
  if (/TLS|certificate/i.test(e)) return 'tls';
  if (check.status && check.status >= 400 && check.status < 500) return 'http_error';
  return 'temporary';
}

// ── Ownership of one candidate ───────────────────────────────────────────────

/** Same social profile regardless of scheme, "www."/"m." prefixes, case and trailing slashes. */
function sameProfile(a: string, b: string) {
  const key = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.hostname.replace(/^(www|m)\./, '')}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
    } catch {
      return u.toLowerCase();
    }
  };
  return key(a) === key(b);
}

export function judgeCandidate(c: Omit<CandidateCheck, 'signals' | 'ownershipScore' | 'verdict' | 'failure'>, b: AssessBusiness): CandidateCheck {
  const failure = failureKind(c.check);
  const base = { ...c, failure, facts: c.facts ? storablePageFacts(c.facts) : null };
  if (!c.check) return { ...base, signals: null, ownershipScore: 0, verdict: 'not_inspected' };
  if (!c.check.ok) return { ...base, signals: null, ownershipScore: 0, verdict: 'unreachable' };
  const f = c.facts;
  if (!f) return { ...base, signals: null, ownershipScore: 0, verdict: 'not_inspected' };

  const host = hostOf(c.check.finalUrl ?? c.url) ?? c.site;
  const brandPlaces = [
    nameCoverage(b.name, f.title) >= 0.75 ? 'title' : null,
    nameCoverage(b.name, f.siteName) >= 0.75 ? 'site name' : null,
    f.schemaNames.some((n) => nameCoverage(b.name, n) >= 0.75) ? 'structured data' : null,
    f.h1.some((h) => nameCoverage(b.name, h) >= 0.75) ? 'main heading' : null,
  ].filter((p): p is string => Boolean(p));
  const loc = locationSignals([f.title, f.description, f.siteName, f.schemaLocality, ...f.h1, f.text].filter(Boolean).join(' '), b, host);
  const recordedPhone = phoneKey(b.phone);
  const emailDomain = b.email?.split('@')[1]?.toLowerCase() ?? null;
  const signals: OwnershipSignals = {
    brandPlaces,
    domainMatch: domainNameMatch(b.name, host),
    city: loc.city,
    ghana: loc.ghana,
    otherGhanaPlaces: loc.otherGhanaPlaces,
    foreign: loc.foreign && !loc.ghana,
    phoneMatch: recordedPhone ? (f.phoneKeys ?? []).includes(recordedPhone) : null,
    emailDomainMatch:
      emailDomain && !FREE_MAIL.has(emailDomain) ? registrableDomain(emailDomain) === registrableDomain(host) || (f.emailDomains ?? []).includes(emailDomain) : null,
    linksToDeclaredSocial: b.socialProfiles.length ? f.socialLinks.some((s) => b.socialProfiles.some((p) => sameProfile(s.url, p.url))) : null,
    parked: f.parked,
    placeholder: f.placeholder,
  };

  let score = brandPlaces.length ? 30 + Math.min(10, (brandPlaces.length - 1) * 5) : 0;
  score += signals.domainMatch >= 0.8 ? 15 : signals.domainMatch >= 0.6 ? 8 : 0;
  score += signals.city ? 12 : signals.ghana ? 8 : 0;
  score += signals.phoneMatch ? 20 : 0;
  score += signals.emailDomainMatch ? 10 : 0;
  score += signals.linksToDeclaredSocial ? 15 : 0;
  if (signals.foreign) score -= 40;
  if (signals.otherGhanaPlaces.length && !signals.city) score -= 10;
  const ownershipScore = Math.max(0, Math.min(100, score));

  const branded = brandPlaces.length > 0 || signals.domainMatch >= 0.8;
  const strong = Boolean(signals.phoneMatch || signals.emailDomainMatch || signals.linksToDeclaredSocial || (signals.city && brandPlaces.length > 0));
  const corroborated = strong || signals.ghana;
  const verdict: CandidateVerdict =
    signals.parked || signals.placeholder
      ? 'parked'
      : signals.foreign
        ? 'unrelated'
        : branded && strong && ownershipScore >= 55
          ? 'owned'
          : branded && (corroborated || c.origins.includes('recorded_website'))
            ? 'probable'
            : 'unrelated';
  return { ...base, signals, ownershipScore, verdict };
}

// ── Decision ─────────────────────────────────────────────────────────────────

export interface AssessmentInput {
  business: AssessBusiness;
  agentVersion: string;
  startedAt: string;
  now: Date;
  search: { performed: boolean; provider: string | null; simulated: boolean; skippedReason: string | null; queries: SearchQueryRecord[]; hits: SearchHit[] };
  candidates: CandidateCheck[];
  domainProbes: { domain: string; resolves: boolean }[];
  previous: WebsiteVerification[];
}

export interface Assessment {
  evidence: WebsiteEvidence;
  status: VerificationOutcome;
  websiteOutdated: boolean;
  domain: string | null;
  sourceUrl: string | null;
  methods: VerificationMethod[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
  technical: TechnicalCheck | null;
  nextCheckAt: string | null;
}

const LEGACY_GENERATOR = /frontpage|dreamweaver|joomla!? ?1\.|wordpress [1-4]\.|drupal [4-7]\b|iweb|publisher/i;

function outdatedSignals(c: CandidateCheck, year: number): string[] {
  const out: string[] = [];
  if (c.facts && !c.facts.hasViewport) out.push('no mobile viewport tag');
  if (c.check && !c.check.https) out.push('not served over HTTPS');
  if (c.facts?.copyrightYear && c.facts.copyrightYear <= year - 4) out.push(`copyright notice last updated ${c.facts.copyrightYear}`);
  if (c.facts?.generator && LEGACY_GENERATOR.test(c.facts.generator)) out.push(`built with an old platform version (${c.facts.generator})`);
  return out;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : /(s|x|ch|sh)$/.test(word) ? 'es' : 's'}`;
const addDays = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** The latest person-made (or person-confirmed) verification still in force, for disagreement checks. */
function lastHumanVerdict(previous: WebsiteVerification[], now: Date) {
  const cutoff = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  return previous
    .filter((v) => v.checkedAt >= cutoff && v.reviewStatus !== 'rejected' && ((v.actorType ?? 'user') === 'user' || v.reviewStatus === 'confirmed'))
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
}

function previousFailure(previous: WebsiteVerification[], site: string) {
  for (const v of [...previous].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))) {
    const ev = readEvidence(v.evidence);
    if (ev?.failure?.site === site) return ev.failure.firstSeenAt;
  }
  return null;
}

export function assessWebsite(input: AssessmentInput): Assessment {
  const { business: b, search, candidates, now } = input;
  const year = now.getUTCFullYear();
  const summary = summarizeHits(search.hits, b);
  const socialFound = summary.socialPlatforms;
  const declaredSocial = [...new Set(b.socialProfiles.map((p) => p.platform))];
  const socialPresence = declaredSocial.length > 0 || socialFound.length > 0;
  const recorded = candidates.find((c) => c.origins.includes('recorded_website')) ?? null;
  const rank = (c: CandidateCheck) => c.ownershipScore + (c.origins.includes('recorded_website') ? 5 : 0);
  const owned = candidates.filter((c) => c.verdict === 'owned').sort((a, z) => rank(z) - rank(a));
  const probable = candidates.filter((c) => c.verdict === 'probable').sort((a, z) => rank(z) - rank(a));
  const contradictions: string[] = [];
  const notes: string[] = [];

  // Owned sites that redirect to each other are one site.
  const ownedSites = [...new Set(owned.map((c) => registrableDomain(hostOf(c.check?.finalUrl ?? c.url) ?? c.site)))];
  if (ownedSites.length > 1) contradictions.push(`Different websites each look official: ${ownedSites.slice(0, 3).join(', ')}.`);
  if (recorded?.verdict === 'unrelated') {
    contradictions.push(
      owned.length
        ? `The website recorded on the profile (${recorded.site}) does not appear to belong to this business, but ${owned[0].site} does.`
        : `The website recorded on the profile (${recorded.site}) does not mention this business.`,
    );
  }
  if (recorded && (recorded.verdict === 'unreachable' || recorded.verdict === 'parked') && owned.length && owned[0].site !== recorded.site) {
    notes.push(`The recorded website ${recorded.site} is not working; ${owned[0].site} appears to be the current site.`);
  }
  const identityConcerns: string[] = [];
  if (summary.nameMatched > 0 && summary.nameMatchedInCity === 0 && summary.otherCities.length) {
    identityConcerns.push(`Search results name a “${b.name}” in ${summary.otherCities.map(titleCase).join(', ')}, but none mention ${b.city}.`);
  }
  const best = owned[0] ?? probable[0] ?? null;
  if (best?.signals && best.signals.otherGhanaPlaces.length && !best.signals.city && !best.signals.phoneMatch) {
    identityConcerns.push(`${best.site} mentions ${best.signals.otherGhanaPlaces.map(titleCase).join(', ')} but not ${b.city}; it may be another branch or business.`);
  }
  for (const c of candidates) {
    if (c.verdict === 'unrelated' && c.signals?.brandPlaces.length && c.signals.foreign) notes.push(`${c.site} uses a similar name but describes a business outside Ghana.`);
    if (c.verdict === 'parked') notes.push(`${c.site} is parked or a placeholder page.`);
  }

  // ── Classification ──
  type Family = 'site' | 'broken' | 'absence';
  let classification: WebsiteClassification;
  let family: Family;
  let chosen: CandidateCheck | null = null;
  if (ownedSites.length > 1 || (recorded?.verdict === 'unrelated' && owned.length)) {
    classification = 'human_review_required';
    family = 'site';
    chosen = owned[0];
  } else if (owned.length) {
    chosen = owned[0];
    family = 'site';
    classification = identityConcerns.length ? 'identity_uncertain' : outdatedSignals(chosen, year).length >= 2 ? 'outdated_website_potential' : 'verified_official_website';
  } else if (probable.length) {
    chosen = probable[0];
    family = 'site';
    classification = identityConcerns.length ? 'identity_uncertain' : 'probable_official_website';
  } else if (recorded && (recorded.verdict === 'unreachable' || recorded.verdict === 'parked') && recorded.failure !== 'blocked') {
    chosen = recorded;
    family = 'broken';
    classification = 'broken_or_unavailable_website';
  } else if (recorded?.verdict === 'unrelated') {
    chosen = recorded;
    family = 'site';
    classification = 'human_review_required';
  } else if (recorded?.verdict === 'not_inspected' && recorded.dns === 'resolves' && domainNameMatch(b.name, recorded.site) >= 0.8) {
    chosen = recorded;
    family = 'site';
    classification = 'probable_official_website';
    notes.push(`${recorded.site} resolves and spells the business name, but robots.txt does not allow automated inspection.`);
  } else {
    family = 'absence';
    classification = !search.performed
      ? 'insufficient_evidence'
      : identityConcerns.length
        ? 'identity_uncertain'
        : socialPresence
          ? 'social_only_presence'
          : 'no_official_website_discovered';
  }
  if (classification === 'identity_uncertain') notes.push(...identityConcerns);
  else contradictions.push(...identityConcerns);

  // ── Failure persistence (temporary outage vs lapsed site) ──
  let failure: WebsiteEvidence['failure'] = null;
  if (family === 'broken' && chosen) {
    const kind: FailureKind = chosen.verdict === 'parked' ? 'dns' : (chosen.failure ?? 'temporary');
    const earlier = previousFailure(input.previous, chosen.site);
    const persistent = Boolean(earlier && now.getTime() - new Date(earlier).getTime() >= 20 * 3_600_000);
    failure = { site: chosen.site, kind, firstSeenAt: earlier ?? now.toISOString(), persistent };
  }

  // ── Confidence ──
  const okQueries = search.queries.filter((q) => q.ok);
  const did = (p: QueryPurpose) => okQueries.some((q) => q.purpose === p);
  const probesDone = input.domainProbes.length > 0;
  const fetched = candidates.filter((c) => c.check).length;
  const factors: ConfidenceFactor[] = [];
  const factor = (key: string, label: string, points: number, max: number, detail: string) => factors.push({ key, label, points: Math.round(points), max, detail });

  if (family === 'site' && chosen) {
    const s = chosen.signals;
    const sources = chosen.origins.length + (s?.brandPlaces.length ? 1 : 0);
    factor('agreement', 'Independent source agreement', sources >= 3 ? 20 : sources === 2 ? 15 : sources === 1 ? 8 : 0, 20,
      `${chosen.origins.map((o) => ORIGIN_LABELS[o].toLowerCase()).join(', ')}${s?.brandPlaces.length ? ', and the site names the business itself' : ''}.`);
    const dm = s?.domainMatch ?? domainNameMatch(b.name, chosen.site);
    factor('ownership', 'Domain ownership indicators', (dm >= 0.8 ? 10 : dm >= 0.6 ? 5 : 0) + (s?.city ? 10 : s?.ghana ? 5 : 0), 20,
      [dm >= 0.6 ? `domain ${dm >= 0.8 ? 'spells' : 'resembles'} the name` : 'domain does not spell the name', s?.city ? `site mentions ${b.city}` : s?.ghana ? 'site mentions Ghana' : 'no Ghana location on the page'].join('; ') + '.');
    factor('contact', 'Contact consistency', (s?.phoneMatch ? 15 : 0) + (s?.emailDomainMatch ? 5 : 0), 20,
      s?.phoneMatch == null && s?.emailDomainMatch == null
        ? 'No recorded phone or business email to compare.'
        : [s?.phoneMatch ? 'recorded phone appears on the site' : s?.phoneMatch === false ? 'recorded phone not on the homepage' : null, s?.emailDomainMatch ? 'email domain matches' : null].filter(Boolean).join('; ') + '.');
    factor('branding', 'Website branding', s?.brandPlaces.length ? (s.brandPlaces.length >= 2 ? 15 : 10) : 0, 15,
      s?.brandPlaces.length ? `Business name in the ${s.brandPlaces.join(', ')}.` : 'The page does not show the business name.');
    factor('links', 'Verified business links', s?.linksToDeclaredSocial ? 10 : 0, 10,
      s?.linksToDeclaredSocial == null ? 'No social profiles recorded to compare.' : s.linksToDeclaredSocial ? 'Links to a social profile recorded for this business.' : 'Does not link to the recorded social profiles.');
    const recent = chosen.facts?.copyrightYear && chosen.facts.copyrightYear >= year - 2;
    factor('recency', 'Recency', (chosen.check ? 3 : 0) + (recent ? 2 : 0), 5, `Checked ${now.toISOString().slice(0, 10)}${chosen.facts?.copyrightYear ? `; copyright ${chosen.facts.copyrightYear}` : ''}.`);
    factor('completeness', 'Research completeness', (search.performed ? 6 : 0) + (probesDone ? 2 : 0) + (fetched ? 2 : 0), 10,
      `${search.performed ? plural(okQueries.length, 'search') : 'no web search'}, ${plural(input.domainProbes.length, 'domain probe')}, ${plural(fetched, 'site check')}.`);
  } else if (family === 'broken' && chosen && failure) {
    const base = { dns: 50, http_error: 50, temporary: 35, tls: 45, blocked: 0 }[failure.kind];
    factor('failure', 'Observed failure', base, 50, `${chosen.verdict === 'parked' ? 'Parked or placeholder page' : (chosen.check?.error ?? 'No response')} at ${chosen.site}.`);
    factor('persistence', 'Repeated observation', failure.persistent ? 25 : 0, 25,
      failure.persistent ? `Also failing since ${failure.firstSeenAt.slice(0, 10)}.` : 'First observation; a temporary outage is possible.');
    factor('agreement', 'Independent source agreement', chosen.origins.includes('recorded_website') ? 10 : 5, 10, `${chosen.origins.map((o) => ORIGIN_LABELS[o]).join(', ')}.`);
    factor('completeness', 'Research completeness', search.performed && !owned.length ? 10 : 0, 10, search.performed ? 'Search found no other working site.' : 'No web search, so another site may exist.');
    factor('ownership', 'Domain ownership indicators', domainNameMatch(b.name, chosen.site) >= 0.8 ? 5 : 0, 5, `Domain ${domainNameMatch(b.name, chosen.site) >= 0.8 ? 'spells' : 'does not spell'} the business name.`);
  } else {
    factor('completeness', 'Research completeness', (did('exact_name_city') ? 10 : 0) + (did('name_variation') ? 6 : 0) + (did('ghana_location') ? 6 : 0) + (probesDone ? 8 : 0) + 5, 35,
      `${search.performed ? `${plural(okQueries.length, 'search')} (${[...new Set(okQueries.map((q) => QUERY_PURPOSE_LABELS[q.purpose].toLowerCase()))].join(', ')})` : `no web search (${search.skippedReason ?? 'not configured'})`}; ${plural(input.domainProbes.length, 'candidate domain')} probed; ${recorded ? 'recorded website checked' : 'no website recorded on the profile'}.`);
    const derivedOk = input.domainProbes.length > 0 && candidates.filter((c) => c.origins.includes('name_derived')).every((c) => c.verdict !== 'owned' && c.verdict !== 'probable');
    factor('agreement', 'Independent source agreement', (search.performed ? 10 : 0) + (derivedOk ? 10 : 0) + (socialPresence ? 5 : 0), 25,
      [search.performed ? 'no search result looked like an official site' : null, derivedOk ? 'name-based domains are unregistered or unrelated' : null, socialPresence ? `the business is present on ${[...new Set([...declaredSocial, ...socialFound])].join(', ')}` : null].filter(Boolean).join('; ') + '.');
    factor('coverage', 'Search coverage', summary.nameMatched > 0 ? 20 : 0, 20,
      !search.performed ? 'Not searched.' : summary.nameMatched > 0 ? `${plural(summary.nameMatched, 'result')} named the business, so search can find it.` : 'No result named the business; it may trade under another name.');
    factor('recency', 'Recency', 10, 10, `Checked ${now.toISOString().slice(0, 10)}.`);
  }
  const penalty = Math.min(30, contradictions.length * 15);
  if (contradictions.length) factor('contradictions', 'Contradictory findings', -penalty, 0, contradictions.join(' '));
  let score = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));

  // ── Guards on the conclusion ──
  const negativeChecks = (search.performed && okQueries.length >= 2 ? 1 : 0) + (probesDone ? 1 : 0);
  if ((classification === 'no_official_website_discovered' || classification === 'social_only_presence') && (negativeChecks < 2 || score < 50)) {
    notes.push(negativeChecks < 2 ? 'An absence conclusion needs both web searches and domain checks.' : 'Absence checks were not conclusive.');
    classification = 'insufficient_evidence';
  }
  if (classification === 'verified_official_website' && score < 75) classification = 'probable_official_website';
  if (classification === 'probable_official_website' && score < 50) {
    notes.push(`A possible site (${chosen?.site}) was found, but the evidence is weak.`);
    classification = 'insufficient_evidence';
  }
  if (classification === 'insufficient_evidence') score = Math.min(score, 49);

  // ── Disagreement with a person's verification ──
  const status = statusFor(classification, failure?.kind ?? null);
  const human = lastHumanVerdict(input.previous, now);
  if (human && human.status !== status) {
    contradictions.push(`Differs from the verification recorded by ${human.reviewerName ?? 'a team member'} on ${human.checkedAt.slice(0, 10)}.`);
  }

  const band = confidenceBand(score);
  const reviewReasons = [
    band === 'further_verification' || band === 'inconclusive' ? `${CONFIDENCE_BAND_META[band].label} (${score}/100).` : null,
    classification === 'identity_uncertain' || classification === 'human_review_required' ? CLASSIFICATION_META[classification].description : null,
    classification === 'outdated_website_potential' ? 'Confirm the site is outdated before relying on it.' : null,
    failure && !failure.persistent ? 'Possibly a temporary outage; re-check scheduled.' : null,
    human && human.status !== status ? 'The result differs from a person’s earlier verification.' : null,
  ].filter((r): r is string => Boolean(r));

  const site = chosen ? (chosen.check?.finalUrl ?? chosen.url) : null;
  const outdated = classification === 'outdated_website_potential' && chosen ? outdatedSignals(chosen, year) : [];
  const decision =
    classification === 'verified_official_website'
      ? `Official website: ${chosen!.site}`
      : classification === 'outdated_website_potential'
        ? `Official website ${chosen!.site} may be outdated: ${outdated.join(', ')}`
        : classification === 'probable_official_website'
          ? `Probably ${chosen!.site}; ownership not fully confirmed`
          : classification === 'broken_or_unavailable_website'
            ? `${chosen!.site} is not working (${failure?.persistent ? 'repeatedly' : 'first observation'})`
            : classification === 'social_only_presence'
              ? 'No official website discovered; the business uses social profiles'
              : classification === 'no_official_website_discovered'
                ? 'No official website discovered after a documented multi-source search'
                : classification === 'identity_uncertain'
                  ? 'Identity uncertain — confirm which business the evidence describes'
                  : classification === 'human_review_required'
                    ? 'Contradictory evidence — a person should decide'
                    : 'Not enough evidence for a conclusion';

  const steps = buildSteps({ search, summary, candidates, declaredSocial, socialFound, probes: input.domainProbes, contradictions, score, band, chosen });
  const evidence: WebsiteEvidence = {
    schema: 1,
    agentVersion: input.agentVersion,
    startedAt: input.startedAt,
    finishedAt: now.toISOString(),
    search: { provider: search.provider, simulated: search.simulated, skippedReason: search.skippedReason, queries: search.queries, summary },
    candidates,
    domainProbes: input.domainProbes,
    declaredSocial,
    socialFound,
    contradictions,
    notes: [...new Set(notes)],
    factors,
    steps,
    classification,
    confidenceScore: score,
    band,
    decision,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    failure,
  };

  const methods = new Set<VerificationMethod>();
  if (did('exact_name_city')) methods.add('exact_name_search');
  if (did('name_variation') || did('ghana_location') || did('official_domain')) methods.add('name_variation_search');
  if (probesDone) methods.add('domain_probe');
  if (fetched) methods.add('http_check');
  if (candidates.some((c) => c.check?.redirects.length)) methods.add('redirect_check');
  if (candidates.some((c) => c.check?.ok)) methods.add('technical_health');
  if (!methods.size) methods.add('domain_probe');

  const chosenSite = chosen && (status === 'verified_official' || status === 'potential_official' || status === 'unavailable' || status === 'unhealthy' || status === 'insufficient_evidence') ? site : null;
  return {
    evidence,
    status,
    websiteOutdated: classification === 'outdated_website_potential',
    domain: chosenSite,
    sourceUrl: chosen?.check?.ok ? site : null,
    methods: [...methods],
    confidence: score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low',
    summary: summaryText(evidence, b),
    technical: chosen?.check ?? null,
    nextCheckAt: failure && !failure.persistent ? addDays(now, 3) : classification === 'insufficient_evidence' || reviewReasons.length ? null : addDays(now, 180),
  };
}

function statusFor(c: WebsiteClassification, failure: FailureKind | null): VerificationOutcome {
  switch (c) {
    case 'verified_official_website':
    case 'outdated_website_potential':
      return 'verified_official';
    case 'probable_official_website':
      return 'potential_official';
    case 'social_only_presence':
    case 'no_official_website_discovered':
      return 'none_found';
    case 'broken_or_unavailable_website':
      return failure === 'http_error' || failure === 'tls' ? 'unhealthy' : 'unavailable';
    default:
      return 'insufficient_evidence';
  }
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (m) => m.toUpperCase());

function buildSteps(x: {
  search: AssessmentInput['search'];
  summary: ResultSummary;
  candidates: CandidateCheck[];
  declaredSocial: string[];
  socialFound: string[];
  probes: { domain: string; resolves: boolean }[];
  contradictions: string[];
  score: number;
  band: ConfidenceBand;
  chosen: CandidateCheck | null;
}): VerificationStep[] {
  const q = (p: QueryPurpose) => x.search.queries.find((r) => r.purpose === p);
  const searchStep = (n: number, label: string, p: QueryPurpose): VerificationStep => {
    const r = q(p);
    if (!x.search.performed) return { n, label, status: 'skipped', detail: x.search.skippedReason ?? 'Web search not configured.' };
    if (!r) return { n, label, status: 'not_applicable', detail: p === 'official_domain' ? 'No resolving candidate domain to search for.' : 'Not needed.' };
    return { n, label, status: r.ok ? 'done' : 'skipped', detail: r.ok ? `${r.query} → ${plural(r.resultCount, 'result')}` : `${r.query} — ${r.error ?? 'failed'}` };
  };
  const fetched = x.candidates.filter((c) => c.check);
  const resolving = x.probes.filter((p) => p.resolves);
  const outbound = x.candidates.flatMap((c) => (c.verdict === 'owned' || c.verdict === 'probable' ? (c.facts?.outboundSites ?? []) : []));
  const kinds = Object.entries(x.summary.byKind).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`);
  return [
    searchStep(1, 'Search the exact name and city', 'exact_name_city'),
    searchStep(2, 'Search name variations', 'name_variation'),
    searchStep(3, 'Search with Ghana location terms', 'ghana_location'),
    searchStep(4, 'Search for a possible official domain', 'official_domain'),
    x.search.performed
      ? { n: 5, label: 'Inspect result URLs and snippets', status: 'done', detail: x.summary.total ? `${kinds.join(', ')}; ${plural(x.summary.nameMatched, 'result')} named the business. Results are not stored.` : 'No results returned.' }
      : { n: 5, label: 'Inspect result URLs and snippets', status: 'skipped', detail: 'No search results.' },
    x.declaredSocial.length
      ? { n: 6, label: 'Check business-declared social links', status: 'done', detail: `Recorded on the profile: ${x.declaredSocial.join(', ')}. Profiles are not fetched.` }
      : { n: 6, label: 'Check business-declared social links', status: 'not_applicable', detail: 'No social profiles recorded.' },
    fetched.some((c) => c.verdict === 'owned' || c.verdict === 'probable')
      ? { n: 7, label: 'Check known websites for linked domains', status: 'done', detail: outbound.length ? `Links to ${[...new Set(outbound)].slice(0, 5).join(', ')}.` : 'No other business domains linked.' }
      : { n: 7, label: 'Check known websites for linked domains', status: 'not_applicable', detail: 'No business website identified.' },
    fetched.length
      ? { n: 8, label: 'Inspect candidate websites for ownership signals', status: 'done', detail: fetched.map((c) => `${c.site}: ${VERDICT_LABELS[c.verdict].toLowerCase()}`).join('; ') }
      : { n: 8, label: 'Inspect candidate websites for ownership signals', status: 'not_applicable', detail: 'No candidate websites to inspect.' },
    x.probes.length
      ? { n: 9, label: 'Check whether candidate domains resolve', status: 'done', detail: `${plural(x.probes.length, 'domain')} probed; ${resolving.length ? `${resolving.map((p) => p.domain).join(', ')} resolve` : 'none resolve'}.` }
      : { n: 9, label: 'Check whether candidate domains resolve', status: 'skipped', detail: 'No domains could be derived from the name.' },
    {
      n: 10,
      label: 'Determine whether a working website exists',
      status: 'done',
      detail: fetched.some((c) => c.check?.ok && (c.verdict === 'owned' || c.verdict === 'probable')) ? `Working site: ${x.chosen?.site}.` : 'No working website belonging to the business was found.',
    },
    {
      n: 11,
      label: 'Identify link-in-bio pages or social-only presence',
      status: 'done',
      detail: x.socialFound.length || x.declaredSocial.length ? `Present on ${[...new Set([...x.declaredSocial, ...x.socialFound])].join(', ')}.` : 'No social or link-in-bio presence identified.',
    },
    { n: 12, label: 'Evaluate contradictory results', status: 'done', detail: x.contradictions.length ? x.contradictions.join(' ') : 'No contradictions found.' },
    { n: 13, label: 'Produce a confidence assessment', status: 'done', detail: `${x.score}/100 — ${CONFIDENCE_BAND_META[x.band].label}.` },
  ];
}

function summaryText(e: WebsiteEvidence, b: AssessBusiness) {
  const parts = [`Automated verification (${e.agentVersion}): ${e.decision}.`];
  if (e.classification === 'no_official_website_discovered' || e.classification === 'social_only_presence') {
    parts.push(`No official website was discovered for ${b.name} after a documented multi-source search. This is not proof that none exists.`);
  }
  parts.push(
    e.search.provider
      ? `${plural(e.search.queries.filter((q) => q.ok).length, 'search')} via ${e.search.provider}${e.search.simulated ? ' (simulated)' : ''}: ${plural(e.search.summary.total, 'result')}, ${e.search.summary.nameMatched} naming the business.`
      : `No web search: ${e.search.skippedReason ?? 'not configured'}.`,
  );
  const checked = e.candidates.filter((c) => c.check);
  if (checked.length) parts.push(`Checked ${checked.map((c) => `${c.site} (${VERDICT_LABELS[c.verdict].toLowerCase()})`).join(', ')}.`);
  if (e.domainProbes.length) parts.push(`${plural(e.domainProbes.length, 'name-based domain')} probed, ${e.domainProbes.filter((p) => p.resolves).length} resolving.`);
  if (e.contradictions.length) parts.push(`Contradictions: ${e.contradictions.join(' ')}`);
  parts.push(`Evidence confidence ${e.confidenceScore}/100 (${CONFIDENCE_BAND_META[e.band].label}).`);
  return parts.join(' ').slice(0, 4000);
}

/** Convenience for tests and the simulated provider: a candidate built from raw HTML. */
export function candidateFromHtml(site: string, url: string, origins: CandidateOrigin[], html: string, check: TechnicalCheck, b: AssessBusiness) {
  return judgeCandidate({ site, url, origins, dns: 'resolves', robots: 'allowed', check, facts: extractPageFacts(html, check.finalUrl ?? url) }, b);
}
