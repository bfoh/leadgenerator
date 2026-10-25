// Art direction and motion execution plans.
//
// The blueprint records *what* the concept wants to feel like; this module turns the approved
// composition family and motion direction into a small, closed set of executable decisions. The
// renderer reads these enums and data attributes — it never receives arbitrary CSS, selectors or
// JavaScript. Every effect below has a matching implementation in `website-motion.ts` and
// `website.module.css`, plus a reduced-motion alternative.
//
// The plan is deliberately conservative: one arrival choreography, one image treatment, one scroll
// behaviour per scene, and short durations. Motion is there to reveal the work, not to perform over it.

import { MOTION_META, type CompositionFamily, type MotionDirection } from './design-tokens';
import type { SectionKind } from './website-blueprint';

export const LAYOUT_DENSITIES = ['open', 'balanced', 'dense'] as const;
export type LayoutDensity = (typeof LAYOUT_DENSITIES)[number];

export const SECTION_SPACING = ['open', 'balanced', 'compact'] as const;
export type SectionSpacing = (typeof SECTION_SPACING)[number];

export const MEDIA_RHYTHMS = ['cinematic', 'editorial', 'contact-sheet'] as const;
export type MediaRhythm = (typeof MEDIA_RHYTHMS)[number];

export const INDEX_MODES = ['sticky-preview', 'rows', 'stacked'] as const;
export type IndexMode = (typeof INDEX_MODES)[number];

export const SEQUENCE_MODES = ['asymmetric', 'reel', 'stack'] as const;
export type SequenceMode = (typeof SEQUENCE_MODES)[number];

export const IMAGE_TREATMENTS = ['warm-cinematic', 'neutral', 'monochrome', 'material'] as const;
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];

export const MOTION_SCENES = ['arrival', 'narrative', 'sequence', 'register', 'chapter', 'gallery', 'details', 'invitation'] as const;
export type MotionSceneKind = (typeof MOTION_SCENES)[number];

export const MOTION_EFFECTS = ['none', 'fade', 'rise', 'line-mask', 'word-stagger', 'wipe', 'drift', 'draw', 'preview-swap'] as const;
export type MotionEffect = (typeof MOTION_EFFECTS)[number];

export const SCROLL_BEHAVIOURS = ['none', 'progress', 'drift', 'sticky'] as const;
export type ScrollBehaviour = (typeof SCROLL_BEHAVIOURS)[number];

export const MOTION_EASING_NAMES = ['enter', 'soft', 'editorial', 'linear'] as const;
export type MotionEasingName = (typeof MOTION_EASING_NAMES)[number];

export const MOTION_EASING: Record<MotionEasingName, string> = {
  enter: 'cubic-bezier(0.22, 1, 0.36, 1)',
  soft: 'cubic-bezier(0.4, 0, 0.2, 1)',
  editorial: 'cubic-bezier(0.76, 0, 0.24, 1)',
  linear: 'linear',
};

export interface MotionScene {
  scene: MotionSceneKind;
  heading: MotionEffect;
  body: MotionEffect;
  media: MotionEffect;
  scroll: ScrollBehaviour;
}

export interface BlueprintMotionPlan {
  /** A versioned engine identifier, not an arbitrary script name. */
  engine: 'native-css-io-raf/1';
  pageTransition: 'veil' | 'settle' | 'none';
  durationMs: number;
  easing: MotionEasingName;
  staggerMs: number;
  distancePx: number;
  scenes: MotionScene[];
  /** The plan is not complete without a first-class static composition. */
  reducedMotion: 'static';
  note: string;
}

export interface BlueprintLayoutPlan {
  density: LayoutDensity;
  sectionSpacing: SectionSpacing;
  mediaRhythm: MediaRhythm;
  indexMode: IndexMode;
  sequenceMode: SequenceMode;
  sectionTransition: 'rule' | 'tone-shift' | 'overlap' | 'none';
}

