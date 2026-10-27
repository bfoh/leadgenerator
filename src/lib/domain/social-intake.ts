// Bulk social intake. The search result is transient review material; a profile link is retained only
// with a lawful basis independent of the search response. This module decides, per selected result,
// whether it may become an unverified research candidate — and records why it may not.

import { findDuplicates, normalizeName } from './dedupe';
import {
  SOCIAL_DISCOVERY_LABELS,
  cleanSocialDisplayName,
  parseSocialProfileUrl,
  type SocialCandidate,
  type SocialDiscoveryPlatform,
} from './social-discovery';
import {
  SOCIAL_RETENTION_BASIS_LABELS,
  evidenceForBasis,
  provenanceForBasis,
  verificationStatusForBasis,
  type BusinessSocialSource,
  type SocialRetentionBasis,
  type SocialSourceInsert,
} from './social-research';
import type { Business } from './types';

export const SOCIAL_INTAKE_LIMIT = 20;

export const SOCIAL_INTAKE_OUTCOMES = ['added', 'already_exists', 'needs_permitted_source', 'needs_review', 'not_eligible'] as const;
export type SocialIntakeOutcome = (typeof SOCIAL_INTAKE_OUTCOMES)[number];

export const SOCIAL_INTAKE_LABELS: Record<SocialIntakeOutcome, string> = {
  added: 'Added',
  already_exists: 'Already exists',
  needs_permitted_source: 'Needs permitted source',
  needs_review: 'Needs review',
  not_eligible: 'Not eligible',
};

export interface SocialIntakeContext {
  /** Null means the person has not stated why the profile link may be retained. */
  basis: SocialRetentionBasis | null;
  existingBusinesses: Business[];
  existingSources: BusinessSocialSource[];
}

export interface SocialIntakeAssessment {
  outcome: SocialIntakeOutcome;
  /** Plain-language reason shown beside the result. Never provider copy. */
  reason: string;
  platform: SocialDiscoveryPlatform | null;
  handle: string;
  profileUrl: string;
  businessName: string;
  businessId: string | null;
  /** The basis actually applied. A simulated profile is fictional practice data. */
  basis: SocialRetentionBasis | null;
}

const bareHandle = (value: string) => value.replace(/^@/, '').toLowerCase();

/** A readable trading name from the canonical handle. Search-result titles are never used here. */
export function nameFromHandle(handle: string): string {
  const words = handle
    .replace(/^@/, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Unnamed social profile';
  return words.replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 200);
}

/**
 * The name a newly captured prospect receives. Simulated candidates are explicitly fictional, so
 * their labelled demo name is used; a live capture uses the handle, because the search title is
 * provider material that may not be stored.
 */
export function intakeBusinessName(candidate: SocialCandidate): string {
  if (candidate.simulated) return cleanSocialDisplayName(candidate.displayName) || nameFromHandle(candidate.handle);
  return nameFromHandle(candidate.handle);
}

export function profileKey(platform: string, handle: string): string {
  return `${platform}:${bareHandle(handle)}`;
}

/**
 * Profile URLs already recorded anywhere in the CRM, whether in the social source ledger or the
 * prospect's own profile list. Comparison is by platform + normalized handle, so query strings,
 * `www.`, trailing slashes and a leading `@` cannot defeat it.
 */
export function recordedProfileKeys(businesses: readonly Business[], sources: readonly BusinessSocialSource[]): Map<string, Business> {
  const keys = new Map<string, Business>();
  for (const source of sources) {
    if (source.revokedAt) continue;
    const business = businesses.find((b) => b.id === source.businessId);
    if (business) keys.set(profileKey(source.platform, source.handle), business);
  }
  for (const business of businesses) {
    for (const profile of business.socialProfiles) {
      const parsed = parseSocialProfileUrl(profile.url);
      if (parsed) keys.set(profileKey(parsed.platform, parsed.handle), business);
      else if (profile.platform === 'instagram' || profile.platform === 'facebook' || profile.platform === 'tiktok') {
        keys.set(profileKey(profile.platform, profile.url.split('/').filter(Boolean).pop() ?? ''), business);
      }
    }
  }
  return keys;
}

/**
 * Decides one candidate's outcome. The order matters: an existing record is reported before a
 * missing basis, so a retry never looks like a new lead.
 */
