// Social research intelligence. A profile URL reached through a public index is a review lead, not a
// licensed business record. This module keeps the retained material to references and permitted
// metadata: the canonical profile URL, the lawful retention basis, the verification status and a
// person's observations. Search titles, snippets, rankings, profile content and images never enter it.

import { z } from 'zod';
import { googleHostedUrl, restrictedResourceUrl } from './business-resources';
import { SOCIAL_DISCOVERY_LABELS, parseSocialProfileUrl, profileUrlFor, type SocialDiscoveryPlatform } from './social-discovery';
import type { Business } from './types';

export const SOCIAL_SOURCE_PROVENANCES = ['independent_observation', 'owner_supplied', 'licensed_directory', 'official_website'] as const;
export type SocialSourceProvenance = (typeof SOCIAL_SOURCE_PROVENANCES)[number];

/** The lawful reason the profile link may be kept, independent of an ordinary search response. */
export const SOCIAL_RETENTION_BASES = ['first_party_observation', 'owner_supplied', 'licensed_directory', 'official_website'] as const;
export type SocialRetentionBasis = (typeof SOCIAL_RETENTION_BASES)[number];

export const SOCIAL_VERIFICATION_STATUSES = ['observed', 'independently_verified', 'owner_confirmed'] as const;
export type SocialVerificationStatus = (typeof SOCIAL_VERIFICATION_STATUSES)[number];

export const SOCIAL_SOURCE_PROVENANCE_LABELS: Record<SocialSourceProvenance, string> = {
  independent_observation: 'Observed on the public profile',
  owner_supplied: 'Supplied by the business',
  licensed_directory: 'Licensed directory',
  official_website: 'Linked from the official website',
};

export const SOCIAL_RETENTION_BASIS_LABELS: Record<SocialRetentionBasis, string> = {
  first_party_observation: 'I opened the profile and confirmed it belongs to this business',
  owner_supplied: 'The business supplied the profile link',
  licensed_directory: 'A licensed directory supplied the profile link',
  official_website: 'The link appears on the business’s official website',
};

export const SOCIAL_RETENTION_BASIS_HELP: Record<SocialRetentionBasis, string> = {
  first_party_observation:
    'The profile itself is first-party material. Nothing from the search result — title, snippet or ranking — is saved.',
  owner_supplied: 'The business gave the link. This is also recorded as owner confirmation of the account.',
  licensed_directory: 'The directory licence permits storing the link and handle. Record the licence as evidence.',
  official_website: 'The business publishes the link on its own site. Record where on the site you found it.',
};

export const SOCIAL_VERIFICATION_META: Record<SocialVerificationStatus, { label: string; tone: 'warning' | 'success' }> = {
  observed: { label: 'Observed', tone: 'warning' },
  independently_verified: { label: 'Independently verified', tone: 'success' },
  owner_confirmed: { label: 'Owner confirmed', tone: 'success' },
};

const PROVENANCE_FOR_BASIS: Record<SocialRetentionBasis, SocialSourceProvenance> = {
  first_party_observation: 'independent_observation',
  owner_supplied: 'owner_supplied',
  licensed_directory: 'licensed_directory',
  official_website: 'official_website',
};

const STATUS_FOR_BASIS: Record<SocialRetentionBasis, SocialVerificationStatus> = {
  first_party_observation: 'observed',
  owner_supplied: 'owner_confirmed',
  licensed_directory: 'independently_verified',
  official_website: 'independently_verified',
};

export function provenanceForBasis(basis: SocialRetentionBasis): SocialSourceProvenance {
  return PROVENANCE_FOR_BASIS[basis];
}

export function verificationStatusForBasis(basis: SocialRetentionBasis): SocialVerificationStatus {
  return STATUS_FOR_BASIS[basis];
}

/** Evidence text for a basis that asserts verification. Observed profiles need none. */
export function evidenceForBasis(basis: SocialRetentionBasis, capturedBy: string, at = new Date()): string | null {
  const when = at.toISOString().slice(0, 10);
  if (basis === 'owner_supplied') return `Profile link supplied by the business and recorded by ${capturedBy} on ${when}.`;
  if (basis === 'licensed_directory') return `Profile link obtained under a licensed directory and recorded by ${capturedBy} on ${when}.`;
  if (basis === 'official_website') return `Profile link published on the business's own website and recorded by ${capturedBy} on ${when}.`;
  return null;
}

