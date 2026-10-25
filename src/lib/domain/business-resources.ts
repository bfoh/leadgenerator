import { z } from 'zod';
import type { PageFacts } from './page-signals';
import type { ExtractedContacts } from './contact-extraction';
import { phoneKey } from './web-research';

export const RESOURCE_CATEGORIES = ['identity', 'contact', 'location', 'social', 'product', 'service', 'color', 'typography', 'brief'] as const;
export type ResourceCategory = typeof RESOURCE_CATEGORIES[number];

/**
 * Google and social-platform content cannot become independent source material. `business.site` is
 * the retired Google Business Profile website host: a page there can look like an independent site
 * while remaining Google-supplied content, so it is refused with the other Google hosts.
 */
export function restrictedResourceUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    return !['https:', 'http:'].includes(u.protocol) || Boolean(u.username || u.password) ||
      /(^|\.)(google\.[a-z.]+|googleapis\.com|googleusercontent\.com|gstatic\.com|goo\.gl|maps\.app\.goo\.gl|ggpht\.com|business\.site|facebook\.com|fbcdn\.net|instagram\.com|cdninstagram\.com|tiktok\.com|linkedin\.com|x\.com|twitter\.com)$/.test(h);
  } catch { return true; }
}

export const resourceEntrySchema = z.object({
  businessId: z.uuid(),
  category: z.enum(RESOURCE_CATEGORIES),
  label: z.string().trim().min(2).max(120),
  value: z.string().trim().min(1).max(2000),
  sourceKind: z.enum(['business_owner', 'official_website', 'licensed_original']),
  sourceUrl: z.string().trim().url().max(2000).refine((v) => !restrictedResourceUrl(v), 'Use an independent business-owned or licensed source, not Google or a social platform.'),
  evidence: z.string().trim().min(15).max(1000),
  exportPermission: z.enum(['granted', 'denied']),
  independentlyVerified: z.literal(true),
});
export type ResourceEntryInsert = z.infer<typeof resourceEntrySchema>;
export interface ResourceEntry extends ResourceEntryInsert {
  id: string; organizationId: string; createdBy: string | null; createdAt: string; revokedAt: string | null;
}

export interface GoogleResourceListing {
  id: string; name: string; address: string | null; phone: string | null; website: string | null;
  mapsUri: string | null; directionsUri: string | null; hours: string[]; status: string | null;
  attributions: { provider: string; uri: string | null }[];
  /** `googleMapsUri` per photo is Google's required direct link to the source photo. */
  photos: { name: string; width: number; height: number; googleMapsUri: string | null; authors: { name: string; uri: string | null; photoUri: string | null }[] }[];
  simulated: boolean;
}
export interface WebsiteResources {
  url: string; facts: PageFacts | null; contacts: ExtractedContacts | null;
  simulated: boolean; error: string | null;
  offerings?: { name: string; description: string; kind: string }[];
}

/** Bounded structured-data references, never executable markup or export-ready copy. */
export function extractResourceOfferings(html: string) {
  const values: NonNullable<WebsiteResources['offerings']> = [];
  const clean = (s: unknown, max: number) => typeof s === 'string' ? s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 5 || values.length >= 15) return;
    if (Array.isArray(value)) { value.slice(0, 30).forEach((v) => visit(v, depth + 1)); return; }
    const v = value as Record<string, unknown>;
    const kind = String(v['@type'] ?? '');
    if (/Product|Service/.test(kind) && clean(v.name, 120)) values.push({ name: clean(v.name, 120), description: clean(v.description, 600), kind: /Product/.test(kind) ? 'Product' : 'Service' });
    for (const key of ['@graph', 'itemListElement', 'itemOffered', 'hasOfferCatalog', 'makesOffer', 'offers']) if (v[key]) visit(v[key], depth + 1);
  };
  for (const match of [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].slice(0, 5)) {
    try { visit(JSON.parse(match[1].slice(0, 50_000)), 0); } catch { /* malformed source data is ignored */ }
  }
  return [...new Map(values.map((v) => [`${v.kind}:${v.name}`, v])).values()];
}

export function websiteResourceCandidates(result: WebsiteResources) {
  const f = result.facts;
  const candidates = [
    ...(f?.logoCandidates ?? []).map((v) => ({ url: v.url, label: v.alt ?? v.role, kind: v.role })),
    ...(f?.favicon ? [{ url: f.favicon, label: 'Favicon', kind: 'favicon' }] : []),
    ...(f?.imageCandidates ?? []).map((v) => ({ url: v.url, label: v.alt ?? 'Website image', kind: 'image' })),
  ];
  // Specific logo/favicon roles win when the same URL is also listed as a generic image.
  const unique = new Map<string, typeof candidates[number]>();
  for (const candidate of candidates) {
    const key = candidate.url.split('#')[0];
    if (!restrictedResourceUrl(candidate.url) && !unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].slice(0, 30);
}

/** Conflict detection informs a person; it never overwrites independently recorded details. */
export function resourceConflicts(listing: GoogleResourceListing | null, entries: ResourceEntry[], website?: WebsiteResources | null): string[] {
  if (!listing) return [];
  const normal = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  const foundConflicts = entries.filter((e) => !e.revokedAt).flatMap((entry) => {
    const found = /phone/i.test(entry.label) ? listing.phone : /address/i.test(entry.label) ? listing.address : /^business name$/i.test(entry.label) ? listing.name : null;
    const same = /phone/i.test(entry.label) ? phoneKey(found ?? '') === phoneKey(entry.value) : normal(found ?? '') === normal(entry.value);
    return found && !same ? [`${entry.label}: Google and the independent entry differ. Verify with the owner.`] : [];
  });
  if (listing.phone && website?.contacts?.phones.length && !website.contacts.phones.some((v) => phoneKey(v.value) === phoneKey(listing.phone!))) foundConflicts.push('Phone: the website candidates and Google differ. Confirm the current number with the owner.');
  return foundConflicts;
}
