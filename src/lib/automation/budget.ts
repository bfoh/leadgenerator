// Money budgets per provider. Windows are the calendar day and month in Ghana time (GMT, no daylight
// saving), i.e. UTC. Spend is the sum of estimated cost in usage_records. See docs/COST_CONTROL.md.

import { z } from 'zod';
import type { UsageRecord } from '@/lib/domain/types';
import { BUDGET_PROVIDER_LABELS, BUDGET_PROVIDERS, USAGE_PROVIDER, type BudgetProvider } from './constants';
import type { BudgetLimit, Budgets } from './types';

export type PaidProvider = Exclude<BudgetProvider, 'total'>;
export type CostEstimate = Partial<Record<PaidProvider, number>>;

const money = z.number().min(0).max(100_000).nullable();
export const budgetLimitSchema = z.object({ dailyUsd: money, monthlyUsd: money });
export const budgetsSchema = z.partialRecord(z.enum(BUDGET_PROVIDERS), budgetLimitSchema);

export function dayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
export function nextDayStart(now: Date) {
  return new Date(dayStart(now).getTime() + 86_400_000);
}
export function nextMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface Spend {
  day: Record<string, number>;
  month: Record<string, number>;
}

/** Sums estimated cost by usage provider for today and this month. */
export function spendByProvider(usage: Pick<UsageRecord, 'provider' | 'estimatedCostUsd' | 'createdAt'>[], now: Date): Spend {
  const dayIso = dayStart(now).toISOString();
  const monthIso = monthStart(now).toISOString();
  const spend: Spend = { day: { total: 0 }, month: { total: 0 } };
  for (const u of usage) {
    const cost = Number(u.estimatedCostUsd) || 0;
    if (!cost || u.createdAt < monthIso) continue;
    spend.month[u.provider] = (spend.month[u.provider] ?? 0) + cost;
    spend.month.total += cost;
    if (u.createdAt >= dayIso) {
      spend.day[u.provider] = (spend.day[u.provider] ?? 0) + cost;
      spend.day.total += cost;
    }
  }
  return spend;
}

export function spentFor(spend: Spend, provider: BudgetProvider, window: 'day' | 'month') {
  const key = provider === 'total' ? 'total' : USAGE_PROVIDER[provider];
  return spend[window][key] ?? 0;
}

export function hasLimit(limit: BudgetLimit | undefined): limit is BudgetLimit {
  return Boolean(limit && (limit.dailyUsd != null || limit.monthlyUsd != null));
}

export type BudgetDecision =
  | { ok: true }
  | { ok: false; kind: 'missing'; provider: PaidProvider; message: string }
  | { ok: false; kind: 'exceeded'; provider: BudgetProvider; window: 'day' | 'month'; retryAt: string; message: string };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

/**
 * Hard stop before a paid call. Automated work needs an explicit budget for every paid provider it
 * may use; manual work is limited only where a budget has been set.
 */
export function checkBudgets(budgets: Budgets, spend: Spend, estimate: CostEstimate, opts: { automated: boolean; now: Date }): BudgetDecision {
  const entries = Object.entries(estimate).filter(([, v]) => (v ?? 0) > 0) as [PaidProvider, number][];
  if (!entries.length) return { ok: true };
  const windows = [
    ['day', 'dailyUsd', nextDayStart(opts.now)],
    ['month', 'monthlyUsd', nextMonthStart(opts.now)],
  ] as const;

  for (const [provider, amount] of entries) {
    const limit = budgets[provider];
    if (opts.automated && !hasLimit(limit)) {
      return {
        ok: false,
        kind: 'missing',
        provider,
        message: `Set a daily or monthly budget for ${BUDGET_PROVIDER_LABELS[provider]} in Automation Center → Controls to allow automated use.`,
      };
    }
    for (const [window, field, next] of windows) {
      const cap = limit?.[field];
      if (cap == null) continue;
      const spent = spentFor(spend, provider, window);
      if (spent + amount > cap) {
        return {
          ok: false,
          kind: 'exceeded',
          provider,
          window,
          retryAt: next.toISOString(),
          message: `${window === 'day' ? 'Daily' : 'Monthly'} ${BUDGET_PROVIDER_LABELS[provider]} budget reached (${usd(spent)} of ${usd(cap)} spent; this step may cost up to ${usd(amount)}).`,
        };
      }
    }
  }

  const total = entries.reduce((s, [, v]) => s + v, 0);
  for (const [window, field, next] of windows) {
    const cap = budgets.total?.[field];
    if (cap == null) continue;
    const spent = spentFor(spend, 'total', window);
    if (spent + total > cap) {
      return {
        ok: false,
        kind: 'exceeded',
        provider: 'total',
        window,
        retryAt: next.toISOString(),
        message: `${window === 'day' ? 'Daily' : 'Monthly'} total budget reached (${usd(spent)} of ${usd(cap)} spent).`,
      };
    }
  }
  return { ok: true };
}