export interface BlueprintArtDirection {
  layout: BlueprintLayoutPlan;
  motion: BlueprintMotionPlan;
  imageTreatment: ImageTreatment;
  note: string;
}

const familyDensity = (family: CompositionFamily): LayoutDensity => {
  switch (family) {
    case 'cinematic_full_bleed':
      return 'open';
    case 'editorial_columns':
    case 'quiet_centered':
      return 'balanced';
    default:
      return 'dense';
  }
};

const familySpacing = (family: CompositionFamily): SectionSpacing => {
  if (family === 'cinematic_full_bleed') return 'open';
  if (family === 'editorial_columns' || family === 'quiet_centered') return 'balanced';
  return 'compact';
};

const familyMediaRhythm = (family: CompositionFamily): MediaRhythm => {
  if (family === 'cinematic_full_bleed') return 'cinematic';
  if (family === 'editorial_columns' || family === 'quiet_centered') return 'editorial';
  return 'contact-sheet';
};

const familyTreatment = (family: CompositionFamily): ImageTreatment => {
  if (family === 'cinematic_full_bleed') return 'warm-cinematic';
  if (family === 'asymmetric_offset') return 'monochrome';
  if (family === 'editorial_columns' || family === 'catalogue_index') return 'material';
  return 'neutral';
};

const familyTransition = (family: CompositionFamily): BlueprintLayoutPlan['sectionTransition'] => {
  if (family === 'cinematic_full_bleed') return 'tone-shift';
  if (family === 'editorial_columns') return 'rule';
  if (family === 'asymmetric_offset') return 'overlap';
  return 'none';
};

/** Only a cinematic composition earns the sticky-preview register; others keep a row list. */
const indexModeFor = (family: CompositionFamily): IndexMode => {
  if (family === 'cinematic_full_bleed') return 'sticky-preview';
  if (family === 'asymmetric_offset') return 'rows';
  return 'rows';
};

const sequenceModeFor = (family: CompositionFamily): SequenceMode => {
  if (family === 'cinematic_full_bleed') return 'asymmetric';
  if (family === 'editorial_columns') return 'reel';
  return 'stack';
};

const easingFor = (direction: MotionDirection): MotionEasingName => {
  switch (direction) {
    case 'image_mask':
      return 'editorial';
    case 'subtle_parallax':
      return 'linear';
    case 'cinematic_sequence':
      return 'soft';
    default:
      return 'enter';
  }
};

const baseScene = (scene: MotionSceneKind): MotionScene => ({
  scene,
  heading: 'rise',
  body: 'rise',
  media: 'none',
  scroll: 'none',
});

