// Visual Asset Acquisition: finding images the business actually publishes, deciding what may be
// stored, and only then letting a file reach the vault or a kit.
//
// The distinction this module protects is the one people collapse: a page showing a photograph is
// not a licence. Discovery therefore records an address and what the page says about it; nothing is
// fetched or stored. A file enters the vault only after a person records a rights basis with
// evidence, and it leaves in a kit only when the vault's own export rules pass. Google and social
// platform imagery is never a candidate at all.
//
// Everything here is pure: no network, no storage, no clock beyond what is passed in.

import { z } from 'zod';
import { restrictedResourceUrl } from './business-resources';
import type { Tone } from './constants';
import { assetExportProblems, type StudioAsset, type StudioAssetKind } from './studio-assets';
import type { Business } from './types';
import { hostOf, registrableDomain } from './web-research';

// ── Vocabulary ───────────────────────────────────────────────────────────────────────────────

/** Where the address sits relative to the business's own verified website. */
export const VISUAL_SOURCE_KINDS = ['official_site', 'third_party_reference'] as const;
export type VisualSourceKind = (typeof VISUAL_SOURCE_KINDS)[number];

export const VISUAL_IMAGE_TYPES = [
  'logo',
  'brand_mark',
  'hero',
  'gallery',
  'exterior',
  'interior',
  'rooms',
  'product',
  'staff',
  'other',
] as const;
export type VisualImageType = (typeof VISUAL_IMAGE_TYPES)[number];

/** What a person has recorded about reuse. Discovery always starts at `not_established`. */
export const VISUAL_RIGHTS_BASES = ['not_established', 'business_owned_website', 'written_permission', 'licensed_stock'] as const;
export type VisualRightsBasis = (typeof VISUAL_RIGHTS_BASES)[number];

export const VISUAL_CANDIDATE_STATUSES = ['reference_only', 'imported', 'rejected'] as const;
export type VisualCandidateStatus = (typeof VISUAL_CANDIDATE_STATUSES)[number];

export const VISUAL_EVENT_ACTIONS = ['discovered', 'imported', 'authorization_requested', 'rejected', 'approved'] as const;
export type VisualEventAction = (typeof VISUAL_EVENT_ACTIONS)[number];

export interface VisualImageTypeMeta {
  label: string;
  tone: Tone;
  /** The vault kind an authorized copy becomes. */
  assetKind: StudioAssetKind;
}

export const IMAGE_TYPE_META: Record<VisualImageType, VisualImageTypeMeta> = {
  logo: { label: 'Logo', tone: 'accent', assetKind: 'logo' },
  brand_mark: { label: 'Brand mark or monogram', tone: 'accent', assetKind: 'brand_mark' },
  hero: { label: 'Hero photograph', tone: 'info', assetKind: 'venue_photo' },
  gallery: { label: 'Gallery photograph', tone: 'info', assetKind: 'venue_photo' },
  exterior: { label: 'Exterior photograph', tone: 'info', assetKind: 'venue_photo' },
  interior: { label: 'Interior photograph', tone: 'info', assetKind: 'venue_photo' },
  rooms: { label: 'Room or suite photograph', tone: 'info', assetKind: 'venue_photo' },
  product: { label: 'Product or dish photograph', tone: 'success', assetKind: 'product_photo' },
  staff: { label: 'Staff or team photograph', tone: 'info', assetKind: 'venue_photo' },
  other: { label: 'Other photograph', tone: 'neutral', assetKind: 'venue_photo' },
};

export interface VisualRightsMeta {
  label: string;
  tone: Tone;
  description: string;
  /** Whether a file may be stored in the vault under this basis at all. */
  importAllowed: boolean;
}

export const RIGHTS_BASIS_META: Record<VisualRightsBasis, VisualRightsMeta> = {
  not_established: {
    label: 'Not established',
    tone: 'warning',
    description: 'Reference only. Nobody has recorded a right to store or reuse this file, and being public is not permission.',
    importAllowed: false,
  },
  business_owned_website: {
    label: 'Published on the business’s own site',
    tone: 'info',
    description: 'The file sits on the independently verified official website. Storing a copy needs the ownership attestation; export is still a separate decision.',
    importAllowed: true,
  },
  written_permission: {
    label: 'Written permission',
    tone: 'success',
    description: 'The business or rights holder granted permission in writing. Record who, when and what the message permits.',
    importAllowed: true,
  },
  licensed_stock: {
    label: 'Licensed stock',
    tone: 'accent',
    description: 'A licence covers this use. Name the licence, its reference and expiry, and record any required attribution.',
    importAllowed: true,
  },
};

