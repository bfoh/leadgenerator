// Typography research for the Creative Director: a curated catalogue of typefaces whose licences
// permit web embedding and self-hosting. Nothing here is downloaded, bundled or served by the
// Studio; the catalogue records the evidence a designer needs before choosing a face:
//
//   * who made it and where the authoritative source lives,
//   * the licence that permits web use, and whether attribution or renaming applies,
//   * the scripts and languages it actually covers (including Ghanaian orthographies),
//   * the weights and styles available, and whether it is variable,
//   * whether it suits display, body or interface work,
//   * its personality, so a pairing can be argued rather than guessed,
//   * legibility notes and loading cost.
//
// Every family below is offered under the SIL Open Font License 1.1, which permits embedding and
// self-hosting. Commercial families are deliberately absent: the Studio will not recommend a face it
// cannot licence for the client. A recommendation always names the licence and the source.

export const FONT_ROLES = ['display', 'body', 'interface', 'accent', 'monospace'] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const FONT_CLASSIFICATIONS = [
  'old_style_serif',
  'transitional_serif',
  'modern_serif',
  'slab_serif',
  'grotesque_sans',
  'humanist_sans',
  'geometric_sans',
  'monospace',
  'naskh',
] as const;
export type FontClassification = (typeof FONT_CLASSIFICATIONS)[number];

export const SCRIPT_CODES = ['Latn', 'Arab', 'Cyrl', 'Grek'] as const;
export type ScriptCode = (typeof SCRIPT_CODES)[number];

export interface FontLicence {
  name: string;
  spdx: 'OFL-1.1';
  url: string;
  webEmbedding: 'permitted';
  selfHosting: 'permitted';
  modification: 'permitted_with_reserved_name';
  attributionRequired: false;
}

/**
 * The OFL permits embedding, self-hosting and modification; a modified version must not use the
 * Reserved Font Name. Attribution is not required in the page, but the licence and copyright notice
 * travel with the files. https://openfontlicense.org
 */
export const OFL_1_1: FontLicence = {
  name: 'SIL Open Font License 1.1',
  spdx: 'OFL-1.1',
  url: 'https://openfontlicense.org',
  webEmbedding: 'permitted',
  selfHosting: 'permitted',
  modification: 'permitted_with_reserved_name',
  attributionRequired: false,
};

export interface FontLoading {
  /** Formats the upstream project publishes. WOFF2 first; WOFF only as a legacy fallback. */
  formats: string[];
  /** Subsets worth shipping for an English/Ghanaian site. */
  subsets: string[];
  /** Approximate WOFF2 weight of one Latin regular axis, in kilobytes. */
  estimatedWoff2Kb: number;
  strategy: string;
}

export interface FontSpec {
  id: string;
  family: string;
  classification: FontClassification;
  /** The foundry, studio or organisation that publishes the family. */
  foundry: string;
  /** Authoritative project or specimen page used to verify the family and its licence. */
  sourceUrl: string;
  licence: FontLicence;
  scripts: ScriptCode[];
  /** Languages the family is documented to cover, at least in the Latin subset. */
  languages: string[];
  /** True when the family is known to cover the extended Latin used by Twi, Ewe, Ga and Dagbani. */
  ghanaianOrthographies: boolean;
  weights: number[];
  styles: ('normal' | 'italic')[];
  variable: boolean;
  roles: FontRole[];
  personality: string[];
  /** Families this one is known to pair with; recommendations are argued, not automatic. */
  pairingIds: string[];
  legibility: string;
  loading: FontLoading;
  notes: string;
}

function font(spec: Omit<FontSpec, 'licence'>): FontSpec {
  return { ...spec, licence: OFL_1_1 };
}

