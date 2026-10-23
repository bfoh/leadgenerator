// Published Anthropic prices in USD per million tokens (input, output), used for cost estimates and
// budget checks only. Shared by the browser (estimates) and the server (recorded cost).

export const MODEL_PRICING: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
};

const FALLBACK = MODEL_PRICING['claude-opus-5-5'];

export function tokenCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const [inRate, outRate] = MODEL_PRICING[model] ?? FALLBACK;
  return Math.round(((inputTokens * inRate + outputTokens * outRate) / 1_000_000) * 10_000) / 10_000;
}

/**
 * Report generation allows up to 16k output tokens. Input is the system prompt plus the evidence
 * pack (at most 80 clipped items), typically 3–8k tokens; 30k is a conservative upper bound.
 */
export const REPORT_MAX_INPUT_TOKENS = 30_000;
export const REPORT_MAX_OUTPUT_TOKENS = 16_000;

/** Upper-bound estimate used before an AI report call (the actual cost is recorded afterwards). */
export function aiReportEstimateUsd(model: string) {
  return tokenCostUsd(model, REPORT_MAX_INPUT_TOKENS, REPORT_MAX_OUTPUT_TOKENS);
}

/**
 * Personal notes for message drafts: one sentence (structured output under 1k tokens) from the same
 * evidence pack as a report; 20k input tokens is a conservative upper bound.
 */
export const NOTE_MAX_INPUT_TOKENS = 20_000;
export const NOTE_MAX_OUTPUT_TOKENS = 1_000;

export function aiNoteEstimateUsd(model: string) {
  return tokenCostUsd(model, NOTE_MAX_INPUT_TOKENS, NOTE_MAX_OUTPUT_TOKENS);
}

/**
 * Reply classification: one received message, cut to 12,000 bytes after escaping, plus a system
 * prompt under 2,000 bytes and the output schema; the answer is a short structured reading. A token
 * covers at least one byte, so 16k input tokens is a hard upper bound whatever the reply contains (a
 * typical reply is 1–2k tokens). The classifier refuses before calling if the bound is exceeded.
 */
export const CLASSIFY_MAX_INPUT_TOKENS = 16_000;
export const CLASSIFY_MAX_OUTPUT_TOKENS = 600;

export function aiClassifyEstimateUsd(model: string) {
  return tokenCostUsd(model, CLASSIFY_MAX_INPUT_TOKENS, CLASSIFY_MAX_OUTPUT_TOKENS);
}
