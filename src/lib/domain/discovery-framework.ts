// The provider-agnostic discovery contract: request validation, cursor integrity, record quality,
// duplicate detection and campaign controls. Shared by browser and server; it never calls a provider.
// A source is usable only when discovery-sources.ts permits unattended search + CRM storage, a
// connector exists, and server configuration enables that connector.

import { z } from 'zod';
import { DISTRICTS, findDistrict } from './districts';
import { findIndustryCategory, industryGroupByLabel } from './industry-taxonomy';
import { normalizeName } from './dedupe';
import type { CampaignScope } from './campaigns';

export const DISCOVERY_MAX_PAGE_SIZE = 50;
export const DISCOVERY_DEFAULT_PAGE_SIZE = 20;
export const DISCOVERY_DEFAULT_QUALITY = 60;
export const DISCOVERY_MAX_DAILY_LIMIT = 500;
export const DISCOVERY_MAX_TOTAL_LIMIT = 10_000;

export const DISCOVERY_REGION_NAMES: readonly string[] = [...new Set(DISTRICTS.map((district) => district.region))].sort();

const normalizedList = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];

export const discoveryRequestSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(60),
    regions: z.array(z.string().trim().min(1).max(80)).max(16).default([]).transform(normalizedList),
    districtCodes: z.array(z.string().trim().min(1).max(20)).max(261).default([]).transform(normalizedList),
    towns: z.array(z.string().trim().min(1).max(80)).max(50).default([]).transform(normalizedList),
    categories: z.array(z.string().trim().min(1).max(80)).max(50).default([]).transform(normalizedList),
    pageSize: z.number().int().min(1).max(DISCOVERY_MAX_PAGE_SIZE).default(DISCOVERY_DEFAULT_PAGE_SIZE),
    cursor: z.string().trim().max(200).default(''),
    minQuality: z.number().int().min(0).max(100).default(DISCOVERY_DEFAULT_QUALITY),
  })
  .superRefine((request, ctx) => {
    for (const region of request.regions) {
      if (!DISCOVERY_REGION_NAMES.includes(region)) {
        ctx.addIssue({ code: 'custom', path: ['regions'], message: `${region} is not a region of Ghana.` });
      }
    }
    for (const code of request.districtCodes) {
      const district = findDistrict(code);
      if (!district) ctx.addIssue({ code: 'custom', path: ['districtCodes'], message: `${code} is not a district code.` });
      else if (request.regions.length && !request.regions.includes(district.region)) {
        ctx.addIssue({ code: 'custom', path: ['districtCodes'], message: `${district.name} is not in the selected region(s).` });
      }
    }
  });
export type DiscoveryRequestInput = z.input<typeof discoveryRequestSchema>;
export type DiscoveryRequest = z.output<typeof discoveryRequestSchema>;

/** Stable 32-bit FNV-1a fingerprint, so a cursor cannot be replayed against a different query. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The cursor is bound to the scope, not to the page size or quality threshold: a campaign may fetch
 * a smaller page when its daily quota is nearly used, and a quality change must not strand the
 * remaining pages.
 */
export function discoveryRequestFingerprint(
  request: Pick<DiscoveryRequest, 'sourceId' | 'regions' | 'districtCodes' | 'towns' | 'categories'>,
): string {
  return fingerprint(
    JSON.stringify({
      sourceId: request.sourceId,
      regions: [...request.regions].sort(),
      districtCodes: [...request.districtCodes].sort(),
      towns: [...request.towns].sort(),
      categories: [...request.categories].sort(),
    }),
  );
}

export function encodeDiscoveryCursor(offset: number, requestFingerprint: string): string {
  return `v1:${Math.max(0, Math.floor(offset))}:${requestFingerprint}`;
}

export function decodeDiscoveryCursor(cursor: string, requestFingerprint: string): number | null {
  const match = /^v1:(\d{1,9}):([0-9a-f]{8})$/.exec(cursor);
  if (!match || match[2] !== requestFingerprint) return null;
  return Number(match[1]);
}

/** The scope a provider search receives, from the campaign's saved scope. */
export function discoveryScopeFromCampaign(scope: CampaignScope): Pick<DiscoveryRequest, 'regions' | 'districtCodes' | 'towns' | 'categories'> {
  return { regions: [...scope.regions], districtCodes: [...scope.districtCodes], towns: [...scope.towns], categories: [...scope.categories] };
}

