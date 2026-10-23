import 'server-only';

import { serverEnv } from '../env';
import { ProviderError } from './discovery';

// Independent web search used during website verification (not for building lead lists).
// Brave Search API terms: results are used transiently to decide which sites to check; result
// titles and snippets are never stored. Requests are paced to stay inside the plan's rate limit.

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export interface WebSearchProvider {
  readonly id: string;
  readonly name: string;
  isConfigured(): boolean;
  estimatedCostUsd(): number;
  search(query: string, signal: AbortSignal): Promise<WebSearchResult[]>;
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
  async search(query, signal) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', '10');
    url.searchParams.set('country', 'GH');
    url.searchParams.set('safesearch', 'moderate');
    await pace(signal);
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': serverEnv.braveKey() }, signal, cache: 'no-store' });
    } catch {
      throw new ProviderError('Web search did not respond.', true);
    }
    if (res.status === 429) throw new ProviderError('Web search rate limit reached.', true);
    if (!res.ok) throw new ProviderError(`Web search failed (${res.status}).`, res.status >= 500);
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? [])
      .filter((r) => r.url && /^https?:\/\//.test(r.url))
      .map((r) => ({ title: strip(r.title ?? '').slice(0, 200), url: r.url!, description: strip(r.description ?? '').slice(0, 400) }));
  },
};
