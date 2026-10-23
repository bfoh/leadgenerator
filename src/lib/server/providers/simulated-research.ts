import 'server-only';

import { nameTokens } from '@/lib/domain/web-research';
import type { SearchHit } from '@/lib/domain/website-assessment';
import type { TechnicalCheck } from '@/lib/domain/types';
import { extractContacts } from '@/lib/domain/contact-extraction';
import type { MxResult } from '@/lib/domain/contacts';
import { extractPageFacts } from '@/lib/domain/page-signals';
import type { ContactPage, InspectedPage } from '../safe-fetch';

// A deterministic, clearly labelled stand-in for web search, DNS and website fetches, used only by
// end-to-end tests (SIMULATE_EXTERNAL_TOOLS=true without Supabase). Nothing here touches the network.
//
// The simulated world, keyed by the business name:
// * by default the business has an official site at https://<name-without-spaces>.com/ that names it
//   and Accra, plus a Facebook page and a directory listing; no other variant of the name resolves;
// * a name containing "social" has only Facebook and Instagram profiles (no domain resolves);
// * a name containing "broken" has a site that resolves but answers HTTP 503;
// * an official site's homepage shows a landline and links to /contact, which publishes info@<slug>.com,
//   the landline, a WhatsApp link to a mobile number and an enquiry form; the homepage footer also
//   credits a web designer's address on another domain (which must stay "needs review");
// * mail servers (MX) exist for every simulated domain that exists, and for common free-mail domains.

export const SIMULATED_PROVIDER_NAME = 'Simulated search (test data)';

const slugOf = (name: string) => nameTokens(name).join('');
const kind = (slug: string) => (slug.includes('social') ? 'social' : slug.includes('broken') ? 'broken' : 'official');
const titled = (name: string) => name.replace(/\b\w/g, (c) => c.toUpperCase());
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const PLATFORMS = new Set(['facebook', 'instagram', 'ghanayello']);
/** Only the canonical <slug>.com exists: hyphenated, .gh and other variants do not. */
function exists(host: string) {
  const [label, ...rest] = host.toLowerCase().replace(/^www\./, '').split('.');
  return rest.join('.') === 'com' && /^[a-z0-9]{3,}$/.test(label) && !PLATFORMS.has(label) && kind(label) !== 'social';
}

export function simulatedSearch(query: string): SearchHit[] {
  const quoted = query.match(/"([^"]+)"/)?.[1];
  if (!quoted) return [];
  // A quoted domain finds that site if it exists.
  if (DOMAIN.test(quoted)) return exists(quoted) ? [{ title: quoted, url: `https://${quoted.toLowerCase()}/`, description: `Official website ${quoted.toLowerCase()}.` }] : [];
  const slug = slugOf(quoted);
  if (slug.length < 3) return [];
  const name = titled(quoted);
  const hits: SearchHit[] = [
    { title: `${name} - Accra | Facebook`, url: `https://www.facebook.com/${slug}`, description: `${name}, Accra, Ghana. See photos and updates.` },
    { title: `${name}, Accra - Ghana Yello`, url: `https://www.ghanayello.com/company/${slug}`, description: `${name} in Accra, Ghana.` },
  ];
  if (kind(slug) === 'social') hits.push({ title: `${name} (@${slug}) • Instagram`, url: `https://www.instagram.com/${slug}/`, description: `${name} Accra.` });
  else hits.unshift({ title: `${name} | Accra`, url: `https://${slug}.com/`, description: `${name} — Accra, Ghana.` });
  return hits;
}

export function simulatedProbe(domain: string): { domain: string; resolves: boolean } {
  return { domain, resolves: exists(domain) };
}

export function simulatedInspect(raw: string): InspectedPage {
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  const label = url.hostname.replace(/^www\./, '').split('.')[0];
  const checkedAt = new Date().toISOString();
  const base: TechnicalCheck = {
    url: url.href,
    finalUrl: url.href,
    ok: false,
    status: null,
    redirects: [],
    https: url.protocol === 'https:',
    responseMs: null,
    title: null,
    hasViewport: null,
    generator: null,
    error: 'Domain does not resolve',
    checkedAt,
  };
  if (!exists(url.hostname)) return { check: { ...base, finalUrl: null }, facts: null, robots: 'allowed' };
  if (kind(label) === 'broken') return { check: { ...base, status: 503, error: 'HTTP 503', responseMs: 420 }, facts: null, robots: 'allowed' };
  const name = titled(label);
  const html = `<!doctype html><html lang="en"><head><title>${name} | Accra</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${name} in Accra, Ghana.">
    </head><body><h1>${name}</h1><p>Visit us in Osu, Accra, Ghana.</p>
    <form action="/contact" method="post"><input name="email"><button>Send</button></form>
    <a href="https://www.facebook.com/${label}">Facebook</a><footer>© ${new Date().getUTCFullYear()} ${name}</footer></body></html>`;
  return {
    check: { ...base, ok: true, status: 200, error: null, responseMs: 380, title: `${name} | Accra`, hasViewport: true },
    facts: extractPageFacts(html, url.href),
    robots: 'allowed',
  };
}

const FREE_MAIL_MX = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com']);

/** Six stable digits per business, so numbers differ between prospects but not between runs. */
function digits(slug: string) {
  let h = 7;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 900_000;
  return String(100_000 + h);
}

export function simulatedContactPage(raw: string): ContactPage {
  const inspected = simulatedInspect(raw);
  if (!inspected.check?.ok) return { check: inspected.check, robots: inspected.robots, contacts: null };
  const url = new URL(inspected.check.finalUrl ?? inspected.check.url);
  const label = url.hostname.replace(/^www\./, '').split('.')[0];
  const name = titled(label);
  const d = digits(label);
  const landline = `+233 30 2${d.slice(0, 3)} ${d.slice(3)}`;
  const contactPage = /^\/contact\/?$/.test(url.pathname);
  const html = contactPage
    ? `<!doctype html><html><head><title>Contact ${name}</title>
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"${name}","telephone":"${landline}"}</script></head>
      <body><h1>Contact us</h1><p>Email <a href="mailto:info@${label}.com">info@${label}.com</a> or call <a href="tel:${landline.replace(/ /g, '')}">${landline}</a>.</p>
      <p><a href="https://wa.me/23324${d}0">Chat with us on WhatsApp</a></p>
      <form action="/contact" method="post"><input name="email"><textarea name="message"></textarea><button>Send</button></form></body></html>`
    : `<!doctype html><html><head><title>${name} | Accra</title></head>
      <body><h1>${name}</h1><p>Visit us in Osu, Accra. Call ${landline}.</p><a href="/contact">Contact us</a>
      <footer>Website by Pixel Studio (hello@pixelstudio.com)</footer></body></html>`;
  return { check: inspected.check, robots: 'allowed', contacts: extractContacts(html, url.href) };
}

export function simulatedMx(domain: string): MxResult {
  const d = domain.toLowerCase();
  if (FREE_MAIL_MX.has(d)) return { domain: d, status: 'found', hosts: [`mx.${d}`] };
  return exists(d) ? { domain: d, status: 'found', hosts: [`mail.${d}`] } : { domain: d, status: 'no_domain', hosts: [] };
}