export interface BusinessSocialSource {
  id: string;
  organizationId: string;
  businessId: string;
  platform: SocialDiscoveryPlatform;
  handle: string;
  profileUrl: string;
  provenance: SocialSourceProvenance;
  retentionBasis: SocialRetentionBasis;
  verificationStatus: SocialVerificationStatus;
  verificationEvidence: string | null;
  capturedBy: string | null;
  capturedAt: string;
  verifiedAt: string | null;
  revokedAt: string | null;
}

export interface SocialSourceInsert {
  businessId: string;
  platform: SocialDiscoveryPlatform;
  handle: string;
  profileUrl: string;
  provenance: SocialSourceProvenance;
  retentionBasis: SocialRetentionBasis;
  verificationStatus: SocialVerificationStatus;
  verificationEvidence: string | null;
}


export const socialSourceInsertSchema = z
  .object({
    businessId: z.uuid(),
    platform: z.enum(['instagram', 'facebook', 'tiktok']),
    handle: z.string().trim().min(2).max(80),
    profileUrl: z.string().trim().min(10).max(2000),
    provenance: z.enum(SOCIAL_SOURCE_PROVENANCES),
    retentionBasis: z.enum(SOCIAL_RETENTION_BASES),
    verificationStatus: z.enum(SOCIAL_VERIFICATION_STATUSES),
    verificationEvidence: z.string().trim().max(1000).nullable(),
  })
  .superRefine((value, ctx) => {
    const parsed = parseSocialProfileUrl(value.profileUrl);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', path: ['profileUrl'], message: 'Use a public Instagram, Facebook or TikTok profile URL.' });
    } else {
      if (parsed.platform !== value.platform) {
        ctx.addIssue({ code: 'custom', path: ['platform'], message: 'The platform does not match the profile URL.' });
      }
      if (profileUrlFor(parsed.platform, parsed.handle) !== value.profileUrl) {
        ctx.addIssue({ code: 'custom', path: ['profileUrl'], message: 'Use the canonical profile URL, without query text or a post path.' });
      }
      if (handleOf(value.handle) !== handleOf(parsed.handle)) {
        ctx.addIssue({ code: 'custom', path: ['handle'], message: 'The handle does not match the profile URL.' });
      }
    }
    if (value.provenance !== PROVENANCE_FOR_BASIS[value.retentionBasis]) {
      ctx.addIssue({ code: 'custom', path: ['provenance'], message: 'The provenance does not match the retention basis.' });
    }
    // A claimed basis and a claimed status are one claim. A first-party observation cannot arrive
    // already "owner confirmed"; verification only advances afterwards, with evidence.
    if (value.verificationStatus !== STATUS_FOR_BASIS[value.retentionBasis]) {
      ctx.addIssue({
        code: 'custom',
        path: ['verificationStatus'],
        message: 'A source starts at the status its retention basis supports; verification can only move forward afterwards.',
      });
    }
    if (value.verificationStatus !== 'observed' && (!value.verificationEvidence || value.verificationEvidence.length < 15)) {
      ctx.addIssue({ code: 'custom', path: ['verificationEvidence'], message: 'Say who confirmed the profile, when and how.' });
    }
    if (value.verificationStatus === 'observed' && value.verificationEvidence) {
      ctx.addIssue({ code: 'custom', path: ['verificationEvidence'], message: 'An observed profile is not yet verified; leave the evidence blank.' });
    }
  })
  // The database stores an undecorated, lower-case handle (migration 017 checks it). Normalising
  // here keeps the store, the service-level duplicate check and the database's unique index aligned,
  // so `@StoreDup` and `storedup` cannot become two different profiles.
  .transform((value) => ({ ...value, handle: value.handle.replace(/^@/, '').toLowerCase() }));

