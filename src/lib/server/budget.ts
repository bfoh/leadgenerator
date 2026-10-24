import 'server-only';

import { budgetsSchema, checkBudgets, monthStart, spendByProvider, type CostEstimate, type SpendRow } from '@/lib/automation/budget';
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

/**
 * This month's priced usage, plus the paid-request ledger rows (zero-cost "sent" markers and "refused"
 * settlements, whose operations end in a ":suffix"), so open markers count at their maximum cost.
 */
async function monthUsage(ctx: Exclude<RequestContext, { mode: 'demo' }>, now: Date) {
  const rows: SpendRow[] = [];
  const read = async (filter: 'priced' | 'ledger') => {
    for (let from = 0; ; from += PAGE) {
      let q = ctx.supabase
        .from('usage_records')
        .select('provider, operation, estimated_cost_usd, metadata, created_at')
        .eq('organization_id', ctx.orgId)
        .gte('created_at', monthStart(now).toISOString());
      q = filter === 'priced' ? q.gt('estimated_cost_usd', 0) : q.eq('estimated_cost_usd', 0).like('operation', '%:%');
      const { data, error } = await q.order('id').range(from, from + PAGE - 1);
      if (error) throw new HttpError(503, 'Could not check spending budgets. Try again shortly.');
      for (const r of data ?? []) {
        rows.push({
          provider: r.provider as string,
          operation: r.operation as string,
          estimatedCostUsd: Number(r.estimated_cost_usd) || 0,
          metadata: (r.metadata as Record<string, unknown> | null) ?? null,
          createdAt: r.created_at as string,
        });
      }
      if (!data || data.length < PAGE) return;
    }
  };
  await read('priced');
  await read('ledger');
  return rows;
}

export async function enforceBudget(ctx: RequestContext, estimate: CostEstimate, now = new Date()) {
  if (ctx.mode === 'demo') return;
  const budgets = await loadBudgets(ctx);
  if (!budgets || !Object.keys(budgets).length) return;
  const decision = checkBudgets(budgets, spendByProvider(await monthUsage(ctx, now), now), estimate, { automated: false, now });
  if (!decision.ok) throw new HttpError(429, decision.message);
}
