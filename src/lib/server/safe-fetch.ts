import 'server-only';

import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { extractContacts, type ExtractedContacts } from '@/lib/domain/contact-extraction';
import { extractPageFacts, type PageFacts } from '@/lib/domain/page-signals';
import { ROBOTS_PRODUCT_TOKEN, robotsAllows } from '@/lib/domain/robots';
import type { TechnicalCheck } from '@/lib/domain/types';

// One GET of one page (a homepage, or the contact page it links to) — no crawling. Every hop is
// validated: http(s) only, standard ports, and the address is checked inside the socket's DNS lookup
// so a DNS rebinding answer cannot reach private networks. Automated checks (agents) also honour robots.txt for every origin they
// visit. No script on the page is ever executed: HTML is read as text.

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 8000;
const MAX_BODY = 512 * 1024;
const ROBOTS_TIMEOUT_MS = 5000;
const USER_AGENT = 'DigitalOpportunityFinder-LinkCheck/1.0 (+single on-demand website status check)';
const AGENT_USER_AGENT = `${ROBOTS_PRODUCT_TOKEN}/1.0 (+automated website verification and published business contact details; honours robots.txt)`;

interface RequestOptions {
  userAgent: string;
  accept: string;
  /** Bodies are read only for these content types. */
  bodyType: RegExp;
}
const PAGE_REQUEST: RequestOptions = { userAgent: USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', bodyType: /html/i };

function ipv4ToInt(ip: string) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) || // unique local fc00::/7
      /^fe[89ab]/.test(lower) || // link-local fe80::/10
      /^ff/.test(lower) || // multicast
      lower.startsWith('2001:db8') ||
      lower.startsWith('64:ff9b')
    );
  }
  return true;
}

export class UnsafeUrlError extends Error {}

export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new UnsafeUrlError('Enter a valid website address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http and https websites can be checked.');
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed.');
  if (url.port && !['80', '443'].includes(url.port)) throw new UnsafeUrlError('Only standard web ports (80/443) can be checked.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || (!host.includes('.') && !net.isIP(host))) {
    throw new UnsafeUrlError('That host cannot be checked.');
  }
  if (net.isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError('Private network addresses cannot be checked.');
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;

/** DNS lookup that refuses private addresses at connection time. */
export function guardedLookup(hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) {
  const opts = typeof options === 'object' && options ? options : {};
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as { address: string; family: number }[];
    const safe = list.filter((a) => !isPrivateAddress(a.address));
    if (!list.length || safe.length !== list.length) {
      const e = new Error('Resolved to a private or reserved address') as NodeJS.ErrnoException;
      e.code = 'EBLOCKED';
      return callback(e, '');
    }
    if (opts.all) return callback(null, safe);
    callback(null, safe[0].address, safe[0].family);
  });
}

interface HopResult {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
}

function requestOnce(url: URL, deadline: number, opts: RequestOptions = PAGE_REQUEST): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup as unknown as net.LookupFunction,
        headers: { 'User-Agent': opts.userAgent, Accept: opts.accept },
        timeout: Math.max(1000, deadline - Date.now()),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        if ((status >= 300 && status < 400) || !opts.bodyType.test(contentType)) {
          res.resume();
          return resolve({ status, location, contentType, body: '' });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('close', () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    req.end();
  });
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)));
}

export function inspectHtml(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/i)?.[1];
  return {
    title: title ? decodeEntities(title.replace(/\s+/g, ' ').trim()).slice(0, 200) : null,
    hasViewport: /<meta[^>]+name=["']viewport["']/i.test(html),
    generator: generator ? decodeEntities(generator).slice(0, 100) : null,
  };
}

function failureReason(error: unknown, timeoutMs = TIMEOUT_MS) {
  const e = error as NodeJS.ErrnoException;
  return e instanceof UnsafeUrlError
    ? e.message
    : e.code === 'ENOTFOUND'
      ? 'Domain does not resolve'
      : e.code === 'EBLOCKED'
        ? 'Resolved to a private or reserved address'
        : e.code === 'ECONNREFUSED'
          ? 'Connection refused'
          : /certificate|SSL|TLS/i.test(e.message ?? '')
            ? 'TLS certificate problem'
            : /Timed out/.test(e.message ?? '')
              ? `Timed out after ${timeoutMs / 1000} seconds`
              : 'Could not connect';
}

export type RobotsOutcome = 'allowed' | 'disallowed' | 'unavailable' | 'not_checked';

/**
 * robots.txt for one origin (RFC 9309): 2xx is parsed; 4xx means no restrictions; a 5xx means the
 * whole site is treated as disallowed. A network failure is reported as such, so the caller can
 * record why the site could not be checked without sending more requests to it.
 */
