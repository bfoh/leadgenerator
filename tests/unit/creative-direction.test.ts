import { describe, expect, it } from 'vitest';
import {
  BRIEF_SECTION_KEYS,
  buildCreativeBrief,
  briefProblems,
  directionProblems,
  generateCreativeDirection,
  reviseBrief,
  reviseConcept,
  sectorProfile,
  type CreativeBriefContent,
} from '@/lib/domain/creative-direction';
import { fontCatalogueProblems, FONT_CATALOGUE, recommendFontPairings } from '@/lib/domain/font-catalogue';
import { contrastRatio } from '@/lib/domain/design-tokens';
import type { BrandKitContent, StudioAsset } from '@/lib/domain/studio-assets';
import type { StudioObservation, StudioProject } from '@/lib/domain/studio';
import type { Business } from '@/lib/domain/types';

// The Creative Director, exercised without a database: one fictional atelier, a synthetic Brand Kit,
// a handful of observations and one approved photograph. The same input must always produce the same
// three concepts, and no two concepts may share a composition, motion direction or pairing.

const ORG = '00000000-0000-4000-8000-0000000000aa';
const PROJECT = '00000000-0000-4000-8000-0000000000bb';
const KIT = '00000000-0000-4000-8000-0000000000cc';
const PHOTO = '00000000-0000-4000-8000-0000000000dd';

const business = {
  id: 'business-1',
  name: 'Nsroma Atelier',
  category: 'Fashion and tailoring',
  city: 'Accra',
  officialWebsite: 'https://nsromaatelier.example',
} as Business;

function project(id = PROJECT): StudioProject {
  return {
    id,
    organizationId: ORG,
    businessId: business.id,
    name: 'Nsroma Atelier — website concept',
    status: 'intelligence_ready',
    websiteUrl: business.officialWebsite,
    brief: '',
    intelligenceStatus: 'ready',
    intelligenceAt: '2026-10-25T09:00:00.000Z',
    intelligenceNote: null,
    createdBy: null,
    createdAt: '2026-10-25T09:00:00.000Z',
    updatedAt: '2026-10-25T09:00:00.000Z',
  };
}

function observation(overrides: Partial<StudioObservation>): StudioObservation {
  return {
    id: `obs-${Math.random().toString(36).slice(2, 8)}`,
    organizationId: ORG,
    projectId: PROJECT,
    runNumber: 1,
    key: 'identity.name',
    classification: 'verified_fact',
    category: 'identity',
    label: 'Trading name',
    detail: 'Nsroma Atelier',
    confidence: 90,
    reusePermission: 'permitted',
    sourceKind: 'website_page',
    sourceUrl: 'https://nsromaatelier.example',
    assetUrl: null,
    assetKind: null,
    observedAt: '2026-10-25T09:00:00.000Z',
    createdBy: null,
    createdAt: '2026-10-25T09:00:00.000Z',
    ...overrides,
  };
}

const OBSERVATIONS: StudioObservation[] = [
  observation({ id: 'obs-name', key: 'identity.name', label: 'Trading name', detail: 'Nsroma Atelier' }),
  observation({ id: 'obs-desc', key: 'identity.description', label: 'Description', detail: 'Hand-finished kente and kaba for weddings and naming ceremonies.' }),
  observation({ id: 'obs-contact', key: 'contact.routes', category: 'contact', label: 'Contact routes published', detail: 'The homepage publishes a WhatsApp link and a tap-to-call phone link.' }),
  observation({ id: 'obs-commerce', key: 'commerce.routes', category: 'commerce', label: 'Selling route', detail: 'The site offers a product listing or catalogue.' }),
  observation({ id: 'obs-unknown', key: 'unknown.pricing', category: 'commerce', classification: 'unknown', label: 'Price range', detail: 'The homepage does not state prices. Ask for the range and lead time.' }),
  observation({ id: 'obs-placeholder', key: 'content.placeholder', category: 'content', classification: 'placeholder', label: 'Placeholder review', detail: 'A testimonial still says “Client name here”.' }),
];

