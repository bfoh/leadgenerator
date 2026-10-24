import 'server-only';

import { randomUUID } from 'node:crypto';
import { REFUSED_SUFFIX, SENT_SUFFIX, billingOf } from '@/lib/automation/paid-calls';
import type { ReportUsage } from '@/lib/domain/types';
import type { RequestContext } from './context';
import { HttpError } from './http';
import { logEvent } from './log';
import { ProviderError } from './providers/discovery';

export interface UsageCharge {
  provider: string;
  operation: string;
  units: number;
  estimatedCostUsd: number;
  metadata?: Record<string, unknown> | null;
}

// Demo-mode counters (per server instance). Cloud mode counts insert-only usage_records rows.
const demoCounts = new Map<string, { day: string; count: number }>();
const day = () => new Date().toISOString().slice(0, 10);

export async function enforceQuota(ctx: RequestContext, operation: string, dailyLimit: number) {
  if (dailyLimit <= 0) throw new HttpError(403, `${operation} is disabled by the server's daily quota setting.`);
  let used = 0;
  if (ctx.mode !== 'demo') {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count, error } = await ctx.supabase
      .from('usage_records')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', ctx.orgId)
      .eq('operation', operation)
      .gte('created_at', since);
    if (error) throw new HttpError(503, 'Could not check usage quota. Try again shortly.');
    used = count ?? 0;
  } else {
    const entry = demoCounts.get(`${ctx.key}:${operation}`);
    used = entry && entry.day === day() ? entry.count : 0;
  }
  if (used >= dailyLimit) throw new HttpError(429, `Daily ${operation} quota reached (${dailyLimit} per 24 hours).`);
  return { used, limit: dailyLimit };
}

/** Records usage. With `required`, a failed write throws instead of being logged. */
export async function recordUsage(ctx: RequestContext, charge: UsageCharge, opts: { required?: boolean } = {}): Promise<UsageCharge> {
  if (ctx.mode !== 'demo') {
    const { error } = await ctx.supabase.from('usage_records').insert({
      organization_id: ctx.orgId,
      user_id: ctx.userId,
      provider: charge.provider,
      operation: charge.operation,
      units: charge.units,
      estimated_cost_usd: Math.round(charge.estimatedCostUsd * 10_000) / 10_000,
      metadata: charge.metadata ?? null,
    });
    if (error) {
      void logEvent('error', 'usage_record_failed', { code: error.code });
      if (opts.required) throw new HttpError(503, 'Could not record a paid request before sending it, so it was not sent. Try again shortly.');
    }
  } else {
    const k = `${ctx.key}:${charge.operation}`;
    const entry = demoCounts.get(k);
    demoCounts.set(k, { day: day(), count: entry && entry.day === day() ? entry.count + 1 : 1 });
  }
  return charge;
}

/** Cost and token counts of an answered AI request, for its usage row. */
export const tokenCharge = (r: { model: string; usage: ReportUsage }) => ({
  estimatedCostUsd: r.usage.estimatedCostUsd,
  metadata: { model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens },
});

/**
 * Sends one paid request through the paid-request ledger (src/lib/automation/paid-calls.ts). A "sent"
 * marker holding the request's maximum cost is recorded first — if that write fails, nothing is sent
 * — and the outcome settles it: the actual cost when an answer arrives (usable or not), a zero-cost
 * "refused" row when the provider refused without charging. When no answer arrives the marker stays
 * open, so budgets count the maximum cost and the job queue does not repeat the request.
 */
export async function paidCall<T>(
  ctx: RequestContext,
  spec: { provider: string; operation: string; maxCostUsd: number; metadata?: Record<string, unknown>; signal?: AbortSignal },
  send: () => Promise<T>,
  cost: (result: T) => { estimatedCostUsd: number; metadata?: Record<string, unknown> },
): Promise<{ result: T; charge: UsageCharge }> {
  spec.signal?.throwIfAborted();
  const metadata = { ...spec.metadata, callId: randomUUID() };
  const row = (operation: string, estimatedCostUsd: number, extra: Record<string, unknown> = {}) => ({
    provider: spec.provider,
    operation,
    units: 1,
    estimatedCostUsd,
    metadata: { ...metadata, ...extra },
  });
  await recordUsage(ctx, row(spec.operation + SENT_SUFFIX, 0, { maxCostUsd: spec.maxCostUsd }), { required: true });
  let result: T;
  try {
    result = await send();
  } catch (error) {
    const billing = billingOf(error) ?? 'unknown';
    if (billing === 'none') await recordUsage(ctx, row(spec.operation + REFUSED_SUFFIX, 0));
    else if (billing === 'charged' && error instanceof ProviderError && error.charge) {
      const { estimatedCostUsd, metadata: extra } = tokenCharge(error.charge);
      await recordUsage(ctx, row(spec.operation, estimatedCostUsd, { ...extra, outcome: 'unusable' }));
    }
    throw error;
  }
  const { estimatedCostUsd, metadata: extra } = cost(result);
  return { result, charge: await recordUsage(ctx, row(spec.operation, estimatedCostUsd, extra)) };
}
