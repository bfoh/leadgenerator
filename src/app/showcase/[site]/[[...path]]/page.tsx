import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WebsiteRenderer } from '@/components/website/website-renderer';
import { buildShowcaseSite } from '@/lib/domain/showcase-sites';

type ShowcaseParams = { site: string; path?: string[] };

async function siteFor(params: Promise<ShowcaseParams>) {
  const { site, path } = await params;
  const built = buildShowcaseSite(site);
  if (!built) return null;
  const pageSlug = path?.length ? path.join('/') : 'home';
  if (!built.blueprint.pages.some((page) => page.slug === pageSlug)) return null;
  return { site: built, pageSlug };
}

export async function generateMetadata({ params }: { params: Promise<ShowcaseParams> }): Promise<Metadata> {
  const resolved = await siteFor(params);
  if (!resolved) return { title: 'Prototype not found', robots: { index: false, follow: false } };
  const page = resolved.site.blueprint.pages.find((entry) => entry.slug === resolved.pageSlug)!;
  return {
    title: `${page.title} — concept prototype`,
    description: page.description,
    robots: { index: false, follow: false },
  };
}

export default async function ShowcaseSitePage({ params }: { params: Promise<ShowcaseParams> }) {
  const resolved = await siteFor(params);
  if (!resolved) notFound();
  return (
    <WebsiteRenderer
      blueprint={resolved.site.blueprint}
      pageSlug={resolved.pageSlug}
      media={resolved.site.media}
      basePath={`/showcase/${resolved.site.slug}`}
    />
  );
}
