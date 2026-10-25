// Lead-to-website Studio: a concept for one prospect, built from evidence about the website that
// business has today. Five classifications keep the concept honest — a guess never looks like a
// fact, and reference material never looks reusable:
//
//   verified_fact ........ read directly from the page (name, contact routes, social profiles)
//   unknown .............. the page is silent; the business must be asked
//   placeholder .......... template, parked or stale content that should not be carried forward
//   creative_suggestion .. our proposal, never evidence about the business
//   restricted ........... references (logos, photographs, platform marks, their copy) that need
//                          permission or a licence before reuse
//
// Every entry carries provenance (source URL and observation time), a confidence score and a reuse
// permission. Records are append-only: a correction is a new review, not an edit.

import type { Tone } from './constants';
import type { PageFacts } from './page-signals';
import { hostOf, registrableDomain } from './web-research';

export const STUDIO_PROJECT_STATUSES = ['draft', 'intelligence_ready', 'archived'] as const;
export type StudioProjectStatus = (typeof STUDIO_PROJECT_STATUSES)[number];

export const INTELLIGENCE_STATUSES = ['not_started', 'ready', 'unavailable'] as const;
export type IntelligenceStatus = (typeof INTELLIGENCE_STATUSES)[number];

export const EVIDENCE_CLASSIFICATIONS = ['verified_fact', 'unknown', 'placeholder', 'creative_suggestion', 'restricted'] as const;
export type EvidenceClassification = (typeof EVIDENCE_CLASSIFICATIONS)[number];

export const EVIDENCE_CATEGORIES = [
  'identity',
  'logo',
  'imagery',
  'palette',
  'typography',
  'content',
  'navigation',
  'contact',
  'commerce',
  'accessibility',
  'platform',
  'restriction',
] as const;
export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const REUSE_PERMISSIONS = ['unknown', 'reference_only', 'permitted', 'prohibited'] as const;
export type ReusePermission = (typeof REUSE_PERMISSIONS)[number];

export const REVIEW_DECISIONS = ['confirm', 'reject', 'note'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const SOURCE_KINDS = ['website_page', 'search_result', 'person', 'system'] as const;
export type StudioSourceKind = (typeof SOURCE_KINDS)[number];

export const ASSET_KINDS = ['logo', 'icon', 'favicon', 'image'] as const;
export type StudioAssetKind = (typeof ASSET_KINDS)[number];

/** Display order: facts first, references last. */
export const CLASSIFICATION_ORDER = EVIDENCE_CLASSIFICATIONS;

export const CLASSIFICATION_META: Record<EvidenceClassification, { label: string; short: string; tone: Tone; description: string }> = {
  verified_fact: {
    label: 'Verified facts',
    short: 'Verified',
    tone: 'success',
    description: 'Read directly from the page. Quote them, and check anything time-sensitive before publishing.',
  },
  unknown: {
    label: 'Unknown',
    short: 'Unknown',
    tone: 'neutral',
    description: 'The site is silent. Ask the business; never fill a gap with an assumption.',
  },
  placeholder: {
    label: 'Placeholders',
    short: 'Placeholder',
    tone: 'warning',
    description: 'Template, parked or stale content. Do not carry it into the concept.',
  },
  creative_suggestion: {
    label: 'Creative suggestions',
    short: 'Suggestion',
    tone: 'accent',
    description: 'Our proposal, not a fact about the business. The confidence shown is how strongly the evidence supports it.',
  },
  restricted: {
    label: 'Restricted references',
    short: 'Restricted',
    tone: 'danger',
    description: 'Reference only. Nothing here was downloaded, and nothing may be republished without permission or a licence.',
  },
};

export const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  identity: 'Identity',
  logo: 'Logo',
  imagery: 'Imagery',
  palette: 'Palette',
  typography: 'Typography',
  content: 'Content',
  navigation: 'Navigation',
  contact: 'Contact',
  commerce: 'Commerce',
  accessibility: 'Accessibility',
  platform: 'Platform',
  restriction: 'Restriction',
};

export const REUSE_META: Record<ReusePermission, { label: string; tone: Tone; description: string }> = {
  unknown: { label: 'Reuse unconfirmed', tone: 'neutral', description: 'Ask before reusing this in a published concept.' },
  reference_only: { label: 'Reference only', tone: 'warning', description: 'Use it to inform the design; do not publish the file.' },
  permitted: { label: 'Ours to use', tone: 'success', description: 'Restating this fact, or using our own suggestion, is fine.' },
  prohibited: { label: 'Do not reuse', tone: 'danger', description: 'Permission or a licence is required first.' },
};

