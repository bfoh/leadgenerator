'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { BlueprintAction, BlueprintSection, MediaPlate } from '@/lib/domain/website-blueprint';
import { pageHref } from '@/lib/domain/website-navigation';
import styles from './website.module.css';
import cinematic from './cinematic.module.css';
import { SiteAction } from './website-shell';
import { artDirectionFor, motionAttributes, toneClass, type WebsiteRenderContext } from './types';

const css = (name: string) => `${styles[name] ?? ''} ${cinematic[name] ?? ''}`.trim();

function SectionShell({
  context,
  section,
  children,
  className = '',
}: {
  context: WebsiteRenderContext;
  section: BlueprintSection;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={section.id}
      className={`${styles.section} ${styles[toneClass(section.tone)]} ${cinematic.composition} ${className}`.trim()}
      data-kind={section.kind}
      data-variant={section.variant}
      {...motionAttributes(context.blueprint, section)}
    >
      {children}
    </section>
  );
}

/**
 * Splits a heading into word masks without changing its accessible text. The masks are inline
 * elements inside the heading; assistive technology reads the same sentence, and selecting the text
 * still copies the original words.
 */
function Words({ text, className = '' }: { text: string; className?: string }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <span className={className}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className={css('wordMask')}>
            <span className={css('wordInner')} style={{ '--word-index': index } as CSSProperties}>{word}</span>
          </span>
          {index < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </span>
  );
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <p className={`${styles.eyebrow} ${className}`.trim()}>{children}</p>;
}

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className={css('sectionNote')}>
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
  sizes,
  mobileAssetId,
}: {
  context: WebsiteRenderContext;
  plate: MediaPlate;
  priority?: boolean;
  parallax?: boolean;
  bare?: boolean;
  sizes?: string;
  mobileAssetId?: string;
}) {
  const asset = context.assets.get(plate.assetId);
  const source = context.media.get(plate.assetId);
  const mobile = mobileAssetId ? context.media.get(mobileAssetId) : undefined;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const caption = plate.caption ?? asset?.caption ?? undefined;
  const credit = plate.credit ?? (asset?.sourceKind === 'synthetic_concept' ? undefined : asset?.credit ?? undefined);
  const missing = plate.placeholder || !source || failedSource === source.src;
  return (
    <figure
      className={`${styles.plate} ${bare ? styles.plateBare : ''}`}
      data-span={plate.span}
      data-focal={plate.focal}
      data-parallax={parallax || undefined}
    >
      <div className={css('mediaFrame')}>
        {!missing && source ? (
          <picture>
          {mobile?.avifSrcSet && <source media="(max-width: 767px)" type="image/avif" srcSet={mobile.avifSrcSet} sizes="100vw" />}
          {mobile && <source media="(max-width: 767px)" srcSet={mobile.srcSet ?? mobile.src} sizes="100vw" />}
          {source.avifSrcSet && <source type="image/avif" srcSet={source.avifSrcSet} sizes={sizes ?? source.sizes} />}
          {/* Native sources support both vault-signed URLs and local responsive concept images. */}
          <img
            ref={(node) => { if (node?.complete && node.naturalWidth === 0) setFailedSource(source.src); }}
            src={source.src}
            srcSet={source.srcSet}
            sizes={sizes ?? source.sizes}
            alt={source.alt || asset?.alt || ''}
            width={source.width}
            height={source.height}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'low'}
            decoding="async"
            onError={() => setFailedSource(source.src)}
          />
          </picture>
        ) : (
          <div className={css('imagePending')} role="img" aria-label={asset?.alt ?? 'Approved photography pending'}>
            <span>Image pending</span>
            <small>Approved photography not supplied</small>
          </div>
        )}
      </div>
      {!bare && (caption || credit || plate.index) && (
        <figcaption className={css('caption')}>
          {plate.index && <span className={css('plateIndex')}>{plate.index}</span>}
          <span>{caption}</span>
          {credit && <span className={css('credit')}>{credit}</span>}
        </figcaption>
      )}
    </figure>
  );
}

function Actions({ context, primary, secondary }: { context: WebsiteRenderContext; primary?: BlueprintAction; secondary?: BlueprintAction }) {
  if (!primary && !secondary) return null;
  return (
    <div className={css('actions')}>
      {primary && <SiteAction action={primary} context={context} look="primary" />}
      {secondary && <SiteAction action={secondary} context={context} look="inline" />}
    </div>
  );
}

