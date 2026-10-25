import { describe, expect, it } from 'vitest';
import { buildArtDirection, artDirectionProblems, MOTION_SCENES, motionSceneFor } from '@/lib/domain/website-art-direction';
import { buildShowcaseSite, SHOWCASE_SLUGS } from '@/lib/domain/showcase-sites';
import { parseWebsiteBlueprint } from '@/lib/domain/website-blueprint';

// The art-direction plan is a contract, not a mood: it must be complete, bounded, deterministic and
// executable by the renderer. These tests protect the scene vocabulary and the backwards-compatible
// fallback for prototypes saved before 3C.4R.

const sites = SHOWCASE_SLUGS.map((slug) => buildShowcaseSite(slug)!);

describe('the executable art-direction plan', () => {
  it('gives every flagship blueprint a complete, valid scene plan', () => {
    for (const site of sites) {
      const plan = site.blueprint.artDirection;
      expect(plan, site.slug).toBeDefined();
      expect(plan!.motion.engine).toBe('native-css-io-raf/1');
      expect(plan!.motion.scenes).toHaveLength(MOTION_SCENES.length);
      expect(plan!.motion.durationMs).toBeLessThanOrEqual(900);
      expect(plan!.motion.distancePx).toBeLessThanOrEqual(40);
      expect(plan!.motion.reducedMotion).toBe('static');
      expect(artDirectionProblems(plan)).toEqual([]);
    }
  });

  it('maps every section kind to an implemented scene', () => {
    const plan = sites[1].blueprint.artDirection!;
    const kinds = sites.flatMap((site) => site.blueprint.pages.flatMap((page) => page.sections.map((section) => section.kind)));
    const used = new Set(kinds);
    for (const kind of used) {
      const scene = motionSceneFor(plan.motion, kind);
      expect(scene.scene).toBeTruthy();
      expect(scene.heading).toBeTruthy();
      expect(scene.media).toBeTruthy();
      expect(scene.scroll).toBeTruthy();
    }
  });

  it('chooses a different executable recipe for different approved motion directions', () => {
    const cinematic = buildArtDirection('cinematic_full_bleed', 'cinematic_sequence');
    const imageMask = buildArtDirection('editorial_columns', 'image_mask');
    const refined = buildArtDirection('quiet_centered', 'refined_reveal');
    expect(cinematic.motion.scenes.find((scene) => scene.scene === 'arrival')?.heading).toBe('line-mask');
    expect(cinematic.layout.indexMode).toBe('sticky-preview');
    expect(imageMask.motion.scenes.find((scene) => scene.scene === 'sequence')?.media).toBe('wipe');
    expect(refined.motion.durationMs).toBe(420);
    expect(refined.motion.scenes.every((scene) => scene.scroll === 'none')).toBe(true);
    expect(new Set([cinematic.motion.easing, imageMask.motion.easing, refined.motion.easing]).size).toBeGreaterThan(1);
  });

  it('derives a deterministic plan for an older saved blueprint without one', () => {
    const legacy = structuredClone(sites[0].blueprint) as unknown as Record<string, unknown>;
    delete legacy.artDirection;
    const parsed = parseWebsiteBlueprint(legacy);
    expect(parsed.artDirection).toBeDefined();
    expect(artDirectionProblems(parsed.artDirection)).toEqual([]);
    const again = parseWebsiteBlueprint(legacy);
    expect(parsed.artDirection).toEqual(again.artDirection);
  });

  it('rejects a plan that is incomplete, slow or unbounded', () => {
    const broken = structuredClone(sites[0].blueprint.artDirection!);
    broken.motion.durationMs = 1600;
    broken.motion.distancePx = 100;
    broken.motion.scenes = broken.motion.scenes.slice(0, -1);
    const problems = artDirectionProblems(broken);
    expect(problems.some((problem) => problem.includes('900ms'))).toBe(true);
    expect(problems.some((problem) => problem.includes('40px'))).toBe(true);
    expect(problems.some((problem) => problem.includes('missing'))).toBe(true);
    expect(artDirectionProblems(undefined)).toEqual(['The blueprint has no executable art-direction plan.']);
  });

  it('keeps the motion plan deterministic across builds', () => {
    const a = buildShowcaseSite('adwoas-house')!.blueprint.artDirection;
    const b = buildShowcaseSite('adwoas-house')!.blueprint.artDirection;
    expect(a).toEqual(b);
  });

  // The visual audit found repeated photography inside a page, which reads as padding rather than
  // art direction. A page may reuse an image across pages; it may not reuse one within itself.
  // Adwoa's House is the site rebuilt in 3C.4R; Nsroma and Bantama still repeat plates on their home
  // pages and join this check when their rebuilds are approved.
  it('never repeats a photograph within one Adwoa’s House page', () => {
    for (const page of buildShowcaseSite('adwoas-house')!.blueprint.pages) {
        const plates = page.sections.flatMap((section) => {
          switch (section.kind) {
            case 'hero':
            case 'statement':
            case 'chapter':
              return section.assetId ? [section.assetId] : [];
            case 'sequence':
            case 'gallery':
              return section.items.map((item) => item.assetId);
            case 'index':
              return section.entries.map((entry) => entry.assetId);
            default:
              return [];
          }
        });
        expect(new Set(plates).size, `adwoas-house/${page.slug}: ${plates.join(', ')}`).toBe(plates.length);
      }
  });
});