export const RESEARCH_OBSERVATION_CATEGORIES = [
  'identity',
  'description',
  'location',
  'product_service',
  'contact_channel',
  'logo_reference',
  'photo_reference',
  'colour',
  'typography',
  'visual_style',
  'missing_information',
] as const;
export type ResearchObservationCategory = (typeof RESEARCH_OBSERVATION_CATEGORIES)[number];

export const RESEARCH_CATEGORY_LABELS: Record<ResearchObservationCategory, string> = {
  identity: 'Business identity',
  description: 'Business description',
  location: 'Claimed location',
  product_service: 'Product or service',
  contact_channel: 'Contact channel',
  logo_reference: 'Logo reference',
  photo_reference: 'Photography reference',
  colour: 'Colour observation',
  typography: 'Typography observation',
  visual_style: 'Visual-style observation',
  missing_information: 'Missing information',
};

export const RESEARCH_OBSERVATION_SOURCE_KINDS = ['social_profile', 'official_website', 'business_owner', 'licensed_directory', 'research_gap'] as const;
export type ResearchObservationSourceKind = (typeof RESEARCH_OBSERVATION_SOURCE_KINDS)[number];

export const RESEARCH_SOURCE_LABELS: Record<ResearchObservationSourceKind, string> = {
  social_profile: 'Public social profile',
  official_website: 'Official website',
  business_owner: 'Business owner',
  licensed_directory: 'Licensed directory',
  research_gap: 'Research gap',
};

export interface ResearchObservation {
  id: string;
  organizationId: string;
  businessId: string;
  category: ResearchObservationCategory;
  statement: string;
  sourceKind: ResearchObservationSourceKind;
  sourceUrl: string | null;
  status: SocialVerificationStatus;
  evidence: string | null;
  capturedBy: string | null;
  capturedAt: string;
  revokedAt: string | null;
}

export interface ResearchObservationInsert {
  businessId: string;
  category: ResearchObservationCategory;
  statement: string;
  sourceKind: ResearchObservationSourceKind;
  sourceUrl: string | null;
  status: SocialVerificationStatus;
  evidence: string | null;
}

export const researchObservationInsertSchema = z
  .object({
    businessId: z.uuid(),
    category: z.enum(RESEARCH_OBSERVATION_CATEGORIES),
    statement: z.string().trim().min(5, 'Describe what was observed in at least five characters.').max(1000),
    sourceKind: z.enum(RESEARCH_OBSERVATION_SOURCE_KINDS),
    sourceUrl: z.string().trim().max(2000).nullable(),
    status: z.enum(SOCIAL_VERIFICATION_STATUSES),
    evidence: z.string().trim().max(1000).nullable(),
  })
  .superRefine((value, ctx) => {
    const gap = value.category === 'missing_information';
    if (gap !== (value.sourceKind === 'research_gap')) {
      ctx.addIssue({ code: 'custom', path: ['sourceKind'], message: 'A research gap is the only entry without a source.' });
    }
    if (gap && value.status !== 'observed') {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'A missing-information note is never verified.' });
    }
    if (value.sourceUrl && !/^https?:\/\//i.test(value.sourceUrl)) {
      ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Use a full http(s) source link.' });
    }
    if (value.sourceKind === 'research_gap' && value.sourceUrl) {
      ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'A research gap has no source link.' });
    }
    if (value.sourceKind === 'official_website' || value.sourceKind === 'licensed_directory') {
      if (value.sourceUrl && restrictedResourceUrl(value.sourceUrl)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sourceUrl'],
          message: 'Use the business’s own website or a licensed source, not Google or a social platform.',
        });
      }
    }
    if (value.sourceKind === 'business_owner' && value.sourceUrl && googleHostedUrl(value.sourceUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'A Google listing is not an independent source; use the owner’s own link or leave it blank.',
      });
    }
    if (value.sourceKind === 'social_profile') {
      const parsed = value.sourceUrl ? parseSocialProfileUrl(value.sourceUrl) : null;
      if (!parsed) ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Use a public Instagram, Facebook or TikTok profile URL.' });
    } else if (value.sourceKind !== 'business_owner' && value.sourceKind !== 'research_gap' && !value.sourceUrl) {
      ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'This source needs a link.' });
    }
    if (value.status !== 'observed' && (!value.evidence || value.evidence.length < 15)) {
      ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'Say who confirmed this, when and how.' });
    }
  })
  .transform((value) => ({
    ...value,
    sourceUrl: value.sourceKind === 'social_profile' && value.sourceUrl ? (parseSocialProfileUrl(value.sourceUrl)?.profileUrl ?? value.sourceUrl) : value.sourceUrl,
  }));

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const ENCODED_EMAIL_PATTERN = /[\w.+-]+%40[\w-]+(?:\.[\w.-]+)+/i;
const PHONE_PATTERN = /\+?\d[\d\s().-]{6,}\d/g;
const ENCODED_PHONE_PATTERN = /(?:%2B|\+)?\d[\d\s().%-]{6,}\d/gi;
const ISO_DATE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_URL_PUNCTUATION = /[.,;:!?)\]}]+$/;
// A direct chat or messaging link is a contact channel even when the number is not in the URL
// (for example `wa.me/message/...` or a Telegram username).
const CONTACT_URL_HOSTS = /(^|\.)(wa\.me|api\.whatsapp\.com|whatsapp\.com|t\.me|telegram\.me|m\.me|messenger\.com)$/i;
const digitCount = (value: string) => (value.match(/\d/g) ?? []).length;
const phoneLike = (value: string) => digitCount(value) >= 8 && !ISO_DATE.test(value.trim());
const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const rawContact = (text: string) =>
  EMAIL_PATTERN.test(text) || (text.match(PHONE_PATTERN) ?? []).some(phoneLike);