function Hero({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'hero' }> }) {
  const immersive = section.variant === 'immersive-arrival' || section.variant === 'split-arrival';
  return (
    <SectionShell context={context} section={section} className={css('hero')}>
      {section.assetId && (
        <div className={css('heroMedia')} aria-hidden={section.variant === 'cinematic-frame' || immersive ? true : undefined}>
          <ImagePlate
            context={context}
            plate={{ assetId: section.assetId, span: 'full' }}
            priority
            parallax={context.blueprint.direction.compositionFamily === 'asymmetric_offset'}
            sizes="100vw"
            mobileAssetId={section.mobileAssetId}
            bare
          />
        </div>
      )}
      <div className={css('heroInner')}>
        <div className={css('heroCopy')}>
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h1 className={css('heroLines')} aria-label={section.lines.join(' ')}>
            {section.lines.map((line, index) => (
              <span className={css('heroLineMask')} key={`${line}-${index}`} aria-hidden="true">
                <span className={css('heroLineInner')} style={{ '--line-index': index } as CSSProperties}>{line}</span>
              </span>
            ))}
          </h1>
          <p className={css('heroLead')}>{section.lead}</p>
          <Actions context={context} primary={section.primary} secondary={section.secondary} />
        </div>
        <dl className={css('heroMeta')}>
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
      {immersive && <div className={cinematic.arrivalRail} aria-hidden="true"><span>Take your time. There is more to see.</span><span className={cinematic.scrollMark}>↓</span><span>{context.blueprint.identity.city} / Ghana</span></div>}
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Statement({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'statement' }> }) {
  return (
    <SectionShell context={context} section={section} className={css('statement')}>
      <div className={css('statementInner')}>
        <div className={css('statementCopy')}>
          <Eyebrow>{section.label}</Eyebrow>
          {section.title && (
            <h2 className={css('statementTitle')}>
              <Words text={section.title} />
            </h2>
          )}
          <div className={css('prose')}>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 48)}>{paragraph}</p>
            ))}
          </div>
        </div>
        {section.aside && (
          <aside className={css('marginNote')}>
            <span>Margin note</span>
            {section.aside}
          </aside>
        )}
      </div>
      {section.assetId && (
        <div className={css('statementMedia')}>
          <ImagePlate context={context} plate={{ assetId: section.assetId, span: 'wide' }} />
        </div>
      )}
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Sequence({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'sequence' }> }) {
  if (section.variant === 'scroll-story') return <ScrollStory context={context} section={section} />;
  return (
    <SectionShell context={context} section={section} className={css('sequence')}>
      <div className={css('sectionHead')}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          {section.title && (
            <h2>
              <Words text={section.title} />
            </h2>
          )}
        </div>
        <span className={css('count')}>{String(section.items.length).padStart(2, '0')} plates</span>
      </div>
      <div className={css('sequenceGrid')}>
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

/** Native document scrolling drives the masks. The in-flow images are the complete static fallback. */
function ScrollStory({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'sequence' }> }) {
  return (
    <SectionShell context={context} section={section} className={cinematic.story}>
      <div className={cinematic.storyHeader}>
        <Eyebrow>{section.label}</Eyebrow>
        {section.title && <h2>{section.title}</h2>}
        <a href={`#${section.id}-end`} className={cinematic.storySkip}>Skip the image story ↓</a>
      </div>
      <div className={cinematic.storyBody} data-story-body>
        <ol className={cinematic.storySteps}>
          {section.items.map((item, index) => (
            <li id={`${section.id}-step-${index + 1}`} key={`${item.assetId}-${index}`} className={cinematic.storyStep} data-story-step>
              <span className={cinematic.storyNumber}>{String(index + 1).padStart(2, '0')} <span>/ {String(section.items.length).padStart(2, '0')}</span></span>
              <h3>{item.title ?? item.caption ?? `Chapter ${index + 1}`}</h3>
              {item.body && <p>{item.body}</p>}
              <div className={cinematic.storyInline}><ImagePlate context={context} plate={item} sizes="(min-width: 64rem) 60vw, 100vw" /></div>
              <span className={cinematic.storyChapterLabel}>Keep wandering <span aria-hidden="true">↓</span></span>
            </li>
          ))}
        </ol>
        <div className={cinematic.storyStage} data-story-stage aria-hidden="true">
          <div className={cinematic.storyFrames}>
            {section.items.map((item, index) => (
              <div className={cinematic.storyFrame} key={`${item.assetId}-${index}`} data-story-frame={index}>
                <ImagePlate context={context} plate={item} sizes="60vw" bare />
              </div>
            ))}
          </div>
          <div className={cinematic.storyTrack}>{section.items.map((item, index) => <span key={`${item.assetId}-${index}`} data-story-marker={index}>{String(index + 1).padStart(2, '0')}<i /></span>)}</div>
          <span className={cinematic.storyCredit}>Concept imagery · Not the actual property</span>
        </div>
      </div>
      <div id={`${section.id}-end`} className={cinematic.storyEnd} tabIndex={-1}>{section.note && <SectionNote>{section.note}</SectionNote>}</div>
    </SectionShell>
  );
}

function IndexSectionView({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'index' }> }) {
  const plan = artDirectionFor(context.blueprint);
  const previewEntries = section.entries.filter((entry) => Boolean(entry.assetId));
  const interactive = plan.layout.indexMode === 'sticky-preview' && previewEntries.length > 1;
  const [activeAsset, setActiveAsset] = useState(0);
  const activate = (assetId: string | undefined) => {
    if (!interactive || !assetId) return;
    const index = previewEntries.findIndex((entry) => entry.assetId === assetId);
    if (index >= 0) setActiveAsset(index);
  };

  return (
    <SectionShell context={context} section={section} className={`${styles.indexSection} ${styles.indexSectionInteractive}`}>
      <div className={css('sectionHead')}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          <h2>
            <Words text={section.title} />
          </h2>
          {section.description && <p className={css('headDescription')}>{section.description}</p>}
        </div>
        {section.countLabel && <span className={css('count')}>{section.countLabel}</span>}
      </div>
      <div className={css('indexLayout')} data-index-mode={plan.layout.indexMode} data-interactive={interactive || undefined}>
        <ol className={css('indexList')}>
          {section.entries.map((entry) => (
            <li
              key={`${entry.number}-${entry.title}`}
              className={css('indexRow')}
              data-active={interactive && entry.assetId === previewEntries[activeAsset]?.assetId ? '' : undefined}
              onMouseEnter={() => activate(entry.assetId)}
              onFocus={() => activate(entry.assetId)}
            >
              <span className={css('indexNumber')}>{entry.number}</span>
              <div className={css('indexBody')}>
                {entry.tag && <span className={css('tag')}>{entry.tag}</span>}
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
                    interactive ? <button type="button" className={cinematic.roomSelect} aria-pressed={entry.assetId === previewEntries[activeAsset]?.assetId} onClick={() => activate(entry.assetId)}>{entry.title}<span aria-hidden="true"> ↗</span></button> : entry.title
                  )}
                </h3>
                <ul className={css('indexMeta')} aria-label="Entry metadata">
                  {entry.meta.map((meta) => <li key={meta}>{meta}</li>)}
                </ul>
                {entry.summary && <p>{entry.summary}</p>}
              </div>
              {entry.assetId && (
                <div className={css('indexThumb')}>
                  <ImagePlate context={context} plate={{ assetId: entry.assetId, span: 'portrait' }} sizes="6rem" bare />
                </div>
              )}
            </li>
          ))}
        </ol>
        {interactive && (
          <div className={css('indexPreview')} aria-hidden="true">
            {previewEntries.map((entry, index) => (
              <div
                className={css('indexPreviewFrame')}
                data-active={index === activeAsset || undefined}
                key={entry.assetId}
              >
                <ImagePlate context={context} plate={{ assetId: entry.assetId!, span: 'portrait' }} sizes="(min-width: 64rem) 34vw, 26vw" bare />
              </div>
            ))}
            <div className={css('indexPreviewMeta')}>
              <span>{previewEntries[activeAsset]?.number}</span>
              <span>{previewEntries[activeAsset]?.title}</span>
            </div>
          </div>
        )}
      </div>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Chapter({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'chapter' }> }) {
  return (
    <SectionShell context={context} section={section} className={css('chapter')}>
      <div className={css('chapterCopy')}>
        <div className={css('chapterHeading')}>
          {section.number && <span className={css('chapterNumber')}>{section.number}</span>}
          <Eyebrow>{section.label}</Eyebrow>
        </div>
        <h2>
          <Words text={section.title} />
        </h2>
        <div className={css('prose')}>
          {section.body.map((paragraph) => <p key={paragraph.slice(0, 48)}>{paragraph}</p>)}
        </div>
        {section.details && (
          <dl className={css('inlineFacts')}>
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
        <div className={css('chapterMedia')}>
          <ImagePlate context={context} plate={{ assetId: section.assetId, span: 'portrait' }} parallax />
        </div>
      )}
    </SectionShell>
  );
}

