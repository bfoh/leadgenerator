// Maps v1–v6 "Lead" records (src/data/research.json, v6 browser storage, public.leads) into the
// v7 model. The SQL function public.migrate_legacy_leads_for() in migration 002 implements the
// same mapping — keep them in sync.

import type { Confidence, ContactPermission, Stage, VerificationOutcome } from './constants';
import { regionForCity } from './geo';
import { businessDefaults } from './records';
import type { BusinessInsert, VerificationInsert } from './types';

export interface LegacyLead {
  id: string;
  name: string;
  city: string;
  sector: string;
  websiteStatus: string;
  confidence: string;
  priority: number;
  phone: string;
  email: string;
  source: string;
  notes: string;
  suggestion: string;
  stage: string;
  consent: string;
  reviewedAt?: string;
  verificationOutcome?: string;
  websiteEvidence?: string;
  contactEvidence?: string;
  verifiedBy?: string;
}

export const LEGACY_SECTOR_CATEGORY: Record<string, string> = {
  Fashion: 'Fashion boutique',
  Furniture: 'Furniture showroom',
  Bridal: 'Bridal shop',
  Beauty: 'Beauty salon',
  Hospitality: 'Hotel',
};

export const LEGACY_STAGE: Record<string, Stage> = {
  Research: 'research_candidate',
  Verification: 'verification_pending',
  Qualified: 'qualified',
  Introduced: 'introduction_requested',
  Meeting: 'discovery_meeting',
  Proposal: 'proposal_draft',
  Won: 'won',
  Lost: 'lost',
  Excluded: 'archived',
};

export const LEGACY_CONSENT: Record<string, ContactPermission> = {
  Unknown: 'unknown',
  'Permission requested': 'introduction_requested',
  'Permission obtained': 'granted',
  'Opted out': 'opted_out',
  'Not applicable': 'unknown',
};

const LEGACY_OUTCOME: Record<string, VerificationOutcome> = {
  'No official website found after review': 'none_found',
  'Official website found': 'verified_official',
  'Needs more evidence': 'insufficient_evidence',
  'Business inactive': 'insufficient_evidence',
};

function confidence(value: string): Confidence {
  return value === 'high' || value === 'medium' ? value : 'low';
}

/** Classifies the free-text v1–v3 desk-research finding. */
export function legacyResearchOutcome(websiteStatus: string, conf: Confidence): VerificationOutcome {
  const s = websiteStatus.toLowerCase();
  if (s === 'official website found') return conf === 'high' ? 'verified_official' : 'potential_official';
  if (/website|domain/.test(s) && /found|reported|relationship|existing/.test(s)) return 'potential_official';
  return 'insufficient_evidence';
}

function safeHttpUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function legacyDate(value: string | undefined, fallback: string): string {
  if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return fallback;
}

export interface LegacyImport {
  business: BusinessInsert;
  verifications: Omit<VerificationInsert, 'businessId'>[];
}

export function mapLegacyLead(lead: LegacyLead, importedAt = new Date().toISOString()): LegacyImport {
  const conf = confidence(lead.confidence);
  const researchOutcome = legacyResearchOutcome(lead.websiteStatus ?? '', conf);
  const sourceUrl = safeHttpUrl(lead.source);
  const reviewed = lead.verificationOutcome && lead.verificationOutcome !== 'Unverified' ? LEGACY_OUTCOME[lead.verificationOutcome] : undefined;
  const reviewedAt = reviewed ? legacyDate(lead.reviewedAt, importedAt) : null;
  // The desk research predates any manual review, so it must sort first.
  const researchAt = reviewedAt && reviewedAt <= importedAt ? new Date(Date.parse(reviewedAt) - 60_000).toISOString() : importedAt;
  const verifications: Omit<VerificationInsert, 'businessId'>[] = [
    {
      status: researchOutcome,
      checkedAt: researchAt,
      methods: ['manual_review'],
      domain: null,
      sourceUrl,
      evidenceSummary: `Imported v1–v3 desk research finding: "${lead.websiteStatus}". Not independently re-verified.`,
      confidence: conf,
      websiteOutdated: false,
      technical: null,
      reviewerId: null,
      reviewerName: 'Legacy import',
      nextCheckAt: null,
    },
  ];

  if (reviewed && reviewedAt) {
    verifications.push({
      status: reviewed,
      checkedAt: reviewedAt,
      methods: ['manual_review'],
      domain: null,
      sourceUrl: safeHttpUrl(lead.websiteEvidence),
      evidenceSummary: `v6 manual review outcome: "${lead.verificationOutcome}". Evidence: ${lead.websiteEvidence || 'not recorded'}.`,
      confidence: conf,
      websiteOutdated: false,
      technical: null,
      reviewerId: null,
      reviewerName: lead.verifiedBy || 'Legacy reviewer',
      nextCheckAt: null,
    });
  }

  const notes = [lead.notes, lead.suggestion ? `Suggested service (v1–v6): ${lead.suggestion}` : '']
    .filter(Boolean)
    .join('\n\n');
  const permission = LEGACY_CONSENT[lead.consent] ?? 'unknown';

  const business = businessDefaults({
    name: lead.name,
    category: LEGACY_SECTOR_CATEGORY[lead.sector] ?? lead.sector ?? 'Other',
    city: lead.city || 'Accra',
    region: regionForCity(lead.city || 'Accra'),
    businessStatus: lead.verificationOutcome === 'Business inactive' ? 'inactive' : 'unknown',
    websiteStatus: (reviewed ?? researchOutcome),
    phone: lead.phone || null,
    email: lead.email || null,
    contactSource: lead.contactEvidence || null,
    contactPermission: permission,
    lawfulBasis: permission === 'granted' ? 'consent' : null,
    permissionEvidence: permission === 'granted' ? 'Recorded in v6 as "Permission obtained"' : null,
    optedOutAt: permission === 'opted_out' ? importedAt : null,
    stage: LEGACY_STAGE[lead.stage] ?? 'research_candidate',
    notes,
    sourceUrl,
    sourceKind: 'legacy_seed',
    legacyId: lead.id,
    legacy: { ...lead },
  });

  return { business, verifications };
}
