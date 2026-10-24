// Proposal content, pricing math, lifecycle rules and Markdown export.

import { z } from 'zod';
import type { ProposalStatus } from './constants';
import { LINE_ITEM_CATEGORIES, LINE_ITEM_KINDS, LINE_ITEM_KIND_LABELS, phaseSchema, type ServicePackage } from './packages';
import type { ProposalPlan } from './proposal-templates';
import type { OrgSettings } from './settings';
import { reportSummary, type ReportContent } from './report';

export const proposalLineItemSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(LINE_ITEM_KINDS),
  category: z.enum(LINE_ITEM_CATEGORIES),
  description: z.string().max(300),
  quantity: z.number().positive().max(10000),
  unitPrice: z.number().nonnegative().max(100_000_000).nullable(),
});
export type ProposalLineItem = z.infer<typeof proposalLineItemSchema>;

const list = z.array(z.string().max(500)).max(60);

/** How a draft was prepared: internal provenance, never printed in the client document. */
export const proposalBasisSchema = z.object({
  source: z.enum(['agent', 'person']),
  /** Agent or template version that produced the draft. */
  generator: z.string().max(40),
  track: z.string().max(40),
  template: z.string().max(80),
  packageKey: z.string().max(40),
  recommendedPackageKey: z.string().max(40),
  reasons: z.array(z.string().max(500)).max(12),
  addOns: z
    .array(z.object({ key: z.string().max(40), name: z.string().max(80), included: z.boolean(), priced: z.boolean(), reason: z.string().max(300) }))
    .max(30),
  roadmap: z.array(z.string().max(300)).max(12),
  unmatchedNeeds: z.array(z.string().max(200)).max(20),
  missingAddOns: z.array(z.string().max(40)).max(30),
  reportId: z.string().max(60).nullable(),
  reportVersion: z.number().int().nullable(),
  reportConfidence: z.string().max(20).nullable(),
  preparedAt: z.string().max(40),
});
export type ProposalBasis = z.infer<typeof proposalBasisSchema>;

export const proposalContentSchema = z.object({
  preparedFor: z.string().max(200),
  preparedBy: z.string().max(200),
  preparedOn: z.string().max(10),
  validUntil: z.string().max(10).nullable(),
  executiveSummary: z.string().max(6000),
  currentSituation: z.string().max(6000),
  opportunities: list,
  recommendedSolution: z.string().max(6000),
  deliverables: list,
  exclusions: list,
  phases: z.array(phaseSchema).max(12),
  timeline: z.string().max(2000),
  lineItems: z.array(proposalLineItemSchema).max(60),
  taxes: z.array(z.object({ id: z.string().max(40), label: z.string().max(80), ratePercent: z.number().min(0).max(100) })).max(10),
  milestones: z.array(z.object({ id: z.string().max(40), label: z.string().max(200), percent: z.number().min(0).max(100), trigger: z.string().max(300) })).max(12),
  maintenanceTerms: z.string().max(4000),
  clientResponsibilities: list,
  assumptions: list,
  nextSteps: list,
  /** Absent on proposals drafted before phase 6. */
  basis: proposalBasisSchema.optional(),
});
export type ProposalContent = z.infer<typeof proposalContentSchema>;

export function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

