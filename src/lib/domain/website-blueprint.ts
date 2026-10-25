// The website blueprint: the structured, versioned document the renderer interprets.
//
// A direction is an argument; a blueprint is the build instruction that follows from it. It binds one
// approved concept, one approved Brand Kit version and the prototype-permitted files in the vault to
// a set of pages, sections, navigation, type and motion decisions. The renderer never evaluates
// generated JavaScript, CSS or HTML: it switches on this schema and renders trusted React components.
//
// The same inputs always produce the same blueprint. The blueprint itself is reproducible and is
// persisted as an immutable prototype version (migration 015) rather than edited in place.

import { z } from 'zod';
import { MOTION_DIRECTIONS, type CompositionFamily, type DesignTokens, type MotionDirection } from './design-tokens';
import type { FontRoleBinding } from './bundled-fonts';
import {
  IMAGE_TREATMENTS,
  INDEX_MODES,
  LAYOUT_DENSITIES,
  MEDIA_RHYTHMS,
  MOTION_EASING_NAMES,
  MOTION_EFFECTS,
  MOTION_SCENES,
  SCROLL_BEHAVIOURS,
  SECTION_SPACING,
  SEQUENCE_MODES,
  artDirectionProblems,
  buildArtDirection,
  type BlueprintArtDirection,
} from './website-art-direction';

export const WEBSITE_BLUEPRINT_FORMAT = 'dof-website-blueprint/1';

export const SITE_TONES = ['ground', 'surface', 'ink', 'accent', 'light'] as const;
export type SiteTone = (typeof SITE_TONES)[number];

