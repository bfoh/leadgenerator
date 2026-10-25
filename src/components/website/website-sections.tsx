'use client';

import Link from 'next/link';
import { pageHref, type BlueprintAction, type BlueprintSection, type MediaPlate } from '@/lib/domain/website-blueprint';
import styles from './website.module.css';
import { SiteAction } from './website-shell';
import { toneClass, type WebsiteRenderContext } from './types';

function SectionShell({
  section,
  children,
  className = '',
  reveal = true,
}: {
  section: BlueprintSection;
  children: React.ReactNode;
  className?: string;
  reveal?: boolean;
}) {
  return (
    <section
      id={section.id}
      className={`${styles.section} ${styles[toneClass(section.tone)]} ${className}`.trim()}
      data-kind={section.kind}
      data-variant={section.variant}
      data-reveal={reveal || undefined}
    >
      {children}
    </section>
  );
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`${styles.eyebrow} ${className}`.trim()}>{children}</p>;
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className={styles.sectionNote}>
      <span>Concept note</span>
      {children}
    </p>
  );
}

export function ImagePlate({
  context,
  plate,
  priority = false,
  parallax = false,
  bare = false,
}: {
  context: WebsiteRenderContext;
  plate: MediaPlate;
  priority?: boolean;
  parallax?: boolean;
  bare?: boolean;
}) {
  const asset = context.assets.get(plate.assetId);
  const source = context.media.get(plate.assetId);
  const caption = plate.caption ?? asset?.caption ?? undefined;
  const credit = plate.credit ?? asset?.credit ?? undefined;
  const missing = plate.placeholder || !source;
  return (
    <figure
      className={`${styles.plate} ${bare ? styles.plateBare : ''}`}
      data-span={plate.span}
      data-motion={context.blueprint.direction.motionDirection}
      data-parallax={parallax || undefined}
    >
      <div className={styles.mediaFrame}>
        {!missing && source ? (
          // The renderer deliberately uses a native image for signed and local sources alike.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={source.src}
            alt={source.alt || asset?.alt || ''}
            width={source.width}
            height={source.height}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
          />
        ) : (
          <div className={styles.imagePending} role="img" aria-label={asset?.alt ?? 'Approved photography pending'}>
            <span>Image pending</span>
            <small>Approved photography not supplied</small>
          </div>
        )}
      </div>
      {!bare && (caption || credit || plate.index) && (
        <figcaption className={styles.caption}>
          {plate.index && <span className={styles.plateIndex}>{plate.index}</span>}
          <span>{caption}</span>
          {credit && <span className={styles.credit}>{credit}</span>}
        </figcaption>
      )}
    </figure>
  );
}

function Actions({ context, primary, secondary }: { context: WebsiteRenderContext; primary?: BlueprintAction; secondary?: BlueprintAction }) {
  if (!primary && !secondary) return null;
  return (
    <div className={styles.actions}>
      {primary && <SiteAction action={primary} context={context} look="primary" />}
      {secondary && <SiteAction action={secondary} context={context} look="inline" />}
    </div>
  );
}

