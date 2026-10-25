'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { tokensAsCssVariables } from '@/lib/domain/design-tokens';
import type { BlueprintMediaSource } from '@/lib/domain/website-compositions';
import { blueprintPage, type BlueprintAsset, type WebsiteBlueprint } from '@/lib/domain/website-blueprint';
import { ConceptDisclosure, PrototypeDialog, SiteFooter, SiteNavigation } from './website-shell';
import { SectionView } from './website-sections';
import styles from './website.module.css';
import type { PrototypeNotice, WebsiteRenderContext } from './types';

export interface WebsiteRendererProps {
  blueprint: WebsiteBlueprint;
  pageSlug: string;
  media: BlueprintMediaSource[];
  /** Public base path for internal links; previews intercept those links instead of navigating. */
  basePath: string;
  embedded?: boolean;
  onNavigate?: (slug: string) => void;
  className?: string;
}

export function WebsiteRenderer({ blueprint, pageSlug, media, basePath, embedded = false, onNavigate, className = '' }: WebsiteRendererProps) {
  const root = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<PrototypeNotice | null>(null);
  const page = blueprintPage(blueprint, pageSlug);
  const mediaById = useMemo(() => new Map(media.map((item) => [item.assetId, item])), [media]);
  const assets = useMemo(() => new Map<string, BlueprintAsset>(blueprint.assets.map((asset) => [asset.id, asset])), [blueprint.assets]);
  const context: WebsiteRenderContext = useMemo(
    () => ({ blueprint, media: mediaById, assets, basePath, embedded, onNavigate, openNotice: setNotice }),
    [assets, basePath, blueprint, embedded, mediaById, onNavigate],
  );
  const vars = useMemo(() => {
    const tokens = tokensAsCssVariables(blueprint.tokens, {
      display: blueprint.typography.display.stack,
      body: blueprint.typography.body.stack,
    });
    return {
      ...tokens,
      '--site-max': `${blueprint.tokens.grid.maxWidthPx}px`,
      '--site-margin': `${blueprint.tokens.grid.marginPx.desktop}px`,
      '--site-margin-mobile': `${blueprint.tokens.grid.marginPx.mobile}px`,
      '--site-gutter': `${blueprint.tokens.grid.gutterPx}px`,
    } as CSSProperties;
  }, [blueprint]);
  const fontFiles = [...new Set([blueprint.typography.display.preload, blueprint.typography.body.preload].filter((url): url is string => Boolean(url)))];

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    element.dataset.motion = 'ready';
    const observed = Array.from(element.querySelectorAll<HTMLElement>('[data-reveal]'));
    observed.forEach((item) => item.removeAttribute('data-shown'));
    if (typeof IntersectionObserver !== 'function') {
      observed.forEach((item) => item.setAttribute('data-shown', ''));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-shown', '');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -8% 0px' },
    );
    const frame = requestAnimationFrame(() => observed.forEach((item) => observer.observe(item)));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [page.slug]);

  useEffect(() => {
    if (blueprint.direction.compositionFamily !== 'asymmetric_offset') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const element = root.current;
    if (!element) return;
    const layers = Array.from(element.querySelectorAll<HTMLElement>('[data-parallax]'));
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = window.innerHeight || 1;
      for (const layer of layers) {
        const rect = layer.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > height + 200) continue;
        const progress = (rect.top + Math.min(rect.height, height) / 2 - height / 2) / height;
        const offset = Math.max(-16, Math.min(16, progress * -20));
        layer.style.setProperty('--parallax-y', `${offset.toFixed(2)}px`);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      layers.forEach((layer) => layer.style.removeProperty('--parallax-y'));
    };
  }, [blueprint.direction.compositionFamily, page.slug]);

  return (
    <div
      ref={root}
      className={`${styles.site} ${embedded ? styles.embedded : ''} ${className}`.trim()}
      style={vars}
      data-family={blueprint.direction.compositionFamily}
      data-nav={blueprint.navigation.style}
      data-motion-mode={blueprint.direction.motionDirection}
      data-embedded={embedded || undefined}
    >
      {fontFiles.map((url) => (
        <link key={url} rel="preload" href={url} as="font" type="font/woff2" crossOrigin="anonymous" />
      ))}
      <a className={styles.skipLink} href="#site-main">Skip to main content</a>
      <ConceptDisclosure context={context} />
      <div className={styles.inner}>
        <SiteNavigation context={context} pageSlug={page.slug} />
        {embedded ? (
          <div id="site-main" tabIndex={-1} className={styles.page} data-tone={page.tone} key={page.slug}>
            {page.sections.map((section) => (
              <SectionView key={section.id} context={context} section={section} />
            ))}
          </div>
        ) : (
          <main id="site-main" tabIndex={-1} className={styles.page} data-tone={page.tone} key={page.slug}>
            {page.sections.map((section) => (
              <SectionView key={section.id} context={context} section={section} />
            ))}
          </main>
        )}
        <SiteFooter context={context} pageSlug={page.slug} />
      </div>
      <PrototypeDialog context={context} notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}
