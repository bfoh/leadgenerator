import type { Instrumentation } from 'next';

// Server errors from pages, route handlers and the proxy (phase 10 monitoring). Logs the route, the
// kind of request and the error's name and digest only: no message text, query string or headers,
// which may carry personal data or tokens.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logEvent } = await import('@/lib/server/log');
  await logEvent('error', 'request_error', {
    route: context.routePath,
    routeType: context.routeType,
    method: request.method,
    path: request.path.split('?')[0],
    error: err instanceof Error ? err.name : typeof err,
    digest: typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest) : null,
  });
};
