import 'server-only';

// What a provider call can end in. "uncertain" means the request may have reached the provider (a
// timeout, a dropped connection, a 5xx): the message is marked delivery unknown and never retried
// automatically, so nobody is messaged twice.

export type SendOutcome =
  | { ok: true; providerMessageId: string }
  | { ok: false; kind: 'rejected' | 'uncertain'; status: number | null; detail: string };

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function postJson(fetchImpl: FetchLike, url: string, init: { headers: Record<string, string>; body: unknown; timeoutMs: number }): Promise<{ status: number; body: unknown } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...init.headers }, body: JSON.stringify(init.body), signal: controller.signal, redirect: 'error' });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (error) {
    return { error: controller.signal.aborted ? 'The provider did not answer in time.' : `The connection failed (${error instanceof Error ? error.name : 'unknown'}).` };
  } finally {
    clearTimeout(timer);
  }
}

/** Short, secret-free provider error text. */
export function providerDetail(body: unknown, fallback: string) {
  const b = body as { message?: unknown; name?: unknown; error?: { message?: unknown; code?: unknown } } | null;
  const text = [b?.name, b?.message, b?.error?.code, b?.error?.message].filter((v) => typeof v === 'string' || typeof v === 'number').join(' — ');
  return (text || fallback).slice(0, 300);
}
