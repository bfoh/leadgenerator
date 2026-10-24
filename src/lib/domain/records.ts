// Default values for new records. Kept in one place so demo and cloud stores agree with the
// column defaults in supabase/migrations/002.

import type { BusinessInsert } from './types';

export function businessDefaults(overrides: Partial<BusinessInsert> = {}): BusinessInsert {
  return {
    name: '',
    category: 'Other',
    country: 'GH',
    region: null,
    // No default town: every record states where the business is (the form and the database require it).
    city: '',
    neighborhood: null,
    address: null,
    businessStatus: 'unknown',
    officialWebsite: null,
    websiteStatus: 'unverified',
    websiteOutdated: false,
    socialProfiles: [],
    enquiryChannel: null,
    phone: null,
    email: null,
    contactSource: null,
    contactPermission: 'unknown',
    lawfulBasis: null,
    permissionEvidence: null,
    permissionRecordedAt: null,
    optedOutAt: null,
    interestLevel: 'unknown',
    budgetSignal: 'unknown',
    serviceNeeds: [],
    opportunityScore: null,
    confidenceScore: null,
    scoreBreakdown: null,
    scoredAt: null,
    stage: 'research_candidate',
    ownerId: null,
    estimatedValue: null,
    expectedCloseDate: null,
    lostReason: null,
    nextAction: null,
    nextActionDue: null,
    lastInteractionAt: null,
    notes: '',
    sourceUrl: null,
    sourceKind: 'manual',
    placesPlaceId: null,
    legacyId: null,
    legacy: null,
    ...overrides,
  };
}
