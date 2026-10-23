// Contact intelligence (phase 4): contact points with provenance, per-channel consent and the
// organization suppression list. Finding a contact detail and being allowed to use it are separate
// facts, kept in separate records (docs/CONTACT_PERMISSION_MODEL.md). Everything here is pure, so
// the demo store, the cloud store, the agents and the UI apply the same rules.

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { z } from 'zod';
import { LAWFUL_BASES, type LawfulBasis, type Tone } from './constants';
import type { Business, DateString, Timestamp } from './types';
import { registrableDomain } from './web-research';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const CONTACT_TYPES = ['email', 'phone', 'whatsapp', 'contact_page', 'contact_form'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];
export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  email: 'Email',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  contact_page: 'Contact page',
  contact_form: 'Contact form',
};

export const CONTACT_SCOPES = ['business', 'person', 'unknown'] as const;
export type ContactScope = (typeof CONTACT_SCOPES)[number];
export const CONTACT_SCOPE_LABELS: Record<ContactScope, string> = {
  business: 'Business channel',
  person: 'Named person (work contact)',
  unknown: 'Scope not confirmed',
};

export const PHONE_KINDS = ['mobile', 'landline', 'toll_free', 'unclassified'] as const;
export type PhoneKind = (typeof PHONE_KINDS)[number];
export const PHONE_KIND_LABELS: Record<PhoneKind, string> = { mobile: 'Mobile', landline: 'Landline', toll_free: 'Toll-free', unclassified: 'Unclassified' };

export const CONTACT_PURPOSES = ['research', 'enquiry_response', 'client_relationship'] as const;
export type ContactPurpose = (typeof CONTACT_PURPOSES)[number];
export const CONTACT_PURPOSE_LABELS: Record<ContactPurpose, string> = {
  research: 'Prospect research',
  enquiry_response: 'Responding to the business’s enquiry',
  client_relationship: 'Existing client relationship',
};

/** The brief's permitted source types. Restricted sources (below) can never be stored. */
export const CONTACT_SOURCE_TYPES = [
  'business_submitted',
  'licensed_dataset',
  'business_website',
  'authorized_directory',
  'directly_provided',
  'crm_record',
  'enrichment_provider',
] as const;
export type ContactSourceType = (typeof CONTACT_SOURCE_TYPES)[number];

export type DataRights = 'permitted' | 'restricted' | 'unknown';

export interface ContactSourcePolicy {
  label: string;
  description: string;
  /** Can a person pick this source when adding a contact by hand? Provider sources arrive through their integration. */
  manual: boolean;
  /** What the record must carry to show where it came from. */
  requires: 'source_url' | 'provider' | 'note_or_url';
  /** Data rights for a business-scope contact from this source. */
  rights: DataRights;
}

export const CONTACT_SOURCES: Record<ContactSourceType, ContactSourcePolicy> = {
  business_submitted: {
    label: 'Submitted by the business',
    description: 'The business sent it to us (an enquiry form, email or message).',
    manual: true,
    requires: 'note_or_url',
    rights: 'permitted',
  },
  directly_provided: {
    label: 'Given to us directly',
    description: 'Someone at the business gave it to a team member (call, meeting, business card).',
    manual: true,
    requires: 'note_or_url',
    rights: 'permitted',
  },
  business_website: {
    label: 'Business’s own website',
    description: 'Published by the business on a website it controls.',
    manual: true,
    requires: 'source_url',
    rights: 'permitted',
  },
  crm_record: {
    label: 'Existing CRM record',
    description: 'Already on the prospect profile; where it came from may not be documented.',
    manual: false,
    requires: 'note_or_url',
    rights: 'unknown',
  },
  authorized_directory: {
    label: 'Authorised directory',
    description: 'A directory whose terms permit storing and using listings. Needs a terms review before use.',
    manual: false,
    requires: 'provider',
    rights: 'unknown',
  },
  licensed_dataset: {
    label: 'Licensed B2B dataset',
    description: 'A dataset licensed for this use.',
    manual: false,
    requires: 'provider',
    rights: 'permitted',
  },
  enrichment_provider: {
    label: 'Approved enrichment provider',
    description: 'A data-enrichment service approved by the owner after a terms review.',
    manual: false,
    requires: 'provider',
    rights: 'permitted',
  },
};

/** Marks profile details whose source was never written down: they stay "needs review". */
export const UNDOCUMENTED_SOURCE = 'Recorded on the prospect profile before contact tracking; where it came from was not documented.';

/** Sources whose terms do not allow contact details to be kept in the CRM. */
export const RESTRICTED_CONTACT_SOURCES: Record<string, string> = {
  google_places:
    'Google Places contact fields are for display only under the Places API policies. Confirm the detail on the business’s own website or with the business, then record that source.',
  search_results: 'Search results may only be used transiently (Brave Search API terms). Record the page the business published instead.',
  social_profile: 'Contact details are not collected from social platforms. Use a channel the business publishes on its own website or gives you directly.',
};