export const SECTION_KINDS = ['hero', 'statement', 'sequence', 'index', 'chapter', 'process', 'gallery', 'details', 'cta'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const PLATE_SPANS = ['portrait', 'landscape', 'square', 'wide', 'full'] as const;
export type PlateSpan = (typeof PLATE_SPANS)[number];

/**
 * Actions are structured, never URLs. A prototype action opens the Studio's own notice and cannot
 * submit an enquiry; a page action stays inside the generated site; an anchor action scrolls within
 * the page. This makes an unauthorized external request impossible to express in a blueprint.
 */
export interface BlueprintAction {
  label: string;
  kind: 'page' | 'anchor' | 'prototype';
  target: string;
  note?: string;
}

export interface MediaPlate {
  assetId: string;
  caption?: string;
  credit?: string;
  index?: string;
  span: PlateSpan;
  /** A controlled crop focus; no arbitrary object-position string crosses the boundary. */
  focal?: 'centre' | 'top' | 'bottom' | 'left' | 'right';
  placeholder?: boolean;
  /** Optional editorial copy used by a scroll-story; never executable markup. */
  title?: string;
  body?: string;
}

export interface HeroSection {
  kind: 'hero';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'editorial-opener' | 'cinematic-frame' | 'offset-masthead' | 'immersive-arrival' | 'split-arrival';
  eyebrow: string;
  lines: string[];
  lead: string;
  meta: { label: string; value: string }[];
  assetId?: string;
  mobileAssetId?: string;
  primary?: BlueprintAction;
  secondary?: BlueprintAction;
  note?: string;
}

export interface StatementSection {
  kind: 'statement';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'marginal' | 'centred' | 'offset' | 'editorial-image';
  title?: string;
  body: string[];
  aside?: string;
  assetId?: string;
  note?: string;
}

export interface SequenceSection {
  kind: 'sequence';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'staggered-portraits' | 'cinematic-stills' | 'offset-plates' | 'scroll-story';
  title?: string;
  items: MediaPlate[];
  note?: string;
}

export interface IndexEntry {
  number: string;
  title: string;
  meta: string[];
  summary?: string;
  assetId?: string;
  tag?: string;
  pageSlug?: string;
}

export interface IndexSection {
  kind: 'index';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'material-ledger' | 'suite-register' | 'project-register';
  title: string;
  description?: string;
  countLabel?: string;
  entries: IndexEntry[];
  note?: string;
}

export interface ChapterSection {
  kind: 'chapter';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'split' | 'overlay' | 'index-sheet' | 'image-story';
  number?: string;
  title: string;
  body: string[];
  assetId?: string;
  details?: { label: string; value: string }[];
  note?: string;
}

export interface ProcessSection {
  kind: 'process';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'numbered-columns' | 'sequence-track' | 'drawing-sheet';
  title: string;
  steps: { number: string; title: string; body: string }[];
  note?: string;
}

export interface GallerySection {
  kind: 'gallery';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'contact-sheet' | 'filmstrip' | 'offset-grid' | 'editorial-gallery';
  title?: string;
  items: MediaPlate[];
  note?: string;
}

export interface DetailsSection {
  kind: 'details';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'contact-ledger' | 'visit-ledger' | 'office-block';
  title: string;
  body?: string;
  items: { label: string; value: string; note?: string; placeholder?: boolean }[];
  action?: BlueprintAction;
  note?: string;
}

export interface CtaSection {
  kind: 'cta';
  id: string;
  label: string;
  tone?: SiteTone;
  variant: 'letterpress' | 'invitation' | 'file-note' | 'image-invitation';
  eyebrow: string;
  title: string;
  body: string;
  primary: BlueprintAction;
  secondary?: BlueprintAction;
  assetId?: string;
  note?: string;
}

export type BlueprintSection =
  | HeroSection
  | StatementSection
  | SequenceSection
  | IndexSection
  | ChapterSection
  | ProcessSection
  | GallerySection
  | DetailsSection
  | CtaSection;

export interface BlueprintPage {
  /** The home page uses the stable key `home`; every other key is a URL path segment. */
  slug: string;
  label: string;
  title: string;
  description: string;
  tone: SiteTone;
  sections: BlueprintSection[];
}

export interface BlueprintAsset {
  id: string;
  fileName: string;
  kind: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string | null;
  credit: string | null;
  licence: { name: string; reference: string | null; expiresOn: string | null; url: string | null };
  permission: 'prototype';
  sourceKind: 'client_supplied' | 'licensed_concept' | 'studio_drawing' | 'synthetic_concept';
  /** The private storage path or a public showcase path. The renderer receives signed URLs separately. */
  sourcePath: string;
  /** The licence evidence page; a reference is shown as text, never hotlinked. */
  sourceUrl: string | null;
  checksum: string | null;
  /** Optional pre-generated responsive renditions. The renderer adds a native srcset when present. */
  variants?: { width: number; src: string; mimeType?: 'image/webp' | 'image/avif' }[];
}

export interface BlueprintNavigation {
  style: 'editorial-line' | 'overlay-sequence' | 'offset-rail';
  items: { label: string; pageSlug: string }[];
  action: BlueprintAction | null;
  note: string;
}

export interface BlueprintMissingInformation {
  id: string;
  question: string;
  why: string;
  blocking: boolean;
  source: string;
}

export interface BlueprintDisclosure {
  id: 'concept_website' | 'prototype_actions' | 'licensed_media';
  label: string;
  detail: string;
}

export interface BlueprintReadiness {
  previewReady: boolean;
  /** Publishing needs a separate permission check; a prototype never implies it. */
  publishReady: false;
  blockers: string[];
  warnings: string[];
  missingMedia: string[];
  assetCount: number;
}

export interface BlueprintTypography {
  display: FontRoleBinding;
  body: FontRoleBinding;
  warnings: string[];
  note: string;
}

export interface BlueprintDirectionBinding {
  directionId: string;
  directionVersion: number;
  conceptKey: string;
  conceptName: string;
  idea: string;
  narrative: string;
  compositionFamily: CompositionFamily;
  compositionLabel: string;
  motionDirection: string;
  briefVersionId: string;
  briefVersion: number;
}

export interface WebsiteBlueprint {
  format: typeof WEBSITE_BLUEPRINT_FORMAT;
  generatedAt: string;
  identity: {
    businessName: string;
    siteName: string;
    monogram: string;
    category: string;
    city: string;
    descriptor: string;
    synthetic: boolean;
  };
  studio: { projectId: string; projectName: string };
  direction: BlueprintDirectionBinding;
  brandKit: { versionId: string; version: number; paletteNames: string[] };
  tokens: DesignTokens;
  /** Optional on older immutable prototypes; new blueprints always carry an executable plan. */
  artDirection?: BlueprintArtDirection;
  typography: BlueprintTypography;
  navigation: BlueprintNavigation;
  pages: BlueprintPage[];
  assets: BlueprintAsset[];
  missingInformation: BlueprintMissingInformation[];
  disclosures: BlueprintDisclosure[];
  readiness: BlueprintReadiness;
  palette: { name: string; role: string; hex: string }[];
  designNotes: string[];
}

const actionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['page', 'anchor', 'prototype']),
  target: z.string().trim().min(1).max(120),
  note: z.string().trim().max(300).optional(),
});

