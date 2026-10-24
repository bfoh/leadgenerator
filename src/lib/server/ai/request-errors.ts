import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { tokenCostUsd } from '@/lib/automation/pricing';
import type { ReportUsage } from '@/lib/domain/types';
import { ProviderError } from '../providers/discovery';

// Paid AI requests are sent once: the SDK's own retries are off (maxRetries: 0), because a request
// that timed out may still have been processed and charged. Every failure says whether it was
// charged (paid-calls.ts), so the job queue never repeats a possibly charged request on its own.

/** Maps an SDK failure to a ProviderError that says whether the request may have been charged. */
export function aiRequestError(error: unknown): unknown {
  // Sent, but no answer arrived: our timeout stopped it, or the connection dropped or timed out.
  if (error instanceof Anthropic.APIUserAbortError || error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('The AI request was sent but no answer arrived, so it may have been charged.', true, 'unknown');
  }
  // An error answer: the API refused the request and charges nothing.
  if (error instanceof Anthropic.AuthenticationError) return new ProviderError('The AI provider rejected the API key. Check ANTHROPIC_API_KEY.', false, 'none');
  if (error instanceof Anthropic.RateLimitError) return new ProviderError('The AI provider is rate limiting requests. Try again shortly.', true, 'none');
  if (error instanceof Anthropic.BadRequestError) return new ProviderError('The AI provider rejected the request. Check the configured model.', false, 'none');
  if (error instanceof Anthropic.APIError) return new ProviderError(`AI provider error (${error.status ?? 'unknown'}).`, true, error.status ? 'none' : 'unknown');
  return error;
}

interface AnsweredResponse {
  model: string;
  usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}

export function responseUsage(response: AnsweredResponse): ReportUsage {
  const inputTokens = (response.usage.input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
  const outputTokens = response.usage.output_tokens ?? 0;
  return { inputTokens, outputTokens, estimatedCostUsd: tokenCostUsd(response.model, inputTokens, outputTokens) };
}

/** An answer that arrived but cannot be used: it was charged, and its cost goes on record. */
export function unusableAnswer(message: string, retryable: boolean, response: AnsweredResponse) {
  return new ProviderError(message, retryable, 'charged', { model: response.model, usage: responseUsage(response) });
}