export const VISUAL_STATUS_META: Record<VisualCandidateStatus, { label: string; tone: Tone; description: string }> = {
  reference_only: { label: 'Reference only', tone: 'warning', description: 'A link and a note. No file has been copied into the vault.' },
  imported: { label: 'In the vault', tone: 'info', description: 'A copy is stored and awaiting review. Approval and export are separate decisions.' },
  rejected: { label: 'Rejected', tone: 'danger', description: 'Excluded from the queue. The reason stays on the record.' },
};

// ── Records ──────────────────────────────────────────────────────────────────────────────────

export interface VisualCandidate {
  id: string;
  organizationId: string;
  businessId: string;
  projectId: string;
  /** The verified page the address was read from. */
  pageUrl: string;
  imageUrl: string;
  sourceKind: VisualSourceKind;
  imageType: VisualImageType;
  label: string;
  attribution: string | null;
  /** Why the collector considers this source relevant, in the page's own words where possible. */
  relevance: string;
  rightsBasis: VisualRightsBasis;
  rightsEvidence: string | null;
  status: VisualCandidateStatus;
  /** The vault file, once a copy has been authorized and stored. */
  assetId: string | null;
  /** How the bytes arrived: copied from the official site, or uploaded by someone with permission. */
  importedVia: 'downloaded' | 'uploaded' | null;
  checksumSha256: string | null;
  requestedAt: string | null;
  requestNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VisualCandidateInsert = Omit<VisualCandidate, 'id' | 'organizationId' | 'createdBy' | 'createdAt' | 'updatedAt'>;

export type VisualCandidatePatch = Partial<
  Pick<
    VisualCandidate,
    | 'rightsBasis'
    | 'rightsEvidence'
    | 'status'
    | 'assetId'
    | 'importedVia'
    | 'checksumSha256'
    | 'requestedAt'
    | 'requestNote'
    | 'reviewedBy'
    | 'reviewedAt'
    | 'reviewNote'
  >
>;

export interface VisualCandidateEvent {
  id: string;
  organizationId: string;
  candidateId: string;
  action: VisualEventAction;
  note: string | null;
  actorId: string | null;
  createdAt: string;
}

export type VisualCandidateEventInsert = Omit<VisualCandidateEvent, 'id' | 'organizationId' | 'actorId' | 'createdAt'>;

const URL_MAX = 2000;

/** Validates a discovery row before it can be stored; mirrors migration 020's checks. */
export const visualCandidateSchema = z.object({
  businessId: z.uuid(),
  projectId: z.uuid(),
  pageUrl: z.string().trim().url().max(URL_MAX),
  imageUrl: z.string().trim().url().max(URL_MAX),
  sourceKind: z.enum(VISUAL_SOURCE_KINDS),
  imageType: z.enum(VISUAL_IMAGE_TYPES),
  label: z.string().trim().min(1).max(160),
  attribution: z.string().trim().max(300).nullable(),
  relevance: z.string().trim().min(5).max(500),
  rightsBasis: z.enum(VISUAL_RIGHTS_BASES),
  rightsEvidence: z.string().trim().max(1000).nullable(),
  status: z.enum(VISUAL_CANDIDATE_STATUSES),
  assetId: z.uuid().nullable(),
  importedVia: z.enum(['downloaded', 'uploaded']).nullable(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  requestedAt: z.string().nullable(),
  requestNote: z.string().trim().max(1000).nullable(),
  reviewedBy: z.string().max(200).nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().trim().max(1000).nullable(),
});

export const visualCandidateEventSchema = z.object({
  candidateId: z.uuid(),
  action: z.enum(VISUAL_EVENT_ACTIONS),
  note: z.string().trim().max(1000).nullable(),
});


// ── Discovery ────────────────────────────────────────────────────────────────────────────────

/** A stable key for the same file: host case, fragment and trailing slash are not new images. */
export function canonicalImageUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href;
  } catch {
    return raw.trim().slice(0, URL_MAX);
  }
}

