import 'server-only';

import { budgetsSchema, checkBudgets, monthStart, spendByProvider, type CostEstimate } from '@/lib/automation/budget';
import type { Budgets } from '@/lib/automation/types';
import type { RequestContext } from './context';
import { HttpError } from './http';

// Money budgets for manual (user-initiated) paid calls in cloud mode. Automated jobs are checked by
// the engine before they start; this is the same hard stop for buttons people press. Budgets are
// optional for manual use. Demo mode keeps budgets in the browser, so the server cannot see them.

const PAGE = 1000;
const MISSING = new Set(['42P01', 'PGRST205']);

async function loadBudgets(ctx: Exclude<RequestContext, { mode: 'demo' }>): Promise<Budgets | null> {
  const { data, error } = await ctx.supabase.from('automation_settings').select('budgets').eq('organization_id', ctx.orgId).maybeSingle();
  if (error) {
    if (MISSING.has(error.code)) return null; // migration 003 not applied yet
    throw new HttpError(503, 'Could not check spending budgets. Try again shortly.');
  }
  return data ? budgetsSchema.catch({}).parse(data.budgets ?? {}) : null;
}

async function monthUsage(ctx: Exclude<RequestContext, { mode: 'demo' }>, now: Date) {
  const rows: { provider: string; estimatedCostUsd: number; createdAt: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.supabase
      .from('usage_records')
      .select('provider, estimated_cost_usd, created_at')
      .eq('organization_id', ctx.orgId)
      .gt('estimated_cost_usd', 0)
      .gte('created_at', monthStart(now).toISOString())
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new HttpError(503, 'Could not check spending budgets. Try again shortly.');
    for (const r of data ?? []) rows.push({ provider: r.provider as string, estimatedCostUsd: Number(r.estimated_cost_usd) || 0, createdAt: r.created_at as string });
    if (!data || data.length < PAGE) return rows;
  }
}

export async function enforceBudget(ctx: RequestContext, estimate: CostEstimate, now = new Date()) {
  if (ctx.mode === 'demo') return;
  const budgets = await loadBudgets(ctx);
  if (!budgets || !Object.keys(budgets).length) return;
  const decision = checkBudgets(budgets, spendByProvider(await monthUsage(ctx, now), now), estimate, { automated: false, now });
  if (!decision.ok) throw new HttpError(429, decision.message);
}