export const FONT_CATALOGUE: readonly FontSpec[] = [
  // ── Display and text serifs ──────────────────────────────────────────────────────────────────
  font({
    id: 'fraunces',
    family: 'Fraunces',
    classification: 'transitional_serif',
    foundry: 'Undercase Type',
    sourceUrl: 'https://fonts.google.com/specimen/Fraunces',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['display', 'accent'],
    personality: ['warm', 'editorial', 'expressive', 'crafted', 'confident', 'slightly eccentric'],
    pairingIds: ['inter', 'public-sans', 'work-sans', 'newsreader'],
    legibility: 'Soft, high-contrast serifs with a small x-height at light weights; keep display sizes large, avoid long body copy below 18px, and use the optical-size axis rather than a synthetic scale.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 72, strategy: 'Self-host two axes (weight, optical size); preload the display cut only.' },
    notes: 'A contemporary serif with a genuine point of view. Best when the business has a craft or editorial story to tell; it can feel costume-like for a law firm or a clinic.',
  }),
  font({
    id: 'newsreader',
    family: 'Newsreader',
    classification: 'transitional_serif',
    foundry: 'Production Type',
    sourceUrl: 'https://fonts.google.com/specimen/Newsreader',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Spanish'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['display', 'body'],
    personality: ['literary', 'measured', 'quiet', 'authoritative', 'unhurried'],
    pairingIds: ['public-sans', 'inter', 'source-sans-3', 'ibm-plex-sans'],
    legibility: 'A news face drawn for continuous reading: generous counters, sturdy serifs and a calm rhythm. Works at 17–19px body sizes; italic is genuinely usable for captions.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 64, strategy: 'Self-host regular, italic and semibold; subset to Latin + Latin Extended.' },
    notes: 'The safest way to make a site feel written rather than assembled. Pairs well with a neutral grotesque when the display serif must not shout.',
  }),
  font({
    id: 'instrument-serif',
    family: 'Instrument Serif',
    classification: 'modern_serif',
    foundry: 'Instrument',
    sourceUrl: 'https://fonts.google.com/specimen/Instrument+Serif',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [400],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['display', 'accent'],
    personality: ['cinematic', 'sharp', 'fashion', 'confident', 'restrained'],
    pairingIds: ['inter', 'work-sans', 'archivo', 'public-sans'],
    legibility: 'Very high stroke contrast and tight spacing: a headline face, not a text face. Set no smaller than 28px, with generous tracking at small display sizes and no long paragraphs.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin'], estimatedWoff2Kb: 26, strategy: 'Preload the single display weight; it is small enough to ship both roman and italic.' },
    notes: 'A single-weight display serif with a couture temperament. Excellent for fashion and hospitality; a poor choice where the headings must carry dense information.',
  }),
  font({
    id: 'cormorant-garamond',
    family: 'Cormorant Garamond',
    classification: 'old_style_serif',
    foundry: 'Catharsis Fonts',
    sourceUrl: 'https://fonts.google.com/specimen/Cormorant+Garamond',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Italian'],
    ghanaianOrthographies: false,
    weights: [300, 400, 500, 600, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['display', 'accent'],
    personality: ['elegant', 'romantic', 'delicate', 'historic', 'luxurious'],
    pairingIds: ['inter', 'public-sans', 'work-sans'],
    legibility: 'Very fine hairlines disappear at small sizes and on low-resolution screens. Use 32px and above, on light grounds only, and never for body copy or form labels.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 38, strategy: 'One display weight plus italic; do not ship the full family.' },
    notes: 'Garamond at its most aristocratic. It earns a place when the brand is genuinely precious; otherwise it reads as a wedding invitation.',
  }),
  font({
    id: 'literata',
    family: 'Literata',
    classification: 'transitional_serif',
    foundry: 'TypeTogether',
    sourceUrl: 'https://fonts.google.com/specimen/Literata',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Spanish', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'display'],
    personality: ['bookish', 'sturdy', 'warm', 'trustworthy', 'contemporary'],
    pairingIds: ['instrument-serif', 'fraunces', 'archivo', 'inter'],
    legibility: 'Designed for long-form reading on screens: large x-height, open apertures and a comfortable measure at 17–20px. Holds up in dark mode better than most serifs.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext', 'cyrillic', 'greek'], estimatedWoff2Kb: 58, strategy: 'Self-host the Latin subset only unless the site publishes Greek or Cyrillic.' },
    notes: 'A body serif that carries authority without nostalgia. Pairs with a sharper display face so the two do different jobs.',
  }),
  font({
    id: 'source-serif-4',
    family: 'Source Serif 4',
    classification: 'transitional_serif',
    foundry: 'Adobe',
    sourceUrl: 'https://fonts.google.com/specimen/Source+Serif+4',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Spanish', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface'],
    personality: ['practical', 'clear', 'humane', 'institutional', 'calm'],
    pairingIds: ['bricolage-grotesque', 'space-grotesk', 'archivo', 'inter'],
    legibility: 'Low contrast, large x-height and unambiguous letterforms. A dependable editorial body face at 16–18px with a measure of 60–72 characters.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 54, strategy: 'Self-host regular, semibold and italic; the variable font keeps the request count low.' },
    notes: 'The quiet professional: a serif for institutions and professional services that want warmth without ornament.',
  }),
  font({
    id: 'spectral',
    family: 'Spectral',
    classification: 'transitional_serif',
    foundry: 'Production Type',
    sourceUrl: 'https://fonts.google.com/specimen/Spectral',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Spanish'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['body', 'display'],
    personality: ['literary', 'airy', 'precise', 'scholarly', 'modern'],
    pairingIds: ['inter', 'public-sans', 'work-sans'],
    legibility: 'Open, slightly condensed letterforms that read well at 17–19px. Light weights are display-only; use 400 for body and 600 for emphasis.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 46, strategy: 'Two static weights (400, 600) plus italic, or the variable build.' },
    notes: 'A literary serif with more air than Literata. Suits practices that sell judgement — architecture, law, consulting.',
  }),
  font({
    id: 'eb-garamond',
    family: 'EB Garamond',
    classification: 'old_style_serif',
    foundry: 'Georg Duffner and Octavio Pardo',
    sourceUrl: 'https://fonts.google.com/specimen/EB+Garamond',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Italian', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [400, 500, 600, 700, 800],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'display'],
    personality: ['classic', 'bookish', 'warm', 'civilised', 'unhurried'],
    pairingIds: ['public-sans', 'inter', 'archivo'],
    legibility: 'Authentic Renaissance proportions with a small x-height; set body at 18px or larger and avoid pure black on pure white. Italic is beautiful and idiosyncratic.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 62, strategy: 'Variable font, Latin subset; preload regular only.' },
    notes: 'A real Garamond revival rather than a pastiche. It signals patience and craft; it can feel antiquarian for a technology business.',
  }),
  font({
    id: 'playfair-display',
    family: 'Playfair Display',
    classification: 'modern_serif',
    foundry: 'Claus Eggers Sørensen',
    sourceUrl: 'https://fonts.google.com/specimen/Playfair+Display',
    scripts: ['Latn', 'Cyrl'],
    languages: ['English', 'French', 'Russian'],
    ghanaianOrthographies: false,
    weights: [400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['display'],
    personality: ['dramatic', 'fashion', 'editorial', 'bold', 'glamorous'],
    pairingIds: ['inter', 'work-sans', 'public-sans'],
    legibility: 'High contrast and tight fitting. Headlines only, 30px and above, with deliberate line breaks; never use it for navigation, captions or body text.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 48, strategy: 'One variable headline cut; subset to Latin and preload.' },
    notes: 'Widely used and therefore easy to make anonymous. Recommend it only when the brand already owns a dramatic editorial voice, and pair it with an unexpected text face.',
  }),
  font({
    id: 'dm-serif-display',
    family: 'DM Serif Display',
    classification: 'modern_serif',
    foundry: 'Colophon Foundry',
    sourceUrl: 'https://fonts.google.com/specimen/DM+Serif+Display',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [400],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['display'],
    personality: ['friendly', 'confident', 'editorial', 'clean', 'contemporary'],
    pairingIds: ['inter', 'public-sans', 'work-sans'],
    legibility: 'A single weight with sturdy contrast and open counters. Good from 24px upward; not intended for continuous reading.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin'], estimatedWoff2Kb: 22, strategy: 'Ship roman only unless the italic carries a specific voice.' },
    notes: 'A warmer alternative to Playfair. It reads as considered rather than theatrical, which suits premium retail and hospitality.',
  }),
  font({
    id: 'bodoni-moda',
    family: 'Bodoni Moda',
    classification: 'modern_serif',
    foundry: 'Owen Earl / indestructible type*',
    sourceUrl: 'https://fonts.google.com/specimen/Bodoni+Moda',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Italian'],
    ghanaianOrthographies: false,
    weights: [400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['display', 'accent'],
    personality: ['sharp', 'fashion', 'architectural', 'luxurious', 'precise'],
    pairingIds: ['inter', 'archivo', 'public-sans'],
    legibility: 'Extreme thick-thin contrast demands large sizes and generous leading. Hairlines fail on dark grounds and at mobile widths; use 34px and above.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 44, strategy: 'Variable display cut only; preload one weight.' },
    notes: 'A couture face with a colder edge than Playfair. A strong choice for fashion and architecture; risky in small UI.',
  }),
  font({
    id: 'marcellus',
    family: 'Marcellus',
    classification: 'old_style_serif',
    foundry: 'Astigmatic',
    sourceUrl: 'https://fonts.google.com/specimen/Marcellus',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [400],
    styles: ['normal'],
    variable: false,
    roles: ['display', 'accent'],
    personality: ['classical', 'calm', 'refined', 'hospitality', 'understated'],
    pairingIds: ['public-sans', 'inter', 'work-sans'],
    legibility: 'Moderate contrast and wide caps; a single roman weight. Headlines from 26px; small caps style suits labels and navigation but needs letter-spacing.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin'], estimatedWoff2Kb: 18, strategy: 'One small file; preload if it heads the first screen.' },
    notes: 'Quietly classical, without the fragility of Cormorant. Works for boutique hotels and practices that want dignity rather than drama.',
  }),
  font({
    id: 'lora',
    family: 'Lora',
    classification: 'transitional_serif',
    foundry: 'Cyreal',
    sourceUrl: 'https://fonts.google.com/specimen/Lora',
    scripts: ['Latn', 'Cyrl'],
    languages: ['English', 'French', 'Spanish', 'Russian'],
    ghanaianOrthographies: false,
    weights: [400, 500, 600, 700],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'display'],
    personality: ['warm', 'readable', 'friendly', 'contemporary', 'grounded'],
    pairingIds: ['inter', 'public-sans', 'archivo'],
    legibility: 'Sturdy serifs and a large x-height make it unusually tolerant at 16px. A safe body serif when the design needs warmth without fragility.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext', 'cyrillic'], estimatedWoff2Kb: 42, strategy: 'Variable font, Latin subset, regular + italic.' },
    notes: 'Approachable and unfussy. Less distinctive than Newsreader but easier to read on low-end Android devices.',
  }),
  font({
    id: 'gentium-book-plus',
    family: 'Gentium Book Plus',
    classification: 'old_style_serif',
    foundry: 'SIL International',
    sourceUrl: 'https://software.sil.org/gentium/',
    scripts: ['Latn', 'Grek', 'Cyrl'],
    languages: ['English', 'French', 'Ewe', 'Twi', 'Ga', 'Dagbani', 'Hausa'],
    ghanaianOrthographies: true,
    weights: [400, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['body', 'display'],
    personality: ['generous', 'scholarly', 'humane', 'clear', 'inclusive'],
    pairingIds: ['andika', 'public-sans', 'inter'],
    legibility: 'Large x-height, open apertures and full IPA coverage: ɛ and ɔ are drawn, not borrowed. Excellent for Ghanaian-language body text at 16–18px.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext', 'ipa'], estimatedWoff2Kb: 68, strategy: 'Self-host roman and bold; ship the IPA range so Twi and Ewe never fall back.' },
    notes: 'The recommendation when a site publishes Twi, Ewe, Ga or Dagbani. It is a text face first: use it for body copy and let a display face carry the headlines.',
  }),
  font({
    id: 'charis-sil',
    family: 'Charis SIL',
    classification: 'transitional_serif',
    foundry: 'SIL International',
    sourceUrl: 'https://software.sil.org/charis/',
    scripts: ['Latn', 'Cyrl'],
    languages: ['English', 'French', 'Ewe', 'Twi', 'Ga', 'Dagbani', 'Hausa'],
    ghanaianOrthographies: true,
    weights: [400, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['body', 'interface'],
    personality: ['neutral', 'reliable', 'scholarly', 'clear', 'unshowy'],
    pairingIds: ['instrument-serif', 'fraunces', 'archivo'],
    legibility: 'A workhorse text face with full Latin/IPA coverage and very predictable metrics. Reads cleanly at 15–17px in forms, tables and long copy.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext', 'ipa'], estimatedWoff2Kb: 74, strategy: 'Self-host roman + bold; subset conservatively so diacritics survive.' },
    notes: 'Less characterful than Gentium but more neutral. A sound body face for public-sector or educational work in multiple Ghanaian languages.',
  }),

  // ── Sans serifs ─────────────────────────────────────────────────────────────────────────────
  font({
    id: 'inter',
    family: 'Inter',
    classification: 'grotesque_sans',
    foundry: 'Rasmus Andersson',
    sourceUrl: 'https://fonts.google.com/specimen/Inter',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Spanish', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface'],
    personality: ['neutral', 'precise', 'modern', 'digital', 'unobtrusive'],
    pairingIds: ['fraunces', 'newsreader', 'instrument-serif', 'literata', 'playfair-display', 'bodoni-moda'],
    legibility: 'Designed for screens: tall x-height, disambiguated l/I/1, even spacing. Reliable from 14px; use 16px minimum for body copy and avoid light weights on dark grounds.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 48, strategy: 'Variable font, Latin subset; preload only if it sets the first screen.' },
    notes: 'The default is also the risk: Inter is everywhere. Pair it with a genuinely chosen display face, or choose a different grotesque when the brand needs its own voice.',
  }),
  font({
    id: 'public-sans',
    family: 'Public Sans',
    classification: 'grotesque_sans',
    foundry: 'US Web Design System',
    sourceUrl: 'https://fonts.google.com/specimen/Public+Sans',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Spanish'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface'],
    personality: ['civic', 'clear', 'trustworthy', 'plain', 'practical'],
    pairingIds: ['fraunces', 'newsreader', 'marcellus', 'source-serif-4', 'spectral', 'lora'],
    legibility: 'A neutral, highly legible face built for public services: strong counters and clear numerals. Works at 16px with a 1.5 line height; tabular figures help pricing.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 44, strategy: 'Variable font, Latin subset; ship only the weights the design uses.' },
    notes: 'The right kind of boring. It lets a serif or an image carry the personality while forms and navigation stay honest.',
  }),
  font({
    id: 'work-sans',
    family: 'Work Sans',
    classification: 'grotesque_sans',
    foundry: 'Wei Huang',
    sourceUrl: 'https://fonts.google.com/specimen/Work+Sans',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Spanish'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface', 'display'],
    personality: ['friendly', 'practical', 'human', 'slightly quirky', 'modern'],
    pairingIds: ['fraunces', 'cormorant-garamond', 'instrument-serif', 'newsreader', 'spectral'],
    legibility: 'Slightly narrow with a generous x-height; comfortable at 15–17px. The lighter weights are display-only. Numerals are proportional by default.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 46, strategy: 'Variable font, two weights if static: 400 and 600.' },
    notes: 'Warmer than Inter without becoming cute. A good interface face for businesses that want to feel human, not corporate.',
  }),
  font({
    id: 'archivo',
    family: 'Archivo',
    classification: 'grotesque_sans',
    foundry: 'Omnibus-Type',
    sourceUrl: 'https://fonts.google.com/specimen/Archivo',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Spanish'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'display', 'interface'],
    personality: ['strong', 'industrial', 'confident', 'editorial', 'direct'],
    pairingIds: ['literata', 'spectral', 'instrument-serif', 'charis-sil', 'bodoni-moda'],
    legibility: 'Compact, sturdy and unapologetic. Excellent for dense labels and navigation; body copy needs a little extra leading at 16px.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 50, strategy: 'Variable font; use the width axis sparingly and test at 360px.' },
    notes: 'A grotesque with weight and intent. Suits architecture, sport, manufacturing and any brand that would rather be direct than delicate.',
  }),
  font({
    id: 'space-grotesk',
    family: 'Space Grotesk',
    classification: 'geometric_sans',
    foundry: 'Florian Karsten',
    sourceUrl: 'https://fonts.google.com/specimen/Space+Grotesk',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [300, 400, 500, 600, 700],
    styles: ['normal'],
    variable: true,
    roles: ['display', 'interface', 'body'],
    personality: ['technical', 'curious', 'modern', 'slightly idiosyncratic', 'digital'],
    pairingIds: ['literata', 'newsreader', 'source-serif-4'],
    legibility: 'Distinctive letterforms (single-storey a, squared curves) that stay legible at 15–18px. Not ideal for long paragraphs; strong for labels and headlines.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 40, strategy: 'Variable font, Latin subset; no italic exists, so do not synthesise one.' },
    notes: 'For studios and technology practices with a point of view. It can date quickly; use it deliberately, not as a default “creative” face.',
  }),
  font({
    id: 'manrope',
    family: 'Manrope',
    classification: 'geometric_sans',
    foundry: 'Mikhail Sharanda',
    sourceUrl: 'https://fonts.google.com/specimen/Manrope',
    scripts: ['Latn', 'Cyrl'],
    languages: ['English', 'French', 'Russian'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800],
    styles: ['normal'],
    variable: true,
    roles: ['body', 'interface', 'display'],
    personality: ['clean', 'contemporary', 'friendly', 'confident', 'soft'],
    pairingIds: ['fraunces', 'literata', 'newsreader'],
    legibility: 'Open geometric forms with a large x-height; very comfortable at 15–17px. Lacks an italic, so emphasis must come from weight or a separate face.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 42, strategy: 'Variable font, Latin subset; avoid faux italic.' },
    notes: 'A calm modern sans that does not look like Inter. Good for hospitality and retail interfaces, especially on mobile.',
  }),
  font({
    id: 'sora',
    family: 'Sora',
    classification: 'geometric_sans',
    foundry: 'Jonathan Barnbrook',
    sourceUrl: 'https://fonts.google.com/specimen/Sora',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800],
    styles: ['normal'],
    variable: true,
    roles: ['display', 'interface'],
    personality: ['futuristic', 'technical', 'bold', 'geometric', 'confident'],
    pairingIds: ['literata', 'newsreader', 'source-serif-4'],
    legibility: 'Wide, geometric capitals and a tall x-height. Headline and UI sizes work; long body copy at 16px feels loose. No italic.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 40, strategy: 'Variable font; preload the hero weight only.' },
    notes: 'A strong technology voice. It can overpower a small business; use it where the business genuinely sells innovation.',
  }),
  font({
    id: 'bricolage-grotesque',
    family: 'Bricolage Grotesque',
    classification: 'grotesque_sans',
    foundry: 'Mathieu Triay',
    sourceUrl: 'https://fonts.google.com/specimen/Bricolage+Grotesque',
    scripts: ['Latn'],
    languages: ['English', 'French'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800],
    styles: ['normal'],
    variable: true,
    roles: ['display', 'accent'],
    personality: ['playful', 'editorial', 'unexpected', 'warm', 'bold'],
    pairingIds: ['newsreader', 'source-serif-4', 'literata', 'charis-sil'],
    legibility: 'A display grotesque with quirky details and a width axis. Use above 24px; do not set body copy in it, and test the width axis at small sizes.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 56, strategy: 'Variable font with width axis; preload one cut, subset to Latin.' },
    notes: 'A way to avoid a template look without illustration. Best as a single loud voice against a quiet text face.',
  }),
  font({
    id: 'libre-franklin',
    family: 'Libre Franklin',
    classification: 'grotesque_sans',
    foundry: 'Impallari Type',
    sourceUrl: 'https://fonts.google.com/specimen/Libre+Franklin',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Spanish'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface', 'display'],
    personality: ['civic', 'sturdy', 'friendly', 'historic', 'clear'],
    pairingIds: ['fraunces', 'newsreader', 'lora', 'marcellus'],
    legibility: 'A Franklin revival with strong counters and a compact width. Reliable at 15–18px and in dense tables; italic is well drawn.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 52, strategy: 'Variable font; ship roman + italic only if the italic is used.' },
    notes: 'A more distinctive alternative to Public Sans for civic and professional work, without becoming a fashion statement.',
  }),
  font({
    id: 'ibm-plex-sans',
    family: 'IBM Plex Sans',
    classification: 'grotesque_sans',
    foundry: 'IBM / Bold Monday',
    sourceUrl: 'https://fonts.google.com/specimen/IBM+Plex+Sans',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Spanish', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['body', 'interface'],
    personality: ['technical', 'systematic', 'trustworthy', 'engineered', 'calm'],
    pairingIds: ['newsreader', 'source-serif-4', 'literata'],
    legibility: 'Engineered for interfaces and data: clear numerals, generous counters and a slightly technical tone. Works at 14–16px; pair with Plex Mono for code and figures.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 36, strategy: 'Static weights 400/500/600; self-host only those three.' },
    notes: 'For professional services that sell rigour — engineering, finance, logistics. Less warm than Work Sans, more credible than Sora.',
  }),
  font({
    id: 'source-sans-3',
    family: 'Source Sans 3',
    classification: 'humanist_sans',
    foundry: 'Adobe',
    sourceUrl: 'https://fonts.google.com/specimen/Source+Sans+3',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Spanish', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface'],
    personality: ['friendly', 'clear', 'humanist', 'practical', 'approachable'],
    pairingIds: ['newsreader', 'fraunces', 'source-serif-4'],
    legibility: 'Open apertures and a comfortable rhythm at 15–17px. One of the most legible faces on inexpensive Android screens; a sensible body default.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 46, strategy: 'Variable font, Latin subset; regular + italic suffice for most sites.' },
    notes: 'Softer and more human than Inter. Use it when the business should feel approachable rather than clinical.',
  }),
  font({
    id: 'andika',
    family: 'Andika',
    classification: 'humanist_sans',
    foundry: 'SIL International',
    sourceUrl: 'https://software.sil.org/andika/',
    scripts: ['Latn'],
    languages: ['English', 'French', 'Ewe', 'Twi', 'Ga', 'Dagbani', 'Hausa'],
    ghanaianOrthographies: true,
    weights: [400, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['body', 'interface'],
    personality: ['clear', 'generous', 'educational', 'friendly', 'inclusive'],
    pairingIds: ['gentium-book-plus', 'newsreader', 'fraunces'],
    legibility: 'Drawn for literacy learners: unambiguous letterforms, generous spacing and full IPA/Ghanaian orthography support. Excellent at 16–19px and in forms.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext', 'ipa'], estimatedWoff2Kb: 62, strategy: 'Self-host roman and bold; keep the extended Latin range intact.' },
    notes: 'The clearest choice for a site that must serve readers of Twi, Ewe, Ga or Dagbani, and for public information where clarity outranks elegance.',
  }),
  font({
    id: 'noto-sans',
    family: 'Noto Sans',
    classification: 'humanist_sans',
    foundry: 'Google',
    sourceUrl: 'https://fonts.google.com/noto/specimen/Noto+Sans',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Spanish', 'Greek', 'Russian', 'Ewe', 'Twi'],
    ghanaianOrthographies: true,
    weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['body', 'interface'],
    personality: ['neutral', 'universal', 'reliable', 'plain', 'accessible'],
    pairingIds: ['fraunces', 'newsreader', 'literata', 'source-serif-4'],
    legibility: 'Designed for script coverage: predictable metrics and broad Latin/IPA support. A sound fallback body face when multiple languages must share one system.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 50, strategy: 'Variable Latin subset; do not load every Noto script, only those the site publishes.' },
    notes: 'A useful safety net, not a personality. If it is chosen, let typography elsewhere carry the character — or prefer Andika/Gentium when Ghanaian languages matter.',
  }),

  // ── Monospace and Arabic ────────────────────────────────────────────────────────────────────
  font({
    id: 'ibm-plex-mono',
    family: 'IBM Plex Mono',
    classification: 'monospace',
    foundry: 'IBM / Bold Monday',
    sourceUrl: 'https://fonts.google.com/specimen/IBM+Plex+Mono',
    scripts: ['Latn', 'Cyrl'],
    languages: ['English', 'French', 'Russian'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['monospace', 'accent'],
    personality: ['technical', 'precise', 'editorial', 'understated', 'systematic'],
    pairingIds: ['ibm-plex-sans', 'spectral', 'newsreader'],
    legibility: 'A true monospace with a clear zero and unambiguous punctuation. Use for figures, references, measurements and small labels — not paragraphs.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin', 'latin-ext'], estimatedWoff2Kb: 30, strategy: 'Static 400 and 500 only; subset to Latin.' },
    notes: 'The accent that makes an editorial or architectural layout feel measured. One weight is usually enough.',
  }),
  font({
    id: 'jetbrains-mono',
    family: 'JetBrains Mono',
    classification: 'monospace',
    foundry: 'JetBrains',
    sourceUrl: 'https://fonts.google.com/specimen/JetBrains+Mono',
    scripts: ['Latn', 'Cyrl', 'Grek'],
    languages: ['English', 'French', 'Greek', 'Russian'],
    ghanaianOrthographies: false,
    weights: [100, 200, 300, 400, 500, 600, 700, 800],
    styles: ['normal', 'italic'],
    variable: true,
    roles: ['monospace'],
    personality: ['developer', 'modern', 'technical', 'clear', 'geeky'],
    pairingIds: ['inter', 'space-grotesk', 'archivo'],
    legibility: 'Tall x-height and generous spacing for code. Deliberately technical: use it only where code, data or a developer audience justifies it.',
    loading: { formats: ['woff2', 'woff'], subsets: ['latin'], estimatedWoff2Kb: 34, strategy: 'Variable font; Latin subset, regular only.' },
    notes: 'A specialist accent. It signals software engineering, which is wrong for most client sites and right for a developer tool.',
  }),
  font({
    id: 'amiri',
    family: 'Amiri',
    classification: 'naskh',
    foundry: 'Khaled Hosny',
    sourceUrl: 'https://fonts.google.com/specimen/Amiri',
    scripts: ['Arab'],
    languages: ['Arabic', 'Hausa (Ajami)'],
    ghanaianOrthographies: false,
    weights: [400, 700],
    styles: ['normal', 'italic'],
    variable: false,
    roles: ['body', 'display'],
    personality: ['classical', 'literary', 'calligraphic', 'dignified', 'traditional'],
    pairingIds: ['public-sans', 'source-serif-4', 'noto-sans'],
    legibility: 'A Naskh face with proper Arabic shaping and generous diacritics. Set at 18–20px with extra leading; never letter-space Arabic, and mirror the layout.',
    loading: { formats: ['woff2', 'woff'], subsets: ['arabic', 'latin'], estimatedWoff2Kb: 58, strategy: 'Self-host regular and bold; use dir="rtl" and logical CSS properties.' },
    notes: 'Only relevant when the site publishes Arabic. It is not a decorative accent for Latin text, and Arabic typography needs a designer who reads it.',
  }),
];

