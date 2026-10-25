// Cross-entity operations. Every workflow step goes through here so demo and cloud mode apply the
// same rules: validation, permission-aware stage gating, scoring, and activity logging.

import type { z } from 'zod';
import seed from '@/data/research.json';
import {
  CLOSED_STAGES,
  CONTACT_ACTIVITIES,
  CONTACT_PERMISSION_META,
  PROJECT_STATUS_META,
  PROPOSAL_STATUS_META,
  STAGE_LABELS,
  WEBSITE_STATUS_META,
  type ActivityType,
  type ProjectType,
  type ProposalStatus,
  type Stage,
} from '@/lib/domain/constants';
import { acceptanceBlockers } from '@/lib/domain/conversion';
import { mapLegacyLead, type LegacyLead } from '@/lib/domain/legacy';
import { canEnterStage } from '@/lib/domain/pipeline';
import { approvalIssues, canTransition, computeTotals, isExpired, proposalContentSchema, proposalFromPackage, type ProposalBasis, type ProposalContent } from '@/lib/domain/proposal';
import { TEMPLATE_VERSION, planProposal } from '@/lib/domain/proposal-templates';
import { latestVerification, scoreFields } from '@/lib/domain/rescore';
import type { EvidencePack } from '@/lib/domain/evidence';
import type { ReportContent, ReportValidation } from '@/lib/domain/report';
import { businessDefaults } from '@/lib/domain/records';
import { businessFormSchema, permissionFormSchema, projectFormSchema, verificationFormSchema, type BusinessForm, type PermissionForm, type ProjectForm, type VerificationForm } from '@/lib/domain/schemas';
import { orgSettingsSchema, type OrgSettings } from '@/lib/domain/settings';
import type { ServicePackage } from '@/lib/domain/packages';
import type { Business, BusinessInsert, OpportunityReport, Project, Proposal, ReportGenerator, ReportUsage, TechnicalCheck, WebsiteVerification } from '@/lib/domain/types';
import type { AssetStorage } from './asset-storage';
import { StoreError, type DataStore } from './store';

export interface ServiceContext {
  store: DataStore;
  settings: OrgSettings;
  userId: string;
  userLabel: string;
  /**
   * Where Studio asset bytes live: the private bucket in cloud mode, the browser in demo mode.
   * Optional because most services never touch a file; the asset services refuse to run without it.
   */
  assets?: AssetStorage;
}

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

/** Shared with research-services.ts. */
export async function log(ctx: ServiceContext, businessId: string, type: ActivityType, summary: string, details: Record<string, unknown> | null = null) {
  return ctx.store.createActivity({ businessId, type, summary: summary.slice(0, 500), details, occurredAt: now(), scheduledFor: null, actorId: ctx.userId });
}

async function rescored(ctx: ServiceContext, business: Business | BusinessInsert, businessId?: string, verifications?: WebsiteVerification[]) {
  const list = verifications ?? (businessId ? await ctx.store.listVerifications(businessId) : []);
  return scoreFields(business, list, ctx.settings);
}

// ── Prospects ────────────────────────────────────────────────────────────────

export async function createBusiness(ctx: ServiceContext, form: BusinessForm, extra: Partial<BusinessInsert> = {}): Promise<Business> {
  const parsed = businessFormSchema.parse(form);
  // A region- or district-level record has no town; the store writes NULL (migration 010).
  const draft = businessDefaults({ ...parsed, ...extra, city: parsed.city ?? '', ownerId: ctx.userId });
  const created = await ctx.store.createBusiness({ ...draft, ...(await rescored(ctx, draft)) });
  await log(ctx, created.id, 'system', `Research candidate created (${created.sourceKind.replace(/_/g, ' ')})`);
  return created;
}

export async function updateBusinessProfile(ctx: ServiceContext, business: Business, form: BusinessForm): Promise<Business> {
  const parsed = businessFormSchema.parse(form);
  const changes = { ...parsed, city: parsed.city ?? '' };
  const next = { ...business, ...changes };
  return ctx.store.updateBusiness(business.id, { ...changes, ...(await rescored(ctx, next, business.id)) });
}

