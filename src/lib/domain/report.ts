// Opportunity report (schema version 2): twelve sections whose statements are each labelled as a
// verified fact, an evidence-supported finding, a recommendation, an assumption or an unknown.
// Grounding is enforced here, deterministically, for every generator (rule-based, AI and edits):
// facts and findings must cite evidence that exists and that actually mentions what they claim;
// invented business figures, prices, owners, awards, testimonials and guarantees are removed; the
// recommended next action must be one the research and permission state allows. Reports saved in
// the earlier format are converted on read and never rewritten.

import { z } from 'zod';
import { TRACKS, trackForCategory, type TrackKey } from './categories';
import { WEBSITE_STATUS_META, type Tone, type WebsiteStatus } from './constants';
import type { EvidenceItem, EvidencePack } from './evidence';

// ── Statement labels ─────────────────────────────────────────────────────────

export const STATEMENT_KINDS = ['verified_fact', 'evidence_supported', 'recommendation', 'assumption', 'unknown'] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];
export const STATEMENT_KIND_META: Record<StatementKind, { label: string; tone: Tone; description: string }> = {
  verified_fact: { label: 'Verified fact', tone: 'success', description: 'Stated directly by recorded evidence.' },
  evidence_supported: { label: 'Evidence-supported finding', tone: 'info', description: 'A conclusion drawn from the cited evidence.' },
  recommendation: { label: 'Recommendation', tone: 'accent', description: 'The agency’s professional advice, not a fact about the business.' },
  assumption: { label: 'Assumption', tone: 'warning', description: 'Plausible but unconfirmed; check it with the business.' },
  unknown: { label: 'Unknown', tone: 'neutral', description: 'Not established by the research.' },
};
/** Kinds that assert something about the business and therefore need evidence. */
const CLAIM_KINDS: StatementKind[] = ['verified_fact', 'evidence_supported'];

const statement = z.object({ kind: z.enum(STATEMENT_KINDS), text: z.string(), evidenceIds: z.array(z.string()) });
export type ReportStatement = z.infer<typeof statement>;
const section = z.object({ summary: z.string(), statements: z.array(statement) });
export type ReportSection = z.infer<typeof section>;

export const NEXT_ACTIONS = [
  'request_verification',
  'complete_research',
  'seek_introduction',
  'record_consent',
  'discovery_conversation',
  'prepare_proposal',
  'review_manually',
  'do_not_pursue',
] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];
export const NEXT_ACTION_META: Record<NextAction, { label: string; detail: string }> = {
  request_verification: { label: 'Complete website verification first', detail: 'The website position is not established, so no commercial step is recommended yet.' },
  complete_research: { label: 'Complete the research', detail: 'Confidence is too low to act on; fill the gaps listed under limitations.' },
  seek_introduction: { label: 'Seek permission through an introduction', detail: 'No permission to market to the business is recorded. Ask for an introduction or wait for the business to get in touch.' },
  record_consent: { label: 'Record consent if the business has given it', detail: 'If the business has agreed in writing to hear from us, record that consent with its evidence before any message.' },
  discovery_conversation: { label: 'Hold a discovery conversation', detail: 'Permission is recorded; confirm needs, priorities and the decision-maker before scoping.' },
  prepare_proposal: { label: 'Prepare a proposal', detail: 'Permission is recorded and the needs are clear enough to draft a proposal for approval.' },
  review_manually: { label: 'Review manually', detail: 'A person should look at this prospect before anything else happens.' },
  do_not_pursue: { label: 'Do not pursue', detail: 'The business opted out, is suppressed, appears inactive or is not a fit.' },
};

export const PRIORITIES = ['primary', 'secondary', 'future'] as const;

// ── Schemas ──────────────────────────────────────────────────────────────────

/** What a generator writes. Kept free of length and count constraints so it works as a structured-output schema. */
export const reportDraftSchema = z.object({
  businessOverview: section,
  researchSummary: section,
  websiteFindings: section,
  contactAssessment: section,
  digitalPresence: section,
  opportunities: z.array(z.object({ title: z.string(), description: z.string(), kind: z.enum(['evidence_supported', 'recommendation']), evidenceIds: z.array(z.string()) })),
  recommendedSolution: z.object({
    summary: z.string(),
    items: z.array(z.object({ service: z.string(), priority: z.enum(PRIORITIES), rationale: z.string(), evidenceIds: z.array(z.string()) })),
    statements: z.array(statement),
  }),
  implementationPhases: z.array(z.object({ name: z.string(), objective: z.string(), deliverables: z.array(z.string()), indicativeDuration: z.string() })),
  expectedBenefits: z.array(statement),
  limitations: z.array(z.object({ item: z.string(), howToConfirm: z.string() })),
  nextAction: z.object({ action: z.enum(NEXT_ACTIONS), rationale: z.string() }),
});
export type ReportDraft = z.infer<typeof reportDraftSchema>;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
const confidenceSummarySchema = z.object({
  overall: z.enum(CONFIDENCE_LEVELS),
  score: z.number().nullable(),
  items: z.array(z.object({ area: z.string(), level: z.enum(CONFIDENCE_LEVELS), detail: z.string() })),
  statementCounts: z.object(Object.fromEntries(STATEMENT_KINDS.map((k) => [k, z.number()])) as Record<StatementKind, z.ZodNumber>),
});
export type ConfidenceSummary = z.infer<typeof confidenceSummarySchema>;

