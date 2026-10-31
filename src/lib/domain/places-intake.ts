// Bulk Google Places intake. A Places result is transient review material: the only value that may
// be written to the CRM is the Place ID (plus the location the person searched and their own
// category). This module decides, per selected result, whether it may become an unverified
// reference — and records why it may not. It never returns the listing name, address, phone,
// reviews or photos for storage.

import { findDuplicates, normalizeName } from './dedupe';
import { profileKey } from './social-intake';
import { parseSocialProfileUrl } from './social-discovery';
import type { BusinessForm } from './schemas';
import type { Business } from './types';

export const PLACES_INTAKE_LIMIT = 20;

export const PLACES_INTAKE_OUTCOMES = ['added', 'already_exists', 'needs_review', 'needs_permitted_source', 'failed'] as const;
export type PlacesIntakeOutcome = (typeof PLACES_INTAKE_OUTCOMES)[number];

export const PLACES_INTAKE_LABELS: Record<PlacesIntakeOutcome, string> = {
  added: 'Added',
  already_exists: 'Already exists',
  needs_review: 'Needs review',
  needs_permitted_source: 'Needs permitted source',
  failed: 'Failed',
};

/** The transient shape the result list holds. `DiscoveryResult` satisfies it structurally. */
export interface PlacesCandidate {
  /** Google's Place ID, the only Places value that may persist. */
  externalId: string;
  /** Google listing name: shown in review, never stored for a live result. */
  name: string;
  websiteUri: string | null;
  isDemo: boolean;
}

export interface PlacesSearchContext {
  category: string;
  country: string;
  region: string | null;
  city: string | null;
  neighborhood: string | null;
}

export interface PlacesIntakeContext {
  existingBusinesses: Business[];
  /** The location the person searched: the only location a reference may record. */
  search: Pick<PlacesSearchContext, 'region' | 'city'>;
}

export interface PlacesIntakeAssessment {
  outcome: PlacesIntakeOutcome;
  /** Plain-language reason shown beside the result. Never listing copy. */
  reason: string;
  placeId: string;
  /** Held for this session only, so the person can recognise the row they selected. */
  listingName: string;
  businessId: string | null;
  businessName: string | null;
  isDemo: boolean;
}