function Process({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'process' }> }) {
  return (
    <SectionShell context={context} section={section} className={css('process')}>
      <div className={css('sectionHead')}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          <h2>
            <Words text={section.title} />
          </h2>
        </div>
        <span className={css('count')}>{String(section.steps.length).padStart(2, '0')} moves</span>
      </div>
      <ol className={css('processList')}>
        {section.steps.map((step) => (
          <li key={step.number}>
            <span className={css('stepNumber')}>{step.number}</span>
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
  if (section.variant === 'editorial-gallery') return <EditorialGallery context={context} section={section} />;
  return (
    <SectionShell context={context} section={section} className={css('gallery')}>
      <div className={css('sectionHead')}>
        <div>
          <Eyebrow>{section.label}</Eyebrow>
          {section.title && (
            <h2>
              <Words text={section.title} />
            </h2>
          )}
        </div>
        <span className={css('count')}>{String(section.items.length).padStart(2, '0')} plates</span>
      </div>
      <div className={css('galleryGrid')}>
        {section.items.map((item, index) => (
          <ImagePlate key={`${item.assetId}-${index}`} context={context} plate={item} parallax={index === 1} />
        ))}
      </div>
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function EditorialGallery({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'gallery' }> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected !== null && !dialog.current?.open) dialog.current?.showModal();
    if (selected === null && dialog.current?.open) dialog.current.close();
  }, [selected]);
  const step = (direction: number) => setSelected((value) => value === null ? null : (value + direction + section.items.length) % section.items.length);
  return (
    <SectionShell context={context} section={section} className={cinematic.editorialGallery}>
      <div className={cinematic.galleryHead}><Eyebrow>{section.label}</Eyebrow>{section.title && <h2>{section.title}</h2>}<span>Select a photograph to look closer ↗</span></div>
      <div className={cinematic.galleryImages}>{section.items.map((item, index) => (
        <div key={`${item.assetId}-${index}`} className={cinematic.galleryItem}>
          <button type="button" className={cinematic.galleryOpen} onClick={() => setSelected(index)} aria-label={`Enlarge photograph ${index + 1}: ${item.title ?? item.caption ?? section.label}`}><ImagePlate context={context} plate={item} sizes="(min-width: 64rem) 48vw, 100vw" bare /><span aria-hidden="true">↗</span></button>
          <p><span>{String(index + 1).padStart(2, '0')}</span>{item.caption}</p>
        </div>
      ))}</div>
      {section.note && <SectionNote>{section.note}</SectionNote>}
      <dialog ref={dialog} className={cinematic.lightbox} aria-label={`${section.label} photographs`} onCancel={() => setSelected(null)} onClose={() => setSelected(null)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); } }} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        <div className={cinematic.lightboxTop}><span>Concept photography</span><button type="button" autoFocus onClick={() => setSelected(null)} aria-label="Close photographs">Close ×</button></div>
        {selected !== null && <ImagePlate context={context} plate={section.items[selected]} sizes="90vw" />}
        <div className={cinematic.lightboxControls}><button type="button" onClick={() => step(-1)} aria-label="Previous photograph">← Previous</button><span aria-live="polite">{(selected ?? 0) + 1} / {section.items.length}</span><button type="button" onClick={() => step(1)} aria-label="Next photograph">Next →</button></div>
      </dialog>
    </SectionShell>
  );
}