export const PROJECT_STATUS_META: Record<StudioProjectStatus, { label: string; tone: Tone; description: string }> = {
  draft: { label: 'Draft', tone: 'neutral', description: 'Created but not yet analysed.' },
  intelligence_ready: { label: 'Intelligence ready', tone: 'success', description: 'Evidence has been recorded and can be reviewed.' },
  archived: { label: 'Archived', tone: 'neutral', description: 'Kept for reference; no new analysis.' },
};

export const INTELLIGENCE_META: Record<IntelligenceStatus, { label: string; tone: Tone }> = {
  not_started: { label: 'Not analysed', tone: 'neutral' },
  ready: { label: 'Analysed', tone: 'success' },
  unavailable: { label: 'Evidence unavailable', tone: 'warning' },
};


// ── Records ─────────────────────────────────────────────────────────────────────────────────────

export interface StudioProject {
  id: string;
  organizationId: string;
  businessId: string;
  name: string;
  status: StudioProjectStatus;
  websiteUrl: string | null;
  brief: string;
  intelligenceStatus: IntelligenceStatus;
  intelligenceAt: string | null;
  intelligenceNote: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioProjectInsert {
  businessId: string;
  name: string;
  status?: StudioProjectStatus;
  websiteUrl?: string | null;
  brief?: string;
  intelligenceStatus?: IntelligenceStatus;
  intelligenceAt?: string | null;
  intelligenceNote?: string | null;
}

export type StudioProjectPatch = Partial<
  Pick<StudioProject, 'name' | 'status' | 'websiteUrl' | 'brief' | 'intelligenceStatus' | 'intelligenceAt' | 'intelligenceNote'>
>;

export interface StudioObservation {
  id: string;
  organizationId: string;
  projectId: string;
  runNumber: number;
  key: string;
  classification: EvidenceClassification;
  category: EvidenceCategory;
  label: string;
  detail: string | null;
  confidence: number;
  reusePermission: ReusePermission;
  sourceKind: StudioSourceKind;
  sourceUrl: string | null;
  assetUrl: string | null;
  assetKind: StudioAssetKind | null;
  observedAt: string;
  createdBy: string | null;
  createdAt: string;
}

export type StudioObservationInsert = Omit<StudioObservation, 'id' | 'organizationId' | 'createdBy' | 'createdAt'>;

export interface StudioReview {
  id: string;
  organizationId: string;
  projectId: string;
  observationId: string | null;
  decision: ReviewDecision;
  note: string;
  reviewerId: string | null;
  createdAt: string;
}

export type StudioReviewInsert = Omit<StudioReview, 'id' | 'organizationId' | 'reviewerId' | 'createdAt'>;

// ── Invariants ─────────────────────────────────────────────────────────────────────────────────
// The same rules migration 012 enforces in the database, so demo mode refuses what cloud mode would
// refuse instead of storing a row the database would reject.

const HTTP_URL = /^https?:\/\//i;
const validUrl = (value: string | null | undefined) => !value || (value.length <= 2000 && HTTP_URL.test(value));

/** Everything wrong with a piece of evidence, as messages a person can act on. */
export function studioObservationProblems(input: StudioObservationInsert): string[] {
  const problems: string[] = [];
  const key = input.key?.trim() ?? '';
  if (key.length < 1 || key.length > 80) problems.push('Every entry needs a key of 1–80 characters.');
  if (!EVIDENCE_CLASSIFICATIONS.includes(input.classification)) problems.push('Choose how the entry is classified.');
  if (!EVIDENCE_CATEGORIES.includes(input.category)) problems.push('Choose what the entry is about.');
  const label = input.label?.trim() ?? '';
  if (label.length < 1 || label.length > 160) problems.push('Every entry needs a label of 1–160 characters.');
  if (input.detail != null && input.detail.length > MAX_DETAIL) problems.push('An entry detail is longer than 2,000 characters.');
  if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100) problems.push('Confidence must be a whole number between 0 and 100.');
  if (!REUSE_PERMISSIONS.includes(input.reusePermission)) problems.push('Choose what may be done with this entry.');
  if (!SOURCE_KINDS.includes(input.sourceKind)) problems.push('Every entry needs a source.');
  if (!validUrl(input.sourceUrl)) problems.push('A source address must be a full http(s) link.');
  if (!validUrl(input.assetUrl)) problems.push('A reference address must be a full http(s) link.');
  if (!Number.isInteger(input.runNumber) || input.runNumber < 1 || input.runNumber > 100) problems.push('The analysis run must be numbered from 1 to 100.');
  if (!input.observedAt || Number.isNaN(Date.parse(input.observedAt))) problems.push('Every entry needs the time it was observed.');
  if ((input.assetUrl === null) !== (input.assetKind === null)) problems.push('A reference and its kind travel together.');
  if (input.assetKind !== null && input.assetKind !== undefined && input.classification !== 'restricted') problems.push('Only a restricted reference may point at a file.');
  if (input.classification === 'creative_suggestion' && input.sourceKind !== 'system') problems.push('Our suggestions are never attributed to the page.');
  if (['verified_fact', 'placeholder', 'restricted'].includes(input.classification) && !input.sourceUrl) {
    problems.push('Evidence read from a page keeps the address it came from.');
  }
  return problems;
}