export interface CandidateSourceCheck {
  ok: boolean;
  /** Human-readable reason when the address cannot be a candidate at all. */
  problem: string | null;
  sourceKind: VisualSourceKind | null;
}

/**
 * Whether an address the verified page referenced may be recorded. Google and social hosts are
 * refused outright: their bytes are never fetched, and a preview is not a licence.
 */
export function candidateSourceCheck(pageUrl: string, imageUrl: string, officialWebsite: string | null): CandidateSourceCheck {
  if (!officialWebsite) return { ok: false, problem: 'Record and verify the official website before collecting its images.', sourceKind: null };
  const pageHost = hostOf(pageUrl);
  const siteHost = hostOf(officialWebsite);
  if (!pageHost || !siteHost || registrableDomain(pageHost) !== registrableDomain(siteHost)) {
    return { ok: false, problem: 'The page read is not the recorded official website.', sourceKind: null };
  }
  let image: URL;
  try {
    image = new URL(imageUrl);
  } catch {
    return { ok: false, problem: 'The image address is not a valid URL.', sourceKind: null };
  }
  if (!['http:', 'https:'].includes(image.protocol) || image.username || image.password) {
    return { ok: false, problem: 'Only plain http(s) image addresses without credentials can be recorded.', sourceKind: null };
  }
  if (image.href.length > URL_MAX) return { ok: false, problem: 'The image address is too long to record.', sourceKind: null };
  if (restrictedResourceUrl(image.href)) {
    return { ok: false, problem: 'Google and social-platform images are never collected. Use only the business’s own site or an authorized original.', sourceKind: null };
  }
  const host = hostOf(image.href);
  if (!host) return { ok: false, problem: 'The image address is not a valid host.', sourceKind: null };
  // Same registrable domain: the business publishes the file itself. Anything else is a third
  // party's server and remains a reference, even when the business links to it.
  const sameSite = registrableDomain(host) === registrableDomain(siteHost);
  return { ok: true, problem: null, sourceKind: sameSite ? 'official_site' : 'third_party_reference' };
}

const TYPE_HINTS: { type: VisualImageType; pattern: RegExp }[] = [
  { type: 'logo', pattern: /\b(logo|wordmark|word mark)\b/i },
  { type: 'brand_mark', pattern: /\b(monogram|emblem|crest|insignia|brand mark)\b/i },
  { type: 'exterior', pattern: /\b(exterior|outside|facade|frontage|shopfront|storefront|building)\b/i },
  { type: 'rooms', pattern: /\b(room|rooms|suite|bedroom|chamber|bed)\b/i },
  { type: 'interior', pattern: /\b(interior|inside|lobby|reception|dining hall|lounge)\b/i },
  { type: 'staff', pattern: /\b(staff|team|chef|guide|receptionist|host|founder|owner)\b/i },
  { type: 'product', pattern: /\b(product|dish|menu|meal|food|cake|bread|pastry|gown|dress|furniture|collection|item|drink|cocktail)\b/i },
  { type: 'hero', pattern: /\b(hero|banner|cover|header image)\b/i },
];

const URL_HINTS: { type: VisualImageType; pattern: RegExp }[] = [
  { type: 'logo', pattern: /(^|[/_-])logo([._/-]|$)/i },
  { type: 'rooms', pattern: /(^|[/_-])(room|suite|bed)([._/-]|$)/i },
  { type: 'exterior', pattern: /(^|[/_-])(exterior|outside|facade|shopfront|storefront)([._/-]|$)/i },
  { type: 'product', pattern: /(^|[/_-])(menu|dish|product|collection)([._/-]|$)/i },
  { type: 'staff', pattern: /(^|[/_-])(team|staff)([._/-]|$)/i },
];

/** What the image appears to show, from the page's own labels. Never a claim about its owner. */
export function classifyVisualImage(input: { imageUrl: string; alt?: string | null; role?: string | null }): VisualImageType {
  const role = input.role?.toLowerCase() ?? '';
  if (role === 'logo') return 'logo';
  if (role === 'icon') return 'brand_mark';
  const alt = input.alt?.trim() ?? '';
  for (const hint of TYPE_HINTS) if (alt && hint.pattern.test(alt)) return hint.type;
  for (const hint of URL_HINTS) if (hint.pattern.test(input.imageUrl)) return hint.type;
  if (alt) return 'gallery';
  return 'other';
}