const plateSchema = z.object({
  assetId: z.string().trim().min(1),
  caption: z.string().trim().max(300).optional(),
  credit: z.string().trim().max(300).optional(),
  index: z.string().trim().max(20).optional(),
  span: z.enum(PLATE_SPANS),
  focal: z.enum(['centre', 'top', 'bottom', 'left', 'right']).optional(),
  placeholder: z.boolean().optional(),
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(400).optional(),
});

const metaSchema = z.array(z.object({ label: z.string().min(1), value: z.string().min(1) }));

const heroSchema = z.object({
  kind: z.literal('hero'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['editorial-opener', 'cinematic-frame', 'offset-masthead', 'immersive-arrival', 'split-arrival']),
  eyebrow: z.string().min(1),
  lines: z.array(z.string().min(1)).min(1).max(6),
  lead: z.string().min(1),
  meta: metaSchema,
  assetId: z.string().min(1).optional(),
  mobileAssetId: z.string().min(1).optional(),
  primary: actionSchema.optional(),
  secondary: actionSchema.optional(),
  note: z.string().max(400).optional(),
});

const statementSchema = z.object({
  kind: z.literal('statement'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['marginal', 'centred', 'offset', 'editorial-image']),
  title: z.string().max(300).optional(),
  body: z.array(z.string().min(1)).min(1).max(8),
  aside: z.string().max(500).optional(),
  assetId: z.string().min(1).optional(),
  note: z.string().max(400).optional(),
});

const sequenceSchema = z.object({
  kind: z.literal('sequence'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['staggered-portraits', 'cinematic-stills', 'offset-plates', 'scroll-story']),
  title: z.string().max(300).optional(),
  items: z.array(plateSchema).min(1).max(8),
  note: z.string().max(500).optional(),
});

