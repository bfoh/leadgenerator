'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { BlueprintAction } from '@/lib/domain/website-blueprint';
import { pageHref } from '@/lib/domain/website-navigation';
import styles from './website.module.css';
import cinematic from './cinematic.module.css';
import { actionNote, type PrototypeNotice, type WebsiteRenderContext } from './types';

const css = (name: string) => `${styles[name] ?? ''} ${cinematic[name] ?? ''}`.trim();

export function SiteAction({
  action,
  context,
  look = 'inline',
  className = '',
}: {
  action: BlueprintAction;
  context: WebsiteRenderContext;
  look?: 'inline' | 'primary' | 'quiet';
  className?: string;
}) {
  const classes = `${styles.action} ${cinematic.action} ${styles[`action_${look}`] ?? ''} ${className}`.trim();
  if (action.kind === 'prototype') {
    return (
      <button
        type="button"
        className={classes}
        onClick={() => context.openNotice({ title: action.label, body: actionNote(action) })}
      >
        {action.label}
        <span aria-hidden="true"> ↗</span>
      </button>
    );
  }
  if (action.kind === 'anchor') {
    return (
      <a className={classes} href={`#${action.target}`}>
        {action.label}
        <span aria-hidden="true"> ↓</span>
      </a>
    );
  }
  return (
    <Link
      className={classes}
      href={pageHref(context.basePath, action.target)}
      onClick={(event) => {
        if (context.onNavigate) {
          event.preventDefault();
          context.onNavigate(action.target);
        }
      }}
    >
      {action.label}
      <span aria-hidden="true"> →</span>
    </Link>
  );
}

export function Wordmark({ context, onNavigate, size = 'normal' }: { context: WebsiteRenderContext; onNavigate: () => void; size?: 'normal' | 'large' }) {
  return (
    <Link
      href={pageHref(context.basePath, 'home')}
      className={`${styles.wordmark} ${size === 'large' ? styles.wordmarkLarge : ''}`}
      onClick={(event) => {
        if (context.onNavigate) {
          event.preventDefault();
          context.onNavigate('home');
        }
        onNavigate();
      }}
      aria-label={`${context.blueprint.identity.siteName} — home`}
    >
      <span className={css('monogram')} aria-hidden="true">{context.blueprint.identity.monogram}</span>
      <span className={css('wordmarkText')}>{context.blueprint.identity.siteName}</span>
    </Link>
  );
}