function scenesFor(direction: MotionDirection, family: CompositionFamily): MotionScene[] {
  const base = MOTION_SCENES.map(baseScene);
  const set = (scene: MotionSceneKind, patch: Partial<MotionScene>) => {
    const index = base.findIndex((entry) => entry.scene === scene);
    base[index] = { ...base[index], ...patch };
  };

  if (direction === 'cinematic_sequence' || family === 'cinematic_full_bleed') {
    set('arrival', { heading: 'line-mask', body: 'rise', media: 'drift', scroll: 'progress' });
    set('narrative', { heading: 'word-stagger', body: 'rise', media: 'wipe', scroll: 'progress' });
    set('sequence', { heading: 'word-stagger', body: 'fade', media: 'wipe', scroll: 'drift' });
    set('register', { heading: 'word-stagger', body: 'fade', media: 'preview-swap', scroll: 'sticky' });
    set('chapter', { heading: 'line-mask', body: 'rise', media: 'drift', scroll: 'sticky' });
    set('gallery', { heading: 'rise', body: 'fade', media: 'wipe', scroll: 'progress' });
    set('details', { heading: 'rise', body: 'fade', media: 'none', scroll: 'none' });
    set('invitation', { heading: 'line-mask', body: 'rise', media: 'none', scroll: 'none' });
    return base;
  }

  if (direction === 'image_mask') {
    set('arrival', { heading: 'rise', media: 'wipe', scroll: 'progress' });
    set('narrative', { heading: 'word-stagger', media: 'wipe', scroll: 'progress' });
    set('sequence', { heading: 'rise', media: 'wipe', scroll: 'drift' });
    set('register', { heading: 'rise', media: 'preview-swap', scroll: 'sticky' });
    set('chapter', { heading: 'word-stagger', media: 'wipe', scroll: 'progress' });
    set('gallery', { heading: 'rise', media: 'wipe', scroll: 'progress' });
    return base;
  }

  if (direction === 'editorial_transition') {
    set('arrival', { heading: 'line-mask', media: 'wipe', scroll: 'progress' });
    set('narrative', { heading: 'word-stagger', body: 'rise', media: 'wipe', scroll: 'progress' });
    set('sequence', { heading: 'word-stagger', media: 'wipe', scroll: 'drift' });
    set('register', { heading: 'word-stagger', media: 'preview-swap', scroll: 'sticky' });
    set('chapter', { heading: 'line-mask', media: 'drift', scroll: 'progress' });
    set('gallery', { heading: 'rise', media: 'wipe', scroll: 'progress' });
    return base;
  }

  if (direction === 'subtle_parallax') {
    set('arrival', { heading: 'rise', media: 'drift', scroll: 'progress' });
    set('narrative', { heading: 'word-stagger', media: 'drift', scroll: 'drift' });
    set('sequence', { heading: 'rise', media: 'drift', scroll: 'drift' });
    set('chapter', { heading: 'word-stagger', media: 'drift', scroll: 'drift' });
    set('gallery', { heading: 'rise', media: 'drift', scroll: 'drift' });
    return base;
  }

  if (direction === 'hover_choreography') {
    set('arrival', { heading: 'fade', media: 'none', scroll: 'none' });
    set('narrative', { heading: 'rise', media: 'none', scroll: 'none' });
    set('sequence', { heading: 'rise', media: 'none', scroll: 'none' });
    set('register', { heading: 'rise', media: 'preview-swap', scroll: 'none' });
    set('gallery', { heading: 'rise', media: 'none', scroll: 'none' });
    return base;
  }

  if (direction === 'responsive_navigation') {
    set('arrival', { heading: 'fade', media: 'none', scroll: 'none' });
    set('narrative', { heading: 'fade', media: 'none', scroll: 'none' });
    set('sequence', { heading: 'fade', media: 'none', scroll: 'none' });
    return base;
  }

  // refined_reveal: one quiet entrance, then stillness.
  return base;
}

const durationFor = (direction: MotionDirection): number => {
  if (direction === 'cinematic_sequence') return 760;
  if (direction === 'image_mask') return 620;
  if (direction === 'editorial_transition') return 640;
  if (direction === 'subtle_parallax') return 0;
  if (direction === 'hover_choreography') return 280;
  if (direction === 'responsive_navigation') return 300;
  return 420;
};

const staggerFor = (direction: MotionDirection): number => {
  if (direction === 'cinematic_sequence') return 90;
  if (direction === 'editorial_transition') return 70;
  if (direction === 'hover_choreography' || direction === 'subtle_parallax') return 0;
  return 60;
};

const distanceFor = (direction: MotionDirection): number => {
  if (direction === 'cinematic_sequence' || direction === 'subtle_parallax') return 28;
  if (direction === 'hover_choreography') return 4;
  if (direction === 'editorial_transition') return 18;
  return 12;
};

