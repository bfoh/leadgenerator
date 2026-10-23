// Business identity: is this prospect the business we think it is, and is it already in the CRM?
// Deterministic matching only. Suggestions are never applied automatically — merging, splitting and
// branch links are decisions a person makes (owners and administrators for merges).

import { findDuplicates, type DuplicateMatch } from './dedupe';
import type { Business, IdentityLink } from './types';

export const IDENTITY_RELATION_LABELS = {
  possible_duplicate: 'Possible duplicate',
  same_business: 'Same business (merged)',
  branch: 'Branch',
  distinct: 'Different business',
} as const;

export interface IdentitySuggestion {
  other: Business;
  strength: DuplicateMatch<Business>['strength'];
  reasons: string[];
}

export interface IdentityFactor {
  label: string;
  points: number;
  detail: string;
}

export interface IdentityAssessment {
  confidence: number;
  factors: IdentityFactor[];
  suggestions: IdentitySuggestion[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Links a person already decided (or that are still open) for this pair. */
export function linkBetween(links: IdentityLink[], a: string, b: string) {
  return links.find((l) => pairKey(l.businessId, l.otherBusinessId) === pairKey(a, b)) ?? null;
}

export function assessIdentity(business: Business, all: Business[], links: IdentityLink[]): IdentityAssessment {
  const others = all.filter((o) => o.id !== business.id && !o.mergedIntoId && !business.mergedIntoId);
  // Alternate names (recorded after merges) count as names of the record they belong to.
  const expanded = others.flatMap((o) => [o, ...(o.alternateNames ?? []).map((name) => ({ ...o, name }))]);
  const byId = new Map<string, IdentitySuggestion>();
  for (const name of [business.name, ...(business.alternateNames ?? [])]) {
    for (const m of findDuplicates({ ...business, name }, expanded)) {
      const decided = linkBetween(links, business.id, m.record.id);
      if (decided && decided.status !== 'suggested') continue;
      const prev = byId.get(m.record.id);
      const rank = { exact: 0, likely: 1, possible: 2 };
      if (!prev || rank[m.strength] < rank[prev.strength]) {
        byId.set(m.record.id, { other: others.find((o) => o.id === m.record.id)!, strength: m.strength, reasons: [...new Set([...(prev?.reasons ?? []), ...m.reasons])] });
      }
    }
  }
  const suggestions = [...byId.values()].sort((a, b) => ['exact', 'likely', 'possible'].indexOf(a.strength) - ['exact', 'likely', 'possible'].indexOf(b.strength));

  const factors: IdentityFactor[] = [];
  const add = (ok: boolean, points: number, label: string, detail: string) => ok && factors.push({ label, points, detail });
  add(Boolean(business.placesPlaceId), 20, 'Provider identifier', 'A Google Place ID is recorded.');
  add(Boolean(business.sourceUrl), 15, 'Source reference', 'An independent source URL is recorded.');
  add(Boolean(business.address || business.neighborhood), 10, 'Precise location', 'An address or neighbourhood is recorded.');
  add(Boolean(business.city && business.category), 10, 'City and category', `${business.category} in ${business.city}.`);
  add(Boolean(business.phone || business.officialWebsite || business.socialProfiles.length), 10, 'Business channel', 'A phone, website or social profile is recorded.');
  add(business.websiteStatus === 'verified_official', 20, 'Verified website', 'The official website was verified.');
  add(business.businessStatus === 'active', 10, 'Operating status', 'Confirmed as operating.');
  const unresolved = suggestions.filter((s) => s.strength !== 'possible');
  if (unresolved.length) factors.push({ label: 'Unresolved duplicates', points: -20, detail: `${unresolved.length} likely duplicate${unresolved.length === 1 ? '' : 's'} not yet resolved.` });
  else add(true, 5, 'No likely duplicates', 'No exact or likely duplicate in this workspace.');
  const confidence = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  return { confidence, factors, suggestions };
}

/** Fields a merge may copy into the primary record when the primary has none. Never consent fields. */
export const MERGEABLE_FIELDS = ['officialWebsite', 'phone', 'email', 'address', 'neighborhood', 'region', 'enquiryChannel', 'placesPlaceId', 'sourceUrl'] as const;
export type MergeableField = (typeof MERGEABLE_FIELDS)[number];
export const MERGEABLE_LABELS: Record<MergeableField, string> = {
  officialWebsite: 'Website',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  neighborhood: 'Neighbourhood',
  region: 'Region',
  enquiryChannel: 'Enquiry channel',
  placesPlaceId: 'Google Place ID',
  sourceUrl: 'Source URL',
};

/** Fields the secondary can fill on the primary (the primary's own value always wins). */
export function fillableFields(primary: Business, secondary: Business): MergeableField[] {
  return MERGEABLE_FIELDS.filter((f) => !primary[f] && Boolean(secondary[f]));
}

/** Contact permission after a merge: an opt-out or a refusal on either record carries over. */
export function mergedPermission(primary: Business, secondary: Business): Pick<Business, 'contactPermission' | 'optedOutAt'> {
  if (secondary.contactPermission === 'opted_out' && primary.contactPermission !== 'opted_out') return { contactPermission: 'opted_out', optedOutAt: secondary.optedOutAt };
  if (secondary.contactPermission === 'declined' && (primary.contactPermission === 'unknown' || primary.contactPermission === 'introduction_requested')) {
    return { contactPermission: 'declined', optedOutAt: primary.optedOutAt };
  }
  return { contactPermission: primary.contactPermission, optedOutAt: primary.optedOutAt };
}