/**
 * The sentence shown beside a candidate. It separates what the page says from what we know about
 * rights, so nobody reads a description as a licence.
 */
export function candidateRelevance(input: {
  imageType: VisualImageType;
  alt?: string | null;
  sourceKind: VisualSourceKind;
  pageUrl: string;
  officialWebsite: string;
}): string {
  const host = hostOf(input.officialWebsite) ?? input.officialWebsite;
  const where =
    input.sourceKind === 'official_site'
      ? `Linked from the verified homepage on ${host}, so the business publishes the file itself.`
      : 'Linked from the verified homepage but served by another host, so it belongs to a third party.';
  const described = input.alt?.trim() ? `The page describes it as “${input.alt.trim().slice(0, 160)}”.` : 'The page publishes it without a description.';
  return `${where} ${described} It reads as a ${IMAGE_TYPE_META[input.imageType].label.toLowerCase()}. Being published is not permission to reuse it.`;
}


export interface VisualCandidateDraft {
  imageUrl: string;
  label: string;
  alt: string | null;
}

export interface DiscoveryResult {
  accepted: VisualCandidateInsert[];
  skipped: { imageUrl: string; reason: string }[];
}

/**
 * Turns the references an official homepage published into candidate rows. Existing addresses and
 * blocked hosts are reported rather than silently dropped, so the screen can say what happened.
 * Nothing here fetches, scores or licenses an image.
 */
export function planVisualDiscovery(input: {
  business: Pick<Business, 'officialWebsite'>;
  businessId: string;
  projectId: string;
  pageUrl: string;
  drafts: VisualCandidateDraft[];
  existing: { imageUrl: string }[];
  limit?: number;
}): DiscoveryResult {
  const limit = Math.min(Math.max(input.limit ?? 30, 1), 30);
  const seen = new Set(input.existing.map((v) => canonicalImageUrl(v.imageUrl)));
  const accepted: VisualCandidateInsert[] = [];
  const skipped: { imageUrl: string; reason: string }[] = [];
  for (const draft of input.drafts) {
    if (accepted.length >= limit) {
      skipped.push({ imageUrl: draft.imageUrl, reason: `Only the first ${limit} images are recorded at a time.` });
      continue;
    }
    const canonical = canonicalImageUrl(draft.imageUrl);
    if (seen.has(canonical)) {
      skipped.push({ imageUrl: draft.imageUrl, reason: 'Already recorded for this prospect.' });
      continue;
    }
    const check = candidateSourceCheck(input.pageUrl, canonical, input.business.officialWebsite);
    if (!check.ok || !check.sourceKind) {
      skipped.push({ imageUrl: draft.imageUrl, reason: check.problem ?? 'This address cannot be recorded.' });
      continue;
    }
    const alt = draft.alt?.trim() ? draft.alt.trim().slice(0, 300) : null;
    const imageType = classifyVisualImage({ imageUrl: canonical, alt, role: /logo/i.test(draft.label) ? 'logo' : null });
    // A credit line in the page's own description is kept as attribution, never as a licence.
    const attribution = alt && /(photo|image|picture)\s*(by|:)/i.test(alt) ? alt : null;
    accepted.push({
      businessId: input.businessId,
      projectId: input.projectId,
      pageUrl: input.pageUrl,
      imageUrl: canonical,
      sourceKind: check.sourceKind,
      imageType,
      label: (draft.label?.trim() || alt || IMAGE_TYPE_META[imageType].label).slice(0, 160),
      attribution,
      relevance: candidateRelevance({ imageType, alt, sourceKind: check.sourceKind, pageUrl: input.pageUrl, officialWebsite: input.business.officialWebsite ?? '' }),
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
    });
    seen.add(canonical);
  }
  return { accepted, skipped };
}

// ── Authorization and import ────────────────────────────────────────────────────────────────

export interface VisualImportRequest {
  rightsBasis: VisualRightsBasis;
  evidence: string;
  /** A person states the verified homepage is the business's own site. */
  businessOwnershipConfirmed: boolean;
  /** Export is a separate decision from storing a copy. */
  exportAuthorized: boolean;
  licenceName?: string | null;
  licenceReference?: string | null;
  licenceExpiresOn?: string | null;
  attributionRequired?: boolean;
  attributionText?: string | null;
}

