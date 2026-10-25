import { MOTION_DIRECTIONS, type CompositionFamily, type MotionDirection } from '@/lib/domain/design-tokens';
import type { BlueprintMediaSource } from '@/lib/domain/website-compositions';
import {
  buildArtDirection,
  motionSceneFor,
  type BlueprintArtDirection,
} from '@/lib/domain/website-art-direction';
import type { BlueprintAction, BlueprintAsset, BlueprintSection, SiteTone, WebsiteBlueprint } from '@/lib/domain/website-blueprint';

export interface PrototypeNotice {
  title: string;
  body?: string;
}

export interface WebsiteRenderContext {
  blueprint: WebsiteBlueprint;
  media: Map<string, BlueprintMediaSource>;
  assets: Map<string, BlueprintAsset>;
  /** The public path of the site, used for internal links. */
  basePath: string;
  embedded: boolean;
  onNavigate?: (slug: string) => void;
  openNotice: (notice: PrototypeNotice) => void;
}

export function toneClass(tone: SiteTone | undefined): string {
  switch (tone) {
    case 'surface':
      return 'toneSurface';
    case 'ink':
      return 'toneInk';
    case 'accent':
      return 'toneAccent';
    case 'light':
      return 'toneLight';
    default:
      return 'toneGround';
  }
}

export function actionNote(action: BlueprintAction): string {
  return action.note ?? 'Prototype only. No enquiry is sent and no personal information is collected.';
}

/**
 * A saved version can predate the executable art-direction field. It is derived deterministically
 * from the same approved family and motion direction, so an old version still renders with a bounded
 * plan rather than silently losing its motion.
 */
export function artDirectionFor(blueprint: WebsiteBlueprint): BlueprintArtDirection {
  if (blueprint.artDirection) return blueprint.artDirection;
  const motion = MOTION_DIRECTIONS.includes(blueprint.direction.motionDirection as MotionDirection)
    ? (blueprint.direction.motionDirection as MotionDirection)
    : 'refined_reveal';
  return buildArtDirection(blueprint.direction.compositionFamily as CompositionFamily, motion);
}

/** The scene attributes consumed by CSS. No selector, style string or script crosses the boundary. */
export function motionAttributes(blueprint: WebsiteBlueprint, section: BlueprintSection): Record<string, string> {
  const scene = motionSceneFor(artDirectionFor(blueprint).motion, section.kind);
  const attributes: Record<string, string> = {
    'data-motion-scene': scene.scene,
    'data-motion-heading': scene.heading,
    'data-motion-body': scene.body,
    'data-motion-media': scene.media,
  };
  if (scene.scroll !== 'none') attributes['data-motion-scroll'] = scene.scroll;
  if (section.kind === 'sequence' && section.variant === 'scroll-story') attributes['data-motion-scroll'] = 'sticky';
  return attributes;
}
