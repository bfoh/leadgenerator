// Transparent, rule-based lead scoring. The opportunity score estimates how strong the digital-service
// opportunity is; the confidence score estimates how well the evidence supports it. Unknown factors
// contribute a neutral value and lower confidence instead of inflating the opportunity.

import type { BudgetSignal, BusinessStatus, Confidence, ContactPermission, InterestLevel, WebsiteStatus } from './constants';

export const SCORE_FACTORS = ['website', 'activity', 'fit', 'reachability', 'interest', 'budget'] as const;
export type ScoreFactor = (typeof SCORE_FACTORS)[number];
export type ScoreWeights = Record<ScoreFactor, number>;

export const DEFAULT_WEIGHTS: ScoreWeights = { website: 30, activity: 15, fit: 15, reachability: 15, interest: 15, budget: 10 };

export const FACTOR_LABELS: Record<ScoreFactor, string> = {
  website: 'Website opportunity',
  activity: 'Business activity',
  fit: 'Fit with agency expertise',
  reachability: 'Reachability (appropriate channels)',
  interest: 'Expressed interest',
  budget: 'Budget readiness',
};

export type ScoreBand = 'high' | 'qualify' | 'research' | 'low';
export const BAND_META: Record<ScoreBand, { label: string; range: string }> = {
  high: { label: 'High priority', range: '80–100' },
  qualify: { label: 'Worth further qualification', range: '60–79' },
  research: { label: 'Research needed', range: '40–59' },
  low: { label: 'Low priority', range: '0–39' },
};

export interface FactorResult {
  factor: ScoreFactor;
  label: string;
  value: number;
  known: boolean;
  weight: number;
  contribution: number;
  reason: string;
}

export interface ScoreResult {
  opportunity: number;
  confidence: number;
  band: ScoreBand;
  factors: FactorResult[];
  flags: string[];
  computedAt: string;
}

export interface ScoringInput {
  websiteStatus: WebsiteStatus;
  websiteOutdated: boolean;
  businessStatus: BusinessStatus;
  category: string;
  contactPermission: ContactPermission;
  enquiryChannel: string | null;
  phone: string | null;
  email: string | null;
  interestLevel: InterestLevel;
  budgetSignal: BudgetSignal;
  socialProfiles: unknown[];
}

export interface VerificationSignal {
  confidence: Confidence;
  checkedAt: string;
  methods: string[];
}

export interface ScoringOptions {
  weights?: Partial<ScoreWeights>;
  focusCategories?: string[];
  now?: Date;
}

type Partial3 = Pick<FactorResult, 'value' | 'known' | 'reason'>;

function websiteFactor(input: ScoringInput): Partial3 {
  const social = input.socialProfiles.length > 0;
  switch (input.websiteStatus) {
    case 'none_found':
      return {
        value: social ? 100 : 95,
        known: true,
        reason: social
          ? 'No official website found after documented checks; the business relies on social profiles.'
          : 'No official website found after documented checks.',
      };
    case 'unavailable':
      return { value: 90, known: true, reason: 'The identified website does not respond or has lapsed.' };
    case 'unhealthy':
      return { value: 80, known: true, reason: 'The website responds but has technical problems.' };
    case 'verified_official':
      return input.websiteOutdated
        ? { value: 65, known: true, reason: 'An official website exists but was assessed as outdated.' }
        : { value: 20, known: true, reason: 'The business already has a working official website.' };
    case 'potential_official':
      return { value: 45, known: false, reason: 'A possible website exists but ownership is unconfirmed.' };
    case 'insufficient_evidence':
      return { value: 50, known: false, reason: 'Website checks so far are inconclusive.' };
    default:
      return { value: 50, known: false, reason: 'Website presence has not been researched yet.' };
  }
}

function activityFactor(input: ScoringInput): Partial3 {
  if (input.businessStatus === 'active') return { value: 100, known: true, reason: 'Business confirmed as operating.' };
  if (input.businessStatus === 'inactive') return { value: 0, known: true, reason: 'Business appears inactive or closed.' };
  return { value: 50, known: false, reason: 'Operating status not yet confirmed.' };
}

function fitFactor(input: ScoringInput, focus: string[]): Partial3 {
  const inFocus = focus.some((c) => c.toLowerCase() === input.category.trim().toLowerCase());
  return inFocus
    ? { value: 100, known: true, reason: `${input.category} is a focus industry for the agency.` }
    : { value: 55, known: true, reason: `${input.category} is outside the agency's current focus industries.` };
}

