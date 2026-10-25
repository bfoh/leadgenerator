// Presentation helpers deliberately have no schema/runtime dependency. The blueprint is validated
// at the builder/service boundary; displaying an internal link must not ship Zod to every visitor.
import type { BlueprintPage, WebsiteBlueprint } from './website-blueprint';

export function pageHref(basePath: string, slug: string): string {
  const base = basePath.replace(/\/$/, '');
  return slug === 'home' ? base || '/' : `${base}/${slug}`;
}

export function blueprintPage(blueprint: WebsiteBlueprint, slug: string): BlueprintPage {
  return blueprint.pages.find((page) => page.slug === slug) ?? blueprint.pages[0];
}