export async function rescoreBusiness(ctx: ServiceContext, business: Business) {
  return ctx.store.updateBusiness(business.id, await rescored(ctx, business, business.id));
}

export async function rescoreAll(ctx: ServiceContext) {
  const [businesses, verifications] = await Promise.all([ctx.store.listBusinesses(), ctx.store.listVerifications()]);
  for (const b of businesses) {
    await ctx.store.updateBusiness(b.id, scoreFields(b, verifications.filter((v) => v.businessId === b.id), ctx.settings));
  }
  return businesses.length;
}

export async function deleteBusiness(ctx: ServiceContext, business: Business) {
  await ctx.store.deleteBusiness(business.id);
}

// ── Verification ─────────────────────────────────────────────────────────────

function websiteFromDomain(domain: string | null) {
  if (!domain) return null;
  const d = domain.trim();
  return /^https?:\/\//i.test(d) ? d : `https://${d}`;
}

export async function recordVerification(ctx: ServiceContext, business: Business, form: VerificationForm, technical: TechnicalCheck | null = null) {
  const v = verificationFormSchema.parse(form);
  const verification = await ctx.store.createVerification({
    businessId: business.id,
    status: v.status,
    checkedAt: now(),
    methods: v.methods,
    domain: v.domain,
    sourceUrl: v.sourceUrl,
    evidenceSummary: v.evidenceSummary,
    confidence: v.confidence,
    websiteOutdated: v.websiteOutdated,
    technical,
    reviewerId: ctx.userId,
    reviewerName: ctx.userLabel,
    nextCheckAt: v.nextCheckAt,
  });
  const updated = await applyLatestVerification(ctx, business);
  await log(ctx, business.id, 'verification', `Website verification: ${WEBSITE_STATUS_META[v.status].label} (${v.confidence} confidence)`, {
    verificationId: verification.id,
  });
  return { business: updated, verification };
}

/** Corrections keep the original row and are recorded in the audit trail. */
export async function editVerification(ctx: ServiceContext, business: Business, verification: WebsiteVerification, form: VerificationForm) {
  const v = verificationFormSchema.parse(form);
  const updated = await ctx.store.updateVerification(verification.id, {
    status: v.status,
    methods: v.methods,
    domain: v.domain,
    sourceUrl: v.sourceUrl,
    evidenceSummary: v.evidenceSummary,
    confidence: v.confidence,
    websiteOutdated: v.websiteOutdated,
    nextCheckAt: v.nextCheckAt,
  });
  const b = await applyLatestVerification(ctx, business);
  await log(ctx, business.id, 'verification', `Verification from ${verification.checkedAt.slice(0, 10)} corrected`, { verificationId: verification.id });
  return { business: b, verification: updated };
}

/** Applies the verification in force (see latestVerification) to the business and rescores it. */
export async function applyLatestVerification(ctx: ServiceContext, business: Business) {
  const all = await ctx.store.listVerifications(business.id);
  const latest = latestVerification(all);
  if (!latest) return business;
  const patch: Partial<BusinessInsert> = { websiteStatus: latest.status, websiteOutdated: latest.websiteOutdated };
  if (latest.status === 'verified_official' && latest.domain) patch.officialWebsite = websiteFromDomain(latest.domain);
  return ctx.store.updateBusiness(business.id, { ...patch, ...scoreFields({ ...business, ...patch }, all, ctx.settings) });
}

// ── Pipeline and permission ─────────────────────────────────────────────────

export async function changeStage(ctx: ServiceContext, business: Business, stage: Stage, opts: { note?: string; lostReason?: string } = {}) {
  if (stage === business.stage) return business;
  const gate = canEnterStage(business, stage);
  if (!gate.ok) throw new StoreError(gate.reason, 'invalid');
  if (stage === 'lost' && !opts.lostReason?.trim()) throw new StoreError('Record why the opportunity was lost.', 'invalid');
  const updated = await ctx.store.updateBusiness(business.id, {
    stage,
    lostReason: stage === 'lost' ? opts.lostReason!.trim().slice(0, 500) : business.lostReason,
  });
  await log(ctx, business.id, 'stage_change', `${STAGE_LABELS[business.stage]} → ${STAGE_LABELS[stage]}${opts.note ? `: ${opts.note}` : ''}`, {
    from: business.stage,
    to: stage,
    lostReason: opts.lostReason ?? null,
  });
  return updated;
}