export const DISCOVERY_OPERATING_STATUSES = ['open', 'temporarily_closed', 'permanently_closed', 'unknown'] as const;
export type DiscoveryOperatingStatus = (typeof DISCOVERY_OPERATING_STATUSES)[number];

/** One provider record, normalised. Raw provider payloads never enter this shape. */
export interface DiscoveredRecord {
  sourceId: string;
  providerRecordId: string;
  name: string;
  category: string | null;
  address: string | null;
  region: string | null;
  districtCode: string | null;
  town: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  operatingStatus: DiscoveryOperatingStatus;
  /** Provider confidence 0–1, when supplied. */
  confidence: number | null;
  sourceUrl: string | null;
  retrievedAt: string;
}

export interface DiscoveryQuality {
  score: number;
  identityConfidence: number;
  issues: string[];
  reviewReasons: string[];
  /** Meets the campaign's quality threshold and is not recorded as permanently closed. */
  accepted: boolean;
  needsReview: boolean;
}

function validHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * The category label the CRM will store. Unknown provider categories become `Other`; a group label
 * stays a group label because campaign matching resolves it to the whole group.
 */
export function canonicalDiscoveryCategory(value: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return 'Other';
  const category = findIndustryCategory(raw);
  if (category) return category.label;
  const group = industryGroupByLabel(raw);
  if (group) return group.label;
  return raw.length <= 80 ? raw : 'Other';
}

/** A deterministic quality reading, not a judgement about whether the business is a good prospect. */
export function assessDiscoveredRecord(record: DiscoveredRecord, options: { minQuality?: number } = {}): DiscoveryQuality {
  const minQuality = options.minQuality ?? DISCOVERY_DEFAULT_QUALITY;
  const issues: string[] = [];
  const reviewReasons: string[] = [];
  let score = 0;

  const name = record.name.trim();
  if (name.length >= 2) score += 25;
  else issues.push('The record has no usable business name.');

  const district = findDistrict(record.districtCode ?? undefined);
  if (district) {
    score += 20;
    if (record.region?.trim() && record.region.trim() !== district.region) {
      issues.push(`The district is in ${district.region}, not ${record.region}.`);
      score -= 20;
      reviewReasons.push('Region and district disagree.');
    }
  } else if (record.region && DISCOVERY_REGION_NAMES.includes(record.region.trim())) {
    score += 12;
    reviewReasons.push('Only the region is known; the district is missing.');
  } else {
    issues.push('No valid Ghana region or district.');
  }

  if (record.town?.trim()) score += 10;
  else reviewReasons.push('No town or neighbourhood.');

  const category = record.category?.trim() ?? '';
  const knownCategory = Boolean(findIndustryCategory(category)) || Boolean(industryGroupByLabel(category));
  if (knownCategory) score += 15;
  else {
    score += 5;
    issues.push('The category is not in the Ghana industry catalogue; it will be stored as Other.');
    reviewReasons.push('Unrecognised category.');
  }

  if (validHttpUrl(record.website)) score += 10;
  if (record.address?.trim()) score += 5;
  if (record.providerRecordId.trim()) score += 10;
  if (record.operatingStatus !== 'permanently_closed') score += 5;
  else {
    issues.push('The provider records the business as permanently closed.');
    reviewReasons.push('Permanently closed.');
  }

  if (record.confidence != null) {
    if (record.confidence >= 0.7) score += 5;
    else if (record.confidence < 0.3) {
      score -= 10;
      reviewReasons.push('The provider has low confidence that the place exists.');
    }
  }

  score = Math.max(0, Math.min(100, score));
  const identityConfidence = Math.max(
    0,
    Math.min(
      100,
      (name.length >= 2 ? 35 : 0) +
        (district ? 25 : record.region && DISCOVERY_REGION_NAMES.includes(record.region.trim()) ? 15 : 0) +
        (record.town?.trim() ? 10 : 0) +
        (validHttpUrl(record.website) ? 15 : 0) +
        (phoneDigits(record.phone).length >= 9 ? 15 : 0),
    ),
  );
  if (identityConfidence < 70) reviewReasons.push('Identity is not strong enough to accept without a person.');
  if (score < 80) reviewReasons.push('Quality score is below the automatic-acceptance level.');

  const accepted = score >= minQuality && record.operatingStatus !== 'permanently_closed' && name.length >= 2;
  return { score, identityConfidence, issues, reviewReasons: [...new Set(reviewReasons)], accepted, needsReview: reviewReasons.length > 0 };
}