/** Why a candidate may not be imported yet. Empty means the file may be fetched and stored. */
export function visualImportProblems(candidate: Pick<VisualCandidate, 'status' | 'sourceKind' | 'imageUrl'>, request: VisualImportRequest): string[] {
  const problems: string[] = [];
  if (candidate.status !== 'reference_only') problems.push('Only a reference-only candidate can be imported.');
  if (restrictedResourceUrl(candidate.imageUrl)) problems.push('Google and social-platform images cannot be imported.');
  if (!RIGHTS_BASIS_META[request.rightsBasis]?.importAllowed) {
    problems.push('Record a rights basis before copying the file: the business’s own site, written permission or a licence.');
  }
  const evidence = request.evidence.trim();
  if (evidence.length < 15) problems.push('Record the evidence behind the rights decision (at least 15 characters): who confirmed it, when, and what it permits.');
  if (evidence.length > 1000) problems.push('The evidence is limited to 1,000 characters.');
  if (request.rightsBasis === 'business_owned_website' && !request.businessOwnershipConfirmed) {
    problems.push('Confirm that the verified homepage is the business’s own website before storing its files.');
  }
  if (request.rightsBasis === 'licensed_stock' && !request.licenceName?.trim()) {
    problems.push('Name the licence that covers this file.');
  }
  if (request.licenceExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(request.licenceExpiresOn)) {
    problems.push('A licence expiry date must be written as YYYY-MM-DD.');
  }
  if (request.attributionRequired && !request.attributionText?.trim()) {
    problems.push('Say how the attribution must read, or turn the requirement off.');
  }
  return problems;
}


/** The vault record an authorized import becomes. Permissions stay conservative by design. */
export function visualAssetDraft(candidate: VisualCandidate, request: VisualImportRequest) {
  const meta = IMAGE_TYPE_META[candidate.imageType];
  const licensed = request.rightsBasis === 'licensed_stock';
  const ownerName = licensed
    ? request.licenceName?.trim() || 'Licensed source'
    : candidate.attribution?.trim() || hostOf(candidate.imageUrl) || 'Official website';
  return {
    kind: meta.assetKind,
    origin: licensed ? ('licensed' as const) : ('client_supplied' as const),
    ownerName: ownerName.slice(0, 200),
    supplier: hostOf(candidate.imageUrl),
    sourceUrl: candidate.imageUrl,
    licenceName: request.licenceName?.trim() || null,
    licenceReference: request.licenceReference?.trim() || null,
    licenceExpiresOn: request.licenceExpiresOn || null,
    attributionRequired: request.attributionRequired ?? false,
    attributionText: request.attributionText?.trim() || null,
    permissionEvidence: request.evidence.trim(),
    inspectPermission: 'granted' as const,
    storePermission: 'granted' as const,
    prototypePermission: 'granted' as const,
    exportPermission: request.exportAuthorized ? ('granted' as const) : ('unknown' as const),
    // Publication is never granted by a collection decision.
    publishPermission: 'unknown' as const,
    note: `Collected from ${candidate.pageUrl}. ${RIGHTS_BASIS_META[request.rightsBasis].label}.`,
  };
}

// ── Export standing ─────────────────────────────────────────────────────────────────────────

export type VisualCandidateExportState = 'exportable' | 'awaiting_review' | 'not_exportable' | 'reference_only' | 'rejected' | 'file_missing';

export const EXPORT_STATE_META: Record<VisualCandidateExportState, { label: string; tone: Tone; inAssetsFolder: boolean }> = {
  exportable: { label: 'Export permitted', tone: 'success', inAssetsFolder: true },
  awaiting_review: { label: 'Awaiting approval', tone: 'warning', inAssetsFolder: false },
  not_exportable: { label: 'Cannot be exported', tone: 'danger', inAssetsFolder: false },
  reference_only: { label: 'Reference only', tone: 'warning', inAssetsFolder: false },
  rejected: { label: 'Rejected', tone: 'danger', inAssetsFolder: false },
  file_missing: { label: 'Stored file missing', tone: 'danger', inAssetsFolder: false },
};