export function assessSocialIntake(candidate: SocialCandidate, ctx: SocialIntakeContext): SocialIntakeAssessment {
  const parsed = parseSocialProfileUrl(candidate.profileUrl);
  const fallbackName = intakeBusinessName(candidate);
  const base = {
    platform: parsed?.platform ?? null,
    handle: parsed ? bareHandle(parsed.handle) : bareHandle(candidate.handle),
    profileUrl: parsed?.profileUrl ?? candidate.profileUrl,
    businessName: fallbackName,
    businessId: null,
    basis: null,
  };

  if (!parsed || parsed.platform !== candidate.platform) {
    return { ...base, outcome: 'not_eligible', reason: 'This is not a public profile URL on its own platform.' };
  }
  if (candidate.verification === 'wrong_business') {
    return { ...base, outcome: 'not_eligible', reason: 'The search evidence suggests this profile belongs to a different business.' };
  }

  const recorded = recordedProfileKeys(ctx.existingBusinesses, ctx.existingSources).get(profileKey(parsed.platform, parsed.handle));
  if (recorded) {
    return {
      ...base,
      businessName: recorded.name || fallbackName,
      businessId: recorded.id,
      outcome: 'already_exists',
      reason: recorded.name ? `Already linked to “${recorded.name}”. Existing prospects are never merged automatically.` : 'This profile is already recorded.',
    };
  }

  if (candidate.duplicateOf || candidate.verification === 'possible_duplicate') {
    return { ...base, outcome: 'needs_review', reason: 'Another result looks like the same account. Confirm which profile is official.' };
  }

  const duplicates = findDuplicates({ name: fallbackName, city: candidate.location.city ?? '' }, ctx.existingBusinesses).filter(
    (match) => match.strength === 'exact' || match.strength === 'likely',
  );
  const sameName = ctx.existingBusinesses.find(
    (business) =>
      normalizeName(business.name) === normalizeName(fallbackName) &&
      Boolean(candidate.location.region || candidate.location.city) &&
      business.region === candidate.location.region,
  );
  const possible = duplicates[0]?.record ?? sameName;
  if (possible) {
    return {
      ...base,
      businessId: possible.id,
      businessName: possible.name,
      outcome: 'needs_review',
      reason: `Possible existing prospect “${possible.name}”. Check the record before adding another.`,
    };
  }

  const basis = candidate.simulated ? (ctx.basis ?? 'first_party_observation') : ctx.basis;
  if (!basis) {
    return {
      ...base,
      outcome: 'needs_permitted_source',
      reason: 'Choose a lawful retention basis first. An ordinary search result does not permit keeping the profile, its title or its snippet.',
    };
  }
  return { ...base, basis, outcome: 'added', reason: 'Eligible as an unverified research candidate.' };
}

/** The stored source payload. It deliberately has no field for a title, snippet or ranking. */
export function socialSourceForIntake(
  candidate: SocialCandidate,
  basis: SocialRetentionBasis,
  businessId: string,
  capturedBy: string,
  at = new Date(),
): SocialSourceInsert {
  const parsed = parseSocialProfileUrl(candidate.profileUrl);
  if (!parsed) throw new Error('A social source needs a canonical profile URL.');
  return {
    businessId,
    platform: parsed.platform,
    handle: bareHandle(parsed.handle),
    profileUrl: parsed.profileUrl,
    provenance: provenanceForBasis(basis),
    retentionBasis: basis,
    verificationStatus: verificationStatusForBasis(basis),
    verificationEvidence: evidenceForBasis(basis, capturedBy, at),
  };
}

/** Notes for the prospect record. No provider copy, no invented address or operating status. */
export function intakeNotes(candidate: SocialCandidate, basis: SocialRetentionBasis, capturedBy: string, at = new Date()): string {
  const when = at.toISOString().slice(0, 10);
  if (candidate.simulated) {
    return `Fictional ${SOCIAL_DISCOVERY_LABELS[candidate.platform]} demo profile captured for workflow practice. This business does not exist; do not contact it.`;
  }
  return [
    `Unverified research candidate captured from a public ${SOCIAL_DISCOVERY_LABELS[candidate.platform]} profile.`,
    `Retention basis: ${SOCIAL_RETENTION_BASIS_LABELS[basis]}. Captured by ${capturedBy} on ${when}.`,
    'No website, Google listing, address, operating status or contact permission is confirmed.',
    'The profile URL is kept as a reference only; no search-result title, snippet or ranking was stored.',
  ].join(' ');
}

export interface SocialIntakeSummary {
  added: number;
  already_exists: number;
  needs_permitted_source: number;
  needs_review: number;
  not_eligible: number;
  total: number;
}

export function summarizeIntake(results: readonly Pick<SocialIntakeAssessment, 'outcome'>[]): SocialIntakeSummary {
  const summary: SocialIntakeSummary = { added: 0, already_exists: 0, needs_permitted_source: 0, needs_review: 0, not_eligible: 0, total: results.length };
  for (const result of results) summary[result.outcome] += 1;
  return summary;
}