/** A review says what a person decided, and why unless they simply confirmed the entry. */
export function studioReviewProblems(input: StudioReviewInsert): string[] {
  const problems: string[] = [];
  if (!REVIEW_DECISIONS.includes(input.decision)) problems.push('Choose what to do with this entry.');
  if (input.note.length > 1000) problems.push('A review note is limited to 1,000 characters.');
  if (input.decision !== 'confirm' && input.note.trim().length < 3) problems.push('Explain the decision in a few words.');
  return problems;
}

/** The analysis outcome in words, used by the services and the concept page. */
export function intelligenceSummary(counts: ClassificationCounts): string {
  const parts = [
    counts.verified_fact ? `${counts.verified_fact} verified fact${counts.verified_fact === 1 ? '' : 's'}` : null,
    counts.unknown ? `${counts.unknown} question${counts.unknown === 1 ? '' : 's'} for the business` : null,
    counts.placeholder ? `${counts.placeholder} placeholder${counts.placeholder === 1 ? '' : 's'} to replace` : null,
    counts.creative_suggestion ? `${counts.creative_suggestion} suggestion${counts.creative_suggestion === 1 ? '' : 's'}` : null,
    counts.restricted ? `${counts.restricted} restricted reference${counts.restricted === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => Boolean(part));
  return sentenceList(parts);
}

// ── Reading a project ──────────────────────────────────────────────────────────────────────────

/** The latest analysis run, which is the one the Studio shows by default. */
export function latestRunNumber(observations: StudioObservation[]): number {
  return observations.reduce((max, o) => Math.max(max, o.runNumber), 0);
}

export function runsOf(observations: StudioObservation[]): number[] {
  return [...new Set(observations.map((o) => o.runNumber))].sort((a, b) => b - a);
}

const classificationRank = (c: EvidenceClassification) => CLASSIFICATION_ORDER.indexOf(c);
const categoryRank = (c: EvidenceCategory) => EVIDENCE_CATEGORIES.indexOf(c);

function inDisplayOrder(a: StudioObservation, b: StudioObservation): number {
  return classificationRank(a.classification) - classificationRank(b.classification) || categoryRank(a.category) - categoryRank(b.category) || a.key.localeCompare(b.key);
}

/** Newest run only, in display order. */
export function latestObservations(observations: StudioObservation[]): StudioObservation[] {
  const latest = latestRunNumber(observations);
  return observations.filter((o) => o.runNumber === latest).sort(inDisplayOrder);
}

export function observationsOfRun(observations: StudioObservation[], runNumber: number): StudioObservation[] {
  return observations.filter((o) => o.runNumber === runNumber).sort(inDisplayOrder);
}

export function groupByClassification(observations: StudioObservation[]): { classification: EvidenceClassification; observations: StudioObservation[] }[] {
  return CLASSIFICATION_ORDER.map((classification) => ({ classification, observations: observations.filter((o) => o.classification === classification) })).filter((group) => group.observations.length > 0);
}

export type ClassificationCounts = Record<EvidenceClassification, number> & { total: number };

export function countClassifications(observations: StudioObservation[]): ClassificationCounts {
  const counts = Object.fromEntries(EVIDENCE_CLASSIFICATIONS.map((c) => [c, 0])) as Record<EvidenceClassification, number>;
  for (const observation of observations) counts[observation.classification] += 1;
  return { ...counts, total: observations.length };
}

export interface EvidenceReview {
  decision: ReviewDecision;
  note: string;
  at: string;
  reviewerId: string | null;
}

/** The newest review of one entry. `reviews` must be newest first, which is how the stores list them. */
export function verificationOf(observationId: string, reviews: StudioReview[]): EvidenceReview | null {
  const review = reviews.find((r) => r.observationId === observationId);
  return review ? { decision: review.decision, note: review.note, at: review.createdAt, reviewerId: review.reviewerId } : null;
}

/** The latest decision a person made about an entry; notes are not decisions. */
export function decisionOf(observationId: string, reviews: StudioReview[]): ReviewDecision | null {
  return reviews.find((r) => r.observationId === observationId && r.decision !== 'note')?.decision ?? null;
}

/** Section names proposed in navigation; page categories are structural, never interpreted. */
const CATEGORY_SECTION_LABELS: Record<string, string> = {
  about: 'About',
  products: 'Shop',
  services: 'Services',
  gallery: 'Gallery',
  booking: 'Book',
  journal: 'Journal',
};

// ── The analysis ───────────────────────────────────────────────────────────────────────────────

export type BrandObservationDraft = Omit<StudioObservationInsert, 'projectId' | 'runNumber' | 'observedAt'>;

export interface BrandIntelligenceInput {
  business: { name: string; category: string; city: string };
  facts: PageFacts;
  siteUrl: string;
  /** ISO timestamp used to judge staleness (defaults to now). */
  today?: string;
}

const MAX_DETAIL = 2_000;
const MAX_LOGO_OBSERVATIONS = 4;
const MAX_IMAGE_OBSERVATIONS = 6;

const squeeze = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);
const clampConfidence = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const sentenceList = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const unique = (items: string[]) => [...new Set(items)];

const NAME_STOPWORDS = new Set(['the', 'and', 'ltd', 'limited', 'company', 'enterprise', 'enterprises', 'ventures', 'ghana', 'services', 'shop', 'store']);

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !NAME_STOPWORDS.has(token));
}

function mentions(haystack: string, needles: string[]): boolean {
  const text = haystack.toLowerCase();
  return needles.some((needle) => new RegExp(`(^|[^a-z0-9])${needle}([^a-z0-9]|$)`).test(text));
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** true/false when both hosts are readable, null when they are not. */
function sameSite(assetUrl: string, siteUrl: string): boolean | null {
  const assetHost = hostOf(assetUrl);
  const siteHost = hostOf(siteUrl);
  if (!assetHost || !siteHost) return null;
  return registrableDomain(assetHost) === registrableDomain(siteHost);
}


/**
 * Deterministic brand intelligence from one homepage reading. No network, no interpretation of page
 * text as instructions, and no invented facts: anything the page does not show becomes an `unknown`.
 * Logos and photographs are recorded as reference-only entries; nothing is downloaded.
 */
export function buildBrandIntelligence({ business, facts, siteUrl, today }: BrandIntelligenceInput): BrandObservationDraft[] {
  const drafts: BrandObservationDraft[] = [];
  const year = Number((today ?? new Date().toISOString()).slice(0, 4)) || new Date().getUTCFullYear();

  const add = (
    draft: Omit<BrandObservationDraft, 'sourceUrl' | 'assetUrl' | 'assetKind'> & Partial<Pick<BrandObservationDraft, 'sourceUrl' | 'assetUrl' | 'assetKind'>>,
  ) => {
    drafts.push({
      ...draft,
      key: squeeze(draft.key, 80),
      label: squeeze(draft.label, 160),
      detail: draft.detail ? squeeze(draft.detail, MAX_DETAIL) : null,
      confidence: clampConfidence(draft.confidence),
      // Only an omitted address falls back to the page; an explicit null means "no page behind this",
      // which is how our own suggestions are recorded.
      sourceUrl: draft.sourceUrl === undefined ? siteUrl : draft.sourceUrl,
      assetUrl: draft.assetUrl ?? null,
      assetKind: draft.assetKind ?? null,
    });
  };

  // A parked domain shows nothing a concept can be built from; say only that.
  if (facts.parked) {
    add({
      key: 'placeholder.parked',
      classification: 'placeholder',
      category: 'content',
      label: 'Domain is parked',
      detail: 'The domain serves a parking or for-sale page rather than the business. Treat the business as having no usable website.',
      confidence: 95,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
    return drafts;
  }

  // ── Identity: a verified fact, or an explicit unknown ──
  const tokens = nameTokens(business.name);
  const named = [
    { value: facts.schemaNames[0] ?? null, confidence: 90, from: 'structured data' },
    { value: facts.siteName, confidence: 85, from: 'the Open Graph site name' },
    { value: facts.title, confidence: 75, from: 'the page title' },
  ]
    .filter((candidate): candidate is { value: string; confidence: number; from: string } => Boolean(candidate.value))
    .find((candidate) => mentions(candidate.value, tokens));

  if (named) {
    add({
      key: 'identity.name',
      classification: 'verified_fact',
      category: 'identity',
      label: 'Business name on the site',
      detail: `The site gives "${named.value}" in ${named.from}.${named.value.toLowerCase() !== business.name.toLowerCase() ? ` The CRM record is "${business.name}"; confirm which is current.` : ''}`,
      confidence: named.confidence,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  } else {
    add({
      key: 'unknown.name',
      classification: 'unknown',
      category: 'identity',
      label: 'Business name on the site',
      detail: 'The page title, site name and structured data do not name the business as recorded. Confirm the site belongs to this business before using it.',
      confidence: 75,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  if (facts.description) {
    add({
      key: 'identity.description',
      classification: 'verified_fact',
      category: 'content',
      label: 'Homepage description',
      detail: `The meta description reads: "${facts.description}"`,
      confidence: 70,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
  } else {
    add({
      key: 'unknown.description',
      classification: 'unknown',
      category: 'identity',
      label: 'Brand tagline',
      detail: 'No meta description or tagline is published on the homepage. Ask how the business describes itself in one line.',
      confidence: 80,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  if (facts.h1[0]) {
    add({
      key: 'content.heading',
      classification: 'verified_fact',
      category: 'content',
      label: 'First heading',
      detail: `The first heading reads "${facts.h1[0]}". The wording belongs to the current site; restate the idea in new copy rather than copying it.`,
      confidence: 80,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
  }

  if (facts.schemaLocality) {
    const matches = mentions(facts.schemaLocality, nameTokens(business.city));
    add({
      key: 'identity.location',
      classification: 'verified_fact',
      category: 'identity',
      label: 'Location in structured data',
      detail: `Structured data names "${facts.schemaLocality}" as the locality.${matches ? ` The CRM record agrees (${business.city}).` : business.city ? ` The CRM record says ${business.city}; confirm which is current.` : ''}`,
      confidence: matches ? 90 : 75,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  } else {
    add({
      key: 'unknown.location',
      classification: 'unknown',
      category: 'identity',
      label: 'Location',
      detail: 'The homepage does not state where the business is. Ask for the trading address and any delivery areas.',
      confidence: 75,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  // ── Contact and selling routes ──
  const contactRoutes = [
    facts.hasWhatsAppLink ? 'a WhatsApp link' : null,
    facts.hasTelLink ? 'a tap-to-call phone link' : null,
    facts.hasMailtoLink ? 'an email link' : null,
    facts.formCount ? `${facts.formCount} enquiry ${facts.formCount === 1 ? 'form' : 'forms'}` : null,
  ].filter((value): value is string => Boolean(value));

  if (contactRoutes.length) {
    add({
      key: 'contact.routes',
      classification: 'verified_fact',
      category: 'contact',
      label: 'Contact routes published',
      detail: `The homepage publishes ${sentenceList(contactRoutes)}.${facts.insecureFormAction ? ' A form posts over plain HTTP, so submissions are not protected in transit.' : ''}`,
      confidence: 85,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  } else {
    add({
      key: 'unknown.contact',
      classification: 'unknown',
      category: 'contact',
      label: 'Contact route',
      detail: 'The homepage publishes no phone, email, WhatsApp link or enquiry form. Ask how customers reach the business today.',
      confidence: 85,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  const sellingRoutes = [facts.commerce ? 'an online shop or checkout' : null, facts.catalogue ? 'a product listing or catalogue' : null, facts.booking ? 'online booking' : null].filter(
    (value): value is string => Boolean(value),
  );
  if (sellingRoutes.length) {
    add({
      key: 'commerce.routes',
      classification: 'verified_fact',
      category: 'commerce',
      label: 'Selling route on the site',
      detail: `The site offers ${sentenceList(sellingRoutes)}.`,
      confidence: 80,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  } else if (!facts.navLinks.some((link) => link.category === 'products' || link.category === 'services' || link.category === 'gallery')) {
    add({
      key: 'unknown.offering',
      classification: 'unknown',
      category: 'content',
      label: 'Product or service range',
      detail: 'The homepage does not make the product or service range clear. Ask for the main lines, typical order size and what sells best.',
      confidence: 70,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  if (facts.socialLinks.length) {
    add({
      key: 'identity.social',
      classification: 'verified_fact',
      category: 'identity',
      label: 'Social profiles linked',
      detail: `The homepage links to ${sentenceList(unique(facts.socialLinks.map((link) => link.platform)))}. Profile content stays on the platform: link to it rather than copying it.`,
      confidence: 90,
      reusePermission: 'reference_only',
      sourceKind: 'website_page',
    });
  }


  // ── Structure, palette and platform ──
  const sectionsSeen = unique(facts.navLinks.filter((link) => link.category !== 'home' && link.category !== 'other').map((link) => link.label)).slice(0, 6);
  if (sectionsSeen.length >= 2) {
    add({
      key: 'navigation.sections',
      classification: 'verified_fact',
      category: 'navigation',
      label: 'Sections linked from the homepage',
      detail: `The homepage links to ${sentenceList(sectionsSeen)}${facts.navLinks.length > sectionsSeen.length ? `, among ${facts.navLinks.length} same-site links` : ''}.`,
      confidence: 85,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  } else {
    add({
      key: 'unknown.navigation',
      classification: 'unknown',
      category: 'navigation',
      label: 'Site structure',
      detail: `The homepage exposes no clear section navigation (${facts.navLinks.length} same-site link${facts.navLinks.length === 1 ? '' : 's'} found). Confirm which pages the business wants.`,
      confidence: 65,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  if (facts.themeColor || facts.colors.length) {
    const palette = unique([...(facts.themeColor ? [facts.themeColor] : []), ...facts.colors]).slice(0, 6);
    add({
      key: 'palette.declared',
      classification: 'verified_fact',
      category: 'palette',
      label: 'Colours declared in the page',
      detail: `The page declares ${sentenceList(palette)}${facts.themeColor ? ` (theme colour ${facts.themeColor})` : ''}. Values were read from CSS; check contrast before adopting them.`,
      confidence: 80,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  } else {
    add({
      key: 'unknown.palette',
      classification: 'unknown',
      category: 'palette',
      label: 'Brand colours',
      detail: 'The page declares no theme colour or palette. Ask for brand guidelines, or sample colours from signage and packaging.',
      confidence: 70,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  if (facts.fonts.length) {
    add({
      key: 'typography.fonts',
      classification: 'verified_fact',
      category: 'typography',
      label: 'Typefaces referenced',
      detail: `The page references ${sentenceList(facts.fonts)}. The page does not show whether a web licence covers reuse.`,
      confidence: 70,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  add({
    key: facts.hasViewport ? 'accessibility.viewport' : 'accessibility.viewport_missing',
    classification: 'verified_fact',
    category: 'accessibility',
    label: facts.hasViewport ? 'Mobile viewport declared' : 'No mobile viewport',
    detail: facts.hasViewport
      ? 'The page declares a mobile viewport, so it is meant to adapt to phones. Check the layout on a small screen before judging it.'
      : 'The page declares no mobile viewport, so it is likely to render at desktop width on a phone.',
    confidence: facts.hasViewport ? 95 : 90,
    reusePermission: 'permitted',
    sourceKind: 'website_page',
  });

  if (facts.lang) {
    add({
      key: 'content.language',
      classification: 'verified_fact',
      category: 'content',
      label: 'Page language',
      detail: `The page declares lang="${facts.lang}".`,
      confidence: 90,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  }

  if (facts.copyrightYear) {
    add({
      key: 'content.copyright',
      classification: 'verified_fact',
      category: 'content',
      label: 'Footer date',
      detail: `The footer is dated ${facts.copyrightYear}.`,
      confidence: facts.copyrightYear === year ? 80 : 70,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  }

  if (facts.generator) {
    add({
      key: 'platform.generator',
      classification: 'verified_fact',
      category: 'platform',
      label: 'Site platform',
      detail: `The page reports "${facts.generator}" as its generator. Record it so the rebuild plan accounts for exported content, forms and domains.`,
      confidence: 80,
      reusePermission: 'permitted',
      sourceKind: 'website_page',
    });
  }


  // ── Gaps that a concept must not paper over ──
  if (!facts.logoCandidates.length && !facts.favicon) {
    add({
      key: 'unknown.logo',
      classification: 'unknown',
      category: 'logo',
      label: 'Logo',
      detail: 'No logo or icon file is referenced by the homepage. Ask for a vector logo, or photograph a signboard or packaging at the client meeting.',
      confidence: 75,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  if (!facts.imageCandidates.length) {
    add({
      key: 'unknown.imagery',
      classification: 'unknown',
      category: 'imagery',
      label: 'Photography',
      detail: 'The homepage shows no photography or brand imagery. Plan a short shoot: shopfront, team, three products and one detail shot.',
      confidence: 70,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }

  // ── Placeholders: content the concept must not inherit ──
  if (facts.placeholder) {
    add({
      key: 'placeholder.template',
      classification: 'placeholder',
      category: 'content',
      label: 'Template or placeholder copy',
      detail: 'The homepage shows template or placeholder wording. It cannot be used as the basis for the concept.',
      confidence: 90,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
  }
  if (facts.wordCount < 150) {
    add({
      key: 'placeholder.thin',
      classification: 'placeholder',
      category: 'content',
      label: 'Very little content',
      detail: `The homepage carries about ${facts.wordCount} word${facts.wordCount === 1 ? '' : 's'} of visible text. There is little to describe the offer, so most of the brief must come from the business.`,
      confidence: 75,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }
  if (facts.copyrightYear && facts.copyrightYear <= year - 2) {
    add({
      key: 'placeholder.stale',
      classification: 'placeholder',
      category: 'content',
      label: 'Stale footer date',
      detail: `The footer is dated ${facts.copyrightYear}. Prices, opening hours and offers on the site may be out of date.`,
      confidence: 70,
      reusePermission: 'unknown',
      sourceKind: 'website_page',
    });
  }


  // ── Creative suggestions: ours, never evidence about the business ──
  const place = business.city ? ` in ${business.city}` : '';
  const primaryAction = facts.hasWhatsAppLink ? 'a WhatsApp message' : facts.hasTelLink ? 'a tap-to-call link' : 'an enquiry form';
  add({
    key: 'suggestion.hero',
    classification: 'creative_suggestion',
    category: 'content',
    label: 'Homepage opening',
    detail: `Open with one specific line about ${business.category.toLowerCase()}${place} and a single primary action (${primaryAction}). Keep the promise testable and back it with a delivery or turnaround detail.`,
    confidence: 60,
    reusePermission: 'permitted',
    sourceKind: 'system',
    sourceUrl: null,
  });

  const suggestedSections = unique([
    'Home',
    ...facts.navLinks.map((link) => CATEGORY_SECTION_LABELS[link.category]).filter((label): label is string => Boolean(label)).slice(0, 2),
    'Contact',
  ]);
  add({
    key: 'suggestion.navigation',
    classification: 'creative_suggestion',
    category: 'navigation',
    label: 'Navigation',
    detail: `Use a short navigation — ${sentenceList(suggestedSections)} — with no more than five items. Everything else belongs in the footer or on one longer page.`,
    confidence: 55,
    reusePermission: 'permitted',
    sourceKind: 'system',
    sourceUrl: null,
  });

  add({
    key: 'suggestion.contact',
    classification: 'creative_suggestion',
    category: 'contact',
    label: 'Primary action',
    detail: facts.hasWhatsAppLink
      ? 'Keep WhatsApp as the primary action, since the site already publishes it, add a tap-to-call secondary link, and state how quickly a reply arrives.'
      : 'Add a tap-to-call number and a WhatsApp link above the fold. Both are how customers usually make first contact.',
    confidence: 60,
    reusePermission: 'permitted',
    sourceKind: 'system',
    sourceUrl: null,
  });

  add({
    key: 'suggestion.palette',
    classification: 'creative_suggestion',
    category: 'palette',
    label: 'Palette direction',
    detail: facts.themeColor
      ? `Build the palette around the declared theme colour ${facts.themeColor}: one primary, three neutrals and one accent reserved for actions.`
      : 'Choose one primary and three neutrals before design, taken from the shopfront or product photographs, and document the values.',
    confidence: 55,
    reusePermission: 'permitted',
    sourceKind: 'system',
    sourceUrl: null,
  });

  add({
    key: 'suggestion.imagery',
    classification: 'creative_suggestion',
    category: 'imagery',
    label: 'Imagery plan',
    detail: facts.imageCandidates.length
      ? `Plan new photography rather than reusing the ${facts.imageCandidates.length} image${facts.imageCandidates.length === 1 ? '' : 's'} referenced by the current site; nothing there is confirmed as licensed for reuse.`
      : 'Plan a short shoot: shopfront, team, three products and one detail shot — enough for the homepage and a gallery.',
    confidence: 55,
    reusePermission: 'permitted',
    sourceKind: 'system',
    sourceUrl: null,
  });

  if (facts.fonts.length) {
    add({
      key: 'suggestion.typography',
      classification: 'creative_suggestion',
      category: 'typography',
      label: 'Typography direction',
      detail: `Keep ${facts.fonts[0]} for headings only if a web licence is confirmed, and pair it with a system sans-serif for body text so pages stay fast on mobile data.`,
      confidence: 55,
      reusePermission: 'permitted',
      sourceKind: 'system',
      sourceUrl: null,
    });
  }

  if (!facts.hasViewport) {
    add({
      key: 'suggestion.mobile_first',
      classification: 'creative_suggestion',
      category: 'accessibility',
      label: 'Mobile-first build',
      detail: 'Rebuild mobile-first with a 16px base size, 44px touch targets and a phone number that dials on tap. Most customers arrive on a phone.',
      confidence: 65,
      reusePermission: 'permitted',
      sourceKind: 'system',
      sourceUrl: null,
    });
  }

  if (facts.commerce || facts.catalogue) {
    add({
      key: 'suggestion.trust',
      classification: 'creative_suggestion',
      category: 'commerce',
      label: 'Buying confidence',
      detail: 'Show delivery areas and cost, returns, and the payment options (Mobile Money, card, cash on delivery) beside the buy action. These are the questions that stall an online order.',
      confidence: 60,
      reusePermission: 'permitted',
      sourceKind: 'system',
      sourceUrl: null,
    });
  }


  // ── Restricted references: nothing here may be republished as-is ──
  facts.logoCandidates.slice(0, MAX_LOGO_OBSERVATIONS).forEach((logo, index) => {
    add({
      key: `asset.logo.${index + 1}`,
      classification: 'restricted',
      category: 'logo',
      label: `${logo.role === 'icon' ? 'Icon' : 'Logo'} reference ${index + 1}`,
      detail: `Reference only: ${hostLabel(logo.url)} serves this file${logo.alt ? ` (alt text "${logo.alt}")` : ''}. It was not downloaded; publish it only with the business's written permission or a licence.`,
      confidence: 100,
      reusePermission: 'reference_only',
      sourceKind: 'website_page',
      assetUrl: logo.url,
      assetKind: logo.role === 'icon' ? 'icon' : 'logo',
    });
  });

  if (!facts.logoCandidates.length && facts.favicon) {
    add({
      key: 'asset.favicon',
      classification: 'restricted',
      category: 'logo',
      label: 'Favicon reference',
      detail: `Reference only: ${hostLabel(facts.favicon)} serves the site icon. A favicon is not a usable logo; ask for the original artwork.`,
      confidence: 100,
      reusePermission: 'reference_only',
      sourceKind: 'website_page',
      assetUrl: facts.favicon,
      assetKind: 'favicon',
    });
  }

  facts.imageCandidates.slice(0, MAX_IMAGE_OBSERVATIONS).forEach((image, index) => {
    add({
      key: `asset.image.${index + 1}`,
      classification: 'restricted',
      category: 'imagery',
      label: `Image reference ${index + 1}`,
      detail: `Reference only: ${hostLabel(image.url)} serves this image${image.alt ? ` (alt text "${image.alt}")` : ''}. It was not downloaded; ownership and licence are unknown.`,
      confidence: 100,
      reusePermission: 'reference_only',
      sourceKind: 'website_page',
      assetUrl: image.url,
      assetKind: 'image',
    });
  });

  const assetUrls = [...facts.logoCandidates.map((logo) => logo.url), ...(facts.favicon ? [facts.favicon] : []), ...facts.imageCandidates.map((image) => image.url)];
  const thirdPartyHosts = unique(assetUrls.filter((url) => sameSite(url, siteUrl) === false).map(hostLabel)).slice(0, 3);
  if (thirdPartyHosts.length) {
    add({
      key: 'restriction.third_party_assets',
      classification: 'restricted',
      category: 'restriction',
      label: 'Files served from another host',
      detail: `Some referenced files come from ${sentenceList(thirdPartyHosts)} rather than the business's own domain. They may belong to a photographer, an agency or a stock library. Confirm ownership before use.`,
      confidence: 100,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
  }

  if (facts.socialLinks.length) {
    add({
      key: 'restriction.platform_marks',
      classification: 'restricted',
      category: 'restriction',
      label: 'Platform brand marks',
      detail: "Facebook, Instagram, TikTok and WhatsApp marks belong to their owners, and profile imagery may not be the business's to license. Link to the profiles; do not copy marks or profile photographs.",
      confidence: 100,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
  }

  if (facts.description || facts.h1.length) {
    add({
      key: 'restriction.site_copy',
      classification: 'restricted',
      category: 'restriction',
      label: 'Existing site copy',
      detail: 'Headings and descriptions were written for the current site, possibly by another agency. Restate the facts in new copy; do not republish the wording without permission.',
      confidence: 100,
      reusePermission: 'prohibited',
      sourceKind: 'website_page',
    });
  }

  return drafts;
}

