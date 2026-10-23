// Facts derived from one fetched homepage. Extraction is structural (tags, links, JSON-LD) and never
// interprets page text as instructions. Contact details found on the page are reduced to match keys
// and are not stored (contact collection with provenance is a separate, permission-aware step).

import { classifyUrl, hostOf, phoneKey, registrableDomain } from './web-research';

export interface PageFacts {
  title: string | null;
  description: string | null;
  siteName: string | null;
  h1: string[];
  lang: string | null;
  generator: string | null;
  hasViewport: boolean;
  hasCanonical: boolean;
  schemaTypes: string[];
  schemaNames: string[];
  schemaLocality: string | null;
  socialLinks: { platform: string; url: string }[];
  outboundSites: string[];
  hasTelLink: boolean;
  hasMailtoLink: boolean;
  hasWhatsAppLink: boolean;
  formCount: number;
  insecureFormAction: boolean;
  booking: boolean;
  catalogue: boolean;
  commerce: boolean;
  copyrightYear: number | null;
  parked: boolean;
  placeholder: boolean;
  wordCount: number;
  /** Transient (used for matching, removed before storage). */
  text?: string;
  phoneKeys?: string[];
  emailDomains?: string[];
}

const MAX_TEXT = 20_000;

function decode(s: string) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&copy;/g, '©')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const clean = (s: string | undefined | null, max: number) => {
  if (!s) return null;
  const t = decode(s).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

function meta(html: string, attr: 'name' | 'property', key: string) {
  const a = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html)?.[1];
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, 'i').exec(html)?.[1];
  return a ?? b ?? null;
}

function visibleText(html: string) {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function jsonLd(html: string) {
  const types: string[] = [];
  const names: string[] = [];
  const phones: string[] = [];
  const sameAs: string[] = [];
  let locality: string | null = null;
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) return node.slice(0, 20).forEach((n) => visit(n, depth + 1));
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    for (const v of Array.isArray(t) ? t : [t]) if (typeof v === 'string') types.push(v.slice(0, 60));
    if (typeof o.name === 'string' && /Organization|Business|Store|Restaurant|Hotel|Salon|Shop|Place|Service/i.test(String(t))) names.push(o.name.slice(0, 120));
    if (typeof o.telephone === 'string') phones.push(o.telephone);
    const address = o.address as Record<string, unknown> | undefined;
    if (address && typeof address === 'object' && typeof address.addressLocality === 'string') locality ??= address.addressLocality.slice(0, 80);
    for (const s of Array.isArray(o.sameAs) ? o.sameAs : typeof o.sameAs === 'string' ? [o.sameAs] : []) if (typeof s === 'string') sameAs.push(s);
    if (o['@graph']) visit(o['@graph'], depth + 1);
  };
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(html)) && count++ < 5) {
    try {
      visit(JSON.parse(m[1].slice(0, 50_000)), 0);
    } catch {
      // Invalid structured data is ignored.
    }
  }
  return { types: [...new Set(types)].slice(0, 10), names: [...new Set(names)].slice(0, 5), phones, sameAs, locality };
}

const BOOKING = /\b(book (now|online|an appointment|a table)|booking|appointments?|reserve (a table|now)|reservations?)\b|calendly\.com|fresha\.com|booksy\.com|setmore\.com|simplybook|squareup\.com\/appointments/i;
const CATALOGUE = /\b(our products|products|product catalog(ue)?|catalog(ue)?|collections?|new arrivals|shop|our menu|food menu|view menu|price list)\b/i;
const COMMERCE = /\b(add to (cart|bag)|checkout|view cart|buy now)\b|paystack|hubtel|flutterwave|woocommerce|shopify|(gh₵|ghs|₵)\s?\d/i;
const PARKED = /domain (is |may be )?for sale|buy this domain|this domain (has been|is) registered|parked (free|domain|by)|sedoparking|parkingcrew|bodis\.com|afternic|hugedomains|dan\.com\/buy|domain parking/i;
const PLACEHOLDER = /\b(coming soon|under construction|launching soon|site is under maintenance|website is under maintenance)\b|welcome to nginx|apache2 (ubuntu|debian) default page|\bit works!|default web site page|index of \//i;

