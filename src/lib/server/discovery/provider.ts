import 'server-only';

import type { DiscoveredRecord, DiscoveryRequest } from '@/lib/domain/discovery-framework';
import type { DiscoverySourceDeclaration } from '@/lib/domain/discovery-sources';

/** One page of normalised provider records. Raw provider payloads stay inside the adapter. */
export interface DiscoveryPage {
  records: DiscoveredRecord[];
  nextCursor: string | null;
}

/**
 * The connector contract. A real provider adapter may only be registered when its source
 * declaration permits unattended search and CRM storage and the owner has approved activation.
 */
export interface DiscoveryProviderAdapter {
  readonly id: string;
  readonly declaration: DiscoverySourceDeclaration;
  isEnabled(): boolean;
  search(request: DiscoveryRequest, signal: AbortSignal): Promise<DiscoveryPage>;
}

export type DiscoveryErrorKind = 'invalid' | 'forbidden' | 'rate_limited' | 'provider' | 'unavailable';

export class DiscoveryProviderError extends Error {
  constructor(
    message: string,
    readonly kind: DiscoveryErrorKind,
    readonly retryable = false,
    /** Whether a failed paid request may have been charged (reserved for future paid connectors). */
    readonly billing: 'none' | 'charged' | 'unknown' = 'none',
  ) {
    super(message);
    this.name = 'DiscoveryProviderError';
  }
}
