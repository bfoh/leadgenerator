// Deterministic helpers for website research: what kind of site a URL is, whether text names the
// business, and where a page says it is located. No network access; used by the verification
// agent, the digital audit and their tests.

import { normalizeName } from './dedupe';

export type ResultKind = 'candidate' | 'builder_site' | 'social' | 'link_in_bio' | 'directory' | 'marketplace' | 'news' | 'reference';

const SOCIAL: Record<string, string> = {
  'facebook.com': 'facebook',
  'fb.com': 'facebook',
  'instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'x.com': 'x',
  'twitter.com': 'x',
  'linkedin.com': 'linkedin',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'pinterest.com': 'pinterest',
  'snapchat.com': 'snapchat',
  'threads.net': 'threads',
  'wa.me': 'whatsapp_business',
  'whatsapp.com': 'whatsapp_business',
  't.me': 'telegram',
};
const LINK_IN_BIO = ['linktr.ee', 'beacons.ai', 'bio.link', 'campsite.bio', 'taplink.cc', 'lnk.bio', 'linkin.bio', 'solo.to', 'allmylinks.com', 'msha.ke', 'linkbio.co'];
const DIRECTORIES = [
  'businessghana.com',
  'ghanayello.com',
  'ghanabusinessweb.com',
  'yellowpagesghana.com',
  'ghanayellowpages.com',
  'cylex.com.gh',
  'infoisinfo.com.gh',
  'africabizinfo.com',
  'hotfrog.com.gh',
  'tripadvisor.com',
  'yelp.com',
  'foursquare.com',
  'mapcarta.com',
  'vymaps.com',
  'wanderlog.com',
  'restaurantguru.com',
  'waze.com',
  'maps.app.goo.gl',
  'goo.gl',
  'zaubee.com',
  'top-rated.online',
  'ghanaplaces.com',
];
const MARKETPLACES = ['jumia.com.gh', 'jiji.com.gh', 'tonaton.com', 'booking.com', 'hotels.com', 'expedia.com', 'agoda.com', 'airbnb.com', 'glovoapp.com', 'bolt.eu', 'chowdeck.com', 'meqasa.com', 'etsy.com', 'amazon.com'];
const NEWS = ['myjoyonline.com', 'graphic.com.gh', 'citinewsroom.com', 'ghanaweb.com', 'pulse.com.gh', 'modernghana.com', 'gna.org.gh', 'ghanaiantimes.com.gh', '3news.com', 'peacefmonline.com'];
const REFERENCE = ['wikipedia.org', 'google.com', 'bing.com', 'apple.com', 'gov.gh'];
const BUILDERS = ['wixsite.com', 'wordpress.com', 'blogspot.com', 'business.site', 'godaddysites.com', 'squarespace.com', 'weebly.com', 'webflow.io', 'vercel.app', 'netlify.app', 'carrd.co', 'mystrikingly.com', 'site123.me', 'jimdosite.com', 'github.io', 'myshopify.com', 'square.site', 'ueniweb.com'];

/** Two-level public suffixes common in our markets (enough for registrable-domain grouping). */
const SECOND_LEVEL = new Set(['com.gh', 'org.gh', 'edu.gh', 'gov.gh', 'net.gh', 'co.uk', 'org.uk', 'co.za', 'com.ng', 'co.ke', 'com.au', 'co.in']);

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** "shop.kente.com.gh" → "kente.com.gh". Approximate: uses a short list of two-level suffixes. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return SECOND_LEVEL.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

function matchesHost(host: string, list: readonly string[]) {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

export function classifyUrl(url: string): { kind: ResultKind; host: string; platform: string | null } | null {
  const host = hostOf(url);
  if (!host) return null;
  const social = Object.entries(SOCIAL).find(([d]) => host === d || host.endsWith(`.${d}`));
  if (social) return { kind: 'social', host, platform: social[1] };
  if (matchesHost(host, LINK_IN_BIO)) return { kind: 'link_in_bio', host, platform: 'link_in_bio' };
  if (matchesHost(host, DIRECTORIES) || (/^(maps\.)?google\.[a-z.]+$/.test(host) && /\/maps/.test(url))) return { kind: 'directory', host, platform: null };
  if (matchesHost(host, MARKETPLACES)) return { kind: 'marketplace', host, platform: null };
  if (matchesHost(host, NEWS)) return { kind: 'news', host, platform: null };
  if (matchesHost(host, REFERENCE)) return { kind: 'reference', host, platform: null };
  if (matchesHost(host, BUILDERS)) return { kind: 'builder_site', host, platform: null };
  return { kind: 'candidate', host, platform: null };
}

/** Site identity for grouping: the full host for builder subdomains, otherwise the registrable domain. */
export function siteKey(url: string): string | null {
  const c = classifyUrl(url);
  if (!c) return null;
  return c.kind === 'builder_site' ? c.host : registrableDomain(c.host);
}

/** Distinctive name tokens (stopwords such as "Ltd" or "Ghana" removed). */
export function nameTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length >= 2);
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Share (0–1) of the business's distinctive name tokens present in the text. */
export function nameCoverage(name: string, text: string | null | undefined): number {
  const tokens = nameTokens(name);
  if (!tokens.length || !text) return 0;
  const words = new Set(normalizeName(text).split(' '));
  const joined = tokens.join('');
  if (joined.length >= 5 && compact(text).includes(joined)) return 1;
  return tokens.filter((t) => words.has(t)).length / tokens.length;
}

