// Normal test runs must never reach a real service, paid APIs above all: any fetch to a host other
// than this machine fails loudly. Tests that need a provider replace fetch with a fake
// (vi.stubGlobal) or inject one. Live checks against real providers run only through
// `npm run test:live`, which is opt-in and budget-capped (tests/live).

const realFetch = globalThis.fetch;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostOf(input: Parameters<typeof fetch>[0]) {
  try {
    return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname;
  } catch {
    return '';
  }
}

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const host = hostOf(input);
  if (!LOCAL.has(host)) throw new Error(`Blocked a network request to ${host || 'an unknown host'} during tests. Use a fake provider; live checks run only with npm run test:live.`);
  return realFetch(input, init);
}) as typeof fetch;
