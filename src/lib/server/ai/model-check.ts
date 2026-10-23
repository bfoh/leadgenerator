import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { serverEnv } from '../env';
import { ProviderError } from '../providers/discovery';

// Confirms the configured model exists for this API key and supports what report generation needs
// (structured outputs, the effort setting), using the free Models API rather than assuming a
// hard-coded model is still available. Results are cached per model for ten minutes.

export interface ModelCheck {
  model: string;
  available: boolean;
  displayName: string | null;
  structuredOutputs: boolean | null;
  effort: boolean | null;
  maxOutputTokens: number | null;
  checkedAt: string;
  error: string | null;
  /** The check itself failed (network, provider error); nothing is concluded about the model. */
  transient?: boolean;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; result: ModelCheck }>();

export async function checkModel(force = false): Promise<ModelCheck> {
  const model = serverEnv.anthropicModel();
  const hit = cache.get(model);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.result;

  const base = { model, checkedAt: new Date().toISOString() };
  let result: ModelCheck;
  if (!serverEnv.anthropicKey()) {
    result = { ...base, available: false, displayName: null, structuredOutputs: null, effort: null, maxOutputTokens: null, error: 'ANTHROPIC_API_KEY is not set.' };
  } else {
    try {
      const client = new Anthropic({ apiKey: serverEnv.anthropicKey(), timeout: 10_000, maxRetries: 1 });
      const info = await client.models.retrieve(model);
      const caps = info.capabilities;
      result = {
        ...base,
        available: true,
        displayName: info.display_name,
        structuredOutputs: caps ? caps.structured_outputs.supported : null,
        effort: caps ? caps.effort.supported : null,
        maxOutputTokens: info.max_tokens,
        error: caps && !caps.structured_outputs.supported ? `${info.display_name} does not support structured outputs, which report generation needs.` : null,
      };
    } catch (error) {
      const message =
        error instanceof Anthropic.NotFoundError
          ? `The model “${model}” is not available to this API key. Set ANTHROPIC_MODEL to a current model.`
          : error instanceof Anthropic.AuthenticationError
            ? 'The AI provider rejected the API key. Check ANTHROPIC_API_KEY.'
            : error instanceof Anthropic.APIError
              ? `The model check failed (${error.status ?? 'network'}); try again shortly.`
              : 'Could not reach the AI provider to check the model.';
      // An unreachable provider is not proof the model is gone: don't cache it for long.
      const definitive = error instanceof Anthropic.NotFoundError || error instanceof Anthropic.AuthenticationError;
      result = { ...base, available: false, displayName: null, structuredOutputs: null, effort: null, maxOutputTokens: null, error: message, transient: !definitive };
      if (!definitive) {
        cache.set(model, { at: Date.now() - TTL_MS + 30_000, result });
        return result;
      }
    }
  }
  cache.set(model, { at: Date.now(), result });
  return result;
}

/** Refuses (before any paid call) when the model cannot be used for reports. */
export function assertUsable(check: ModelCheck) {
  if (!check.available || check.structuredOutputs === false) throw new ProviderError(check.error ?? `The model “${check.model}” cannot be used for reports.`, Boolean(check.transient));
}
