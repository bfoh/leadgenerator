// Contact details a business publishes on its own website: mailto: and tel: links, WhatsApp links it
// placed itself, structured contact markup (JSON-LD), contact-page links and visible text on the
// page. Extraction is structural; page text is never treated as instructions. Only the business's
// own site is read (the caller decides which pages, and robots.txt is honoured by the fetcher).

import { findPhoneNumbersInText } from 'libphonenumber-js/max';
import { normalizeEmail, normalizePhone } from './contacts';
import { hostOf, registrableDomain } from './web-research';

export type ExtractionVia = 'mailto_link' | 'tel_link' | 'whatsapp_link' | 'structured_data' | 'page_text';

export interface ExtractedDetail {
  value: string;
  normalized: string;
  via: ExtractionVia;
}

export interface ExtractedContacts {
  pageUrl: string;
  emails: ExtractedDetail[];
  phones: ExtractedDetail[];
  /** Numbers the business links to on WhatsApp itself (wa.me / api.whatsapp.com). */
  whatsapp: ExtractedDetail[];
  /** Same-site pages that look like contact pages, most likely first. */
  contactPages: string[];
  hasForm: boolean;
}

const MAX_EACH = 8;
const MAX_TEXT = 20_000;
const CONTACT_PATH = /\/(contact(-?us)?|get-in-touch|reach-us|find-us|enquir(y|ies)|inquir(y|ies)|visit-us|locations?)(\/|\.html?|$)/i;
const CONTACT_TEXT = /^(contact( us)?|get in touch|reach us|find us|enquiries|visit us|location)$/i;

function decode(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#64;|&commat;/g, '@')
    .replace(/&#46;|&period;/g, '.')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
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

function structuredContacts(html: string) {
  const emails: string[] = [];
  const phones: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 5) return;
    if (Array.isArray(node)) return node.slice(0, 20).forEach((n) => visit(n, depth + 1));
    const o = node as Record<string, unknown>;
    if (typeof o.email === 'string') emails.push(o.email);
    if (typeof o.telephone === 'string') phones.push(o.telephone);
    for (const key of ['contactPoint', '@graph', 'location', 'department']) if (o[key]) visit(o[key], depth + 1);
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
  return { emails, phones };
}

/** Pulls business contact details out of one page of the business's own website. */
export function extractContacts(html: string, pageUrl: string): ExtractedContacts {
  const host = hostOf(pageUrl);
  const ownSite = host ? registrableDomain(host) : null;
  const anchors: { href: string; text: string }[] = [];
  const re = /<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && anchors.length < 600) anchors.push({ href: decode(m[1]).trim(), text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });

  const emails = new Map<string, ExtractedDetail>();
  const phones = new Map<string, ExtractedDetail>();
  const whatsapp = new Map<string, ExtractedDetail>();
  const addEmail = (value: string, via: ExtractionVia) => {
    const n = normalizeEmail(value);
    if (n.ok && !emails.has(n.normalized) && emails.size < MAX_EACH && !/^(example\.(com|org)|sentry\.io|wixpress\.com|domain\.com)$/.test(n.domain!)) emails.set(n.normalized, { value: value.trim().slice(0, 320), normalized: n.normalized, via });
  };
  const addPhone = (target: Map<string, ExtractedDetail>, value: string, via: ExtractionVia) => {
    const n = normalizePhone(value);
    if (n.ok && !target.has(n.normalized) && target.size < MAX_EACH) target.set(n.normalized, { value: value.trim().slice(0, 60), normalized: n.normalized, via });
  };

  const contactPages: string[] = [];
  for (const a of anchors) {
    if (/^mailto:/i.test(a.href)) addEmail(a.href, 'mailto_link');
    else if (/^tel:/i.test(a.href)) addPhone(phones, a.href.slice(4), 'tel_link');
    else {
      let url: URL;
      try {
        url = new URL(a.href, pageUrl);
      } catch {
        continue;
      }
      if (/^(wa\.me|api\.whatsapp\.com)$/i.test(url.hostname)) {
        const number = url.hostname.toLowerCase() === 'wa.me' ? url.pathname.replace(/\//g, '') : (url.searchParams.get('phone') ?? '');
        if (number) addPhone(whatsapp, number.startsWith('+') ? number : `+${number}`, 'whatsapp_link');
        continue;
      }
      if (!/^https?:$/.test(url.protocol) || !ownSite || registrableDomain(url.hostname) !== ownSite) continue;
      url.hash = '';
      if ((CONTACT_PATH.test(url.pathname) || CONTACT_TEXT.test(a.text)) && url.href !== pageUrl && !contactPages.includes(url.href) && contactPages.length < 3) contactPages.push(url.href);
    }
  }

  const ld = structuredContacts(html.slice(0, 200_000));
  for (const e of ld.emails) addEmail(e, 'structured_data');
  for (const p of ld.phones) addPhone(phones, p, 'structured_data');

  const text = visibleText(html);
  for (const e of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g) ?? []) addEmail(e, 'page_text');
  for (const found of findPhoneNumbersInText(text, 'GH').slice(0, 20)) addPhone(phones, found.number.number, 'page_text');
  // A number already declared as WhatsApp is still a phone number for calls.

  return {
    pageUrl,
    emails: [...emails.values()],
    phones: [...phones.values()],
    whatsapp: [...whatsapp.values()],
    contactPages,
    hasForm: /<form\b/i.test(html),
  };
}
