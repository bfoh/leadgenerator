import 'server-only';

import { serverEnv } from '../env';
import { logEvent } from '../log';
import { ProviderError } from './discovery';

// Independent web search used during website verification (not for building lead lists).
// Brave Search API terms: results are used transiently to decide which sites to check; result
// titles and snippets are never stored. Requests are paced to stay inside the plan's rate limit.

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchOptions {
  /**
   * A hint from the caller — usually the discovery form's country (`GH`). Brave accepts only its
   * own list of search markets, so an unsupported hint is replaced; it is never sent as-is.
   */
  country?: string | null;
}

export interface WebSearchProvider {
  readonly id: string;
  readonly name: string;
  isConfigured(): boolean;
  estimatedCostUsd(): number;
  search(query: string, signal: AbortSignal, options?: WebSearchOptions): Promise<WebSearchResult[]>;
}

/**
 * The `country` values Brave documents for `/res/v1/web/search`, verbatim from the API reference
 * (retrieved 2026-10-25): https://api-dashboard.search.brave.com/api-reference/web/search/get
 *
 * This is a closed list of search markets, **not** ISO 3166-1: Ghana is absent. `country=GH` is
 * rejected with `422 VALIDATION` on `country`, and omitting the parameter is not neutral either —
 * it silently defaults to `US`. Ghanaian discovery therefore sends `ALL` and carries Ghana, the
 * region, the city and the business category in the query text itself.
 */
export const BRAVE_COUNTRY_CODES = [
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'GR', 'HK', 'IN', 'ID', 'IT',
  'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE',
  'CH', 'TW', 'TR', 'GB', 'US', 'ALL',
] as const;

export type BraveCountryCode = (typeof BRAVE_COUNTRY_CODES)[number];

/** `ALL` — "no single market" — is the safe value for a country Brave does not sell as a market. */
export const BRAVE_DEFAULT_COUNTRY: BraveCountryCode = 'ALL';

const BRAVE_COUNTRY_SET: ReadonlySet<string> = new Set(BRAVE_COUNTRY_CODES);

/** True only for a value Brave will accept in `country`. */
export function isBraveCountryCode(value: unknown): value is BraveCountryCode {
  return typeof value === 'string' && BRAVE_COUNTRY_SET.has(value.trim().toUpperCase());
}

/**
 * Any country hint in, a Brave-accepted code out. `GH` and every other unsupported code become
 * `ALL`, so an unsupported market can never reach the API.
 */
export function braveCountryCode(requested?: string | null): BraveCountryCode {
  const code = requested?.trim().toUpperCase() ?? '';
  return BRAVE_COUNTRY_SET.has(code) ? (code as BraveCountryCode) : BRAVE_DEFAULT_COUNTRY;
}

/** Brave caps `q` at 600 characters; longer text is rejected with the same 422 class. */
const MAX_QUERY = 600;

export function buildBraveSearchUrl(query: string, requestedCountry?: string | null): URL {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query.slice(0, MAX_QUERY));
  url.searchParams.set('count', '10');
  url.searchParams.set('country', braveCountryCode(requestedCountry));
  url.searchParams.set('safesearch', 'moderate');
  return url;
}

/** Brave's documented error envelope: `{ type, error: { id, status, code, detail, meta } }`. */
export interface BraveErrorBody {
  type?: string;
  error?: { id?: string; status?: number; code?: string; detail?: string; meta?: { param?: string } };
}

export interface BraveErrorSummary {
  /** Brave's own code, e.g. `VALIDATION` or `SUBSCRIPTION_TOKEN_INVALID`. */
  code: string | null;
  /** Brave's message, sanitized for logs. */
  detail: string | null;
  /** The request parameter Brave named as rejected. */
  param: string | null;
  /** What the caller is told: actionable, and never the key or a raw header. */
  message: string;
  retryable: boolean;
}

const MAX_TEXT = 240;

/**
 * Removes anything that must not be logged: the subscription token, header lines, and the query
 * string of any URL (which can carry credentials). Newlines are flattened so a log line stays one.
 */
export function scrubBraveText(text: string, secret: string | null = serverEnv.braveKey()): string {
  let out = text;
  if (secret) out = out.split(secret).join('[redacted]');
  out = out.replace(/https?:\/\/[^\s"']+/gi, (m) => m.replace(/[?#].*$/, ''));
  out = out.replace(/\b(x-subscription-token|authorization|cookie|set-cookie)\b\s*[:=]\s*[^\s,;"']+/gi, '$1: [redacted]');
  return out.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TEXT);
}

/**
 * Turns a Brave error response into a message a person can act on. The rejected parameter is
 * surfaced because it is the one clue Brave gives: its detail text alone rarely names the field.
 * Brave's raw text is echoed only after scrubbing, never the request headers or the key.
 */
export function braveErrorMessage(status: number, body: BraveErrorBody | null): BraveErrorSummary {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? scrubBraveText(value) : null);
  const code = text(body?.error?.code);
  const detail = text(body?.error?.detail);
  const param = text(body?.error?.meta?.param);
  const tagged = `${status}${code ? ` ${code}` : ''}`;
  if (status === 429) return { code, detail, param, message: 'Web search rate limit reached.', retryable: true };
  if (status >= 500) return { code, detail, param, message: `Brave Search is temporarily unavailable (${tagged}). Try again shortly.`, retryable: true };
  if (status === 401 || status === 403) {
    return { code, detail, param, message: `Brave rejected the API key (${tagged}). Check BRAVE_SEARCH_API_KEY on the server.`, retryable: false };
  }
  if (param === 'country') {
    return { code, detail, param, message: `Brave rejected the search market “country” (${tagged}). It accepts only its documented codes or ALL.`, retryable: false };
  }
  const where = param ? ` on “${param}”` : '';
  const because = detail ? `: ${detail}` : '';
  return { code, detail, param, message: `Web search failed (${tagged})${where}${because}`, retryable: false };
}

/** Minimum gap between requests from this server instance (Brave's free plan allows 1 per second). */
const MIN_INTERVAL_MS = 1100;
let nextSlot = 0;

async function pace(signal: AbortSignal) {
  const wait = nextSlot - Date.now();
  nextSlot = Math.max(Date.now(), nextSlot) + MIN_INTERVAL_MS;
  if (wait <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, wait);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new ProviderError('Web search was cancelled.', true))), { once: true });
  });
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();

export const braveSearchProvider: WebSearchProvider = {
  id: 'brave_search',
  name: 'Brave Search API',
  isConfigured: () => Boolean(serverEnv.braveKey()),
  estimatedCostUsd: () => serverEnv.cost.braveSearch(),
  async search(query, signal, options) {
    const url = buildBraveSearchUrl(query, options?.country);
    await pace(signal);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': serverEnv.braveKey() }, signal, cache: 'no-store' });
    } catch {
      throw new ProviderError('Web search did not respond.', true);
    }
    if (!res.ok) {
      // Read the body before deciding: Brave names the rejected parameter here, and without it a
      // 422 is indistinguishable from a bad query. Only the sanitized summary is ever logged.
      const body = (await res.json().catch(() => null)) as BraveErrorBody | null;
      const error = braveErrorMessage(res.status, body);
      logEvent('warn', 'web_search_failed', { status: res.status, code: error.code, param: error.param, detail: error.detail });
      throw new ProviderError(error.message, error.retryable);
    }
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? [])
      .filter((r) => r.url && /^https?:\/\//.test(r.url))
      .map((r) => ({ title: strip(r.title ?? '').slice(0, 200), url: r.url!, description: strip(r.description ?? '').slice(0, 400) }));
  },
};