const isContactUrl = (raw: string) => {
  const candidate = raw.replace(TRAILING_URL_PUNCTUATION, '');
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    if (CONTACT_URL_HOSTS.test(host)) return true;
    // A query string can carry an email or phone, including percent-encoded forms.
    return rawContact(safeDecode(candidate));
  } catch {
    return false;
  }
};
const hasContactUrl = (text: string) => (text.match(URL_PATTERN) ?? []).some(isContactUrl);

/**
 * A research note is not a contact export. Emails, phone-like numbers and direct messaging links are
 * detected here so the Resource Kit can withhold the note or redact evidence; a false positive
 * withholds a note, which is safer than publishing somebody's number in a ZIP.
 */
export function containsContactDetails(text: string): boolean {
  const decoded = safeDecode(text);
  return (
    rawContact(text) ||
    rawContact(decoded) ||
    hasContactUrl(text) ||
    hasContactUrl(decoded)
  );
}

/** Redacts emails, phone-like numbers and contact links from evidence that otherwise stays readable. */
export function redactContactDetails(text: string): string {
  return text
    .replace(URL_PATTERN, (url) => (isContactUrl(url) ? '[contact link withheld]' : url))
    .replace(ENCODED_EMAIL_PATTERN, '[email withheld]')
    .replace(new RegExp(EMAIL_PATTERN.source, 'g'), '[email withheld]')
    .replace(ENCODED_PHONE_PATTERN, (match) => (phoneLike(match) ? '[phone withheld]' : match))
    .replace(PHONE_PATTERN, (match) => (phoneLike(match) ? '[phone withheld]' : match));
}

/**
 * An observation carries contact material when the statement, evidence or source URL does. The
 * source URL is included because a `wa.me` link, a messaging handle or a query-string address is just
 * as exportable as a number in the note itself.
 */
export function observationHasContactDetails(
  observation: Pick<ResearchObservation, 'statement' | 'evidence' | 'sourceUrl'>,
): boolean {
  return containsContactDetails(
    `${observation.statement} ${observation.evidence ?? ''} ${observation.sourceUrl ?? ''}`,
  );
}

/**
 * Some businesses use a phone number as their profile handle. The canonical URL then carries the
 * number too, so the reference itself is contact material and cannot go into an export. The row
 * stays in the collector, where the stated retention basis governs it.
 */