export const CONTACT_CLASSIFICATIONS = ['verified_business_channel', 'source_confirmed', 'unverified', 'invalid', 'outdated'] as const;
/** Stored: what we know about the source and validity of the detail. */
export type ContactClassification = (typeof CONTACT_CLASSIFICATIONS)[number];
/** Shown: the stored classification combined with permission, opt-out and suppression. */
export type ContactStatus = ContactClassification | 'permission_required' | 'opted_out' | 'suppressed';

export const CONTACT_STATUS_META: Record<ContactStatus, { label: string; tone: Tone; description: string }> = {
  verified_business_channel: { label: 'Verified business channel', tone: 'success', description: 'Published by the business on a source it controls, validated, with consent on file.' },
  source_confirmed: { label: 'Source confirmed', tone: 'success', description: 'From a permitted source that matches the business, validated, with consent on file.' },
  unverified: { label: 'Needs review', tone: 'warning', description: 'Not yet validated, or its source or scope needs a person to review it.' },
  invalid: { label: 'Invalid', tone: 'danger', description: 'Failed syntax, mail-server or number checks.' },
  outdated: { label: 'Outdated', tone: 'neutral', description: 'No longer published at its source, or replaced.' },
  permission_required: { label: 'Permission required', tone: 'info', description: 'Valid, but no consent is on file for this channel.' },
  opted_out: { label: 'Opted out', tone: 'danger', description: 'The business asked not to be contacted on this channel.' },
  suppressed: { label: 'Suppressed', tone: 'danger', description: 'On the suppression list. Never contacted.' },
};
export const CLASSIFICATION_LABELS: Record<ContactClassification, string> = {
  verified_business_channel: 'Verified business channel',
  source_confirmed: 'Source confirmed',
  unverified: 'Needs review',
  invalid: 'Invalid',
  outdated: 'Outdated',
};

export const CONSENT_CHANNELS = ['email', 'whatsapp', 'phone'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const CONSENT_CHANNEL_LABELS: Record<ConsentChannel, string> = { email: 'Email', whatsapp: 'WhatsApp', phone: 'Phone calls and SMS' };

export const CONSENT_PURPOSES = ['direct_marketing', 'service_information', 'enquiry_response', 'client_relationship'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  direct_marketing: 'Direct marketing (offers and proposals)',
  service_information: 'Information about a service they asked about',
  enquiry_response: 'Replying to their enquiry',
  client_relationship: 'Existing client relationship',
};

export const CAPTURE_METHODS = ['web_form', 'email', 'whatsapp_message', 'written_document', 'phone_call', 'in_person'] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];
export const CAPTURE_METHOD_LABELS: Record<CaptureMethod, string> = {
  web_form: 'Web form',
  email: 'Email from them',
  whatsapp_message: 'WhatsApp message from them',
  written_document: 'Signed or written document',
  phone_call: 'Phone call',
  in_person: 'In person',
};
/** Act 843 s.40: direct marketing needs prior *written* consent. */
export const WRITTEN_CAPTURE: readonly CaptureMethod[] = ['web_form', 'email', 'whatsapp_message', 'written_document'];

export type SuppressionSource = 'manual' | 'consent_withdrawal' | 'business_opt_out' | 'agent' | 'inbound_opt_out' | 'provider_event';
export const SUPPRESSION_SOURCE_LABELS: Record<SuppressionSource, string> = {
  manual: 'added by a team member',
  consent_withdrawal: 'from a consent withdrawal',
  business_opt_out: 'from a business opt-out',
  agent: 'added by an agent',
  inbound_opt_out: 'from an opt-out reply',
  provider_event: 'from a bounce or complaint',
};

export const SUPPRESSION_KINDS = ['email', 'phone', 'email_domain', 'business'] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];
export const SUPPRESSION_KIND_LABELS: Record<SuppressionKind, string> = { email: 'Email address', phone: 'Phone number', email_domain: 'Email domain', business: 'Business' };

export const SUPPRESSION_REASONS = ['opted_out', 'unsubscribed', 'refused', 'wrong_contact', 'complaint', 'bounced', 'other'] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];
export const SUPPRESSION_REASON_LABELS: Record<SuppressionReason, string> = {
  opted_out: 'Asked not to be contacted',
  unsubscribed: 'Unsubscribed',
  refused: 'Refused contact',
  wrong_contact: 'Wrong contact',
  complaint: 'Complaint',
  bounced: 'Bounced',
  other: 'Other',
};

export const CONTACT_RESEARCH_VERSION = 'contact-research-1.0.0';
export const CONTACT_VALIDATION_VERSION = 'contact-validation-1.0.0';
/** A validation older than this no longer counts as current. */
export const VALIDATION_MAX_AGE_DAYS = 90;
export const DEFAULT_CONTACT_RETENTION_DAYS = 365;

// ── Records ──────────────────────────────────────────────────────────────────

