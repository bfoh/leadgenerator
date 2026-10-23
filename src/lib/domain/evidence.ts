// Builds the numbered evidence pack that grounds opportunity reports. Only stored, attributable
// facts go in. Anything typed by a user or fetched from a website is flagged as such so the report
// generator treats it as data, never as instructions. Contact details are summarised by channel,
// source and permission only: addresses and numbers never enter the pack (or reach the AI model).

import { z } from 'zod';
import { AUDIT_CATEGORY_LABELS, AUDIT_KIND_LABELS } from './audit';
import {
  BUDGET_LABELS,
  BUSINESS_STATUS_LABELS,
  CONTACT_PERMISSION_META,
  INTEREST_LABELS,
  VERIFICATION_METHOD_LABELS,
  WEBSITE_STATUS_META,
} from './constants';
import {
  CONSENT_CHANNEL_LABELS,
  CONTACT_SOURCES,
  CONTACT_TYPE_LABELS,
  activeSuppressions,
  channelEligibility,
  type ConsentChannel,
  type ConsentRecord,
  type ContactPoint,
  type Suppression,
  validationCurrent,
} from './contacts';
import { countryName } from './geo';
import { BAND_META } from './scoring';
import type { AuditFinding, Business, WebsiteVerification } from './types';

export const evidenceItemSchema = z.object({
  id: z.string().regex(/^E\d{1,3}$/),
  kind: z.enum(['profile', 'verification', 'technical', 'presence', 'commercial', 'note', 'identity', 'score', 'audit', 'contact']),
  statement: z.string().max(2000),
  source: z.string().max(2000).nullable(),
  recordedAt: z.string().max(40).nullable(),
  userSupplied: z.boolean(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

const channelSignal = z.object({
  /** none: nothing recorded; found: recorded but not usable yet; usable: validated, permitted source. */
  detail: z.enum(['none', 'found', 'usable']),
  consent: z.enum(['none', 'granted', 'withdrawn', 'expired']),
  eligible: z.boolean(),
});

/** Deterministic research signals (scores, confidence, permission). Absent on packs saved before phase 5. */
export const evidenceSignalsSchema = z.object({
  verificationConfidence: z.number().min(0).max(100).nullable(),
  identityConfidence: z.number().min(0).max(100).nullable(),
  opportunityScore: z.number().min(0).max(100).nullable(),
  scoreConfidence: z.number().min(0).max(100).nullable(),
  band: z.string().max(20).nullable(),
  businessStatus: z.string().max(40),
  contactPermission: z.string().max(40),
  verifiedIssues: z.number().int().min(0),
  growthHypotheses: z.number().int().min(0),
  contacts: z.object({ email: channelSignal, whatsapp: channelSignal, phone: channelSignal, suppressed: z.boolean() }).nullable(),
});
export type EvidenceSignals = z.infer<typeof evidenceSignalsSchema>;

export const evidencePackSchema = z.object({
  business: z.object({
    name: z.string().max(200),
    category: z.string().max(80),
    city: z.string().max(80),
    region: z.string().max(80).nullable(),
    neighborhood: z.string().max(80).nullable(),
    country: z.string().max(80),
    websiteStatus: z.string().max(40),
  }),
  items: z.array(evidenceItemSchema).max(80),
  unknowns: z.array(z.string().max(300)).max(30),
  signals: evidenceSignalsSchema.optional(),
  generatedAt: z.string().max(40),
});
export type EvidencePack = z.infer<typeof evidencePackSchema>;

/** Optional research beyond the profile and verifications (migrations 004 and 005). */
export interface EvidenceExtras {
  findings?: AuditFinding[];
  contacts?: { points: ContactPoint[]; consents: ConsentRecord[]; suppressions: Suppression[] } | null;
}

const MAX_TEXT = 1200;
const MAX_FINDINGS = 12;
function clip(text: string) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

const CHANNELS: ConsentChannel[] = ['email', 'whatsapp', 'phone'];

function contactEvidence(business: Business, contacts: NonNullable<EvidenceExtras['contacts']>, now: Date) {
  const points = contacts.points.filter((p) => p.businessId === business.id);
  const suppressed = activeSuppressions(contacts.suppressions).some((s) => s.kind === 'business' && s.businessId === business.id);
  const signals = {} as Record<ConsentChannel, z.infer<typeof channelSignal>>;
  const statements: { statement: string; source: string | null; recordedAt: string | null }[] = [];
  for (const channel of CHANNELS) {
    const e = channelEligibility(business, points, channel, { consents: contacts.consents, suppressions: contacts.suppressions, now });
    const usable = e.point && (e.point.classification === 'verified_business_channel' || e.point.classification === 'source_confirmed') && validationCurrent(e.point, now);
    signals[channel] = { detail: !e.point ? 'none' : usable ? 'usable' : 'found', consent: e.consent.state, eligible: e.eligible };
    if (!e.point) continue;
    const p = e.point;
    const source = CONTACT_SOURCES[p.sourceType].label.toLowerCase();
    const validated = p.validatedAt ? `validated on ${p.validatedAt.slice(0, 10)}` : 'not validated yet';
    const consent = e.consent.state === 'granted' ? 'consent is on file' : e.consent.state === 'none' ? 'no consent is on file' : `consent is ${e.consent.state}`;
    statements.push({
      statement: `${CONSENT_CHANNEL_LABELS[channel]}: ${/^[aeiou]/i.test(CONTACT_TYPE_LABELS[p.type]) ? 'an' : 'a'} ${CONTACT_TYPE_LABELS[p.type].toLowerCase()} detail is recorded (source: ${source}; ${validated}); ${consent}. ${e.eligible ? 'Contact-level checks pass for this channel.' : 'Marketing on this channel is not permitted at present.'}`,
      source: p.sourceUrl,
      recordedAt: p.acquiredAt,
    });
  }
  return { signals: { ...signals, suppressed }, statements, any: points.length > 0 };
}

export function buildEvidencePack(business: Business, verifications: WebsiteVerification[], now = new Date(), extras: EvidenceExtras = {}): EvidencePack {
  const items: EvidenceItem[] = [];
  const push = (item: Omit<EvidenceItem, 'id'>) => items.push({ id: `E${items.length + 1}`, ...item });
  const location = [business.neighborhood, business.city, business.region, countryName(business.country)].filter(Boolean).join(', ');

  push({ kind: 'profile', statement: `Business category recorded as "${business.category}".`, source: business.sourceUrl, recordedAt: business.createdAt, userSupplied: false });
  push({ kind: 'profile', statement: `Location recorded as ${location}.`, source: business.sourceUrl, recordedAt: business.createdAt, userSupplied: false });
  if (business.businessStatus !== 'unknown') {
    push({ kind: 'profile', statement: `Operating status: ${BUSINESS_STATUS_LABELS[business.businessStatus]}.`, source: null, recordedAt: business.updatedAt, userSupplied: false });
  }
  if (business.identityConfidence != null) {
    push({ kind: 'identity', statement: `Business identity confidence: ${business.identityConfidence}/100 (how well the recorded identifiers, sources and location establish which business this is, after duplicate checks).`, source: null, recordedAt: business.updatedAt, userSupplied: false });
  }

  // Rejected agent results never count as evidence.
  const sorted = [...verifications].filter((v) => v.reviewStatus !== 'rejected').sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)).slice(0, 6);
  for (const v of sorted) {
    const methods = v.methods.map((m) => VERIFICATION_METHOD_LABELS[m]).join('; ');
    const who = v.actorType === 'agent' ? 'Automated website verification' : 'Website verification';
    push({
      kind: 'verification',
      statement: clip(
        `${who} on ${v.checkedAt.slice(0, 10)}: outcome "${WEBSITE_STATUS_META[v.status].label}" (${v.confidenceScore != null ? `evidence confidence ${v.confidenceScore}/100` : `${v.confidence} confidence`})` +
          `${v.domain ? ` for ${v.domain}` : ''}. Methods: ${methods}.${v.websiteOutdated ? ' Reviewer assessed the site as outdated.' : ''}` +
          ` Evidence summary: «${v.evidenceSummary}»`,
      ),
      source: v.sourceUrl,
      recordedAt: v.checkedAt,
      userSupplied: true,
    });
    const t = v.technical;
    if (t) {
      const parts = [
        t.status ? `HTTP status ${t.status}` : `no HTTP response (${t.error ?? 'unknown error'})`,
        t.finalUrl && t.finalUrl !== t.url ? `redirected to ${t.finalUrl}` : null,
        t.https ? 'served over HTTPS' : 'not served over HTTPS',
        t.responseMs != null ? `responded in ${t.responseMs} ms` : null,
        t.hasViewport === false ? 'no mobile viewport tag' : t.hasViewport ? 'has a mobile viewport tag' : null,
        t.title ? `page title «${t.title.slice(0, 120)}»` : null,
      ].filter(Boolean);
      push({ kind: 'technical', statement: clip(`Automated check of ${t.url}: ${parts.join(', ')}.`), source: t.url, recordedAt: t.checkedAt, userSupplied: false });
    }
  }

  const findings = (extras.findings ?? [])
    .filter((f) => f.businessId === business.id && (f.reviewStatus === 'unreviewed' || f.reviewStatus === 'accepted'))
    .sort((a, b) => (a.kind === b.kind ? b.confidence - a.confidence : a.kind === 'verified_issue' ? -1 : 1))
    .slice(0, MAX_FINDINGS);
  for (const f of findings) {
    const observed = f.evidence.map((e) => e.statement).join(' ');
    push({
      kind: 'audit',
      statement: clip(
        `Digital audit — ${AUDIT_KIND_LABELS[f.kind].toLowerCase()} (${AUDIT_CATEGORY_LABELS[f.category]}, ${f.severity}, confidence ${f.confidence}/100${f.reviewStatus === 'accepted' ? ', accepted by a reviewer' : ''}): ${f.title}. Observed: ${observed}`,
      ),
      source: f.evidence.find((e) => e.source)?.source ?? null,
      recordedAt: f.createdAt,
      userSupplied: true,
    });
  }

  for (const p of business.socialProfiles) {
    push({ kind: 'presence', statement: `Social profile recorded (${p.platform}).`, source: p.url, recordedAt: business.updatedAt, userSupplied: true });
  }
  if (business.officialWebsite) {
    push({ kind: 'presence', statement: `Website recorded on the profile: ${business.officialWebsite}.`, source: business.officialWebsite, recordedAt: business.updatedAt, userSupplied: true });
  }

  const contact = extras.contacts ? contactEvidence(business, extras.contacts, now) : null;
  for (const c of contact?.statements ?? []) push({ kind: 'contact', statement: c.statement, source: c.source, recordedAt: c.recordedAt, userSupplied: false });
  push({
    kind: 'contact',
    statement: `Business-level contact permission: ${CONTACT_PERMISSION_META[business.contactPermission].label}.${business.contactPermission === 'opted_out' ? ' The business must not be contacted.' : ''}`,
    source: null,
    recordedAt: business.updatedAt,
    userSupplied: false,
  });

  const score = business.scoreBreakdown;
  if (score) {
    push({
      kind: 'score',
      statement: `Rule-based opportunity score ${score.opportunity}/100 with research confidence ${score.confidence}/100 (${BAND_META[score.band].label}), computed on ${score.computedAt.slice(0, 10)}.${business.scoreOverride ? ` A team member overrode the opportunity score to ${business.scoreOverride.opportunity}/100.` : ''}`,
      source: null,
      recordedAt: score.computedAt,
      userSupplied: false,
    });
  }
  if (business.serviceNeeds.length) {
    push({ kind: 'commercial', statement: clip(`Operational needs recorded by the team: ${business.serviceNeeds.join('; ')}.`), source: null, recordedAt: business.updatedAt, userSupplied: true });
  }
  if (business.interestLevel !== 'unknown') {
    push({ kind: 'commercial', statement: `Expressed interest level: ${INTEREST_LABELS[business.interestLevel]}.`, source: null, recordedAt: business.updatedAt, userSupplied: true });
  }
  if (business.budgetSignal !== 'unknown') {
    push({ kind: 'commercial', statement: `Budget signal: ${BUDGET_LABELS[business.budgetSignal]}.`, source: null, recordedAt: business.updatedAt, userSupplied: true });
  }
  if (business.notes.trim()) {
    push({ kind: 'note', statement: clip(`Researcher notes: «${business.notes}»`), source: null, recordedAt: business.updatedAt, userSupplied: true });
  }

  const unknowns: string[] = [];
  if (business.websiteStatus === 'unverified') unknowns.push('Website presence has not been verified.');
  if (['insufficient_evidence', 'potential_official'].includes(business.websiteStatus)) unknowns.push('Whether the business has an official website is not yet established.');
  if (business.businessStatus === 'unknown') unknowns.push('Whether the business is currently operating.');
  if (!score) unknowns.push('The prospect has not been scored yet.');
  else if (score.confidence < 50) unknowns.push(`Research confidence is ${score.confidence}/100, so findings may change as research continues.`);
  if (business.contactPermission !== 'granted') unknowns.push(`Contact permission: ${CONTACT_PERMISSION_META[business.contactPermission].label}.`);
  if (contact && !contact.any) unknowns.push('No business contact detail is recorded from a permitted source.');
  if (business.interestLevel === 'unknown') unknowns.push("The business's interest in digital services.");
  if (business.budgetSignal === 'unknown') unknowns.push('Budget and decision-making process.');
  if (!business.serviceNeeds.length) unknowns.push('Specific operational needs (stock, bookings, payments, staff workflows).');
  unknowns.push('Revenue, customer numbers, staff, years in operation and current software are not recorded and are not estimated.');

  const latest = sorted[0];
  return {
    business: {
      name: business.name,
      category: business.category,
      city: business.city,
      region: business.region,
      neighborhood: business.neighborhood,
      country: countryName(business.country),
      websiteStatus: business.websiteStatus,
    },
    items,
    unknowns,
    signals: {
      verificationConfidence: latest ? (latest.confidenceScore ?? { low: 40, medium: 65, high: 85 }[latest.confidence]) : null,
      identityConfidence: business.identityConfidence ?? null,
      opportunityScore: score ? (business.scoreOverride?.opportunity ?? score.opportunity) : null,
      scoreConfidence: score?.confidence ?? null,
      band: score?.band ?? null,
      businessStatus: business.businessStatus,
      contactPermission: business.contactPermission,
      verifiedIssues: findings.filter((f) => f.kind === 'verified_issue').length,
      growthHypotheses: findings.filter((f) => f.kind === 'opportunity').length,
      contacts: contact?.signals ?? null,
    },
    generatedAt: now.toISOString(),
  };
}
