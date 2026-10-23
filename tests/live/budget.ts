// The live checks' spending cap. Each check reserves its estimated worst-case cost before calling a
// paid provider and is skipped when the reservation would pass the budget. LIVE_BUDGET_USD defaults
// to $0.15 and can never exceed the hard cap.

export const LIVE_ENABLED = process.env.LIVE_INTEGRATION === '1';
export const HARD_CAP_USD = 0.5;
export const LIVE_BUDGET_USD = Math.min(Math.max(Number(process.env.LIVE_BUDGET_USD ?? '0.15') || 0, 0), HARD_CAP_USD);

let reserved = 0;

/** Reserves worst-case spend; false (skip the check) when it would pass the budget. */
export function reserve(usd: number) {
  if (!(usd >= 0) || reserved + usd > LIVE_BUDGET_USD) return false;
  reserved += usd;
  return true;
}

export const reservedUsd = () => Math.round(reserved * 10_000) / 10_000;