export function buildArtDirection(family: CompositionFamily, direction: MotionDirection): BlueprintArtDirection {
  const meta = MOTION_META[direction];
  const pageTransition: BlueprintMotionPlan['pageTransition'] =
    direction === 'cinematic_sequence' || direction === 'editorial_transition' || direction === 'image_mask'
      ? 'veil'
      : direction === 'refined_reveal'
        ? 'settle'
        : 'none';

  return {
    layout: {
      density: familyDensity(family),
      sectionSpacing: familySpacing(family),
      mediaRhythm: familyMediaRhythm(family),
      indexMode: indexModeFor(family),
      sequenceMode: sequenceModeFor(family),
      sectionTransition: familyTransition(family),
    },
    motion: {
      engine: 'native-css-io-raf/1',
      pageTransition,
      durationMs: durationFor(direction),
      easing: easingFor(direction),
      staggerMs: staggerFor(direction),
      distancePx: distanceFor(direction),
      scenes: scenesFor(direction, family),
      reducedMotion: 'static',
      note: `${meta.label}: ${meta.idea} Runtime: ${durationFor(direction)}ms, ${easingFor(direction)} easing, ${staggerFor(direction)}ms stagger. ${meta.reducedMotion}`,
    },
    imageTreatment: familyTreatment(family),
    note: `Density ${familyDensity(family)}; spacing ${familySpacing(family)}; ${familyMediaRhythm(family)} media rhythm; ${indexModeFor(family)} register; ${sequenceModeFor(family)} sequence.`,
  };
}

export const SECTION_SCENES: Record<SectionKind, MotionSceneKind> = {
  hero: 'arrival',
  statement: 'narrative',
  sequence: 'sequence',
  index: 'register',
  chapter: 'chapter',
  process: 'narrative',
  gallery: 'gallery',
  details: 'details',
  cta: 'invitation',
};

export function sceneForSection(kind: SectionKind): MotionSceneKind {
  return SECTION_SCENES[kind];
}

export function motionSceneFor(plan: BlueprintMotionPlan, kind: SectionKind): MotionScene {
  const scene = sceneForSection(kind);
  return plan.scenes.find((entry) => entry.scene === scene) ?? baseScene(scene);
}

/**
 * Validation shared by the builder and the save gate. The schema proves the enums; this proves the
 * plan is complete and bounded: every scene is present, nothing animates for longer than 900ms, and
 * the scroll displacement cannot become a scroll-jack.
 */
export function artDirectionProblems(plan: BlueprintArtDirection | undefined): string[] {
  if (!plan) return ['The blueprint has no executable art-direction plan.'];
  const problems: string[] = [];
  if (plan.motion.engine !== 'native-css-io-raf/1') problems.push('The motion engine is not the supported native engine.');
  if (plan.motion.durationMs < 0 || plan.motion.durationMs > 900) problems.push('Motion longer than 900ms delays the content.');
  if (plan.motion.staggerMs < 0 || plan.motion.staggerMs > 140) problems.push('A stagger above 140ms makes the page feel slow.');
  if (plan.motion.distancePx < 0 || plan.motion.distancePx > 40) problems.push('Scroll displacement above 40px is not subtle.');
  if (plan.motion.reducedMotion !== 'static') problems.push('The motion plan needs a complete static reduced-motion alternative.');
  for (const scene of MOTION_SCENES) {
    if (!plan.motion.scenes.some((entry) => entry.scene === scene)) problems.push(`The motion plan is missing the “${scene}” scene.`);
  }
  const seen = new Set<MotionSceneKind>();
  for (const entry of plan.motion.scenes) {
    if (seen.has(entry.scene)) problems.push(`The “${entry.scene}” scene appears twice.`);
    seen.add(entry.scene);
    if (!MOTION_EFFECTS.includes(entry.heading)) problems.push(`Unknown heading effect “${entry.heading}”.`);
    if (!MOTION_EFFECTS.includes(entry.body)) problems.push(`Unknown body effect “${entry.body}”.`);
    if (!MOTION_EFFECTS.includes(entry.media)) problems.push(`Unknown media effect “${entry.media}”.`);
    if (!SCROLL_BEHAVIOURS.includes(entry.scroll)) problems.push(`Unknown scroll behaviour “${entry.scroll}”.`);
  }
  return problems;
}
