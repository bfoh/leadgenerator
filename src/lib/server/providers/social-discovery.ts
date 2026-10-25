import 'server-only';

import {
  SOCIAL_DISCOVERY_PLATFORMS,
  buildSocialQueries,
  dedupeSocialCandidates,
  simulatedSocialCandidates,
  socialCandidateFromHit,
  type SocialCandidate,
  type SocialDiscoveryRequest,
  type SocialQuery,
} from '@/lib/domain/social-discovery';
import { serverEnv } from '../env';
import { ProviderError } from './discovery';
import { braveSearchProvider, type WebSearchProvider } from './web-search';

// Social discovery searches a public web index for business profiles. It never calls a platform's
// own search API: none of Instagram, Facebook or TikTok licenses keyword lead search, and their
// page content may not be harvested. Every result is transient review material held in the browser
// for the session; only what a person independently confirms may reach the CRM.

export interface SocialDiscoveryStatus {
  /** External tools are simulated: a labelled fictional world, no network and no cost. */
  simulated: boolean;
  /** A social search will be answered right now. */
  enabled: boolean;
  /** The live path is switched on and a search key is present. */
  liveEnabled: boolean;
  /** A web-search provider has a key on this server. */
  searchConfigured: boolean;
  costPerQueryUsd: number;
  /** Paid queries allowed per 24 hours for one workspace. */
  quota: number;
  /** At most one query per platform. */
  maxQueries: number;
}

export function socialDiscoveryStatus(): SocialDiscoveryStatus {
  const simulated = serverEnv.simulateExternalTools();
  const searchConfigured = braveSearchProvider.isConfigured();
  const liveEnabled = serverEnv.socialDiscovery.enabled() && searchConfigured;
  return {
    simulated,
    enabled: simulated || liveEnabled,
    liveEnabled,
    searchConfigured,
    costPerQueryUsd: braveSearchProvider.estimatedCostUsd(),
    quota: serverEnv.socialDiscovery.quota(),
    maxQueries: SOCIAL_DISCOVERY_PLATFORMS.length,
  };
}

export interface SocialDiscoveryOutcome {
  candidates: SocialCandidate[];
  queries: SocialQuery[];
  simulated: boolean;
  costPerQueryUsd: number;
  estimatedCostUsd: number;
  retrievedAt: string;
}

interface SearchOptions {
  signal: AbortSignal;
  /** Injected in tests; the Brave adapter in production. */
  search?: WebSearchProvider;
  /** Called once per answered query, so the caller can record its cost as it is incurred. */
  onQueryAnswered?: (query: SocialQuery) => Promise<void> | void;
}

export async function searchSocialCandidates(input: SocialDiscoveryRequest, opts: SearchOptions): Promise<SocialDiscoveryOutcome> {
  const status = socialDiscoveryStatus();
  if (!status.enabled) {
    throw new ProviderError(
      status.searchConfigured ? 'Social discovery is switched off on this server.' : 'Social discovery needs a web-search API key on the server.',
      false,
    );
  }

  const queries = buildSocialQueries(input);
  if (!queries.length) throw new ProviderError('Choose at least one social platform.', false);

  if (status.simulated) {
    return {
      candidates: dedupeSocialCandidates(simulatedSocialCandidates(input)),
      queries,
      simulated: true,
      costPerQueryUsd: 0,
      estimatedCostUsd: 0,
      retrievedAt: new Date().toISOString(),
    };
  }

  const search = opts.search ?? braveSearchProvider;
  const candidates: SocialCandidate[] = [];
  for (const query of queries) {
    // The country travels as a hint only: Brave's `country` list has no Ghana, so the provider
    // replaces it with ALL and the place words stay in the query text (see buildSocialQueries).
    const hits = await search.search(query.query, opts.signal, { country: input.country });
    for (const hit of hits) {
      const candidate = socialCandidateFromHit(hit, query.platform, input, query.query);
      if (candidate) candidates.push(candidate);
    }
    // Recorded per query: a later failure must not hide a request that was already paid for.
    await opts.onQueryAnswered?.(query);
  }

  return {
    candidates: dedupeSocialCandidates(candidates),
    queries,
    simulated: false,
    costPerQueryUsd: search.estimatedCostUsd(),
    estimatedCostUsd: queries.length * search.estimatedCostUsd(),
    retrievedAt: new Date().toISOString(),
  };
}
