import 'server-only';

import type { Billing } from '@/lib/automation/paid-calls';
import type { ReportUsage } from '@/lib/domain/types';

// Discovery providers declare what their data may be used for. The UI shows these declarations,
// and only fields listed in `storableFields` may ever be written to the CRM.

export interface DiscoveryQuery {
  country: string;
  region: string | null;
  /** Null searches the whole region. */
  city: string | null;
  neighborhood: string | null;
  category: string;
  terms: string | null;
  limit: number;
  pageToken: string | null;
}

/** Where a search looks: the town (and neighbourhood), or the whole region when no town is given. */
export function searchArea(q: Pick<DiscoveryQuery, 'region' | 'city' | 'neighborhood'>): string {
  const region = q.region && (/\bregion$/i.test(q.region) ? q.region : `${q.region} Region`);
  return [q.neighborhood, q.city ?? region].filter(Boolean).join(', ');
}

export interface DiscoveryResult {
  providerId: string;
  externalId: string;
  name: string;
  address: string | null;
  websiteUri: string | null;
  mapsUri: string | null;
  businessStatus: string | null;
  primaryType: string | null;
  phone: string | null;
  isDemo: boolean;
}

export interface DiscoveryPage {
  results: DiscoveryResult[];
  nextPageToken: string | null;
}

export interface ProviderCapabilities {
  search: boolean;
  details: boolean;
  websiteField: boolean;
  phoneInDetails: boolean;
  emailField: false;
  maxPageSize: number;
  isDemo: boolean;
}

export interface AttributionRequirements {
  text: string;
  url: string | null;
  notes: string;
}

export interface RetentionRules {
  storableFields: (keyof DiscoveryResult)[];
  displayOnlyFields: (keyof DiscoveryResult)[];
  cacheSeconds: number;
  policyUrl: string | null;
  notes: string;
}

export interface DiscoveryProvider {
  readonly id: string;
  readonly name: string;
  isConfigured(): boolean;
  getCapabilities(): ProviderCapabilities;
  getAttributionRequirements(): AttributionRequirements;
  getRetentionRules(): RetentionRules;
  estimatedCostUsd(operation: 'search' | 'details'): number;
  search(query: DiscoveryQuery, signal: AbortSignal): Promise<DiscoveryPage>;
  getDetails(externalId: string, signal: AbortSignal): Promise<DiscoveryResult | null>;
}

export class ProviderError extends Error {
  /**
   * @param billing whether a failed paid request was charged, when the caller knows (paid-calls.ts);
   *   left out, the paid-request ledger assumes it may have been.
   * @param charge the cost of an answer that arrived but could not be used.
   */
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly billing?: Billing,
    readonly charge?: { model: string; usage: ReportUsage },
  ) {
    super(message);
  }
}

export function describeProvider(p: DiscoveryProvider) {
  return {
    id: p.id,
    name: p.name,
    configured: p.isConfigured(),
    capabilities: p.getCapabilities(),
    attribution: p.getAttributionRequirements(),
    retention: p.getRetentionRules(),
    estimatedCostUsd: { search: p.estimatedCostUsd('search'), details: p.estimatedCostUsd('details') },
  };
}
export type ProviderDescription = ReturnType<typeof describeProvider>;
