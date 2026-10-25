// Self-hosted WOFF2 files for the website renderer.
//
// The Creative Director recommends families from the licensed catalogue. Phase 4 can only render a
// family it actually has a file for: this registry records the six families bundled with the Studio,
// their exact files, weights and the OFL text shipped beside them. A direction that names any other
// catalogue family is not silently given an arbitrary face: the blueprint records that the file is
// not bundled and resolves to a documented fallback of the same classification. The blueprint keeps
// the requested family visible, so the gap is part of the review rather than a hidden edit.
//
// Every file below came from the Google Fonts repository and is offered under SIL OFL 1.1, which
// permits web embedding and self-hosting. The OFL text travels with the file in public/showcase/fonts.

import { fontById, OFL_1_1, type FontClassification } from './font-catalogue';

export interface BundledFontFile {
  url: string;
  weight: string;
  style: 'normal' | 'italic';
}

export interface BundledFont {
  id: string;
  family: string;
  files: BundledFontFile[];
  preload: string;
  classification: FontClassification;
  licenceText: string;
}

const font = (id: string, family: string, classification: FontClassification, directory: string, files: BundledFontFile[]): BundledFont => ({
  id,
  family,
  classification,
  files,
  preload: files[0].url,
  licenceText: `/showcase/fonts/${directory}/OFL.txt`,
});

export const BUNDLED_FONTS: Record<string, BundledFont> = {
  fraunces: font('fraunces', 'Fraunces', 'transitional_serif', 'fraunces', [
    { url: '/showcase/fonts/fraunces/fraunces-latin-var.woff2', weight: '100 900', style: 'normal' },
  ]),
  'instrument-serif': font('instrument-serif', 'Instrument Serif', 'modern_serif', 'instrument-serif', [
    { url: '/showcase/fonts/instrument-serif/instrument-serif-latin.woff2', weight: '400', style: 'normal' },
    { url: '/showcase/fonts/instrument-serif/instrument-serif-latin-italic.woff2', weight: '400', style: 'italic' },
  ]),
  archivo: font('archivo', 'Archivo', 'grotesque_sans', 'archivo', [
    { url: '/showcase/fonts/archivo/archivo-latin-var.woff2', weight: '100 900', style: 'normal' },
  ]),
  inter: font('inter', 'Inter', 'grotesque_sans', 'inter', [
    { url: '/showcase/fonts/inter/inter-latin-var.woff2', weight: '100 900', style: 'normal' },
  ]),
  'public-sans': font('public-sans', 'Public Sans', 'grotesque_sans', 'public-sans', [
    { url: '/showcase/fonts/public-sans/public-sans-latin-var.woff2', weight: '100 900', style: 'normal' },
  ]),
  'ibm-plex-sans': font('ibm-plex-sans', 'IBM Plex Sans', 'humanist_sans', 'ibm-plex-sans', [
    { url: '/showcase/fonts/ibm-plex-sans/ibm-plex-sans-latin-400.woff2', weight: '400', style: 'normal' },
    { url: '/showcase/fonts/ibm-plex-sans/ibm-plex-sans-latin-500.woff2', weight: '500', style: 'normal' },
    { url: '/showcase/fonts/ibm-plex-sans/ibm-plex-sans-latin-600.woff2', weight: '600', style: 'normal' },
  ]),
};

const SERIF_FALLBACK = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, 'Times New Roman', serif";
const SANS_FALLBACK = "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif";
const MONO_FALLBACK = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";
const NASKH_FALLBACK = "'Geeza Pro', 'Noto Naskh Arabic', 'Times New Roman', serif";

export interface FontRoleBinding {
  /** What the Creative Director asked for. */
  requestedFontId: string;
  requestedFamily: string;
  /** What the page will actually set first. */
  family: string;
  stack: string;
  bundled: boolean;
  files: BundledFontFile[];
  preload: string | null;
  licence: { name: string; spdx: string; url: string; record: string | null };
  fallbackReason: string | null;
}

function fallbackFor(classification: FontClassification): { family: string; stack: string } {
  if (classification === 'monospace') return { family: 'ui-monospace', stack: MONO_FALLBACK };
  if (classification === 'naskh') return { family: 'Noto Naskh Arabic', stack: NASKH_FALLBACK };
  if (classification.includes('serif')) return { family: 'Iowan Old Style', stack: SERIF_FALLBACK };
  return { family: 'Helvetica Neue', stack: SANS_FALLBACK };
}

/** Resolves a catalogue id to a bundled file or a documented, classification-appropriate fallback. */
export function resolveFontBinding(fontId: string): FontRoleBinding {
  const catalogue = fontById(fontId);
  const bundled = BUNDLED_FONTS[fontId];
  if (bundled) {
    return {
      requestedFontId: fontId,
      requestedFamily: catalogue?.family ?? bundled.family,
      family: bundled.family,
      stack: `'${bundled.family}', ${fallbackFor(bundled.classification).stack}`,
      bundled: true,
      files: bundled.files,
      preload: bundled.preload,
      licence: { name: OFL_1_1.name, spdx: OFL_1_1.spdx, url: OFL_1_1.url, record: bundled.licenceText },
      fallbackReason: null,
    };
  }
  const classification = catalogue?.classification ?? 'grotesque_sans';
  const fallback = fallbackFor(classification);
  return {
    requestedFontId: fontId,
    requestedFamily: catalogue?.family ?? fontId,
    family: fallback.family,
    stack: fallback.stack,
    bundled: false,
    files: [],
    preload: null,
    licence: {
      name: catalogue?.licence.name ?? OFL_1_1.name,
      spdx: catalogue?.licence.spdx ?? OFL_1_1.spdx,
      url: catalogue?.licence.url ?? OFL_1_1.url,
      record: null,
    },
    fallbackReason: catalogue
      ? `${catalogue.family} is licensed for self-hosting, but no WOFF2 file is bundled in this build. The renderer uses a ${classification.replace(/_/g, ' ')} fallback with the same role and records the substitution here.`
      : `The direction names “${fontId}”, which is not in the licensed catalogue. The renderer uses a neutral sans fallback and blocks publication until a licensed face is chosen.`,
  };
}

/** The font files a blueprint needs preloaded, one per role, never the whole catalogue. */
export function fontPreloads(bindings: readonly FontRoleBinding[]): string[] {
  return [...new Set(bindings.flatMap((binding) => (binding.preload ? [binding.preload] : [])))];
}