async function fetchRobots(origin: string): Promise<{ text: string | null; status: number | null; error: unknown }> {
  const deadline = Date.now() + ROBOTS_TIMEOUT_MS;
  let url = parsePublicUrl(`${origin}/robots.txt`);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await requestOnce(url, deadline, { userAgent: AGENT_USER_AGENT, accept: 'text/plain,*/*;q=0.5', bodyType: /text\/plain|^$/i });
      if (res.status >= 300 && res.status < 400 && res.location) {
        url = parsePublicUrl(new URL(res.location, url).href);
        continue;
      }
      return { text: res.status >= 200 && res.status < 300 ? res.body : null, status: res.status, error: null };
    }
    return { text: null, status: 404, error: null }; // RFC 9309: too many redirects counts as unavailable
  } catch (error) {
    return { text: null, status: null, error };
  }
}

interface FetchedPage {
  check: TechnicalCheck | null;
  html: string | null;
  robots: RobotsOutcome;
}

async function fetchPage(raw: string, automated: boolean): Promise<FetchedPage> {
  const checkedAt = new Date().toISOString();
  const start = Date.now();
  const redirects: TechnicalCheck['redirects'] = [];
  let url = parsePublicUrl(raw);
  const original = url.href;
  const robotsByOrigin = new Map<string, boolean>();
  const robots: RobotsOutcome = automated ? 'allowed' : 'not_checked';
  const failed = (error: string, status: number | null = null): TechnicalCheck => ({
    url: original,
    finalUrl: redirects.length ? url.href : null,
    ok: false,
    status,
    redirects,
    https: url.protocol === 'https:',
    responseMs: null,
    title: null,
    hasViewport: null,
    generator: null,
    error,
    checkedAt,
  });

  let deadline = start + TIMEOUT_MS;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (automated && !robotsByOrigin.has(url.origin)) {
        const r = await fetchRobots(url.origin);
        if (r.error) return { check: failed(failureReason(r.error, ROBOTS_TIMEOUT_MS)), html: null, robots: 'unavailable' };
        if (r.status !== null && r.status >= 500) {
          return { check: failed(`Server error (HTTP ${r.status}) for robots.txt; the page was not requested`, r.status), html: null, robots: 'disallowed' };
        }
        robotsByOrigin.set(url.origin, r.text === null || robotsAllows(r.text, `${url.pathname}${url.search}`));
        deadline = Math.max(deadline, Date.now() + 2000);
      }
      if (automated && !robotsByOrigin.get(url.origin)) return { check: null, html: null, robots: 'disallowed' };
      const res = await requestOnce(url, deadline, automated ? { ...PAGE_REQUEST, userAgent: AGENT_USER_AGENT } : PAGE_REQUEST);
      if (res.status >= 300 && res.status < 400 && res.location) {
        redirects.push({ url: url.href, status: res.status });
        if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
        url = parsePublicUrl(new URL(res.location, url).href);
        continue;
      }
      const meta = res.body ? inspectHtml(res.body) : { title: null, hasViewport: null, generator: null };
      const check: TechnicalCheck = {
        url: original,
        finalUrl: url.href,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        redirects,
        https: url.protocol === 'https:',
        responseMs: Date.now() - start,
        ...meta,
        error: res.status >= 400 ? `HTTP ${res.status}` : null,
        checkedAt,
      };
      return { check, html: res.body || null, robots };
    }
  } catch (error) {
    return { check: failed(/Too many redirects/.test((error as Error).message) ? 'Too many redirects' : failureReason(error)), html: null, robots };
  }
  throw new Error('unreachable');
}

/** A person's on-demand status check of one homepage. */
export async function checkWebsite(raw: string): Promise<TechnicalCheck> {
  const { check } = await fetchPage(raw, false);
  return check!;
}

export interface InspectedPage {
  check: TechnicalCheck | null;
  /** Structural facts from the HTML, including transient match keys (never stored). */
  facts: PageFacts | null;
  robots: RobotsOutcome;
}

/** An agent's check of one candidate website: robots.txt first, then the homepage, read as text. */
export async function inspectWebsite(raw: string): Promise<InspectedPage> {
  const { check, html, robots } = await fetchPage(raw, true);
  return { check, robots, facts: check?.ok && html ? extractPageFacts(html, check.finalUrl ?? check.url) : null };
}

export interface ContactPage {
  check: TechnicalCheck | null;
  robots: RobotsOutcome;
  /** Business contact details the page publishes; the page URL is their recorded source. */
  contacts: ExtractedContacts | null;
}

/** An agent's read of one page of a business's own website for the contact details it publishes. */
export async function fetchContactPage(raw: string): Promise<ContactPage> {
  const { check, html, robots } = await fetchPage(raw, true);
  return { check, robots, contacts: check?.ok && html ? extractContacts(html, check.finalUrl ?? check.url) : null };
}
