import 'server-only';

import { ProviderError } from '../providers/discovery';

// Budget checks reserve a fixed number of input tokens per AI call (src/lib/automation/pricing.ts).
// A token always covers at least one byte of UTF-8 text, so the byte length of everything sent
// (system prompt, message and output schema) is a hard upper bound on the input tokens, whatever
// the text contains. Each AI module checks that bound before calling, so no request can cost more
// than the budget check reserved for it.

const encoder = new TextEncoder();

export const utf8Bytes = (text: string) => encoder.encode(text).length;

/** Upper bound on the input tokens of a request made of these parts. */
export function inputTokenBound(...parts: unknown[]) {
  return parts.reduce<number>((sum, p) => sum + utf8Bytes(typeof p === 'string' ? p : JSON.stringify(p ?? '')), 0);
}

/** Refuses, before anything is spent, a request that could use more input tokens than were reserved. */
export function assertWithinInputBudget(bound: number, reserved: number, advice: string) {
  if (bound > reserved) throw new ProviderError(`This request is larger than one AI call is budgeted for (${bound} bytes, ${reserved} reserved). ${advice}`, false, 'none');
}

/** Cuts text to at most maxBytes of UTF-8 without splitting a character. */
export function clipUtf8(text: string, maxBytes: number) {
  if (utf8Bytes(text) <= maxBytes) return text;
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = utf8Bytes(ch);
    if (bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
  }
  return out;
}
