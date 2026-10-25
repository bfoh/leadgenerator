'use client';

/*
 * This hook is the imperative boundary between React and the browser's animation primitives. It
 * intentionally writes data attributes and custom properties on the DOM node owned by the renderer;
 * that is the implemented motion layer, not a mutation of component state or props.
 */
/* eslint-disable react-hooks/immutability */

import { useEffect, type RefObject } from 'react';
import { MOTION_EASING, type BlueprintArtDirection } from '@/lib/domain/website-art-direction';

const SCROLL_SCENES = new Set(['progress', 'drift', 'sticky']);

/**
 * The executable motion layer.
 *
 * The blueprint chooses a scene recipe; this hook turns it into observed browser behaviour:
 * IntersectionObserver marks a scene as entered, and one rAF-throttled passive scroll listener writes
 * a bounded `--scene-progress` / `--scene-y` pair for scenes that request progression. CSS owns the
 * actual properties (opacity, transform, clip-path); no generated JavaScript is evaluated.
 *
 * The effect is page-scoped. Navigation tears down the observer and listeners, clears every inline
 * custom property, and re-initialises against the new DOM. `prefers-reduced-motion` disposes the whole
 * layer and exposes the static composition.
 */
export function useWebsiteMotion(
  root: RefObject<HTMLDivElement | null>,
  pageSlug: string,
  artDirection: BlueprintArtDirection,
) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dispose: (() => void) | null = null;

    const reset = () => {
      const sections = Array.from(element.querySelectorAll<HTMLElement>('[data-motion-scene]'));
      for (const section of sections) {
        delete section.dataset.inview;
        section.style.removeProperty('--scene-progress');
        section.style.removeProperty('--scene-y');
      }
      delete element.dataset.motion;
      delete element.dataset.motionEngine;
      delete element.dataset.pageMotion;
    };

    const start = () => {
      if (dispose) return;
      element.dataset.motion = 'ready';
      element.dataset.motionEngine = artDirection.motion.engine;
      element.dataset.pageMotion = artDirection.motion.pageTransition;
      element.style.setProperty('--scene-duration', `${artDirection.motion.durationMs}ms`);
      element.style.setProperty('--scene-stagger', `${artDirection.motion.staggerMs}ms`);
      element.style.setProperty('--scene-distance', `${artDirection.motion.distancePx}px`);
      element.style.setProperty('--scene-ease', MOTION_EASING[artDirection.motion.easing]);

      const sections = Array.from(element.querySelectorAll<HTMLElement>('[data-motion-scene]'));
      for (const section of sections) {
        delete section.dataset.inview;
        section.style.removeProperty('--scene-progress');
        section.style.removeProperty('--scene-y');
      }

      const scrollSections = sections.filter((section) => SCROLL_SCENES.has(section.dataset.motionScroll ?? ''));

      let observer: IntersectionObserver | null = null;
      if (typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              (entry.target as HTMLElement).dataset.inview = '';
              observer?.unobserve(entry.target);
            }
          },
          { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
        );
        for (const section of sections) observer.observe(section);
      } else {
        for (const section of sections) section.dataset.inview = '';
      }

      let frame = 0;
      const update = () => {
        frame = 0;
        const viewport = window.innerHeight || 1;
        const measurements: { section: HTMLElement; progress: number; y: number }[] = [];
        for (const section of scrollSections) {
          const rect = section.getBoundingClientRect();
          if (rect.bottom < -120 || rect.top > viewport + 120) continue;
          const total = Math.max(1, rect.height + viewport);
          const progress = Math.min(1, Math.max(0, (viewport - rect.top) / total));
          measurements.push({
            section,
            progress,
            y: (progress - 0.5) * 2 * artDirection.motion.distancePx,
          });
        }
        // Read all geometry first, then write, so the loop does not interleave layout reads and writes.
        for (const measurement of measurements) {
          measurement.section.style.setProperty('--scene-progress', measurement.progress.toFixed(3));
          measurement.section.style.setProperty('--scene-y', `${measurement.y.toFixed(2)}px`);
        }
      };
      const onScroll = () => {
        if (!frame) frame = requestAnimationFrame(update);
      };

      if (scrollSections.length) {
        update();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll, { passive: true });
      }

      dispose = () => {
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        observer?.disconnect();
        for (const section of sections) {
          delete section.dataset.inview;
          section.style.removeProperty('--scene-progress');
          section.style.removeProperty('--scene-y');
        }
        element.style.removeProperty('--scene-duration');
        element.style.removeProperty('--scene-stagger');
        element.style.removeProperty('--scene-distance');
        element.style.removeProperty('--scene-ease');
        delete element.dataset.motion;
        delete element.dataset.motionEngine;
        delete element.dataset.pageMotion;
        dispose = null;
      };
    };

    const onPreferenceChange = () => {
      if (reduced.matches) {
        dispose?.();
        reset();
        element.dataset.motion = 'static';
      } else {
        delete element.dataset.motion;
        start();
      }
    };

    if (reduced.matches) {
      element.setAttribute('data-motion', 'static');
    } else {
      start();
    }
    reduced.addEventListener('change', onPreferenceChange);

    return () => {
      reduced.removeEventListener('change', onPreferenceChange);
      dispose?.();
      reset();
    };
    // pageSlug is deliberate: navigation must rebuild the observed set against the new DOM.
  }, [artDirection, pageSlug, root]);
}
