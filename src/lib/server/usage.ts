import 'server-only';

import type { RequestContext } from './context';
import { HttpError } from './http';
import { logEvent } from './log';

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

export async function recordUsage(ctx: RequestContext, charge: UsageCharge): Promise<UsageCharge> {
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
    if (error) void logEvent('error', 'usage_record_failed', { code: error.code });
  } else {
    const k = `${ctx.key}:${charge.operation}`;
    const entry = demoCounts.get(k);
    demoCounts.set(k, { day: day(), count: entry && entry.day === day() ? entry.count + 1 : 1 });
  }
  return charge;
}
