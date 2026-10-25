// Creative Direction: the argued territory that comes before a design is drawn.
//
// The Studio must never produce a generic template with the client's logo in it. This module turns the
// approved Brand Kit, reviewed evidence and the concept brief into a structured Creative Direction
// Brief and three genuinely different territories. It records what it knows and what it is proposing:
//
//   verified_fact ........ observed on the business's page, with the observation id
//   business_record ...... recorded in the workspace (name, category, city, website)
//   approved_brand_kit ... a person approved this content in the Brand Kit
//   creative_suggestion .. the Studio's proposal, never evidence about the business
//   studio_standard ...... a constraint the Studio holds itself to (WCAG, performance, motion)
//   client_confirmation .. the business must answer before the direction is final
//
// Generation is deterministic and offline. No paid model is called. An optional AI enhancement
// interface exists in src/lib/server/providers/creative.ts, disabled until configured and authorised,
// and must return this same structure rather than free-form code.

import type { Business } from './types';
import type { StudioObservation, StudioReview, StudioProject } from './studio';
import type { BrandKitContent, StudioAsset } from './studio-assets';
import {
  FONT_CATALOGUE,
  fontById,
  fontStack,
  pairingKey,
  pairingRationale,
  recommendFontPairings,
  type FontSpec,
} from './font-catalogue';
import {
  BREAKPOINTS,
  COMPOSITION_META,
  MOTION_META,
  buildDesignTokens,
  buildPalette,
  buildTypeScale,
  contrastChecks,
  paletteEntry,
  tokenProblems,
  type CompositionFamily,
  type ContrastCheck,
  type DesignTokens,
  type MotionDirection,
  type MotionSpec,
  type PaletteToken,
  type TypeSystem,
  type TypeRatioName,
} from './design-tokens';

export const CREATIVE_BRIEF_FORMAT = 'dof-creative-brief/1';
export const CREATIVE_DIRECTION_FORMAT = 'dof-creative-direction/1';

export const BRIEF_BASES = [
  'verified_fact',
  'business_record',
  'approved_brand_kit',
  'approved_asset',
  'creative_suggestion',
  'studio_standard',
  'client_confirmation',
] as const;
export type BriefBasis = (typeof BRIEF_BASES)[number];

export const BRIEF_BASIS_META: Record<BriefBasis, { label: string; tone: 'success' | 'info' | 'accent' | 'neutral' | 'warning'; description: string }> = {
  verified_fact: { label: 'Verified fact', tone: 'success', description: 'Read from the business’s own page, with the observation recorded.' },
  business_record: { label: 'Business record', tone: 'info', description: 'Recorded in the workspace by the team: name, trade, city, address.' },
  approved_brand_kit: { label: 'Approved Brand Kit', tone: 'info', description: 'A person approved this content in a specific Brand Kit version.' },
  approved_asset: { label: 'Approved asset', tone: 'info', description: 'A person approved this file in the vault, with its provenance and permissions recorded.' },
  creative_suggestion: { label: 'Creative suggestion', tone: 'accent', description: 'The Studio’s proposal. It is not evidence about the business.' },
  studio_standard: { label: 'Studio standard', tone: 'neutral', description: 'A constraint the Studio holds itself to: accessibility, performance, motion.' },
  client_confirmation: { label: 'Needs confirmation', tone: 'warning', description: 'The business must confirm this before the direction is final.' },
};

export const BRIEF_SECTION_KEYS = [
  'identity',
  'audience',
  'positioning',
  'objectives',
  'atmosphere',
  'storytelling',
  'artDirection',
  'layout',
  'typography',
  'colour',
  'photography',
  'motion',
  'mobile',
  'accessibility',
] as const;
export type BriefSectionKey = (typeof BRIEF_SECTION_KEYS)[number];

export const BRIEF_SECTION_LABELS: Record<BriefSectionKey, string> = {
  identity: 'Business identity',
  audience: 'Audience',
  positioning: 'Personality and positioning',
  objectives: 'Design objectives and conversion',
  atmosphere: 'Emotional atmosphere',
  storytelling: 'Visual storytelling',
  artDirection: 'Art direction',
  layout: 'Layout principles',
  typography: 'Typography research',
  colour: 'Colour strategy',
  photography: 'Photography and media',
  motion: 'Motion and interaction',
  mobile: 'Mobile considerations',
  accessibility: 'Accessibility constraints',
};

export interface BriefEvidence {
  observationIds: string[];
  assetIds: string[];
  brandKitVersion: number | null;
  /** Dotted record references, e.g. business.name; never free-form claims. */
  record: string[];
  note: string | null;
}

export const emptyEvidence = (): BriefEvidence => ({ observationIds: [], assetIds: [], brandKitVersion: null, record: [], note: null });

export interface BriefAssertion {
  id: string;
  text: string;
  basis: BriefBasis;
  evidence: BriefEvidence;
}

export interface BriefSection {
  summary: string;
  assertions: BriefAssertion[];
}

export interface BriefMissingInformation {
  id: string;
  question: string;
  why: string;
  blocking: boolean;
  source: 'unknown_observation' | 'brand_kit_gap' | 'licence' | 'language' | 'content';
}

export interface BriefConfirmation {
  id: string;
  item: string;
  why: string;
  required: boolean;
}

export interface BriefTypographyPlan {
  displayFontId: string;
  bodyFontId: string;
  displayFamily: string;
  bodyFamily: string;
  rationale: string;
  licences: string[];
  languages: string[];
  scale: TypeSystem;
  fromBrandKit: boolean;
}

export interface BriefColourPlan {
  strategy: string;
  palette: PaletteToken[];
  contrast: ContrastCheck[];
  notes: string;
}

export interface BriefPhotographyPlan {
  direction: string;
  assetIds: string[];
  missing: string[];
  treatment: string;
}

export interface BriefBrandKitSnapshot {
  versionId: string;
  version: number;
  approvedAt: string | null;
  personality: string[];
  visualDirection: string;
  toneOfVoice: { summary: string; do: string[]; dont: string[] };
  palette: { name: string; hex: string; role: string }[];
  typography: { role: string; family: string; weights: string; licence: string; assetId: string | null }[];
  logoAssetIds: string[];
  photographyAssetIds: string[];
}

export interface CreativeBriefContent {
  format: typeof CREATIVE_BRIEF_FORMAT;
  business: { name: string; category: string; city: string; websiteUrl: string | null; siteUrl: string | null };
  brandKit: BriefBrandKitSnapshot | null;
  sections: Record<BriefSectionKey, BriefSection>;
  typography: BriefTypographyPlan;
  colour: BriefColourPlan;
  photography: BriefPhotographyPlan;
  languages: string[];
  missingInformation: BriefMissingInformation[];
  confirmations: BriefConfirmation[];
  provenance: { verified: number; brandKit: number; assets: number; suggestions: number; confirmations: number; standards: number };
}

// ── Stored records (mirrored by data stores and migration 014) ───────────────────────────────

export const BRIEF_REVIEW_DECISIONS = ['confirm', 'reject', 'note'] as const;
export type BriefReviewDecision = (typeof BRIEF_REVIEW_DECISIONS)[number];

export const DIRECTION_REVIEW_DECISIONS = ['feedback', 'request_changes', 'approve', 'reject'] as const;
export type DirectionReviewDecision = (typeof DIRECTION_REVIEW_DECISIONS)[number];