export interface ValidationCheck {
  key: 'syntax' | 'domain' | 'mx' | 'number' | 'type' | 'duplicate' | 'deliverability' | 'url';
  status: 'pass' | 'fail' | 'warn' | 'skipped';
  detail: string;
}

export interface ContactValidation {
  checkedAt: Timestamp;
  version: string;
  /** temporary_failure: a check could not run (DNS timeout); nothing is concluded from it. */
  result: 'valid' | 'invalid' | 'risky' | 'temporary_failure';
  checks: ValidationCheck[];
  duplicateOf: string[];
}

export interface ContactPoint {
  id: string;
  organizationId: string;
  businessId: string;
  type: ContactType;
  value: string;
  normalizedValue: string;
  /** SHA-256 of the suppression key, so the suppression list can match without keeping values. */
  valueHash: string | null;
  domainHash: string | null;
  /** Masked value for suppression and consent records (e.g. "k•••@adom.com"). */
  hint: string;
  scope: ContactScope;
  label: string | null;
  personName: string | null;
  personRole: string | null;
  phoneKind: PhoneKind | null;
  sourceType: ContactSourceType;
  sourceUrl: string | null;
  sourceProvider: string | null;
  sourceLicence: string | null;
  sourceNote: string | null;
  acquiredAt: Timestamp;
  acquiredBy: string | null;
  agentVersion: string | null;
  jobId: string | null;
  purpose: ContactPurpose;
  classification: ContactClassification;
  validation: ContactValidation | null;
  validatedAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
  retentionUntil: DateString;
  lastReviewedAt: Timestamp | null;
  reviewNote: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ConsentRecord {
  id: string;
  organizationId: string;
  businessId: string;
  /** Null: the record covers every contact point on this channel. */
  contactPointId: string | null;
  contactHint: string | null;
  channel: ConsentChannel;
  status: 'granted' | 'withdrawn';
  lawfulBasis: LawfulBasis | null;
  purpose: ConsentPurpose;
  scope: string | null;
  evidence: string;
  capturedVia: CaptureMethod;
  capturedAt: Timestamp;
  wording: string | null;
  expiresAt: Timestamp | null;
  recordedBy: string | null;
  recordedByName: string;
  createdAt: Timestamp;
}

export interface Suppression {
  id: string;
  organizationId: string;
  kind: SuppressionKind;
  valueHash: string | null;
  businessId: string | null;
  /** Null: every channel. */
  channel: ConsentChannel | null;
  hint: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  consentRecordId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Timestamp;
  liftedAt: Timestamp | null;
  liftedBy: string | null;
  liftReason: string | null;
  liftConsentId: string | null;
}

type System = 'id' | 'organizationId' | 'createdAt' | 'updatedAt';
export type ContactPointInsert = Omit<ContactPoint, System>;
export type ContactPointPatch = Partial<
  Pick<ContactPoint, 'scope' | 'label' | 'personName' | 'personRole' | 'phoneKind' | 'purpose' | 'classification' | 'validation' | 'validatedAt' | 'lastSeenAt' | 'retentionUntil' | 'lastReviewedAt' | 'reviewNote'>
>;
export type ConsentInsert = Omit<ConsentRecord, 'id' | 'organizationId' | 'createdAt' | 'recordedBy'>;
export type SuppressionInsert = Omit<Suppression, 'id' | 'organizationId' | 'createdAt' | 'createdBy' | 'liftedAt' | 'liftedBy' | 'liftReason' | 'liftConsentId'>;

/** Fields an agent or the profile may never change after a contact point is recorded. */
export const CONTACT_MUTABLE_FIELDS = new Set<keyof ContactPoint>([
  'scope',
  'label',
  'personName',
  'personRole',
  'phoneKind',
  'purpose',
  'classification',
  'validation',
  'validatedAt',
  'lastSeenAt',
  'retentionUntil',
  'lastReviewedAt',
  'reviewNote',
]);

// ── Normalization ────────────────────────────────────────────────────────────

export type Normalized = { ok: true; normalized: string; domain?: string; phoneKind?: PhoneKind; country?: string | null; warning?: string } | { ok: false; error: string };

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const NOT_A_TLD = /^(png|jpe?g|gif|webp|svg|css|js|ico|bmp|tiff?|mp4|pdf)$/;

export function normalizeEmail(raw: string): Normalized {
  let v = raw.trim().replace(/^mailto:/i, '').split('?')[0].trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    // Keep the raw value; syntax checks below decide.
  }
  if (v.length > 254) return { ok: false, error: 'Longer than 254 characters' };
  const at = v.lastIndexOf('@');
  if (at < 1 || at === v.length - 1) return { ok: false, error: 'Not an email address' };
  const local = v.slice(0, at);
  let domain = v.slice(at + 1).toLowerCase().replace(/\.$/, '');
  if (local.length > 64 || !LOCAL_PART.test(local)) return { ok: false, error: 'The part before @ is not valid' };
  try {
    domain = new URL(`http://${domain}`).hostname; // IDN → punycode
  } catch {
    return { ok: false, error: 'The domain is not valid' };
  }
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !/^(xn--[a-z0-9-]+|[a-z]{2,63})$/.test(tld) || NOT_A_TLD.test(tld)) {
    return { ok: false, error: 'The domain is not valid' };
  }
  // Local parts are case-sensitive in principle but not in practice; lower-casing makes duplicates visible.
  return { ok: true, normalized: `${local.toLowerCase()}@${domain}`, domain };
}