export interface ProposalTotals {
  oneTimeSubtotal: number;
  monthlySubtotal: number;
  annualSubtotal: number;
  optionalSubtotal: number;
  taxLines: { label: string; ratePercent: number; oneTime: number; monthly: number; annual: number }[];
  oneTimeTotal: number;
  monthlyTotal: number;
  annualTotal: number;
  unpricedRequired: number;
  unpricedOptional: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeTotals(content: Pick<ProposalContent, 'lineItems' | 'taxes'>): ProposalTotals {
  const sum = (kind: string) =>
    round2(content.lineItems.filter((l) => l.kind === kind && l.unitPrice != null).reduce((s, l) => s + l.quantity * (l.unitPrice ?? 0), 0));
  const oneTimeSubtotal = sum('one_time');
  const monthlySubtotal = sum('monthly');
  const annualSubtotal = sum('annual');
  const optionalSubtotal = sum('optional');
  const taxLines = content.taxes.map((t) => ({
    label: t.label,
    ratePercent: t.ratePercent,
    oneTime: round2((oneTimeSubtotal * t.ratePercent) / 100),
    monthly: round2((monthlySubtotal * t.ratePercent) / 100),
    annual: round2((annualSubtotal * t.ratePercent) / 100),
  }));
  const taxSum = (key: 'oneTime' | 'monthly' | 'annual') => taxLines.reduce((s, t) => s + t[key], 0);
  return {
    oneTimeSubtotal,
    monthlySubtotal,
    annualSubtotal,
    optionalSubtotal,
    taxLines,
    oneTimeTotal: round2(oneTimeSubtotal + taxSum('oneTime')),
    monthlyTotal: round2(monthlySubtotal + taxSum('monthly')),
    annualTotal: round2(annualSubtotal + taxSum('annual')),
    unpricedRequired: content.lineItems.filter((l) => l.kind !== 'optional' && l.unitPrice == null).length,
    unpricedOptional: content.lineItems.filter((l) => l.kind === 'optional' && l.unitPrice == null).length,
  };
}

/** True once the validity date has passed (dates are ISO yyyy-mm-dd, compared as strings). */
export function isExpired(content: Pick<ProposalContent, 'validUntil'>, today: string) {
  return Boolean(content.validUntil && content.validUntil < today);
}

/** Problems that must be fixed before a proposal can be approved. Pass `today` to check expiry. */
export function approvalIssues(content: ProposalContent, today?: string): string[] {
  const issues: string[] = [];
  if (content.validUntil && content.validUntil < content.preparedOn) issues.push('The validity date is before the proposal date.');
  else if (today && isExpired(content, today)) issues.push('The validity date has passed; set a new “Valid until” date.');
  const totals = computeTotals(content);
  if (!content.preparedBy.trim()) issues.push('Add your agency name (Prepared by).');
  if (!content.lineItems.length) issues.push('Add at least one quotation line item.');
  if (totals.unpricedRequired) issues.push(`Price ${totals.unpricedRequired} required line item(s) or mark them optional.`);
  if (content.lineItems.some((l) => !l.description.trim())) issues.push('Every line item needs a description.');
  if (!content.deliverables.filter((d) => d.trim()).length) issues.push('List at least one deliverable.');
  const pct = content.milestones.reduce((s, m) => s + m.percent, 0);
  if (content.milestones.length && Math.abs(pct - 100) > 0.01) issues.push(`Payment milestones add up to ${pct}% — they must total 100%.`);
  if (!content.milestones.length) issues.push('Add payment milestones.');
  return issues;
}

export const PROPOSAL_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  draft: ['approved', 'withdrawn'],
  approved: ['draft', 'sent', 'withdrawn'],
  sent: ['accepted', 'declined', 'draft', 'withdrawn'],
  accepted: [],
  declined: ['draft'],
  withdrawn: ['draft'],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus) {
  return PROPOSAL_TRANSITIONS[from].includes(to);
}

export function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const BILLING_SUFFIX: Record<string, string> = { monthly: ' per month', annual: ' per year', one_time: ' one-time', optional: ' (optional)' };
const CLAIM = (k: string) => k === 'verified_fact' || k === 'evidence_supported';
/** Limitations that are internal research notes rather than questions for the client. */
const INTERNAL_LIMITATION = /statement was removed|unsupported|confidence|contact detail|consent|permission|marketing|opted|suppress/i;

/**
 * Research records restated in reports (verification logs, recorded profile fields, scores, notes,
 * contact and permission lines). They are internal and never go into the client document.
 */