export function discoveryDedupeKey(record: Pick<DiscoveredRecord, 'providerRecordId' | 'name' | 'districtCode' | 'town'>): string {
  const providerId = record.providerRecordId.trim().toLowerCase();
  if (providerId) return `provider:${providerId}`;
  const name = normalizeName(record.name);
  const place = (record.districtCode ?? record.town ?? '').trim().toLowerCase();
  return `name:${name}@${place}`;
}

export interface DiscoveryDuplicateCandidate {
  name: string;
  town?: string | null;
  districtCode?: string | null;
  website?: string | null;
  phone?: string | null;
  providerKey?: string | null;
  providerRecordId?: string | null;
}

export interface DiscoveryDuplicateMatch {
  reason: string;
  strength: 'exact' | 'likely' | 'possible';
}

/**
 * Duplicate detection for a discovered record. It warns; the review policy decides. Provider IDs are
 * exact only within the same provider, never across providers.
 */
export function findDiscoveryDuplicate(record: DiscoveredRecord, existing: DiscoveryDuplicateCandidate[]): DiscoveryDuplicateMatch | null {
  const name = normalizeName(record.name);
  const places = new Set([record.districtCode, record.town].map((value) => (value ?? '').trim().toLowerCase()).filter(Boolean));
  // Compare the exact URL, not the host: a provider may host many businesses on one domain, and a
  // franchise can share a website without being the same record. The provider ID and phone are the
  // stronger signals; the name + place pair catches a listing re-imported under a new provider ID.
  const website = (record.website ?? '').trim().toLowerCase().replace(/\/+$/, '');
  const phone = phoneDigits(record.phone).slice(-9);
  const providerId = record.providerRecordId.trim().toLowerCase();

  for (const candidate of existing) {
    if (candidate.providerKey === record.sourceId && candidate.providerRecordId?.trim().toLowerCase() === providerId) {
      return { reason: 'The same provider record is already imported.', strength: 'exact' };
    }
  }
  for (const candidate of existing) {
    if (website && (candidate.website ?? '').trim().toLowerCase().replace(/\/+$/, '') === website) {
      return { reason: 'The same website is already recorded.', strength: 'likely' };
    }
    if (phone && phoneDigits(candidate.phone).slice(-9) === phone) return { reason: 'The phone number is already recorded.', strength: 'likely' };
  }
  for (const candidate of existing) {
    const candidatePlaces = [candidate.districtCode, candidate.town].map((value) => (value ?? '').trim().toLowerCase()).filter(Boolean);
    if (name && name === normalizeName(candidate.name) && candidatePlaces.some((place) => places.has(place))) {
      return { reason: 'The same name is already recorded in the same place.', strength: 'likely' };
    }
  }
  return null;
}

// ─── Campaign controls ──────────────────────────────────────────────────────────────────────────

export const discoveryControlsSchema = z.object({
  enabled: z.boolean().default(false),
  dailyLimit: z.number().int().min(1).max(DISCOVERY_MAX_DAILY_LIMIT).default(25),
  totalLimit: z.number().int().min(1).max(DISCOVERY_MAX_TOTAL_LIMIT).default(100),
  spendCapUsd: z.number().min(0).max(100_000).nullable().default(null),
  qualityThreshold: z.number().int().min(0).max(100).default(DISCOVERY_DEFAULT_QUALITY),
  requireReview: z.boolean().default(true),
});
export type DiscoveryControlsInput = z.input<typeof discoveryControlsSchema>;
export type DiscoveryControls = z.output<typeof discoveryControlsSchema>;

export const DEFAULT_DISCOVERY_CONTROLS: DiscoveryControls = { enabled: false, dailyLimit: 25, totalLimit: 100, spendCapUsd: null, qualityThreshold: DISCOVERY_DEFAULT_QUALITY, requireReview: true };

/** Progress shown in the campaign card. */
export function discoveryProgress(discovered: number, totalLimit: number): { used: number; total: number; percent: number } {
  const total = Math.max(1, totalLimit);
  return { used: Math.max(0, discovered), total: totalLimit, percent: Math.min(100, Math.round((Math.max(0, discovered) / total) * 100)) };
}

/** What a campaign has left of its total allowance. */
export function discoveryRemaining(discovered: number, totalLimit: number): number {
  return Math.max(0, totalLimit - Math.max(0, discovered));
}
