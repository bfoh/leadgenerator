import { describe, expect, it } from 'vitest';
import { buildShowcaseSite } from '@/lib/domain/showcase-sites';
import { blueprintProblems, parseWebsiteBlueprint, sectionAssetIds } from '@/lib/domain/website-blueprint';
import { buildWebsiteBlueprint } from '@/lib/domain/website-compositions';
import { CREATIVE_DEMOS, runCreativeDemo } from '@/lib/domain/creative-demos';
import { showcaseMedia } from '@/lib/domain/showcase-assets';

describe('cinematic composition contracts', () => {
  it('makes the new composition grammar available to an ordinary Studio build', () => {
    const demo = CREATIVE_DEMOS.find((item) => item.slug === 'adwoas-house')!;
    const { brief, direction } = runCreativeDemo(demo);
    const blueprint = buildWebsiteBlueprint({
      project: { id: demo.projectId, name: 'A different hospitality concept' }, business: demo.business,
      brief, direction: { id: 'ordinary-studio-direction', version: 1, content: direction }, conceptKey: 'arrival',
      kit: { versionId: demo.kitVersionId, version: 1 }, assets: [], roleAssets: {}, synthetic: false,
      generatedAt: '2026-10-25T00:00:00.000Z',
    });
    expect(blueprint.artDirection?.layout.surfaceStyle).toBe('paper-and-ink');
    expect(blueprint.pages[0].sections[0].variant).toBe('immersive-arrival');
    expect(blueprint.identity.synthetic).toBe(false);
    expect(blueprint.readiness.publishReady).toBe(false);
    expect(blueprint.direction.directionId).toBe('ordinary-studio-direction');
    expect(() => parseWebsiteBlueprint(blueprint)).not.toThrow();
  });

  it('includes portrait arrival and image-invitation assets in the permission gate', () => {
    const blueprint = structuredClone(buildShowcaseSite('adwoas-house')!.blueprint);
    const hero = blueprint.pages[0].sections[0];
    const cta = blueprint.pages[0].sections.at(-1)!;
    expect(hero.kind === 'hero' && hero.mobileAssetId).toBeTruthy();
    expect(sectionAssetIds(hero)).toContain('adwoa-v2-arrival-mobile');
    expect(sectionAssetIds(cta)).toContain('adwoa-v2-exterior-evening');
    blueprint.assets = blueprint.assets.filter((asset) => !['adwoa-v2-arrival-mobile', 'adwoa-v2-exterior-evening'].includes(asset.id));
    const problems = blueprintProblems(blueprint);
    expect(problems.some((problem) => problem.includes('adwoa-v2-arrival-mobile'))).toBe(true);
    expect(problems.some((problem) => problem.includes('adwoa-v2-exterior-evening'))).toBe(true);
  });

  it('preserves the synthetic source classification and bounded story copy through serialization', () => {
    const blueprint = buildShowcaseSite('adwoas-house')!.blueprint;
    const parsed = parseWebsiteBlueprint(JSON.parse(JSON.stringify(blueprint)));
    expect(parsed.assets.filter((asset) => asset.sourceKind === 'synthetic_concept')).toHaveLength(10);
    const story = parsed.pages[0].sections.find((section) => section.kind === 'sequence');
    expect(story?.kind === 'sequence' && story.items[0].title).toBe('Into the shade.');
    const invalid = structuredClone(parsed);
    const invalidStory = invalid.pages[0].sections.find((section) => section.kind === 'sequence');
    if (invalidStory?.kind === 'sequence') invalidStory.items[0].body = 'x'.repeat(401);
    expect(() => parseWebsiteBlueprint(invalid)).toThrow();
  });

  it('does not opt the other showcases into the new composition surface', () => {
    for (const slug of ['nsroma-atelier', 'bantama-design-office']) {
      expect(buildShowcaseSite(slug)!.blueprint.artDirection?.layout.surfaceStyle).toBeUndefined();
    }
  });

  it('keeps AVIF derivatives separate from their native fallback source sets', () => {
    const blueprint = buildShowcaseSite('adwoas-house')!.blueprint;
    const source = showcaseMedia(blueprint.assets).find((asset) => asset.assetId === 'adwoa-v2-arrival-mobile')!;
    expect(source.avifSrcSet).toContain('.avif 640w');
    expect(source.srcSet).toContain('.webp 640w');
    expect(source.srcSet).not.toContain('.avif');
    expect(source.avifSrcSet).not.toContain('.webp');
    expect(() => parseWebsiteBlueprint(blueprint)).not.toThrow();
  });
});
