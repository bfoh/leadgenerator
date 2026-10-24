// Paid-request ledger. Every paid provider request is written to usage_records before it is sent (a
// zero-cost "sent" marker holding the request's maximum cost) and settled by a second row when the
// answer arrives: the usual usage row with the actual cost, or a zero-cost "refused" row when the
// provider rejected the request without charging. A marker that is never settled — the answer did not
// arrive, the connection dropped, or the worker was stopped mid-call — counts against budgets at its
// maximum cost, and the engine never repeats such a job automatically. See docs/COST_CONTROL.md.

import type { UsageRecord } from '@/lib/domain/types';

export const SENT_SUFFIX = ':sent';
export const REFUSED_SUFFIX = ':refused';

/**
 * Whether a failed paid request was charged: `none` (refused before any work, e.g. rate limited or
 * overloaded), `charged` (an answer arrived but could not be used; its cost is known), `unknown` (sent,
 * but no answer arrived).
 */
export type Billing = 'none' | 'charged' | 'unknown';

export type LedgerRow = Pick<UsageRecord, 'operation' | 'metadata' | 'createdAt'>;

const callIdOf = (row: Pick<UsageRecord, 'metadata'>) => {
  const id = row.metadata?.callId;
  return typeof id === 'string' ? id : null;
};

export const isSentMarker = (row: Pick<UsageRecord, 'operation'>) => row.operation.endsWith(SENT_SUFFIX);

export function markerMaxCost(row: Pick<UsageRecord, 'metadata'>) {
  const n = Number(row.metadata?.maxCostUsd);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Call ids that have an answer recorded (any row other than the marker carrying the same id). */
export function settledCallIds(rows: Pick<UsageRecord, 'operation' | 'metadata'>[]) {
  const settled = new Set<string>();
  for (const r of rows) {
    const id = callIdOf(r);
    if (id && !isSentMarker(r)) settled.add(id);
  }
  return settled;
}

/** Markers whose request has no recorded answer: possibly charged, cost unknown. */
export function unsettledMarkers<R extends Pick<UsageRecord, 'operation' | 'metadata'>>(rows: R[]): R[] {
  const settled = settledCallIds(rows);
  return rows.filter((r) => isSentMarker(r) && !settled.has(callIdOf(r) ?? ''));
}

/**
 * The paid requests one job made since `sinceIso`: `unknown` if any has no answer recorded, otherwise
 * `charged` if any was answered (successfully or not), otherwise `none` (none sent, or all refused).
 */
export function paidRequestsSince(rows: LedgerRow[], jobId: string, sinceIso: string): Billing {
  const markers = rows.filter((r) => isSentMarker(r) && r.metadata?.jobId === jobId && r.createdAt >= sinceIso);
  if (!markers.length) return 'none';
  const answers = new Map<string, LedgerRow>();
  for (const r of rows) if (!isSentMarker(r) && callIdOf(r)) answers.set(callIdOf(r)!, r);
  let worst: Billing = 'none';
  for (const m of markers) {
    const answer = answers.get(callIdOf(m) ?? '');
    if (!answer) return 'unknown';
    if (!answer.operation.endsWith(REFUSED_SUFFIX)) worst = 'charged';
  }
  return worst;
}

export function billingOf(error: unknown): Billing | null {
  const b = (error as { billing?: unknown } | null)?.billing;
  return b === 'none' || b === 'charged' || b === 'unknown' ? b : null;
}

const RANK: Record<Billing, number> = { none: 0, charged: 1, unknown: 2 };
export const worseBilling = (a: Billing, b: Billing): Billing => (RANK[a] >= RANK[b] ? a : b);

export const PAID_REQUEST_NOTE: Record<Exclude<Billing, 'none'>, string> = {
  unknown:
    'A paid request was sent but its answer never arrived, so it may have been charged. It counts against the budget at its maximum cost and is not repeated automatically: check the provider’s usage page, then retry the job if it should run again.',
  charged: 'A paid request was already answered in this attempt (its cost is recorded), so the job is not repeated automatically. Retry it if it should run again.',
};
