// Applies the scoring engine to a stored business using the verification currently in force.

import { scoreBusiness } from './scoring';
import type { OrgSettings } from './settings';
import type { Business, BusinessInsert, WebsiteVerification } from './types';

/**
 * The verification in force: the newest record a person made or confirmed, or an agent result that
 * needed no review. Agent results awaiting review count only while no such record exists, so an
 * automated check never silently replaces a person's conclusion; rejected results never count.
 */
export function latestVerification(verifications: WebsiteVerification[]): WebsiteVerification | null {
  const usable = verifications.filter((v) => v.reviewStatus !== 'rejected');
  const settled = usable.filter((v) => (v.actorType ?? 'user') === 'user' || v.reviewStatus !== 'pending');
  return (settled.length ? settled : usable).reduce<WebsiteVerification | null>((latest, v) => (!latest || v.checkedAt > latest.checkedAt ? v : latest), null);
}

export function scoreFields(
  business: BusinessInsert | Business,
  verifications: WebsiteVerification[],
  settings: Pick<OrgSettings, 'scoringWeights' | 'focusCategories'>,
  now = new Date(),
): Pick<Business, 'opportunityScore' | 'confidenceScore' | 'scoreBreakdown' | 'scoredAt'> {
  const latest = latestVerification(verifications);
  const result = scoreBusiness(business, latest, { weights: settings.scoringWeights, focusCategories: settings.focusCategories, now });
  // A person's override sets the opportunity score; the computed result stays visible in the breakdown.
  const override = business.scoreOverride;
  return { opportunityScore: override ? override.opportunity : result.opportunity, confidenceScore: result.confidence, scoreBreakdown: result, scoredAt: result.computedAt };
}