const INTERNAL_EVIDENCE =
  /^(automated )?website verification on|^social profile recorded|^website recorded on the profile|^business (category|identity|-level)|^location recorded|^operating status|^rule-based opportunity score|^operational needs recorded|^expressed interest|^budget signal|^researcher notes|^(email|whatsapp|phone|sms):|^digital audit — (?!verified issue)/i;
const VERIFIED_ISSUE = /^Digital audit — verified issue \([^)]*\): (.+?)\. Observed:/i;

/** Client wording for a cited report finding, or null when it is an internal research record. */
function clientFinding(text: string) {
  const issue = VERIFIED_ISSUE.exec(text);
  if (issue) return `Verified issue: ${issue[1]}.`;
  if (INTERNAL_EVIDENCE.test(text)) return null;
  return text.replace(/^Automated check of /, 'Our automated check of ');
}

/** Evidence-based problem statement: the report summary plus its cited website and presence findings. */
function problemStatement(report: ReportContent) {
  const summary = reportSummary(report);
  const findings = [...report.websiteFindings.statements, ...report.digitalPresence.statements]
    .filter((st) => CLAIM(st.kind) && !summary.includes(st.text))
    .map((st) => clientFinding(st.text))
    .filter((f): f is string => Boolean(f))
    .slice(0, 5);
  return [summary, ...(findings.length ? ['', 'What our research found:', ...findings.map((f) => `• ${f}`)] : [])].join('\n').trim().slice(0, 6000);
}

