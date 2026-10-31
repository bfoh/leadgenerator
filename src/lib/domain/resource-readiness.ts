// Website Resource Kit readiness, and the visual references a kit may carry.
//
// A kit can always be downloaded, but an empty collection that looks like a finished pack wastes the
// reader's time: it says nothing about who the business is and contains no photograph to build with.
// This module answers one question honestly — what evidence does this prospect actually have? — and
// the same answer drives the readiness card, the pre-export review and manifest.json, so the screen
// and the ZIP can never disagree.
//
// Nothing here fetches, copies or scores anything. Google previews are counted as unavailable by
// definition: they are shown in the collector for the current session and are never an export input.
// A public image is likewise not a licensed one, so only a file in the vault that is approved with
// export permission and a current licence can be counted as usable.

import { resourceEntrySchema, restrictedResourceUrl, type ResourceEntry } from './business-resources';
import type { Tone } from './constants';
import { looksLikePlaceholderName } from './place-identity';
import {
  observationHasContactDetails,
  socialSourceHasContactDetails,
  type ResearchObservation,
  type BusinessSocialSource,
} from './social-research';
import { assetExportProblems, type StudioAsset, type StudioAssetKind } from './studio-assets';
import type { Business } from './types';

// ── What the ZIP always contains ─────────────────────────────────────────────

/** The documents every kit carries, whatever the evidence looks like. */
export const RESOURCE_KIT_DOCUMENTS = [
  'DEVELOPMENT-BRIEF.md',
  'MISSING-RESOURCES.md',
  'RESEARCH-BRIEF.md',
  'business-resources.json',
  'visual-references.json',
  'social-sources.json',
  'research-observations.json',
  'manifest.json',
] as const;

// ── Readiness ────────────────────────────────────────────────────────────────

export const KIT_READINESS_STATES = ['empty', 'research_pending', 'partial', 'ready'] as const;
export type KitReadinessState = (typeof KIT_READINESS_STATES)[number];

export const KIT_READINESS_META: Record<
  KitReadinessState,
  { label: string; tone: Tone; summary: string; incomplete: boolean }
> = {
  empty: {
    label: 'Empty',
    tone: 'neutral',
    summary: 'No export-permitted evidence yet: the kit holds the briefs and empty collections, nothing to build from.',
    incomplete: true,
  },
  research_pending: {
    label: 'Research pending',
    tone: 'warning',
    summary: 'Some material exists, but the business identity is not independently supported or too little evidence has been gathered.',
    incomplete: true,
  },
  partial: {
    label: 'Partial',
    tone: 'info',
    summary: 'Useful evidence exists, but a verified identity, a logo or original photography is still missing.',
    incomplete: true,
  },
  ready: {
    label: 'Ready',
    tone: 'success',
    summary: 'A verified identity, independent observations and an export-permitted logo and photograph are all present.',
    incomplete: false,
  },
};

// ── Identity standing ────────────────────────────────────────────────────────

/**
 * What supports the name on the record. A Google listing is deliberately absent from this list:
 * matching a listing establishes that a place exists, never that this record is independently named.
 */
export type IdentityStanding = 'verified' | 'recorded' | 'reference_only';

export const IDENTITY_STANDING_META: Record<IdentityStanding, { label: string; tone: Tone; description: string }> = {
  verified: {
    label: 'Independently supported',
    tone: 'success',
    description: 'A source of record or an independent identity observation supports the recorded name.',
  },
  recorded: {
    label: 'Recorded, unconfirmed',
    tone: 'warning',
    description: 'The name is recorded, but no independent source of record supports it yet.',
  },
  reference_only: {
    label: 'Reference only',
    tone: 'warning',
    description: 'Only a Google Place ID reference is recorded, so the name is a placeholder rather than a business identity.',
  },
};

export interface IdentityStandingSummary {
  standing: IdentityStanding;
  basis: string;
}

/**
 * The name stands on the record's own source URL, or on an identity observation someone verified.
 * A placeholder label stands on neither, however confident a Google match looked.
 */
