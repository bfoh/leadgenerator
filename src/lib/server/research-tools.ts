import 'server-only';

import type { MxResult } from '@/lib/domain/contacts';
import type { SearchHit } from '@/lib/domain/website-assessment';
import type { RequestContext } from './context';
import { probeDomain } from './domains';
import { serverEnv } from './env';
import { HttpError } from './http';
import { enforceBudget } from './budget';
import { lookupMx } from './mx';
import { SIMULATED_PROVIDER_NAME, simulatedContactPage, simulatedInspect, simulatedMx, simulatedProbe, simulatedSearch } from './providers/simulated-research';
import { braveSearchProvider } from './providers/web-search';
import { fetchContactPage, inspectWebsite, parsePublicUrl, UnsafeUrlError, type ContactPage, type InspectedPage } from './safe-fetch';
import { enforceQuota, recordUsage, type UsageCharge } from './usage';

// Website-verification and contact-research tools shared by the route handlers (browser agents and
// buttons) and the server-side agent gateway. Each call is quota-checked and metered the same way.

/** Route rate limits. The simulated test world makes no outside calls, so test runs are not throttled. */
export function researchRateLimit(count: number) {
  return { count: serverEnv.simulateExternalTools() ? 2_000 : count, windowMs: 60_000 };
}

export interface ResearchToolStatus {
  simulated: boolean;
  search: { configured: boolean; provider: string | null; costPerQueryUsd: number };
}

export function researchToolStatus(): ResearchToolStatus {
  const simulated = serverEnv.simulateExternalTools();
  return {
    simulated,
    search: simulated
      ? { configured: true, provider: SIMULATED_PROVIDER_NAME, costPerQueryUsd: 0 }
      : { configured: braveSearchProvider.isConfigured(), provider: braveSearchProvider.isConfigured() ? braveSearchProvider.name : null, costPerQueryUsd: braveSearchProvider.estimatedCostUsd() },
  };
}

export interface SearchOutcome {
  hits: SearchHit[];
  provider: string;
  simulated: boolean;
  usage: UsageCharge;
}

/** One web search. Results are returned to the caller only; they are not stored (provider terms). */
export async function runWebSearch(ctx: RequestContext, query: string, meta: { jobId?: string | null; purpose?: string | null } = {}): Promise<SearchOutcome> {
  if (serverEnv.simulateExternalTools()) {
    return { hits: simulatedSearch(query), provider: SIMULATED_PROVIDER_NAME, simulated: true, usage: { provider: 'simulated_search', operation: 'web_search', units: 1, estimatedCostUsd: 0 } };
  }
  if (!braveSearchProvider.isConfigured()) throw new HttpError(503, 'Web search is not configured (BRAVE_SEARCH_API_KEY). Use the manual search links instead.');
  await enforceQuota(ctx, 'web_search', serverEnv.quota.webSearch());
  await enforceBudget(ctx, { brave_search: braveSearchProvider.estimatedCostUsd() });
  const hits = await braveSearchProvider.search(query, AbortSignal.timeout(10_000));
  const usage = await recordUsage(ctx, {
    provider: braveSearchProvider.id,
    operation: 'web_search',
    units: 1,
    estimatedCostUsd: braveSearchProvider.estimatedCostUsd(),
    // The query and its purpose, never the results.
    metadata: meta.jobId || meta.purpose ? { jobId: meta.jobId ?? null, purpose: meta.purpose ?? null } : null,
  });
  return { hits, provider: braveSearchProvider.name, simulated: false, usage };
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function cleanDomains(list: string[]) {
  return [...new Set(list.map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '')).filter((d) => DOMAIN.test(d)))];
}

/** DNS lookups only: shows that a name resolves, never who owns it. */
export async function runDomainProbes(ctx: RequestContext, domains: string[]) {
  const list = cleanDomains(domains).slice(0, 10);
  if (serverEnv.simulateExternalTools()) return { results: list.map(simulatedProbe), simulated: true, usage: null };
  await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
  const results = (await Promise.all(list.map(probeDomain))).map(({ domain, resolves }) => ({ domain, resolves }));
  const usage = await recordUsage(ctx, { provider: 'dns', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { probes: list.length } });
  return { results, simulated: false, usage };
}

/** An automated homepage check: SSRF-guarded, robots.txt first, size and time limited. */
export async function runInspection(ctx: RequestContext, url: string): Promise<InspectedPage & { simulated: boolean; usage: UsageCharge | null }> {
  assertPublicUrl(url);
  if (serverEnv.simulateExternalTools()) return { ...simulatedInspect(url), simulated: true, usage: null };
  await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
  const page = await inspectWebsite(url);
  const usage = await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { automated: true, robots: page.robots } });
  return { ...page, simulated: false, usage };
}

function assertPublicUrl(url: string) {
  try {
    parsePublicUrl(url);
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new HttpError(400, e.message);
    throw e;
  }
}

/**
 * One page of a business's own website read for the contact details it publishes (robots.txt
 * first). Counts toward the website-check quota. The caller decides which pages: the verified
 * official homepage and at most one contact page it links to.
 */
export async function runContactPage(ctx: RequestContext, url: string): Promise<ContactPage & { simulated: boolean; usage: UsageCharge | null }> {
  assertPublicUrl(url);
  if (serverEnv.simulateExternalTools()) return { ...simulatedContactPage(url), simulated: true, usage: null };
  await enforceQuota(ctx, 'website_check', serverEnv.quota.websiteChecks());
  const page = await fetchContactPage(url);
  const usage = await recordUsage(ctx, { provider: 'http_check', operation: 'website_check', units: 1, estimatedCostUsd: 0, metadata: { automated: true, purpose: 'contacts', robots: page.robots } });
  return { ...page, simulated: false, usage };
}

/** Mail-server lookups for email domains (DNS only; mailboxes are never probed). */
export async function runMxLookups(ctx: RequestContext, domains: string[]): Promise<{ results: MxResult[]; simulated: boolean; usage: UsageCharge | null }> {
  const list = cleanDomains(domains).slice(0, 10);
  if (!list.length) return { results: [], simulated: serverEnv.simulateExternalTools(), usage: null };
  if (serverEnv.simulateExternalTools()) return { results: list.map(simulatedMx), simulated: true, usage: null };
  await enforceQuota(ctx, 'mx_lookup', serverEnv.quota.mxLookups());
  const results = await Promise.all(list.map(lookupMx));
  const usage = await recordUsage(ctx, { provider: 'dns', operation: 'mx_lookup', units: 1, estimatedCostUsd: 0, metadata: { domains: list.length } });
  return { results, simulated: false, usage };
}