const PHONE_TYPES: Record<string, PhoneKind> = { MOBILE: 'mobile', FIXED_LINE: 'landline', TOLL_FREE: 'toll_free' };

/** Parses with libphonenumber (Ghana by default) and normalizes to E.164. */
export function normalizePhone(raw: string, defaultCountry: 'GH' = 'GH'): Normalized {
  const v = raw.trim().replace(/^tel:/i, '');
  if (!/\d/.test(v) || v.replace(/\D/g, '').length < 7) return { ok: false, error: 'Not a phone number' };
  const p = parsePhoneNumberFromString(v, defaultCountry);
  if (!p) return { ok: false, error: 'Not a phone number' };
  if (!p.isValid()) return { ok: false, error: `Not a valid number${p.country ? ` for ${p.country}` : ''}` };
  const type = p.getType();
  return { ok: true, normalized: p.number, phoneKind: (type && PHONE_TYPES[type]) || 'unclassified', country: p.country ?? null, warning: p.country && p.country !== 'GH' ? `Registered outside Ghana (${p.country})` : undefined };
}

export function normalizeUrl(raw: string): Normalized {
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return { ok: false, error: 'Not a web address' };
    u.hash = '';
    return { ok: true, normalized: u.href };
  } catch {
    return { ok: false, error: 'Not a web address' };
  }
}

export function normalizeContact(type: ContactType, raw: string): Normalized {
  if (type === 'email') return normalizeEmail(raw);
  if (type === 'phone' || type === 'whatsapp') return normalizePhone(raw);
  return normalizeUrl(raw);
}

/** The channel a contact point is used on, if it is a messaging channel at all. */
export function channelOf(type: ContactType): ConsentChannel | null {
  return type === 'email' ? 'email' : type === 'phone' ? 'phone' : type === 'whatsapp' ? 'whatsapp' : null;
}

// ── Suppression keys and masked hints ────────────────────────────────────────

/** WhatsApp and phone share a key: the number is the same identifier on both channels. */
export function suppressionKey(kind: Exclude<SuppressionKind, 'business'>, normalized: string) {
  return `${kind === 'email_domain' ? 'domain' : kind}:${normalized.toLowerCase()}`;
}

export function contactKey(type: ContactType, normalized: string): string | null {
  if (type === 'email') return suppressionKey('email', normalized);
  if (type === 'phone' || type === 'whatsapp') return suppressionKey('phone', normalized);
  return null;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function contactHashes(type: ContactType, normalized: string): Promise<{ valueHash: string | null; domainHash: string | null }> {
  const key = contactKey(type, normalized);
  return {
    valueHash: key ? await sha256Hex(key) : null,
    domainHash: type === 'email' ? await sha256Hex(suppressionKey('email_domain', normalized.split('@')[1] ?? '')) : null,
  };
}

export function maskContact(type: ContactType | Exclude<SuppressionKind, 'business'>, normalized: string): string {
  if (type === 'email') {
    const [local, domain] = normalized.split('@');
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  if (type === 'phone' || type === 'whatsapp') return `${normalized.slice(0, 4)} ••• ${normalized.slice(-3)}`;
  if (type === 'email_domain') return `@${normalized}`;
  try {
    return new URL(normalized).hostname;
  } catch {
    return normalized.slice(0, 40);
  }
}

// ── Scope ────────────────────────────────────────────────────────────────────

const ROLE_LOCAL =
  /^(info|hello|hi|contact|contactus|enquir(y|ies)|inquir(y|ies)|sales|support|help|admin|office|bookings?|reservations?|orders?|shop|store|team|mail|customer(care|service)|care|service|accounts?|billing|marketing|events|reception|frontdesk|general|studio|management|careers|hr|ops)[0-9]*$/i;
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'zoho.com']);

export const isFreeMail = (domain: string) => FREE_MAIL.has(domain.toLowerCase());
export const isRoleAddress = (email: string) => ROLE_LOCAL.test(email.split('@')[0] ?? '');

/**
 * Scope inferred for a detail found on the business's website. Only role addresses (info@, sales@)
 * are treated as business channels; anything else may identify a person and waits for review.
 */
export function inferScope(type: ContactType, normalized: string): ContactScope {
  if (type !== 'email') return 'business';
  return isRoleAddress(normalized) ? 'business' : 'unknown';
}

