// The three flagship demonstrations' approved media.
//
// These are synthetic demonstration assets. The photographs are properly licensed for this internal
// concept (Unsplash licence, CC BY / CC BY-SA evidence recorded here); the line drawings are
// Studio-generated and clearly labelled. Each record carries the same prototype-only permission as a
// live vault file, so the renderer never has a special case for showcases.
//
// Publication permission is deliberately denied: a licence for a prototype is not a licence to
// publish a client-facing site.

import { SYNTHETIC_ADWOA_ASSETS } from './showcase-adwoa-assets';
import type { BlueprintAsset } from './website-blueprint';
import type { BlueprintMediaSource } from './website-compositions';

const unsplash = 'https://unsplash.com/license';
const ccBy = 'https://creativecommons.org/licenses/by/2.0/';
const ccBy4 = 'https://creativecommons.org/licenses/by/4.0/';
const ccBySa = 'https://creativecommons.org/licenses/by-sa/4.0/';
const ccBySa2 = 'https://creativecommons.org/licenses/by-sa/2.0/';

function photo(input: {
  id: string;
  site: string;
  fileName: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  credit: string;
  licence: string;
  licenceUrl: string;
  sourceUrl: string;
}): BlueprintAsset {
  const sourcePath = `/showcase/${input.site}/${input.fileName}`;
  const stem = sourcePath.replace(/\.jpg$/i, '');
  return {
    id: input.id,
    fileName: input.fileName,
    kind: 'licensed_image',
    mimeType: 'image/jpeg',
    width: input.width,
    height: input.height,
    alt: input.alt,
    caption: input.caption,
    credit: input.credit,
    licence: { name: input.licence, reference: 'Prototype use; publication not granted', expiresOn: null, url: input.licenceUrl },
    permission: 'prototype',
    sourceKind: 'licensed_concept',
    sourcePath,
    sourceUrl: input.sourceUrl,
    checksum: null,
    // Pre-generated from the source with no upscaling. The renderer emits a native srcset; a client
    // without srcset support still receives the full image.
    variants: [
      { width: 640, src: `${stem}-640.jpg` },
      { width: 1280, src: `${stem}-1280.jpg` },
      ...(input.width >= 1600 ? [{ width: 1600, src: `${stem}-1600.jpg` }] : []),
    ],
  };
}

function drawing(input: {
  id: string;
  site: string;
  fileName: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}): BlueprintAsset {
  return {
    id: input.id,
    fileName: input.fileName,
    kind: 'illustration',
    mimeType: 'image/svg+xml',
    width: input.width,
    height: input.height,
    alt: input.alt,
    caption: input.caption,
    credit: 'Studio-generated drawing / Matrix Multitech Ltd',
    licence: { name: 'Studio-generated artwork', reference: 'Made for this synthetic demonstration', expiresOn: null, url: null },
    permission: 'prototype',
    sourceKind: 'studio_drawing',
    sourcePath: `/showcase/${input.site}/${input.fileName}`,
    sourceUrl: null,
    checksum: null,
  };
}

export const NSROMA_ASSETS: BlueprintAsset[] = [
  photo({
    id: 'nsroma-kente-fashion',
    site: 'nsroma',
    fileName: 'kente-fashion.jpg',
    width: 1333,
    height: 2000,
    alt: 'A model in an orange kente-inspired top and printed white trousers against a wall of bright woven cloth.',
    caption: 'Concept image: a study in pattern and posture. Not the atelier’s own collection.',
    credit: 'Fquasie / Wikimedia Commons / CC BY-SA 4.0',
    licence: 'CC BY-SA 4.0',
    licenceUrl: ccBySa,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Kente_fashion_in_Ghana.jpg',
  }),
  photo({
    id: 'nsroma-kente-detail',
    site: 'nsroma',
    fileName: 'kente-detail.jpg',
    width: 1599,
    height: 2000,
    alt: 'A close view of red and gold kente cloth, leather trim and a dark beaded necklace.',
    caption: 'Material study: colour, weight and the edge of the cloth.',
    credit: 'Fiifiabban / Wikimedia Commons / CC BY-SA 4.0',
    licence: 'CC BY-SA 4.0',
    licenceUrl: ccBySa,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Kente_And_Leather.jpg',
  }),
  photo({
    id: 'nsroma-portrait',
    site: 'nsroma',
    fileName: 'portrait.jpg',
    width: 1600,
    height: 2400,
    alt: 'A portrait of a young Black woman in a blue patterned blouse with a white collar.',
    caption: 'The human frame: a portrait for the final site, not a testimonial.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce',
  }),
  photo({
    id: 'nsroma-fitting-detail',
    site: 'nsroma',
    fileName: 'fitting-detail.jpg',
    width: 1600,
    height: 2400,
    alt: 'A close crop of a mustard top and teal trousers, with a hand resting in the pocket.',
    caption: 'A fitting detail: the place where cloth meets the body.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1506629082955-511b1aa562c8',
  }),
  drawing({
    id: 'nsroma-textile-study',
    site: 'nsroma',
    fileName: 'textile-study.svg',
    width: 1200,
    height: 1500,
    alt: 'A geometric weaving study in kente red, ink, brass and warm paper.',
    caption: 'A synthetic woven plate; no specific cloth is reproduced.',
  }),
  drawing({
    id: 'nsroma-measurement-study',
    site: 'nsroma',
    fileName: 'measurement-study.svg',
    width: 1200,
    height: 1500,
    alt: 'A toile pattern study with three pattern pieces, seam allowances and graphite grid lines.',
    caption: 'A pattern study marked “not for production”.',
  }),
];

