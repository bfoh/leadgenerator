// Design tokens for the Creative Director: the measurable part of an art direction.
//
// A concept is not a mood board with colours attached. This module turns a direction into values a
// renderer can consume — a palette whose text contrasts are computed (WCAG 2.2 AA), a responsive type
// scale with line height and tracking, a spacing rhythm, a grid, and a motion specification with a
// reduced-motion alternative. Composition families are deliberately different from one another:
// editorial columns, a cinematic full-bleed frame, an asymmetric grid, a catalogue index, a quiet
// centred page and a modular block system. Three concepts for one business must not share one.

// ── Colour ─────────────────────────────────────────────────────────────────────────────────────

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map((c) => c + c).join('').toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

export function hexToRgb(hex: string): Rgb | null {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  return {
    r: Number.parseInt(clean.slice(1, 3), 16),
    g: Number.parseInt(clean.slice(3, 5), 16),
    b: Number.parseInt(clean.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): Rgb {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const hue = (p: number, q: number, t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 };
}

/** Lightens or darkens a colour in HSL space while keeping its hue and saturation. */
export function shiftLightness(hex: string, delta: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  return rgbToHex(hslToRgb({ ...hsl, l: Math.max(0, Math.min(1, hsl.l + delta)) }));
}

/** A readable text colour for a given background: near-black or near-white, whichever wins. */
export function readableTextColour(background: string): string {
  const dark = '#141413';
  const light = '#FAF8F4';
  return contrastRatio(background, dark) >= contrastRatio(background, light) ? dark : light;
}

/**
 * Moves `foreground` towards black or white — whichever direction reaches `minimum` — until it meets
 * the contrast target. Used to make a suggested palette accessible without abandoning its hue.
 */
export function ensureContrast(foreground: string, background: string, minimum = 4.5): string {
  if (contrastRatio(foreground, background) >= minimum) return normalizeHex(foreground) ?? foreground;
  const towardLight = luminance(background) < 0.5;
  let current = normalizeHex(foreground) ?? foreground;
  for (let step = 1; step <= 100; step += 1) {
    current = shiftLightness(foreground, towardLight ? step / 200 : -step / 200);
    if (contrastRatio(current, background) >= minimum) return current;
  }
  return towardLight ? '#FAF8F4' : '#141413';
}

export function mixColours(a: string, b: string, weightOfA: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const w = Math.max(0, Math.min(1, weightOfA));
  return rgbToHex({ r: ra.r * w + rb.r * (1 - w), g: ra.g * w + rb.g * (1 - w), b: ra.b * w + rb.b * (1 - w) });
}

export const PALETTE_ROLES = ['background', 'surface', 'text', 'muted_text', 'accent', 'accent_text', 'border', 'support'] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

export interface PaletteToken {
  name: string;
  hex: string;
  role: PaletteRole;
}

export interface ContrastCheck {
  foreground: string;
  background: string;
  ratio: number;
  passesAA: boolean;
  passesAAA: boolean;
  usage: string;
}

export const CONTRAST_REQUIREMENTS = { normalText: 4.5, largeText: 3, ui: 3, enhanced: 7 } as const;

/** Builds a coherent palette from four decisions, then fixes text contrast rather than hoping. */
export function buildPalette(input: {
  background: string;
  text: string;
  accent: string;
  support: string;
  surface?: string;
  names?: Partial<Record<PaletteRole, string>>;
}): PaletteToken[] {
  const background = normalizeHex(input.background) ?? '#F6F1E7';
  const surface = normalizeHex(input.surface ?? '') ?? (luminance(background) > 0.5 ? shiftLightness(background, -0.03) : shiftLightness(background, 0.045));
  const text = ensureContrast(input.text, background, CONTRAST_REQUIREMENTS.normalText);
  const accent = normalizeHex(input.accent) ?? '#7A1F3D';
  const accentText = readableTextColour(accent);
  const muted = ensureContrast(mixColours(text, background, 0.62), background, CONTRAST_REQUIREMENTS.normalText);
  const border = mixColours(text, background, 0.2);
  const support = ensureContrast(normalizeHex(input.support) ?? shiftLightness(accent, 0.3), background, CONTRAST_REQUIREMENTS.ui);
  const names = input.names ?? {};
  return [
    { name: names.background ?? 'Ground', hex: background, role: 'background' },
    { name: names.surface ?? 'Raised surface', hex: surface, role: 'surface' },
    { name: names.text ?? 'Ink', hex: text, role: 'text' },
    { name: names.muted_text ?? 'Secondary ink', hex: muted, role: 'muted_text' },
    { name: names.accent ?? 'Accent', hex: accent, role: 'accent' },
    { name: names.accent_text ?? 'Text on accent', hex: accentText, role: 'accent_text' },
    { name: names.border ?? 'Rule', hex: border, role: 'border' },
    { name: names.support ?? 'Support', hex: support, role: 'support' },
  ];
}

export function paletteEntry(palette: readonly PaletteToken[], role: PaletteRole): PaletteToken | null {
  return palette.find((entry) => entry.role === role) ?? null;
}

export function contrastChecks(palette: readonly PaletteToken[]): ContrastCheck[] {
  const pick = (role: PaletteRole) => paletteEntry(palette, role)?.hex ?? null;
  const background = pick('background');
  const surface = pick('surface');
  const text = pick('text');
  const muted = pick('muted_text');
  const accent = pick('accent');
  const accentText = pick('accent_text');
  const support = pick('support');
  if (!background || !surface || !text || !muted || !accent || !accentText || !support) return [];
  const pairs = [
    { foreground: text, background, usage: 'Body text on the page ground', target: CONTRAST_REQUIREMENTS.normalText },
    { foreground: text, background: surface, usage: 'Body text on a raised surface', target: CONTRAST_REQUIREMENTS.normalText },
    { foreground: muted, background, usage: 'Secondary text and captions', target: CONTRAST_REQUIREMENTS.normalText },
    { foreground: accentText, background: accent, usage: 'Text on an accent button', target: CONTRAST_REQUIREMENTS.normalText },
    { foreground: support, background, usage: 'Support tone used for rules and large accents', target: CONTRAST_REQUIREMENTS.ui },
  ];
  return pairs.map((pair) => {
    const ratio = contrastRatio(pair.foreground, pair.background);
    return {
      foreground: pair.foreground,
      background: pair.background,
      ratio,
      passesAA: ratio >= pair.target,
      passesAAA: ratio >= CONTRAST_REQUIREMENTS.enhanced,
      usage: pair.usage,
    };
  });
}

// ── Typography, spacing and grid ──────────────────────────────────────────────────────────────

export const TYPE_RATIOS = {
  minor_third: 1.2,
  major_third: 1.25,
  perfect_fourth: 1.333,
  augmented_fourth: 1.414,
  perfect_fifth: 1.5,
  golden: 1.618,
} as const;
export type TypeRatioName = keyof typeof TYPE_RATIOS;

export interface TypeStep {
  name: string;
  role: 'display' | 'heading' | 'lead' | 'body' | 'small' | 'label';
  minRem: number;
  maxRem: number;
  lineHeight: number;
  tracking: string;
  weight: number;
  use: string;
}

export interface TypeSystem {
  displayFontId: string;
  bodyFontId: string;
  ratioName: TypeRatioName;
  ratio: number;
  steps: TypeStep[];
  bodyMeasure: string;
  scaleNote: string;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** A deliberate modular scale, fluid between 360px and 1440px, with per-role leading and tracking. */
export function buildTypeScale(input: {
  base?: number;
  ratio?: TypeRatioName;
  displayFontId: string;
  bodyFontId: string;
}): TypeSystem {
  const base = input.base ?? 1.0625; // 17px: a comfortable body size for long copy.
  const ratioName = input.ratio ?? 'major_third';
  const ratio = TYPE_RATIOS[ratioName];
  const step = (power: number) => round(base * ratio ** power);
  const steps: TypeStep[] = [
    { name: 'display', role: 'display', minRem: step(3.1), maxRem: step(4.4), lineHeight: 0.98, tracking: '-0.035em', weight: 500, use: 'Opening statement; one per page' },
    { name: 'h1', role: 'heading', minRem: step(2.5), maxRem: step(3.3), lineHeight: 1.03, tracking: '-0.025em', weight: 600, use: 'Page title' },
    { name: 'h2', role: 'heading', minRem: step(1.9), maxRem: step(2.35), lineHeight: 1.1, tracking: '-0.015em', weight: 600, use: 'Section heading' },
    { name: 'h3', role: 'heading', minRem: step(1.35), maxRem: step(1.55), lineHeight: 1.22, tracking: '-0.005em', weight: 600, use: 'Sub-section and card title' },
    { name: 'lead', role: 'lead', minRem: step(0.55), maxRem: step(0.85), lineHeight: 1.5, tracking: '0', weight: 400, use: 'Standfirst and introduction' },
    { name: 'body', role: 'body', minRem: base, maxRem: round(base * 1.05), lineHeight: 1.62, tracking: '0', weight: 400, use: 'Running text' },
    { name: 'small', role: 'small', minRem: step(-0.3), maxRem: step(-0.15), lineHeight: 1.5, tracking: '0.005em', weight: 400, use: 'Captions, notes and legal text' },
    { name: 'label', role: 'label', minRem: step(-0.55), maxRem: step(-0.4), lineHeight: 1.3, tracking: '0.11em', weight: 600, use: 'Eyebrow labels and form labels, uppercase' },
  ];
  return {
    displayFontId: input.displayFontId,
    bodyFontId: input.bodyFontId,
    ratioName,
    ratio,
    steps,
    bodyMeasure: '58–72 characters in running text; 40–52 on mobile',
    scaleNote: `A ${ratioName.replace(/_/g, ' ')} scale (${ratio}) from a ${round(base * 16)}px body. Sizes are fluid between 360px and 1440px, so the display does not become a poster on a phone.`,
  };
}

/** A CSS clamp() expression for a step, between a 360px and a 1440px viewport. */
export function fluidType(step: TypeStep): string {
  const slope = (step.maxRem - step.minRem) / (1440 - 360);
  const intercept = step.minRem - slope * 360;
  const preferred = `${round(intercept)}rem + ${round(slope * 100)}vw`;
  return `clamp(${step.minRem}rem, ${preferred}, ${step.maxRem}rem)`;
}

export interface SpacingSystem {
  unitPx: number;
  steps: { name: string; px: number; rem: number }[];
  sectionRhythm: string;
}

/** A 4px base with a restrained scale; section rhythm is stated in words as well as numbers. */
export function buildSpacing(base = 4): SpacingSystem {
  const values = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40];
  return {
    unitPx: base,
    steps: values.map((multiple, index) => ({
      name: ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'][index],
      px: multiple * base,
      rem: round((multiple * base) / 16),
    })),
    sectionRhythm: 'Alternate one generous section pause with two tight ones: 96–160px between chapters on desktop, 48–72px on mobile, and never the same gap everywhere.',
  };
}

export const BREAKPOINTS = [
  { name: 'mobile', minWidth: 360, note: 'The design is drawn here first; nothing may require horizontal scrolling.' },
  { name: 'large mobile', minWidth: 480, note: 'One extra column may appear; type does not jump.' },
  { name: 'tablet', minWidth: 768, note: 'Two-column editorial layouts begin; navigation may expand.' },
  { name: 'laptop', minWidth: 1024, note: 'The full grid appears; imagery may bleed.' },
  { name: 'desktop', minWidth: 1280, note: 'Maximum measure is capped; whitespace grows, not font size.' },
  { name: 'wide', minWidth: 1440, note: 'Composition holds; no new content is revealed only at this width.' },
] as const;

export interface GridSystem {
  columns: number;
  gutterPx: number;
  marginPx: { mobile: number; desktop: number };
  maxWidthPx: number;
  notes: string;
}

// ── Composition families ─────────────────────────────────────────────────────────────────────

export const COMPOSITION_FAMILIES = [
  'editorial_columns',
  'cinematic_full_bleed',
  'asymmetric_offset',
  'catalogue_index',
  'quiet_centered',
  'modular_blocks',
] as const;
export type CompositionFamily = (typeof COMPOSITION_FAMILIES)[number];

export interface CompositionSpec {
  family: CompositionFamily;
  label: string;
  idea: string;
  grid: GridSystem;
  navigation: string;
  hero: string;
  imageComposition: string;
  spacingRhythm: string;
  materials: string[];
  avoid: string[];
  suitableFor: string[];
}

export const COMPOSITION_META: Record<CompositionFamily, CompositionSpec> = {
  editorial_columns: {
    family: 'editorial_columns',
    label: 'Editorial columns',
    idea: 'A page composed like a printed spread: a strong left column, a narrow marginal note column, and images that interrupt the measure rather than sit in boxes.',
    grid: { columns: 12, gutterPx: 24, marginPx: { mobile: 20, desktop: 64 }, maxWidthPx: 1320, notes: 'Text occupies columns 1–7; captions and metadata live in 8–12. The asymmetry is the composition.' },
    navigation: 'A single line of text links above a hairline rule; the current page is marked with a short accent underline, not a pill.',
    hero: 'A headline set across seven columns, a standfirst in the margin, and one tall photograph that begins below the fold.',
    imageComposition: 'Portrait and square crops, deliberately unequal; captions in the margin; no rounded corners.',
    spacingRhythm: 'Long vertical pauses between chapters, tight leading inside a chapter. Rules, not shadows, separate ideas.',
    materials: ['Hairline rules', 'Uncoated paper tone', 'Duotone photography', 'Marginal notes'],
    avoid: ['Card grids', 'Drop shadows', 'Centred everything', 'Decorative blobs'],
    suitableFor: ['Tailoring', 'Architecture', 'Publishing', 'Professional services', 'Galleries'],
  },
  cinematic_full_bleed: {
    family: 'cinematic_full_bleed',
    label: 'Cinematic full bleed',
    idea: 'The first frame is a photograph or film still; type sits inside the image with the discipline of a title sequence, and the page unfolds in scenes.',
    grid: { columns: 6, gutterPx: 16, marginPx: { mobile: 16, desktop: 40 }, maxWidthPx: 1600, notes: 'A shallow six-column overlay grid over full-width media; text is placed, never poured.' },
    navigation: 'A transparent bar over the first frame that becomes solid after the first scroll; the menu opens as a full-screen sequence, not a dropdown.',
    hero: 'Full-viewport image with one short line of type, a quiet scroll cue and no buttons competing with the photograph.',
    imageComposition: 'Full-bleed, wide crops with a consistent grade; occasional inset detail at 4:5 to slow the sequence.',
    spacingRhythm: 'Scenes rather than sections: each image-led block earns a viewport, with quieter typographic interludes between.',
    materials: ['Film grain', 'Deep shadow', 'One warm highlight', 'Letterboxed stills'],
    avoid: ['Busy overlays', 'Multiple competing calls to action', 'Stock-photo montage', 'Autoplay with sound'],
    suitableFor: ['Hotels and resorts', 'Restaurants', 'Fashion', 'Travel', 'Events'],
  },
  asymmetric_offset: {
    family: 'asymmetric_offset',
    label: 'Asymmetric offset',
    idea: 'Nothing is centred. A large typographic block sits off-axis against a smaller column, and the imbalance is resolved by a rule or an image at the edge.',
    grid: { columns: 12, gutterPx: 20, marginPx: { mobile: 20, desktop: 72 }, maxWidthPx: 1440, notes: 'A 7/5 split with a recurring 2-column offset; the eye travels diagonally.' },
    navigation: 'A vertical index on the left at desktop, collapsing to a top bar on mobile; section numbers rather than icons.',
    hero: 'Display type pushed to the right, an image cropped by the left edge, and a single line of orientation at the bottom.',
    imageComposition: 'Crops that bleed off one edge, with deliberate negative space on the opposite side; never a centred gallery.',
    spacingRhythm: 'Tension and release: a dense block followed by a wide empty field, repeated with variation.',
    materials: ['Concrete grey', 'Black rules', 'Oversized numerals', 'Cropped architectural detail'],
    avoid: ['Symmetry for its own sake', 'Equal card widths', 'Centred hero', 'Soft gradients'],
    suitableFor: ['Architecture', 'Design studios', 'Photography', 'Consulting', 'Technology'],
  },
  catalogue_index: {
    family: 'catalogue_index',
    label: 'Catalogue index',
    idea: 'The business is presented as a precise index: numbered entries, tabular metadata, and typography that behaves like a well-set catalogue.',
    grid: { columns: 12, gutterPx: 16, marginPx: { mobile: 16, desktop: 48 }, maxWidthPx: 1360, notes: 'A dense 12-column grid with a fixed metadata column; rows align across the page.' },
    navigation: 'A compact index bar with numbered sections and a search-like filter for collections; sticky but shallow.',
    hero: 'A title, a one-line definition and the first three entries visible immediately — the index starts above the fold.',
    imageComposition: 'Uniform crops in a strict ratio, with one oversized plate per section to break the rhythm.',
    spacingRhythm: 'Tight rows, generous section breaks, and a visible count so the visitor knows how much there is.',
    materials: ['Tabular figures', 'Numbered entries', 'Fine rules', 'Paper-white ground'],
    avoid: ['Hero video', 'Oversized decorative type', 'Pill buttons', 'Uneven product crops'],
    suitableFor: ['Tailoring and ready-to-wear', 'Furniture', 'Bookshops', 'Manufacturing', 'Wholesale'],
  },
  quiet_centered: {
    family: 'quiet_centered',
    label: 'Quiet centred',
    idea: 'One idea per screen, centred in a narrow measure, surrounded by enough space that the content feels considered rather than empty.',
    grid: { columns: 8, gutterPx: 24, marginPx: { mobile: 24, desktop: 48 }, maxWidthPx: 1080, notes: 'An eight-column grid used as a single centred measure; images may extend to 10 columns.' },
    navigation: 'A centred wordmark with two or three text links; no sticky bar on mobile, only a small menu at the top.',
    hero: 'A short statement, a quiet secondary line, and one image below it; the logo is not the loudest thing on the page.',
    imageComposition: 'Centred, generous margins, consistent aspect ratios; images are allowed to be small.',
    spacingRhythm: 'Even, unhurried pauses; the page should feel shorter than it is.',
    materials: ['Warm white', 'One accent thread', 'Soft natural light', 'Fine serif type'],
    avoid: ['Dense grids', 'Multiple accents', 'Motion on every element', 'Full-screen carousels'],
    suitableFor: ['Wellness', 'Boutique hospitality', 'Ceramics', 'Private practice', 'Weddings'],
  },
  modular_blocks: {
    family: 'modular_blocks',
    label: 'Modular blocks',
    idea: 'The page is a system of bordered cells with unequal spans: a plan, a schedule, a menu and a story can share one structure without becoming cards.',
    grid: { columns: 12, gutterPx: 0, marginPx: { mobile: 0, desktop: 0 }, maxWidthPx: 1440, notes: 'Cells share 1px rules rather than gaps; spans vary (3/6/4) so the grid never reads as a card wall.' },
    navigation: 'A utility bar with the practical information (hours, location, booking) and a separate primary menu.',
    hero: 'A bordered masthead with the business name, one line of positioning and the primary action in the same frame.',
    imageComposition: 'Images fill cells edge to edge; crops are chosen to align with the rule structure.',
    spacingRhythm: 'A visible modular beat; padding inside cells is consistent, while cell spans vary.',
    materials: ['1px rules', 'Solid blocks of colour', 'Utilitarian labels', 'Documentary photography'],
    avoid: ['Rounded cards', 'Shadows', 'Gradient buttons', 'Uniform three-column grids'],
    suitableFor: ['Professional services', 'Clinics', 'Education', 'Logistics', 'Civic organisations'],
  },
};

export function compositionMeta(family: string | null | undefined): CompositionSpec | null {
  return family && (COMPOSITION_FAMILIES as readonly string[]).includes(family) ? COMPOSITION_META[family as CompositionFamily] : null;
}

// ── Motion ────────────────────────────────────────────────────────────────────────────────────

export const MOTION_DIRECTIONS = [
  'refined_reveal',
  'editorial_transition',
  'image_mask',
  'cinematic_sequence',
  'subtle_parallax',
  'hover_choreography',
  'responsive_navigation',
] as const;
export type MotionDirection = (typeof MOTION_DIRECTIONS)[number];

export type AnimatedProperty = 'opacity' | 'transform' | 'clip-path';

export interface MotionSpec {
  direction: MotionDirection;
  label: string;
  idea: string;
  durationMs: number;
  easing: string;
  distancePx: number;
  staggerMs: number;
  properties: AnimatedProperty[];
  reducedMotion: string;
  performance: string;
  avoid: string[];
}

export const MOTION_META: Record<MotionDirection, MotionSpec> = {
  refined_reveal: {
    direction: 'refined_reveal',
    label: 'Refined reveal',
    idea: 'Content arrives once, quietly: a short rise and fade as a block enters the viewport, then it stays still.',
    durationMs: 420,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    distancePx: 12,
    staggerMs: 60,
    properties: ['opacity', 'transform'],
    reducedMotion: 'No movement: content is visible at rest from the first paint. No scroll listener is required.',
    performance: 'IntersectionObserver only; animate opacity and translate3d; never animate height, width, top or left.',
    avoid: ['Repeating reveals', 'Long queues of staggered items', 'Animating every paragraph'],
  },
  editorial_transition: {
    direction: 'editorial_transition',
    label: 'Editorial transition',
    idea: 'A page change behaves like turning a page: a brief wash of the ground colour, then the new content settles into place.',
    durationMs: 520,
    easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
    distancePx: 8,
    staggerMs: 0,
    properties: ['opacity', 'transform'],
    reducedMotion: 'A direct swap with no wash or slide; focus moves to the new heading immediately.',
    performance: 'One transition at a time; do not delay navigation for the animation. Prefers-reduced-motion removes it.',
    avoid: ['Blocking route changes', 'Full-screen wipes on every link', 'Animating the scroll position'],
  },
  image_mask: {
    direction: 'image_mask',
    label: 'Image mask',
    idea: 'A photograph is revealed by a moving shape — a hard-edged wipe, not a soft fade — so the crop feels composed rather than loaded.',
    durationMs: 640,
    easing: 'cubic-bezier(0.76, 0, 0.24, 1)',
    distancePx: 0,
    staggerMs: 0,
    properties: ['clip-path', 'opacity'],
    reducedMotion: 'The image appears already revealed at its final crop.',
    performance: 'Use clip-path on a fixed-size container only; provide width and height to prevent layout shift; no animated blur.',
    avoid: ['Animating on every image', 'Blur-up placeholders that shift layout', 'Masking text'],
  },
  cinematic_sequence: {
    direction: 'cinematic_sequence',
    label: 'Cinematic sequence',
    idea: 'A short, scroll-linked sequence of two or three frames that cross-fade with a slow scale, like a title sequence.',
    durationMs: 900,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    distancePx: 24,
    staggerMs: 120,
    properties: ['opacity', 'transform'],
    reducedMotion: 'The frames become a static, stacked gallery with captions; no scroll-linked motion.',
    performance: 'Cap at three frames, preload the first, lazy-load the rest; never animate video decoding or filters.',
    avoid: ['Autoplay with sound', 'Scroll hijacking', 'More than three frames', 'Parallax on text'],
  },
  subtle_parallax: {
    direction: 'subtle_parallax',
    label: 'Subtle parallax',
    idea: 'A single image moves a few pixels more slowly than the page, giving depth without turning the page into a fairground.',
    durationMs: 0,
    easing: 'linear',
    distancePx: 32,
    staggerMs: 0,
    properties: ['transform'],
    reducedMotion: 'No transform: the image is fixed in its frame.',
    performance: 'transform only, on one or two elements; respect prefers-reduced-motion; avoid on low-end mobile if frames drop.',
    avoid: ['Parallax on body text', 'Multiple layers', 'Scroll listeners without rAF throttling', 'Horizontal drift'],
  },
  hover_choreography: {
    direction: 'hover_choreography',
    label: 'Hover choreography',
    idea: 'A link or plate responds with a measured shift and a rule that draws in — feedback, not decoration.',
    durationMs: 220,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    distancePx: 4,
    staggerMs: 0,
    properties: ['opacity', 'transform'],
    reducedMotion: 'Hover states change colour and underline only; no movement.',
    performance: 'Pointer devices only; never hide essential content behind hover; keep a visible focus state for keyboards.',
    avoid: ['Hover-only information', 'Cursor-following blobs', 'Scale on large images', 'Animations that trap the pointer'],
  },
  responsive_navigation: {
    direction: 'responsive_navigation',
    label: 'Responsive navigation',
    idea: 'The menu adapts by width: a full index on desktop, a compact drawer on mobile, with the same order and labels.',
    durationMs: 300,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    distancePx: 16,
    staggerMs: 30,
    properties: ['opacity', 'transform'],
    reducedMotion: 'The drawer opens instantly; focus is moved to the first link and returned on close.',
    performance: 'Trap focus while open, close on Escape, set aria-expanded; do not animate the page behind the drawer.',
    avoid: ['Hamburger menus on desktop', 'Hidden primary actions on mobile', 'Animated focus rings that disappear', 'Body scroll left unlocked'],
  },
};

// ── The token bundle ─────────────────────────────────────────────────────────────────────────

export interface DesignTokens {
  palette: PaletteToken[];
  contrast: ContrastCheck[];
  type: TypeSystem;
  spacing: SpacingSystem;
  grid: GridSystem;
  motion: MotionSpec;
  radius: { basePx: number; note: string };
  border: { widthPx: number; note: string };
}

export function buildDesignTokens(input: {
  palette: PaletteToken[];
  type: TypeSystem;
  grid: GridSystem;
  motion: MotionSpec;
  radiusPx?: number;
  radiusNote?: string;
}): DesignTokens {
  return {
    palette: input.palette,
    contrast: contrastChecks(input.palette),
    type: input.type,
    spacing: buildSpacing(),
    grid: input.grid,
    motion: input.motion,
    radius: {
      basePx: input.radiusPx ?? 0,
      note: input.radiusNote ?? 'Square by default: radius competes with the grid and dates faster than composition.',
    },
    border: { widthPx: 1, note: 'One rule weight throughout; hierarchy comes from spacing, not from a family of borders.' },
  };
}

/** Why a token bundle cannot be used: readable, specific, and about the design rather than the code. */
export function tokenProblems(tokens: DesignTokens): string[] {
  const problems: string[] = [];
  if (tokens.palette.length < 6) problems.push('A palette needs at least six roles: ground, surface, ink, secondary ink, accent and text on accent.');
  for (const entry of tokens.palette) {
    if (!normalizeHex(entry.hex)) problems.push(`The colour “${entry.name}” is not a six-digit hex value.`);
  }
  const failing = tokens.contrast.filter((check) => !check.passesAA);
  for (const check of failing) problems.push(`“${check.usage}” has a contrast of ${check.ratio}:1; WCAG AA needs the stated target.`);
  const body = tokens.type.steps.find((step) => step.name === 'body');
  if (!body) problems.push('A type scale needs a body step.');
  if (body && body.minRem < 1) problems.push('Body text cannot fall below 16px (1rem).');
  const display = tokens.type.steps.find((step) => step.name === 'display');
  if (display && body && display.maxRem < body.maxRem * 2) problems.push('The display step is too close to body size to create hierarchy.');
  if (tokens.type.displayFontId === tokens.type.bodyFontId) problems.push('Display and body type must be different families or cuts, with a stated reason.');
  if (!tokens.type.bodyMeasure.includes('character')) problems.push('State the intended measure for body text.');
  if (tokens.grid.columns < 4) problems.push('A composition needs at least four columns to adapt across breakpoints.');
  if (!tokens.motion.reducedMotion) problems.push('Every motion direction needs a reduced-motion alternative.');
  if (tokens.motion.durationMs > 900) problems.push('Motion longer than 900ms delays the content; shorten it or make it interruptible.');
  for (const property of tokens.motion.properties) {
    if (!['opacity', 'transform', 'clip-path'].includes(property)) problems.push(`“${property}” is a layout property; animate only opacity, transform or clip-path.`);
  }
  if (tokens.radius.basePx > 16) problems.push('A radius above 16px reads as a generic card system; justify it or reduce it.');
  return problems;
}

/** CSS custom properties a later renderer can consume directly. */
export function tokensAsCssVariables(tokens: DesignTokens, stacks: { display: string; body: string }): Record<string, string> {
  const vars: Record<string, string> = {
    '--font-display': stacks.display,
    '--font-body': stacks.body,
    '--grid-columns': String(tokens.grid.columns),
    '--grid-gutter': `${tokens.grid.gutterPx}px`,
    '--grid-max': `${tokens.grid.maxWidthPx}px`,
    '--space-unit': `${tokens.spacing.unitPx}px`,
    '--radius': `${tokens.radius.basePx}px`,
    '--border-width': `${tokens.border.widthPx}px`,
    '--motion-duration': `${tokens.motion.durationMs}ms`,
    '--motion-ease': tokens.motion.easing,
  };
  for (const entry of tokens.palette) vars[`--colour-${entry.role.replace(/_/g, '-')}`] = entry.hex;
  for (const step of tokens.type.steps) {
    vars[`--type-${step.name}`] = fluidType(step);
    vars[`--leading-${step.name}`] = String(step.lineHeight);
    vars[`--tracking-${step.name}`] = step.tracking;
  }
  return vars;
}