// ── Provenance and storage rules ─────────────────────────────────────────────

export interface ProviderLicence {
  /** Provider identifier stored on each contact point. */
  provider: string;
  summary: string;
  storagePermitted: boolean;
  marketingUsePermitted: boolean;
  reviewedAt: DateString | null;
}

/**
 * Throws when a detail may not be kept: a restricted source, a provider whose licence forbids
 * storage, or a record that does not say where it came from.
 */
export function assertStorable(input: { sourceType: string; sourceUrl?: string | null; sourceNote?: string | null; sourceProvider?: string | null; sourceLicence?: string | null }, licence?: ProviderLicence | null) {
  if (input.sourceType in RESTRICTED_CONTACT_SOURCES) throw new Error(RESTRICTED_CONTACT_SOURCES[input.sourceType]);
  if (!(CONTACT_SOURCE_TYPES as readonly string[]).includes(input.sourceType)) throw new Error('Unknown contact source. Record where the detail came from.');
  const policy = CONTACT_SOURCES[input.sourceType as ContactSourceType];
  const url = input.sourceUrl?.trim();
  const note = input.sourceNote?.trim();
  if (policy.requires === 'source_url' && !url) throw new Error('Record the page where the business published this detail.');
  if (policy.requires === 'provider') {
    if (!input.sourceProvider || !licence || licence.provider !== input.sourceProvider) throw new Error('Details from a directory or data provider arrive only through a configured, licensed integration.');
    if (!licence.storagePermitted) throw new Error(`${input.sourceProvider}: the licence does not allow storing contact details in the CRM.`);
    if (!input.sourceLicence?.trim()) throw new Error('Record the licence that applies to this detail.');
  }
  if (policy.requires === 'note_or_url' && !url && !note) throw new Error('Say where this detail came from (a link or a short note).');
}

export function dataRights(point: Pick<ContactPoint, 'sourceType' | 'scope' | 'sourceNote' | 'sourceUrl' | 'purpose'>, licence?: ProviderLicence | null): DataRights {
  const policy = CONTACT_SOURCES[point.sourceType];
  if (licence && !licence.marketingUsePermitted) return 'restricted';
  if (point.scope === 'unknown') return 'unknown';
  if (point.scope === 'person' && point.purpose === 'research') return 'unknown';
  return policy.rights;
}