function Hero({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'hero' }> }) {
  return (
    <SectionShell section={section} className={styles.hero} reveal={false}>
      {section.assetId && (
        <div className={styles.heroMedia} aria-hidden={section.variant === 'cinematic-frame' ? true : undefined}>
          <ImagePlate
            context={context}
            plate={{ assetId: section.assetId, span: 'full' }}
            priority
            parallax={context.blueprint.direction.compositionFamily === 'asymmetric_offset'}
            bare
          />
        </div>
      )}
      <div className={styles.heroInner}>
        <div className={styles.heroCopy}>
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h1 className={styles.heroLines} aria-label={section.lines.join(' ')}>
            {section.lines.map((line, index) => (
              <span key={`${line}-${index}`} aria-hidden="true">{line}</span>
            ))}
          </h1>
          <p className={styles.heroLead}>{section.lead}</p>
          <Actions context={context} primary={section.primary} secondary={section.secondary} />
        </div>
        <dl className={styles.heroMeta}>
          {section.meta.map((item) => (
            <div key={`${item.label}-${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
          <div>
            <dt>Status</dt>
            <dd>Concept website</dd>
          </div>
        </dl>
      </div>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Statement({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'statement' }> }) {
  return (
    <SectionShell section={section} className={styles.statement}>
      <div className={styles.statementInner}>
        <div className={styles.statementCopy}>
          <Eyebrow>{section.label}</Eyebrow>
          {section.title && <h2 className={styles.statementTitle}>{section.title}</h2>}
          <div className={styles.prose}>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 48)}>{paragraph}</p>
            ))}
          </div>
        </div>
        {section.aside && (
          <aside className={styles.marginNote}>
            <span>Margin note</span>
            {section.aside}
          </aside>
        )}
      </div>
      {section.assetId && (
        <div className={styles.statementMedia}>
          <ImagePlate context={context} plate={{ assetId: section.assetId, span: 'wide' }} />
        </div>
      )}
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Sequence({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'sequence' }> }) {
  return (
    <SectionShell section={section} className={styles.sequence}>
      <div className={styles.sectionHead}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          {section.title && <h2>{section.title}</h2>}
        </div>
        <span className={styles.count}>{String(section.items.length).padStart(2, '0')} plates</span>
      </div>
      <div className={styles.sequenceGrid}>
        {section.items.map((item, index) => (
          <ImagePlate
            key={`${item.assetId}-${index}`}
            context={context}
            plate={item}
            priority={index === 0}
            parallax={context.blueprint.direction.compositionFamily === 'asymmetric_offset' && index === 1}
          />
        ))}
      </div>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function IndexSectionView({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'index' }> }) {
  return (
    <SectionShell section={section} className={styles.indexSection}>
      <div className={styles.sectionHead}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          <h2>{section.title}</h2>
          {section.description && <p className={styles.headDescription}>{section.description}</p>}
        </div>
        {section.countLabel && <span className={styles.count}>{section.countLabel}</span>}
      </div>
      <ol className={styles.indexList}>
        {section.entries.map((entry) => (
          <li key={`${entry.number}-${entry.title}`} className={styles.indexRow}>
            <span className={styles.indexNumber}>{entry.number}</span>
            <div className={styles.indexBody}>
              {entry.tag && <span className={styles.tag}>{entry.tag}</span>}
              <h3>
                {entry.pageSlug ? (
                  <Link
                    href={pageHref(context.basePath, entry.pageSlug)}
                    onClick={(event) => {
                      if (context.onNavigate) {
                        event.preventDefault();
                        context.onNavigate(entry.pageSlug!);
                      }
                    }}
                  >
                    {entry.title}
                  </Link>
                ) : (
                  entry.title
                )}
              </h3>
              <ul className={styles.indexMeta} aria-label="Entry metadata">
                {entry.meta.map((meta) => <li key={meta}>{meta}</li>)}
              </ul>
              {entry.summary && <p>{entry.summary}</p>}
            </div>
            {entry.assetId && (
              <div className={styles.indexThumb}>
                <ImagePlate context={context} plate={{ assetId: entry.assetId, span: 'portrait' }} bare />
              </div>
            )}
          </li>
        ))}
      </ol>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Chapter({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'chapter' }> }) {
  return (
    <SectionShell section={section} className={styles.chapter}>
      <div className={styles.chapterCopy}>
        <div className={styles.chapterHeading}>
          {section.number && <span className={styles.chapterNumber}>{section.number}</span>}
          <Eyebrow>{section.label}</Eyebrow>
        </div>
        <h2>{section.title}</h2>
        <div className={styles.prose}>
          {section.body.map((paragraph) => <p key={paragraph.slice(0, 48)}>{paragraph}</p>)}
        </div>
        {section.details && (
          <dl className={styles.inlineFacts}>
            {section.details.map((detail) => (
              <div key={`${detail.label}-${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {section.note && <SectionNote>{section.note}</SectionNote>}
      </div>
      {section.assetId && (
        <div className={styles.chapterMedia}>
          <ImagePlate context={context} plate={{ assetId: section.assetId, span: 'portrait' }} parallax />
        </div>
      )}
    </SectionShell>
  );
}

function Process({ section }: { section: Extract<BlueprintSection, { kind: 'process' }> }) {
  return (
    <SectionShell section={section} className={styles.process}>
      <div className={styles.sectionHead}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          <h2>{section.title}</h2>
        </div>
        <span className={styles.count}>{String(section.steps.length).padStart(2, '0')} moves</span>
      </div>
      <ol className={styles.processList}>
        {section.steps.map((step) => (
          <li key={step.number}>
            <span className={styles.stepNumber}>{step.number}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Gallery({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'gallery' }> }) {
  return (
    <SectionShell section={section} className={styles.gallery}>
      <div className={styles.sectionHead}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          {section.title && <h2>{section.title}</h2>}
        </div>
        <span className={styles.count}>{String(section.items.length).padStart(2, '0')} plates</span>
      </div>
      <div className={styles.galleryGrid}>
        {section.items.map((item, index) => (
          <ImagePlate key={`${item.assetId}-${index}`} context={context} plate={item} parallax={index === 1} />
        ))}
      </div>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Details({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'details' }> }) {
  return (
    <SectionShell section={section} className={styles.details}>
      <div className={styles.detailsHead}>
        <Eyebrow>{section.label}</Eyebrow>
        <h2>{section.title}</h2>
        {section.body && <p>{section.body}</p>}
      </div>
      <dl className={styles.detailsList}>
        {section.items.map((item) => (
          <div key={`${item.label}-${item.value}`} data-placeholder={item.placeholder || undefined}>
            <dt>{item.label}</dt>
            <dd>
              {item.value}
              {item.note && <span className={styles.detailNote}>{item.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {section.action && (
        <div className={styles.detailsAction}>
          <SiteAction action={section.action} context={context} look="primary" />
        </div>
      )}
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Cta({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'cta' }> }) {
  return (
    <SectionShell section={section} className={styles.cta}>
      <div className={styles.ctaInner}>
        <div>
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h2>{section.title}</h2>
        </div>
        <div className={styles.ctaBody}>
          <p>{section.body}</p>
          <Actions context={context} primary={section.primary} secondary={section.secondary} />
          {section.note && <p className={styles.ctaNote}>{section.note}</p>}
        </div>
      </div>
    </SectionShell>
  );
}

export function SectionView({ context, section }: { context: WebsiteRenderContext; section: BlueprintSection }) {
  switch (section.kind) {
    case 'hero':
      return <Hero context={context} section={section} />;
    case 'statement':
      return <Statement context={context} section={section} />;
    case 'sequence':
      return <Sequence context={context} section={section} />;
    case 'index':
      return <IndexSectionView context={context} section={section} />;
    case 'chapter':
      return <Chapter context={context} section={section} />;
    case 'process':
      return <Process section={section} />;
    case 'gallery':
      return <Gallery context={context} section={section} />;
    case 'details':
      return <Details context={context} section={section} />;
    case 'cta':
      return <Cta context={context} section={section} />;
  }
}
