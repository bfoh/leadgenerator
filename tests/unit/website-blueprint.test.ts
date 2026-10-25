import { describe, expect, it } from 'vitest';
import { BUNDLED_FONTS, resolveFontBinding } from '@/lib/domain/bundled-fonts';
import { buildShowcaseSite, listShowcaseSites, SHOWCASE_SLUGS } from '@/lib/domain/showcase-sites';
import {
  blueprintAssetIds,
  blueprintProblems,
  compareBlueprints,
  parseWebsiteBlueprint,
  pageHref,
  type WebsiteBlueprint,
} from '@/lib/domain/website-blueprint';

// The website blueprint is the renderer's whole world. These tests use the three flagship
// demonstrations to prove that it is schema-valid, bound to the approved direction and kit, limited to
// prototype-cleared assets, free of external actions, and structurally different from site to site.

const sites = SHOWCASE_SLUGS.map((slug) => buildShowcaseSite(slug)!);

function textOf(blueprint: WebsiteBlueprint): string {
  return JSON.stringify(blueprint.pages).toLowerCase();
}

describe('the website blueprint engine', () => {
  it('builds all three sites from a real demonstration direction', () => {
    expect(sites).toHaveLength(3);
    expect(sites.map((site) => site.slug)).toEqual(['nsroma-atelier', 'adwoas-house', 'bantama-design-office']);
    expect(sites.map((site) => site.conceptKey)).toEqual(['archive', 'arrival', 'offaxis']);
    expect(new Set(sites.map((site) => site.blueprint.direction.compositionFamily)).size).toBe(3);
    expect(new Set(sites.map((site) => site.blueprint.typography.display.requestedFontId)).size).toBe(3);
    expect(sites.every((site) => site.blueprint.pages.length >= 5)).toBe(true);
  });

  it('validates shape, pages, navigation, actions and disclosures', () => {
    for (const site of sites) {
      expect(() => parseWebsiteBlueprint(site.blueprint)).not.toThrow();
      expect(blueprintProblems(site.blueprint, site.media.map((entry) => entry.assetId))).toEqual([]);
      expect(site.blueprint.format).toBe('dof-website-blueprint/1');
      expect(site.blueprint.pages[0].slug).toBe('home');
      expect(site.blueprint.readiness.previewReady).toBe(true);
      expect(site.blueprint.readiness.publishReady).toBe(false);
      expect(site.blueprint.disclosures[0].label).toBe('Concept Website — Not an Official Business Website');
      const slugs = new Set(site.blueprint.pages.map((page) => page.slug));
      for (const item of site.blueprint.navigation.items) expect(slugs.has(item.pageSlug), `${site.slug}: ${item.pageSlug}`).toBe(true);
      for (const page of site.blueprint.pages) {
        const actions = page.sections.flatMap((section) => [
          'primary' in section ? section.primary : undefined,
          'secondary' in section ? section.secondary : undefined,
          section.kind === 'details' ? section.action : undefined,
        ]);
        for (const action of actions.filter(Boolean)) {
          expect(action!.kind).toMatch(/^(page|anchor|prototype)$/);
          if (action!.kind === 'page') expect(slugs.has(action!.target), `${site.slug}: ${action!.target}`).toBe(true);
        }
      }
      expect(pageHref('/showcase/nsroma-atelier', 'home')).toBe('/showcase/nsroma-atelier');
      expect(pageHref('/showcase/nsroma-atelier', 'commissions')).toBe('/showcase/nsroma-atelier/commissions');
    }
  });

  it('binds every page to the approved direction, concept and Brand Kit version', () => {
    for (const site of sites) {
      const blueprint = site.blueprint;
      expect(blueprint.direction.directionVersion).toBe(1);
      expect(blueprint.direction.conceptName).toBe(site.conceptName);
      expect(blueprint.brandKit.version).toBe(1);
      expect(blueprint.direction.briefVersion).toBe(1);
      expect(blueprint.studio.projectId).toBeTruthy();
      expect(blueprint.identity.synthetic).toBe(true);
    }
  });

  it('renders only approved, prototype-permitted media with a licence record', () => {
    for (const site of sites) {
      expect(site.blueprint.assets.length).toBeGreaterThanOrEqual(5);
      for (const asset of site.blueprint.assets) {
        expect(asset.permission).toBe('prototype');
        expect(asset.licence.name.length).toBeGreaterThan(2);
        expect(asset.alt.length).toBeGreaterThan(10);
        expect(asset.sourcePath.startsWith('/showcase/')).toBe(true);
      }
      expect(new Set(blueprintAssetIds(site.blueprint)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('does not express an external link or an executable payload', () => {
    for (const site of sites) {
      const serialised = JSON.stringify(site.blueprint);
      expect(serialised).not.toContain('javascript:');
      expect(serialised).not.toContain('<script');
      expect(serialised).not.toContain('onclick');
      for (const page of site.blueprint.pages) {
        for (const section of page.sections) {
          if ('primary' in section) expect(section.primary?.kind).not.toBe('external');
          if ('secondary' in section) expect(section.secondary?.kind).not.toBe('external');
          if (section.kind === 'details') expect(section.action?.kind).not.toBe('external');
        }
      }
    }
  });

  it('uses different section grammar on each home page', () => {
    const signatures = sites.map((site) => site.blueprint.pages[0].sections.map((section) => `${section.kind}:${section.variant}`).join('|'));
    expect(new Set(signatures).size).toBe(3);
    for (const signature of signatures) {
      expect(signature.split('|').length).toBeGreaterThanOrEqual(6);
    }
    const allKinds = new Set(sites.flatMap((site) => site.blueprint.pages.flatMap((page) => page.sections.map((section) => section.kind))));
    expect(allKinds.size).toBeGreaterThanOrEqual(8);
  });

  it('keeps missing commercial facts visible and invented marketing claims out', () => {
    for (const site of sites) {
      const text = textOf(site.blueprint);
      expect(text).not.toContain('award-winning');
      expect(text).not.toContain('five-star');
      expect(text).not.toContain('money-back guarantee');
      expect(text).not.toContain('best in ghana');
      expect(site.blueprint.missingInformation.length).toBeGreaterThan(0);
    }
    expect(textOf(sites[0].blueprint)).toContain('to be confirmed');
    expect(textOf(sites[1].blueprint)).toContain('not published');
    expect(textOf(sites[2].blueprint)).toContain('not built');
  });

  it('is deterministic and comparable across versions', () => {
    const a = buildShowcaseSite('nsroma-atelier')!.blueprint;
    const b = buildShowcaseSite('nsroma-atelier')!.blueprint;
    expect(a).toEqual(b);
    const changed = structuredClone(a);
    changed.pages = changed.pages.slice(0, -1);
    changed.typography.body.requestedFontId = 'public-sans';
    const comparison = compareBlueprints(a, changed);
    expect(comparison.pageCountDelta).toBe(-1);
    expect(comparison.typographyChanged).toBe(true);
    expect(comparison.changedPages).toContain('contact');
  });

  it('refuses an asset that is absent from the blueprint and a public-readiness claim', () => {
    const broken = structuredClone(sites[0].blueprint);
    broken.assets = [];
    expect(blueprintProblems(broken).some((problem) => problem.includes('not in the blueprint'))).toBe(true);
    const unsafe = structuredClone(sites[0].blueprint) as unknown as { readiness: { publishReady: boolean } };
    unsafe.readiness.publishReady = true;
    expect(blueprintProblems(unsafe as unknown as WebsiteBlueprint).some((problem) => problem.includes('publish readiness'))).toBe(true);
  });

  it('lists the flagship metadata without leaking the full blueprint', () => {
    const list = listShowcaseSites();
    expect(list.map((entry) => entry.slug)).toEqual(['nsroma-atelier', 'adwoas-house', 'bantama-design-office']);
    expect(list.every((entry) => entry.pageCount >= 5 && entry.assetCount >= 5)).toBe(true);
    expect(list[0]).not.toHaveProperty('blueprint');
  });
});

describe('self-hosted font resolution', () => {
  it('resolves the six bundled OFL families to real WOFF2 files', () => {
    expect(Object.keys(BUNDLED_FONTS).sort()).toEqual(['archivo', 'fraunces', 'ibm-plex-sans', 'instrument-serif', 'inter', 'public-sans']);
    const fraunces = resolveFontBinding('fraunces');
    expect(fraunces.bundled).toBe(true);
    expect(fraunces.files[0].url).toMatch(/^\/showcase\/fonts\/fraunces\/.+\.woff2$/);
    expect(fraunces.licence.spdx).toBe('OFL-1.1');
    expect(fraunces.fallbackReason).toBeNull();
  });

  it('documents a category-appropriate fallback for a licensed but unbundled family', () => {
    const bodoni = resolveFontBinding('bodoni-moda');
    expect(bodoni.bundled).toBe(false);
    expect(bodoni.family).not.toBe('Bodoni Moda');
    expect(bodoni.stack).toMatch(/serif/i);
    expect(bodoni.fallbackReason).toContain('Bodoni Moda');
    expect(bodoni.fallbackReason).toContain('no WOFF2');
  });
});
