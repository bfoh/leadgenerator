// Pure aggregations for the analytics and overview pages. Inputs are stored records only — nothing
// here estimates or fills in missing values.

import { QUALIFIED_SCORE } from './campaigns';
import { INDUSTRY_GROUPS, industryGroupForCategory } from './categories';
import { STAGES, type Stage, type VerificationOutcome } from './constants';
import { isOpenStage } from './pipeline';
import type { Activity, Business, Proposal } from './types';

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

// ── Industry rollups ─────────────────────────────────────────────────────────

/**
 * A single stored category label inside a group. The label is exactly what `businesses.category`
 * holds, so a rollup row can always be traced back to the records behind it — including labels the
 * catalogue no longer ships and labels the workspace typed itself.
 */
export interface IndustryCategoryMetric {
  label: string;
  /** All records ever filed under this label, including lost and archived ones. */
  prospects: number;
  open: number;
  qualified: number;
  won: number;
  proposalsDecided: number;
  proposalsAccepted: number;
}

/** One of the 30 industry groups, or the bucket for labels outside the catalogue. */
export interface IndustryGroupMetric {
  key: string;
  label: string;
  description: string;
  prospects: number;
  open: number;
  /** Open prospects at or above the campaign qualification score. */
  qualified: number;
  /** Prospects that reached the won stage, from their current stage and logged stage changes. */
  won: number;
  /** Average opportunity score of open, scored prospects. */
  avgScore: number | null;
  proposalsDecided: number;
  proposalsAccepted: number;
  /** Accepted ÷ decided proposals, 0–1, or null when nothing has been decided. */
  proposalWinRate: number | null;
  /** Won ÷ all records ever filed in the group, 0–1, or null when the group has no records. */
  conversionRate: number | null;
  /** Exact stored category labels, largest first. */
  categories: IndustryCategoryMetric[];
}

export interface IndustryRollup {
  /** All 30 groups in catalogue order, including groups with no records. */
  groups: IndustryGroupMetric[];
  /** Labels outside the built-in catalogue, or null when every record resolves to a group. */
  unclassified: IndustryGroupMetric | null;
  totals: {
    prospects: number;
    open: number;
    qualified: number;
    won: number;
    proposalsDecided: number;
    proposalsAccepted: number;
    /** Groups with at least one record. */
    groupsCovered: number;
  };
}

const WON_INDEX = FUNNEL_STAGES.indexOf('won');
const DECIDED_PROPOSAL = new Set<Proposal['status']>(['accepted', 'declined']);

const emptyGroup = (key: string, label: string, description: string): IndustryGroupMetric => ({
  key,
  label,
  description,
  prospects: 0,
  open: 0,
  qualified: 0,
  won: 0,
  avgScore: null,
  proposalsDecided: 0,
  proposalsAccepted: 0,
  proposalWinRate: null,
  conversionRate: null,
  categories: [],
});

/**
 * Groups every stored prospect by the 30-industry catalogue and keeps the original category labels
 * underneath, so Analytics can report at group level without hiding the records behind a group.
 *
 * Definitions are deliberately narrow and independent of the date range selected on the page:
 * - *open* and *qualified* describe the records as they stand now (`isOpenStage`, score ≥ 50);
 * - *won* comes from the furthest stage a record ever reached, so a prospect that was lost after
 *   winning still counts as a win; and
 * - proposals count once they are accepted or declined, whatever the record's current stage.
 *
 * Category strings the catalogue does not know (workspace-added labels, historic spellings) are kept
 * in a separate bucket rather than dropped, so the totals always reconcile with the record count.
 */
export function industryRollup(
  businesses: Business[],
  activities: Activity[],
  proposals: Pick<Proposal, 'businessId' | 'status'>[] = [],
  options: { qualifiedScore?: number } = {},
): IndustryRollup {
  const qualifiedScore = options.qualifiedScore ?? QUALIFIED_SCORE;
  const reached = furthestStages(businesses, activities);
  const groups = INDUSTRY_GROUPS.map((group) => emptyGroup(group.key, group.label, group.description));
  const byKey = new Map(groups.map((group) => [group.key, group]));
  const unclassified = emptyGroup('unclassified', 'Not in the catalogue', 'Stored categories outside the built-in catalogue, kept so no record disappears.');
  const scores = new Map<string, number[]>();
  const proposalRows = new Map<string, Pick<Proposal, 'businessId' | 'status'>[]>();
  for (const proposal of proposals) {
    proposalRows.set(proposal.businessId, [...(proposalRows.get(proposal.businessId) ?? []), proposal]);
  }

  for (const business of businesses) {
    const group = industryGroupForCategory(business.category);
    const bucket = group ? (byKey.get(group.key) ?? unclassified) : unclassified;
    const label = business.category.trim() || 'Uncategorised';
    const open = isOpenStage(business.stage);
    const qualified = open && business.opportunityScore != null && business.opportunityScore >= qualifiedScore;
    const won = WON_INDEX >= 0 && (reached.get(business.id) ?? -1) >= WON_INDEX;

    bucket.prospects += 1;
    if (open) bucket.open += 1;
    if (qualified) bucket.qualified += 1;
    if (won) bucket.won += 1;
    if (open && business.opportunityScore != null) scores.set(bucket.key, [...(scores.get(bucket.key) ?? []), business.opportunityScore]);

    let category = bucket.categories.find((row) => row.label === label);
    if (!category) {
      category = { label, prospects: 0, open: 0, qualified: 0, won: 0, proposalsDecided: 0, proposalsAccepted: 0 };
      bucket.categories.push(category);
    }
    category.prospects += 1;
    if (open) category.open += 1;
    if (qualified) category.qualified += 1;
    if (won) category.won += 1;

    for (const proposal of proposalRows.get(business.id) ?? []) {
      if (!DECIDED_PROPOSAL.has(proposal.status)) continue;
      bucket.proposalsDecided += 1;
      category.proposalsDecided += 1;
      if (proposal.status === 'accepted') {
        bucket.proposalsAccepted += 1;
        category.proposalsAccepted += 1;
      }
    }
  }

  const finish = (group: IndustryGroupMetric): IndustryGroupMetric => {
    const values = scores.get(group.key) ?? [];
    return {
      ...group,
      avgScore: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      proposalWinRate: group.proposalsDecided ? group.proposalsAccepted / group.proposalsDecided : null,
      conversionRate: group.prospects ? group.won / group.prospects : null,
      categories: [...group.categories].sort((a, b) => b.prospects - a.prospects || b.open - a.open || a.label.localeCompare(b.label)),
    };
  };

  const finished = groups.map(finish);
  const finishedUnknown = unclassified.prospects ? finish(unclassified) : null;
  const all = finishedUnknown ? [...finished, finishedUnknown] : finished;
  return {
    groups: finished,
    unclassified: finishedUnknown,
    totals: {
      prospects: all.reduce((sum, group) => sum + group.prospects, 0),
      open: all.reduce((sum, group) => sum + group.open, 0),
      qualified: all.reduce((sum, group) => sum + group.qualified, 0),
      won: all.reduce((sum, group) => sum + group.won, 0),
      proposalsDecided: all.reduce((sum, group) => sum + group.proposalsDecided, 0),
      proposalsAccepted: all.reduce((sum, group) => sum + group.proposalsAccepted, 0),
      groupsCovered: finished.filter((group) => group.prospects > 0).length,
    },
  };
}
