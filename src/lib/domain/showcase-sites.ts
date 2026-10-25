// The three flagship websites, built by the real blueprint engine from the creative demonstrations.
//
// Each site chooses one of the three territories in its demonstration on purpose:
//
//   Nsroma Atelier ........ The Cutting Archive (editorial columns)
//   Adwoa's House ......... First Light (cinematic full bleed)
//   Bantama Design Office . Drawn Off-Axis (asymmetric offset)
//
// This is not a separate renderer. It is the same builder the Studio uses, with three authored
// editorial plans and three synthetic, licensed asset sets.

import { CREATIVE_DEMOS, runCreativeDemo, type CreativeDemo } from './creative-demos';
import type { BlueprintMediaSource } from './website-compositions';
import { buildWebsiteBlueprint } from './website-compositions';
import type { WebsiteBlueprint } from './website-blueprint';
import type { AssetRole, WebsiteEditorial } from './website-editorial';
import { SHOWCASE_ASSETS, showcaseMedia } from './showcase-assets';
import { ADWOA_EDITORIAL } from './showcase-adwoa';
import { BANTAMA_EDITORIAL } from './showcase-bantama';
import { NSROMA_EDITORIAL } from './showcase-nsroma';

export interface ShowcaseSiteMeta {
  slug: string;
  businessName: string;
  siteTitle: string;
  category: string;
  city: string;
  conceptKey: string;
  conceptName: string;
  composition: string;
  typography: string;
  tagline: string;
  description: string;
  accent: string;
  ground: string;
  pageCount: number;
  assetCount: number;
}

export interface ShowcaseSite extends ShowcaseSiteMeta {
  blueprint: WebsiteBlueprint;
  media: BlueprintMediaSource[];
}

interface ShowcaseConfig {
  slug: string;
  conceptKey: string;
  editorial: WebsiteEditorial;
  roleAssets: Partial<Record<AssetRole, string>>;
  tagline: string;
  description: string;
  accent: string;
  ground: string;
}

const CONFIGS: Record<string, ShowcaseConfig> = {
  'nsroma-atelier': {
    slug: 'nsroma-atelier',
    conceptKey: 'archive',
    editorial: NSROMA_EDITORIAL,
    roleAssets: {
      hero: 'nsroma-kente-fashion',
      portrait: 'nsroma-portrait',
      detail: 'nsroma-kente-detail',
      scene: 'nsroma-fitting-detail',
      context: 'nsroma-kente-fashion',
      drawing: 'nsroma-measurement-study',
      'drawing-alt': 'nsroma-textile-study',
      texture: 'nsroma-textile-study',
    },
    tagline: 'Cloth remembers the hand.',
    description: 'A luxury editorial archive for a fictional kente and kaba atelier in Osu, Accra.',
    accent: '#7A1F3D',
    ground: '#F4EEE3',
  },
  'adwoas-house': {
    slug: 'adwoas-house',
    conceptKey: 'arrival',
    editorial: ADWOA_EDITORIAL,
    roleAssets: {
      arrival: 'adwoa-v2-arrival',
      'arrival-mobile': 'adwoa-v2-arrival-mobile',
      threshold: 'adwoa-v2-threshold',
      house: 'adwoa-v2-exterior-evening',
      hero: 'adwoa-v2-room-garden',
      portrait: 'adwoa-v2-room-evening',
      detail: 'adwoa-v2-craft-detail',
      scene: 'adwoa-v2-room-upper',
      context: 'adwoa-cape-coast',
      drawing: 'adwoa-house-plan',
      'drawing-alt': 'adwoa-light-study',
      texture: 'adwoa-v2-table',
      garden: 'adwoa-v2-courtyard',
      table: 'adwoa-v2-table',
      'room-alt': 'adwoa-v2-room-upper',
    },
    tagline: 'Arrive slowly.',
    description: 'A cinematic guest-house website for a fictional nine-room house a short walk from Cape Coast Castle.',
    accent: '#31533F',
    ground: '#171A17',
  },
  'bantama-design-office': {
    slug: 'bantama-design-office',
    conceptKey: 'offaxis',
    editorial: BANTAMA_EDITORIAL,
    roleAssets: {
      hero: 'bantama-great-hall',
      portrait: 'bantama-bensberg',
      detail: 'bantama-scarpa',
      scene: 'bantama-white-building',
      context: 'bantama-great-hall',
      drawing: 'bantama-section-study',
      'drawing-alt': 'bantama-site-study',
      texture: 'bantama-interior',
    },
    tagline: 'The plan is the argument.',
    description: 'An architectural, asymmetric portfolio for a fictional practice in Kumasi, working across Ashanti.',
    accent: '#B23A26',
    ground: '#ECEDEA',
  },
};

const demoFor = (slug: string): CreativeDemo => {
  const demo = CREATIVE_DEMOS.find((entry) => entry.slug === slug);
  if (!demo) throw new Error(`Unknown showcase site: ${slug}.`);
  return demo;
};

/** Builds one site from the current demonstrations. Deterministic: no clock, network or model call. */
export function buildShowcaseSite(slug: string): ShowcaseSite | null {
  const config = CONFIGS[slug];
  if (!config) return null;
  const demo = demoFor(slug);
  const result = runCreativeDemo(demo);
  const concept = result.direction.concepts.find((entry) => entry.key === config.conceptKey);
  if (!concept) throw new Error(`The demonstration does not contain the “${config.conceptKey}” concept.`);
  const assets = SHOWCASE_ASSETS[slug] ?? [];
  const blueprint = buildWebsiteBlueprint({
    project: { id: demo.projectId, name: `${demo.business.name} — website concept` },
    business: demo.business,
    brief: result.brief,
    direction: { id: `demo-direction-${slug}-${config.conceptKey}`, version: 1, content: result.direction },
    conceptKey: config.conceptKey,
    kit: { versionId: demo.kitVersionId, version: 1 },
    assets: [],
    supplementaryAssets: assets,
    roleAssets: config.roleAssets,
    availableMediaIds: assets.map((asset) => asset.id),
    editorial: config.editorial,
    synthetic: true,
    generatedAt: '2026-10-25T09:00:00.000Z',
  });
  return {
    ...config,
    businessName: demo.business.name,
    siteTitle: config.editorial.siteName,
    category: demo.business.category,
    city: demo.business.city,
    conceptName: concept.name,
    composition: concept.composition.label,
    typography: `${concept.typography.displayFamily} / ${concept.typography.bodyFamily}`,
    pageCount: blueprint.pages.length,
    assetCount: blueprint.assets.length,
    blueprint,
    media: showcaseMedia(assets),
  };
}

export function listShowcaseSites(): ShowcaseSiteMeta[] {
  return Object.keys(CONFIGS).map((slug) => {
    const site = buildShowcaseSite(slug);
    if (!site) throw new Error(`Unknown showcase site: ${slug}.`);
    return {
      slug: site.slug,
      businessName: site.businessName,
      siteTitle: site.siteTitle,
      category: site.category,
      city: site.city,
      conceptKey: site.conceptKey,
      conceptName: site.conceptName,
      composition: site.composition,
      typography: site.typography,
      tagline: site.tagline,
      description: site.description,
      accent: site.accent,
      ground: site.ground,
      pageCount: site.pageCount,
      assetCount: site.assetCount,
    };
  });
}

export const SHOWCASE_SLUGS = Object.keys(CONFIGS);
