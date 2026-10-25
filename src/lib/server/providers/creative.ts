// Optional AI enhancement boundary for the Creative Director. This milestone ships the interface, not a
// model integration. The deterministic engine is the source of truth; an enhancement may only ever
// return the same CreativeDirectionContent structure, never HTML, CSS or animation code.
//
// Nothing here is called by a route or service. Before it could be used, all of the following would
// have to be true:
//
//   1. CREATIVE_DIRECTOR_AI=true, an explicit operator decision (not a default).
//   2. ANTHROPIC_API_KEY present in the server environment.
//   3. The call wrapped in `paidCall` from src/lib/server/usage.ts so the organization's budget,
//      daily quota, usage record and kill switch apply exactly as they do to reports and notes.
//   4. A new review of the prompts and outputs against the creative standard, plus tests for
//      provenance, licence and asset rules.
//
// Until then `isConfigured()` is false and `enhanceCreativeDirection` refuses with a clear message.

import 'server-only';
import type { CreativeBriefContent, CreativeDirectionContent } from '@/lib/domain/creative-direction';

export interface CreativeEnhancementStatus {
  /** True only when the interface is enabled and a key exists; still not an implemented provider. */
  available: boolean;
  enabled: boolean;
  keyPresent: boolean;
  provider: 'anthropic' | null;
  reason: string;
}

export function creativeEnhancementStatus(): CreativeEnhancementStatus {
  const enabled = process.env.CREATIVE_DIRECTOR_AI === 'true';
  const keyPresent = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!enabled) {
    return {
      available: false,
      enabled: false,
      keyPresent,
      provider: null,
      reason: 'AI enhancement is disabled. Set CREATIVE_DIRECTOR_AI=true only after a separate review and budget approval.',
    };
  }
  if (!keyPresent) {
    return {
      available: false,
      enabled: true,
      keyPresent: false,
      provider: null,
      reason: 'AI enhancement is enabled but ANTHROPIC_API_KEY is not configured.',
    };
  }
  return {
    available: false,
    enabled: true,
    keyPresent: true,
    provider: 'anthropic',
    reason: 'The interface exists, but no enhancement provider is implemented in this milestone. The deterministic engine remains authoritative.',
  };
}

export interface CreativeEnhancementRequest {
  brief: CreativeBriefContent;
  direction: CreativeDirectionContent;
  /** Only the three concept keys and editorial fields may be revised; provenance and permissions may not. */
  instruction: string;
}

export type CreativeEnhancer = (request: CreativeEnhancementRequest, signal?: AbortSignal) => Promise<CreativeDirectionContent>;

/** Refuses every call in this milestone, configured or not. */
export const enhanceCreativeDirection: CreativeEnhancer = async () => {
  const status = creativeEnhancementStatus();
  throw new Error(
    status.provider
      ? 'AI enhancement is not implemented. The deterministic Creative Director remains authoritative; no provider call was made.'
      : status.reason,
  );
};