export function identityStandingOf(
  business: Pick<Business, 'name' | 'sourceUrl'>,
  observations: Pick<ResearchObservation, 'category' | 'status' | 'revokedAt'>[],
): IdentityStandingSummary {
  const supported = observations.some(
    (o) => !o.revokedAt && o.category === 'identity' && ['independently_verified', 'owner_confirmed'].includes(o.status),
  );
  if (supported) return { standing: 'verified', basis: 'An independent identity observation is on file.' };
  if (looksLikePlaceholderName(business.name)) {
    return {
      standing: 'reference_only',
      basis: 'Only a Place ID reference is recorded. Use Identify this business to name it from an independent source.',
    };
  }
  if (business.sourceUrl && !restrictedResourceUrl(business.sourceUrl)) {
    return { standing: 'verified', basis: 'The record names an independent source of record.' };
  }
  return {
    standing: 'recorded',
    basis: 'The name was entered without an independent source of record, so it is not verified yet.',
  };
}

// ── Visual references ────────────────────────────────────────────────────────

export const VISUAL_REFERENCE_GROUPS = [
  'google_preview',
  'social_reference',
  'licensed_imagery',
  'business_owned',
  'concept_imagery',
] as const;
export type VisualReferenceGroupKey = (typeof VISUAL_REFERENCE_GROUPS)[number];

/** How a group may be used. Only `permitted` material may sit in a ZIP without a further decision. */
export type VisualReuse = 'preview_only' | 'link_only' | 'permitted' | 'illustrative';

export interface VisualGroupMeta {
  label: string;
  tone: Tone;
  description: string;
  rule: string;
  reuse: VisualReuse;
}

export const VISUAL_GROUP_META: Record<VisualReferenceGroupKey, VisualGroupMeta> = {
  google_preview: {
    label: 'Google Places previews',
    tone: 'neutral',
    description: 'Up to six official listing photos, shown one request at a time in the collector.',
    rule: 'Preview only. Nothing is copied, downloaded, stored, rehosted or exported, and only the Place ID is kept. Google attribution accompanies every preview.',
    reuse: 'preview_only',
  },
  social_reference: {
    label: 'Social-media references',
    tone: 'info',
    description: 'Public profile links recorded with a retention basis and verification status.',
    rule: 'Links and permitted metadata only. No Instagram, Facebook or TikTok image is fetched, downloaded or rehosted, and none is licensed for reuse by being public.',
    reuse: 'link_only',
  },
  licensed_imagery: {
    label: 'Independently licensed imagery',
    tone: 'accent',
    description: 'Files whose licence, rights holder, attribution and expiry are recorded in the vault.',
    rule: 'Included only when approved with export permission and a current licence. Publication is a separate permission.',
    reuse: 'permitted',
  },
  business_owned: {
    label: 'Business-owned photographs and branding',
    tone: 'success',
    description: 'Owner-supplied or commissioned logos, premises and product photographs.',
    rule: 'Included only when approved with export permission. Supplying a file does not grant publication, marketing consent or contact permission.',
    reuse: 'permitted',
  },
  concept_imagery: {
    label: 'Original concept imagery',
    tone: 'info',
    description: 'Original illustrative material made for private design work.',
    rule: 'Always labelled illustrative: never presented as the business’s actual premises, products, staff or customers.',
    reuse: 'illustrative',
  },
};

const IMAGE_KINDS: readonly StudioAssetKind[] = ['logo', 'brand_mark', 'product_photo', 'venue_photo', 'licensed_image', 'illustration'];
const LOGO_KINDS: readonly StudioAssetKind[] = ['logo', 'brand_mark'];

export const isVisualAsset = (asset: Pick<StudioAsset, 'kind'>) => IMAGE_KINDS.includes(asset.kind);

/** Whether the vault would include this file in a kit right now. */
export const assetExports = (asset: StudioAsset) => assetExportProblems(asset).length === 0;