export function extractPageFacts(html: string, pageUrl: string): PageFacts {
  const host = hostOf(pageUrl);
  const ownSite = host ? registrableDomain(host) : null;
  const head = html.slice(0, 200_000);
  const text = visibleText(html);
  const ld = jsonLd(head);

  const links: string[] = [];
  const hrefRe = /<a\s[^>]*href=["']([^"'#][^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) && links.length < 600) links.push(decode(m[1]).trim());
  const absolute = links.flatMap((href) => {
    try {
      return [new URL(href, pageUrl).href];
    } catch {
      return [];
    }
  });

  const socialLinks: PageFacts['socialLinks'] = [];
  const outbound = new Set<string>();
  for (const url of [...absolute, ...ld.sameAs]) {
    if (!/^https?:/i.test(url)) continue;
    const c = classifyUrl(url);
    if (!c) continue;
    if (c.kind === 'social' || c.kind === 'link_in_bio') {
      if (socialLinks.length < 10 && !socialLinks.some((s) => s.url === url)) socialLinks.push({ platform: c.platform ?? 'other', url: url.slice(0, 300) });
    } else if (c.kind === 'candidate' || c.kind === 'builder_site') {
      const site = c.kind === 'builder_site' ? c.host : registrableDomain(c.host);
      if (site !== ownSite && outbound.size < 10) outbound.add(site);
    }
  }

  const phones = new Set<string>();
  for (const p of [...ld.phones, ...links.filter((l) => /^tel:/i.test(l)).map((l) => l.slice(4)), ...(text.match(/(\+?233|0)[\s-]?[235]\d[\s-]?\d{3}[\s-]?\d{4}/g) ?? [])]) {
    const k = phoneKey(p);
    if (k && phones.size < 10) phones.add(k);
  }
  const emailDomains = new Set<string>();
  for (const e of [...links.filter((l) => /^mailto:/i.test(l)).map((l) => l.slice(7)), ...(text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])]) {
    const d = e.split('@')[1]?.split('?')[0]?.toLowerCase();
    if (d && emailDomains.size < 5) emailDomains.add(d);
  }

  const forms = html.match(/<form\b[^>]*>/gi) ?? [];
  const years = [...html.matchAll(/(?:©|&copy;|\(c\)|copyright)[^0-9<]{0,20}((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?/gi)].flatMap((y) => [Number(y[1]), y[2] ? Number(y[2]) : 0]);
  const hrefText = absolute.join(' ');

  return {
    title: clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1], 200),
    description: clean(meta(head, 'name', 'description'), 300),
    siteName: clean(meta(head, 'property', 'og:site_name'), 120),
    h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].slice(0, 3).flatMap((h) => clean(h[1].replace(/<[^>]+>/g, ' '), 120) ?? []),
    lang: clean(/<html[^>]+lang=["']([^"']+)["']/i.exec(head)?.[1], 20),
    generator: clean(meta(head, 'name', 'generator'), 100),
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(head),
    hasCanonical: /<link[^>]+rel=["']canonical["']/i.test(head),
    schemaTypes: ld.types,
    schemaNames: ld.names,
    schemaLocality: ld.locality,
    socialLinks,
    outboundSites: [...outbound],
    hasTelLink: links.some((l) => /^tel:/i.test(l)),
    hasMailtoLink: links.some((l) => /^mailto:/i.test(l)),
    hasWhatsAppLink: absolute.some((l) => /^https?:\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)/i.test(l)),
    formCount: forms.length,
    insecureFormAction: forms.some((f) => /action=["']http:\/\//i.test(f)),
    booking: BOOKING.test(text) || BOOKING.test(hrefText),
    catalogue: CATALOGUE.test(text) || /\/(shop|products?|catalog(ue)?|collections?)\b/i.test(hrefText),
    commerce: COMMERCE.test(text) || /\/(cart|checkout)\b/i.test(hrefText),
    copyrightYear: years.length ? Math.max(...years) : null,
    parked: PARKED.test(text),
    placeholder: text.length < 2_000 && PLACEHOLDER.test(text),
    wordCount: text ? text.split(' ').length : 0,
    text,
    phoneKeys: [...phones],
    emailDomains: [...emailDomains],
  };
}

/** The facts kept in verification evidence: no page text and no contact details. */
export function storablePageFacts(facts: PageFacts): PageFacts {
  const { text: _t, phoneKeys: _p, emailDomains: _e, ...rest } = facts;
  void _t;
  void _p;
  void _e;
  return rest;
}