/** One answer for the card, the approval queue and the kit, derived from the vault's own rules. */
export function visualCandidateExportState(candidate: VisualCandidate, asset: StudioAsset | null | undefined): VisualCandidateExportState {
  if (candidate.status === 'rejected') return 'rejected';
  if (candidate.status === 'reference_only') return 'reference_only';
  if (!candidate.assetId) return 'file_missing';
  if (!asset || asset.id !== candidate.assetId) return 'file_missing';
  if (['rejected', 'revoked', 'superseded'].includes(asset.status)) return 'not_exportable';
  if (asset.status !== 'approved') {
    // A candidate missing export permission cannot become export-ready by being approved, so say so
    // now rather than after someone clicks Approve.
    const blockers = assetExportProblems({ ...asset, status: 'approved' });
    return blockers.length ? 'not_exportable' : 'awaiting_review';
  }
  return assetExportProblems(asset).length ? 'not_exportable' : 'exportable';
}

export interface VisualAcquisitionSummary {
  total: number;
  referenceOnly: number;
  imported: number;
  exportable: number;
  awaitingReview: number;
  blocked: number;
  rejected: number;
}

export function visualAcquisitionSummary(candidates: VisualCandidate[], assets: StudioAsset[]): VisualAcquisitionSummary {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const summary: VisualAcquisitionSummary = { total: candidates.length, referenceOnly: 0, imported: 0, exportable: 0, awaitingReview: 0, blocked: 0, rejected: 0 };
  for (const candidate of candidates) {
    const state = visualCandidateExportState(candidate, candidate.assetId ? byId.get(candidate.assetId) : null);
    if (state === 'reference_only') summary.referenceOnly += 1;
    if (state === 'rejected') summary.rejected += 1;
    if (state === 'exportable') {
      summary.exportable += 1;
      summary.imported += 1;
    }
    if (state === 'awaiting_review') {
      summary.awaitingReview += 1;
      summary.imported += 1;
    }
    if (state === 'not_exportable' || state === 'file_missing') {
      summary.blocked += 1;
      summary.imported += 1;
    }
  }
  return summary;
}

/** Whether approving this candidate now would put a file in the next kit's assets/ folder. */
export function candidateReadyToApprove(candidate: VisualCandidate, asset: StudioAsset | null | undefined): string[] {
  if (candidate.status !== 'imported' || !candidate.assetId) return ['Only a stored candidate can be approved.'];
  if (!asset || asset.id !== candidate.assetId) return ['The stored file could not be found in this vault.'];
  if (asset.status !== 'candidate') return ['Only a candidate awaiting review can be approved.'];
  // Approval must not promise an export that the vault would then refuse.
  const problems = assetExportProblems({ ...asset, status: 'approved' });
  return problems;
}


// ── Missing-asset requirements ─────────────────────────────────────────────────────────────

export interface VisualRequirement {
  key: string;
  label: string;
  detail: string;
  imageTypes: VisualImageType[];
  assetKinds: StudioAssetKind[];
}

const requirement = (key: string, label: string, detail: string, imageTypes: VisualImageType[], assetKinds: StudioAssetKind[]): VisualRequirement => ({
  key,
  label,
  detail,
  imageTypes,
  assetKinds,
});

const LOGO_REQUIREMENT = requirement('logo', 'Logo', 'A logo or brand mark the business owns and permits for export.', ['logo', 'brand_mark'], ['logo', 'brand_mark']);
const HERO_REQUIREMENT = requirement('hero', 'Hero photograph', 'A wide photograph that shows the business at its best.', ['hero', 'exterior', 'interior'], ['venue_photo', 'product_photo', 'licensed_image']);
const STAFF_REQUIREMENT = requirement('staff', 'People or staff photograph', 'The people a customer meets.', ['staff'], ['venue_photo', 'licensed_image']);
const PRODUCT_REQUIREMENT = requirement('product', 'Product or service photograph', 'What the business actually sells or serves.', ['product', 'gallery'], ['product_photo', 'licensed_image']);