const ASSET: StudioAsset = {
  id: PHOTO,
  organizationId: ORG,
  projectId: PROJECT,
  fileName: 'kente-gown.jpg',
  kind: 'product_photo',
  status: 'approved',
  mimeType: 'image/jpeg',
  bytes: 240_000,
  width: 1600,
  height: 2000,
  checksumSha256: 'a'.repeat(64),
  storagePath: `${ORG}/${PROJECT}/${PHOTO}/kente-gown.jpg`,
  origin: 'client_supplied',
  ownerName: 'Nsroma Atelier',
  supplier: 'Ama Mensah',
  sourceUrl: null,
  licenceName: 'Client-owned photography',
  licenceReference: 'Email 21 Oct 2026',
  licenceExpiresOn: null,
  attributionRequired: false,
  attributionText: null,
  permissionEvidence: 'Email from the owner, 21 Oct 2026.',
  inspectPermission: 'granted',
  storePermission: 'granted',
  prototypePermission: 'granted',
  exportPermission: 'granted',
  publishPermission: 'denied',
  note: '',
  reviewNote: null,
  approvedBy: 'user-1',
  approvedAt: '2026-10-21T10:00:00.000Z',
  rejectedBy: null,
  rejectedAt: null,
  rejectedReason: null,
  revokedBy: null,
  revokedAt: null,
  revokedReason: null,
  supersedesId: null,
  createdBy: 'user-1',
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

function kit(overrides: Partial<BrandKitContent> = {}): BrandKitContent {
  return {
    logoAssetIds: [],
    palette: [
      { name: 'Ink', hex: '#241E1A', role: 'Text' },
      { name: 'Kente red', hex: '#7A1F3D', role: 'Accent' },
      { name: 'Warm paper', hex: '#F4EDE3', role: 'Background' },
    ],
    typography: [{ role: 'Display', family: 'Fraunces', weights: '400–700', licence: 'SIL Open Font License 1.1', assetId: null }],
    photographyAssetIds: [PHOTO],
    personality: ['quietly confident', 'exacting', 'warm'],
    visualDirection: 'Editorial and unhurried: warm off-white, one deep red, photography given room to breathe and type doing the talking.',
    toneOfVoice: { summary: 'Plain, precise and proud of the craft. Short sentences; no exclamation marks.', do: ['Name the cloth'], dont: ['Best in Ghana'] },
    ...overrides,
  };
}

function brief(projectId = PROJECT, overrides: Partial<BrandKitContent> = {}): CreativeBriefContent {
  return buildCreativeBrief({
    project: project(projectId),
    business,
    observations: OBSERVATIONS,
    reviews: [],
    kit: { versionId: KIT, version: 2, approvedAt: '2026-10-22T10:00:00.000Z', content: kit(overrides) },
    assets: [ASSET],
  });
}

describe('the typography catalogue', () => {
  it('is internally consistent and every family is licensed for the web', () => {
    expect(fontCatalogueProblems()).toEqual([]);
    expect(FONT_CATALOGUE.length).toBeGreaterThanOrEqual(20);
    for (const font of FONT_CATALOGUE) {
      expect(font.licence.webEmbedding).toBe('permitted');
      expect(font.licence.selfHosting).toBe('permitted');
      expect(font.sourceUrl).toMatch(/^https:\/\//);
      expect(font.weights.length).toBeGreaterThan(0);
    }
  });

  it('recommends different pairings for different characters and covers Ghanaian orthography when asked', () => {
    const warm = recommendFontPairings({ personality: ['warm', 'crafted'], seed: 'a', limit: 10 });
    const technical = recommendFontPairings({ personality: ['technical', 'systematic'], seed: 'a', limit: 10 });
    expect(warm[0].key).not.toBe(technical[0].key);
    const ghanaian = recommendFontPairings({ personality: ['warm'], languages: ['Twi'], limit: 20 });
    expect(ghanaian.length).toBeGreaterThan(0);
    for (const pair of ghanaian) {
      expect(pair.display.ghanaianOrthographies).toBe(true);
      expect(pair.body.ghanaianOrthographies).toBe(true);
    }
  });
});

describe('the creative brief', () => {
  it('separates verified facts, approved kit content and creative suggestions', () => {
    const content = brief();
    expect(content.format).toBe('dof-creative-brief/1');
    expect(briefProblems(content, [ASSET])).toEqual([]);
    expect(BRIEF_SECTION_KEYS.every((key) => content.sections[key])).toBe(true);

    const all = BRIEF_SECTION_KEYS.flatMap((key) => content.sections[key].assertions);
    const verified = all.filter((assertion) => assertion.basis === 'verified_fact');
    expect(verified.length).toBeGreaterThan(0);
    expect(verified.every((assertion) => assertion.evidence.observationIds.length > 0)).toBe(true);
    expect(all.filter((assertion) => assertion.basis === 'approved_brand_kit').every((assertion) => assertion.evidence.brandKitVersion === 2)).toBe(true);
    expect(all.some((assertion) => assertion.basis === 'creative_suggestion')).toBe(true);
    expect(content.missingInformation.some((item) => item.id === 'unknown-unknown.pricing')).toBe(true);
    expect(content.provenance.verified).toBeGreaterThan(0);
  });

  it('does not claim the site publishes a price it never showed', () => {
    const content = brief();
    const text = JSON.stringify(content);
    expect(text).not.toContain('GHS');
    expect(content.sections.objectives.assertions[0].basis).toBe('verified_fact');
    expect(content.missingInformation.find((item) => item.id === 'unknown-unknown.pricing')?.question).toContain('does not state prices');
  });

  it('rewrites only suggestions when a person adjusts the brief', () => {
    const content = brief();
    const revised = reviseBrief(content, { personality: ['precise'], atmosphere: 'Evening light and quiet confidence.' });
    expect(revised.sections.atmosphere.summary).toBe('Evening light and quiet confidence.');
    expect(revised.sections.positioning.assertions.some((assertion) => assertion.id === 'positioning.preference')).toBe(true);
    expect(revised.sections.identity.assertions).toEqual(content.sections.identity.assertions);
    expect(revised.provenance.suggestions).toBe(content.provenance.suggestions + 1);
  });
});

describe('three creative directions', () => {
  const direction = () => {
    const content = brief();
    return {
      content,
      result: generateCreativeDirection({
        project: project(),
        business,
        brief: content,
        briefVersionId: 'brief-1',
        briefVersion: 1,
        kit: { versionId: KIT, version: 2, content: kit() },
        assets: [ASSET],
      }),
    };
  };

  it('produces three concepts that differ in composition, motion, typography and colour', () => {
    const { content, result } = direction();
    expect(result.concepts).toHaveLength(3);
    expect(directionProblems(result, content, [ASSET])).toEqual([]);
    expect(new Set(result.concepts.map((concept) => concept.composition.family)).size).toBe(3);
    expect(new Set(result.concepts.map((concept) => concept.motion.direction)).size).toBe(3);
    expect(new Set(result.concepts.map((concept) => `${concept.typography.displayFontId}+${concept.typography.bodyFontId}`)).size).toBe(3);
    expect(new Set(result.concepts.map((concept) => concept.colour.palette.find((entry) => entry.role === 'background')?.hex)).size).toBe(3);
    for (const concept of result.concepts) {
      expect(concept.quality.dimensions).toHaveLength(12);
      expect(concept.quality.advisory).toContain('Advisory');
      expect(concept.imagery.assetIds.every((id) => id === PHOTO)).toBe(true);
      expect(concept.typography.licence.display).toContain('SIL Open Font License');
    }
    expect(result.concepts.some((concept) => concept.imagery.assetIds.includes(PHOTO))).toBe(true);
    expect(result.concepts.map((concept) => concept.key)).toContain(result.recommendation.conceptKey);
  });

  it('is deterministic and still differs between prospects', () => {
    const { content, result } = direction();
    const input = { project: project(), business, brief: content, briefVersionId: 'brief-1', briefVersion: 1, kit: { versionId: KIT, version: 2, content: kit() }, assets: [ASSET] };
    expect(generateCreativeDirection(input)).toEqual(result);

    const other = generateCreativeDirection({ ...input, project: project('00000000-0000-4000-8000-0000000000ee'), briefVersionId: 'brief-2' });
    expect(other.concepts.map((concept) => concept.key).join(',')).not.toBe(result.concepts.map((concept) => concept.key).join(','));
  });

  it('keeps the approved Brand Kit face and varies the supporting voice and scale', () => {
    const { result } = direction();
    for (const concept of result.concepts) {
      expect(concept.typography.displayFontId).toBe('fraunces');
      expect(concept.typography.fromBrandKit).toBe(true);
    }
    expect(new Set(result.concepts.map((concept) => concept.typography.bodyFontId)).size).toBeGreaterThan(1);
  });

  it('edits a concept into a new set without rewriting the others', () => {
    const { content, result } = direction();
    const target = result.concepts[0];
    const revised = reviseConcept(result, target.key, { name: 'A Sharper Archive', displayFontId: 'newsreader', primaryCta: 'Begin a commission' }, content);
    expect(revised.concepts[0].name).toBe('A Sharper Archive');
    expect(revised.concepts[0].typography.displayFontId).toBe('newsreader');
    expect(revised.concepts[0].typography.scale.displayFontId).toBe('newsreader');
    expect(revised.concepts[1]).toEqual(result.concepts[1]);
    expect(revised.concepts[0].quality.dimensions).toHaveLength(12);
    expect(contrastRatio('#241E1A', '#F4EDE3')).toBeGreaterThan(4.5);
  });

  it('recognises the sectors the demonstrations depend on', () => {
    expect(sectorProfile('Fashion and tailoring')).toBe('fashion');
    expect(sectorProfile('Boutique hotel')).toBe('hospitality');
    expect(sectorProfile('Architecture studio')).toBe('architecture');
    expect(sectorProfile('Law firm')).toBe('professional');
  });
});