/** A Place ID is an opaque identifier: `ChIJ…` in the legacy form, optionally prefixed `places/`. */
export function normalizePlaceId(raw: string): string | null {
  const trimmed = (raw ?? '').trim().replace(/^places\//i, '');
  return /^[A-Za-z0-9_-]{10,300}$/.test(trimmed) ? trimmed : null;
}

export function isValidPlaceId(raw: string): boolean {
  return normalizePlaceId(raw) !== null;
}

/**
 * The name a live reference receives. It is generated from the Place ID, because Google's listing
 * name is content the terms do not allow storing, and it stays recognisable when several
 * references sit side by side.
 */
export function placeReferenceName(placeId: string): string {
  const tail = placeId.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return `Unverified place ${tail || 'reference'}`;
}

/** Simulated practice results are labelled fictional data, so their demo name may be kept. */
export function placesIntakeName(candidate: PlacesCandidate): string {
  const placeId = normalizePlaceId(candidate.externalId) ?? candidate.externalId;
  if (candidate.isDemo) {
    const demo = candidate.name.trim().slice(0, 200);
    return demo || placeReferenceName(placeId);
  }
  return placeReferenceName(placeId);
}

/**
 * The social profile a Places result points at, when its listed website is a profile page. Used only
 * for cross-provider duplicate detection: the URL itself is never stored from the Places response.
 */
export function listedProfileKey(candidate: PlacesCandidate): string | null {
  const parsed = candidate.websiteUri ? parseSocialProfileUrl(candidate.websiteUri) : null;
  return parsed ? profileKey(parsed.platform, parsed.handle) : null;
}

/**
 * Decides one result's outcome. The order matters: an existing record is reported before a missing
 * location, so a retry never looks like a new lead.
 */
export function assessPlacesIntake(candidate: PlacesCandidate, ctx: PlacesIntakeContext): PlacesIntakeAssessment {
  const placeId = normalizePlaceId(candidate.externalId);
  const base = { placeId: placeId ?? candidate.externalId, listingName: candidate.name, businessId: null, businessName: null, isDemo: candidate.isDemo };

  if (!placeId) {
    return { ...base, outcome: 'failed', reason: 'Google returned no usable Place ID for this result, so there is nothing this workspace may keep.' };
  }

  const recorded = candidate.isDemo ? undefined : ctx.existingBusinesses.find((business) => business.placesPlaceId === placeId);
  if (recorded) {
    return {
      ...base,
      businessId: recorded.id,
      businessName: recorded.name,
      outcome: 'already_exists',
      reason: `Already in the CRM as “${recorded.name}”. Place IDs are compared, so running the batch again never creates a second record.`,
    };
  }

  const name = placesIntakeName(candidate);
  const matches = findDuplicates({ name, city: ctx.search.city ?? '' }, ctx.existingBusinesses).filter(
    (match) => match.strength === 'exact' || match.strength === 'likely',
  );
  const sameName = ctx.existingBusinesses.find(
    (business) => normalizeName(business.name) === normalizeName(name) && Boolean(ctx.search.region) && business.region === ctx.search.region,
  );
  const possible = matches[0]?.record ?? sameName;

  // Simulated practice results are deterministic: the same fictional row always means the same record.
  if (possible && candidate.isDemo) {
    return {
      ...base,
      businessId: possible.id,
      businessName: possible.name,
      outcome: 'already_exists',
      reason: `This fictional practice result is already in the CRM as “${possible.name}”.`,
    };
  }
  if (possible) {
    return {
      ...base,
      businessId: possible.id,
      businessName: possible.name,
      outcome: 'needs_review',
      reason: `Possible existing prospect “${possible.name}”. Check the record before adding another Place ID reference.`,
    };
  }

  if (!ctx.search.region && !ctx.search.city) {
    return {
      ...base,
      outcome: 'needs_permitted_source',
      reason:
        'This search recorded no region or town, and the only location available is Google’s listing address, which cannot be stored. Choose a region or a town and search again.',
    };
  }

  return {
    ...base,
    businessName: name,
    outcome: 'added',
    reason: 'Saved as a Place ID reference: only the ID, the location you searched and your own category are kept.',
  };
}

/**
 * The stored record for a Place ID reference. It deliberately has no field carrying a listing name,
 * address, phone, opening status or Google URL.
 */
export function placesReferenceForm(candidate: PlacesCandidate, search: PlacesSearchContext, capturedBy: string, at = new Date()): BusinessForm {
  const placeId = candidate.isDemo ? null : normalizePlaceId(candidate.externalId);
  if (!candidate.isDemo && !placeId) throw new Error('A Google Places reference needs a valid Place ID.');
  return {
    name: placesIntakeName(candidate),
    category: search.category.trim() || 'Other',
    country: search.country,
    region: search.region,
    districtCode: '',
    city: search.city ?? '',
    neighborhood: search.neighborhood,
    address: '',
    businessStatus: 'unknown',
    officialWebsite: '',
    socialProfiles: [],
    enquiryChannel: '',
    phone: '',
    email: '',
    contactSource: '',
    interestLevel: 'unknown',
    budgetSignal: 'unknown',
    serviceNeeds: [],
    estimatedValue: null,
    expectedCloseDate: null,
    nextAction: 'Confirm the business from an independent source',
    nextActionDue: null,
    notes: placesReferenceNotes(candidate, placeId, capturedBy, at),
    sourceUrl: '',
    sourceKind: candidate.isDemo ? 'manual' : 'places_reference',
    placesPlaceId: placeId,
  };
}

/** Notes for the reference. No listing copy, no invented address or operating status. */
export function placesReferenceNotes(candidate: PlacesCandidate, placeId: string | null, capturedBy: string, at = new Date()): string {
  const when = at.toISOString().slice(0, 10);
  if (candidate.isDemo) {
    return `Fictional Google Places demo result kept for workflow practice. This business does not exist; do not contact it. Captured by ${capturedBy} on ${when}.`;
  }
  return [
    `Unverified Google Places reference: Place ID ${placeId}.`,
    'Only the Place ID, the searched location and the workspace’s own category are stored; Google’s listing name, address, phone, reviews and photos are never saved.',
    'The name above is a placeholder generated from the Place ID, not the business’s listed name.',
    `Captured by ${capturedBy} on ${when}. No website, operating status or contact permission is confirmed.`,
    'Confirm the business from an independent source before relying on this reference, and do not contact it.',
  ].join(' ');
}

export interface PlacesIntakeSummary {
  added: number;
  already_exists: number;
  needs_review: number;
  needs_permitted_source: number;
  failed: number;
  total: number;
}

export function summarizePlacesIntake(results: readonly Pick<PlacesIntakeAssessment, 'outcome'>[]): PlacesIntakeSummary {
  const summary: PlacesIntakeSummary = { added: 0, already_exists: 0, needs_review: 0, needs_permitted_source: 0, failed: 0, total: results.length };
  for (const result of results) summary[result.outcome] += 1;
  return summary;
}