export function socialSourceHasContactDetails(
  source: Pick<BusinessSocialSource, 'handle' | 'profileUrl'>,
): boolean {
  return containsContactDetails(`${source.handle} ${source.profileUrl}`);
}

/** Verification moves forward only; a downgrade is a new record, not an edit. */
export function canAdvanceVerification(from: SocialVerificationStatus, to: SocialVerificationStatus): boolean {
  return SOCIAL_VERIFICATION_STATUSES.indexOf(to) > SOCIAL_VERIFICATION_STATUSES.indexOf(from);
}

export const RESEARCH_GROUPS = ['identity', 'social', 'location', 'offering', 'contact', 'visual', 'missing'] as const;
export type ResearchGroup = (typeof RESEARCH_GROUPS)[number];

export const RESEARCH_GROUP_LABELS: Record<ResearchGroup, string> = {
  identity: 'Business identity and description',
  social: 'Social sources',
  location: 'Claimed location',
  offering: 'Products and services',
  contact: 'Contact channels',
  visual: 'Logo, photography and visual style',
  missing: 'Missing information and next verification steps',
};

export interface SocialResearchItem {
  key: string;
  label: string;
  value: string;
  sourceUrl: string | null;
  sourceLabel: string;
  status: SocialVerificationStatus;
  note: string | null;
}

export interface SocialResearchGroup {
  key: ResearchGroup;
  label: string;
  items: SocialResearchItem[];
}

export interface SocialResearch {
  groups: SocialResearchGroup[];
  sources: BusinessSocialSource[];
  observations: ResearchObservation[];
  missing: string[];
}

const locationLabel = (business: Business) =>
  [business.neighborhood, business.city, business.region, business.country].filter(Boolean).join(', ') || 'Not recorded';

const observationItem = (observation: ResearchObservation): SocialResearchItem => ({
  key: `observation-${observation.id}`,
  label: RESEARCH_CATEGORY_LABELS[observation.category],
  value: observation.statement,
  sourceUrl: observation.sourceUrl,
  sourceLabel: RESEARCH_SOURCE_LABELS[observation.sourceKind],
  status: observation.status,
  note: observation.evidence,
});

/**
 * Builds the Resource Collector's research view from recorded sources and observations plus the
 * CRM's own fields. Nothing is inferred as verified: an unverified website, a search-region hint and
 * a phone number typed into the CRM stay "Observed" until an independent source says otherwise.
 */