export function defaultRetentionUntil(acquiredAt: string, days = DEFAULT_CONTACT_RETENTION_DAYS): DateString {
  return new Date(new Date(acquiredAt).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export const retentionDue = (point: Pick<ContactPoint, 'retentionUntil'>, today: DateString) => point.retentionUntil <= today;

// ── Consent and suppression ──────────────────────────────────────────────────

export type ConsentState = { state: 'granted' | 'withdrawn' | 'expired' | 'none'; record: ConsentRecord | null };

/** The latest record for the channel that covers this contact point (or the business as a whole). */
export function consentFor(businessId: string, channel: ConsentChannel, contactPointId: string | null, records: ConsentRecord[], now: Date): ConsentState {
  const relevant = records
    .filter((r) => r.businessId === businessId && r.channel === channel && (r.contactPointId === null || r.contactPointId === contactPointId))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.createdAt.localeCompare(a.createdAt));
  // A withdrawal anywhere on the channel (for this point or the whole business) wins over an older grant.
  const latest = relevant[0];
  if (!latest) return { state: 'none', record: null };
  if (latest.status === 'withdrawn') return { state: 'withdrawn', record: latest };
  if (latest.expiresAt && latest.expiresAt <= now.toISOString()) return { state: 'expired', record: latest };
  return { state: 'granted', record: latest };
}

export function activeSuppressions(list: Suppression[]) {
  return list.filter((s) => !s.liftedAt);
}

/** The first active suppression that blocks this contact point on its channel. */
export function suppressionFor(point: Pick<ContactPoint, 'businessId' | 'type' | 'valueHash' | 'domainHash'>, suppressions: Suppression[], channel = channelOf(point.type)): Suppression | null {
  for (const s of activeSuppressions(suppressions)) {
    if (s.channel && channel && s.channel !== channel) continue;
    if (s.kind === 'business' && s.businessId === point.businessId) return s;
    if ((s.kind === 'email' || s.kind === 'phone') && s.valueHash && s.valueHash === point.valueHash) return s;
    if (s.kind === 'email_domain' && s.valueHash && s.valueHash === point.domainHash) return s;
  }
  return null;
}

export interface StatusContext {
  business: Pick<Business, 'id' | 'contactPermission'>;
  consents: ConsentRecord[];
  suppressions: Suppression[];
  now: Date;
}

export function contactStatus(point: ContactPoint, ctx: StatusContext): ContactStatus {
  if (suppressionFor(point, ctx.suppressions)) return 'suppressed';
  if (ctx.business.contactPermission === 'opted_out') return 'opted_out';
  const channel = channelOf(point.type);
  const consent = channel ? consentFor(point.businessId, channel, point.id, ctx.consents, ctx.now) : null;
  if (consent?.state === 'withdrawn') return 'opted_out';
  if (point.classification === 'invalid' || point.classification === 'outdated' || point.classification === 'unverified') return point.classification;
  if (!channel) return point.classification;
  return consent?.state === 'granted' ? point.classification : 'permission_required';
}

export const validationCurrent = (point: Pick<ContactPoint, 'validatedAt'>, now: Date) =>
  Boolean(point.validatedAt && now.getTime() - new Date(point.validatedAt).getTime() <= VALIDATION_MAX_AGE_DAYS * 86_400_000);

export interface ChannelEligibility {
  channel: ConsentChannel;
  eligible: boolean;
  point: ContactPoint | null;
  consent: ConsentState;
  reasons: string[];
}

/**
 * The contact-level part of the outreach gateway (CONTACT_PERMISSION_MODEL §5, checks 2–4): opt-out,
 * suppression, a current consent record for the channel, a usable and recently validated contact
 * point with permitted data rights, and the business-level permission the CRM already requires.
 * Mode, approval, timing and sender checks belong to the gateway itself (phase 7).
 */
export function channelEligibility(business: Business, points: ContactPoint[], channel: ConsentChannel, ctx: Omit<StatusContext, 'business'>): ChannelEligibility {
  const onChannel = points.filter((p) => p.businessId === business.id && channelOf(p.type) === channel);
  const rank = (p: ContactPoint) => (p.classification === 'verified_business_channel' ? 0 : p.classification === 'source_confirmed' ? 1 : 2);
  const point = [...onChannel].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  const consent = consentFor(business.id, channel, point?.id ?? null, ctx.consents, ctx.now);
  const reasons: string[] = [];
  if (business.contactPermission === 'opted_out') reasons.push('The business opted out of all contact.');
  if (['lost', 'archived'].includes(business.stage) || business.mergedIntoId) reasons.push('The prospect is closed or archived.');
  if (!point) reasons.push(`No ${CONSENT_CHANNEL_LABELS[channel].toLowerCase()} contact point is recorded.`);
  else {
    const blocked = suppressionFor(point, ctx.suppressions, channel);
    if (blocked) reasons.push(`On the suppression list (${SUPPRESSION_REASON_LABELS[blocked.reason].toLowerCase()}).`);
    if (point.classification !== 'verified_business_channel' && point.classification !== 'source_confirmed') reasons.push(`The contact point is ${CLASSIFICATION_LABELS[point.classification].toLowerCase()}.`);
    else if (!validationCurrent(point, ctx.now)) reasons.push(`Not validated in the last ${VALIDATION_MAX_AGE_DAYS} days.`);
    if (dataRights(point) !== 'permitted') reasons.push('Data rights for this source are not confirmed.');
  }
  if (consent.state === 'none') reasons.push(`No ${CONSENT_CHANNEL_LABELS[channel].toLowerCase()} consent on file.`);
  if (consent.state === 'withdrawn') reasons.push('Consent was withdrawn.');
  if (consent.state === 'expired') reasons.push('Consent has expired; ask the business to confirm it again.');
  if (business.contactPermission !== 'granted' && business.contactPermission !== 'opted_out') reasons.push('Business-level permission is not recorded as granted.');
  return { channel, eligible: reasons.length === 0, point, consent, reasons };
}

// ── Validation (pure; DNS results are passed in) ─────────────────────────────

export type MxStatus = 'found' | 'no_mx_but_resolves' | 'null_mx' | 'no_domain' | 'error';
export interface MxResult {
  domain: string;
  status: MxStatus;
  hosts: string[];
}

export const MX_DETAIL: Record<MxStatus, string> = {
  found: 'Mail servers (MX) are published for the domain. This does not prove the mailbox exists.',
  no_mx_but_resolves: 'No MX record; the domain resolves, so mail may still be accepted. Treat with care.',
  null_mx: 'The domain declares that it accepts no email (null MX).',
  no_domain: 'The domain does not exist.',
  error: 'The mail-server lookup failed temporarily; nothing is concluded from it.',
};

export function validateContactPoint(
  point: Pick<ContactPoint, 'id' | 'businessId' | 'type' | 'value' | 'normalizedValue' | 'valueHash'>,
  ctx: { mx: Map<string, MxResult> | null; others: Pick<ContactPoint, 'id' | 'businessId' | 'valueHash'>[]; now: Date; version?: string },
): ContactValidation {
  const checks: ValidationCheck[] = [];
  let result: ContactValidation['result'] = 'valid';
  const fail = (key: ValidationCheck['key'], detail: string) => {
    checks.push({ key, status: 'fail', detail });
    result = 'invalid';
  };
  const n = normalizeContact(point.type, point.value);
  if (!n.ok) fail(point.type === 'email' ? 'syntax' : point.type === 'phone' || point.type === 'whatsapp' ? 'number' : 'url', n.error);
  else if (point.type === 'email') {
    checks.push({ key: 'syntax', status: 'pass', detail: 'Valid address syntax.' });
    checks.push({ key: 'domain', status: 'pass', detail: `Domain normalised to ${n.domain}.` });
    const mx = ctx.mx?.get(n.domain!);
    if (!ctx.mx) checks.push({ key: 'mx', status: 'skipped', detail: 'Mail-server lookup needs the server tools.' });
    else if (!mx) checks.push({ key: 'mx', status: 'skipped', detail: 'Not looked up in this run.' });
    else if (mx.status === 'found') checks.push({ key: 'mx', status: 'pass', detail: `${MX_DETAIL.found} (${mx.hosts.slice(0, 2).join(', ')})` });
    else if (mx.status === 'no_mx_but_resolves') {
      checks.push({ key: 'mx', status: 'warn', detail: MX_DETAIL.no_mx_but_resolves });
      result = 'risky';
    } else if (mx.status === 'error') {
      checks.push({ key: 'mx', status: 'warn', detail: MX_DETAIL.error });
      result = 'temporary_failure';
    } else fail('mx', MX_DETAIL[mx.status]);
    checks.push({ key: 'deliverability', status: 'skipped', detail: 'No authorised deliverability provider is connected; mailboxes are never probed.' });
  } else if (point.type === 'phone' || point.type === 'whatsapp') {
    checks.push({ key: 'number', status: 'pass', detail: `Valid number, normalised to ${n.normalized}.` });
    checks.push({ key: 'type', status: n.warning ? 'warn' : 'pass', detail: `${PHONE_KIND_LABELS[n.phoneKind ?? 'unclassified']}${n.warning ? `; ${n.warning}` : ''}.` });
    if (point.type === 'whatsapp') checks.push({ key: 'type', status: 'pass', detail: 'Declared by the business as a WhatsApp channel. Numbers are never checked against WhatsApp.' });
  } else checks.push({ key: 'url', status: 'pass', detail: 'Valid web address.' });

  const duplicateOf = point.valueHash ? [...new Set(ctx.others.filter((o) => o.id !== point.id && o.businessId !== point.businessId && o.valueHash === point.valueHash).map((o) => o.businessId))] : [];
  if (duplicateOf.length) checks.push({ key: 'duplicate', status: 'warn', detail: `Also recorded on ${duplicateOf.length} other prospect${duplicateOf.length === 1 ? '' : 's'}; it may be a shared or agency line.` });
  else if (point.valueHash) checks.push({ key: 'duplicate', status: 'pass', detail: 'Not recorded on another prospect.' });
  return { checkedAt: ctx.now.toISOString(), version: ctx.version ?? CONTACT_VALIDATION_VERSION, result, checks, duplicateOf };
}

/** The stored classification after a validation: source, scope and checks together. */
export function classifyContact(
  point: Pick<ContactPoint, 'type' | 'normalizedValue' | 'scope' | 'sourceType' | 'sourceUrl' | 'sourceNote' | 'classification'>,
  validation: ContactValidation,
  context: { officialWebsite?: string | null } = {},
): ContactClassification {
  if (validation.result === 'invalid') return 'invalid';
  if (validation.result === 'temporary_failure') return point.classification === 'invalid' ? 'unverified' : point.classification;
  if (point.classification === 'outdated') return 'outdated';
  if (validation.result === 'risky' || point.scope !== 'business' || validation.duplicateOf.length) {
    // A person scope with a documented role is fine once someone has reviewed it.
    if (point.scope === 'person' && validation.result === 'valid' && !validation.duplicateOf.length) return 'source_confirmed';
    return 'unverified';
  }
  if (point.sourceType === 'business_website') {
    if (point.type !== 'email') return 'verified_business_channel';
    const domain = point.normalizedValue.split('@')[1] ?? '';
    const site = siteDomain(point.sourceUrl) ?? siteDomain(context.officialWebsite);
    // An address on another company's domain (a web designer's credit, say) may not be the business's.
    return isFreeMail(domain) || (site && registrableDomain(domain) === site) ? 'verified_business_channel' : 'unverified';
  }
  if (point.sourceType === 'business_submitted' || point.sourceType === 'directly_provided') return 'verified_business_channel';
  if (point.sourceType === 'crm_record') return point.sourceUrl || (point.sourceNote && point.sourceNote !== UNDOCUMENTED_SOURCE) ? 'source_confirmed' : 'unverified';
  return 'source_confirmed';
}

function siteDomain(url: string | null | undefined) {
  if (!url) return null;
  try {
    return registrableDomain(new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname);
  } catch {
    return null;
  }
}

// ── Forms ────────────────────────────────────────────────────────────────────

const trimmed = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v ? v : null))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const contactFormSchema = z
  .object({
    type: z.enum(CONTACT_TYPES),
    value: trimmed(320).min(3, 'Enter the contact detail'),
    sourceType: z.enum(CONTACT_SOURCE_TYPES),
    sourceUrl: optional(500),
    sourceNote: optional(500),
    scope: z.enum(CONTACT_SCOPES),
    label: optional(80),
    personName: optional(120),
    personRole: optional(120),
    purpose: z.enum(CONTACT_PURPOSES),
  })
  .superRefine((v, ctx) => {
    const n = normalizeContact(v.type, v.value);
    if (!n.ok) ctx.addIssue({ code: 'custom', path: ['value'], message: n.error });
    if (v.sourceUrl && !normalizeUrl(v.sourceUrl).ok) ctx.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Enter a full web address' });
    try {
      assertStorable(v);
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: [CONTACT_SOURCES[v.sourceType]?.requires === 'source_url' ? 'sourceUrl' : 'sourceNote'], message: (e as Error).message });
    }
    if (!CONTACT_SOURCES[v.sourceType].manual) ctx.addIssue({ code: 'custom', path: ['sourceType'], message: 'This source arrives only through its integration.' });
    if (v.scope === 'person') {
      if (!v.personName) ctx.addIssue({ code: 'custom', path: ['personName'], message: 'Name the person this work contact belongs to' });
      if (!v.personRole) ctx.addIssue({ code: 'custom', path: ['personRole'], message: 'Record their role at the business' });
      if (v.purpose === 'research') ctx.addIssue({ code: 'custom', path: ['purpose'], message: 'Personal work contacts are kept only for an enquiry or an existing relationship' });
    }
  });
