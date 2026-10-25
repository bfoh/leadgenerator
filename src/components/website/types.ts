import type { BlueprintMediaSource } from '@/lib/domain/website-compositions';
import type { BlueprintAction, BlueprintAsset, SiteTone, WebsiteBlueprint } from '@/lib/domain/website-blueprint';

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
