// Phase 10 monitoring and worker security: the operational alerts behind the System health card,
// redacted structured logs (and their optional forwarding), and the scheduled worker route refusing
// callers without the cron secret before it touches the database. The credentials below are
// placeholders, not keys.

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const ENV = vi.hoisted(() => {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-role',
    CRON_SECRET: 'placeholder-cron-secret-0123456789',
  };
  const previous = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
  Object.assign(process.env, values);
  return { values, previous };
});

const service = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/lib/supabase/service', () => ({
  serviceRoleKey: () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  serviceSupabase: () => {
    service.calls++;
    throw new Error('The database must not be reached by an unauthorized caller.');
  },
}));

import { NextRequest } from 'next/server';
import { GET as cron } from '@/app/api/cron/automation/route';
import { operationalAlerts, type HealthSnapshot } from '@/lib/domain/monitoring';
import { logEvent, redact } from '@/lib/server/log';

afterAll(() => {
  for (const [k, v] of Object.entries(ENV.previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.ERROR_REPORT_URL;
});

const calm: HealthSnapshot = {
  failedJobs: 0,
  stuckJobs: 0,
  awaitingApproval: 0,
  deliveryUnknown: 0,
  failedMessages: 0,
  overdueOptOutTasks: 0,
  staleChangeRequests: 0,
  budgets: [],
  automationPaused: false,
  sendingPaused: false,
};

describe('operational alerts', () => {
  it('stay quiet when nothing needs a person', () => {
    expect(operationalAlerts(calm)).toEqual([]);
  });

  it('put compliance and uncertain deliveries first, then budgets, failures and notes', () => {
    const alerts = operationalAlerts({
      ...calm,
      failedJobs: 2,
      stuckJobs: 1,
      awaitingApproval: 1,
      deliveryUnknown: 1,
      overdueOptOutTasks: 1,
      staleChangeRequests: 3,
      automationPaused: true,
      budgets: [
        { label: 'Anthropic', window: 'month', spentUsd: 8.5, limitUsd: 10 },
        { label: 'Brave Search', window: 'day', spentUsd: 1, limitUsd: 1 },
        { label: 'Google Places', window: 'month', spentUsd: 1, limitUsd: 10 },
      ],
    });
    expect(alerts.map((a) => [a.level, a.key])).toEqual([
      ['critical', 'opt-out-tasks'],
      ['critical', 'delivery-unknown'],
      ['critical', 'budget-Brave Search-day'],
      ['warning', 'budget-Anthropic-month'],
      ['warning', 'stuck-jobs'],
      ['warning', 'failed-jobs'],
      ['warning', 'change-requests'],
      ['info', 'approvals'],
      ['info', 'automation-paused'],
    ]);
    expect(alerts.find((a) => a.key === 'budget-Anthropic-month')?.title).toBe('Anthropic monthly budget at 85%');
    expect(alerts.find((a) => a.key === 'opt-out-tasks')?.href).toBe('/outreach?tab=inbox&filter=opt_out');
    expect(alerts.find((a) => a.key === 'failed-jobs')?.title).toBe('2 failed jobs');
  });
});

describe('structured logs', () => {
  it('redact contact details and secrets, and cut long text', () => {
    const out = redact('Failed for kofi@example.com, +233 24 412 3456, Bearer abc.def.ghi, sk-ant-api03-abcdefghijklmnop and eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXZhbHVl');
    expect(out).toBe('Failed for [email], [number], Bearer [secret], [secret] and [token]');
    expect(redact('x'.repeat(400))).toHaveLength(301);
  });

  it('write one JSON line per event and forward errors, redacted, only to an HTTPS report URL', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetch);
    await logEvent('error', 'webhook_failed', { channel: 'email', detail: 'from ama@example.com' });
    expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({ level: 'error', event: 'webhook_failed', channel: 'email', detail: 'from [email]' });
    expect(fetch).not.toHaveBeenCalled();

    process.env.ERROR_REPORT_URL = 'http://insecure.example/hook';
    await logEvent('error', 'webhook_failed', {});
    expect(fetch).not.toHaveBeenCalled();
    process.env.ERROR_REPORT_URL = 'https://alerts.example/hook';
    await logEvent('error', 'webhook_failed', { detail: 'from ama@example.com' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toMatchObject({ event: 'webhook_failed', detail: 'from [email]' });
    // A failing report never breaks the request.
    fetch.mockRejectedValueOnce(new Error('down'));
    await expect(logEvent('error', 'webhook_failed', {})).resolves.toBeUndefined();
  });
});

describe('scheduled worker route', () => {
  const call = (auth?: string) => cron(new NextRequest('https://app.example.com/api/cron/automation', { headers: auth ? { authorization: auth } : {} }));

  it('refuses callers without the exact cron secret before touching the database', async () => {
    // (Header values are trimmed by HTTP itself, so surrounding spaces are not a different secret.)
    for (const auth of [undefined, 'Bearer wrong', `Bearer ${ENV.values.CRON_SECRET}x`, ENV.values.CRON_SECRET, `bearer ${ENV.values.CRON_SECRET}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain(ENV.values.CRON_SECRET);
    }
    expect(service.calls).toBe(0);
  });

  it('is off (503) until the cron secret is configured', async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      expect((await call(`Bearer ${saved}`)).status).toBe(503);
    } finally {
      process.env.CRON_SECRET = saved;
    }
    expect(service.calls).toBe(0);
  });
});