export type ContactForm = z.infer<typeof contactFormSchema>;

export const consentFormSchema = z
  .object({
    channel: z.enum(CONSENT_CHANNELS),
    contactPointId: z.string().nullable(),
    status: z.enum(['granted', 'withdrawn']),
    lawfulBasis: z.enum(LAWFUL_BASES).nullable(),
    purpose: z.enum(CONSENT_PURPOSES),
    scope: optional(300),
    evidence: trimmed(2000).min(10, 'Describe the evidence (at least 10 characters): who, when, and where it is kept'),
    capturedVia: z.enum(CAPTURE_METHODS),
    capturedAt: z.string().min(10),
    wording: optional(2000),
    expiresAt: optional(40),
  })
  .superRefine((v, ctx) => {
    const captured = Date.parse(v.capturedAt);
    if (Number.isNaN(captured)) ctx.addIssue({ code: 'custom', path: ['capturedAt'], message: 'Enter when it was given' });
    else if (captured > Date.now() + 5 * 60_000) ctx.addIssue({ code: 'custom', path: ['capturedAt'], message: 'Cannot be in the future' });
    if (v.expiresAt && Date.parse(v.expiresAt) <= captured) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Must be after the date it was given' });
    if (v.status === 'granted') {
      if (!v.lawfulBasis) ctx.addIssue({ code: 'custom', path: ['lawfulBasis'], message: 'Select the lawful basis' });
      if (v.lawfulBasis === 'consent' && v.purpose === 'direct_marketing') {
        if (!WRITTEN_CAPTURE.includes(v.capturedVia)) {
          ctx.addIssue({ code: 'custom', path: ['capturedVia'], message: 'Direct marketing needs prior written consent (Act 843 s.40): record the form, email, message or document' });
        }
        if (!v.wording) ctx.addIssue({ code: 'custom', path: ['wording'], message: 'Record the wording the business agreed to' });
      }
    }
  });
