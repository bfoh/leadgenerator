import type { Metadata } from 'next';
import Link from 'next/link';
import { SHOWCASE_ASSETS } from '@/lib/domain/showcase-assets';
import { listShowcaseSites } from '@/lib/domain/showcase-sites';
import styles from './showcase.module.css';

export const metadata: Metadata = {
  title: 'Website prototypes — Digital Opportunity Finder',
  description: 'Three fictional websites rendered by the Studio’s cinematic website engine.',
  robots: { index: false, follow: false },
};

export default function ShowcaseIndexPage() {
  const sites = listShowcaseSites();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.kicker}>Internal prototypes / Milestone 3C.4</p>
        <h1>Three ways of making a website feel inevitable.</h1>
        <div className={styles.intro}>
          <p>
            The same Studio engine, three approved creative directions. Each site is built from an editorial blueprint, self-hosted type, licensed concept media and a trusted React renderer.
          </p>
          <p>
            Every business here is fictional. No enquiry is sent, no payment is taken and nothing is published.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        {sites.map((site, index) => {
          const asset = (SHOWCASE_ASSETS[site.slug] ?? []).find((entry) => entry.mimeType === 'image/jpeg');
          return (
            <article key={site.slug} className={styles.card} data-index={index} style={{ '--card-ground': site.ground, '--card-accent': site.accent } as React.CSSProperties}>
              <Link href={`/showcase/${site.slug}`} className={styles.imageLink} aria-label={`Open ${site.siteTitle}`}>
                {asset && (
                  // Decorative cover: the adjacent title is the accessible name.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.sourcePath} alt="" className={styles.image} />
                )}
                <span className={styles.open}>Open website ↗</span>
              </Link>
              <div className={styles.cardBody}>
                <p className={styles.location}>{site.city} / {site.conceptName}</p>
                <h2>{site.siteTitle}</h2>
                <p className={styles.tagline}>{site.tagline}</p>
                <p className={styles.description}>{site.description}</p>
                <dl className={styles.meta}>
                  <div><dt>Composition</dt><dd>{site.composition}</dd></div>
                  <div><dt>Type</dt><dd>{site.typography}</dd></div>
                  <div><dt>Pages</dt><dd>{String(site.pageCount).padStart(2, '0')}</dd></div>
                </dl>
              </div>
            </article>
          );
        })}
      </div>

      <footer className={styles.footer}>
        <p>Concept Website — Not an Official Business Website</p>
        <p>
          Built locally with the Studio’s deterministic blueprint engine. No client data, paid model call, migration or deployment is involved.
        </p>
        <Link href="/studio">Back to the Studio</Link>
      </footer>
    </main>
  );
}
