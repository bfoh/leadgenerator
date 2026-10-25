'use client';

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { tokensAsCssVariables } from '@/lib/domain/design-tokens';
import type { BlueprintMediaSource } from '@/lib/domain/website-compositions';
import type { BlueprintAsset, WebsiteBlueprint } from '@/lib/domain/website-blueprint';
import { blueprintPage } from '@/lib/domain/website-navigation';
import { ConceptDisclosure, PrototypeDialog, SiteFooter, SiteNavigation } from './website-shell';
import { SectionView } from './website-sections';
import { useWebsiteMotion } from './website-motion';
import styles from './website.module.css';
import cinematic from './cinematic.module.css';
import { artDirectionFor, type PrototypeNotice, type WebsiteRenderContext } from './types';

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
  const artDirection = useMemo(() => artDirectionFor(blueprint), [blueprint]);
  useWebsiteMotion(root, page.slug, artDirection);
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

  return (
    <div
      ref={root}
      className={`${styles.site} ${artDirection.layout.surfaceStyle ? cinematic.experience : ''} ${embedded ? styles.embedded : ''} ${className}`.trim()}
      style={vars}
      data-family={blueprint.direction.compositionFamily}
      data-nav={blueprint.navigation.style}
      data-motion-mode={blueprint.direction.motionDirection}
      data-density={artDirection.layout.density}
      data-surface-style={artDirection.layout.surfaceStyle}
      data-media-rhythm={artDirection.layout.mediaRhythm}
      data-index-mode={artDirection.layout.indexMode}
      data-sequence-mode={artDirection.layout.sequenceMode}
      data-section-transition={artDirection.layout.sectionTransition}
      data-image-treatment={artDirection.imageTreatment}
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
          <div id="site-main" tabIndex={-1} className={styles.page} data-tone={page.tone} data-site-page={page.slug} key={page.slug}>
            {page.sections.map((section) => (
              <SectionView key={section.id} context={context} section={section} />
            ))}
          </div>
        ) : (
          <main id="site-main" tabIndex={-1} className={styles.page} data-tone={page.tone} data-site-page={page.slug} key={page.slug}>
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
