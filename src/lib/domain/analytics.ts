// Pure aggregations for the analytics and overview pages. Inputs are stored records only — nothing
// here estimates or fills in missing values.

import { STAGES, type Stage, type VerificationOutcome } from './constants';
import type { Activity, Business } from './types';

/** Stages in pipeline order that count as progress (lost and archived are exits, not steps). */
export const FUNNEL_STAGES: Stage[] = STAGES.filter((s) => s !== 'lost' && s !== 'archived');

/**
 * Furthest pipeline stage each business has reached, from its current stage and its logged stage
 * changes. A lost or archived business keeps the furthest stage it reached before exiting.
 */
export function furthestStages(businesses: Business[], activities: Activity[]): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (id: string, stage: unknown) => {
    const i = FUNNEL_STAGES.indexOf(stage as Stage);
    if (i >= 0 && i > (out.get(id) ?? -1)) out.set(id, i);
  };
  for (const b of businesses) {
    out.set(b.id, 0);
    bump(b.id, b.stage);
  }
  for (const a of activities) {
    if (a.type !== 'stage_change' || !out.has(a.businessId) || !a.details) continue;
    bump(a.businessId, a.details.from);
    bump(a.businessId, a.details.to);
  }
  return out;
}

export function funnel(businesses: Business[], activities: Activity[]) {
  const reached = [...furthestStages(businesses, activities).values()];
  return FUNNEL_STAGES.map((stage, i) => ({ stage, count: reached.filter((r) => r >= i).length }));
}

export type Granularity = 'day' | 'week' | 'month';

export interface Bucket {
  key: string;
  label: string;
  start: string;
  end: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

export function granularityFor(days: number): Granularity {
  return days <= 31 ? 'day' : days <= 190 ? 'week' : 'month';
}

/** Consecutive UTC buckets covering the last `days` days up to `now`. */
export function buckets(days: number, now: Date): Bucket[] {
  const g = granularityFor(days);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  let cursor = new Date(end.getTime() - days * 86_400_000);
  if (g === 'week') cursor = new Date(cursor.getTime() - ((cursor.getUTCDay() + 6) % 7) * 86_400_000);
  if (g === 'month') cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  const out: Bucket[] = [];
  while (cursor < end) {
    const next =
      g === 'day'
        ? new Date(cursor.getTime() + 86_400_000)
        : g === 'week'
          ? new Date(cursor.getTime() + 7 * 86_400_000)
          : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const label = g === 'month' ? `${MONTHS[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear()).slice(2)}` : g === 'week' ? `w/c ${dayLabel(cursor)}` : dayLabel(cursor);
    out.push({ key: cursor.toISOString().slice(0, 10), label, start: cursor.toISOString(), end: next.toISOString() });
    cursor = next;
  }
  return out;
}

/** Sums `value` per bucket and series. Records outside the buckets are ignored. */
export function series<T>(rows: T[], list: Bucket[], at: (r: T) => string, seriesOf: (r: T) => string, keys: string[], value: (r: T) => number = () => 1) {
  const data = list.map((b) => ({ label: b.label, ...Object.fromEntries(keys.map((k) => [k, 0])) }) as Record<string, string | number>);
  for (const r of rows) {
    const t = at(r);
    const i = list.findIndex((b) => t >= b.start && t < b.end);
    const k = seriesOf(r);
    if (i < 0 || !keys.includes(k)) continue;
    data[i][k] = Math.round(((data[i][k] as number) + value(r)) * 10_000) / 10_000;
  }
  return data;
}

export type OutcomeGroup = 'opportunity' | 'exists' | 'inconclusive';
export const OUTCOME_GROUPS: { key: OutcomeGroup; label: string }[] = [
  { key: 'opportunity', label: 'No site / site issues' },
  { key: 'exists', label: 'Website exists' },
  { key: 'inconclusive', label: 'Inconclusive' },
];

export function outcomeGroup(status: VerificationOutcome): OutcomeGroup {
  if (status === 'verified_official' || status === 'potential_official') return 'exists';
  if (status === 'insufficient_evidence') return 'inconclusive';
  return 'opportunity';
}

export type CostGroup = 'google_places' | 'anthropic' | 'other';
export const COST_GROUPS: { key: CostGroup; label: string }[] = [
  { key: 'google_places', label: 'Google Places' },
  { key: 'anthropic', label: 'AI reports' },
  { key: 'other', label: 'Other providers' },
];

export function costGroup(provider: string): CostGroup {
  return provider === 'google_places' || provider === 'anthropic' ? provider : 'other';
}

/** Largest groups first, with the remainder folded into "Other". */
export function topCounts(values: string[], limit: number, otherLabel = 'Other') {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, limit).map(([label, value]) => ({ label, value }));
  const rest = sorted.slice(limit).reduce((s, [, v]) => s + v, 0);
  return rest ? [...head, { label: otherLabel, value: rest }] : head;
}