/** How closely a domain spells the business name (0–1). */
export function domainNameMatch(name: string, domain: string): number {
  const tokens = nameTokens(name);
  if (!tokens.length) return 0;
  const reg = registrableDomain(domain);
  const label = compact(reg.split('.')[0] ?? '');
  const sub = compact(domain.split('.')[0] ?? '');
  const joined = tokens.join('');
  let best = 0;
  for (const l of new Set([label, sub])) {
    if (!l) continue;
    if (l === joined || l === `${joined}gh` || l === `${joined}ghana`) best = Math.max(best, 1);
    else if (joined.length >= 4 && l.includes(joined)) best = Math.max(best, 0.9);
    else if (tokens.every((t) => l.includes(t))) best = Math.max(best, 0.8);
    else best = Math.max(best, (0.7 * tokens.filter((t) => t.length >= 3 && l.includes(t)).length) / tokens.length);
  }
  return Math.round(best * 100) / 100;
}

export const GHANA_PLACES = [
  'accra',
  'kumasi',
  'tema',
  'takoradi',
  'sekondi',
  'cape coast',
  'tamale',
  'koforidua',
  'sunyani',
  'ho',
  'wa',
  'bolgatanga',
  'obuasi',
  'kasoa',
  'madina',
  'east legon',
  'osu',
  'spintex',
  'adenta',
  'dansoman',
  'labone',
  'cantonments',
  'airport residential',
  'ashaiman',
  'teshie',
  'nungua',
  'achimota',
  'kaneshie',
  'adum',
  'asokwa',
  'bantama',
  'ahodwo',
];
const FOREIGN = /\b(nigeria|lagos|abuja|kenya|nairobi|south africa|johannesburg|london|united kingdom|england|usa|united states|new york|texas|canada|toronto|india|dubai|uae)\b|\+(44|1|234|254|27|91|971)[\s-]?\d/i;
const GHANA = /\bghana\b|\+233|\b233\s?\d{2}/i;

export interface LocationSignals {
  ghana: boolean;
  city: boolean;
  /** Ghanaian places other than the business's city that the text mentions. */
  otherGhanaPlaces: string[];
  foreign: boolean;
}

export function locationSignals(text: string, place: { city: string; neighborhood?: string | null; region?: string | null }, host?: string | null): LocationSignals {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const own = [place.city, place.neighborhood, place.region].filter((p): p is string => Boolean(p?.trim())).map((p) => p.trim().toLowerCase());
  const has = (p: string) => new RegExp(`[^a-z]${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(lower);
  const city = own.some(has);
  const ghana = GHANA.test(text) || Boolean(host && /\.gh$/.test(host)) || city;
  const otherGhanaPlaces = GHANA_PLACES.filter((p) => p.length > 2 && !own.includes(p) && has(p)).slice(0, 5);
  const foreign = FOREIGN.test(text) || Boolean(host && /\.(co\.uk|uk|ng|za|ke|in|ae)$/.test(host));
  return { ghana, city, otherGhanaPlaces, foreign };
}

/** Last nine digits of a phone number, so +233 and 0-prefixed Ghanaian forms compare equal. */
export function phoneKey(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

/** Plausible domains derived from the business name. A domain resolving shows only that it exists. */
export function candidateDomains(name: string, max = 8): string[] {
  const tokens = normalizeName(name).split(' ').filter((t) => /^[a-z0-9]+$/.test(t));
  if (!tokens.length) return [];
  const joined = tokens.join('');
  const hyphen = tokens.join('-');
  const firstTwo = tokens.slice(0, 2).join('');
  const bases = [...new Set([joined, hyphen, firstTwo, `${joined}gh`])].filter((b) => b.length >= 3 && b.length <= 63);
  const out: string[] = [];
  for (const base of bases) for (const tld of ['com', 'com.gh', 'gh']) out.push(`${base}.${tld}`);
  return [...new Set(out)].slice(0, max);
}
