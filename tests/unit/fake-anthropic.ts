import { vi } from 'vitest';

// A stand-in for @anthropic-ai/sdk: the error classes the app checks, spies for the two calls it
// makes (model lookup and structured parse), and the options each client was created with. Use with
//   vi.mock('@anthropic-ai/sdk', () => import('./fake-anthropic'));
// so nothing leaves the machine and nothing is paid for.

export const sdk = { retrieve: vi.fn(), parse: vi.fn(), clients: [] as Record<string, unknown>[] };

class APIError extends Error {
  constructor(
    readonly status?: number,
    message = 'API error',
  ) {
    super(message);
  }
}

class APIConnectionError extends APIError {}

export default class Anthropic {
  static APIError = APIError;
  static NotFoundError = class extends APIError {};
  static AuthenticationError = class extends APIError {};
  static RateLimitError = class extends APIError {};
  static BadRequestError = class extends APIError {};
  static InternalServerError = class extends APIError {};
  static APIConnectionError = APIConnectionError;
  static APIConnectionTimeoutError = class extends APIConnectionError {};
  static APIUserAbortError = class extends APIError {};
  constructor(options: Record<string, unknown> = {}) {
    sdk.clients.push(options);
  }
  models = { retrieve: (...args: unknown[]) => sdk.retrieve(...args) };
  beta = { messages: { parse: (...args: unknown[]) => sdk.parse(...args) } };
}