export function proposalFromPackage(input: {
  pkg: ServicePackage;
  businessName: string;
  settings: OrgSettings;
  report?: ReportContent | null;
  today?: string;
  /** Template plan (phase 6). Without it the draft is the package as configured. */
  plan?: ProposalPlan | null;
  provenance?: { source: ProposalBasis['source']; generator: string; reportId: string | null; reportVersion: number | null; preparedAt: string };
}): ProposalContent {
  const { pkg, businessName, settings, report, plan } = input;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const included = plan?.addOns.filter((a) => a.included) ?? [];
  const offered = plan?.addOns.filter((a) => !a.included) ?? [];
  const bullets = (items: string[]) => items.map((i) => `• ${i}`);

  const lineItems: ProposalLineItem[] = [
    ...pkg.lineItems.map((l) => ({ id: newId(), kind: l.kind, category: l.category, description: l.description, quantity: l.quantity, unitPrice: l.defaultUnitPrice })),
    ...included.map(({ addOn }) => ({ id: newId(), kind: addOn.kind, category: addOn.category, description: addOn.name, quantity: 1, unitPrice: addOn.unitPrice })),
    ...offered.map(({ addOn }) => ({ id: newId(), kind: 'optional' as const, category: addOn.category, description: addOn.name, quantity: 1, unitPrice: addOn.unitPrice })),
  ];
  const ongoing = lineItems.filter((l) => l.kind !== 'optional' && ['hosting', 'domain', 'maintenance'].includes(l.category));
  const phasesTimed = pkg.phases.length > 0 && pkg.phases.every((p) => p.duration.trim());

  const recommendedSolution = plan
    ? [
        `We recommend the ${pkg.name}. ${pkg.summary}`,
        '',
        'Why this fits:',
        ...bullets(plan.clientRationale),
        ...(included.length ? ['', `Included for ${businessName}:`, ...bullets(included.map((a) => `${a.addOn.name} — ${a.addOn.description}`))] : []),
        ...(plan.covered.length ? ['', `Already part of the package: ${plan.covered.join(', ')}.`] : []),
        ...(offered.length ? ['', 'Optional additions (listed in the quotation, not in the totals):', ...bullets(offered.map((a) => `${a.addOn.name} — ${a.addOn.description}`))] : []),
        ...(plan.roadmap.length ? ['', 'For a later phase (not quoted here):', ...bullets(plan.roadmap)] : []),
      ]
        .join('\n')
        .slice(0, 6000)
    : pkg.summary;

  const limitations = (report?.limitations ?? []).map((l) => l.item).filter((item) => !INTERNAL_LIMITATION.test(item)).slice(0, 3);
  // Lists are clipped to the content schema's limits (60 items of 500 characters).
  const unique = (items: string[]) => [...new Set(items.map((i) => i.trim().slice(0, 500)).filter(Boolean))].slice(0, 60);

  return {
    preparedFor: businessName,
    preparedBy: settings.agency.name,
    preparedOn: today,
    validUntil: addDays(today, settings.proposalValidityDays),
    executiveSummary: plan
      ? `This proposal sets out a ${pkg.name.toLowerCase()} for ${businessName}. ${pkg.summary} ${plan.clientRationale[0] ?? ''} Scope, pricing and timeline are confirmed with you before any work begins.`.replace(/\s+/g, ' ').trim()
      : `This proposal outlines a ${pkg.name.toLowerCase()} for ${businessName}. ${pkg.summary} Scope, pricing and timeline are confirmed with you before work begins.`,
    currentSituation: report ? problemStatement(report) : 'To be completed after a discovery conversation with the business.',
    opportunities: report?.opportunities.map((o) => `${o.title}: ${o.description}`) ?? [],
    recommendedSolution,
    deliverables: unique([...pkg.features, ...included.map((a) => a.addOn.name)]),
    exclusions: unique([...pkg.exclusions, ...(plan?.template.exclusions ?? []), ...(offered.length ? ['Optional additions unless you accept them in writing'] : [])]),
    phases: pkg.phases.map((p) => ({ ...p })),
    timeline: phasesTimed
      ? `Indicative timeline: ${pkg.phases.map((p) => `${p.name} — ${p.duration}`).join('; ')}. Dates are confirmed after discovery and depend on timely content and approvals.`
      : 'The delivery timeline will be confirmed after discovery and depends on timely content and approvals.',
    lineItems,
    taxes: settings.defaultTaxes.map((t) => ({ id: newId(), ...t })),
    milestones: [
      { id: newId(), label: 'Deposit', percent: 50, trigger: 'On signing the agreement' },
      { id: newId(), label: 'Final payment', percent: 50, trigger: 'On launch approval' },
    ],
    maintenanceTerms: [
      'Optional maintenance covers security updates, backups and minor content changes as listed in the quotation.',
      ...(ongoing.length ? ['', 'Hosting and support:', ...bullets(ongoing.map((l) => `${l.description}: ${l.unitPrice == null ? 'to be quoted' : `${formatMoney(l.quantity * l.unitPrice)}${BILLING_SUFFIX[l.kind]}`}`))] : []),
    ]
      .join('\n')
      .slice(0, 4000),
    clientResponsibilities: [
      'Provide brand assets, product or service information and approvals on time',
      'Nominate one decision-maker for feedback and sign-off',
      'Hold accounts (domain, hosting, payment providers) in the business’s name',
    ],
    assumptions: unique([
      'Prices are in Ghana cedis (GH₵) unless stated otherwise.',
      'Third-party fees (payment processing, app stores, subscriptions) are billed by those providers.',
      'Payment integrations depend on merchant approval by the provider.',
      ...(plan ? plan.assumptions : []),
      ...(report ? ['This proposal is based on our research so far; we confirm the details with you in discovery.'] : []),
      ...limitations.map((l) => `To confirm in discovery: ${l.replace(/\.$/, '')}.`),
      ...(plan?.unmatchedNeeds.length ? [`Further needs to scope in discovery: ${plan.unmatchedNeeds.join('; ')}.`] : []),
    ]),
    nextSteps: ['Review this proposal', 'Schedule a short call to confirm scope', 'Sign the agreement and pay the deposit to begin'],
    ...(plan && input.provenance
      ? {
          basis: {
            source: input.provenance.source,
            generator: input.provenance.generator,
            track: plan.track,
            template: plan.template.label,
            packageKey: pkg.key,
            recommendedPackageKey: plan.recommendedKey,
            reasons: plan.reasons.slice(0, 12),
            addOns: plan.addOns.slice(0, 30).map((a) => ({ key: a.addOn.key, name: a.addOn.name, included: a.included, priced: a.addOn.unitPrice != null, reason: a.reason })),
            roadmap: plan.roadmap.slice(0, 12),
            unmatchedNeeds: plan.unmatchedNeeds.slice(0, 20),
            missingAddOns: plan.missingAddOns.slice(0, 30),
            reportId: input.provenance.reportId,
            reportVersion: input.provenance.reportVersion,
            reportConfidence: report?.confidence.overall ?? null,
            preparedAt: input.provenance.preparedAt,
          },
        }
      : {}),
  };
}