export interface StudioCreativeBrief {
  id: string;
  organizationId: string;
  projectId: string;
  version: number;
  content: CreativeBriefContent;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface StudioCreativeBriefReview {
  id: string;
  organizationId: string;
  projectId: string;
  briefId: string;
  decision: BriefReviewDecision;
  note: string;
  reviewerId: string | null;
  createdAt: string;
}

export interface StudioCreativeDirection {
  id: string;
  organizationId: string;
  projectId: string;
  briefId: string;
  version: number;
  content: CreativeDirectionContent;
  generatedBy: 'deterministic' | 'ai_assisted';
  derivedFromId: string | null;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface StudioCreativeDirectionReview {
  id: string;
  organizationId: string;
  projectId: string;
  directionId: string;
  conceptKey: string;
  decision: DirectionReviewDecision;
  note: string;
  reviewerId: string | null;
  createdAt: string;
}

export type StudioCreativeBriefInsert = Omit<StudioCreativeBrief, 'id' | 'organizationId' | 'createdBy' | 'createdAt'>;
export type StudioCreativeBriefReviewInsert = Omit<StudioCreativeBriefReview, 'id' | 'organizationId' | 'reviewerId' | 'createdAt'>;
export type StudioCreativeDirectionInsert = Omit<StudioCreativeDirection, 'id' | 'organizationId' | 'createdBy' | 'createdAt'>;
export type StudioCreativeDirectionReviewInsert = Omit<StudioCreativeDirectionReview, 'id' | 'organizationId' | 'reviewerId' | 'createdAt'>;

// ── Concepts ─────────────────────────────────────────────────────────────────────────────────

export interface ConceptEvidence {
  observationIds: string[];
  observationLabels: string[];
  brandKitVersion: number | null;
  notes: string[];
}

export interface ConceptTypography {
  displayFontId: string;
  bodyFontId: string;
  displayFamily: string;
  bodyFamily: string;
  displayWeights: string;
  bodyWeights: string;
  rationale: string;
  licence: { display: string; body: string };
  licenceUrls: { display: string; body: string };
  languages: string[];
  scale: TypeSystem;
  fallback: { display: string; body: string };
  fromBrandKit: boolean;
  notes: string;
}

export interface ConceptColour {
  strategy: string;
  palette: PaletteToken[];
  contrast: ContrastCheck[];
  notes: string;
}

export interface ConceptComposition {
  family: CompositionFamily;
  label: string;
  grid: string;
  navigation: string;
  hero: string;
  spacing: string;
  imageComposition: string;
  materials: string[];
  avoid: string[];
}

export interface CreativeReference {
  title: string;
  url: string | null;
  licence: string;
  note: string;
}

export interface ConceptImagery {
  direction: string;
  treatment: string;
  assetIds: string[];
  logoAssetIds: string[];
  missing: string[];
  references: CreativeReference[];
}

export interface ConceptMotion {
  direction: MotionDirection;
  label: string;
  idea: string;
  spec: MotionSpec;
  reducedMotion: string;
  performance: string[];
  notes: string;
}

export interface ConceptConversion {
  path: string[];
  primaryCta: string;
  proofOrder: string[];
  friction: string[];
}

export interface ConceptResponsive {
  mobileFirst: string;
  breakpoints: { name: string; minWidth: number; behavior: string }[];
  navigation: string;
  typography: string;
  imagery: string;
  constraints: string[];
}

export interface ConceptStory {
  headline: string;
  premise: string;
  arc: string[];
  chapters: { name: string; intent: string }[];
}

export interface QualityDimension {
  key: string;
  label: string;
  score: number;
  note: string;
}

export interface ConceptQualityReview {
  dimensions: QualityDimension[];
  overall: number;
  advisory: string;
}

export interface CreativeConcept {
  key: string;
  name: string;
  idea: string;
  narrative: string;
  typography: ConceptTypography;
  colour: ConceptColour;
  composition: ConceptComposition;
  imagery: ConceptImagery;
  motion: ConceptMotion;
  conversion: ConceptConversion;
  responsive: ConceptResponsive;
  story: ConceptStory;
  rationale: { audience: string; business: string; evidence: ConceptEvidence };
  tradeoffs: string[];
  risks: string[];
  tokens: DesignTokens;
  quality: ConceptQualityReview;
}

export interface CreativeDirectionContent {
  format: typeof CREATIVE_DIRECTION_FORMAT;
  briefVersionId: string;
  briefVersion: number;
  brandKitVersionId: string;
  brandKitVersion: number;
  seed: string;
  generatedBy: 'deterministic' | 'ai_assisted';
  concepts: CreativeConcept[];
  comparison: { dimension: string; values: { conceptKey: string; value: string }[] }[];
  recommendation: { conceptKey: string; why: string; advisory: string };
  limitations: string[];
}

// ── Sector profiles ──────────────────────────────────────────────────────────────────────────

export type SectorProfile = 'fashion' | 'hospitality' | 'architecture' | 'professional' | 'food' | 'retail' | 'health' | 'education' | 'technology' | 'other';

const SECTOR_KEYWORDS: Record<SectorProfile, string[]> = {
  fashion: ['fashion', 'tailor', 'tailoring', 'seamstress', 'kente', 'kaba', 'cloth', 'clothing', 'apparel', 'textile', 'jewellery', 'jewelry', 'beauty', 'salon', 'barber'],
  hospitality: ['hotel', 'resort', 'guesthouse', 'guest house', 'lodge', 'hospitality', 'travel', 'tour', 'restaurant', 'café', 'cafe', 'bar', 'catering', 'event'],
  architecture: ['architect', 'architecture', 'interior', 'design studio', 'urban', 'planning', 'engineering', 'construction', 'survey', 'property', 'real estate'],
  professional: ['law', 'legal', 'account', 'audit', 'consult', 'advisory', 'finance', 'insurance', 'notary', 'recruitment', 'logistics', 'professional services'],
  food: ['bakery', 'bakeshop', 'food', 'kitchen', 'catering', 'restaurant', 'juice', 'coffee', 'chocolate'],
  retail: ['shop', 'store', 'retail', 'market', 'furniture', 'bookshop', 'electronics', 'supermarket', 'wholesale', 'supplies'],
  health: ['clinic', 'hospital', 'health', 'dental', 'dentist', 'pharmacy', 'physio', 'therapy', 'diagnostic', 'medical', 'wellness'],
  education: ['school', 'academy', 'college', 'university', 'training', 'tutor', 'education', 'nursery', 'montessori'],
  technology: ['software', 'technology', 'tech', 'digital', 'data', 'app', 'web', 'startup', 'it services', 'ict'],
  other: [],
};

export const SECTOR_META: Record<SectorProfile, { label: string; audience: string; atmosphere: string; conversion: string }> = {
  fashion: {
    label: 'Fashion and tailoring',
    audience: 'People commissioning or buying a garment who care how it is cut, finished and worn — often for a wedding, a naming ceremony, a promotion or a considered purchase for themselves.',
    atmosphere: 'Intimate, exacting and unhurried. The work should feel handled rather than marketed: cloth, hands, fitting, finish.',
    conversion: 'Book a fitting or start a commission through WhatsApp, with the price range and lead time answered before the first message.',
  },
  hospitality: {
    label: 'Hospitality',
    audience: 'Travellers and hosts choosing where to stay or eat, often on a phone, comparing three or four places on the same evening. They need to trust the room and the welcome before they need the story.',
    atmosphere: 'Calm, warm and quietly confident. Arrival, light, linen, a drink offered before the form. Nothing hurried or over-familiar.',
    conversion: 'Check availability or reserve a room directly, with dates, price and cancellation terms visible before the booking form.',
  },
  architecture: {
    label: 'Architecture and design',
    audience: 'Clients with a site, a budget and a decision to defend: homeowners, developers, institutions or a procurement committee. They are judging judgement.',
    atmosphere: 'Measured, material and precise. Drawings, models, junctions and daylight rather than glossy renders with no plan attached.',
    conversion: 'Request a consultation or send a brief, after seeing how the practice thinks, what it has built and what it costs to start.',
  },
  professional: {
    label: 'Professional services',
    audience: 'A client or company with a problem that has consequences: a contract, a filing, a dispute, a growth decision. They need evidence of competence and a clear next step.',
    atmosphere: 'Assured, plain-spoken and unshowy. The confidence of someone who has done this before and can explain it without jargon.',
    conversion: 'Book an initial conversation or send the matter, with credentials, process and fees explained before the form.',
  },
  food: {
    label: 'Food and drink',
    audience: 'Local customers deciding what to eat today, and hosts planning an occasion. They respond to appetite, clarity of offer and a route to order.',
    atmosphere: 'Generous, tactile and warm. Ingredients close up, hands at work, a table that looks used rather than staged.',
    conversion: 'Order, reserve or message, with the menu, prices, hours and delivery area visible immediately.',
  },
  retail: {
    label: 'Retail and trade',
    audience: 'Buyers comparing range, price and availability, often with a specific item in mind. They need the catalogue to be accurate and the route to purchase to be obvious.',
    atmosphere: 'Confident, orderly and material. The product is the hero; the interface stays out of its way.',
    conversion: 'Browse the range and buy, reserve or enquire, with stock, price, delivery and returns stated plainly.',
  },
  health: {
    label: 'Health and wellbeing',
    audience: 'Patients and families making a decision under stress. They need clarity, credentials, privacy and a route to an appointment that works on a phone.',
    atmosphere: 'Calm, humane and trustworthy. Natural light, plain language, no claims that cannot be substantiated.',
    conversion: 'Book an appointment or call, with location, hours, practitioners and what to expect made obvious.',
  },
  education: {
    label: 'Education',
    audience: 'Parents, students and sponsors comparing outcomes, fees and pastoral care. They need proof of teaching and a human route to a question.',
    atmosphere: 'Curious, encouraging and orderly. Work on the wall, not stock photographs of children at laptops.',
    conversion: 'Book a visit or request a prospectus, with fees, term dates and the admissions process stated.',
  },
  technology: {
    label: 'Technology',
    audience: 'A buyer or technical evaluator looking for evidence that the product works, fits their stack and can be trusted with their data.',
    atmosphere: 'Clear, credible and quietly ambitious. Demonstration over adjectives; real interface states over abstract networks.',
    conversion: 'Start a trial or book a demonstration, with pricing, integration and security information before the sign-up.',
  },
  other: {
    label: 'Local business',
    audience: 'Local customers deciding whether this business can meet their need, comparing it with two or three others on a phone.',
    atmosphere: 'Specific and human. The place, the people and the work, without borrowed corporate language.',
    conversion: 'Make one clear enquiry — message, call or visit — with the practical details answered first.',
  },
};

export function sectorProfile(category: string | null | undefined): SectorProfile {
  const value = (category ?? '').toLowerCase();
  for (const [profile, words] of Object.entries(SECTOR_KEYWORDS) as [SectorProfile, string[]][]) {
    if (words.some((word) => value.includes(word))) return profile;
  }
  return 'other';
}

// ── Small helpers ────────────────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();
const todayIso = () => nowIso().slice(0, 10);
const unique = <T,>(values: T[]): T[] => [...new Set(values)];

/** The assets a direction may reference: approved, still licensed, and cleared for a private prototype. */
export function prototypeAssets(assets: readonly StudioAsset[], today = todayIso()): StudioAsset[] {
  return assets.filter(
    (asset) =>
      asset.status === 'approved' &&
      ['granted', 'not_required'].includes(asset.prototypePermission) &&
      !(asset.licenceExpiresOn && asset.licenceExpiresOn < today),
  );
}

function assetLabel(asset: StudioAsset): string {
  return `${asset.fileName}${asset.licenceName ? ` (${asset.licenceName})` : ''}`;
}

interface ApprovedKitInput {
  versionId: string;
  version: number;
  approvedAt: string | null;
  content: BrandKitContent;
}

export interface BriefBuildInput {
  project: StudioProject;
  business: Business;
  observations: StudioObservation[];
  reviews: StudioReview[];
  kit: ApprovedKitInput | null;
  assets: StudioAsset[];
}

function latestRun(observations: readonly StudioObservation[]): StudioObservation[] {
  const run = Math.max(0, ...observations.map((observation) => observation.runNumber));
  return observations.filter((observation) => observation.runNumber === run);
}

function confirmed(observation: StudioObservation, reviews: readonly StudioReview[]): boolean {
  return reviews.some((review) => review.observationId === observation.id && review.decision === 'confirm');
}

function kitColour(content: BrandKitContent, pattern: RegExp, fallback: string): string {
  const match = content.palette.find((entry) => pattern.test(`${entry.role} ${entry.name}`));
  return match && /^#[0-9a-f]{6}$/i.test(match.hex) ? match.hex : fallback;
}

function fontFromFamily(value: string): FontSpec | null {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return null;
  return FONT_CATALOGUE.find((font) => font.family.toLowerCase() === wanted || font.id === wanted) ?? null;
}

/** The conversion route the evidence actually supports, strongest first. */
function conversionRoute(observations: readonly StudioObservation[]): { label: string; ids: string[] } {
  const verified = observations.filter((observation) => observation.classification === 'verified_fact');
  const routes = verified.filter((observation) => observation.key === 'contact.routes' || observation.key === 'commerce.routes');
  if (!routes.length) return { label: '', ids: [] };
  const text = routes.map((route) => (route.detail ?? '').toLowerCase()).join(' ');
  const ids = routes.map((route) => route.id);
  if (/booking/.test(text)) return { label: 'book online', ids };
  if (/shop|checkout|commerce/.test(text)) return { label: 'buy online', ids };
  if (/whatsapp/.test(text)) return { label: 'message on WhatsApp', ids };
  if (/phone|call/.test(text)) return { label: 'call', ids };
  if (/form/.test(text)) return { label: 'send an enquiry form', ids };
  if (/email/.test(text)) return { label: 'send an email', ids };
  return { label: 'make an enquiry', ids };
}

const SUGGESTED_PERSONALITY: Record<SectorProfile, string[]> = {
  fashion: ['quietly confident', 'exacting', 'warm', 'crafted'],
  hospitality: ['calm', 'warm', 'understated', 'hospitable'],
  architecture: ['measured', 'precise', 'material', 'confident'],
  professional: ['assured', 'plain', 'rigorous', 'trustworthy'],
  food: ['generous', 'tactile', 'warm', 'unpretentious'],
  retail: ['confident', 'orderly', 'material', 'direct'],
  health: ['calm', 'humane', 'clear', 'trustworthy'],
  education: ['curious', 'encouraging', 'orderly', 'inclusive'],
  technology: ['clear', 'credible', 'technical', 'ambitious'],
  other: ['specific', 'human', 'confident', 'practical'],
};

const SECTOR_PALETTE: Record<SectorProfile, { background: string; text: string; accent: string; support: string }> = {
  fashion: { background: '#F4EDE3', text: '#241E1A', accent: '#7A1F3D', support: '#B98A44' },
  hospitality: { background: '#F2EDE4', text: '#20241F', accent: '#31533F', support: '#B98A54' },
  architecture: { background: '#EDEEEC', text: '#17191A', accent: '#B23A26', support: '#7C8586' },
  professional: { background: '#F5F4EF', text: '#1B2430', accent: '#1F4E79', support: '#9A7B4F' },
  food: { background: '#FBF4E6', text: '#2A1E17', accent: '#B4471F', support: '#6D7C3B' },
  retail: { background: '#F7F5F1', text: '#1C1C1C', accent: '#274C77', support: '#C08A2E' },
  health: { background: '#F2F6F4', text: '#1B2B28', accent: '#2C6E63', support: '#8DA39B' },
  education: { background: '#F6F4EC', text: '#22261F', accent: '#7A5C1E', support: '#437A63' },
  technology: { background: '#F1F2F4', text: '#15181D', accent: '#2B4C9B', support: '#5E6B7A' },
  other: { background: '#F6F1E7', text: '#1F1A17', accent: '#7A1F3D', support: '#52665A' },
};

const LOCAL_CONTEXT: Record<SectorProfile, string> = {
  fashion: 'fitting appointments, the studio address, fabric lead times and the deposit',
  hospitality: 'check-in, parking, the walk from the station or castle, breakfast and the cancellation terms',
  architecture: 'fees, the first meeting, the planning timeline and what to bring',
  professional: 'fees, response time, the first consultation and the documents to send',
  food: 'opening hours, the delivery area, allergens and how to order',
  retail: 'stock, delivery, returns and the shop address',
  health: 'hours, location, what a first visit involves and how to book',
  education: 'term dates, fees, the admissions process and how to visit',
  technology: 'pricing, integration, data handling and how to trial the product',
  other: 'hours, location, service area and the next step',
};

const SECTOR_TYPE_RATIO: Record<SectorProfile, TypeRatioName> = {
  fashion: 'perfect_fourth',
  hospitality: 'golden',
  architecture: 'augmented_fourth',
  professional: 'major_third',
  food: 'perfect_fourth',
  retail: 'major_third',
  health: 'minor_third',
  education: 'major_third',
  technology: 'perfect_fifth',
  other: 'major_third',
};

const PHOTO_KINDS = ['product_photo', 'venue_photo', 'licensed_image', 'illustration', 'other'];

function approvedKitSnapshot(kit: ApprovedKitInput): BriefBrandKitSnapshot {
  return {
    versionId: kit.versionId,
    version: kit.version,
    approvedAt: kit.approvedAt,
    personality: [...kit.content.personality],
    visualDirection: kit.content.visualDirection,
    toneOfVoice: { ...kit.content.toneOfVoice, do: [...kit.content.toneOfVoice.do], dont: [...kit.content.toneOfVoice.dont] },
    palette: kit.content.palette.map((entry) => ({ ...entry })),
    typography: kit.content.typography.map((entry) => ({ ...entry })),
    logoAssetIds: [...kit.content.logoAssetIds],
    photographyAssetIds: [...kit.content.photographyAssetIds],
  };
}

export function buildCreativeBrief(input: BriefBuildInput): CreativeBriefContent {
  const { project, business, kit, assets } = input;
  const profile = sectorProfile(business.category);
  const sector = SECTOR_META[profile];
  const observations = latestRun(input.observations);
  const facts = observations.filter((observation) => observation.classification === 'verified_fact');
  const unknowns = observations.filter((observation) => observation.classification === 'unknown');
  const placeholders = observations.filter((observation) => observation.classification === 'placeholder');
  const usable = prototypeAssets(assets);
  const photography = usable.filter((asset) => asset.mimeType.startsWith('image/') && PHOTO_KINDS.includes(asset.kind));
  const logos = usable.filter((asset) => ['logo', 'brand_mark'].includes(asset.kind));
  const kitContent = kit?.content ?? null;
  const personality = kitContent?.personality.length ? kitContent.personality : SUGGESTED_PERSONALITY[profile];
  const defaults = SECTOR_PALETTE[profile];
  const accentEntry = kitContent?.palette.find((entry) => /accent|primary|brand|signal/i.test(`${entry.role} ${entry.name}`));
  const background = kitContent ? kitColour(kitContent, /background|ground|paper|canvas|cream|off.?white/i, defaults.background) : defaults.background;
  const ink = kitContent ? kitColour(kitContent, /text|ink|charcoal|black/i, defaults.text) : defaults.text;
  const accent = kitContent ? kitColour(kitContent, /accent|primary|brand|signal/i, defaults.accent) : defaults.accent;
  const support = kitContent ? kitColour(kitContent, /secondary|support|sand|sage|gold|earth/i, defaults.support) : defaults.support;
  const palette = buildPalette({
    background,
    text: ink,
    accent,
    support,
    names: accentEntry ? { accent: accentEntry.name || 'Accent' } : undefined,
  });
  const contrast = contrastChecks(palette);

  const displayEntry = kitContent?.typography.find((entry) => /display|heading|headline|title/i.test(entry.role)) ?? null;
  const bodyEntry = kitContent?.typography.find((entry) => /body|text|paragraph|reading/i.test(entry.role)) ?? null;
  const kitDisplay = displayEntry ? fontFromFamily(displayEntry.family) : null;
  const kitBody = bodyEntry ? fontFromFamily(bodyEntry.family) : null;
  const recommended = recommendFontPairings({
    personality,
    languages: ['English'],
    seed: project.id,
    limit: 6,
    displayIds: kitDisplay ? [kitDisplay.id] : undefined,
    bodyIds: kitBody ? [kitBody.id] : undefined,
  });
  const pairing = recommended[0] ?? recommendFontPairings({ personality, seed: project.id, limit: 1 })[0];
  const displayFont = kitDisplay ?? pairing.display;
  const matchingPair = recommended.find((entry) => entry.display.id === displayFont.id);
  const bodyFont = kitBody ?? matchingPair?.body ?? pairing.body;
  const typography: BriefTypographyPlan = {
    displayFontId: displayFont.id,
    bodyFontId: bodyFont.id,
    displayFamily: displayFont.family,
    bodyFamily: bodyFont.family,
    rationale: pairingRationale(displayFont, bodyFont),
    licences: unique([displayFont.licence.name, bodyFont.licence.name]),
    languages: ['English'],
    scale: buildTypeScale({ displayFontId: displayFont.id, bodyFontId: bodyFont.id, ratio: SECTOR_TYPE_RATIO[profile] }),
    fromBrandKit: Boolean(kitDisplay || kitBody),
  };

  const conversion = conversionRoute(facts);
  const websiteUrl = project.websiteUrl ?? business.officialWebsite ?? null;
  const photoDirection = photography.length
    ? `Work from ${photography.length} approved file${photography.length === 1 ? '' : 's'} in the vault, art-directed for ${profile === 'fashion' ? 'cloth, fit and hands' : profile === 'hospitality' ? 'arrival, light and room detail' : profile === 'architecture' ? 'drawings, materials and daylight' : 'the real place and people'}.`
    : 'No approved photograph is in the vault yet. The direction specifies the photographs to commission; it does not substitute stock imagery or copy files from another site.';

  const content: CreativeBriefContent = {
    format: CREATIVE_BRIEF_FORMAT,
    business: { name: business.name, category: business.category, city: business.city, websiteUrl, siteUrl: project.websiteUrl },
    brandKit: kit ? approvedKitSnapshot(kit) : null,
    sections: buildBriefSections({ business, project, reviews: input.reviews, profile, sector, facts, unknowns, placeholders, personality, kit, conversion, palette, contrast, typography, photography, photoDirection, logos }),
    typography,
    colour: {
      strategy: kitContent
        ? 'Hold the approved Brand Kit colours as anchors, then choose a ground and a supporting tone for the direction. Accent area stays scarce: one colour, one job.'
        : 'The palette below is a proposal, not the business’s existing identity. It is built for contrast first and atmosphere second; the business must confirm any colour that is meant to be theirs.',
      palette,
      contrast,
      notes: kit
        ? `Anchored on approved Brand Kit version ${kit.version}. Each direction may change the ground, the supporting tone and the proportion of accent, but not the brand accent without approval.`
        : 'No approved Brand Kit is on record, so every colour here is a creative suggestion. Approve a kit before this direction can be built.',
    },
    photography: {
      direction: photoDirection,
      assetIds: photography.map((asset) => asset.id),
      missing: photography.length
        ? []
        : ['Commission or supply at least six photographs: one establishing image, three details, one portrait of the maker or host, and one image of the place at a different time of day.'],
      treatment: profile === 'fashion'
        ? 'Natural light, cloth held and worn; detail crops of seams and finish; no catalogue-white cut-outs unless the product is the only subject.'
        : profile === 'hospitality'
          ? 'Available light at the hour guests actually arrive; rooms made up, never staged with untouched trays; one wide establishing frame and several quiet details.'
          : profile === 'architecture'
            ? 'Daylight and shadow at two times of day; drawings and models photographed flat; details that show how materials meet.'
            : 'Documentary rather than stock: the real place, the people who work there, and the work in progress.',
    },
    languages: ['English'],
    missingInformation: buildMissingInformation({ profile, kit, unknowns, placeholders, photography, logos, conversion, typography, kitContent }),
    confirmations: [],
    provenance: { verified: 0, brandKit: 0, assets: 0, suggestions: 0, confirmations: 0, standards: 0 },
  };
  content.confirmations = buildConfirmations({ kit, kitContent, photography, logos, conversion });
  content.provenance = countBriefProvenance(content);
  return content;
}

interface BriefSectionsInput {
  business: Business;
  project: StudioProject;
  reviews: StudioReview[];
  profile: SectorProfile;
  sector: (typeof SECTOR_META)[SectorProfile];
  facts: StudioObservation[];
  unknowns: StudioObservation[];
  placeholders: StudioObservation[];
  personality: string[];
  kit: ApprovedKitInput | null;
  conversion: { label: string; ids: string[] };
  palette: PaletteToken[];
  contrast: ContrastCheck[];
  typography: BriefTypographyPlan;
  photography: StudioAsset[];
  photoDirection: string;
  logos: StudioAsset[];
}

function factEvidence(observation: StudioObservation, reviewsConfirmed: boolean, ids = [observation.id]): BriefEvidence {
  return { ...emptyEvidence(), observationIds: ids, note: reviewsConfirmed ? 'Confirmed by the team in the evidence review.' : 'Read from the business’s current homepage.' };
}

function buildBriefSections(input: BriefSectionsInput): Record<BriefSectionKey, BriefSection> {
  const { business, sector, facts, reviews, personality, kit, conversion, palette, contrast, typography, photography, photoDirection, logos } = input;
  const location = business.city ? ` in ${business.city}` : '';
  const kitVersion = kit?.version ?? null;
  const primaryFacts = facts.slice(0, 6);
  const paletteSummary = palette.filter((entry) => ['background', 'text', 'accent', 'support'].includes(entry.role)).map((entry) => `${entry.name} ${entry.hex}`).join(', ');
  const contrastSummary = contrast.map((check) => `${check.ratio}:1`).join(', ');

  const identity: BriefSection = {
    summary: `${business.name} is a ${business.category || 'local business'}${location}. The identity below records what the workspace holds and what the current site actually says; nothing about the trade, the address or the offer is inferred from a template.`,
    assertions: [
      { id: 'identity.1', text: `Trading name: ${business.name}.`, basis: 'business_record', evidence: { ...emptyEvidence(), record: ['business.name'] } },
      { id: 'identity.2', text: `Trade: ${business.category || 'not recorded'}.`, basis: 'business_record', evidence: { ...emptyEvidence(), record: ['business.category'] } },
      ...(business.city ? [{ id: 'identity.3', text: `City: ${business.city}.`, basis: 'business_record' as const, evidence: { ...emptyEvidence(), record: ['business.city'] } }] : []),
      ...(input.project.websiteUrl || business.officialWebsite
        ? [{ id: 'identity.4', text: `Site on record: ${input.project.websiteUrl ?? business.officialWebsite}.`, basis: 'business_record' as const, evidence: { ...emptyEvidence(), record: ['studio_project.website_url'] } }]
        : []),
      ...primaryFacts.map((observation, index) => ({
        id: `identity.${index + 5}`,
        text: `${observation.label}: ${observation.detail}`,
        basis: 'verified_fact' as const,
        evidence: factEvidence(observation, confirmed(observation, reviews)),
      })),
    ],
  };

  const audience: BriefSection = {
    summary: sector.audience,
    assertions: [
      {
        id: 'audience.1',
        text: `The primary audience is the person making this decision${location}: someone comparing two or three local options on a phone and looking for evidence that this business can do the job.`,
        basis: 'creative_suggestion',
        evidence: { ...emptyEvidence(), observationIds: conversion.ids },
      },
      {
        id: 'audience.2',
        text: business.city
          ? `Local context matters: ${LOCAL_CONTEXT[input.profile]} around ${business.city} should be answered before a visitor is asked to enquire.`
          : `Local context matters: ${LOCAL_CONTEXT[input.profile]} must be answered before a visitor is asked to enquire.`,
        basis: 'creative_suggestion',
        evidence: { ...emptyEvidence(), record: business.city ? ['business.city'] : [] },
      },
    ],
  };

  const positioning: BriefSection = {
    summary: kit
      ? `The approved Brand Kit describes this business as ${personality.join(', ')}. ${kit.content.visualDirection}`
      : `No Brand Kit has been approved yet. The Studio proposes ${personality.join(', ')} as a working character, to be tested against how the owner actually speaks before it is adopted.`,
    assertions: [
      kit
        ? { id: 'positioning.1', text: `Personality: ${personality.join(', ')}.`, basis: 'approved_brand_kit', evidence: { ...emptyEvidence(), brandKitVersion: kitVersion, record: ['brand_kit.personality'] } }
        : { id: 'positioning.1', text: `Proposed personality: ${personality.join(', ')}.`, basis: 'creative_suggestion', evidence: emptyEvidence() },
      kit
        ? { id: 'positioning.2', text: `Tone of voice: ${kit.content.toneOfVoice.summary}`, basis: 'approved_brand_kit', evidence: { ...emptyEvidence(), brandKitVersion: kitVersion, record: ['brand_kit.tone_of_voice'] } }
        : { id: 'positioning.2', text: 'Write in plain, specific sentences: name the service, the material and the next step. Avoid superlatives the business cannot prove.', basis: 'creative_suggestion', evidence: emptyEvidence() },
      {
        id: 'positioning.3',
        text: 'Positioning is a design argument, not a claim about the market: the direction should make the business recognisable without inventing an award, a client list or a heritage.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const objectives: BriefSection = {
    summary: `${sector.conversion} The site has one primary conversion; everything else supports it.`,
    assertions: [
      ...(conversion.label
        ? [{ id: 'objectives.1', text: `Primary conversion supported by the current site: ${conversion.label}.`, basis: 'verified_fact' as const, evidence: { ...emptyEvidence(), observationIds: conversion.ids, note: 'Inferred from the contact or selling route the page publishes.' } }]
        : [{ id: 'objectives.1', text: 'No contact or selling route was found on the current homepage. The primary conversion is unresolved until the business says how customers reach it.', basis: 'client_confirmation' as const, evidence: emptyEvidence() }]),
      {
        id: 'objectives.2',
        text: `Measure the direction by qualified enquiries, not by time on page: a completed ${conversion.label || 'enquiry'} with the information the business needs to reply.`,
        basis: 'creative_suggestion',
        evidence: { ...emptyEvidence(), observationIds: conversion.ids },
      },
      {
        id: 'objectives.3',
        text: 'The primary action appears in the first viewport on mobile and again at the end of the story; no competing secondary action may look equally important.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const atmosphere: BriefSection = {
    summary: `${sector.atmosphere} The atmosphere is a creative proposal, not a description of how the business already feels; it should be tested in review and refined, not asserted in copy.`,
    assertions: [
      {
        id: 'atmosphere.1',
        text: `Proposed emotional register: ${personality.slice(0, 3).join(', ')}. Every section should hold that register; a playful illustration or a neon gradient would break it.`,
        basis: 'creative_suggestion',
        evidence: { ...emptyEvidence(), brandKitVersion: kitVersion },
      },
      {
        id: 'atmosphere.2',
        text: `Avoid the default local-business mood: stock handshakes, generic “Welcome to ${business.name}”, gold gradients and template testimonials. If the business has no testimonial yet, leave the space empty and say so.`,
        basis: 'creative_suggestion',
        evidence: emptyEvidence(),
      },
    ],
  };

  const storyArc = input.profile === 'fashion'
    ? ['A commission begins with a conversation', 'Cloth, measurement and the first cut', 'The fitting and the finish', 'A piece that is worn, not archived']
    : input.profile === 'hospitality'
      ? ['Arrival and the first impression', 'The room and how it is made up', 'The table, the neighbourhood and the day', 'A reason to return']
      : input.profile === 'architecture'
        ? ['The question the client brought', 'The site and its constraints', 'The drawing and the material decision', 'The building in use']
        : ['The visitor’s problem', 'How this business answers it', 'Evidence that the answer works', 'The next step, without friction'];

  const storytelling: BriefSection = {
    summary: `The page should read as a sequence, not a list of sections: ${storyArc.join(' → ')}. Each chapter earns the next; no chapter is a grid of unsupported claims.`,
    assertions: [
      {
        id: 'storytelling.1',
        text: `Proposed narrative arc: ${storyArc.join('; ')}.`,
        basis: 'creative_suggestion',
        evidence: { ...emptyEvidence(), observationIds: facts.slice(0, 2).map((fact) => fact.id) },
      },
      {
        id: 'storytelling.2',
        text: 'Photography and copy must come from the business. A narrative built on stock images of another place is not this business’s story and will be rejected in review.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const artDirection: BriefSection = {
    summary: kit
      ? `${kit.content.visualDirection} The direction below extends that approved visual direction rather than replacing it.`
      : input.profile === 'fashion'
        ? 'Cloth first: raking natural light, the weight of kente, the inside of a seam, hands at work. Colour is drawn from the cloth and the room, not from a trend palette. Surfaces are matte; nothing shines.'
        : input.profile === 'hospitality'
          ? 'Light at the hour guests arrive: warm, low and specific to the building. Rooms are photographed as made up, not as a showroom. Materials are plaster, timber, linen and water; the palette is taken from the place.'
          : input.profile === 'architecture'
            ? 'Drawings as artefacts: plans, sections, models and material samples photographed flat, alongside daylight photographs of built work. The grid is visible; white space behaves like paper.'
            : 'Direct, specific and local: the real premises, the people who work there and the work in progress. Natural light, honest colour, no stock-photo gloss.',
    assertions: [
      ...(kit
        ? [{ id: 'artDirection.1', text: `Approved visual direction: ${kit.content.visualDirection}`, basis: 'approved_brand_kit' as const, evidence: { ...emptyEvidence(), brandKitVersion: kitVersion, record: ['brand_kit.visual_direction'] } }]
        : [{ id: 'artDirection.1', text: 'Visual direction is proposed by the Studio and must be approved by a person before a build starts.', basis: 'creative_suggestion' as const, evidence: emptyEvidence() }]),
      {
        id: 'artDirection.2',
        text: `Materials and texture: ${input.profile === 'fashion' ? 'cloth, thread, paper patterns, brass fittings' : input.profile === 'hospitality' ? 'plaster, timber, linen, ceramic, water' : input.profile === 'architecture' ? 'paper, graphite, concrete, timber, glass' : 'the actual materials of the trade, photographed honestly'}. One material may be exaggerated; all of them may not.`,
        basis: 'creative_suggestion',
        evidence: emptyEvidence(),
      },
      {
        id: 'artDirection.3',
        text: 'External references are recorded as links and notes only, with a licence status. Nothing is downloaded, traced, recoloured or presented as the Studio’s own.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const layout: BriefSection = {
    summary: 'The direction will compare at least three different composition families — not one layout with three colourways. Each must state its grid, navigation, hero idea and how it collapses at 360px.',
    assertions: [
      {
        id: 'layout.1',
        text: 'Composition is chosen for the business, not for the component library: editorial columns, a cinematic frame, an asymmetric offset, a catalogue index, a quiet centre and a modular block system are all available.',
        basis: 'creative_suggestion',
        evidence: emptyEvidence(),
      },
      {
        id: 'layout.2',
        text: 'Avoid the default card wall: equal rounded panels with shadows and icons are not a design idea. If a card is used, it must have a reason and a different span.',
        basis: 'creative_suggestion',
        evidence: emptyEvidence(),
      },
      {
        id: 'layout.3',
        text: 'Every composition is drawn mobile-first at 360px and checked at 768px and 1440px; no essential content may appear only on a wide screen.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const typographySection: BriefSection = {
    summary: typography.rationale,
    assertions: [
      ...(kit?.content.typography.length
        ? [{
            id: 'typography.1',
            text: `Approved Brand Kit type: ${kit.content.typography.map((entry) => `${entry.role || 'Text'} — ${entry.family}${entry.weights ? ` (${entry.weights})` : ''}, ${entry.licence || 'licence not recorded'}`).join('; ')}.`,
            basis: 'approved_brand_kit' as const,
            evidence: { ...emptyEvidence(), brandKitVersion: kitVersion, record: ['brand_kit.typography'] },
          }]
        : [{
            id: 'typography.1',
            text: `Proposed pairing: ${typography.displayFamily} for display, ${typography.bodyFamily} for text. ${typography.rationale}`,
            basis: 'creative_suggestion' as const,
            evidence: emptyEvidence(),
          }]),
      {
        id: 'typography.2',
        text: `Licences: ${typography.licences.join('; ')}. Both permit web embedding and self-hosting. The Studio does not download or redistribute font files without permission.`,
        basis: 'studio_standard',
        evidence: { ...emptyEvidence(), note: 'SIL Open Font License 1.1, https://openfontlicense.org' },
      },
      {
        id: 'typography.3',
        text: `Language coverage is confirmed for ${typography.languages.join(', ')}. If the site will publish Twi, Ewe, Ga or Dagbani, the pairing must change to a family with documented orthography coverage.`,
        basis: 'client_confirmation',
        evidence: emptyEvidence(),
      },
    ],
  };

  const colour: BriefSection = {
    summary: 'Colour is a system with roles, not a collection of swatches: a ground, a surface, ink, secondary ink, one accent and the text that sits on it. Contrast is computed before the palette is proposed.',
    assertions: [
      ...(kit?.content.palette.length
        ? [{
            id: 'colour.1',
            text: `Approved Brand Kit palette (version ${kit.version}): ${kit.content.palette.map((entry) => `${entry.name || entry.role} ${entry.hex}`).join(', ')}.`,
            basis: 'approved_brand_kit' as const,
            evidence: { ...emptyEvidence(), brandKitVersion: kitVersion, record: ['brand_kit.palette'] },
          }]
        : [{
            id: 'colour.1',
            text: `Proposed palette: ${paletteSummary}. It is a creative suggestion, not the business’s existing identity.`,
            basis: 'creative_suggestion' as const,
            evidence: emptyEvidence(),
          }]),
      {
        id: 'colour.2',
        text: `Contrast checks: ${contrastSummary}. Text pairs are adjusted until they meet WCAG 2.2 AA; a palette that fails contrast is not a direction.`,
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
      {
        id: 'colour.3',
        text: 'The accent is used sparingly and for one job: action, emphasis or a single material note. Multiple accents, decorative gradients and coloured cards are rejected in review.',
        basis: 'creative_suggestion',
        evidence: emptyEvidence(),
      },
    ],
  };

  const photographySection: BriefSection = {
    summary: photoDirection,
    assertions: [
      ...photography.slice(0, 6).map((asset, index) => ({
        id: `photography.${index + 1}`,
        text: `${assetLabel(asset)} — ${asset.kind.replace(/_/g, ' ')}, approved for private prototype use.`,
        basis: 'approved_asset' as const,
        evidence: { ...emptyEvidence(), assetIds: [asset.id], brandKitVersion: kitVersion, note: asset.attributionRequired ? `Credit: ${asset.attributionText}` : asset.licenceName },
      })),
      ...(photography.length === 0
        ? [{
            id: 'photography.0',
            text: 'No approved photograph exists yet. The direction will describe the photographs to commission rather than borrow an image from the current site, Google Maps or social media.',
            basis: 'client_confirmation' as const,
            evidence: emptyEvidence(),
          }]
        : []),
      ...(logos.length
        ? [{
            id: 'photography.logo',
            text: `Approved mark${logos.length === 1 ? '' : 's'}: ${logos.map(assetLabel).join('; ')}. The mark may appear in the prototype; it does not license the site for publication.`,
            basis: 'approved_asset' as const,
            evidence: { ...emptyEvidence(), assetIds: logos.map((asset) => asset.id), brandKitVersion: kitVersion },
          }]
        : []),
      {
        id: 'photography.9',
        text: 'Remote images are references, never assets: they are not fetched, cached, displayed inline or offered as “use this image”. A new upload with provenance is the only route into the vault.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const motion: BriefSection = {
    summary: 'One motion idea carries the page: a reveal, a transition or a mask — never all of them at once. Motion clarifies sequence, gives feedback and then gets out of the way.',
    assertions: [
      {
        id: 'motion.1',
        text: 'Every movement has a reduced-motion alternative that removes translation and scroll-linking while leaving the content visible and the focus order intact.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
      {
        id: 'motion.2',
        text: 'Only opacity, transform and clip-path may be animated; durations stay under 900ms and no motion may delay the first readable frame.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
      {
        id: 'motion.3',
        text: 'Hover is never the only route to information, and the primary action is never hidden behind an animation.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const mobile: BriefSection = {
    summary: 'The phone is the first canvas, not a compressed desktop. Composition, type and imagery are drawn at 360px before they are expanded.',
    assertions: [
      {
        id: 'mobile.1',
        text: 'Body text stays at or above 16px, tap targets at or above 44px, and no horizontal scrolling is permitted at 360px.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
      {
        id: 'mobile.2',
        text: `The primary action (${conversion.label || 'enquiry'}) is reachable in the first viewport and repeated at the end; navigation uses the same labels and order at every width.`,
        basis: 'studio_standard',
        evidence: { ...emptyEvidence(), observationIds: conversion.ids },
      },
      {
        id: 'mobile.3',
        text: 'Images are cropped for portrait first, with explicit dimensions to prevent layout shift; no full-bleed video is required to understand the page.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
    ],
  };

  const accessibility: BriefSection = {
    summary: 'Accessibility is a constraint on the art direction, not a clean-up task after it. A concept that cannot meet WCAG 2.2 AA is not finished.',
    assertions: [
      {
        id: 'accessibility.1',
        text: 'WCAG 2.2 AA: text contrast at least 4.5:1, large text and UI at least 3:1, visible focus, logical heading order and labels for every control.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
      {
        id: 'accessibility.2',
        text: 'Motion respects prefers-reduced-motion; no content flashes more than three times per second; animation can be paused or is not essential.',
        basis: 'studio_standard',
        evidence: emptyEvidence(),
      },
      {
        id: 'accessibility.3',
        text: 'The business must supply or approve alt text, captions and transcripts for its own photography, video and audio before publication.',
        basis: 'client_confirmation',
        evidence: emptyEvidence(),
      },
    ],
  };

  return {
    identity,
    audience,
    positioning,
    objectives,
    atmosphere,
    storytelling,
    artDirection,
    layout,
    typography: typographySection,
    colour,
    photography: photographySection,
    motion,
    mobile,
    accessibility,
  };
}

interface MissingInput {
  profile: SectorProfile;
  kit: ApprovedKitInput | null;
  unknowns: StudioObservation[];
  placeholders: StudioObservation[];
  photography: StudioAsset[];
  logos: StudioAsset[];
  conversion: { label: string; ids: string[] };
  typography: BriefTypographyPlan;
  kitContent: BrandKitContent | null;
}

function buildMissingInformation(input: MissingInput): BriefMissingInformation[] {
  const items: BriefMissingInformation[] = [];
  for (const observation of input.unknowns.slice(0, 10)) {
    items.push({
      id: `unknown-${observation.key}`,
      question: observation.detail ?? `What should the site say about ${observation.label.toLowerCase()}?`,
      why: `${observation.label}: the current site is silent, so this can only come from the business.`,
      blocking: ['identity', 'contact', 'commerce'].includes(observation.category),
      source: 'unknown_observation',
    });
  }
  for (const observation of input.placeholders.slice(0, 4)) {
    items.push({
      id: `placeholder-${observation.key}`,
      question: `What should replace “${observation.label}” with current, true content?`,
      why: observation.detail ?? observation.label,
      blocking: false,
      source: 'content',
    });
  }
  if (!input.kit) {
    items.push({
      id: 'brand-kit',
      question: 'Approve a Brand Kit version before any territory is generated.',
      why: 'Creative direction builds from approved assets, palette, typography and personality. Without that approval the Studio would be inventing the brand.',
      blocking: true,
      source: 'brand_kit_gap',
    });
  }
  if (!input.logos.length) {
    items.push({
      id: 'logo-artwork',
      question: 'Supply the original logo artwork (SVG is not accepted; provide a high-resolution PNG or a brand PDF).',
      why: 'A favicon or a screenshot is not a usable mark. The direction can proceed with a wordmark placeholder, but the build cannot.',
      blocking: false,
      source: 'brand_kit_gap',
    });
  }
  if (!input.photography.length) {
    items.push({
      id: 'photography',
      question: 'Commission or supply photography of the real place, people and work.',
      why: 'The Studio will not copy images from the current site, Google Maps or social media. A direction without owned imagery is a layout proposal, not a finished art direction.',
      blocking: false,
      source: 'brand_kit_gap',
    });
  }
  if (!input.conversion.label) {
    items.push({
      id: 'conversion-route',
      question: 'Which single route should a customer use: WhatsApp, a call, a form, a booking or a shop?',
      why: 'The current site publishes no contact or selling route, so the primary conversion cannot be inferred.',
      blocking: true,
      source: 'content',
    });
  }
  const kitFamilies = input.kitContent?.typography.map((entry) => entry.family).filter(Boolean) ?? [];
  const unknownFamilies = kitFamilies.filter((family) => !fontFromFamily(family));
  if (unknownFamilies.length) {
    items.push({
      id: 'font-licence',
      question: `Confirm the web licence for ${unknownFamilies.join(', ')}, or approve a licensed alternative from the Studio catalogue.`,
      why: 'The approved kit names a family the Studio has not verified for web embedding. A desktop licence does not automatically permit webfont use.',
      blocking: true,
      source: 'licence',
    });
  }
  items.push({
    id: 'languages',
    question: 'Will the site publish Twi, Ewe, Ga, Dagbani, Hausa or another language besides English?',
    why: 'Typography must cover the orthography the site actually publishes; ɛ and ɔ are not available in every Latin face.',
    blocking: false,
    source: 'language',
  });
  return items.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
}

interface ConfirmationInput {
  kit: ApprovedKitInput | null;
  kitContent: BrandKitContent | null;
  photography: StudioAsset[];
  logos: StudioAsset[];
  conversion: { label: string; ids: string[] };
}

function buildConfirmations(input: ConfirmationInput): BriefConfirmation[] {
  return [
    {
      id: 'logo-use',
      item: `The business confirms the Studio may use its mark (${input.logos.length ? input.logos.map((asset) => asset.fileName).join(', ') : 'not yet supplied'}) in a private prototype.`,
      why: 'Approval in the vault covers prototype use only; publication is a separate permission.',
      required: true,
    },
    {
      id: 'photography-rights',
      item: input.photography.length
        ? `The business confirms the rights and credits for ${input.photography.length} approved photograph${input.photography.length === 1 ? '' : 's'}.`
        : 'The business will supply or commission photography and confirm its rights.',
      why: 'Photographs of people, places and products need a recorded right before publication.',
      required: true,
    },
    {
      id: 'font-licence',
      item: 'The named typefaces are licensed for web embedding and self-hosting.',
      why: input.kitContent?.typography.length
        ? 'The kit names its typefaces; a desktop or print licence does not automatically cover the web.'
        : 'The Studio proposes open-licensed families, but the final choice must be confirmed with the client.',
      required: true,
    },
    {
      id: 'languages',
      item: 'The languages the site will publish are confirmed.',
      why: 'Type choice and copy depend on whether Twi, Ewe, Ga, Dagbani or another language will appear.',
      required: false,
    },
    {
      id: 'offer',
      item: 'The offer, price range, lead time and service area are confirmed for publication.',
      why: 'The Studio will not invent prices, availability or delivery promises.',
      required: true,
    },
    {
      id: 'conversion',
      item: input.conversion.label
        ? `The primary conversion is ${input.conversion.label}, and that route will be monitored.`
        : 'The business names the primary conversion route.',
      why: 'One primary action keeps the composition honest; several competing actions produce a template.',
      required: true,
    },
    {
      id: 'content',
      item: 'The business will approve final copy, alt text and captions before publication.',
      why: 'Accessibility and factual accuracy are the business’s responsibility as publisher.',
      required: true,
    },
  ];
}

function countBriefProvenance(content: CreativeBriefContent): CreativeBriefContent['provenance'] {
  const counts = { verified: 0, brandKit: 0, assets: 0, suggestions: 0, confirmations: 0, standards: 0 };
  for (const key of BRIEF_SECTION_KEYS) {
    for (const assertion of content.sections[key]?.assertions ?? []) {
      if (assertion.basis === 'verified_fact' || assertion.basis === 'business_record') counts.verified += 1;
      else if (assertion.basis === 'approved_brand_kit') counts.brandKit += 1;
      else if (assertion.basis === 'approved_asset') counts.assets += 1;
      else if (assertion.basis === 'client_confirmation') counts.confirmations += 1;
      else if (assertion.basis === 'studio_standard') counts.standards += 1;
      else counts.suggestions += 1;
    }
  }
  return counts;
}

/** Structural provenance checks: every claim points at what backs it. */
function briefStructureProblems(content: CreativeBriefContent, usable: Set<string>): string[] {
  const problems: string[] = [];
  if (content?.format !== CREATIVE_BRIEF_FORMAT) problems.push('This is not a Studio creative brief.');
  if (!content?.business?.name?.trim()) problems.push('The brief needs the business name.');
  if (!content?.business?.category?.trim()) problems.push('The brief needs the trade recorded on the prospect.');
  if (!BRIEF_SECTION_KEYS.every((key) => content?.sections?.[key])) problems.push('The brief is missing one or more required sections.');
  const ids = new Set<string>();
  let approvedAssertions = 0;
  for (const key of BRIEF_SECTION_KEYS) {
    const section = content.sections?.[key];
    if (!section) continue;
    if ((section.summary ?? '').trim().length < 20) problems.push(`${BRIEF_SECTION_LABELS[key]} needs a summary of at least 20 characters.`);
    for (const assertion of section.assertions ?? []) {
      if (!assertion.id?.trim()) problems.push(`${BRIEF_SECTION_LABELS[key]} has an assertion without an id.`);
      if (ids.has(assertion.id)) problems.push(`The brief repeats the assertion id “${assertion.id}”.`);
      ids.add(assertion.id);
      if (!BRIEF_BASES.includes(assertion.basis)) problems.push(`“${assertion.id}” has an unknown basis.`);
      if ((assertion.text ?? '').trim().length < 5) problems.push(`“${assertion.id}” says too little to review.`);
      if (assertion.text.length > 700) problems.push(`“${assertion.id}” is too long for a brief; move detail into the evidence note.`);
      const evidence = assertion.evidence ?? emptyEvidence();
      if (assertion.basis === 'verified_fact' && !evidence.observationIds.length) problems.push(`“${assertion.id}” claims a verified fact without citing an observation.`);
      if (assertion.basis === 'business_record' && !evidence.record.length) problems.push(`“${assertion.id}” claims a business record without naming the field.`);
      if (assertion.basis === 'approved_brand_kit') {
        approvedAssertions += 1;
        if (!evidence.brandKitVersion && !evidence.assetIds.length) problems.push(`“${assertion.id}” cites the Brand Kit without naming a version or an asset.`);
      }
      if (assertion.basis === 'approved_asset' && !evidence.assetIds.length) problems.push(`“${assertion.id}” claims an approved file without naming one.`);
      for (const assetId of evidence.assetIds) {
        if (!usable.has(assetId)) problems.push(`“${assertion.id}” cites a file that is not approved, licensed and cleared for a prototype.`);
      }
    }
  }
  if (approvedAssertions > 0 && !content.brandKit) problems.push('The brief cites an approved Brand Kit but does not record which version was approved.');
  return problems;
}

/** Type, colour and completeness checks: the measurable part of the direction. */
function briefDesignProblems(content: CreativeBriefContent, usable: Set<string>): string[] {
  const problems: string[] = [];
  if (!content.typography) problems.push('The brief needs a typography plan.');
  else {
    const display = fontById(content.typography.displayFontId);
    const body = fontById(content.typography.bodyFontId);
    if (!display) problems.push('The display typeface is not in the licensed catalogue.');
    if (!body) problems.push('The body typeface is not in the licensed catalogue.');
    if (content.typography.displayFontId === content.typography.bodyFontId) problems.push('Display and body text cannot be the same cut.');
    if (display && display.licence.webEmbedding !== 'permitted') problems.push(`${display.family} is not licensed for web embedding.`);
    if (body && body.licence.webEmbedding !== 'permitted') problems.push(`${body.family} is not licensed for web embedding.`);
    const ghanaian = content.languages?.some((language) => ['twi', 'ewe', 'ga', 'dagbani', 'hausa', 'fante'].some((name) => language.toLowerCase().includes(name)));
    if (ghanaian && display && body && (!display.ghanaianOrthographies || !body.ghanaianOrthographies)) {
      problems.push('The site publishes a Ghanaian language, but one of the chosen families does not document its orthography coverage.');
    }
    if (!content.typography.licences.length) problems.push('The typography plan must name its web licences.');
  }
  if (!content.colour?.palette?.length) problems.push('The brief needs a colour palette.');
  else {
    const contrast = contrastChecks(content.colour.palette);
    const failing = contrast.filter((check) => !check.passesAA);
    if (failing.length) problems.push(`${failing[0].usage} fails WCAG AA at ${failing[0].ratio}:1.`);
  }
  for (const id of content.photography?.assetIds ?? []) {
    if (!usable.has(id)) problems.push('The photography plan cites a file that is not approved and cleared for prototype use.');
  }
  if (!content.languages?.length) problems.push('Record at least one language the site will publish in.');
  if (!content.missingInformation?.length) problems.push('A brief must list the questions the business still has to answer, even if only the language question.');
  if ((content.confirmations ?? []).filter((item) => item.required).length < 3) problems.push('A brief needs at least three required client confirmations.');
  if (content.brandKit === null && !content.missingInformation.some((item) => item.id === 'brand-kit')) {
    problems.push('Without an approved Brand Kit, the brief must say that a kit is required.');
  }
  if (JSON.stringify(countBriefProvenance(content)) !== JSON.stringify(content.provenance)) problems.push('The provenance counts do not match the assertions in the brief.');
  return problems;
}

/** Everything wrong with a rendered brief, in words a designer can act on. */
export function briefProblems(content: CreativeBriefContent, assets: readonly StudioAsset[], today = todayIso()): string[] {
  const usable = new Set(prototypeAssets(assets, today).map((asset) => asset.id));
  return [...briefStructureProblems(content, usable), ...briefDesignProblems(content, usable)];
}

export function briefSummary(content: CreativeBriefContent): string {
  const count = (basis: BriefBasis) =>
    BRIEF_SECTION_KEYS.reduce((total, key) => total + (content.sections[key]?.assertions ?? []).filter((assertion) => assertion.basis === basis).length, 0);
  const blocking = content.missingInformation.filter((item) => item.blocking).length;
  return [
    `${count('verified_fact') + count('business_record')} verified`,
    `${count('approved_brand_kit')} from the kit`,
    `${count('creative_suggestion')} suggestions`,
    `${blocking} blocking question${blocking === 1 ? '' : 's'}`,
  ].join(', ');
}

/** The latest confirmation of a brief, by time. */
export function latestBriefConfirmation(reviews: readonly StudioCreativeBriefReview[]): StudioCreativeBriefReview | null {
  return [...reviews].filter((review) => review.decision === 'confirm').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null;
}

export interface BriefPreferences {
  personality?: string[];
  positioning?: string;
  audience?: string;
  atmosphere?: string;
  objectives?: string;
  avoid?: string[];
}

/**
 * A person's adjustments become a new immutable brief version. Facts and Brand Kit statements are
 * never rewritten: preferences are added as clearly labelled suggestions.
 */
export function reviseBrief(content: CreativeBriefContent, preferences: BriefPreferences): CreativeBriefContent {
  const next = structuredClone(content);
  const setSummary = (key: BriefSectionKey, value: string | undefined) => {
    if (value?.trim()) next.sections[key].summary = value.trim();
  };
  setSummary('audience', preferences.audience);
  setSummary('atmosphere', preferences.atmosphere);
  setSummary('objectives', preferences.objectives);
  setSummary('positioning', preferences.positioning);

  const replacePreference = (key: BriefSectionKey, id: string, text: string) => {
    next.sections[key].assertions = next.sections[key].assertions.filter((assertion) => assertion.id !== id);
    next.sections[key].assertions.push({ id, text, basis: 'creative_suggestion', evidence: emptyEvidence() });
  };
  if (preferences.personality?.length) {
    replacePreference('positioning', 'positioning.preference', `Studio preference from this review: ${preferences.personality.join(', ')}.`);
  }
  if (preferences.avoid?.length) {
    replacePreference('atmosphere', 'atmosphere.preference', `Deliberately avoid: ${preferences.avoid.join('; ')}.`);
  }
  next.provenance = countBriefProvenance(next);
  return next;
}

// ── Territories ──────────────────────────────────────────────────────────────────────────────
// A territory is an argued creative position, not a theme. Each has a narrative, a composition, a
// motion idea, a palette logic, typography preferences and trade-offs it accepts. Nine exist so that
// two businesses in the same trade can still receive different work.

export interface Territory {
  id: string;
  name: string;
  idea: string;
  narrative: string;
  composition: CompositionFamily;
  motion: MotionDirection;
  palette: { background: string; text: string; support: string; strategy: string };
  titles: Partial<Record<SectorProfile, string>> & { default: string };
  personality: string[];
  typographyMood: string[];
  displayIds: string[];
  bodyIds: string[];
  ratio: TypeRatioName;
  imagery: { direction: string; treatment: string; missing: string };
  conversion: { path: string[]; cta: string; proof: string[]; friction: string[] };
  story: { premise: string; arc: string[]; chapters: { name: string; intent: string }[] };
  materials: string[];
  tradeoffs: string[];
  risks: string[];
  sectors: SectorProfile[];
}

export const TERRITORIES: readonly Territory[] = [
  {
    id: 'archive',
    name: 'The Working Archive',
    idea: 'Present the business as a body of work that has been documented with care, where every object carries its date, material and maker.',
    narrative: 'The page behaves like an archive opened on a table: a strong left column of writing, marginal notes, and photographs that interrupt the text rather than illustrate it. Nothing is hurried; the visitor is trusted to read.',
    composition: 'editorial_columns',
    motion: 'editorial_transition',
    palette: { background: '#F4EEE3', text: '#241E1A', support: '#8A6A4F', strategy: 'Warm paper ground, near-black ink, a single brand accent used like a stamp, and a quiet earth support. No gradients; rules and margin notes do the separating.' },
    titles: { fashion: 'The Cutting Archive', architecture: 'The Drawing Archive', hospitality: 'The House Archive', default: 'The Working Archive' },
    personality: ['crafted', 'editorial', 'quiet', 'exacting', 'unhurried'],
    typographyMood: ['literary', 'warm', 'bookish', 'crafted'],
    displayIds: ['fraunces', 'newsreader', 'eb-garamond', 'literata'],
    bodyIds: ['public-sans', 'inter', 'source-sans-3', 'work-sans'],
    ratio: 'perfect_fourth',
    imagery: {
      direction: 'Documentary details: the inside of a seam, a chisel on a bench, a page of measurements, the corner of a room. Photographs are evidence of process, not atmosphere.',
      treatment: 'Available light, slightly warm, no heavy grade. Unequal portrait and square crops with captions in the margin. Never a full-width carousel.',
      missing: 'Commission process photography: hands, tools, material and work in progress, plus one portrait of the person responsible.',
    },
    conversion: {
      path: ['Read the opening argument', 'Examine two or three pieces of evidence', 'Understand how to commission', 'Send a specific enquiry'],
      cta: 'Send a commission enquiry',
      proof: ['The work, with its material and date', 'A named maker and a place', 'How the process runs, step by step', 'A clear price range or a starting point'],
      friction: ['No price or lead time until the final form', 'A generic contact form with no context', 'More than one equally loud action'],
    },
    story: {
      premise: 'A business is worth trusting because its work has been looked at closely.',
      arc: ['A clear opening claim', 'The evidence of process', 'The people and the place', 'How to begin'],
      chapters: [
        { name: 'The claim', intent: 'Say what the business does, for whom, where.' },
        { name: 'The evidence', intent: 'Show two or three pieces with material notes.' },
        { name: 'The process', intent: 'Explain the steps and what the client must bring.' },
        { name: 'The invitation', intent: 'One specific way to start.' },
      ],
    },
    materials: ['Uncoated paper', 'Hairline rules', 'Marginal captions', 'Ink black', 'One stamp of accent'],
    tradeoffs: ['Needs real photography and real copy; it exposes thin content', 'Slower to scan than a card grid', 'Fewer opportunities for promotion'],
    risks: ['Reads as austere if the copy is cold', 'Weak on mobile if the margin notes become a second column'],
    sectors: ['fashion', 'architecture', 'professional', 'education', 'food'],
  },
  {
    id: 'arrival',
    name: 'First Light',
    idea: 'Design the first ten seconds as an arrival: one place, one horizon, one line of type, and enough quiet for the visitor to want to step inside.',
    narrative: 'A full-bleed frame holds the opening. Type enters like a title card and then recedes. The page unfolds in scenes, each one a different hour of the same place, with the practical details arriving only after the atmosphere has earned attention.',
    composition: 'cinematic_full_bleed',
    motion: 'cinematic_sequence',
    palette: { background: '#171A17', text: '#F4EFE6', support: '#C9A227', strategy: 'A dark, warm ground with bone-white type and one brass accent. The accent belongs to light and action, not to decoration. Contrast is checked against the dark ground, not assumed.' },
    titles: { hospitality: 'First Light', food: 'The Long Table', fashion: 'The Evening Cut', default: 'The Arrival' },
    personality: ['cinematic', 'warm', 'confident', 'restrained', 'hospitable'],
    typographyMood: ['cinematic', 'elegant', 'sharp', 'warm'],
    displayIds: ['instrument-serif', 'cormorant-garamond', 'marcellus', 'dm-serif-display'],
    bodyIds: ['work-sans', 'manrope', 'public-sans'],
    ratio: 'golden',
    imagery: {
      direction: 'Three frames of the same place at different hours, plus one human detail: a hand pouring, a door left open, linen in low light. The image is the first argument.',
      treatment: 'Wide, cinematic crops with a consistent warm grade; one inset detail. Explicit width and height, art-directed mobile crop, no autoplay sound.',
      missing: 'Commission a short set at the hour guests actually arrive: one wide establishing frame, two details, one human moment.',
    },
    conversion: {
      path: ['Feel the place', 'See the room or the table', 'Understand the price and terms', 'Reserve'],
      cta: 'Check availability',
      proof: ['The place at its best hour', 'A room or table described honestly', 'Price, dates and cancellation terms', 'A direct booking route'],
      friction: ['A booking form before the price', 'Stock photography of another hotel', 'Autoplay video that delays the first frame'],
    },
    story: {
      premise: 'Hospitality is sold by the quality of an imagined arrival.',
      arc: ['The first frame', 'The room or the table', 'The people and the day', 'The reason to return'],
      chapters: [
        { name: 'Arrival', intent: 'One place, one line, one horizon.' },
        { name: 'The room', intent: 'What it is actually like to stay or eat here.' },
        { name: 'The day', intent: 'What surrounds the place and how a day passes.' },
        { name: 'The return', intent: 'Booking terms and a reason to come back.' },
      ],
    },
    materials: ['Deep shadow', 'Warm highlight', 'Linen', 'Water', 'Brass'],
    tradeoffs: ['Depends on excellent photography', 'Longer to load if the first frame is unoptimised', 'Less room for a dense information architecture'],
    risks: ['Atmosphere can hide missing practical information', 'Dark palettes fail contrast without testing'],
    sectors: ['hospitality', 'food', 'fashion', 'other'],
  },
  {
    id: 'offaxis',
    name: 'Off-Axis',
    idea: 'Put the strongest typographic statement off-centre and let an edge, a rule or a cropped image resolve the imbalance.',
    narrative: 'The page is composed as a series of deliberate tensions: a large block pushed right, a thin column of facts, an image cropped by the viewport. The visitor feels the intelligence of the arrangement before reading a word.',
    composition: 'asymmetric_offset',
    motion: 'subtle_parallax',
    palette: { background: '#ECEDEA', text: '#16181A', support: '#B23A26', strategy: 'Cool paper grey, hard black, one mineral red and a concrete support tone. Colour is structural: it marks the edge where the composition turns.' },
    titles: { architecture: 'Drawn Off-Axis', professional: 'The Second Column', technology: 'Signal and Noise', default: 'Off-Axis' },
    personality: ['precise', 'confident', 'modern', 'architectural', 'direct'],
    typographyMood: ['technical', 'strong', 'geometric', 'confident'],
    displayIds: ['archivo', 'space-grotesk', 'bricolage-grotesque', 'bodoni-moda'],
    bodyIds: ['inter', 'ibm-plex-sans', 'source-sans-3'],
    ratio: 'augmented_fourth',
    imagery: {
      direction: 'Cropped architectural detail, material samples, a plan photographed at an angle. Images are cut by the edge of the page, not centred in a frame.',
      treatment: 'Hard crops with generous negative space on the opposite side; one image may move a few pixels more slowly than the page. No rounded corners.',
      missing: 'Photograph built work at two times of day and capture drawings/models flat; one material sample at close range.',
    },
    conversion: {
      path: ['Register the point of view', 'See how the practice thinks', 'Check the evidence and credentials', 'Send a brief'],
      cta: 'Send a project brief',
      proof: ['A stated approach, not a slogan', 'Two projects with constraints and decisions', 'Who does the work', 'How an engagement starts'],
      friction: ['A portfolio with no project context', 'A contact form that asks for a budget before trust', 'Decorative animation that hides the work'],
    },
    story: {
      premise: 'Judgement is visible in how a problem is framed, not in how polished the render is.',
      arc: ['The provocation', 'The constraint', 'The decision', 'The invitation'],
      chapters: [
        { name: 'Position', intent: 'State a view about how this work should be done.' },
        { name: 'Evidence', intent: 'Show the constraint and the decision, not just the result.' },
        { name: 'Method', intent: 'Explain how the practice works with a client.' },
        { name: 'Brief', intent: 'Make the first conversation easy to start.' },
      ],
    },
    materials: ['Concrete', 'Graphite', 'Paper', 'Mineral red', 'Hard edges'],
    tradeoffs: ['Requires confident, concise copy', 'Harder to execute responsively without losing the tension', 'Can feel cold to a consumer audience'],
    risks: ['Asymmetry becomes mere misalignment', 'Parallax on text harms readability'],
    sectors: ['architecture', 'professional', 'technology', 'retail'],
  },
  {
    id: 'index',
    name: 'The Index',
    idea: 'Treat the whole business as a precise catalogue: numbered entries, tabular facts, and a typographic system that behaves like a well-set index.',
    narrative: 'The homepage starts with a definition and the first three entries, not a hero image. Each entry carries its material, price band and availability in a fixed metadata column. The visitor can see the range immediately and trust that the list is complete.',
    composition: 'catalogue_index',
    motion: 'hover_choreography',
    palette: { background: '#FAF7F0', text: '#1B1B1B', support: '#7A1F3D', strategy: 'Paper white, black ink and one accent used only for counts, rules and active filters. The catalogue is colourless by design; the products and cloth carry the colour.' },
    titles: { fashion: 'The Pattern Index', retail: 'The Stock Index', food: 'The Menu Index', default: 'The Index' },
    personality: ['orderly', 'confident', 'material', 'direct', 'exacting'],
    typographyMood: ['editorial', 'precise', 'clean', 'modern'],
    displayIds: ['bodoni-moda', 'playfair-display', 'dm-serif-display', 'marcellus'],
    bodyIds: ['public-sans', 'inter', 'ibm-plex-sans'],
    ratio: 'major_third',
    imagery: {
      direction: 'Uniform product or piece photography in a strict ratio, with one oversized plate per section to reward scrolling. The photograph must show the actual thing, at the actual scale.',
      treatment: 'Consistent crop, neutral ground, no collage. One plate per section may run full width; all others align to the metadata rows.',
      missing: 'Photograph each entry against the same ground and with a scale reference; include one oversized detail plate.',
    },
    conversion: {
      path: ['Read what the business offers', 'Scan or filter the entries', 'Open one entry', 'Enquire or order'],
      cta: 'Enquire about this piece',
      proof: ['A complete, numbered range', 'Material, size and price band per entry', 'Availability and lead time', 'A direct route from the entry'],
      friction: ['A gallery with no prices or sizes', 'Inconsistent product crops', 'A filter that hides most of the range'],
    },
    story: {
      premise: 'Confidence is a complete list, honestly described.',
      arc: ['The definition', 'The range', 'The detail', 'The order'],
      chapters: [
        { name: 'Definition', intent: 'Say what the business makes or sells in one line.' },
        { name: 'Range', intent: 'Show the index with counts and categories.' },
        { name: 'Detail', intent: 'Let one entry carry material, size and price.' },
        { name: 'Order', intent: 'Make enquiry or purchase direct and specific.' },
      ],
    },
    materials: ['Tabular figures', 'Hairline rules', 'Neutral ground', 'Paper white', 'Numbered entries'],
    tradeoffs: ['Needs a genuinely complete catalogue', 'Less emotional than a cinematic direction', 'Product photography must be consistent'],
    risks: ['Reads as a spreadsheet if typography is weak', 'A small range can look thin'],
    sectors: ['fashion', 'retail', 'food', 'professional', 'architecture'],
  },
  {
    id: 'quiet',
    name: 'A Quiet Room',
    idea: 'Give one idea per screen enough space to be believed, and let the absence of decoration signal confidence.',
    narrative: 'A narrow centred measure, a short statement, one image, then the next thought. The page is shorter than it looks and quieter than the competition. The restraint is the design idea, not the absence of one.',
    composition: 'quiet_centered',
    motion: 'refined_reveal',
    palette: { background: '#F6F1E9', text: '#2A2723', support: '#9AA38C', strategy: 'Warm white, soft black and a muted green support. One accent thread runs through links and focus states; no filled buttons unless the action is the only thing on screen.' },
    titles: { hospitality: 'A Quiet Room', health: 'A Quiet Practice', professional: 'Quiet Counsel', food: 'A Quiet Table', default: 'Quietly, Clearly' },
    personality: ['calm', 'quiet', 'warm', 'considered', 'humane'],
    typographyMood: ['classical', 'calm', 'literary', 'elegant'],
    displayIds: ['marcellus', 'cormorant-garamond', 'newsreader', 'instrument-serif'],
    bodyIds: ['source-sans-3', 'work-sans', 'manrope'],
    ratio: 'minor_third',
    imagery: {
      direction: 'One image per chapter, small enough to be a considered object rather than a wallpaper. Natural light, soft edges, room to breathe around the frame.',
      treatment: 'Centred, consistent ratio, generous margins. Images may be small; none is full-bleed except the opening frame.',
      missing: 'Commission quiet, natural-light photographs of the room, the table or the practitioner at work.',
    },
    conversion: {
      path: ['Read one clear statement', 'See who is behind it', 'Understand what happens next', 'Take one action'],
      cta: 'Arrange a conversation',
      proof: ['A calm, specific statement of what this is', 'A named person and a place', 'What happens after an enquiry', 'One way to begin'],
      friction: ['Too many sections of equal weight', 'Decorative motion that breaks the quiet', 'A crowded header'],
    },
    story: {
      premise: 'Restraint is a form of respect for the visitor.',
      arc: ['The statement', 'The person', 'The experience', 'The invitation'],
      chapters: [
        { name: 'Statement', intent: 'One sentence that could not belong to another business.' },
        { name: 'Person', intent: 'A portrait and a short, human biography.' },
        { name: 'Experience', intent: 'What it is like to stay, eat or work with this business.' },
        { name: 'Invitation', intent: 'One quiet action, repeated at the end.' },
      ],
    },
    materials: ['Warm white', 'Soft black', 'Muted green', 'Natural light', 'One fine rule'],
    tradeoffs: ['Fewer places to promote multiple services', 'Requires excellent copy and photography', 'Can read as expensive or exclusive'],
    risks: ['Emptiness without intention looks unfinished', 'A weak image cannot be hidden by whitespace'],
    sectors: ['hospitality', 'health', 'professional', 'education', 'other'],
  },
  {
    id: 'plan',
    name: 'The Plan',
    idea: 'Compose the site like a working document: bordered cells, fixed headings and unequal spans that make the service, the process and the proof legible at a glance.',
    narrative: 'The page opens with a masthead that states the business, the offer and the action in one frame. Below, a plan of bordered cells holds hours, services, credentials and a case note. Nothing floats; everything is placed.',
    composition: 'modular_blocks',
    motion: 'responsive_navigation',
    palette: { background: '#F1F3F0', text: '#1B2321', support: '#2C6E63', strategy: 'A cool document grey with near-black rules and a clinical green support. Accent marks the primary action and the current section only; no gradients, no shadows.' },
    titles: { architecture: 'Working Drawings', professional: 'The Brief', technology: 'The System', health: 'The Practice', default: 'The Plan' },
    personality: ['assured', 'precise', 'practical', 'trustworthy', 'clear', 'systematic'],
    typographyMood: ['technical', 'systematic', 'civic', 'engineered'],
    displayIds: ['archivo', 'space-grotesk', 'sora'],
    bodyIds: ['ibm-plex-sans', 'source-sans-3', 'public-sans'],
    ratio: 'major_third',
    imagery: {
      direction: 'Documentary photographs that fill cells edge to edge: the premises, the team at work, a detail of the service. One portrait per cell, never a collage.',
      treatment: 'Square or 4:3 crops aligned to the rules; no rounded corners; captions sit inside the cell.',
      missing: 'Photograph the premises, the team and one piece of work in progress, each at a consistent ratio.',
    },
    conversion: {
      path: ['Understand the service', 'Check the credentials', 'See how the process works', 'Book a conversation'],
      cta: 'Book an initial conversation',
      proof: ['Services and who they are for', 'Credentials and named practitioners', 'A clear process with stages', 'Fees or a starting point'],
      friction: ['A wall of equal cards', 'Jargon without a plain explanation', 'A contact route hidden in a footer'],
    },
    story: {
      premise: 'A well-run practice shows its working.',
      arc: ['What this is', 'Who does it', 'How it runs', 'How to start'],
      chapters: [
        { name: 'Masthead', intent: 'Name, offer and action in one frame.' },
        { name: 'Services', intent: 'A precise list with who each is for.' },
        { name: 'Evidence', intent: 'Credentials, process and one case note.' },
        { name: 'Start', intent: 'A booking route with fees and hours.' },
      ],
    },
    materials: ['1px rules', 'Document grey', 'Clinical green', 'Tabular labels', 'Documentary photography'],
    tradeoffs: ['Can feel institutional without warm copy', 'Requires disciplined content design', 'Less emotional than a cinematic direction'],
    risks: ['Cells become a card wall if spans are uniform', 'Dense information can overwhelm on mobile'],
    sectors: ['professional', 'health', 'architecture', 'education', 'technology'],
  },
  {
    id: 'night',
    name: 'After Hours',
    idea: 'Design for the evening: a low-lit palette, close crops and a slow mask that reveals the place as if a curtain were being drawn.',
    narrative: 'The page begins in near-darkness. One image is revealed by a moving edge, then a second at a different hour. Type is spare and warm. The practical information is still there, but it arrives in a quieter register than the atmosphere.',
    composition: 'cinematic_full_bleed',
    motion: 'image_mask',
    palette: { background: '#101317', text: '#EFEDE7', support: '#B98A44', strategy: 'Ink blue-black, warm bone type and a single amber accent. The accent is light, not paint: it appears in rules, focus states and one action. Every text pair is measured against the dark ground.' },
    titles: { hospitality: 'After Hours', food: 'The Late Table', fashion: 'Nocturne', default: 'After Hours' },
    personality: ['moody', 'cinematic', 'intimate', 'refined', 'nocturnal'],
    typographyMood: ['fashion', 'cinematic', 'sharp', 'luxurious'],
    displayIds: ['bodoni-moda', 'playfair-display', 'instrument-serif'],
    bodyIds: ['inter', 'manrope', 'work-sans'],
    ratio: 'perfect_fifth',
    imagery: {
      direction: 'Low-light photographs of the place after service: one room, one detail, one human moment. The grade is consistent and warm; nothing is artificially brightened.',
      treatment: 'Full-bleed frames revealed by a hard-edged mask; no soft blur-up. Explicit dimensions and a static reduced-motion fallback.',
      missing: 'Commission a low-light set at the hour the business actually operates; include one detail of material and one person at work.',
    },
    conversion: {
      path: ['Enter the atmosphere', 'See the room or the work', 'Check the practical details', 'Reserve or enquire'],
      cta: 'Reserve for the evening',
      proof: ['The place after dark, honestly photographed', 'Hours, price and location', 'A named host or maker', 'A direct booking route'],
      friction: ['Atmosphere before practical information', 'Low-contrast text on dark images', 'Motion that delays the first readable line'],
    },
    story: {
      premise: 'Some businesses are best understood after dark.',
      arc: ['The threshold', 'The room', 'The craft', 'The invitation'],
      chapters: [
        { name: 'Threshold', intent: 'Reveal one image and one line, slowly.' },
        { name: 'Room', intent: 'Show the place as it actually is at that hour.' },
        { name: 'Craft', intent: 'One detail that proves the standard.' },
        { name: 'Invitation', intent: 'Practical details and one direct action.' },
      ],
    },
    materials: ['Ink blue-black', 'Amber light', 'Bone type', 'Smoked glass', 'Hard mask edges'],
    tradeoffs: ['Dark palettes are harder to keep accessible', 'Photography must be genuinely good in low light', 'Less suitable for a dense service list'],
    risks: ['Contrast failures on image overlays', 'Motion without a reduced-motion alternative'],
    sectors: ['hospitality', 'food', 'other'],
  },
  {
    id: 'fieldnotes',
    name: 'Field Notes',
    idea: 'Build the page from annotated observations: a running note in the margin, a photograph pinned beside it, and a tone that sounds like someone who was there.',
    narrative: 'The page reads as a set of notes from the place: dated observations, material samples, a short interview with the maker. It is informal in structure but exacting in detail, and it gives the business a voice no template can copy.',
    composition: 'editorial_columns',
    motion: 'image_mask',
    palette: { background: '#EFEAE0', text: '#26231D', support: '#6D7C3B', strategy: 'Oat paper, dark ink, an olive support and the brand accent used like a pencil mark. Photographs are pinned, not framed; annotations are set in a smaller, quieter size.' },
    titles: { food: 'Field Notes', fashion: 'Cloth Notes', hospitality: 'Notes from the House', education: 'Notes from the Studio', default: 'Field Notes' },
    personality: ['curious', 'honest', 'warm', 'observant', 'unpolished'],
    typographyMood: ['literary', 'human', 'warm', 'bookish'],
    displayIds: ['fraunces', 'newsreader', 'lora'],
    bodyIds: ['public-sans', 'source-sans-3', 'andika'],
    ratio: 'minor_third',
    imagery: {
      direction: 'Photographs as evidence with captions that say when and where: a batch, a delivery, a room before service, a note in a notebook. Slight imperfection is welcome; stock polish is not.',
      treatment: 'Images sit beside the note they belong to, revealed by a hard edge. Mixed portrait and landscape crops with handwritten-feeling captions set in the body face.',
      missing: 'Collect a week of honest process photographs with dates, plus one short interview with the person who runs the work.',
    },
    conversion: {
      path: ['Read the first note', 'Follow the evidence through the week', 'Understand the offer', 'Ask a specific question'],
      cta: 'Ask about this week',
      proof: ['Dated observations, not claims', 'Photographs of the actual work', 'A named person answering', 'A clear way to visit or order'],
      friction: ['Notes that are really marketing copy', 'Undated photographs', 'A contact route with no context'],
    },
    story: {
      premise: 'Specificity is more persuasive than polish.',
      arc: ['The first observation', 'What the week showed', 'What it costs and how it works', 'An open question'],
      chapters: [
        { name: 'Observation', intent: 'One dated, specific detail that sets the tone.' },
        { name: 'Week', intent: 'Three notes that show the work as it happens.' },
        { name: 'Offer', intent: 'What can be ordered, visited or commissioned.' },
        { name: 'Question', intent: 'Invite a specific enquiry, not a generic one.' },
      ],
    },
    materials: ['Oat paper', 'Pencil marks', 'Pinned photographs', 'Olive green', 'Dated captions'],
    tradeoffs: ['Requires ongoing content, not a one-off build', 'Informality can undercut a premium price', 'Harder to keep tidy at scale'],
    risks: ['Notes become a blog nobody maintains', 'Weak photography exposes the format'],
    sectors: ['food', 'fashion', 'education', 'health', 'other'],
  },
  {
    id: 'typefirst',
    name: 'Type First',
    idea: 'Let typography carry the whole identity: a few words set with conviction, almost no imagery, and a composition that behaves like a printed argument.',
    narrative: 'The page opens with a sentence worth reading, set large and off-centre. Proof follows in short, numbered paragraphs. Images appear only where they add evidence, not atmosphere. The confidence is in the writing and the spacing.',
    composition: 'asymmetric_offset',
    motion: 'hover_choreography',
    palette: { background: '#FBFBF9', text: '#111111', support: '#2B4C9B', strategy: 'Near-white, true black and one ink blue. Almost no colour area; the accent belongs to links and one rule. The design is carried by type, spacing and alignment.' },
    titles: { professional: 'The Argument', technology: 'The Evidence', retail: 'Plainly', education: 'The Lesson', default: 'Type First' },
    personality: ['direct', 'confident', 'plain', 'modern', 'intellectual'],
    typographyMood: ['strong', 'editorial', 'technical', 'confident'],
    displayIds: ['bricolage-grotesque', 'sora', 'space-grotesk', 'archivo'],
    bodyIds: ['inter', 'public-sans', 'ibm-plex-sans'],
    ratio: 'perfect_fifth',
    imagery: {
      direction: 'Images are exhibits: a screenshot, a document, a product at scale, a place that proves the claim. No mood photography; every image has a caption that explains what it demonstrates.',
      treatment: 'Small, precisely placed, often with a rule and a caption. One image may be large if it is the central evidence.',
      missing: 'Gather documentary evidence: a contract redacted, a product in use, a before-and-after, a named result.',
    },
    conversion: {
      path: ['Read the argument', 'Check the evidence', 'Understand the terms', 'Start a conversation'],
      cta: 'Put the question to us',
      proof: ['A clear position in one sentence', 'Numbered evidence, not adjectives', 'Terms and process in plain language', 'A direct route to a person'],
      friction: ['Clever headlines with no substance', 'Decorative imagery that proves nothing', 'A wall of unbroken text on mobile'],
    },
    story: {
      premise: 'If the argument is good, the typography can carry it alone.',
      arc: ['The claim', 'The evidence', 'The objection', 'The next step'],
      chapters: [
        { name: 'Claim', intent: 'A sentence the business is prepared to defend.' },
        { name: 'Evidence', intent: 'Three numbered proofs with sources.' },
        { name: 'Objection', intent: 'Answer the obvious doubt directly.' },
        { name: 'Next step', intent: 'One action with a named person behind it.' },
      ],
    },
    materials: ['True black', 'Paper white', 'Ink blue', 'Numbered paragraphs', 'Document exhibits'],
    tradeoffs: ['Depends entirely on the quality of the writing', 'Fewer emotional cues for a consumer audience', 'Hard to sustain across many pages'],
    risks: ['Large type becomes shouting', 'Thin evidence is exposed immediately'],
    sectors: ['professional', 'technology', 'retail', 'education'],
  },
];

function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function overlapCount(a: readonly string[], b: readonly string[]): number {
  const wanted = new Set(a.map((word) => word.toLowerCase()));
  return b.filter((word) => wanted.has(word.toLowerCase())).length;
}

/**
 * Chooses three territories. Sector affinity and personality lead; the seed rotates ties so a second
 * tailoring business does not receive the same three. Composition and motion must differ across the
 * set: that is the promise that these are three directions, not three colourways.
 */
export function selectTerritories(profile: SectorProfile, personality: readonly string[], seed: string, count = 3): Territory[] {
  const ranked = TERRITORIES.map((territory) => ({
    territory,
    score:
      (territory.sectors.includes(profile) ? 8 : 0) +
      overlapCount(personality, territory.personality) * 3 +
      (hashString(`${seed}|${territory.id}`) % 100) / 100,
  })).sort((a, b) => b.score - a.score);

  const chosen: Territory[] = [];
  const compositions = new Set<string>();
  const motions = new Set<string>();
  for (const { territory } of ranked) {
    if (chosen.length >= count) break;
    if (compositions.has(territory.composition) || motions.has(territory.motion)) continue;
    chosen.push(territory);
    compositions.add(territory.composition);
    motions.add(territory.motion);
  }
  for (const { territory } of ranked) {
    if (chosen.length >= count) break;
    if (chosen.some((entry) => entry.id === territory.id) || compositions.has(territory.composition)) continue;
    chosen.push(territory);
    compositions.add(territory.composition);
  }
  for (const { territory } of ranked) {
    if (chosen.length >= count) break;
    if (!chosen.some((entry) => entry.id === territory.id)) chosen.push(territory);
  }
  return chosen;
}

interface ResolvedTypography {
  display: FontSpec;
  body: FontSpec;
  pairing: string;
  fromBrandKit: boolean;
}

const KIT_DISPLAY_ROLES = /display|heading|headline|title/i;
const KIT_BODY_ROLES = /body|text|paragraph|reading/i;

function resolveTypography(territory: Territory, brief: CreativeBriefContent, personality: string[], seed: string, used: Set<string>): ResolvedTypography {
  const kitTypography = brief.brandKit?.typography ?? [];
  const fixedDisplay = kitTypography.some((entry) => KIT_DISPLAY_ROLES.test(entry.role));
  const fixedBody = kitTypography.some((entry) => KIT_BODY_ROLES.test(entry.role));
  const displayIds = fixedDisplay ? [brief.typography.displayFontId] : territory.displayIds;
  const bodyIds = fixedBody ? [brief.typography.bodyFontId] : territory.bodyIds;
  const request = {
    personality: [...personality, ...territory.typographyMood],
    languages: brief.languages,
    seed: `${seed}|${territory.id}`,
    exclude: [...used],
    displayIds,
    bodyIds,
    limit: 4,
  };
  let options = recommendFontPairings(request);
  if (!options.length) options = recommendFontPairings({ ...request, exclude: [] });
  if (!options.length) {
    const display = fontById(brief.typography.displayFontId) ?? fontById('newsreader')!;
    const body = fontById(brief.typography.bodyFontId) ?? fontById('public-sans')!;
    return { display, body, pairing: pairingKey(display.id, body.id), fromBrandKit: fixedDisplay || fixedBody };
  }
  const chosen = options[0];
  used.add(chosen.key);
  return { display: chosen.display, body: chosen.body, pairing: chosen.key, fromBrandKit: fixedDisplay || fixedBody };
}

function conceptEvidence(brief: CreativeBriefContent): ConceptEvidence {
  const verified = BRIEF_SECTION_KEYS.flatMap((key) => brief.sections[key]?.assertions ?? []).filter(
    (assertion) => assertion.basis === 'verified_fact' && assertion.evidence.observationIds.length > 0,
  );
  const ids = unique(verified.flatMap((assertion) => assertion.evidence.observationIds)).slice(0, 4);
  const labels = verified
    .filter((assertion) => assertion.evidence.observationIds.some((id) => ids.includes(id)))
    .map((assertion) => assertion.text.replace(/\s+/g, ' ').slice(0, 120));
  return {
    observationIds: ids,
    observationLabels: unique(labels).slice(0, 4),
    brandKitVersion: brief.brandKit?.version ?? null,
    notes: [
      ...(brief.brandKit ? [`Brand Kit version ${brief.brandKit.version}, approved by a named reviewer.`] : []),
      'The concept is a creative proposal, not a claim about the business.',
    ],
  };
}

export const QUALITY_ADVISORY =
  'Advisory only. These scores are deterministic heuristics for a design review; they are not an objective measure of quality and not a guarantee of awards or commercial results. A named person approves the direction.';

const QUALITY_LABELS: { key: string; label: string }[] = [
  { key: 'originality', label: 'Originality' },
  { key: 'brandAppropriateness', label: 'Brand appropriateness' },
  { key: 'typography', label: 'Typography' },
  { key: 'composition', label: 'Composition' },
  { key: 'colourSophistication', label: 'Colour sophistication' },
  { key: 'assetConsistency', label: 'Asset consistency' },
  { key: 'cinematicStorytelling', label: 'Cinematic storytelling' },
  { key: 'motionAppropriateness', label: 'Motion appropriateness' },
  { key: 'mobileDesign', label: 'Mobile design' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'performance', label: 'Performance' },
  { key: 'businessRelevance', label: 'Business relevance' },
];

interface ReviewFacts {
  compositions: number;
  motions: number;
  pairings: number;
  passes: number;
  total: number;
  displayFont: FontSpec | null;
  bodyFont: FontSpec | null;
  bodyMinRem: number;
  photoConsistent: boolean;
  fontKb: number;
  evidenceCount: number;
  kitFit: number;
  accentFidelity: number;
}

const dim = (key: string, score: number, note: string): QualityDimension => ({
  key,
  label: qualityLabel(key),
  score: Math.max(0, Math.min(100, Math.round(score))),
  note,
});

function designDimensions(concept: CreativeConcept, brief: CreativeBriefContent, facts: ReviewFacts): QualityDimension[] {
  const display = facts.displayFont;
  const body = facts.bodyFont;
  return [
    dim('originality', 70 + (facts.compositions === 3 ? 10 : 4) + (facts.motions === 3 ? 6 : 2) + (facts.pairings === 3 ? 5 : 2),
      `The set uses ${facts.compositions} compositions, ${facts.motions} motion directions and ${facts.pairings} distinct pairings. Originality is judged against other businesses, not against a trend.`),
    dim('brandAppropriateness', 78 + facts.kitFit + facts.accentFidelity + (brief.brandKit?.personality.length ? 4 : 0),
      brief.brandKit
        ? `Measured against the approved Brand Kit's ${brief.brandKit.personality.length} personality traits and its accent. A person must still judge whether the tone is right.`
        : 'No approved Brand Kit is on record, so this can only be a provisional reading.'),
    dim('typography', 72 + (display && body ? 8 : 0) + (display?.licence.webEmbedding === 'permitted' && body?.licence.webEmbedding === 'permitted' ? 8 : 0) + (display?.id !== body?.id ? 4 : 0),
      `${concept.typography.displayFamily} / ${concept.typography.bodyFamily}. ${concept.typography.licence.display}; ${concept.typography.licence.body}.`),
    dim('composition', 78 + (concept.tokens.grid.columns >= 8 ? 6 : 3) + (facts.compositions === 3 ? 5 : 2),
      `${concept.composition.label}: ${concept.tokens.grid.columns} columns, ${concept.tokens.grid.gutterPx}px gutter, ${concept.tokens.grid.maxWidthPx}px maximum.`),
    dim('colourSophistication', 62 + (facts.passes / facts.total) * 22 + (concept.tokens.palette.length <= 8 ? 4 : 0) + (concept.colour.palette.filter((entry) => entry.role === 'accent').length === 1 ? 4 : 0),
      `${facts.passes} of ${facts.total} measured pairs meet AA. One accent, one support and a computed ground; no decorative gradient is specified.`),
    dim('assetConsistency', (facts.photoConsistent ? 84 : 58) + (concept.imagery.assetIds.length ? 5 : 0) + (concept.imagery.missing.length === 0 ? 4 : 0),
      concept.imagery.assetIds.length
        ? `${concept.imagery.assetIds.length} approved prototype asset${concept.imagery.assetIds.length === 1 ? '' : 's'}; no remote file is fetched or rendered.`
        : 'No approved photography is cited; the direction describes the commission instead of borrowing an image.'),
  ];
}

function deliveryDimensions(concept: CreativeConcept, facts: ReviewFacts): QualityDimension[] {
  return [
    dim('cinematicStorytelling', 64 + concept.story.chapters.length * 5 + Math.min(8, Math.round(concept.narrative.length / 90)),
      `${concept.story.chapters.length} chapters, each with a stated intent. The sequence is designed; motion is not a substitute for it.`),
    dim('motionAppropriateness', 76 + (concept.motion.reducedMotion ? 8 : 0) + (concept.motion.spec.durationMs <= 600 ? 6 : 3) + (concept.motion.spec.properties.every((property) => ['opacity', 'transform', 'clip-path'].includes(property)) ? 4 : 0),
      `${concept.motion.label}, ${concept.motion.spec.durationMs}ms, ${concept.motion.spec.properties.join('/')}; reduced-motion alternative recorded.`),
    dim('mobileDesign', 74 + (concept.responsive.breakpoints.length >= 5 ? 6 : 3) + (facts.bodyMinRem >= 1 ? 6 : 0) + (concept.responsive.constraints.length >= 2 ? 4 : 1),
      concept.responsive.mobileFirst),
    dim('accessibility', 58 + (facts.passes / facts.total) * 20 + (concept.motion.reducedMotion ? 8 : 0) + (facts.bodyMinRem >= 1 ? 5 : 0),
      `${facts.passes} of ${facts.total} contrast pairs pass AA; reduced-motion and a 16px body minimum are recorded. Keyboard order and alt text remain review tasks.`),
    dim('performance', 70 + (facts.fontKb <= 140 ? 10 : 4) + (concept.motion.spec.properties.every((property) => property !== 'clip-path') ? 4 : 2) + (concept.imagery.assetIds.length <= 6 ? 4 : 0),
      `Estimated webfont payload ${facts.fontKb}KB for two families. The direction uses no autoplay video and only compositor-friendly motion.`),
    dim('businessRelevance', 70 + concept.conversion.path.length * 3 + Math.min(10, facts.evidenceCount * 3) + (concept.conversion.primaryCta ? 4 : 0),
      `${concept.conversion.path.length}-step path to “${concept.conversion.primaryCta}”, with ${facts.evidenceCount} verified observation${facts.evidenceCount === 1 ? '' : 's'} cited.`),
  ];
}

/**
 * A deterministic design review. The numbers are deliberately conservative and always carry the
 * advisory label: they help a reviewer compare directions, they do not replace judgement.
 */
export function reviewConcept(concept: CreativeConcept, others: readonly CreativeConcept[], brief: CreativeBriefContent): ConceptQualityReview {
  const distinct = (values: string[]) => new Set(values).size;
  const displayFont = fontById(concept.typography.displayFontId);
  const bodyFont = fontById(concept.typography.bodyFontId);
  const bodyStep = concept.tokens.type.steps.find((step) => step.name === 'body');
  const approvedPhotos = new Set(brief.photography.assetIds);
  const paletteAccent = paletteEntry(concept.colour.palette, 'accent')?.hex;
  const briefAccent = paletteEntry(brief.colour.palette, 'accent')?.hex;
  const facts: ReviewFacts = {
    compositions: distinct([concept.composition.family, ...others.map((other) => other.composition.family)]),
    motions: distinct([concept.motion.direction, ...others.map((other) => other.motion.direction)]),
    pairings: distinct([concept.typography.displayFontId + concept.typography.bodyFontId, ...others.map((other) => other.typography.displayFontId + other.typography.bodyFontId)]),
    passes: concept.colour.contrast.filter((check) => check.passesAA).length,
    total: Math.max(1, concept.colour.contrast.length),
    displayFont,
    bodyFont,
    bodyMinRem: bodyStep?.minRem ?? 0,
    photoConsistent: concept.imagery.assetIds.every((id) => approvedPhotos.has(id)),
    fontKb: (displayFont?.loading.estimatedWoff2Kb ?? 0) + (bodyFont?.loading.estimatedWoff2Kb ?? 0),
    evidenceCount: concept.rationale.evidence.observationIds.length,
    kitFit: concept.typography.fromBrandKit ? 6 : 0,
    accentFidelity: paletteAccent === briefAccent ? 4 : 0,
  };
  const dimensions = [...designDimensions(concept, brief, facts), ...deliveryDimensions(concept, facts)];
  const overall = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / (dimensions.length || 1));
  return { dimensions, overall, advisory: QUALITY_ADVISORY };
}

export function qualityLabel(key: string): string {
  return QUALITY_LABELS.find((entry) => entry.key === key)?.label ?? key;
}

const SECTOR_FOCUS: Record<SectorProfile, string> = {
  fashion: 'cloth, cut, fitting and the finish of a garment',
  hospitality: 'arrival, the room, the table and the reason to return',
  architecture: 'the site, the constraint, the drawing and the built result',
  professional: 'the client’s problem, the practice’s judgement and the evidence behind it',
  food: 'ingredients, the table and the route to order',
  retail: 'the range, its material facts and the route to buy',
  health: 'clarity, care and a route to an appointment',
  education: 'teaching, evidence of learning and a human route to ask',
  technology: 'the product, the proof that it works and the terms of adoption',
  other: 'the real work, the people and the practical next step',
};

const HEADLINES: Record<string, string> = {
  archive: 'Begin with the material.',
  arrival: 'Arrive slowly.',
  offaxis: 'The plan is the argument.',
  index: 'Everything we make, in order.',
  quiet: 'A quieter kind of attention.',
  plan: 'What we do, and how it works.',
  night: 'The room after dark.',
  fieldnotes: 'Notes from this week.',
  typefirst: 'The evidence, not the adjectives.',
};

const MOBILE_BEHAVIOUR: Record<CompositionFamily, string> = {
  editorial_columns: 'At 360px the margin column moves below the main text, captions stay attached to their image, and the display/body contrast survives the smaller scale.',
  cinematic_full_bleed: 'At 360px the opening frame becomes a portrait crop with the headline in the lower third; text never sits on a busy area without a measured scrim.',
  asymmetric_offset: 'At 360px the offset collapses to one column but keeps a single deliberate indent; the largest type never exceeds the viewport.',
  catalogue_index: 'At 360px each entry becomes a two-line row with its metadata beneath the title; filters become a horizontal scroller and no entry is hidden.',
  quiet_centered: 'At 360px the measure narrows to 24px margins, images stay small, and the primary action remains visible without a sticky bar.',
  modular_blocks: 'At 360px cells stack with shared 1px rules; practical information moves above the menu and the primary action stays in the masthead.',
};

const PHOTO_ASSET_KINDS = new Set(['product_photo', 'venue_photo', 'licensed_image', 'illustration', 'other']);

interface ConceptInput {
  territory: Territory;
  brief: CreativeBriefContent;
  business: Business;
  profile: SectorProfile;
  index: number;
  assets: StudioAsset[];
  typography: ResolvedTypography;
}

function buildConcept(input: ConceptInput): CreativeConcept {
  const { territory, brief, business, profile, typography } = input;
  const sector = SECTOR_META[profile];
  const meta = COMPOSITION_META[territory.composition];
  const motionSpec = MOTION_META[territory.motion];
  const accent = paletteEntry(brief.colour.palette, 'accent')?.hex ?? '#7A1F3D';
  const palette = buildPalette({
    background: territory.palette.background,
    text: territory.palette.text,
    accent,
    support: territory.palette.support,
    names: { accent: paletteEntry(brief.colour.palette, 'accent')?.name ?? 'Brand accent' },
  });
  const scale = buildTypeScale({ displayFontId: typography.display.id, bodyFontId: typography.body.id, ratio: territory.ratio });
  const tokens = buildDesignTokens({ palette, type: scale, grid: meta.grid, motion: motionSpec });
  const photos = prototypeAssets(input.assets).filter((asset) => asset.mimeType.startsWith('image/') && PHOTO_ASSET_KINDS.has(asset.kind));
  const logos = prototypeAssets(input.assets).filter((asset) => ['logo', 'brand_mark'].includes(asset.kind));
  const slices = [0, 1, 2].map((slot) => photos.filter((_, position) => position % 3 === slot));
  const conceptPhotos = slices[input.index]?.length ? slices[input.index] : input.index === 0 ? photos : [];
  const name = territory.titles[profile] ?? territory.titles.default;
  const location = business.city ? ` in ${business.city}` : '';
  const missingPhotos = conceptPhotos.length === 0
    ? [territory.imagery.missing]
    : conceptPhotos.length < 2
      ? ['One photograph cannot carry a chapter structure. Commission at least two more details and one human frame.']
      : [];
  const references: CreativeReference[] = [
    { title: `${typography.display.family} specimen and licence`, url: typography.display.sourceUrl, licence: typography.display.licence.name, note: 'Typeface source. The Studio does not redistribute the font files; the site will self-host them under the licence.' },
    { title: `${typography.body.family} specimen and licence`, url: typography.body.sourceUrl, licence: typography.body.licence.name, note: 'Typeface source, verified for web embedding and self-hosting.' },
    ...(brief.business.websiteUrl
      ? [{ title: `${business.name} — current site`, url: brief.business.websiteUrl, licence: 'Reference only', note: 'Used for evidence about the business. Its copy, logo and photographs are not reused without permission.' }]
      : []),
  ];
  return {
    key: territory.id,
    name,
    idea: `${territory.idea} For ${business.name}${location}, that means the work is about ${SECTOR_FOCUS[profile]}.`,
    narrative: `${territory.narrative} The opening line, “${HEADLINES[territory.id] ?? 'Begin with the work.'}”, is a creative proposal and will be replaced or approved with the business’s own wording before publication.`,
    typography: {
      displayFontId: typography.display.id,
      bodyFontId: typography.body.id,
      displayFamily: typography.display.family,
      bodyFamily: typography.body.family,
      displayWeights: `${Math.min(...typography.display.weights)}–${Math.max(...typography.display.weights)}`,
      bodyWeights: `${Math.min(...typography.body.weights)}–${Math.max(...typography.body.weights)}`,
      rationale: `${pairingRationale(typography.display, typography.body)} ${typography.fromBrandKit ? 'The direction keeps the approved Brand Kit face and changes the supporting voice and scale.' : 'Neither face is inherited from a UI library; the pairing is chosen for this direction.'}`,
      licence: { display: typography.display.licence.name, body: typography.body.licence.name },
      licenceUrls: { display: typography.display.licence.url, body: typography.body.licence.url },
      languages: brief.languages,
      scale,
      fallback: { display: fontStack(typography.display), body: fontStack(typography.body) },
      fromBrandKit: typography.fromBrandKit,
      notes: `${typography.display.legibility} ${typography.body.legibility}`,
    },
    colour: {
      strategy: territory.palette.strategy,
      palette,
      contrast: contrastChecks(palette),
      notes: `The accent is the approved Brand Kit accent (${accent}); the ground, support and proportion are this direction's proposal. Contrast is computed, not asserted.`,
    },
    composition: {
      family: meta.family,
      label: meta.label,
      grid: `${meta.grid.columns} columns, ${meta.grid.gutterPx}px gutter, margins ${meta.grid.marginPx.mobile}px mobile / ${meta.grid.marginPx.desktop}px desktop, maximum ${meta.grid.maxWidthPx}px. ${meta.grid.notes}`,
      navigation: meta.navigation,
      hero: meta.hero,
      spacing: meta.spacingRhythm,
      imageComposition: meta.imageComposition,
      materials: meta.materials,
      avoid: meta.avoid,
    },
    imagery: {
      direction: territory.imagery.direction,
      treatment: territory.imagery.treatment,
      assetIds: conceptPhotos.map((asset) => asset.id),
      logoAssetIds: logos.map((asset) => asset.id),
      missing: missingPhotos,
      references,
    },
    motion: {
      direction: motionSpec.direction,
      label: motionSpec.label,
      idea: motionSpec.idea,
      spec: motionSpec,
      reducedMotion: motionSpec.reducedMotion,
      performance: [motionSpec.performance, 'No motion may run before the first readable frame or block a route change.'],
      notes: `One motion idea only: ${motionSpec.label.toLowerCase()}. Hover states follow ${meta.label.toLowerCase()} rules; nothing else moves.`,
    },
    conversion: {
      path: [...territory.conversion.path],
      primaryCta: territory.conversion.cta,
      proofOrder: [...territory.conversion.proof],
      friction: [...territory.conversion.friction],
    },
    responsive: {
      mobileFirst: MOBILE_BEHAVIOUR[territory.composition],
      breakpoints: BREAKPOINTS.map((breakpoint) => ({
        name: breakpoint.name,
        minWidth: breakpoint.minWidth,
        behavior: breakpoint.minWidth === 360 ? MOBILE_BEHAVIOUR[territory.composition] : breakpoint.note,
      })),
      navigation: `${meta.navigation} On mobile the same labels and order remain; the primary action is never hidden in the drawer.`,
      typography: `Fluid ${scale.ratioName.replace(/_/g, ' ')} scale: ${scale.steps[0].minRem}rem display at 360px rising to ${scale.steps[0].maxRem}rem at 1440px; body stays at or above ${scale.steps.find((step) => step.name === 'body')?.minRem}rem.`,
      imagery: `Portrait crops first. ${territory.imagery.treatment}`,
      constraints: [
        'No horizontal scrolling at 360px.',
        'Tap targets at least 44px and body text at least 16px.',
        'The primary action appears in the first viewport and at the end of the sequence.',
      ],
    },
    story: {
      headline: HEADLINES[territory.id] ?? 'Begin with the work.',
      premise: territory.story.premise,
      arc: [...territory.story.arc],
      chapters: territory.story.chapters.map((chapter) => ({ ...chapter })),
    },
    rationale: {
      audience: `${sector.audience} ${name} answers that by ${territory.story.premise.toLowerCase()}`,
      business: `For ${business.name}${location}, the direction puts ${SECTOR_FOCUS[profile]} at the centre rather than treating the website as a container for services. It accepts the trade-offs below in exchange for a specific point of view.`,
      evidence: conceptEvidence(brief),
    },
    tradeoffs: [
      ...territory.tradeoffs,
      ...(typography.fromBrandKit ? ['The approved Brand Kit face is fixed; variation comes from the supporting face and the scale.'] : []),
      ...(conceptPhotos.length === 0 ? ['Cannot be built as drawn until the photography is commissioned.'] : []),
    ],
    risks: [...territory.risks],
    tokens,
    quality: { dimensions: [], overall: 0, advisory: QUALITY_ADVISORY },
  };
}

export interface DirectionBuildInput {
  project: StudioProject;
  business: Business;
  brief: CreativeBriefContent;
  briefVersionId: string;
  briefVersion: number;
  kit: { versionId: string; version: number; content: BrandKitContent };
  assets: StudioAsset[];
  seed?: string;
}

/**
 * Produces one immutable set of three concepts. This is the offline engine: no model, no network and
 * no randomness beyond a stable seed. The same brief and kit always produce the same direction.
 */
export function generateCreativeDirection(input: DirectionBuildInput): CreativeDirectionContent {
  const profile = sectorProfile(input.business.category);
  const personality = input.brief.brandKit?.personality ?? [];
  const seed = `${input.project.id}|${input.briefVersionId}|${input.seed ?? ''}`;
  const territories = selectTerritories(profile, personality, seed, 3);
  const used = new Set<string>();
  const concepts = territories.map((territory, index) =>
    buildConcept({
      territory,
      brief: input.brief,
      business: input.business,
      profile,
      index,
      assets: input.assets,
      typography: resolveTypography(territory, input.brief, personality, seed, used),
    }),
  );
  concepts.forEach((concept, index) => {
    concept.quality = reviewConcept(concept, concepts.filter((_, other) => other !== index), input.brief);
  });
  const comparison = buildComparison(concepts);
  const best = [...concepts].sort((a, b) => b.quality.overall - a.quality.overall)[0] ?? concepts[0];
  return {
    format: CREATIVE_DIRECTION_FORMAT,
    briefVersionId: input.briefVersionId,
    briefVersion: input.briefVersion,
    brandKitVersionId: input.kit.versionId,
    brandKitVersion: input.kit.version,
    seed,
    generatedBy: 'deterministic',
    concepts,
    comparison,
    recommendation: {
      conceptKey: best.key,
      why: best
        ? `${best.name} scores highest on the advisory review (${best.quality.overall}/100), largely on ${best.quality.dimensions
            .slice()
            .sort((a, b) => b.score - a.score)
            .slice(0, 2)
            .map((dimension) => dimension.label.toLowerCase())
            .join(' and ')}. That is a starting point for the review, not a decision.`
        : 'No concept could be recommended.',
      advisory: QUALITY_ADVISORY,
    },
    limitations: [
      'Generated by the deterministic Studio engine: no paid model, network request or external design service was used.',
      'Typefaces are recommendations from the licensed catalogue. No font file is downloaded or redistributed by the Studio.',
      'Only approved Brand Kit assets with prototype permission are cited. Missing photography is recorded as a commission, never filled with stock or copied files.',
      'Quality scores are advisory heuristics. A design lead approves a concept against the creative standard in docs/WEBSITE_STUDIO.md.',
      'These are direction studies for the Studio interface, not a built website; page construction belongs to phase 4.',
    ],
  };
}

export function buildComparison(concepts: readonly CreativeConcept[]): CreativeDirectionContent['comparison'] {
  const row = (dimension: string, value: (concept: CreativeConcept) => string) => ({
    dimension,
    values: concepts.map((concept) => ({ conceptKey: concept.key, value: value(concept) })),
  });
  return [
    row('Creative idea', (concept) => `${concept.name}: ${concept.story.premise}`),
    row('Typography', (concept) => `${concept.typography.displayFamily} / ${concept.typography.bodyFamily} — ${concept.tokens.type.ratioName.replace(/_/g, ' ')}`),
    row('Colour', (concept) => {
      const ground = paletteEntry(concept.colour.palette, 'background')?.hex;
      const accent = paletteEntry(concept.colour.palette, 'accent')?.hex;
      return `${ground} ground, ${accent} accent`;
    }),
    row('Composition', (concept) => concept.composition.label),
    row('Imagery', (concept) => concept.imagery.direction.split('.')[0]),
    row('Motion', (concept) => `${concept.motion.label} (${concept.motion.spec.durationMs}ms)`),
    row('Conversion', (concept) => `${concept.conversion.primaryCta} — ${concept.conversion.path.length} steps`),
    row('Responsive', (concept) => concept.responsive.mobileFirst.split('.')[0]),
  ];
}

function directionConceptProblems(concept: CreativeConcept, usable: Set<string>, allowedEvidence: Set<string>): string[] {
  const problems: string[] = [];
  const prefix = `“${concept.name || concept.key}”`;
  if (!concept.key?.trim()) problems.push('A concept needs a stable key.');
  if ((concept.name ?? '').trim().length < 2) problems.push(`${prefix} needs a name.`);
  if ((concept.idea ?? '').trim().length < 30) problems.push(`${prefix} needs a one-sentence idea.`);
  if ((concept.narrative ?? '').trim().length < 60) problems.push(`${prefix} needs a short narrative.`);
  if (!concept.typography?.displayFontId || !concept.typography?.bodyFontId) problems.push(`${prefix} does not name both typefaces.`);
  else {
    const display = fontById(concept.typography.displayFontId);
    const body = fontById(concept.typography.bodyFontId);
    if (!display || !body) problems.push(`${prefix} uses a typeface outside the licensed catalogue.`);
    if (display && display.licence.webEmbedding !== 'permitted') problems.push(`${prefix} uses a typeface that is not licensed for the web.`);
    if (body && body.licence.webEmbedding !== 'permitted') problems.push(`${prefix} uses a typeface that is not licensed for the web.`);
  }
  if (!concept.composition?.family) problems.push(`${prefix} does not name a composition family.`);
  if (!concept.motion?.direction) problems.push(`${prefix} does not name a motion direction.`);
  if (!concept.motion?.reducedMotion) problems.push(`${prefix} has no reduced-motion alternative.`);
  if (!concept.story?.chapters?.length) problems.push(`${prefix} has no story sequence.`);
  if ((concept.conversion?.path ?? []).length < 3) problems.push(`${prefix} needs a conversion path of at least three steps.`);
  if ((concept.responsive?.breakpoints ?? []).length < 5) problems.push(`${prefix} must account for every breakpoint.`);
  for (const id of concept.imagery?.assetIds ?? []) {
    if (!usable.has(id)) problems.push(`${prefix} cites a file that is not approved, licensed and cleared for a prototype.`);
  }
  for (const id of concept.imagery?.logoAssetIds ?? []) {
    if (!usable.has(id)) problems.push(`${prefix} cites a mark that is not approved and cleared for a prototype.`);
  }
  for (const reference of concept.imagery?.references ?? []) {
    if (reference.url && !reference.url.startsWith('https://')) problems.push(`${prefix} has a reference that is not an https link.`);
  }
  for (const id of concept.rationale?.evidence?.observationIds ?? []) {
    if (!allowedEvidence.has(id)) problems.push(`${prefix} cites evidence that is not in the confirmed brief.`);
  }
  if (!concept.tokens) problems.push(`${prefix} has no design tokens.`);
  else for (const problem of tokenProblems(concept.tokens)) problems.push(`${prefix}: ${problem}`);
  if ((concept.quality?.dimensions ?? []).length !== 12) problems.push(`${prefix} needs all twelve review dimensions.`);
  if (!concept.quality?.advisory?.includes('Advisory')) problems.push(`${prefix} must state that the review is advisory.`);
  if (concept.quality && (concept.quality.overall < 0 || concept.quality.overall > 100)) problems.push(`${prefix} has an invalid review score.`);
  return problems;
}

/** Everything wrong with a direction set before a person is asked to approve it. */
export function directionProblems(content: CreativeDirectionContent, brief: CreativeBriefContent, assets: readonly StudioAsset[], today = todayIso()): string[] {
  const problems: string[] = [];
  if (content?.format !== CREATIVE_DIRECTION_FORMAT) problems.push('This is not a Studio creative direction.');
  if (!content?.briefVersionId) problems.push('The direction does not name the brief version it was built from.');
  if (!content?.brandKitVersionId) problems.push('The direction does not name the approved Brand Kit version.');
  if (content?.brandKitVersion !== brief.brandKit?.version) problems.push('The direction was not built from the currently approved Brand Kit version.');
  if (content?.concepts?.length !== 3) problems.push('A direction must propose exactly three concepts.');
  const usable = new Set(prototypeAssets(assets, today).map((asset) => asset.id));
  const allowedEvidence = new Set(
    BRIEF_SECTION_KEYS.flatMap((key) => brief.sections[key]?.assertions ?? []).flatMap((assertion) => assertion.evidence.observationIds),
  );
  const keys = new Set<string>();
  for (const concept of content.concepts ?? []) {
    if (keys.has(concept.key)) problems.push(`The direction repeats the concept key “${concept.key}”.`);
    keys.add(concept.key);
    problems.push(...directionConceptProblems(concept, usable, allowedEvidence));
  }
  const families = new Set((content.concepts ?? []).map((concept) => concept.composition?.family));
  if (families.size < 3) problems.push('The three concepts must use three different composition families.');
  const motions = new Set((content.concepts ?? []).map((concept) => concept.motion?.direction));
  if (motions.size < 3) problems.push('The three concepts must use three different motion directions.');
  const pairings = new Set((content.concepts ?? []).map((concept) => `${concept.typography?.displayFontId}+${concept.typography?.bodyFontId}`));
  if (pairings.size < 3) problems.push('The three concepts must use three different typographic pairings.');
  const colours = new Set((content.concepts ?? []).map((concept) => paletteEntry(concept.colour?.palette ?? [], 'background')?.hex));
  if (colours.size < 3) problems.push('The three concepts must use three different colour grounds.');
  if (!keys.has(content.recommendation?.conceptKey)) problems.push('The recommendation must point at one of the three concepts.');
  for (const row of content.comparison ?? []) {
    if (row.values.length !== 3) problems.push(`The comparison row “${row.dimension}” must compare all three concepts.`);
  }
  if ((content.limitations ?? []).length < 4) problems.push('The direction must state its limitations.');
  return problems;
}

export function directionSummary(content: CreativeDirectionContent): string {
  const names = content.concepts.map((concept) => concept.name).join(', ');
  const recommended = content.concepts.find((concept) => concept.key === content.recommendation.conceptKey)?.name ?? 'none';
  return `Three concepts: ${names}. Advisory recommendation: ${recommended}.`;
}

/** The approval that currently governs the direction, if a later change request has not revoked it. */
export function currentDirectionApproval(reviews: readonly StudioCreativeDirectionReview[]): StudioCreativeDirectionReview | null {
  const sorted = [...reviews].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const decisive = sorted.filter((review) => review.decision !== 'feedback').at(-1);
  return decisive?.decision === 'approve' ? decisive : null;
}

/** The approved concept for a direction, or null. */
export function approvedConcept(content: CreativeDirectionContent, reviews: readonly StudioCreativeDirectionReview[]): CreativeConcept | null {
  const approval = currentDirectionApproval(reviews);
  if (!approval) return null;
  return content.concepts.find((concept) => concept.key === approval.conceptKey) ?? null;
}

/** Why a concept cannot be approved yet. */
export function conceptApprovalProblems(content: CreativeDirectionContent, conceptKey: string): string[] {
  const concept = content.concepts.find((entry) => entry.key === conceptKey);
  if (!concept) return ['That concept is not in this direction.'];
  const problems = tokenProblems(concept.tokens);
  if (!concept.quality.advisory.includes('Advisory')) problems.push('The quality review must be presented as advisory.');
  if (concept.quality.dimensions.length !== 12) problems.push('The quality review must cover all twelve dimensions.');
  for (const reference of concept.imagery.references) {
    if (reference.url && !reference.url.startsWith('https://')) problems.push('A reference is not an https link.');
  }
  if (!concept.conversion.primaryCta.trim()) problems.push('The concept needs a primary call to action.');
  return problems;
}

export interface ConceptEdit {
  name?: string;
  idea?: string;
  displayFontId?: string;
  bodyFontId?: string;
  primaryCta?: string;
}

/** Re-scores every concept after an edit, so the review always describes the version being looked at. */
export function recomputeQuality(content: CreativeDirectionContent, brief: CreativeBriefContent): CreativeDirectionContent {
  const next = structuredClone(content);
  next.concepts = next.concepts.map((concept, index) => ({
    ...concept,
    quality: reviewConcept(concept, next.concepts.filter((_, other) => other !== index), brief),
  }));
  next.comparison = buildComparison(next.concepts);
  const best = [...next.concepts].sort((a, b) => b.quality.overall - a.quality.overall)[0];
  next.recommendation = {
    conceptKey: best?.key ?? next.recommendation.conceptKey,
    why: best
      ? `${best.name} scores highest on the advisory review (${best.quality.overall}/100). That is a starting point for the review, not a decision.`
      : next.recommendation.why,
    advisory: QUALITY_ADVISORY,
  };
  return next;
}

/**
 * A person's edit becomes a new immutable direction version (the service saves it). Facts and asset
 * references are untouched; typography changes recompute the scale and the review.
 */
export function reviseConcept(content: CreativeDirectionContent, conceptKey: string, edit: ConceptEdit, brief: CreativeBriefContent): CreativeDirectionContent {
  const next = structuredClone(content);
  const concept = next.concepts.find((entry) => entry.key === conceptKey);
  if (!concept) throw new Error('That concept is not in this direction.');
  if (edit.name?.trim()) {
    if (edit.name.trim().length < 2 || edit.name.trim().length > 80) throw new Error('A concept name must be 2–80 characters.');
    concept.name = edit.name.trim();
  }
  if (edit.idea?.trim()) concept.idea = edit.idea.trim();
  if (edit.primaryCta?.trim()) concept.conversion.primaryCta = edit.primaryCta.trim();
  const display = edit.displayFontId ? fontById(edit.displayFontId) : fontById(concept.typography.displayFontId);
  const body = edit.bodyFontId ? fontById(edit.bodyFontId) : fontById(concept.typography.bodyFontId);
  if (!display || !body) throw new Error('Choose both typefaces from the licensed catalogue.');
  if (display.id === body.id) throw new Error('Display and body cannot be the same cut.');
  if (edit.displayFontId || edit.bodyFontId) {
    concept.typography = {
      ...concept.typography,
      displayFontId: display.id,
      bodyFontId: body.id,
      displayFamily: display.family,
      bodyFamily: body.family,
      displayWeights: `${Math.min(...display.weights)}–${Math.max(...display.weights)}`,
      bodyWeights: `${Math.min(...body.weights)}–${Math.max(...body.weights)}`,
      rationale: pairingRationale(display, body),
      licence: { display: display.licence.name, body: body.licence.name },
      licenceUrls: { display: display.licence.url, body: body.licence.url },
      fallback: { display: fontStack(display), body: fontStack(body) },
      notes: `${display.legibility} ${body.legibility}`,
      scale: buildTypeScale({ displayFontId: display.id, bodyFontId: body.id, ratio: concept.tokens.type.ratioName }),
    };
    concept.tokens = { ...concept.tokens, type: concept.typography.scale };
  }
  return recomputeQuality(next, brief);
}






































