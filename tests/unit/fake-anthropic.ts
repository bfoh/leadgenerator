import { vi } from 'vitest';

// A stand-in for @anthropic-ai/sdk: the error classes the app checks, and spies for the two calls it
// makes (model lookup and structured parse). Use with
//   vi.mock('@anthropic-ai/sdk', () => import('./fake-anthropic'));
// so nothing leaves the machine and nothing is paid for.

export const sdk = { retrieve: vi.fn(), parse: vi.fn() };

class APIError extends Error {
  constructor(
    readonly status?: number,
    message = 'API error',
  ) {
    super(message);
  }
}

export default class Anthropic {
  static APIError = APIError;
  static NotFoundError = class extends APIError {};
  static AuthenticationError = class extends APIError {};
  static RateLimitError = class extends APIError {};
  static BadRequestError = class extends APIError {};
  static APIConnectionError = class extends APIError {};
  models = { retrieve: (...args: unknown[]) => sdk.retrieve(...args) };
  beta = { messages: { parse: (...args: unknown[]) => sdk.parse(...args) } };
}