function reachabilityFactor(input: ScoringInput): Partial3 {
  switch (input.contactPermission) {
    case 'opted_out':
      return { value: 0, known: true, reason: 'The business opted out. Do not contact.' };
    case 'declined':
      return { value: 10, known: true, reason: 'The business declined contact.' };
    case 'granted':
      return { value: 100, known: true, reason: 'Permission to contact has been recorded.' };
    case 'introduction_requested':
      return { value: 60, known: true, reason: 'An introduction has been requested; awaiting a response.' };
    default: {
      const channel = Boolean(input.enquiryChannel || input.phone || input.email);
      return channel
        ? { value: 45, known: true, reason: 'A public business enquiry channel is recorded; permission not yet established.' }
        : { value: 20, known: false, reason: 'No appropriate business contact channel recorded.' };
    }
  }
}

function interestFactor(input: ScoringInput): Partial3 {
  const map: Record<InterestLevel, Partial3> = {
    high: { value: 100, known: true, reason: 'The business expressed strong interest.' },
    medium: { value: 70, known: true, reason: 'The business expressed some interest.' },
    low: { value: 40, known: true, reason: 'The business expressed limited interest.' },
    none: { value: 5, known: true, reason: 'The business said it is not interested.' },
    unknown: { value: 40, known: false, reason: 'Interest has not been discussed with the business.' },
  };
  return map[input.interestLevel];
}

function budgetFactor(input: ScoringInput): Partial3 {
  const map: Record<BudgetSignal, Partial3> = {
    strong: { value: 100, known: true, reason: 'The business indicated a strong budget.' },
    adequate: { value: 75, known: true, reason: 'The business indicated an adequate budget.' },
    limited: { value: 35, known: true, reason: 'The business indicated a limited budget.' },
    unknown: { value: 50, known: false, reason: 'Budget is unknown and is not inferred.' },
  };
  return map[input.budgetSignal];
}

export function bandFor(score: number): ScoreBand {
  if (score >= 80) return 'high';
  if (score >= 60) return 'qualify';
  if (score >= 40) return 'research';
  return 'low';
}

function sanitizeWeights(weights: Partial<ScoreWeights> | undefined): ScoreWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...weights };
  for (const key of SCORE_FACTORS) {
    const w = Number(merged[key]);
    merged[key] = Number.isFinite(w) && w >= 0 ? w : DEFAULT_WEIGHTS[key];
  }
  return merged;
}

export function scoreBusiness(input: ScoringInput, verification: VerificationSignal | null, options: ScoringOptions = {}): ScoreResult {
  const weights = sanitizeWeights(options.weights);
  const now = options.now ?? new Date();
  const partials: Record<ScoreFactor, Partial3> = {
    website: websiteFactor(input),
    activity: activityFactor(input),
    fit: fitFactor(input, options.focusCategories ?? []),
    reachability: reachabilityFactor(input),
    interest: interestFactor(input),
    budget: budgetFactor(input),
  };

  const totalWeight = SCORE_FACTORS.reduce((sum, f) => sum + weights[f], 0) || 1;
  const factors: FactorResult[] = SCORE_FACTORS.map((factor) => {
    const p = partials[factor];
    return {
      factor,
      label: FACTOR_LABELS[factor],
      ...p,
      weight: weights[factor],
      contribution: Math.round(((p.value * weights[factor]) / totalWeight) * 10) / 10,
    };
  });

  let opportunity = Math.round(factors.reduce((sum, f) => sum + f.value * f.weight, 0) / totalWeight);
  const flags: string[] = [];
  if (input.businessStatus === 'inactive') {
    opportunity = Math.min(opportunity, 10);
    flags.push('Business appears inactive — score capped at 10.');
  }
  if (input.contactPermission === 'opted_out') flags.push('Opted out — do not contact.');
  if (input.websiteStatus === 'unverified') flags.push('Website not yet verified — do not claim the business lacks a website.');

  // Confidence: evidence quality (60%) + proportion of known factors by weight (40%).
  let evidence = 15;
  if (verification) {
    evidence = { low: 35, medium: 65, high: 90 }[verification.confidence];
    evidence += Math.min(15, Math.max(0, verification.methods.length - 1) * 5);
    const ageDays = (now.getTime() - new Date(verification.checkedAt).getTime()) / 86_400_000;
    if (ageDays > 180) {
      evidence -= 20;
      flags.push('Latest verification is over 6 months old — re-check before outreach.');
    } else if (ageDays > 90) {
      evidence -= 10;
    }
  }
  const knownWeight = factors.filter((f) => f.known).reduce((sum, f) => sum + f.weight, 0);
  const confidence = Math.round(0.6 * clamp(evidence) + 0.4 * ((knownWeight / totalWeight) * 100));

  return { opportunity: clamp(opportunity), confidence: clamp(confidence), band: bandFor(opportunity), factors, flags, computedAt: now.toISOString() };
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