const LEGACY_ADWOA_ASSETS: BlueprintAsset[] = [
  photo({
    id: 'adwoa-room-evening',
    site: 'adwoas-house',
    fileName: 'room-evening.jpg',
    width: 2000,
    height: 1333,
    alt: 'A bedroom in warm lamplight, its glass doors open onto a planted courtyard.',
    caption: 'Concept image: a room at dusk with the garden doors open. Not a photograph of Adwoa’s House.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1611892440504-42a792e24d32',
  }),
  photo({
    id: 'adwoa-room-window',
    site: 'adwoas-house',
    fileName: 'room-window.jpg',
    width: 1800,
    height: 1350,
    alt: 'Heavy green drapes and lamplight in a carpeted room, with a tufted sofa in the foreground.',
    caption: 'Concept image: heavy drapes and a low lamp. Not a room in this house.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1590490360182-c33d57733427',
  }),
  photo({
    id: 'adwoa-cape-coast',
    site: 'adwoas-house',
    fileName: 'cape-coast-castle.jpg',
    width: 2000,
    height: 1333,
    alt: 'The white walls and courtyard arcades of Cape Coast Castle under a blue sky.',
    caption: 'Cape Coast Castle, a short walk from the house. A real place, not a hotel amenity.',
    credit: 'Adam Jones / Wikimedia Commons / CC BY-SA 2.0',
    licence: 'CC BY-SA 2.0',
    licenceUrl: ccBySa2,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cape_Coast_Castle_-_Courtyard_-_Cape_Coast_-_Ghana_(4714472673).jpg',
  }),
  photo({
    id: 'adwoa-garden',
    site: 'adwoas-house',
    fileName: 'garden-light.jpg',
    width: 1333,
    height: 2000,
    alt: 'A pale room with a round table, a plant and an arc lamp beside tall boarded walls.',
    caption: 'Concept image: plants and pale light. Not a recorded garden or service.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1519710164239-da123dc03ef4',
  }),
  photo({
    id: 'adwoa-table',
    site: 'adwoas-house',
    fileName: 'table-light.jpg',
    width: 2000,
    height: 1333,
    alt: 'A long dark table under a stair, in daylight from tall glazing.',
    caption: 'Concept image: a long table under a stair. Not the house’s own furniture.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d',
  }),
  photo({
    id: 'adwoa-threshold',
    site: 'adwoas-house',
    fileName: 'threshold-interior.jpg',
    width: 2000,
    height: 1333,
    alt: 'A sitting room with a red chair and framed pictures, seen past a kitchen doorway.',
    caption: 'Concept image: a room seen from its doorway. Not a photograph of Adwoa’s House.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267',
  }),
  photo({
    id: 'adwoa-room-alt',
    site: 'adwoas-house',
    fileName: 'room-alt.jpg',
    width: 2000,
    height: 1333,
    alt: 'A bright bedroom with white bedding, timber furniture and doors open to greenery.',
    caption: 'Concept image: morning light through open doors. Room names, rates and amenities are unconfirmed.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b',
  }),
  drawing({
    id: 'adwoa-house-plan',
    site: 'adwoas-house',
    fileName: 'house-plan.svg',
    width: 1400,
    height: 1100,
    alt: 'A dark concept plan showing nine rooms, a courtyard, a walled garden and the walk to the castle.',
    caption: 'A spatial concept, marked “not a measured plan”.',
  }),
  drawing({
    id: 'adwoa-light-study',
    site: 'adwoas-house',
    fileName: 'light-study.svg',
    width: 1200,
    height: 1500,
    alt: 'A light study showing a courtyard elevation at first and last light.',
    caption: 'Two hours of the same room, drawn rather than photographed.',
  }),
];

// Preserve the licensed castle context and Studio drawings; unrelated stock interiors are retired.
export const ADWOA_ASSETS: BlueprintAsset[] = [...SYNTHETIC_ADWOA_ASSETS, ...LEGACY_ADWOA_ASSETS.filter((asset) => asset.id === 'adwoa-cape-coast' || asset.sourceKind === 'studio_drawing')];