export function buildSocialResearch(business: Business, sources: BusinessSocialSource[], observations: ResearchObservation[]): SocialResearch {
  const activeSources = sources.filter((s) => !s.revokedAt);
  const activeObservations = observations.filter((o) => !o.revokedAt);
  const verifiedWebsite = business.websiteStatus === 'verified_official';
  const primarySource = activeSources[0] ?? null;
  const recordSourceUrl = business.officialWebsite ?? primarySource?.profileUrl ?? null;
  const recordSourceLabel = business.officialWebsite ? 'Official website' : primarySource ? `${SOCIAL_DISCOVERY_LABELS[primarySource.platform]} profile` : 'CRM record';
  const observationsIn = (...categories: ResearchObservationCategory[]) => activeObservations.filter((o) => categories.includes(o.category)).map(observationItem);

  const identity: SocialResearchItem[] = [
    {
      key: 'business-name',
      label: 'Business name',
      value: business.name,
      sourceUrl: recordSourceUrl,
      sourceLabel: recordSourceLabel,
      status: verifiedWebsite ? 'independently_verified' : 'observed',
      note: verifiedWebsite ? null : 'Recorded from a review lead; confirm the trading name independently.',
    },
    ...observationsIn('identity', 'description'),
  ];

  const social: SocialResearchItem[] = activeSources.map((source) => ({
    key: `source-${source.id}`,
    label: SOCIAL_DISCOVERY_LABELS[source.platform],
    value: `@${source.handle}`,
    sourceUrl: source.profileUrl,
    sourceLabel: SOCIAL_SOURCE_PROVENANCE_LABELS[source.provenance],
    status: source.verificationStatus,
    note:
      source.verificationEvidence ??
      'A social profile on its own does not establish ownership, operating status or permission to contact.',
  }));

  const location: SocialResearchItem[] = [
    {
      key: 'claimed-location',
      label: 'Claimed location',
      value: locationLabel(business),
      sourceUrl: primarySource?.profileUrl ?? null,
      sourceLabel: primarySource ? `${SOCIAL_DISCOVERY_LABELS[primarySource.platform]} profile / search hint` : 'Search hint',
      status: 'observed',
      note: 'A search-region setting or a profile location is a hint, not a verified business address.',
    },
    ...observationsIn('location'),
  ];

  const offering: SocialResearchItem[] = [
    {
      key: 'category',
      label: 'Claimed category',
      value: business.category,
      sourceUrl: recordSourceUrl,
      sourceLabel: recordSourceLabel,
      status: verifiedWebsite ? 'independently_verified' : 'observed',
      note: 'Category is a search and research hint until the business confirms its services.',
    },
    ...observationsIn('product_service'),
  ];


  const contact: SocialResearchItem[] = [
    ...(business.officialWebsite
      ? [{
          key: 'website',
          label: 'Official website',
          value: business.officialWebsite,
          sourceUrl: business.officialWebsite,
          sourceLabel: 'Recorded website',
          status: (verifiedWebsite ? 'independently_verified' : 'observed') as SocialVerificationStatus,
          note: verifiedWebsite ? null : 'Website status is not yet verified.',
        }]
      : []),
    ...(business.phone
      ? [{ key: 'phone', label: 'Phone reference', value: business.phone, sourceUrl: null, sourceLabel: 'CRM record', status: 'observed' as const, note: 'A published number is not permission to call or message.' }]
      : []),
    ...(business.email
      ? [{ key: 'email', label: 'Email reference', value: business.email, sourceUrl: null, sourceLabel: 'CRM record', status: 'observed' as const, note: 'A published address is not permission to send outreach.' }]
      : []),
    ...(business.enquiryChannel
      ? [{ key: 'enquiry', label: 'Enquiry channel', value: business.enquiryChannel, sourceUrl: null, sourceLabel: 'CRM record', status: 'observed' as const, note: 'Confirm the current channel and permission with the owner.' }]
      : []),
    {
      key: 'contact-permission',
      label: 'Contact permission',
      value: business.contactPermission.replace(/_/g, ' '),
      sourceUrl: null,
      sourceLabel: 'Consent record',
      status: 'observed',
      note: 'Social profile evidence never establishes contact consent.',
    },
    ...observationsIn('contact_channel'),
  ];

  const visual: SocialResearchItem[] = observationsIn('logo_reference', 'photo_reference', 'colour', 'typography', 'visual_style');
  const missing = missingResources(business, activeSources, activeObservations);
  const missingGroup: SocialResearchItem[] = missing.map((statement, index) => ({
    key: `missing-${index}`,
    label: 'Next verification step',
    value: statement,
    sourceUrl: null,
    sourceLabel: 'Research gap',
    status: 'observed',
    note: null,
  }));

  const groups: SocialResearchGroup[] = [
    { key: 'identity', label: RESEARCH_GROUP_LABELS.identity, items: identity },
    { key: 'social', label: RESEARCH_GROUP_LABELS.social, items: social },
    { key: 'location', label: RESEARCH_GROUP_LABELS.location, items: location },
    { key: 'offering', label: RESEARCH_GROUP_LABELS.offering, items: offering },
    { key: 'contact', label: RESEARCH_GROUP_LABELS.contact, items: contact },
    ...(visual.length ? [{ key: 'visual' as const, label: RESEARCH_GROUP_LABELS.visual, items: visual }] : []),
    { key: 'missing', label: RESEARCH_GROUP_LABELS.missing, items: missingGroup },
  ];

  return { groups, sources: activeSources, observations: activeObservations, missing };
}

