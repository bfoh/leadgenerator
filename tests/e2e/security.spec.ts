import { expect, test } from '@playwright/test';

test('status endpoint exposes configuration booleans, never secrets', async ({ request }) => {
  const res = await request.get('/api/status');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|sk-ant-|BSA[0-9A-Za-z]{20,}|service_role/);
  // The suite blanks every paid key, so nothing here can be billed.
  expect(body.ai.configured).toBe(false);
  expect(body.webSearch.configured).toBe(false);
  expect(body.discovery.filter((p: { configured: boolean; capabilities: { isDemo: boolean } }) => p.configured && !p.capabilities.isDemo)).toEqual([]);
});

test('server tools reject cross-origin writes', async ({ request }) => {
  const res = await request.post('/api/verify/website', { data: { url: 'example.com' }, headers: { Origin: 'https://attacker.example' } });
  expect(res.status()).toBe(403);
});

test('website checks refuse private network targets', async ({ request, baseURL }) => {
  const res = await request.post('/api/verify/website', { data: { url: 'http://169.254.169.254/latest/meta-data' }, headers: { Origin: new URL(baseURL!).origin } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error).toMatch(/private/i);
});

test('the Studio reading goes through the same guards as website verification', async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const crossOrigin = await request.post('/api/studio/inspect', { data: { url: 'example.com' }, headers: { Origin: 'https://attacker.example' } });
  expect(crossOrigin.status()).toBe(403);
  const internal = await request.post('/api/studio/inspect', { data: { url: 'http://169.254.169.254/latest/meta-data' }, headers: { Origin: origin } });
  expect(internal.status()).toBe(400);
  expect((await internal.json()).error).toMatch(/private/i);
  // A page it can read returns structural facts only — never the page's own text.
  const readable = await request.post('/api/studio/inspect', { data: { url: 'https://e2estudiobakery.com' }, headers: { Origin: origin } });
  expect(readable.ok()).toBe(true);
  const body = await readable.json();
  expect(body.simulated).toBe(true);
  expect(Object.keys(body.facts).sort()).toEqual(
    expect.arrayContaining(['title', 'h1', 'description', 'hasViewport', 'wordCount', 'logoCandidates', 'imageCandidates', 'navLinks']),
  );
  expect(JSON.stringify(body)).not.toMatch(/<!doctype html|<body/i);
});

test('security headers are set', async ({ request }) => {
  const res = await request.get('/login');
  const h = res.headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBeTruthy();
  expect(h['x-frame-options']).toBe('DENY');
  // The page may load only its own code and send data only to itself (and Supabase when configured).
  const csp = h['content-security-policy'];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toMatch(/connect-src 'self'(;|$)/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain('unsafe-eval');
});

test('messaging endpoints refuse unsigned webhooks, bad tokens and demo dispatch, and expose no secrets', async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  // Webhooks without configured secrets answer 503 before reading anything; never 2xx when unsigned.
  const email = await request.post('/api/webhooks/email', { data: { type: 'email.delivered', data: { email_id: 'x' } } });
  expect([401, 503]).toContain(email.status());
  const whatsapp = await request.post('/api/webhooks/whatsapp', { data: { entry: [] } });
  expect([401, 503]).toContain(whatsapp.status());
  const verify = await request.get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=abc');
  expect(verify.status()).toBe(403);
  expect(await verify.text()).not.toContain('abc');

  // Unsubscribe links never reflect what they are given.
  const unsubscribe = await request.get('/api/messaging/unsubscribe?t=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  expect(unsubscribe.status()).toBeGreaterThanOrEqual(400);
  expect(await unsubscribe.text()).not.toMatch(/<script>/i);

  // Demo mode never dispatches from the server.
  const dispatch = await request.post('/api/messaging/dispatch', { data: { messageId: '00000000-0000-4000-8000-000000000000' }, headers: { Origin: origin } });
  expect(dispatch.ok()).toBe(false);

  const status = await request.get('/api/messaging/status', { headers: { Origin: origin } });
  if (status.ok()) expect(JSON.stringify(await status.json())).not.toMatch(/re_[A-Za-z0-9]{10,}|whsec_|EAA[A-Za-z0-9]{10,}|service_role/);
});