function SiteMenu({
  context,
  pageSlug,
  onClose,
  labelledBy,
  id,
}: {
  context: WebsiteRenderContext;
  pageSlug: string;
  onClose: () => void;
  labelledBy: string;
  id: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>('a, button');
    first?.focus();
    if (!context.embedded) document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')).filter(
        (element) => element.offsetParent !== null,
      );
      if (!focusable.length) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!context.embedded) document.body.style.overflow = '';
      previous.current?.focus();
    };
  }, [context.embedded, onClose]);

  const go = (slug: string) => {
    onClose();
    context.onNavigate?.(slug);
  };

  return (
    <div className={css('menuScrim')} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div id={id} className={css('menu')} role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={panel}>
        <div className={css('menuTop')}>
          <Wordmark context={context} onNavigate={() => onClose()} size="large" />
          <button type="button" className={css('closeButton')} onClick={onClose} aria-label="Close menu">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <nav className={css('menuLinks')} aria-label="Website pages">
          <Link
            href={pageHref(context.basePath, 'home')}
            className={css('menuLink')}
            onClick={(event) => {
              if (context.onNavigate) {
                event.preventDefault();
                go('home');
              } else {
                onClose();
              }
            }}
          >
            <span className={css('menuIndex')}>00</span>
            Home
          </Link>
          {context.blueprint.navigation.items.map((item, index) => (
            <Link
              key={item.pageSlug}
              href={pageHref(context.basePath, item.pageSlug)}
              className={css('menuLink')}
              aria-current={pageSlug === item.pageSlug ? 'page' : undefined}
              onClick={(event) => {
                if (context.onNavigate) {
                  event.preventDefault();
                  go(item.pageSlug);
                } else {
                  onClose();
                }
              }}
            >
              <span className={css('menuIndex')}>{String(index + 1).padStart(2, '0')}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={css('menuFoot')}>
          {context.blueprint.navigation.action && <SiteAction action={context.blueprint.navigation.action} context={context} look="primary" />}
          <p>{context.blueprint.disclosures[0]?.label}</p>
        </div>
      </div>
    </div>
  );
}

export function SiteNavigation({ context, pageSlug }: { context: WebsiteRenderContext; pageSlug: string }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuId = useId();
  const style = context.blueprint.navigation.style;

  useEffect(() => {
    if (style !== 'overlay-sequence') return;
    const update = () => setScrolled(window.scrollY > 32);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [style]);

  const activeSlug = pageSlug.startsWith('work/') ? 'work' : pageSlug;

  return (
    <>
      <header
        className={`${styles.nav} ${cinematic.nav} ${styles[`nav_${style.replace(/-/g, '_')}`] ?? ''}`}
        data-scrolled={scrolled || undefined}
        data-open={open || undefined}
      >
        <Wordmark context={context} onNavigate={() => setOpen(false)} />
        <nav className={css('navLinks')} aria-label="Primary">
          {context.blueprint.navigation.items.map((item, index) => (
            <Link
              key={item.pageSlug}
              href={pageHref(context.basePath, item.pageSlug)}
              className={css('navLink')}
              aria-current={activeSlug === item.pageSlug ? 'page' : undefined}
              onClick={(event) => {
                if (context.onNavigate) {
                  event.preventDefault();
                  context.onNavigate(item.pageSlug);
                }
              }}
            >
              {style === 'offset-rail' && <span className={css('navNumber')}>{String(index + 1).padStart(2, '0')}</span>}
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={css('navAction')}>
          {context.blueprint.navigation.action && <SiteAction action={context.blueprint.navigation.action} context={context} look="quiet" />}
        </div>
        <button
          type="button"
          className={css('menuButton')}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(true)}
        >
          <span className={css('menuButtonLines')} aria-hidden="true"><i /><i /></span>
          Menu
        </button>
      </header>
      {open && (
        <>
          <SiteMenu context={context} pageSlug={pageSlug} onClose={() => setOpen(false)} labelledBy={`${menuId}-title`} id={menuId} />
          <span id={`${menuId}-title`} hidden>{context.blueprint.identity.siteName} menu</span>
        </>
      )}
    </>
  );
}

export function SiteFooter({ context, pageSlug }: { context: WebsiteRenderContext; pageSlug: string }) {
  const credits = context.blueprint.assets;
  return (
    <footer className={css('footer')}>
      <div className={css('footerTop')}>
        <div className={css('footerMark')}>
          <span className={css('monogram')} aria-hidden="true">{context.blueprint.identity.monogram}</span>
          <p>{context.blueprint.identity.siteName}</p>
          <span>{context.blueprint.identity.descriptor}</span>
        </div>
        <nav className={css('footerNav')} aria-label="Footer">
          <Link
            href={pageHref(context.basePath, 'home')}
            onClick={(event) => {
              if (context.onNavigate) {
                event.preventDefault();
                context.onNavigate('home');
              }
            }}
          >
            Home
          </Link>
          {context.blueprint.navigation.items.map((item) => (
            <Link
              key={item.pageSlug}
              href={pageHref(context.basePath, item.pageSlug)}
              aria-current={pageSlug === item.pageSlug ? 'page' : undefined}
              onClick={(event) => {
                if (context.onNavigate) {
                  event.preventDefault();
                  context.onNavigate(item.pageSlug);
                }
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={css('footerAction')}>
          {context.blueprint.navigation.action && <SiteAction action={context.blueprint.navigation.action} context={context} look="primary" />}
        </div>
      </div>
      <div className={css('footerNotice')}>
        <p>{context.blueprint.disclosures[0]?.label}</p>
        <p>{context.blueprint.disclosures[1]?.detail}</p>
      </div>
      <details className={css('credits')}>
        <summary>
          Credits, licences and type <span aria-hidden="true">＋</span>
        </summary>
        <div className={css('creditsBody')}>
          <div>
            <h2>Media</h2>
            <ul>
              {credits.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.fileName}</strong> — {asset.credit ?? 'Credit not recorded'}.
                  <span> {asset.licence.name}.</span>
                  {asset.sourceUrl && <span className={css('sourceUrl')}> Source: {asset.sourceUrl}</span>}
                </li>
              ))}
              {!credits.length && <li>No client photography is present. Image-pending plates mark the commission.</li>}
            </ul>
          </div>
          <div>
            <h2>Type</h2>
            <p>
              Display: {context.blueprint.typography.display.requestedFamily}
              {context.blueprint.typography.display.bundled ? '' : ' (documented fallback)'} · Body:{' '}
              {context.blueprint.typography.body.requestedFamily}
              {context.blueprint.typography.body.bundled ? '' : ' (documented fallback)'}.
            </p>
            <p>
              {context.blueprint.typography.display.bundled || context.blueprint.typography.body.bundled
                ? 'Self-hosted WOFF2, Latin subset, font-display: swap. Licence text ships with the files.'
                : 'No font file is bundled for this pairing; system fallbacks are in use.'}
            </p>
          </div>
        </div>
      </details>
      <div className={css('footerBottom')}>
        <span>Concept prototype · {context.blueprint.generatedAt.slice(0, 10)}</span>
        <span>No cookies, analytics, payments or external requests.</span>
        <span>Not for publication.</span>
      </div>
    </footer>
  );
}

export function ConceptDisclosure({ context }: { context: WebsiteRenderContext }) {
  if (context.embedded) {
    return (
      <div className={css('embeddedDisclosure')}>
        <span>{context.blueprint.disclosures[0]?.label}</span>
        <button
          type="button"
          onClick={() => context.openNotice({ title: 'Prototype notes', body: 'Missing information, licence status and the limits of this preview.' })}
        >
          Notes
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={css('disclosurePill')}
      onClick={() => context.openNotice({ title: 'Prototype notes', body: 'Missing information, licence status and the limits of this preview.' })}
    >
      <span className={css('disclosureDot')} aria-hidden="true" />
      Concept Website — Not an Official Business Website
      <span aria-hidden="true">↗</span>
    </button>
  );
}

export function PrototypeDialog({ context, notice, onClose }: { context: WebsiteRenderContext; notice: PrototypeNotice | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (notice) {
      if (!element.open) {
        if (typeof element.showModal === 'function') element.showModal();
        else element.setAttribute('open', '');
      }
    } else if (element.open) {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [notice]);

  return (
    <dialog
      ref={dialog}
      className={css('noticeDialog')}
      aria-label={`Prototype notice — ${notice?.title ?? 'Notes'}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={css('noticeDialogInner')}>
        <div className={css('noticeDialogTop')}>
          <p className={css('eyebrow')}>Prototype notice</p>
          <button type="button" className={css('closeButton')} onClick={onClose} aria-label="Close notice">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <h2 id={titleId}>{notice?.title ?? 'Prototype notes'}</h2>
        <p className={css('noticeLead')}>{notice?.body}</p>
        <div className={css('noticeBody')}>
          {context.blueprint.disclosures.map((disclosure) => (
            <div key={disclosure.id}>
              <h3>{disclosure.label}</h3>
              <p>{disclosure.detail}</p>
            </div>
          ))}
          {context.blueprint.missingInformation.length > 0 && (
            <div>
              <h3>Missing information</h3>
              <ul>
                {context.blueprint.missingInformation.map((item) => (
                  <li key={item.id}>
                    <strong>{item.question}</strong>
                    <span>{item.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {context.blueprint.readiness.warnings.length > 0 && (
            <div>
              <h3>Preview warnings</h3>
              <ul>
                {context.blueprint.readiness.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3>Permission state</h3>
            <p>
              {context.blueprint.assets.some((asset) => asset.sourceKind === 'synthetic_concept') && 'Images of the house are synthetic concept imagery of one fictional property, not actual photographs or confirmed facilities. '}
              {context.blueprint.assets.length} approved prototype asset{context.blueprint.assets.length === 1 ? '' : 's'}. Publishing is
              blocked until every asset, claim and commercial term has separate permission and a human approval.
            </p>
          </div>
        </div>
        <button type="button" className={css('noticeClose')} onClick={onClose}>
          Return to the concept
        </button>
      </div>
    </dialog>
  );
}