export function formatMoney(amount: number | null | undefined, currency = 'GHS') {
  if (amount == null) return 'To be quoted';
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function proposalToMarkdown(title: string, status: ProposalStatus, content: ProposalContent, currency = 'GHS') {
  const t = computeTotals(content);
  const money = (n: number | null) => formatMoney(n, currency);
  const bullets = (items: string[]) => (items.length ? items.map((i) => `- ${i}`) : ['- None']);
  const lines = [
    `# ${title}`,
    '',
    status === 'draft' ? '> **DRAFT — not approved for sending**' : '',
    '',
    `**Prepared for:** ${content.preparedFor}  `,
    `**Prepared by:** ${content.preparedBy || '[Agency name]'}  `,
    `**Date:** ${content.preparedOn}${content.validUntil ? ` · **Valid until:** ${content.validUntil}` : ''}`,
    '',
    '## 1. Executive summary',
    content.executiveSummary,
    '## 2. Current situation',
    content.currentSituation,
    '## 3. Identified opportunities',
    ...bullets(content.opportunities),
    '## 4. Recommended solution',
    content.recommendedSolution,
    '## 5. Deliverables',
    ...bullets(content.deliverables),
    '## 6. Scope exclusions',
    ...bullets(content.exclusions),
    '## 7. Project phases',
    ...content.phases.map((p) => `- **${p.name}**${p.duration ? ` (${p.duration})` : ''} — ${p.description}`),
    '## 8. Timeline',
    content.timeline,
    '## 9. Quotation',
    '| Item | Type | Qty | Unit price | Amount |',
    '| --- | --- | ---: | ---: | ---: |',
    ...content.lineItems.map(
      (l) =>
        `| ${l.description} | ${LINE_ITEM_KIND_LABELS[l.kind]} | ${l.quantity} | ${money(l.unitPrice)} | ${l.unitPrice == null ? 'To be quoted' : money(l.quantity * l.unitPrice)} |`,
    ),
    '',
    `- One-time subtotal: ${money(t.oneTimeSubtotal)}`,
    ...t.taxLines.map((x) => `- ${x.label} (${x.ratePercent}%) on one-time: ${money(x.oneTime)}`),
    `- **One-time total: ${money(t.oneTimeTotal)}**`,
    t.monthlySubtotal ? `- Monthly: ${money(t.monthlyTotal)} per month` : '',
    t.annualSubtotal ? `- Annual: ${money(t.annualTotal)} per year` : '',
    t.optionalSubtotal ? `- Optional items: ${money(t.optionalSubtotal)} (not included in totals)` : '',
    '## 10. Payment milestones',
    ...content.milestones.map((m) => `- ${m.label} — ${m.percent}% ${m.trigger ? `(${m.trigger})` : ''}`),
    '## 11. Maintenance terms',
    content.maintenanceTerms,
    '## 12. Client responsibilities',
    ...bullets(content.clientResponsibilities),
    '## 13. Assumptions',
    ...bullets(content.assumptions),
    '## 14. Next steps',
    ...bullets(content.nextSteps),
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}