export type ConsentForm = z.infer<typeof consentFormSchema>;

export const suppressionFormSchema = z
  .object({
    kind: z.enum(['email', 'phone', 'email_domain']),
    value: trimmed(320).min(3, 'Enter the value to suppress'),
    channel: z.enum(CONSENT_CHANNELS).nullable(),
    reason: z.enum(SUPPRESSION_REASONS),
    note: optional(500),
  })
  .superRefine((v, ctx) => {
    const n = v.kind === 'email' ? normalizeEmail(v.value) : v.kind === 'phone' ? normalizePhone(v.value) : normalizeEmail(`x@${v.value.replace(/^@/, '')}`);
    if (!n.ok) ctx.addIssue({ code: 'custom', path: ['value'], message: n.error });
  });
export type SuppressionForm = z.infer<typeof suppressionFormSchema>;

/** Normalized value for a suppression entered by hand. */
export function suppressionValue(form: Pick<SuppressionForm, 'kind' | 'value'>): string {
  if (form.kind === 'email') {
    const n = normalizeEmail(form.value);
    return n.ok ? n.normalized : form.value.trim().toLowerCase();
  }
  if (form.kind === 'phone') {
    const n = normalizePhone(form.value);
    return n.ok ? n.normalized : form.value.replace(/[^\d+]/g, '');
  }
  const n = normalizeEmail(`x@${form.value.trim().replace(/^@/, '')}`);
  return n.ok ? n.domain! : form.value.trim().toLowerCase();
}