export const BANTAMA_ASSETS: BlueprintAsset[] = [
  photo({
    id: 'bantama-great-hall',
    site: 'bantama',
    fileName: 'great-hall.jpg',
    width: 2000,
    height: 1128,
    alt: 'The Great Hall at KNUST in Kumasi, studied through its concrete geometry and deep shadows.',
    caption: 'Context image: the Great Hall at KNUST, Kumasi. Not a Bantama project.',
    credit: 'Pnlarbi / Wikimedia Commons / CC BY 4.0',
    licence: 'CC BY 4.0',
    licenceUrl: ccBy4,
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:An_architectural_study_of_the_Great_Hall_at_Kwame_Nkrumah_University_of_Science_and_Technology_(KNUST),_Kumasi,_showcasing_its_iconic_brutalist_design_through_a_series_of_ground-level_and_aerial_perspectives._(36999).jpg',
  }),
  photo({
    id: 'bantama-bensberg',
    site: 'bantama',
    fileName: 'bensberg.jpg',
    width: 826,
    height: 1024,
    alt: 'A sculptural concrete building with deep-set windows and a heavy, folded roofline.',
    caption: 'Reference image: Gottfried Böhm, Bensberg Town Hall. Not a Bantama project.',
    credit: 'seier+seier / Flickr / CC BY 2.0',
    licence: 'CC BY 2.0',
    licenceUrl: ccBy,
    sourceUrl: 'https://www.flickr.com/photos/94852245@N00/3327476760',
  }),
  photo({
    id: 'bantama-scarpa',
    site: 'bantama',
    fileName: 'scarpa.jpg',
    width: 759,
    height: 1024,
    alt: 'A concrete and brick courtyard detail with an arch and a narrow stair.',
    caption: 'Reference image: Carlo Scarpa, Biennale sculpture garden. A study in junction and edge.',
    credit: 'seier+seier / Flickr / CC BY 2.0',
    licence: 'CC BY 2.0',
    licenceUrl: ccBy,
    sourceUrl: 'https://www.flickr.com/photos/94852245@N00/2980306178',
  }),
  photo({
    id: 'bantama-white-building',
    site: 'bantama',
    fileName: 'white-building.jpg',
    width: 1800,
    height: 1200,
    alt: 'A white modern building with a sharply folded roofline against a pale sky.',
    caption: 'Concept image: a study in surface, plane and shadow. Not a completed project.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1487958449943-2429e8be8625',
  }),
  photo({
    id: 'bantama-interior',
    site: 'bantama',
    fileName: 'interior.jpg',
    width: 1800,
    height: 1224,
    alt: 'A warm interior with timber, a sofa and soft daylight.',
    caption: 'Concept image: interior atmosphere, not a Bantama commission.',
    credit: 'Unsplash contributor / Unsplash License',
    licence: 'Unsplash License',
    licenceUrl: unsplash,
    sourceUrl: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c',
  }),
  drawing({
    id: 'bantama-section-study',
    site: 'bantama',
    fileName: 'section-study.svg',
    width: 1400,
    height: 1100,
    alt: 'A graphite and mineral-red section study for a courtyard clinic.',
    caption: 'A Studio section study marked “not a construction document”.',
  }),
  drawing({
    id: 'bantama-site-study',
    site: 'bantama',
    fileName: 'site-study.svg',
    width: 1400,
    height: 1100,
    alt: 'A site plan with three concept volumes arranged around a courtyard.',
    caption: 'A massing study marked “not a survey or planning submission”.',
  }),
];

export const SHOWCASE_ASSETS: Record<string, BlueprintAsset[]> = {
  'nsroma-atelier': NSROMA_ASSETS,
  'adwoas-house': ADWOA_ASSETS,
  'bantama-design-office': BANTAMA_ASSETS,
};

/** The renderer receives file sources separately from the blueprint, so a saved version never stores a signed URL. */
export function showcaseMedia(assets: readonly BlueprintAsset[]): BlueprintMediaSource[] {
  return assets.map((asset) => ({
    assetId: asset.id,
    src: asset.sourcePath,
    width: asset.width ?? 1200,
    height: asset.height ?? 1500,
    alt: asset.alt,
    srcSet: asset.variants?.length
      ? [...new Map([...asset.variants.filter((variant) => variant.mimeType !== 'image/avif'), { width: asset.width ?? 2000, src: asset.sourcePath }].map((variant) => [variant.width, variant])).values()].map((variant) => `${variant.src} ${variant.width}w`).join(', ')
      : undefined,
    avifSrcSet: asset.variants?.filter((variant) => variant.mimeType === 'image/avif').map((variant) => `${variant.src} ${variant.width}w`).join(', ') || undefined,
    sizes: '(min-width: 64rem) 56vw, 100vw',
  }));
}