const BY_ID = new Map(FONT_CATALOGUE.map((entry) => [entry.id, entry]));

export function fontById(id: string | null | undefined): FontSpec | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

export function requireFont(id: string): FontSpec {
  const found = fontById(id);
  if (!found) throw new Error(`Unknown typeface “${id}” in the Studio catalogue.`);
  return found;
}

export const FONT_CLASSIFICATION_META: Record<FontClassification, { label: string; family: 'serif' | 'sans' | 'mono' | 'arabic' }> = {
  old_style_serif: { label: 'Old-style serif', family: 'serif' },
  transitional_serif: { label: 'Transitional serif', family: 'serif' },
  modern_serif: { label: 'Modern (high-contrast) serif', family: 'serif' },
  slab_serif: { label: 'Slab serif', family: 'serif' },
  grotesque_sans: { label: 'Grotesque sans', family: 'sans' },
  humanist_sans: { label: 'Humanist sans', family: 'sans' },
  geometric_sans: { label: 'Geometric sans', family: 'sans' },
  monospace: { label: 'Monospace', family: 'mono' },
  naskh: { label: 'Naskh (Arabic)', family: 'arabic' },
};

/** A complete fallback stack: the chosen face, then a metrically similar system face, then generic. */
export function fontStack(font: FontSpec): string {
  const family = FONT_CLASSIFICATION_META[font.classification].family;
  if (family === 'serif') return `"${font.family}", Georgia, "Times New Roman", serif`;
  if (family === 'mono') return `"${font.family}", ui-monospace, SFMono-Regular, Menlo, monospace`;
  if (family === 'arabic') return `"${font.family}", "Noto Naskh Arabic", "Times New Roman", serif`;
  return `"${font.family}", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

export const pairingKey = (displayId: string, bodyId: string) => `${displayId}+${bodyId}`;

export interface FontPairingRecommendation {
  key: string;
  display: FontSpec;
  body: FontSpec;
  score: number;
  rationale: string;
}

export interface PairingRequest {
  /** Words the brief uses about the business, e.g. "quietly confident", "warm", "technical". */
  personality: string[];
  /** Language names the site will publish in. A Ghanaian language requires real orthography coverage. */
  languages?: string[];
  /** Stable project seed, so two businesses in one sector do not receive the same pairing. */
  seed?: string;
  /** Pairings already used by another concept in this direction. */
  exclude?: string[];
  limit?: number;
  /** Restrict display or body candidates (used when the Brand Kit already names a family). */
  displayIds?: string[];
  bodyIds?: string[];
}

const GHANAIAN_LANGUAGES = new Set(['twi', 'akan', 'ewe', 'ga', 'dagbani', 'dagbane', 'hausa', 'fante', 'fantse']);

/** FNV-1a: a small deterministic hash, so a seed rotates ties without a random source. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function overlap(a: readonly string[], b: readonly string[]): number {
  const wanted = new Set(a.map((word) => word.toLowerCase()));
  return b.filter((word) => wanted.has(word.toLowerCase())).length;
}

/**
 * Ranks display/body pairings for a business. The score is an argument, not a verdict: matching
 * personality counts, an intentional serif/sans contrast counts, and a documented pairing counts
 * more. Ties rotate on the project seed so the catalogue is actually explored.
 */
export function recommendFontPairings(request: PairingRequest): FontPairingRecommendation[] {
  const languages = (request.languages ?? []).map((language) => language.toLowerCase());
  const wantsGhanaian = languages.some((language) => GHANAIAN_LANGUAGES.has(language) || language.includes('twi') || language.includes('ewe'));
  const excluded = new Set(request.exclude ?? []);
  const displayCandidates = FONT_CATALOGUE.filter(
    (entry) => entry.roles.includes('display') || entry.roles.includes('accent'),
  ).filter((entry) => !request.displayIds || request.displayIds.includes(entry.id));
  const bodyCandidates = FONT_CATALOGUE.filter(
    (entry) => entry.roles.includes('body') || entry.roles.includes('interface'),
  ).filter((entry) => !request.bodyIds || request.bodyIds.includes(entry.id));

  const out: FontPairingRecommendation[] = [];
  for (const display of displayCandidates) {
    for (const body of bodyCandidates) {
      if (display.id === body.id) continue;
      if (wantsGhanaian && (!display.ghanaianOrthographies || !body.ghanaianOrthographies)) continue;
      if (display.scripts.includes('Arab') !== body.scripts.includes('Arab')) continue;
      const key = pairingKey(display.id, body.id);
      if (excluded.has(key)) continue;
      const sameFamily = FONT_CLASSIFICATION_META[display.classification].family === FONT_CLASSIFICATION_META[body.classification].family;
      const score =
        overlap(request.personality, display.personality) * 4 +
        overlap(request.personality, body.personality) * 2 +
        (display.pairingIds.includes(body.id) ? 5 : 0) +
        (body.pairingIds.includes(display.id) ? 2 : 0) +
        (sameFamily ? 0 : 2) +
        (display.variable ? 1 : 0);
      out.push({ key, display, body, score, rationale: pairingRationale(display, body) });
    }
  }
  const seed = request.seed ?? '';
  return out
    .sort((a, b) => b.score - a.score || hash(`${seed}|${a.key}`) - hash(`${seed}|${b.key}`) || a.key.localeCompare(b.key))
    .slice(0, request.limit ?? 8);
}

export function pairingRationale(display: FontSpec, body: FontSpec): string {
  const displayFamily = FONT_CLASSIFICATION_META[display.classification].family;
  const bodyFamily = FONT_CLASSIFICATION_META[body.classification].family;
  const contrast = displayFamily === bodyFamily
    ? 'The two share a family, so weight and size must do the differentiating work.'
    : `The ${FONT_CLASSIFICATION_META[display.classification].label.toLowerCase()} display face carries the voice while the ${FONT_CLASSIFICATION_META[body.classification].label.toLowerCase()} body face keeps reading effortless.`;
  return `${display.family} for display and ${body.family} for text. ${contrast} ${display.legibility}`;
}

/** Every catalogue entry passes these checks before a direction can rely on it. */
export function fontCatalogueProblems(fonts: readonly FontSpec[] = FONT_CATALOGUE): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const entry of fonts) {
    if (!entry.id || !/^[a-z0-9-]+$/.test(entry.id)) problems.push(`“${entry.family}” needs a stable lowercase id.`);
    if (ids.has(entry.id)) problems.push(`The catalogue lists “${entry.id}” twice.`);
    ids.add(entry.id);
    if (entry.licence.webEmbedding !== 'permitted') problems.push(`${entry.family} is not licensed for web embedding.`);
    if (!entry.licence.url.startsWith('https://')) problems.push(`${entry.family} has no authoritative licence link.`);
    if (!entry.sourceUrl.startsWith('https://')) problems.push(`${entry.family} has no authoritative source link.`);
    if (!entry.weights.length) problems.push(`${entry.family} lists no weights.`);
    if (!entry.roles.length) problems.push(`${entry.family} has no role.`);
    if (!entry.personality.length) problems.push(`${entry.family} has no personality description.`);
    if (entry.pairingIds.includes(entry.id)) problems.push(`${entry.family} cannot pair with itself.`);
  }
  for (const entry of fonts) {
    for (const partner of entry.pairingIds) {
      if (!ids.has(partner)) problems.push(`${entry.family} names “${partner}” as a pairing, but the catalogue does not contain it.`);
    }
  }
  return problems;
}