export async function bulkChangeStage(ctx: ServiceContext, businesses: Business[], stage: Stage) {
  const moved: Business[] = [];
  const skipped: { business: Business; reason: string }[] = [];
  for (const b of businesses) {
    const gate = canEnterStage(b, stage);
    if (!gate.ok) {
      skipped.push({ business: b, reason: gate.reason });
      continue;
    }
    moved.push(await changeStage(ctx, b, stage));
  }
  return { moved, skipped };
}

export async function recordPermission(ctx: ServiceContext, business: Business, form: PermissionForm) {
  const p = permissionFormSchema.parse(form);
  const at = now();
  const updated = await ctx.store.updateBusiness(business.id, {
    contactPermission: p.contactPermission,
    lawfulBasis: p.contactPermission === 'granted' ? p.lawfulBasis : p.lawfulBasis ?? null,
    permissionEvidence: p.permissionEvidence,
    permissionRecordedAt: at,
    optedOutAt: p.contactPermission === 'opted_out' ? at : null,
    nextAction: p.contactPermission === 'opted_out' ? 'Do not contact (opted out)' : business.nextAction,
    ...scoreFields({ ...business, contactPermission: p.contactPermission }, await ctx.store.listVerifications(business.id), ctx.settings),
  });
  await log(ctx, business.id, 'permission', `Contact permission: ${CONTACT_PERMISSION_META[p.contactPermission].label}`, {
    from: business.contactPermission,
    to: p.contactPermission,
    lawfulBasis: p.lawfulBasis,
  });
  return updated;
}

export async function logActivity(
  ctx: ServiceContext,
  business: Business,
  input: { type: ActivityType; summary: string; details?: string; occurredAt?: string; scheduledFor?: string | null },
) {
  if (CONTACT_ACTIVITIES.includes(input.type)) {
    if (business.contactPermission === 'opted_out') throw new StoreError('This business opted out. Contact activities cannot be logged.', 'invalid');
    if (business.contactPermission !== 'granted') {
      throw new StoreError(
        'Record contact permission first. If the business contacted you, record permission with the basis "Business contacted us first".',
        'invalid',
      );
    }
  }
  const activity = await ctx.store.createActivity({
    businessId: business.id,
    type: input.type,
    summary: input.summary.trim().slice(0, 500),
    details: input.details?.trim() ? { text: input.details.trim().slice(0, 5000) } : null,
    occurredAt: input.occurredAt ?? now(),
    scheduledFor: input.scheduledFor ?? null,
    actorId: ctx.userId,
  });
  if (CONTACT_ACTIVITIES.includes(input.type) && !input.scheduledFor) {
    await ctx.store.updateBusiness(business.id, { lastInteractionAt: activity.occurredAt });
  }
  return activity;
}

// ── Reports ──────────────────────────────────────────────────────────────────

export async function saveReport(
  ctx: ServiceContext,
  business: Business,
  input: { content: ReportContent; generator: ReportGenerator; model: string | null; pack: EvidencePack; validation: ReportValidation | null; usage: ReportUsage | null },
): Promise<OpportunityReport> {
  const report = await ctx.store.createReport({
    businessId: business.id,
    content: input.content,
    generator: input.generator,
    model: input.model,
    inputSnapshot: input.pack,
    validation: input.validation,
    usage: input.usage,
  });
  const how = input.generator === 'ai' ? 'AI-assisted' : input.generator === 'manual_edit' ? 'Edited' : 'Rule-based';
  await log(ctx, business.id, 'report', `${how} opportunity report v${report.version} saved`, { reportId: report.id });
  return report;
}

// ── Proposals ────────────────────────────────────────────────────────────────

const AUTO_ADVANCE_TO_DRAFT: Stage[] = ['qualified', 'introduction_requested', 'contact_authorized', 'discovery_meeting'];

/**
 * Drafts a proposal from a package, the sector template and the add-on price list. Prices come only
 * from settings; the plan's reasons are kept in content.basis for the team.
 */