export interface VisualGroupSummary {
  key: VisualReferenceGroupKey;
  label: string;
  tone: Tone;
  description: string;
  rule: string;
  reuse: VisualReuse;
  /** Files the kit may carry for this group. Always zero for previews and social references. */
  exportable: number;
  /** Links the kit may carry for this group. */
  links: number;
  /** Records that exist but would not be exported. */
  withheld: number;
}

export interface VisualInventory {
  groups: VisualGroupSummary[];
  /** Approved, export-permitted images of any kind. */
  images: number;
  logo: number;
  photography: number;
  licensedImages: number;
  conceptImages: number;
  /** Licensed images that name no licence, so their reuse cannot be shown. */
  licenceGaps: number;
}

const group = (key: VisualReferenceGroupKey, exportable: number, links: number, withheld: number): VisualGroupSummary => ({
  key,
  ...VISUAL_GROUP_META[key],
  exportable,
  links,
  withheld,
});

/**
 * The five kinds of visual material, with what the kit would carry from each. Revoked records and
 * files that fail the export rules are counted as withheld rather than quietly dropped.
 */
export function visualResourceInventory(input: { socialSources: BusinessSocialSource[]; assets: StudioAsset[] }): VisualInventory {
  const activeSources = input.socialSources.filter((s) => !s.revokedAt);
  const linkableSources = activeSources.filter((s) => !socialSourceHasContactDetails(s));

  const images = input.assets.filter(isVisualAsset);
  const exportable = images.filter(assetExports);

  // Withheld files stay with the group they belong to, so the card never blames the wrong source for
  // a missing permission: an unapproved shopfront photograph is a business-owned gap, not a licence gap.
  const conceptAll = images.filter((a) => a.kind === 'illustration' && a.origin === 'our_work');
  const licensedAll = images.filter((a) => a.kind === 'licensed_image');
  const ownedAll = images.filter((a) => !conceptAll.includes(a) && !licensedAll.includes(a));
  const exported = (list: StudioAsset[]) => list.filter(assetExports);
  const withheld = (list: StudioAsset[]) => list.length - exported(list).length;

  const concept = exported(conceptAll);
  const licensed = exported(licensedAll);
  const owned = exported(ownedAll);
  const logo = owned.filter((a) => LOGO_KINDS.includes(a.kind));
  const photography = exportable.filter((a) => !LOGO_KINDS.includes(a.kind));

  return {
    groups: [
      group('google_preview', 0, 0, 0),
      group('social_reference', 0, linkableSources.length, activeSources.length - linkableSources.length),
      group('licensed_imagery', licensed.length, 0, withheld(licensedAll)),
      group('business_owned', owned.length, 0, withheld(ownedAll)),
      group('concept_imagery', concept.length, 0, withheld(conceptAll)),
    ],
    images: exportable.length,
    logo: logo.length,
    photography: photography.length,
    licensedImages: licensed.length,
    conceptImages: concept.length,
    licenceGaps: licensed.filter((a) => !a.licenceName?.trim()).length,
  };
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface MissingResource {
  key: string;
  label: string;
  detail: string;
}

export interface KitReadinessInput {
  business: Business;
  resources: ResourceEntry[];
  socialSources: BusinessSocialSource[];
  observations: ResearchObservation[];
  assets: StudioAsset[];
  /** Whether a vault exists at all, so "nothing uploaded" can be told apart from "nothing opened". */
  hasVault: boolean;
}

export interface KitReadiness {
  state: KitReadinessState;
  label: string;
  tone: Tone;
  summary: string;
  /** False whenever the ZIP is incomplete, which the screen and manifest both state. */
  complete: boolean;
  identity: IdentityStandingSummary;
  visual: VisualInventory;
  counts: {
    resources: number;
    observations: number;
    socialReferences: number;
    images: number;
    logo: number;
    photography: number;
  };
  missing: MissingResource[];
  permissionGaps: string[];
  studio: { ready: boolean; reason: string };
}

/** The export-permitted independent entries, exactly as the kit filters them. */
export function exportableResourceEntries(resources: ResourceEntry[]): ResourceEntry[] {
  return resources.filter(
    (v) => !v.revokedAt && v.exportPermission === 'granted' && resourceEntrySchema.safeParse(v).success && !restrictedResourceUrl(v.sourceUrl),
  );
}

/** Independent observations a kit may carry: no contact channels, no contact details. */
export function exportableObservations(observations: ResearchObservation[]): ResearchObservation[] {
  return observations.filter((o) => !o.revokedAt && o.category !== 'contact_channel' && !observationHasContactDetails(o));
}

/**
 * Grades the evidence behind a kit. The ladder is deliberately conservative: `ready` needs a
 * verified identity, a readable observation and both a logo and a photograph with export rights,
 * because that is the point at which a designer can work without inventing facts or images.
 */
export function kitReadiness(input: KitReadinessInput): KitReadiness {
  const activeResources = input.resources.filter((v) => !v.revokedAt);
  const resources = exportableResourceEntries(input.resources);
  const observations = exportableObservations(input.observations);
  const activeSources = input.socialSources.filter((s) => !s.revokedAt);
  const socialReferences = activeSources.filter((s) => !socialSourceHasContactDetails(s));
  const visual = visualResourceInventory({ socialSources: input.socialSources, assets: input.assets });
  const identity = identityStandingOf(input.business, input.observations);

  const missing: MissingResource[] = [];
  if (identity.standing !== 'verified') {
    missing.push({ key: 'identity', label: 'Verified business identity', detail: identity.basis });
  }
  if (visual.logo === 0) {
    missing.push({ key: 'logo', label: 'Logo', detail: 'An approved logo or brand mark with export permission.' });
  }
  if (!visual.groups.some((g) => g.key === 'business_owned' && g.exportable > 0) && visual.licensedImages === 0) {
    missing.push({
      key: 'photography',
      label: 'Photography',
      detail: 'Photographs you may use: a product or service photograph, a venue or team photograph, and a licensed image with its licence recorded.',
    });
  }
  if (!observations.some((o) => o.category === 'product_service')) {
    missing.push({ key: 'services', label: 'Services or products', detail: 'An evidence-backed list of what the business actually offers.' });
  }
  for (const [key, label, value] of [
    ['website', 'Official website', input.business.officialWebsite],
    ['phone', 'Phone', input.business.phone],
    ['address', 'Address', input.business.address],
    ['location', 'Town', input.business.city],
  ] as const) {
    if (!value?.trim()) missing.push({ key, label, detail: `The ${label.toLowerCase()} is still unknown.` });
  }

  const permissionGaps: string[] = [];
  const blockedImages = input.assets.filter(isVisualAsset).length - visual.images;
  if (blockedImages > 0) {
    permissionGaps.push(
      `${blockedImages} file${blockedImages === 1 ? '' : 's'} in the vault cannot be exported: approval, export permission or a current licence is missing.`,
    );
  }
  const withheldResources = activeResources.length - resources.length;
  if (withheldResources > 0) {
    permissionGaps.push(
      `${withheldResources} independent entr${withheldResources === 1 ? 'y is' : 'ies are'} withheld: export permission was not granted, the entry was revoked, or its source is not independent.`,
    );
  }
  const withheldSources = activeSources.length - socialReferences.length;
  if (withheldSources > 0) {
    permissionGaps.push(
      `${withheldSources} social reference${withheldSources === 1 ? ' is' : 's are'} withheld because the link or its evidence carries contact details.`,
    );
  }
  if (visual.licenceGaps > 0) {
    permissionGaps.push(
      `${visual.licenceGaps} licensed image${visual.licenceGaps === 1 ? ' has' : 's have'} no recorded licence, so the reuse cannot be shown.`,
    );
  }
  if (!input.hasVault) {
    permissionGaps.push('No Asset Vault has been opened for this prospect, so no authorized file can be supplied yet.');
  }

  const studioReady =
    identity.standing === 'verified' && (observations.length > 0 || resources.some((r) => ['service', 'product'].includes(r.category)));
  const studio = {
    ready: studioReady,
    reason: studioReady
      ? 'Studio can start from supported facts: the identity and at least one observation or offering are recorded.'
      : 'Studio waits for a verified identity and at least one independent observation or offering.',
  };

  const evidenceTotal = resources.length + observations.length + socialReferences.length + visual.images;
  let state: KitReadinessState;
  if (evidenceTotal === 0) state = 'empty';
  else if (identity.standing === 'reference_only' || (observations.length === 0 && visual.images === 0)) state = 'research_pending';
  else if (identity.standing === 'verified' && observations.length > 0 && visual.logo > 0 && visual.photography > 0) state = 'ready';
  else state = 'partial';

  const meta = KIT_READINESS_META[state];
  return {
    state,
    label: meta.label,
    tone: meta.tone,
    summary: meta.summary,
    complete: !meta.incomplete,
    identity,
    visual,
    counts: {
      resources: resources.length,
      observations: observations.length,
      socialReferences: socialReferences.length,
      images: visual.images,
      logo: visual.logo,
      photography: visual.photography,
    },
    missing,
    permissionGaps,
    studio,
  };
}

// ── The visual-reference sheet a kit carries ─────────────────────────────────

export interface VisualReferenceAsset {
  path: string;
  fileName: string;
  kind: string;
  origin: string;
  licence: { name: string | null; reference: string | null; expiresOn: string | null } | null;
  attribution: { required: boolean; text: string | null } | null;
}

export interface VisualReferenceSheet {
  format: 'dof-visual-references/1';
  generatedAt: string;
  businessId: string;
  groups: {
    key: VisualReferenceGroupKey;
    label: string;
    reuse: VisualReuse;
    rule: string;
    included: boolean;
    links: { platform: string; profileUrl: string; status: string }[];
    files: VisualReferenceAsset[];
    withheld: number;
  }[];
  excluded: { googlePreviews: true; socialImages: true; unapprovedFiles: number; note: string };
}

/**
 * What a kit records about visual material: permitted references and the files it carries, with the
 * groups it deliberately leaves out. Google previews and social images are never references to
 * include, only to describe as refused.
 */
export function visualReferenceSheet(input: {
  businessId: string;
  generatedAt: string;
  readiness: KitReadiness;
  socialSources: BusinessSocialSource[];
  assets: VisualReferenceAsset[];
  unapprovedFiles: number;
}): VisualReferenceSheet {
  const linkable = input.socialSources.filter((s) => !s.revokedAt && !socialSourceHasContactDetails(s));
  const filesFor = (key: VisualReferenceGroupKey) => {
    if (key === 'licensed_imagery') return input.assets.filter((a) => a.kind === 'licensed_image');
    if (key === 'concept_imagery') return input.assets.filter((a) => a.kind === 'illustration' && a.origin === 'our_work');
    if (key === 'business_owned') {
      return input.assets.filter((a) => a.kind !== 'licensed_image' && !(a.kind === 'illustration' && a.origin === 'our_work'));
    }
    return [];
  };

  return {
    format: 'dof-visual-references/1',
    generatedAt: input.generatedAt,
    businessId: input.businessId,
    groups: input.readiness.visual.groups.map((g) => ({
      key: g.key,
      label: g.label,
      reuse: g.reuse,
      rule: g.rule,
      included: g.reuse === 'permitted' || g.reuse === 'illustrative' || (g.reuse === 'link_only' && g.links > 0),
      links:
        g.key === 'social_reference'
          ? linkable.map((s) => ({ platform: s.platform, profileUrl: s.profileUrl, status: s.verificationStatus }))
          : [],
      files: filesFor(g.key),
      withheld: g.withheld,
    })),
    excluded: {
      googlePreviews: true,
      socialImages: true,
      unapprovedFiles: input.unapprovedFiles,
      note: 'Google previews are shown only in the collector and are never exported. No social image is downloaded or included, and no image is included without approval, export permission and a current licence.',
    },
  };
}
