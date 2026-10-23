import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The network layer of safe-fetch with node:http(s) replaced by a scripted fake: robots.txt handling
// (RFC 9309), per-origin checks across redirects, SSRF validation of redirect targets, and the
// difference between a person's status check and an agent's inspection. No socket is opened.

type Reply = { status: number; headers?: Record<string, string>; body?: string } | Error;

const net = vi.hoisted(() => ({
  routes: new Map<string, Reply>(),
  requests: [] as { url: string; userAgent: string }[],
}));

vi.mock('node:https', () => ({ default: { request: (url: URL, options: { headers: Record<string, string> }, cb: (res: unknown) => void) => fakeRequest(url, options, cb) } }));
vi.mock('node:http', () => ({ default: { request: (url: URL, options: { headers: Record<string, string> }, cb: (res: unknown) => void) => fakeRequest(url, options, cb) } }));

function fakeRequest(url: URL, options: { headers: Record<string, string> }, onResponse: (res: unknown) => void) {
  const req = Object.assign(new EventEmitter(), {
    destroy: (error?: Error) => error && req.emit('error', error),
    end: () => {
      net.requests.push({ url: url.href, userAgent: options.headers['User-Agent'] });
      const reply = net.routes.get(url.href) ?? { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
      queueMicrotask(() => {
        if (reply instanceof Error) return void req.emit('error', reply);
        const res = Object.assign(new EventEmitter(), { statusCode: reply.status, headers: reply.headers ?? {}, resume: () => {}, destroy: () => {} });
        onResponse(res);
        if (reply.body) res.emit('data', Buffer.from(reply.body));
        res.emit('close');
      });
    },
  });
  return req;
}

const { checkWebsite, inspectWebsite } = await import('@/lib/server/safe-fetch');

const HOME = '<!doctype html><html><head><title>Adom Bridal House | Accra</title><meta name="viewport" content="width=device-width"></head><body><h1>Adom Bridal House</h1><p>Osu, Accra</p></body></html>';
const html = (body = HOME) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
const robots = (body: string) => ({ status: 200, headers: { 'content-type': 'text/plain' }, body });
const requested = () => net.requests.map((r) => r.url);

beforeEach(() => {
  net.routes.clear();
  net.requests.length = 0;
});

describe('automated inspection honours robots.txt', () => {
  it('a missing robots.txt (4xx) means no restrictions', async () => {
    net.routes.set('https://adombridalhouse.com/', html());
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page.robots).toBe('allowed');
    expect(page.check).toMatchObject({ ok: true, status: 200, title: 'Adom Bridal House | Accra', hasViewport: true });
    expect(page.facts?.title).toMatch(/Adom Bridal House/);
    expect(requested()).toEqual(['https://adombridalhouse.com/robots.txt', 'https://adombridalhouse.com/']);
    // Both requests identify the agent by the product token robots.txt groups match on.
    expect(net.requests.every((r) => /honours robots\.txt/.test(r.userAgent))).toBe(true);
  });

  it('a disallow rule stops the page request', async () => {
    net.routes.set('https://adombridalhouse.com/robots.txt', robots('User-agent: *\nDisallow: /'));
    net.routes.set('https://adombridalhouse.com/', html());
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page).toEqual({ check: null, facts: null, robots: 'disallowed' });
    expect(requested()).toEqual(['https://adombridalhouse.com/robots.txt']);
  });

  it('a server error on robots.txt (5xx) is treated as disallowed and recorded as a failed check', async () => {
    net.routes.set('https://adombridalhouse.com/robots.txt', { status: 503 });
    net.routes.set('https://adombridalhouse.com/', html());
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page.robots).toBe('disallowed');
    expect(page.check).toMatchObject({ ok: false, status: 503 });
    expect(page.check?.error).toMatch(/robots\.txt; the page was not requested/);
    expect(requested()).not.toContain('https://adombridalhouse.com/');
  });

  it('a network failure on robots.txt is recorded and the page is not requested', async () => {
    net.routes.set('https://adombridalhouse.com/robots.txt', Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page.robots).toBe('unavailable');
    expect(page.check).toMatchObject({ ok: false, error: 'Domain does not resolve' });
    expect(requested()).toEqual(['https://adombridalhouse.com/robots.txt']);
  });

  it('checks robots.txt again for each new origin in a redirect chain', async () => {
    net.routes.set('https://adombridalhouse.com/', { status: 301, headers: { location: 'https://shop.example-builder.com/adom' } });
    net.routes.set('https://shop.example-builder.com/robots.txt', robots('User-agent: *\nDisallow: /adom'));
    net.routes.set('https://shop.example-builder.com/adom', html());
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page.robots).toBe('disallowed');
    expect(requested()).toEqual(['https://adombridalhouse.com/robots.txt', 'https://adombridalhouse.com/', 'https://shop.example-builder.com/robots.txt']);
  });

  it('follows a same-origin redirect with one robots.txt fetch', async () => {
    net.routes.set('https://adombridalhouse.com/', { status: 302, headers: { location: '/home' } });
    net.routes.set('https://adombridalhouse.com/home', html());
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page.check).toMatchObject({ ok: true, finalUrl: 'https://adombridalhouse.com/home', redirects: [{ url: 'https://adombridalhouse.com/', status: 302 }] });
    expect(requested().filter((u) => u.endsWith('/robots.txt'))).toHaveLength(1);
  });
});

describe('redirect safety', () => {
  it('refuses a redirect to a private address without requesting it', async () => {
    net.routes.set('https://adombridalhouse.com/', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    const page = await inspectWebsite('https://adombridalhouse.com/');
    expect(page.check?.ok).toBe(false);
    expect(page.check?.error).toMatch(/Private/);
    expect(requested().some((u) => u.includes('169.254'))).toBe(false);
  });

  it('follows at most five redirects and refuses the sixth', async () => {
    for (let i = 0; i < 7; i++) net.routes.set(`https://adombridalhouse.com/${i || ''}`, { status: 302, headers: { location: `/${i + 1}` } });
    const check = await checkWebsite('https://adombridalhouse.com/');
    expect(check).toMatchObject({ ok: false, error: 'Too many redirects' });
    expect(check.redirects).toHaveLength(6);
  });
});

describe("a person's status check", () => {
  it('requests only the homepage and reports HTTP errors', async () => {
    net.routes.set('https://adombridalhouse.com/', { status: 503, headers: { 'content-type': 'text/html' }, body: '<title>Down</title>' });
    const check = await checkWebsite('https://adombridalhouse.com/');
    expect(check).toMatchObject({ ok: false, status: 503, error: 'HTTP 503' });
    expect(requested()).toEqual(['https://adombridalhouse.com/']);
    expect(net.requests[0].userAgent).toMatch(/single on-demand website status check/);
  });
});
