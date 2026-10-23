// Stage rules and permission-aware outreach gating. Used by services before any stage change.

import { CLOSED_STAGES, PERMISSION_STAGES, STAGES, type Stage } from './constants';
import type { Business } from './types';

export type Gate = { ok: true } | { ok: false; reason: string };

type GateInput = Pick<Business, 'contactPermission' | 'websiteStatus' | 'businessStatus'>;

export function canEnterStage(business: GateInput, stage: Stage): Gate {
  if (business.contactPermission === 'opted_out' && (PERMISSION_STAGES.includes(stage) || stage === 'introduction_requested')) {
    return { ok: false, reason: 'This business opted out of contact. Outreach stages are blocked.' };
  }
  if (PERMISSION_STAGES.includes(stage) && business.contactPermission !== 'granted') {
    return {
      ok: false,
      reason: 'Record permission to contact (with its lawful basis and evidence) before moving to an outreach stage.',
    };
  }
  if (stage === 'qualified') {
    if (business.websiteStatus === 'unverified') {
      return { ok: false, reason: 'Record at least one website verification before qualifying.' };
    }
    if (business.businessStatus === 'inactive') {
      return { ok: false, reason: 'The business appears inactive and cannot be qualified.' };
    }
  }
  return { ok: true };
}

export function isOpenStage(stage: Stage) {
  return !CLOSED_STAGES.includes(stage);
}

export function stageIndex(stage: Stage) {
  return STAGES.indexOf(stage);
}

export interface QualificationCheck {
  label: string;
  passed: boolean;
  required: boolean;
}

export function qualificationChecklist(
  business: Pick<Business, 'websiteStatus' | 'businessStatus' | 'sourceUrl' | 'contactPermission' | 'opportunityScore'>,
): QualificationCheck[] {
  return [
    { label: 'Website presence verified with documented checks', passed: business.websiteStatus !== 'unverified', required: true },
    { label: 'Business not marked inactive', passed: business.businessStatus !== 'inactive', required: true },
    { label: 'Business not opted out', passed: business.contactPermission !== 'opted_out', required: true },
    { label: 'Source of record captured', passed: Boolean(business.sourceUrl), required: false },
    { label: 'Business confirmed as operating', passed: business.businessStatus === 'active', required: false },
    { label: 'Opportunity score 60 or above', passed: (business.opportunityScore ?? 0) >= 60, required: false },
  ];
}