export async function createProposal(
  ctx: ServiceContext,
  business: Business,
  pkg: ServicePackage,
  report: OpportunityReport | null,
  opts: { source?: ProposalBasis['source']; generator?: string } = {},
) {
  const plan = planProposal({ business, settings: ctx.settings, packageKey: pkg.key, report });
  const content = proposalFromPackage({
    pkg,
    businessName: business.name,
    settings: ctx.settings,
    report: report?.content,
    today: today(),
    plan,
    provenance: { source: opts.source ?? 'person', generator: opts.generator ?? TEMPLATE_VERSION, reportId: report?.id ?? null, reportVersion: report?.version ?? null, preparedAt: now() },
  });
  const totals = computeTotals(content);
  const proposal = await ctx.store.createProposal({
    businessId: business.id,
    reportId: report?.id ?? null,
    title: `${pkg.name} proposal — ${business.name}`.slice(0, 200),
    status: 'draft',
    packageKey: pkg.key,
    content,
    currency: 'GHS',
    oneTimeTotal: totals.oneTimeTotal,
    monthlyTotal: totals.monthlyTotal,
    approvedAt: null,
    approvedBy: null,
    sentAt: null,
    decidedAt: null,
  });
  const by = opts.source === 'agent' ? ' by the Proposal Generation agent' : '';
  await log(ctx, business.id, 'proposal', `Proposal drafted${by}: ${pkg.name}`, { proposalId: proposal.id, packageKey: pkg.key, recommendedPackageKey: plan?.recommendedKey ?? null });
  if (AUTO_ADVANCE_TO_DRAFT.includes(business.stage)) await changeStage(ctx, business, 'proposal_draft');
  return proposal;
}

export async function saveProposalContent(ctx: ServiceContext, proposal: Proposal, content: ProposalContent, title: string) {
  if (proposal.status !== 'draft') throw new StoreError('Only draft proposals can be edited. Revise it to create a new draft.', 'conflict');
  const parsed = proposalContentSchema.parse(content);
  const totals = computeTotals(parsed);
  return ctx.store.updateProposal(proposal.id, {
    title: title.trim().slice(0, 200) || proposal.title,
    content: parsed,
    oneTimeTotal: totals.oneTimeTotal,
    monthlyTotal: totals.monthlyTotal,
  });
}

const clipResponse = (text: string | undefined) => text?.trim().slice(0, 2000) || null;

export async function transitionProposal(ctx: ServiceContext, proposal: Proposal, business: Business, to: ProposalStatus, opts: { response?: string } = {}) {
  if (!canTransition(proposal.status, to)) {
    throw new StoreError(`A ${PROPOSAL_STATUS_META[proposal.status].label.toLowerCase()} proposal cannot move to ${PROPOSAL_STATUS_META[to].label.toLowerCase()}.`, 'invalid');
  }
  const at = now();
  const patch: Partial<Proposal> = { status: to };
  if (to === 'approved') {
    const issues = approvalIssues(proposal.content, today());
    if (issues.length) throw new StoreError(`Fix before approving: ${issues.join(' ')}`, 'invalid');
    patch.approvedAt = at;
    patch.approvedBy = ctx.userId;
  }
  if (to === 'sent') {
    if (business.contactPermission !== 'granted') {
      throw new StoreError('Record contact permission for this business before marking a proposal as sent.', 'invalid');
    }
    if (isExpired(proposal.content, today())) {
      throw new StoreError(`This proposal expired on ${proposal.content.validUntil}. Revise it, set a new validity date and approve it again before sending.`, 'invalid');
    }
    patch.sentAt = at;
  }
  if (to === 'accepted' || to === 'declined') patch.decidedAt = at;
  // Negotiated terms pass an owner or admin first (checked again by migration 008's guard).
  if (to === 'accepted' && (await ctx.store.conversionSchemaAvailable())) {
    const blockers = acceptanceBlockers(proposal, await ctx.store.listChangeRequests(business.id));
    if (blockers.length) throw new StoreError(blockers[0], 'invalid');
  }
  if (to === 'draft') {
    patch.approvedAt = null;
    patch.approvedBy = null;
  }
  const updated = await ctx.store.updateProposal(proposal.id, patch);
  const response = clipResponse(opts.response);
  await log(ctx, business.id, 'proposal', `Proposal ${PROPOSAL_STATUS_META[to].label.toLowerCase()}: ${proposal.title}`, { proposalId: proposal.id, status: to, ...(response ? { response } : {}) });

  if (to === 'sent' && !CLOSED_STAGES.includes(business.stage) && business.stage !== 'negotiation') {
    await changeStage(ctx, business, 'proposal_sent');
  }
  if (to === 'accepted') {
    const fresh = (await ctx.store.getBusiness(business.id)) ?? business;
    await ctx.store.updateBusiness(business.id, { estimatedValue: updated.oneTimeTotal ?? fresh.estimatedValue });
    if (fresh.stage !== 'won') await changeStage(ctx, fresh, 'won');
  }
  return updated;
}