/** What a developer still needs before a manual website can be built responsibly. */
export function missingResources(
  business: Business,
  sources: BusinessSocialSource[],
  observations: ResearchObservation[],
): string[] {
  const verified = (status: SocialVerificationStatus) => status !== 'observed';
  const hasCategory = (category: ResearchObservationCategory) => observations.some((o) => o.category === category && verified(o.status));
  const missing: string[] = [];
  if (business.websiteStatus !== 'verified_official') missing.push('An independently verified official website.');
  if (!sources.some((s) => s.verificationStatus === 'owner_confirmed')) missing.push('Owner confirmation of the social profile.');
  if (!observations.some((o) => o.category === 'location' && verified(o.status))) missing.push('A verified address or service area.');
  if (!business.phone && !business.email && !business.officialWebsite) missing.push('At least one contact channel recorded from a permitted source.');
  if (business.contactPermission !== 'granted') missing.push('Recorded contact permission before any outreach.');
  if (!hasCategory('product_service')) missing.push('A confirmed product or service list.');
  if (!hasCategory('logo_reference')) missing.push('An approved logo reference with reuse rights.');
  if (!hasCategory('photo_reference')) missing.push('Approved original product photography.');
  if (!observations.some((o) => ['colour', 'typography', 'visual_style'].includes(o.category))) missing.push('Brand colour, typography and visual-style observations with provenance.');
  missing.push('Independent verification of the business before its qualification stage advances.');
  missing.push('Owner confirmation of publication rights before publishing any claim.');
  return missing;
}


const briefLine = (item: SocialResearchItem) =>
  `- **${item.label}:** ${redactContactDetails(item.value)} — ${SOCIAL_VERIFICATION_META[item.status].label}; source: ${item.sourceLabel}${item.sourceUrl ? ` (${redactContactDetails(item.sourceUrl)})` : ''}${item.note ? `; ${redactContactDetails(item.note)}` : ''}`;

/** Markdown research brief included in the Website Resource Kit. References only, never content. */
export function socialResearchBrief(
  business: Business,
  sources: BusinessSocialSource[],
  observations: ResearchObservation[],
  generatedAt = new Date(),
): string {
  const research = buildSocialResearch(business, sources, observations);
  const withheldObservationKeys = new Set(
    research.observations
      .filter((o) => o.category === 'contact_channel' || observationHasContactDetails(o))
      .map((o) => `observation-${o.id}`),
  );
  const lines = [
    '# Social resource research brief',
    '',
    `Business: ${redactContactDetails(business.name)}`,
    `Generated: ${generatedAt.toISOString()}`,
    '',
    'Every item names its source and one of three states: Observed, Independently verified or Owner confirmed.',
    'Observed material is a lead for verification, not a fact about the business.',
    '',
  ];
  for (const group of research.groups) {
    lines.push(`## ${group.label}`, '');
    // Contact details and contact-channel observations need an export-permitted independent entry;
    // a profile reference or a CRM note is not reuse permission for someone's phone or email. Notes
    // that merely mention a number are withheld too, even when their category looks harmless.
    const items =
      group.key === 'contact'
        ? group.items.filter((item) => item.key === 'website' || (item.key.startsWith('observation-') && !withheldObservationKeys.has(item.key)))
        : group.items.filter((item) => !withheldObservationKeys.has(item.key));
    if (!items.length) lines.push('_Nothing exportable recorded._');
    else lines.push(...items.map(briefLine));
    if (group.key === 'contact') {
      lines.push('', '_Contact details recorded in the CRM, contact-channel observations and any note containing a phone number or email are withheld from this kit: add them through an export-permitted independent resource entry._');
    }
    lines.push('');
  }
  lines.push(
    '## What this brief does not contain',
    '',
    '- Contact details that were not recorded with export permission.',
    '- Search-result titles, snippets or rankings. They are transient provider material and were never stored.',
    '- Google Places content, previews or photo references.',
    '- Social-media images, logos or profile content. Links are references; nothing was downloaded or rehosted.',
    '- Any claim that a profile establishes ownership, operating status or contact consent.',
    '',
    'Reusable original assets must still pass the Asset Vault permission and approval workflow before they appear in this kit.',
  );
  return lines.join('\n');
}

const handleOf = (value: string) => value.replace(/^@/, '').toLowerCase();