function Details({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'details' }> }) {
  return (
    <SectionShell context={context} section={section} className={css('details')}>
      <div className={css('detailsHead')}>
        <Eyebrow>{section.label}</Eyebrow>
        <h2>
          <Words text={section.title} />
        </h2>
        {section.body && <p>{section.body}</p>}
      </div>
      <dl className={css('detailsList')}>
        {section.items.map((item) => (
          <div key={`${item.label}-${item.value}`} data-placeholder={item.placeholder || undefined}>
            <dt>{item.label}</dt>
            <dd>
              {item.value}
              {item.note && <span className={css('detailNote')}>{item.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {section.action && (
        <div className={css('detailsAction')}>
          <SiteAction action={section.action} context={context} look="primary" />
        </div>
      )}
      {section.note && <SectionNote>{section.note}</SectionNote>}
    </SectionShell>
  );
}

function Cta({ context, section }: { context: WebsiteRenderContext; section: Extract<BlueprintSection, { kind: 'cta' }> }) {
  return (
    <SectionShell context={context} section={section} className={css('cta')}>
      {section.assetId && <div className={cinematic.invitationMedia} aria-hidden="true"><ImagePlate context={context} plate={{ assetId: section.assetId, span: 'wide' }} sizes="100vw" bare /></div>}
      <div className={css('ctaInner')}>
        <div>
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h2>
            <Words text={section.title} />
          </h2>
        </div>
        <div className={css('ctaBody')}>
          <p>{section.body}</p>
          <Actions context={context} primary={section.primary} secondary={section.secondary} />
          {section.note && <p className={css('ctaNote')}>{section.note}</p>}
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
      return <Process context={context} section={section} />;
    case 'gallery':
      return <Gallery context={context} section={section} />;
    case 'details':
      return <Details context={context} section={section} />;
    case 'cta':
      return <Cta context={context} section={section} />;
  }
}