/** A client's reply to an issued proposal (questions, requested changes), kept on the proposal's record. */
export async function recordProposalResponse(ctx: ServiceContext, proposal: Proposal, business: Business, text: string) {
  const response = clipResponse(text);
  if (!response) throw new StoreError('Write down what the client said.', 'invalid');
  if (!['sent', 'accepted', 'declined'].includes(proposal.status)) throw new StoreError('Client responses are recorded once a proposal has been sent.', 'invalid');
  await ctx.store.updateBusiness(business.id, { lastInteractionAt: now() });
  return log(ctx, business.id, 'proposal', `Client response recorded: ${proposal.title}`, { proposalId: proposal.id, status: proposal.status, response });
}

// ── Delivery ─────────────────────────────────────────────────────────────────

export async function convertToProject(ctx: ServiceContext, business: Business, proposal: Proposal): Promise<Project> {
  if (proposal.status !== 'accepted') throw new StoreError('Only accepted proposals can be converted into projects.', 'invalid');
  const existing = (await ctx.store.listProjects()).find((p) => p.proposalId === proposal.id);
  if (existing) return existing;
  const pkg = ctx.settings.packages.find((p) => p.key === proposal.packageKey);
  const project = await ctx.store.createProject({
    businessId: business.id,
    proposalId: proposal.id,
    name: `${business.name} — ${pkg?.name ?? 'Project'}`.slice(0, 200),
    projectType: pkg?.projectType ?? 'website',
    status: 'planning',
    contractValue: proposal.oneTimeTotal,
    currency: proposal.currency,
    startDate: today(),
    dueDate: null,
    deploymentUrl: null,
    maintenanceStatus: proposal.content.lineItems.some((l) => l.category === 'maintenance' && l.unitPrice != null) ? 'offered' : 'none',
    invoiceStatus: 'not_invoiced',
    deliverables: proposal.content.deliverables.filter((d) => d.trim()),
    notes: '',
  });
  let order = 0;
  for (const phase of proposal.content.phases) {
    await ctx.store.createMilestone({ projectId: project.id, title: phase.name, dueDate: null, completedAt: null, sortOrder: order++ });
  }
  await log(ctx, business.id, 'project', `Project created from accepted proposal: ${project.name}`, { projectId: project.id });
  if (business.stage !== 'won') {
    const fresh = (await ctx.store.getBusiness(business.id)) ?? business;
    if (fresh.stage !== 'won') await changeStage(ctx, fresh, 'won');
  }
  return project;
}

/** A project agreed outside the proposal builder, e.g. for an existing client. */
export async function createProject(ctx: ServiceContext, business: Business, name: string, projectType: ProjectType): Promise<Project> {
  const project = await ctx.store.createProject({
    businessId: business.id,
    proposalId: null,
    name: name.trim().slice(0, 200),
    projectType,
    status: 'planning',
    contractValue: null,
    currency: 'GHS',
    startDate: null,
    dueDate: null,
    deploymentUrl: null,
    maintenanceStatus: 'none',
    invoiceStatus: 'not_invoiced',
    deliverables: [],
    notes: '',
  });
  await log(ctx, business.id, 'project', `Project created: ${project.name}`, { projectId: project.id });
  return project;
}