const REQUIREMENT_SETS: { pattern: RegExp; requirements: VisualRequirement[] }[] = [
  {
    pattern: /hotel|guest ?house|lodge|resort|hostel|apartment|accommodation/i,
    requirements: [
      LOGO_REQUIREMENT,
      requirement('exterior', 'Exterior photograph', 'The building a guest arrives at, so the site matches the street.', ['exterior'], ['venue_photo', 'licensed_image']),
      requirement('interior', 'Interior photograph', 'The lobby, dining room or shared space guests use.', ['interior'], ['venue_photo', 'licensed_image']),
      requirement('rooms', 'Room or suite photograph', 'At least one room type a guest can book.', ['rooms'], ['venue_photo', 'licensed_image']),
      STAFF_REQUIREMENT,
    ],
  },
  {
    pattern: /restaurant|bakery|caf[eé]|bar\b|food|chop|eatery|catering/i,
    requirements: [
      LOGO_REQUIREMENT,
      requirement('interior', 'Interior photograph', 'The room a customer sits in.', ['interior'], ['venue_photo', 'licensed_image']),
      PRODUCT_REQUIREMENT,
      STAFF_REQUIREMENT,
    ],
  },
  {
    pattern: /boutique|retail|fashion|suit|bridal|showroom|furniture|shop|store/i,
    requirements: [
      LOGO_REQUIREMENT,
      requirement('interior', 'Shop or showroom photograph', 'How the products are presented in person.', ['interior'], ['venue_photo', 'licensed_image']),
      PRODUCT_REQUIREMENT,
      HERO_REQUIREMENT,
    ],
  },
  {
    pattern: /salon|spa|barber|beauty|nail|makeup|wellness/i,
    requirements: [
      LOGO_REQUIREMENT,
      requirement('interior', 'Treatment room photograph', 'The space a client is treated in.', ['interior'], ['venue_photo', 'licensed_image']),
      STAFF_REQUIREMENT,
      HERO_REQUIREMENT,
    ],
  },
  {
    pattern: /clinic|hospital|pharmacy|herbal|dental|medical|health/i,
    requirements: [
      LOGO_REQUIREMENT,
      requirement('exterior', 'Exterior or entrance photograph', 'How a patient recognises the premises.', ['exterior'], ['venue_photo', 'licensed_image']),
      requirement('interior', 'Interior photograph', 'A consulting or waiting area, without patients.', ['interior'], ['venue_photo', 'licensed_image']),
      STAFF_REQUIREMENT,
    ],
  },
  {
    pattern: /gym|fitness|training|academy|school|institution/i,
    requirements: [LOGO_REQUIREMENT, HERO_REQUIREMENT, STAFF_REQUIREMENT, PRODUCT_REQUIREMENT],
  },
  {
    pattern: /photograph|studio|creative|design|event/i,
    requirements: [
      LOGO_REQUIREMENT,
      requirement('gallery', 'Portfolio photograph', 'Work the business is proud to show.', ['gallery'], ['venue_photo', 'product_photo', 'licensed_image']),
      HERO_REQUIREMENT,
    ],
  },
];

/** The images this kind of business is normally expected to supply. Category is the only input. */
export function visualRequirementsFor(category: string | null | undefined): VisualRequirement[] {
  const set = REQUIREMENT_SETS.find((s) => s.pattern.test(category ?? ''));
  return set?.requirements ?? [LOGO_REQUIREMENT, HERO_REQUIREMENT, PRODUCT_REQUIREMENT];
}

export interface VisualRequirementStatus extends VisualRequirement {
  met: boolean;
  /** Files already in the vault that satisfy it, whether or not they are export-cleared. */
  matched: number;
  exportable: number;
}

export function visualRequirementStatus(requirements: VisualRequirement[], assets: StudioAsset[]): VisualRequirementStatus[] {
  return requirements.map((r) => {
    const matching = assets.filter((a) => r.assetKinds.includes(a.kind));
    const exportable = matching.filter((a) => a.status === 'approved' && assetExportProblems(a).length === 0);
    return { ...r, matched: matching.length, exportable: exportable.length, met: exportable.length > 0 };
  });
}

/** Lines for MISSING-RESOURCES.md: specific, category-aware, and never satisfied by a reference. */
export function missingVisualRequirements(business: Pick<Business, 'category'>, assets: StudioAsset[]): string[] {
  return visualRequirementStatus(visualRequirementsFor(business.category), assets)
    .filter((r) => !r.met)
    .map((r) => `${r.label}: ${r.detail}${r.matched ? ` (${r.matched} file${r.matched === 1 ? '' : 's'} in the vault, none export-cleared)` : ''}`);
}