const indexSchema = z.object({
  kind: z.literal('index'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['material-ledger', 'suite-register', 'project-register']),
  title: z.string().min(1),
  description: z.string().max(500).optional(),
  countLabel: z.string().max(60).optional(),
  entries: z
    .array(
      z.object({
        number: z.string().min(1).max(20),
        title: z.string().min(1).max(120),
        meta: z.array(z.string().max(120)).max(6),
        summary: z.string().max(400).optional(),
        assetId: z.string().min(1).optional(),
        tag: z.string().max(60).optional(),
        pageSlug: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(12),
  note: z.string().max(500).optional(),
});

const chapterSchema = z.object({
  kind: z.literal('chapter'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['split', 'overlay', 'index-sheet', 'image-story']),
  number: z.string().max(20).optional(),
  title: z.string().min(1),
  body: z.array(z.string().min(1)).min(1).max(8),
  assetId: z.string().min(1).optional(),
  details: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).max(8).optional(),
  note: z.string().max(400).optional(),
});

const processSchema = z.object({
  kind: z.literal('process'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['numbered-columns', 'sequence-track', 'drawing-sheet']),
  title: z.string().min(1),
  steps: z.array(z.object({ number: z.string().min(1), title: z.string().min(1), body: z.string().min(1) })).min(2).max(8),
  note: z.string().max(500).optional(),
});

const gallerySchema = z.object({
  kind: z.literal('gallery'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['contact-sheet', 'filmstrip', 'offset-grid', 'editorial-gallery']),
  title: z.string().max(300).optional(),
  items: z.array(plateSchema).min(1).max(10),
  note: z.string().max(500).optional(),
});

const detailsSchema = z.object({
  kind: z.literal('details'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['contact-ledger', 'visit-ledger', 'office-block']),
  title: z.string().min(1),
  body: z.string().max(700).optional(),
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        value: z.string().min(1).max(240),
        note: z.string().max(300).optional(),
        placeholder: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(12),
  action: actionSchema.optional(),
  note: z.string().max(500).optional(),
});

const ctaSchema = z.object({
  kind: z.literal('cta'),
  id: z.string().min(1),
  label: z.string().min(1),
  tone: z.enum(SITE_TONES).optional(),
  variant: z.enum(['letterpress', 'invitation', 'file-note', 'image-invitation']),
  eyebrow: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  primary: actionSchema,
  secondary: actionSchema.optional(),
  assetId: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
});

const sectionSchema = z.discriminatedUnion('kind', [
  heroSchema,
  statementSchema,
  sequenceSchema,
  indexSchema,
  chapterSchema,
  processSchema,
  gallerySchema,
  detailsSchema,
  ctaSchema,
]);

const pageSchema = z.object({
  slug: z.string().min(1).max(120),
  label: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(400),
  tone: z.enum(SITE_TONES),
  sections: z.array(sectionSchema).min(1).max(14),
});

const assetSchema = z.object({
  id: z.string().min(1),
  fileName: z.string().min(1),
  kind: z.string().min(1),
  mimeType: z.string().min(1),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  alt: z.string().min(1).max(300),
  caption: z.string().max(300).nullable(),
  credit: z.string().max(300).nullable(),
  licence: z.object({
    name: z.string().min(1),
    reference: z.string().max(300).nullable(),
    expiresOn: z.string().nullable(),
    url: z.string().url().nullable(),
  }),
  permission: z.literal('prototype'),
  sourceKind: z.enum(['client_supplied', 'licensed_concept', 'studio_drawing', 'synthetic_concept']),
  sourcePath: z.string().min(1),
  sourceUrl: z.string().url().nullable(),
  checksum: z.string().nullable(),
  variants: z.array(z.object({ width: z.number().int().positive(), src: z.string().min(1), mimeType: z.enum(['image/webp', 'image/avif']).optional() })).max(6).optional(),
});

const artDirectionSchema = z.object({
  layout: z.object({
    density: z.enum(LAYOUT_DENSITIES),
    sectionSpacing: z.enum(SECTION_SPACING),
    mediaRhythm: z.enum(MEDIA_RHYTHMS),
    indexMode: z.enum(INDEX_MODES),
    sequenceMode: z.enum(SEQUENCE_MODES),
    sectionTransition: z.enum(['rule', 'tone-shift', 'overlap', 'none']),
    surfaceStyle: z.enum(['paper-and-ink']).optional(),
  }),
  motion: z.object({
    engine: z.literal('native-css-io-raf/1'),
    pageTransition: z.enum(['veil', 'settle', 'none']),
    durationMs: z.number().int().min(0).max(900),
    easing: z.enum(MOTION_EASING_NAMES),
    staggerMs: z.number().int().min(0).max(140),
    distancePx: z.number().int().min(0).max(40),
    scenes: z
      .array(
        z.object({
          scene: z.enum(MOTION_SCENES),
          heading: z.enum(MOTION_EFFECTS),
          body: z.enum(MOTION_EFFECTS),
          media: z.enum(MOTION_EFFECTS),
          scroll: z.enum(SCROLL_BEHAVIOURS),
        }),
      )
      .length(MOTION_SCENES.length),
    reducedMotion: z.literal('static'),
    note: z.string().min(1),
  }),
  imageTreatment: z.enum(IMAGE_TREATMENTS),
  note: z.string().min(1),
});

const fontBindingSchema = z.object({
  requestedFontId: z.string().min(1),
  requestedFamily: z.string().min(1),
  family: z.string().min(1),
  stack: z.string().min(1),
  bundled: z.boolean(),
  files: z.array(z.object({ url: z.string().min(1), weight: z.string().min(1), style: z.enum(['normal', 'italic']) })),
  preload: z.string().nullable(),
  licence: z.object({ name: z.string(), spdx: z.string(), url: z.string(), record: z.string().nullable() }),
  fallbackReason: z.string().nullable(),
});

export const websiteBlueprintSchema = z.object({
  format: z.literal(WEBSITE_BLUEPRINT_FORMAT),
  generatedAt: z.string().min(1),
  identity: z.object({
    businessName: z.string().min(1),
    siteName: z.string().min(1),
    monogram: z.string().min(1).max(4),
    category: z.string().min(1),
    city: z.string().min(1),
    descriptor: z.string().min(1),
    synthetic: z.boolean(),
  }),
  studio: z.object({ projectId: z.string().min(1), projectName: z.string().min(1) }),
  direction: z.object({
    directionId: z.string().min(1),
    directionVersion: z.number().int().positive(),
    conceptKey: z.string().min(1),
    conceptName: z.string().min(1),
    idea: z.string().min(1),
    narrative: z.string().min(1),
    compositionFamily: z.string().min(1),
    compositionLabel: z.string().min(1),
    motionDirection: z.string().min(1),
    briefVersionId: z.string().min(1),
    briefVersion: z.number().int().positive(),
  }),
  brandKit: z.object({ versionId: z.string().min(1), version: z.number().int().positive(), paletteNames: z.array(z.string()) }),
  tokens: z.object({
    palette: z.array(z.object({ name: z.string(), hex: z.string(), role: z.string() })),
    contrast: z.array(z.object({ foreground: z.string(), background: z.string(), ratio: z.number(), passesAA: z.boolean(), passesAAA: z.boolean(), usage: z.string() })),
    type: z.object({
      displayFontId: z.string(),
      bodyFontId: z.string(),
      ratioName: z.string(),
      ratio: z.number(),
      steps: z.array(z.object({ name: z.string(), role: z.string(), minRem: z.number(), maxRem: z.number(), lineHeight: z.number(), tracking: z.string(), weight: z.number(), use: z.string() })),
      bodyMeasure: z.string(),
      scaleNote: z.string(),
    }),
    spacing: z.object({ unitPx: z.number(), steps: z.array(z.object({ name: z.string(), px: z.number(), rem: z.number() })), sectionRhythm: z.string() }),
    grid: z.object({ columns: z.number(), gutterPx: z.number(), marginPx: z.object({ mobile: z.number(), desktop: z.number() }), maxWidthPx: z.number(), notes: z.string() }),
    motion: z.object({
      direction: z.string(),
      label: z.string(),
      idea: z.string(),
      durationMs: z.number(),
      easing: z.string(),
      distancePx: z.number(),
      staggerMs: z.number(),
      properties: z.array(z.enum(['opacity', 'transform', 'clip-path'])),
      reducedMotion: z.string(),
      performance: z.string(),
      avoid: z.array(z.string()),
    }),
    radius: z.object({ basePx: z.number(), note: z.string() }),
    border: z.object({ widthPx: z.number(), note: z.string() }),
  }),
  artDirection: artDirectionSchema.optional(),
  typography: z.object({ display: fontBindingSchema, body: fontBindingSchema, warnings: z.array(z.string()), note: z.string() }),
  navigation: z.object({
    style: z.enum(['editorial-line', 'overlay-sequence', 'offset-rail']),
    items: z.array(z.object({ label: z.string(), pageSlug: z.string() })),
    action: actionSchema.nullable(),
    note: z.string(),
  }),
  pages: z.array(pageSchema).min(1),
  assets: z.array(assetSchema),
  missingInformation: z.array(
    z.object({ id: z.string(), question: z.string(), why: z.string(), blocking: z.boolean(), source: z.string() }),
  ),
  disclosures: z.array(
    z.object({ id: z.enum(['concept_website', 'prototype_actions', 'licensed_media']), label: z.string(), detail: z.string() }),
  ),
  readiness: z.object({
    previewReady: z.boolean(),
    publishReady: z.literal(false),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
    missingMedia: z.array(z.string()),
    assetCount: z.number(),
  }),
  palette: z.array(z.object({ name: z.string(), role: z.string(), hex: z.string() })),
  designNotes: z.array(z.string()),
});

/** Every asset reference in a section, including entries whose plate is marked as a placeholder. */
export function sectionAssetIds(section: BlueprintSection): string[] {
  const ids: string[] = [];
  if ('assetId' in section && section.assetId) ids.push(section.assetId);
  if (section.kind === 'hero' && section.mobileAssetId) ids.push(section.mobileAssetId);
  if (section.kind === 'sequence' || section.kind === 'gallery') ids.push(...section.items.map((item) => item.assetId));
  if (section.kind === 'index') ids.push(...section.entries.flatMap((entry) => (entry.assetId ? [entry.assetId] : [])));
  return ids;
}

export function pageAssetIds(page: BlueprintPage): string[] {
  return page.sections.flatMap(sectionAssetIds);
}

export function blueprintAssetIds(blueprint: WebsiteBlueprint): string[] {
  return blueprint.pages.flatMap(pageAssetIds);
}

export { blueprintPage, pageHref } from './website-navigation';

/**
 * The semantic gate the renderer and save action share. Zod proves the shape; this proves the
 * document can be rendered safely: unique pages, working navigation, approved assets, a visible
 * disclosure and no unresolved action.
 */
export function blueprintProblems(blueprint: WebsiteBlueprint, availableMedia: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (blueprint.format !== WEBSITE_BLUEPRINT_FORMAT) problems.push('This is not a version 1 website blueprint.');
  if (blueprint.pages.length < 3) problems.push('A complete prototype needs at least three pages.');
  const slugs = new Set<string>();
  for (const page of blueprint.pages) {
    if (slugs.has(page.slug)) problems.push(`The page key “${page.slug}” appears twice.`);
    slugs.add(page.slug);
    if (!page.sections.length) problems.push(`The page “${page.label}” has no content.`);
    for (const section of page.sections) {
      if (!section.id) problems.push(`A section on “${page.label}” has no stable id.`);
    }
  }
  if (!slugs.has('home')) problems.push('The blueprint has no home page.');
  for (const item of blueprint.navigation.items) {
    if (!slugs.has(item.pageSlug)) problems.push(`Navigation points at a missing page: “${item.label}”.`);
  }
  if (blueprint.navigation.action?.kind === 'page' && !slugs.has(blueprint.navigation.action.target)) {
    problems.push('The navigation action points at a missing page.');
  }
  const assetIds = new Set(blueprint.assets.map((asset) => asset.id));
  if (assetIds.size !== blueprint.assets.length) problems.push('An asset id appears twice.');
  for (const asset of blueprint.assets) {
    if (asset.permission !== 'prototype') problems.push(`“${asset.fileName}” is not cleared for prototype use.`);
    if (!asset.licence.name.trim()) problems.push(`“${asset.fileName}” has no licence record.`);
    if (asset.licence.expiresOn && asset.licence.expiresOn < new Date().toISOString().slice(0, 10)) {
      problems.push(`The licence for “${asset.fileName}” has expired.`);
    }
  }
  const referenced = new Set(blueprintAssetIds(blueprint));
  for (const id of referenced) {
    if (!assetIds.has(id)) problems.push(`The renderer references an asset that is not in the blueprint: ${id}.`);
  }
  const media = new Set(availableMedia);
  for (const id of referenced) {
    if (availableMedia.length && !media.has(id)) problems.push(`The binary for asset ${id} is not available to the renderer.`);
  }
  for (const page of blueprint.pages) {
    for (const section of page.sections) {
      const actions = [
        'primary' in section ? section.primary : undefined,
        'secondary' in section ? section.secondary : undefined,
        section.kind === 'details' ? section.action : undefined,
      ];
      for (const action of actions) {
        if (action?.kind === 'page' && !slugs.has(action.target)) problems.push(`“${action.label}” points at a missing page.`);
        if (action?.kind === 'anchor' && !page.sections.some((entry) => entry.id === action.target)) {
          problems.push(`“${action.label}” points at an anchor that is not on this page.`);
        }
      }
    }
  }
  if (!blueprint.disclosures.some((entry) => entry.id === 'concept_website')) {
    problems.push('The concept website must show the “not an official business website” disclosure.');
  }
  if (blueprint.readiness.publishReady !== false) problems.push('A prototype cannot claim publish readiness.');
  if (!blueprint.typography.display.bundled && !blueprint.typography.display.fallbackReason) {
    problems.push('An unbundled display face needs a documented fallback.');
  }
  problems.push(...artDirectionProblems(blueprint.artDirection));
  return problems;
}

export function parseWebsiteBlueprint(input: unknown): WebsiteBlueprint {
  const parsed = websiteBlueprintSchema.parse(input) as WebsiteBlueprint;
  if (!parsed.artDirection) {
    const motion = MOTION_DIRECTIONS.includes(parsed.direction.motionDirection as MotionDirection)
      ? (parsed.direction.motionDirection as MotionDirection)
      : 'refined_reveal';
    parsed.artDirection = buildArtDirection(parsed.direction.compositionFamily as CompositionFamily, motion);
  }
  return parsed;
}

export interface BlueprintComparison {
  directionChanged: boolean;
  compositionChanged: boolean;
  typographyChanged: boolean;
  paletteChanged: boolean;
  pageCountDelta: number;
  changedPages: string[];
  summary: string[];
}

/** A readable comparison for the Studio's saved prototype history. */
export function compareBlueprints(before: WebsiteBlueprint, after: WebsiteBlueprint): BlueprintComparison {
  const beforePages = new Set(before.pages.map((page) => page.slug));
  const afterPages = new Set(after.pages.map((page) => page.slug));
  const changedPages = [...new Set([...beforePages, ...afterPages])].filter((slug) => {
    const a = before.pages.find((page) => page.slug === slug);
    const b = after.pages.find((page) => page.slug === slug);
    return !a || !b || a.sections.map((section) => section.id).join('|') !== b.sections.map((section) => section.id).join('|');
  });
  const beforePalette = before.tokens.palette.map((entry) => `${entry.role}:${entry.hex}`).join('|');
  const afterPalette = after.tokens.palette.map((entry) => `${entry.role}:${entry.hex}`).join('|');
  const typographyChanged =
    before.typography.display.requestedFontId !== after.typography.display.requestedFontId ||
    before.typography.body.requestedFontId !== after.typography.body.requestedFontId;
  const summary = [
    before.direction.directionId === after.direction.directionId
      ? `Same direction version ${after.direction.directionVersion}.`
      : `Direction changed from version ${before.direction.directionVersion} to ${after.direction.directionVersion}.`,
    `${before.pages.length} → ${after.pages.length} pages${changedPages.length ? `; changed: ${changedPages.join(', ')}` : '; no section changes'}.`,
    typographyChanged ? 'The typographic pairing changed.' : 'The typographic pairing held.',
    beforePalette === afterPalette ? 'The palette held.' : 'The palette changed.',
  ];
  return {
    directionChanged: before.direction.directionId !== after.direction.directionId,
    compositionChanged: before.direction.compositionFamily !== after.direction.compositionFamily,
    typographyChanged,
    paletteChanged: beforePalette !== afterPalette,
    pageCountDelta: after.pages.length - before.pages.length,
    changedPages,
    summary,
  };
}