export async function updateProjectDetails(ctx: ServiceContext, project: Project, form: ProjectForm, deliverables: string[]) {
  const parsed = projectFormSchema.parse(form);
  const updated = await ctx.store.updateProject(project.id, { ...parsed, deliverables: deliverables.map((d) => d.trim()).filter(Boolean) });
  if (parsed.status !== project.status) {
    await log(ctx, project.businessId, 'project', `${updated.name}: ${PROJECT_STATUS_META[project.status].label} → ${PROJECT_STATUS_META[parsed.status].label}`, { projectId: project.id });
  }
  return updated;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTING_LABELS: Record<string, string> = {
  agency: 'Agency profile',
  proposalValidityDays: 'Proposal validity (days)',
  scoringWeights: 'Scoring weight',
  focusCategories: 'Focus category',
  customCategories: 'Custom category',
  defaultTaxes: 'Tax',
  packages: 'Package',
  lineItems: 'line item',
  phases: 'phase',
  features: 'feature',
  exclusions: 'exclusion',
  ratePercent: 'rate (%)',
  defaultUnitPrice: 'unit price',
  label: 'label',
};

/** Turns a settings validation issue into "Package 2 → line item 1 → description is required". */
function describeIssue(issue: z.core.$ZodIssue) {
  const parts: string[] = [];
  const path = issue.path;
  for (let i = 0; i < path.length; i++) {
    const key = String(path[i]);
    const next = path[i + 1];
    const label = SETTING_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').toLowerCase();
    if (typeof next === 'number') {
      parts.push(`${label} ${next + 1}`);
      i++;
    } else parts.push(label);
  }
  const min = 'minimum' in issue ? Number(issue.minimum) : null;
  const max = 'maximum' in issue ? Number(issue.maximum) : null;
  const origin = 'origin' in issue ? issue.origin : null;
  const reason =
    issue.code === 'invalid_type'
      ? issue.expected === 'number'
        ? 'needs a number'
        : 'is missing'
      : issue.code === 'too_small'
        ? origin === 'string' && min === 1
          ? 'is required'
          : origin === 'string'
            ? `needs at least ${min} characters`
            : `must be at least ${min}`
        : issue.code === 'too_big'
          ? origin === 'string'
            ? `must be at most ${max} characters`
            : origin === 'array'
              ? `allows at most ${max} entries`
              : `must be at most ${max}`
          : issue.code === 'invalid_format'
            ? 'has an invalid format (use lowercase letters, numbers and dashes)'
            : 'is invalid';
  return `${parts.join(' → ') || 'Settings'} ${reason}.`;
}

/** Validates and saves organization settings; optionally rescores every prospect with them. */
export async function saveSettings(ctx: ServiceContext, next: OrgSettings, opts: { organizationName?: string; rescore?: boolean } = {}) {
  const parsed = orgSettingsSchema.safeParse(next);
  if (!parsed.success) {
    throw new StoreError(describeIssue(parsed.error.issues[0]), 'invalid');
  }
  if (Object.values(parsed.data.scoringWeights).every((w) => w === 0)) throw new StoreError('At least one scoring weight must be above zero.', 'invalid');
  const keys = parsed.data.packages.map((p) => p.key);
  if (new Set(keys).size !== keys.length) throw new StoreError('Each package needs a unique key.', 'invalid');
  const settings = await ctx.store.updateSettings(parsed.data, opts.organizationName);
  const rescored = opts.rescore ? await rescoreAll({ ...ctx, settings }) : 0;
  return { settings, rescored };
}

// ── Data management ──────────────────────────────────────────────────────────

/** Imports the 20 v1–v3 research records, skipping any already present. */
export async function importSeedResearch(ctx: ServiceContext) {
  const existing = new Set((await ctx.store.listBusinesses()).map((b) => b.legacyId).filter(Boolean));
  let imported = 0;
  for (const lead of seed as LegacyLead[]) {
    if (existing.has(lead.id)) continue;
    const { business, verifications } = mapLegacyLead(lead);
    const created = await ctx.store.createBusiness(business);
    const rows: WebsiteVerification[] = [];
    for (const v of verifications) rows.push(await ctx.store.createVerification({ ...v, businessId: created.id }));
    await ctx.store.updateBusiness(created.id, scoreFields(created, rows, ctx.settings));
    imported++;
  }
  return imported;
}