/** A stored report: the draft plus the parts computed from the evidence (references, confidence). */
export const reportContentSchema = reportDraftSchema.extend({
  schemaVersion: z.literal(2),
  evidenceReferences: z.array(z.string()),
  confidence: confidenceSummarySchema,
  /** Set when an earlier-format report was converted for display. */
  convertedFrom: z.literal(1).optional(),
});
export type ReportContent = z.infer<typeof reportContentSchema>;

const claim = z.object({ statement: z.string(), evidenceIds: z.array(z.string()) });
/** The format used before phase 5. Still read; never written. */
export const legacyReportContentSchema = z.object({
  executiveOverview: z.string(),
  verifiedFacts: z.array(claim),
  interpretations: z.array(claim),
  opportunities: z.array(z.object({ title: z.string(), description: z.string() })),
  recommendedServices: z.array(z.object({ service: z.string(), priority: z.enum(PRIORITIES), rationale: z.string() })),
  phases: z.array(z.object({ name: z.string(), objective: z.string(), deliverables: z.array(z.string()), indicativeDuration: z.string() })),
  generalRecommendations: z.array(z.string()),
  uncertainties: z.array(z.object({ item: z.string(), howToConfirm: z.string() })),
});

export const REPORT_SECTIONS = [
  { key: 'businessOverview', title: 'Business overview' },
  { key: 'researchSummary', title: 'Research summary' },
  { key: 'websiteFindings', title: 'Website verification findings' },
  { key: 'contactAssessment', title: 'Contact channel assessment' },
  { key: 'digitalPresence', title: 'Current digital presence' },
  { key: 'opportunities', title: 'Identified opportunities' },
  { key: 'recommendedSolution', title: 'Recommended website or software solution' },
  { key: 'implementationPhases', title: 'Suggested implementation phases' },
  { key: 'expectedBenefits', title: 'Expected business benefits' },
  { key: 'limitations', title: 'Limitations and uncertainties' },
  { key: 'evidenceReferences', title: 'Evidence references' },
  { key: 'nextAction', title: 'Recommended next commercial action' },
] as const;
export const NARRATIVE_SECTIONS = ['businessOverview', 'researchSummary', 'websiteFindings', 'contactAssessment', 'digitalPresence'] as const;
export type NarrativeSection = (typeof NARRATIVE_SECTIONS)[number];

// ── Unsupported business facts ───────────────────────────────────────────────

interface Topic {
  key: string;
  label: string;
  pattern: RegExp;
  /** Also refused in recommendations and assumptions unless the evidence pack itself mentions it. */
  guidance: boolean;
  /** Also refused in unknowns and limitations (a figure there is still an invented figure). */
  always?: boolean;
}

const TOPICS: Topic[] = [
  { key: 'revenue', label: 'revenue or profit', pattern: /\b(revenue|turnover|profits?|profitab\w+|earnings|annual sales|monthly sales|sales (figures?|volumes?))\b/i, guidance: false },
  { key: 'revenue_figure', label: 'revenue or sales figures', pattern: /\b(revenue|turnover|profits?|sales|income|earnings)\b[^.]{0,40}\d|\d[^.]{0,20}\b(revenue|turnover|profits?|in sales)\b/i, guidance: true },
  { key: 'customers', label: 'customer numbers', pattern: /\b\d[\d,.]*\s*\+?\s*(k\s+)?(customers|clients|visitors|patients|guests|students|members|orders|followers)\b/i, guidance: true },
  { key: 'years', label: 'years in operation', pattern: /\b(since (19|20)\d{2}|established in|founded in|in business for|over \d+ years|\d+\s+years? (in business|of (experience|operation|trading)|old))\b/i, guidance: true },
  { key: 'staff', label: 'employee numbers', pattern: /\b\d+\s+(employees|staff|workers|stylists|team members|branches)\b/i, guidance: true },
  { key: 'conversion', label: 'conversion rates', pattern: /\bconversion rates?\b|\b\d+(\.\d+)?\s?(%|per ?cent)/i, guidance: true },
  {
    key: 'software',
    label: 'existing software systems',
    pattern: /\b(uses|using|runs on|built (with|on)|powered by|relies on)\s+(shopify|wordpress|wix|squarespace|woocommerce|quickbooks|sage|odoo|salesforce|hubspot|zoho|excel|google sheets|square|loyverse|tally|pastel)\b/i,
    guidance: true,
  },
  {
    key: 'owner',
    label: 'owner identity',
    pattern: /\b([Oo]wner|[Ff]ounder|[Cc]o-?founder|CEO|[Mm]anaging [Dd]irector|[Pp]roprietor|[Pp]roprietress)\b[^.]{0,20}?\b(is|named|called)\s+((Mr|Mrs|Ms|Dr|Madam|Auntie)\.?\s+)?[A-Z][a-z]+|\b(owned|founded|run|managed) by\s+((Mr|Mrs|Ms|Dr|Madam|Auntie)\.?\s+)?[A-Z][a-z]+/,
    guidance: true,
  },
  { key: 'budget', label: 'budget', pattern: /\bbudget (of|is|around|about|between)\b/i, guidance: true },
  { key: 'money', label: 'prices or monetary amounts', pattern: /(GH[S¢₵]|₵|US\$|\$|USD)\s?\d|\d[\d,.]*\s?(GHS|cedis?|USD|dollars)\b/i, guidance: true, always: true },
  { key: 'awards', label: 'awards', pattern: /\b(award(-winning|ed)?|winner of|won the)\b/i, guidance: true },
  { key: 'testimonials', label: 'testimonials or reviews', pattern: /\b(testimonials?|customers (say|love|rave)|\d(\.\d)?\s*-?\s*stars?|\d+\s+reviews|rated \d)/i, guidance: true },
  {
    key: 'guarantee',
    label: 'guaranteed results',
    pattern:
      /\b(guarantee[ds]?|will (definitely |certainly )?(increase|double|triple|boost|grow) (your |their |its )?(sales|revenue|profits?|customers|bookings|income)|(sales|revenue|profits?|income|bookings|customers) will (definitely |certainly )?(double|triple|increase|grow|rise|soar))\b/i,
    guidance: true,
    always: true,
  },
];

const ABSENCE = /\b(has no|have no|does not have|doesn['’]t have|lacks?|without|no) (an? )?(official |own |any |working )?(web ?site|online presence)\b/i;
const ABSENCE_HEDGED = /\b(not|no)\b[^.]{0,60}\bfound\b|\bdocumented checks\b|\bnot proof\b/i;

type Context = 'claim' | 'guidance' | 'unknown';

/** Topics in `text` that the given support does not back up. */
export function unsupportedTopics(text: string, context: Context, support: string): string[] {
  const out: string[] = [];
  for (const t of TOPICS) {
    if (context === 'unknown' && !t.always) continue;
    if (context === 'guidance' && !t.guidance) continue;
    if (t.pattern.test(text) && !t.pattern.test(support)) out.push(t.label);
  }
  return out;
}

function absenceProblem(text: string, websiteStatus: string): string | null {
  if (!ABSENCE.test(text)) return null;
  if (websiteStatus !== 'none_found') return `says the business has no website, but the verification status is “${WEBSITE_STATUS_META[websiteStatus as WebsiteStatus]?.label ?? websiteStatus}”`;
  return ABSENCE_HEDGED.test(text) ? null : 'states the absence of a website as fact rather than as the result of documented checks';
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ReportValidation {
  droppedClaims: string[];
  warnings: string[];
  /** Phase 5 counters; absent on reports validated before. */
  checks?: { statements: number; cited: number; removed: number; downgraded: number; replacedSummaries: number; nextActionChanged: boolean };
}

/**
 * Enforces grounding on a draft and returns the stored content. Facts and findings without valid
 * citations become unknowns; any statement that asserts business facts the evidence does not
 * support is removed; summaries that do so are replaced with the rule-based summary; an
 * opportunity without evidence is labelled a recommendation; the next action is limited to what
 * the research and permission state allow.
 */
export function validateReport(draft: ReportDraft, pack: EvidencePack): { content: ReportContent; validation: ReportValidation } {
  const byId = new Map(pack.items.map((i) => [i.id, i]));
  const packText = pack.items.map((i) => i.statement).join('\n');
  const status = pack.business.websiteStatus;
  const dropped: string[] = [];
  const warnings: string[] = [];
  const limitations = [...draft.limitations];
  const checks = { statements: 0, cited: 0, removed: 0, downgraded: 0, replacedSummaries: 0, nextActionChanged: false };
  let fallback: ReportDraft | null = null;
  const rule = () => (fallback ??= generateDeterministicReport(pack));

  const validIds = (ids: string[]) => [...new Set(ids.map((id) => id.trim().toUpperCase()).filter((id) => byId.has(id)))];
  const supportOf = (ids: string[]) => ids.map((id) => byId.get(id)!.statement).join('\n');
  // The removed text is listed in droppedClaims (shown to reviewers), not repeated in the report.
  const remove = (text: string, reason: string): null => {
    checks.removed++;
    dropped.push(text);
    limitations.push({ item: `A statement was removed because ${reason}.`, howToConfirm: 'Record a source for it before relying on it.' });
    return null;
  };

  const checkStatement = (s: ReportStatement): ReportStatement | null => {
    const text = s.text.trim();
    if (!text) return null;
    checks.statements++;
    const evidenceIds = validIds(s.evidenceIds);
    if (CLAIM_KINDS.includes(s.kind)) {
      if (!evidenceIds.length) {
        checks.downgraded++;
        dropped.push(text);
        limitations.push({ item: `Unsupported ${STATEMENT_KIND_META[s.kind].label.toLowerCase()} moved here: “${text}”`, howToConfirm: 'Find and record a source before relying on this.' });
        return null;
      }
      const topics = unsupportedTopics(text, 'claim', supportOf(evidenceIds));
      if (topics.length) return remove(text, `the cited evidence does not mention ${topics.join(', ')}`);
    } else {
      const topics = unsupportedTopics(text, s.kind === 'unknown' ? 'unknown' : 'guidance', packText);
      if (topics.length) return remove(text, `it states ${topics.join(', ')} that the research does not support`);
    }
    // Restating a dated evidence record word for word is accurate even if a later check disagrees.
    const restated = evidenceIds.some((id) => byId.get(id)!.statement === text);
    const absence = restated ? null : absenceProblem(text, status);
    if (absence) return remove(text, `it ${absence}`);
    if (evidenceIds.length) checks.cited++;
    return { kind: s.kind, text, evidenceIds };
  };
  const statements = (list: ReportStatement[]) => list.map(checkStatement).filter((s): s is ReportStatement => s !== null);

  const summary = (text: string, replacement: () => string, where: string) => {
    const t = text.trim();
    const problems = [...unsupportedTopics(t, 'guidance', packText), ...[absenceProblem(t, status)].filter((p): p is string => Boolean(p))];
    if (!t || problems.length) {
      if (t) {
        checks.replacedSummaries++;
        warnings.push(`The ${where} summary was replaced with the rule-based one because it ${problems.length > 1 ? 'made unsupported statements' : `mentioned ${problems[0]}`}.`);
      }
      return replacement();
    }
    return t;
  };

  const narrative = Object.fromEntries(
    NARRATIVE_SECTIONS.map((key) => {
      const title = REPORT_SECTIONS.find((s) => s.key === key)!.title.toLowerCase();
      return [key, { summary: summary(draft[key].summary, () => rule()[key].summary, title), statements: statements(draft[key].statements) }];
    }),
  ) as Record<NarrativeSection, ReportSection>;

  // The website section always carries the correct status statement.
  if (!narrative.websiteFindings.statements.some((s) => s.kind !== 'unknown' && s.kind !== 'recommendation')) {
    narrative.websiteFindings.statements.unshift(...rule().websiteFindings.statements.filter((s) => s.kind !== 'recommendation').slice(0, 1));
  }

  const opportunities = draft.opportunities.flatMap((o) => {
    const title = o.title.trim();
    const description = o.description.trim();
    if (!title && !description) return [];
    const topics = unsupportedTopics(`${title}. ${description}`, 'guidance', packText);
    if (topics.length) {
      remove(title || description, `it states ${topics.join(', ')} that the research does not support`);
      return [];
    }
    const evidenceIds = validIds(o.evidenceIds);
    if (o.kind === 'evidence_supported' && !evidenceIds.length) checks.downgraded++;
    return [{ title, description, kind: evidenceIds.length ? o.kind : ('recommendation' as const), evidenceIds }];
  });

  const items = draft.recommendedSolution.items.flatMap((i) => {
    const service = i.service.trim();
    if (!service) return [];
    const topics = unsupportedTopics(`${service}. ${i.rationale}`, 'guidance', packText);
    if (topics.length) {
      remove(service, `it states ${topics.join(', ')}; prices come only from the configured price list in a proposal`);
      return [];
    }
    return [{ service, priority: i.priority, rationale: i.rationale.trim(), evidenceIds: validIds(i.evidenceIds) }];
  });

  const implementationPhases = draft.implementationPhases.flatMap((p) => {
    const name = p.name.trim();
    if (!name) return [];
    const deliverables = p.deliverables.map((d) => d.trim()).filter(Boolean);
    const topics = unsupportedTopics([name, p.objective, p.indicativeDuration, ...deliverables].join('. '), 'guidance', packText);
    if (topics.length) {
      remove(name, `it states ${topics.join(', ')}`);
      return [];
    }
    return [{ name, objective: p.objective.trim(), deliverables, indicativeDuration: p.indicativeDuration.trim() }];
  });

  const expectedBenefits = statements(draft.expectedBenefits.map((b) => (CLAIM_KINDS.includes(b.kind) ? b : { ...b, kind: b.kind === 'unknown' ? 'unknown' : ('assumption' as const) })));

  const cleanLimitations = limitations
    .map((l) => ({ item: l.item.trim(), howToConfirm: l.howToConfirm.trim() }))
    .filter((l) => l.item && !unsupportedTopics(l.item, 'unknown', packText).length);
  for (const u of pack.unknowns) {
    if (!cleanLimitations.some((l) => l.item === u)) cleanLimitations.push({ item: u, howToConfirm: 'Confirm directly with the business or through documented research.' });
  }

  const allowed = allowedNextActions(pack);
  let nextAction = { action: draft.nextAction.action, rationale: draft.nextAction.rationale.trim() };
  if (!allowed.includes(nextAction.action) || unsupportedTopics(nextAction.rationale, 'guidance', packText).length) {
    checks.nextActionChanged = true;
    if (!allowed.includes(nextAction.action)) {
      warnings.push(`The suggested next action “${NEXT_ACTION_META[nextAction.action].label}” is not allowed by the research and permission state, so it was replaced.`);
    }
    nextAction = { action: allowed[0], rationale: NEXT_ACTION_META[allowed[0]].detail };
  }
  if (!nextAction.rationale) nextAction.rationale = NEXT_ACTION_META[nextAction.action].detail;

  const solutionStatements = statements(draft.recommendedSolution.statements);
  const recommendedSolution = {
    summary: summary(draft.recommendedSolution.summary, () => rule().recommendedSolution.summary, 'recommended solution'),
    items,
    statements: solutionStatements,
  };

  const result: ReportDraft = {
    ...narrative,
    opportunities,
    recommendedSolution,
    implementationPhases,
    expectedBenefits,
    limitations: cleanLimitations,
    nextAction,
  };
  if (dropped.length) warnings.push(`${dropped.length} unsupported statement${dropped.length === 1 ? ' was' : 's were'} removed or moved to limitations.`);
  return { content: finalizeReport(result, pack), validation: { droppedClaims: dropped, warnings, checks } };
}

/** Adds the computed parts (evidence references and confidence summary). */
export function finalizeReport(draft: ReportDraft, pack: EvidencePack, convertedFrom?: 1): ReportContent {
  const all = allStatements(draft);
  const ids = new Set<string>();
  for (const s of all) for (const id of s.evidenceIds) ids.add(id);
  for (const o of draft.opportunities) for (const id of o.evidenceIds) ids.add(id);
  for (const i of draft.recommendedSolution.items) for (const id of i.evidenceIds) ids.add(id);
  const order = new Map(pack.items.map((i, n) => [i.id, n]));
  const evidenceReferences = [...ids].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  return { ...draft, schemaVersion: 2, evidenceReferences, confidence: confidenceSummary(pack, draft), ...(convertedFrom ? { convertedFrom } : {}) };
}

export function allStatements(content: Pick<ReportDraft, NarrativeSection | 'expectedBenefits' | 'recommendedSolution'>): ReportStatement[] {
  return [...NARRATIVE_SECTIONS.flatMap((k) => content[k].statements), ...content.recommendedSolution.statements, ...content.expectedBenefits];
}

// ── Confidence, readiness and next action ────────────────────────────────────

export const DEFAULT_REPORT_MIN_CONFIDENCE = 50;

const level = (n: number | null | undefined): ConfidenceLevel => (n == null ? 'unknown' : n >= 75 ? 'high' : n >= 50 ? 'medium' : 'low');

export function confidenceSummary(pack: EvidencePack, draft: Pick<ReportDraft, NarrativeSection | 'expectedBenefits' | 'recommendedSolution'>): ConfidenceSummary {
  const s = pack.signals;
  const status = pack.business.websiteStatus as WebsiteStatus;
  const counts = Object.fromEntries(STATEMENT_KINDS.map((k) => [k, 0])) as Record<StatementKind, number>;
  for (const st of allStatements(draft)) counts[st.kind]++;
  const statusLabel = WEBSITE_STATUS_META[status]?.label ?? status;
  const items: ConfidenceSummary['items'] = [];

  if (!s) {
    const verified = pack.items.some((i) => i.kind === 'verification');
    items.push({ area: 'Website verification', level: verified ? 'medium' : 'unknown', detail: verified ? statusLabel : 'Not verified' });
    items.push({ area: 'Research signals', level: 'unknown', detail: 'Not captured in this report’s evidence snapshot (written before phase 5).' });
    return { overall: verified ? 'medium' : 'low', score: null, items, statementCounts: counts };
  }

  items.push({
    area: 'Website verification',
    level: status === 'unverified' ? 'unknown' : status === 'insufficient_evidence' ? 'low' : level(s.verificationConfidence),
    detail: `${statusLabel}${s.verificationConfidence != null ? ` · evidence confidence ${s.verificationConfidence}/100` : ''}`,
  });
  items.push({ area: 'Business identity', level: level(s.identityConfidence), detail: s.identityConfidence != null ? `${s.identityConfidence}/100` : 'Not assessed' });
  items.push({
    area: 'Digital audit',
    level: s.verifiedIssues + s.growthHypotheses === 0 ? 'unknown' : s.verifiedIssues > 0 ? 'high' : 'medium',
    detail: s.verifiedIssues + s.growthHypotheses === 0 ? 'No audit findings recorded' : `${s.verifiedIssues} verified issue${s.verifiedIssues === 1 ? '' : 's'}, ${s.growthHypotheses} growth hypothes${s.growthHypotheses === 1 ? 'is' : 'es'}`,
  });
  if (s.contacts) {
    const channels = (['email', 'phone', 'whatsapp'] as const).map((c) => [c, s.contacts![c]] as const);
    const usable = channels.filter(([, v]) => v.detail === 'usable');
    const found = channels.filter(([, v]) => v.detail !== 'none');
    const consent = channels.filter(([, v]) => v.consent === 'granted');
    items.push({
      area: 'Contact channels',
      level: usable.length ? 'high' : found.length ? 'medium' : 'low',
      detail: `${found.length ? `${found.map(([c]) => c).join(', ')} recorded` : 'none recorded'}${usable.length ? ` (${usable.length} usable)` : ''} · ${consent.length ? `consent on file for ${consent.map(([c]) => c).join(', ')}` : 'no consent on file'}`,
    });
  } else {
    items.push({ area: 'Contact channels', level: 'unknown', detail: 'Contact tracking is not available in this workspace.' });
  }
  const overall = s.scoreConfidence != null ? level(s.scoreConfidence) : 'low';
  return { overall: overall === 'unknown' ? 'low' : overall, score: s.scoreConfidence, items, statementCounts: counts };
}

/** Whether there is enough research to write a report without guessing. */
export function reportReadiness(pack: EvidencePack, minConfidence = DEFAULT_REPORT_MIN_CONFIDENCE): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  const status = pack.business.websiteStatus;
  if (status === 'unverified') missing.push('The website position has not been verified yet.');
  else if (status === 'insufficient_evidence') missing.push('Website checks were inconclusive; more verification is needed.');
  if (!pack.items.some((i) => i.kind === 'verification')) missing.push('No website verification evidence is recorded.');
  const c = pack.signals?.scoreConfidence;
  if (c == null) missing.push('The prospect has not been scored.');
  else if (c < minConfidence) missing.push(`Research confidence is ${c}/100, below the workspace minimum of ${minConfidence}/100.`);
  return { ready: missing.length === 0, missing };
}

/** Next actions the research and permission state allow, most appropriate first. */
export function allowedNextActions(pack: EvidencePack): NextAction[] {
  const s = pack.signals;
  const status = pack.business.websiteStatus;
  if (s?.contactPermission === 'opted_out' || s?.contacts?.suppressed) return ['do_not_pursue', 'review_manually'];
  if (status === 'unverified' || status === 'insufficient_evidence') return ['request_verification', 'review_manually', 'do_not_pursue'];
  if (!s) return ['review_manually', 'complete_research', 'do_not_pursue'];
  if (s.businessStatus === 'inactive') return ['review_manually', 'do_not_pursue'];
  if (s.band === 'research' || s.band === 'low' || (s.scoreConfidence ?? 0) < DEFAULT_REPORT_MIN_CONFIDENCE) return ['complete_research', 'request_verification', 'review_manually', 'do_not_pursue'];
  if (s.contactPermission === 'granted') return ['discovery_conversation', 'prepare_proposal', 'review_manually', 'do_not_pursue'];
  return ['seek_introduction', 'record_consent', 'complete_research', 'review_manually', 'do_not_pursue'];
}

// ── Rule-based generator ─────────────────────────────────────────────────────

function websiteSentence(status: string, businessName: string) {
  switch (status) {
    case 'none_found':
      return `Documented checks did not find an official website for ${businessName}. This is not proof that none exists.`;
    case 'verified_official':
      return `${businessName} has a verified official website.`;
    case 'potential_official':
      return `A possible website for ${businessName} has been identified, but ownership is not yet confirmed.`;
    case 'unavailable':
      return `A website associated with ${businessName} was identified but is currently unavailable.`;
    case 'unhealthy':
      return `${businessName}'s website responds but shows technical issues.`;
    case 'insufficient_evidence':
      return `Website research for ${businessName} is inconclusive so far.`;
    default:
      return `${businessName}'s website presence has not been verified yet.`;
  }
}

const BOOKING: TrackKey[] = ['beauty', 'hospitality', 'fitness', 'events', 'creative', 'education', 'bridal', 'professional', 'health', 'finance', 'facilities', 'ict', 'real_estate'];
const CATALOGUE: TrackKey[] = ['fashion', 'furniture', 'bridal', 'auto', 'food', 'pharmacy', 'retail', 'wholesale', 'manufacturing', 'agriculture', 'livestock'];


const fact = (item: EvidenceItem, kind: StatementKind = 'verified_fact'): ReportStatement => ({ kind, text: item.statement, evidenceIds: [item.id] });

export function generateDeterministicReport(pack: EvidencePack): ReportDraft {
  const { business, signals } = pack;
  const trackKey = trackForCategory(business.category);
  const track = TRACKS[trackKey];
  const status = business.websiteStatus;
  const of = (...kinds: EvidenceItem['kind'][]) => pack.items.filter((i) => kinds.includes(i.kind));
  const verification = of('verification')[0];
  const technical = of('technical');
  const audit = of('audit');
  const issues = audit.filter((i) => /verified issue/i.test(i.statement));
  const hypotheses = audit.filter((i) => !/verified issue/i.test(i.statement));
  const social = of('presence').filter((i) => /social/i.test(i.statement));
  const contacts = of('contact');
  const gap = ['none_found', 'unavailable', 'unhealthy'].includes(status);
  const location = [business.neighborhood, business.city].filter(Boolean).join(', ');

  const websiteStatements: ReportStatement[] = [];
  if (verification) {
    websiteStatements.push({ kind: status === 'none_found' ? 'evidence_supported' : 'verified_fact', text: websiteSentence(status, business.name), evidenceIds: [verification.id] });
    websiteStatements.push(...of('verification').map((i) => fact(i)), ...technical.map((i) => fact(i)));
  } else {
    websiteStatements.push({ kind: 'unknown', text: websiteSentence(status, business.name), evidenceIds: [] });
  }
  if (status === 'potential_official' || status === 'insufficient_evidence') {
    websiteStatements.push({ kind: 'unknown', text: 'Whether the business has an official website is not yet established.', evidenceIds: [] });
  }

  const ch = signals?.contacts;
  const contactSummary = ch
    ? `${(['email', 'phone', 'whatsapp'] as const).filter((c) => ch[c].detail !== 'none').length ? `Recorded business channels: ${(['email', 'phone', 'whatsapp'] as const).filter((c) => ch[c].detail !== 'none').join(', ')}.` : 'No business contact channel is recorded from a permitted source.'} ${(['email', 'whatsapp'] as const).some((c) => ch[c].eligible) ? 'Contact-level checks pass for at least one channel; the sending gateway still applies its own checks.' : 'No channel is cleared for marketing messages: a published contact detail is not permission to send them.'}`
    : 'Contact channels were not assessed. A published contact detail is not permission to send marketing messages.';

  const presenceStatements = [...of('presence').map((i) => fact(i)), ...issues.map((i) => fact(i)), ...hypotheses.map((i) => fact(i, 'evidence_supported'))];
  if (social.length && status === 'none_found') {
    presenceStatements.push({ kind: 'evidence_supported', text: 'The business appears to rely on social platforms for its online presence.', evidenceIds: social.map((s) => s.id) });
  }

  const opportunities: ReportDraft['opportunities'] = [
    ...hypotheses.slice(0, 4).map((i) => ({ title: i.statement.replace(/^Digital audit — [^:]+: /, '').split('. Observed:')[0].slice(0, 120), description: 'Raised by the digital audit from the cited evidence; a hypothesis to confirm with the business.', kind: 'evidence_supported' as const, evidenceIds: [i.id] })),
    ...track.opportunities.map((o) => ({ ...o, kind: 'recommendation' as const, evidenceIds: [] })),
  ];

  const benefits: ReportStatement[] = [];
  if (gap) benefits.push({ kind: 'assumption', text: 'An owned, working website would give customers a dependable place to check services, location and how to get in touch.', evidenceIds: verification ? [verification.id] : [] });
  if (BOOKING.includes(trackKey)) benefits.push({ kind: 'assumption', text: 'Structured booking requests could reduce back-and-forth messages when customers arrange appointments.', evidenceIds: [] });
  if (CATALOGUE.includes(trackKey)) benefits.push({ kind: 'assumption', text: 'A browsable catalogue could let customers shortlist products before they visit or enquire.', evidenceIds: [] });
  if (issues.length) benefits.push({ kind: 'assumption', text: 'Fixing the verified technical issues would remove obstacles customers may meet today.', evidenceIds: issues.map((i) => i.id) });
  benefits.push({ kind: 'unknown', text: 'How much any of this would change enquiries or sales is not known; no figures are estimated.', evidenceIds: [] });

  const allowed = allowedNextActions(pack);
  return {
    businessOverview: {
      summary: `${business.name} is recorded as a ${business.category.toLowerCase()} in ${location || business.city}. ${track.customerJourney}`,
      statements: [...of('profile', 'identity').map((i) => fact(i))],
    },
    researchSummary: {
      summary: `This report uses ${pack.items.length} recorded evidence item${pack.items.length === 1 ? '' : 's'}: ${of('verification').length} website check${of('verification').length === 1 ? '' : 's'}, ${audit.length} audit finding${audit.length === 1 ? '' : 's'} and ${contacts.length} contact record${contacts.length === 1 ? '' : 's'}${signals?.scoreConfidence != null ? `, with research confidence ${signals.scoreConfidence}/100` : ''}. Anything not in the evidence is listed under limitations.`,
      statements: [...of('score').map((i) => fact(i)), ...of('commercial', 'note').map((i) => fact(i))],
    },
    websiteFindings: { summary: websiteSentence(status, business.name), statements: websiteStatements },
    contactAssessment: {
      summary: contactSummary,
      statements: [
        ...contacts.map((i) => fact(i)),
        ...(signals?.contactPermission !== 'granted' ? [{ kind: 'unknown' as const, text: 'Whether the business agrees to receive marketing messages: no permission is recorded.', evidenceIds: [] }] : []),
      ],
    },
    digitalPresence: {
      summary: `${of('presence').length ? `${of('presence').length} online presence record${of('presence').length === 1 ? '' : 's'} on file` : 'No online presence is recorded beyond the website checks'}${audit.length ? `; the digital audit recorded ${issues.length} verified issue${issues.length === 1 ? '' : 's'} and ${hypotheses.length} growth hypothes${hypotheses.length === 1 ? 'is' : 'es'}` : ''}.`,
      statements: presenceStatements,
    },
    opportunities,
    recommendedSolution: {
      summary: `For a ${business.category.toLowerCase()}, the core recommendation is ${track.primary[0]?.toLowerCase() ?? 'an owned, mobile-first website'}, with operational tools added once needs are confirmed in discovery.`,
      items: [
        ...track.primary.map((s) => ({ service: s, priority: 'primary' as const, rationale: 'Core recommendation for this industry, subject to discovery.', evidenceIds: gap && verification ? [verification.id] : [] })),
        ...track.secondary.map((s) => ({ service: s, priority: 'secondary' as const, rationale: 'Consider once operational needs are confirmed.', evidenceIds: [] })),
        ...track.future.map((s) => ({ service: s, priority: 'future' as const, rationale: 'Longer-term option; requires a separate assessment.', evidenceIds: [] })),
      ],
      statements: [
        { kind: 'recommendation', text: 'Confirm the business’s priorities and decision-maker in a discovery conversation before scoping.', evidenceIds: [] },
        { kind: 'recommendation', text: 'Agree content ownership (photos, product data, copy) early; it is the most common cause of delay.', evidenceIds: [] },
        { kind: 'recommendation', text: 'Keep business-owned accounts (domain, hosting, payment providers) in the client’s name.', evidenceIds: [] },
      ],
    },
    implementationPhases: [
      { name: 'Phase 1 — Foundation', objective: 'Establish an owned, mobile-first presence.', deliverables: track.primary, indicativeDuration: 'To be agreed after discovery' },
      { name: 'Phase 2 — Operations', objective: 'Add tools that match confirmed operational needs.', deliverables: track.secondary, indicativeDuration: 'To be agreed' },
      { name: 'Phase 3 — Growth', objective: 'Retention and longer-term digital initiatives.', deliverables: track.future, indicativeDuration: 'To be agreed' },
    ],
    expectedBenefits: benefits,
    limitations: [
      ...pack.unknowns.map((u) => ({ item: u, howToConfirm: 'Confirm directly with the business or through documented research.' })),
      { item: 'Opportunities and benefits are hypotheses from the sector and the evidence, not forecasts.', howToConfirm: 'Validate them in a discovery conversation.' },
    ],
    nextAction: { action: allowed[0], rationale: NEXT_ACTION_META[allowed[0]].detail },
  };
}

// ── Earlier format ───────────────────────────────────────────────────────────

/** Reads stored content of either format. Earlier reports are converted for display, not rewritten. */
export function readReportContent(raw: unknown, pack: EvidencePack): ReportContent {
  const current = reportContentSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacy = legacyReportContentSchema.safeParse(raw);
  if (legacy.success) return finalizeReport(convertLegacy(legacy.data, pack), pack, 1);
  const empty = generateDeterministicReport(pack);
  return finalizeReport(
    {
      ...empty,
      limitations: [{ item: 'The stored report content could not be read; this view shows the rule-based assessment of the same evidence.', howToConfirm: 'Regenerate the report.' }, ...empty.limitations],
    },
    pack,
    1,
  );
}

function convertLegacy(old: z.infer<typeof legacyReportContentSchema>, pack: EvidencePack): ReportDraft {
  const allowed = allowedNextActions(pack);
  const notCovered = { summary: 'Not covered separately in this earlier report format; see the research summary.', statements: [] };
  return {
    businessOverview: { summary: old.executiveOverview, statements: [] },
    researchSummary: {
      summary: 'Converted from the earlier report format: verified facts and interpretations are listed below as recorded.',
      statements: [
        ...old.verifiedFacts.map((f) => ({ kind: 'verified_fact' as const, text: f.statement, evidenceIds: f.evidenceIds })),
        ...old.interpretations.map((f) => ({ kind: 'evidence_supported' as const, text: f.statement, evidenceIds: f.evidenceIds })),
      ],
    },
    websiteFindings: { summary: websiteSentence(pack.business.websiteStatus, pack.business.name), statements: [] },
    contactAssessment: notCovered,
    digitalPresence: notCovered,
    opportunities: old.opportunities.map((o) => ({ ...o, kind: 'recommendation', evidenceIds: [] })),
    recommendedSolution: {
      summary: '',
      items: old.recommendedServices.map((s) => ({ ...s, evidenceIds: [] })),
      statements: old.generalRecommendations.map((r) => ({ kind: 'recommendation', text: r, evidenceIds: [] })),
    },
    implementationPhases: old.phases,
    expectedBenefits: [],
    limitations: old.uncertainties,
    nextAction: { action: allowed[0], rationale: `${NEXT_ACTION_META[allowed[0]].detail} (Added when this earlier report was converted.)` },
  };
}

/** A stored report with its content in the current format. */
export function readReport<T extends { content: unknown; inputSnapshot: EvidencePack }>(report: T): T & { content: ReportContent } {
  return { ...report, content: readReportContent(report.content, report.inputSnapshot) };
}

/** A one-paragraph summary for lists and proposals. */
export function reportSummary(content: ReportContent) {
  return [content.businessOverview.summary, content.websiteFindings.summary].filter(Boolean).join(' ');
}

// ── Markdown ─────────────────────────────────────────────────────────────────

export function reportToMarkdown(content: ReportContent, pack: EvidencePack, meta: { version: number; generator: string; createdAt: string; model?: string | null }) {
  const cite = (ids: string[]) => (ids.length ? ` [${ids.join(', ')}]` : '');
  const label = (k: StatementKind) => `**${STATEMENT_KIND_META[k].label}:**`;
  const block = (s: ReportSection) => [s.summary, '', ...s.statements.map((st) => `- ${label(st.kind)} ${st.text}${cite(st.evidenceIds)}`), ''];
  const title = (key: (typeof REPORT_SECTIONS)[number]['key']) => {
    const n = REPORT_SECTIONS.findIndex((s) => s.key === key);
    return `## ${n + 1}. ${REPORT_SECTIONS[n].title}`;
  };
  const lines = [
    `# Digital Opportunity Report — ${pack.business.name}`,
    '',
    `${pack.business.category} · ${pack.business.city}, ${pack.business.country}  `,
    `Version ${meta.version} · ${meta.generator === 'ai' ? `AI-assisted (${meta.model ?? 'model'})` : meta.generator === 'manual_edit' ? 'Edited' : 'Rule-based'} · ${meta.createdAt.slice(0, 10)}  `,
    `Overall confidence: ${content.confidence.overall}${content.confidence.score != null ? ` (research confidence ${content.confidence.score}/100)` : ''}`,
    '',
    '> Statements are labelled: verified facts and evidence-supported findings cite numbered evidence; recommendations and assumptions are the agency’s judgement, not facts about the business.',
    '',
    ...content.confidence.items.map((i) => `- ${i.area}: ${i.level} — ${i.detail}`),
    '',
    title('businessOverview'),
    ...block(content.businessOverview),
    title('researchSummary'),
    ...block(content.researchSummary),
    title('websiteFindings'),
    ...block(content.websiteFindings),
    title('contactAssessment'),
    ...block(content.contactAssessment),
    title('digitalPresence'),
    ...block(content.digitalPresence),
    title('opportunities'),
    ...content.opportunities.map((o) => `- **${o.title}** (${o.kind === 'evidence_supported' ? 'evidence-supported' : 'recommendation'}) — ${o.description}${cite(o.evidenceIds)}`),
    '',
    title('recommendedSolution'),
    content.recommendedSolution.summary,
    '',
    ...content.recommendedSolution.items.map((s) => `- **${s.service}** (${s.priority}) — ${s.rationale}${cite(s.evidenceIds)}`),
    ...content.recommendedSolution.statements.map((st) => `- ${label(st.kind)} ${st.text}${cite(st.evidenceIds)}`),
    '',
    title('implementationPhases'),
    ...content.implementationPhases.flatMap((p) => [`### ${p.name}`, p.objective, ...p.deliverables.map((d) => `- ${d}`), `_Indicative duration: ${p.indicativeDuration}_`, '']),
    title('expectedBenefits'),
    '_Potential benefits, not forecasts. No revenue or sales figures are estimated or promised._',
    '',
    ...content.expectedBenefits.map((st) => `- ${label(st.kind)} ${st.text}${cite(st.evidenceIds)}`),
    '',
    title('limitations'),
    ...content.limitations.map((u) => `- ${u.item} _(${u.howToConfirm})_`),
    '',
    title('evidenceReferences'),
    ...pack.items.map((i) => `- **${i.id}**${content.evidenceReferences.includes(i.id) ? '' : ' (not cited)'} ${i.statement}${i.source ? ` — ${i.source}` : ''}`),
    '',
    title('nextAction'),
    `**${NEXT_ACTION_META[content.nextAction.action].label}.** ${content.nextAction.rationale}`,
  ];
  return lines.join('\n');
}
