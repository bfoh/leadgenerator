// Phase 3 research operations: agent website verifications and their review, business identity
// (duplicate decisions, branches, merges), digital audit findings, and score overrides. Like
// services.ts, both modes go through here so demo and cloud apply the same rules.

import { MERGEABLE_LABELS, IDENTITY_RELATION_LABELS, type IdentityAssessment, type MergeableField } from '@/lib/domain/identity';
import type { FindingDraft } from '@/lib/domain/audit';
import { latestVerification, scoreFields } from '@/lib/domain/rescore';
import { CLASSIFICATION_META, type Assessment } from '@/lib/domain/website-assessment';
import type { AuditFinding, Business, FindingReviewStatus, IdentityLink, WebsiteVerification } from '@/lib/domain/types';
import { applyLatestVerification, log, type ServiceContext } from './services';
import { RESEARCH_MIGRATION_REQUIRED, StoreError } from './store';

const now = () => new Date().toISOString();

async function requireResearchSchema(ctx: ServiceContext) {
  if (!(await ctx.store.researchSchemaAvailable())) throw new StoreError(RESEARCH_MIGRATION_REQUIRED, 'unavailable');
}

// ── Agent verification and review ───────────────────────────────────────────

export interface AgentProvenance {
  agentName: string;
  agentVersion: string;
  jobId: string | null;
}

/**
 * Stores an agent's verification. A result that needs review is recorded as pending: it does not
 * replace a person's conclusion until someone confirms it (see latestVerification).
 */
export async function recordAgentVerification(ctx: ServiceContext, business: Business, assessment: Assessment, by: AgentProvenance) {
  await requireResearchSchema(ctx);
  const e = assessment.evidence;
  const verification = await ctx.store.createVerification({
    businessId: business.id,
    status: assessment.status,
    checkedAt: e.finishedAt,
    methods: assessment.methods,
    domain: assessment.domain,
    sourceUrl: assessment.sourceUrl,
    evidenceSummary: assessment.summary,
    confidence: assessment.confidence,
    websiteOutdated: assessment.websiteOutdated,
    technical: assessment.technical,
    // Agents are not users: no reviewer id, the agent's name instead.
    reviewerId: null,
    reviewerName: by.agentName,
    nextCheckAt: assessment.nextCheckAt,
    actorType: 'agent',
    classification: e.classification,
    confidenceScore: e.confidenceScore,
    evidence: e as unknown as Record<string, unknown>,
    agentVersion: by.agentVersion,
    jobId: by.jobId,
    reviewStatus: e.reviewRequired ? 'pending' : 'not_required',
  });
  const updated = await applyLatestVerification(ctx, business);
  const review = e.reviewRequired ? ' — needs review' : '';
  await log(ctx, business.id, 'verification', `Agent verification: ${CLASSIFICATION_META[e.classification].label} (evidence confidence ${e.confidenceScore}/100)${review}`, {
    verificationId: verification.id,
    agentVersion: by.agentVersion,
    jobId: by.jobId,
  });
  return { business: updated, verification };
}

export type ReviewDecision = 'confirmed' | 'rejected';

/** A person confirms or rejects an agent's verification. Rejected results never count. */
export async function reviewVerification(ctx: ServiceContext, business: Business, verification: WebsiteVerification, decision: ReviewDecision, note: string) {
  if (verification.actorType !== 'agent') throw new StoreError('Only agent results are reviewed. Edit or add a manual verification instead.', 'invalid');
  const text = note.trim();
  if (decision === 'rejected' && text.length < 5) throw new StoreError('Say briefly why the result is wrong (at least 5 characters).', 'invalid');
  if (text.length > 1000) throw new StoreError('Keep the review note under 1,000 characters.', 'invalid');
  const updated = await ctx.store.updateVerification(verification.id, { reviewStatus: decision, reviewNote: text || null });
  const b = await applyLatestVerification(ctx, business);
  // A rejected result may have been the only one; fall back to the business's pre-agent state.
  const effective = latestVerification(await ctx.store.listVerifications(business.id));
  const after = effective ? b : await ctx.store.updateBusiness(business.id, { websiteStatus: 'unverified', ...scoreFields({ ...b, websiteStatus: 'unverified' }, [], ctx.settings) });
  await log(ctx, business.id, 'verification', `Agent verification from ${verification.checkedAt.slice(0, 10)} ${decision} by ${ctx.userLabel}${text ? `: ${text}` : ''}`, {
    verificationId: verification.id,
  });
  return { business: after, verification: updated };
}

// ── Identity ─────────────────────────────────────────────────────────────────

/** Records the identity check on the business and opens suggested links for strong matches. Never merges. */
export async function recordIdentityCheck(ctx: ServiceContext, business: Business, assessment: IdentityAssessment, agentVersion: string) {
  await requireResearchSchema(ctx);
  const links = await ctx.store.listIdentityLinks(business.id);
  const opened: IdentityLink[] = [];
  for (const s of assessment.suggestions) {
    if (s.strength === 'possible') continue;
    const known = links.some((l) => [l.businessId, l.otherBusinessId].includes(s.other.id));
    if (known) continue;
    try {
      opened.push(
        await ctx.store.createIdentityLink({
          businessId: business.id,
          otherBusinessId: s.other.id,
          relation: 'possible_duplicate',
          status: 'suggested',
          strength: s.strength,
          reasons: s.reasons.slice(0, 10),
          suggestedBy: 'agent',
          agentVersion,
          decidedBy: null,
          decidedAt: null,
          note: null,
          mergeSnapshot: null,
        }),
      );
    } catch (error) {
      // Another run opened the same pair first.
      if (!(error instanceof StoreError && error.code === 'conflict')) throw error;
    }
  }
  const updated = await ctx.store.updateBusiness(business.id, { identityConfidence: assessment.confidence, identityCheckedAt: now() });
  return { business: updated, opened };
}

export type IdentityDecision = 'branch' | 'distinct' | 'dismissed';

/**
 * A person decides what two prospects are. "branch" records `business` as a branch of `other`;
 * "distinct" records two different businesses; "dismissed" closes a suggestion without a verdict.
 * Merging is a separate, owner/administrator-only operation (mergeProspects).
 */
export async function decideIdentity(ctx: ServiceContext, business: Business, other: Business, decision: IdentityDecision, note = '') {
  await requireResearchSchema(ctx);
  if (business.id === other.id) throw new StoreError('Choose two different prospects.', 'invalid');
  const text = note.trim().slice(0, 1000) || null;
  const links = await ctx.store.listIdentityLinks(business.id);
  const existing = links.find((l) => [l.businessId, l.otherBusinessId].includes(other.id)) ?? null;
  if (existing?.relation === 'same_business' && business.mergedIntoId) throw new StoreError('Undo the merge first.', 'invalid');
  const relation = decision === 'branch' ? 'branch' : decision === 'distinct' ? 'distinct' : existing?.relation === 'same_business' ? 'distinct' : (existing?.relation ?? 'possible_duplicate');
  const status = decision === 'dismissed' ? 'dismissed' : 'confirmed';
  const link = existing
    ? await ctx.store.updateIdentityLink(existing.id, { relation, status, note: text })
    : await ctx.store.createIdentityLink({
        businessId: business.id,
        otherBusinessId: other.id,
        relation,
        status,
        strength: 'possible',
        reasons: ['Recorded by a person'],
        suggestedBy: 'user',
        agentVersion: null,
        decidedBy: null,
        decidedAt: null,
        note: text,
        mergeSnapshot: null,
      });
  let updated = business;
  if (decision === 'branch' && business.parentBusinessId !== other.id) {
    updated = await ctx.store.updateBusiness(business.id, { parentBusinessId: other.id });
  } else if (decision !== 'branch') {
    // A branch link that is now something else no longer makes either record the other's parent.
    if (business.parentBusinessId === other.id) updated = await ctx.store.updateBusiness(business.id, { parentBusinessId: null });
    if (other.parentBusinessId === business.id) await ctx.store.updateBusiness(other.id, { parentBusinessId: null });
  }
  const what = decision === 'dismissed' ? 'Duplicate suggestion dismissed' : decision === 'branch' ? `Recorded as a branch of ${other.name}` : `Recorded as a different business from ${other.name}`;
  await log(ctx, business.id, 'system', what + (text ? `: ${text}` : ''), { identityLinkId: link.id, otherBusinessId: other.id });
  return { business: updated, link };
}

/** Merges `secondary` into `primary`: nothing is deleted, the secondary is archived and can be restored. */
export async function mergeProspects(ctx: ServiceContext, primary: Business, secondary: Business, fields: MergeableField[], note = '') {
  await requireResearchSchema(ctx);
  const text = note.trim().slice(0, 1000) || null;
  const { primary: a, secondary: b } = await ctx.store.mergeBusinesses(primary.id, secondary.id, fields, text);
  const copied = fields.filter((f) => !primary[f] && secondary[f]).map((f) => MERGEABLE_LABELS[f].toLowerCase());
  const permission = a.contactPermission !== primary.contactPermission ? ` Contact permission is now "${a.contactPermission.replace(/_/g, ' ')}" (carried over from the merged record).` : '';
  await log(ctx, a.id, 'system', `Merged duplicate "${secondary.name}" into this prospect${copied.length ? `; copied ${copied.join(', ')}` : ''}.${permission}`, {
    mergedBusinessId: b.id,
  });
  await log(ctx, b.id, 'system', `Merged into "${primary.name}" by ${ctx.userLabel} and archived. Undo the merge to restore it.`, { primaryBusinessId: a.id });
  return { primary: await rescoreQuietly(ctx, a), secondary: b };
}

export async function undoProspectMerge(ctx: ServiceContext, secondary: Business, primary: Business | null) {
  await requireResearchSchema(ctx);
  const restored = await ctx.store.undoMerge(secondary.id);
  await log(ctx, restored.id, 'system', `Merge undone by ${ctx.userLabel}; restored as a separate prospect.`, { primaryBusinessId: secondary.mergedIntoId });
  if (primary) {
    await log(ctx, primary.id, 'system', `Merge with "${secondary.name}" undone. Copied details were removed unless edited since; any opt-out carried over stays until a person reviews it.`, {
      restoredBusinessId: restored.id,
    });
    const fresh = await ctx.store.getBusiness(primary.id);
    if (fresh) await rescoreQuietly(ctx, fresh);
  }
  return restored;
}

async function rescoreQuietly(ctx: ServiceContext, business: Business) {
  return ctx.store.updateBusiness(business.id, scoreFields(business, await ctx.store.listVerifications(business.id), ctx.settings));
}

export function identityRelationLabel(link: IdentityLink) {
  return link.status === 'dismissed' ? 'Suggestion dismissed' : IDENTITY_RELATION_LABELS[link.relation];
}

// ── Digital audit ────────────────────────────────────────────────────────────

/**
 * Saves a new audit run. Unreviewed findings from earlier runs are superseded (kept as history);
 * a finding a person already accepted or dismissed on the same or newer evidence is not raised again.
 */
export async function saveAuditFindings(ctx: ServiceContext, business: Business, drafts: FindingDraft[], source: { verification: WebsiteVerification | null; jobId: string | null; agentVersion: string }) {
  await requireResearchSchema(ctx);
  const existing = await ctx.store.listAuditFindings(business.id);
  const basis = source.verification?.checkedAt ?? '';
  const decided = (key: string) =>
    existing.some(
      (f) => f.findingKey === key && (f.reviewStatus === 'accepted' || f.reviewStatus === 'dismissed') && (f.verificationId === source.verification?.id || (f.reviewedAt ?? '') >= basis),
    );
  const superseded: AuditFinding[] = [];
  for (const f of existing.filter((x) => x.reviewStatus === 'unreviewed')) {
    superseded.push(await ctx.store.updateAuditFinding(f.id, { reviewStatus: 'superseded' }));
  }
  const fresh = drafts.filter((d) => !decided(d.findingKey));
  const created = await ctx.store.createAuditFindings(
    fresh.map((d) => ({ ...d, businessId: business.id, reviewStatus: 'unreviewed', verificationId: source.verification?.id ?? null, jobId: source.jobId, agentVersion: source.agentVersion })),
  );
  const issues = created.filter((f) => f.kind === 'verified_issue').length;
  await log(ctx, business.id, 'system', `Digital audit: ${issues} evidence-backed issue${issues === 1 ? '' : 's'} and ${created.length - issues} growth hypothes${created.length - issues === 1 ? 'is' : 'es'} recorded`, {
    verificationId: source.verification?.id ?? null,
    jobId: source.jobId,
  });
  return { created, superseded, kept: drafts.length - fresh.length };
}

export async function reviewFinding(ctx: ServiceContext, finding: AuditFinding, status: Exclude<FindingReviewStatus, 'superseded'>, note = '') {
  if (finding.reviewStatus === 'superseded') throw new StoreError('This finding was replaced by a newer audit. Review the current one instead.', 'invalid');
  const text = note.trim();
  if (status === 'dismissed' && text.length < 5) throw new StoreError('Say briefly why the finding does not apply (at least 5 characters).', 'invalid');
  const updated = await ctx.store.updateAuditFinding(finding.id, { reviewStatus: status, reviewNote: text.slice(0, 1000) || null });
  const verb = status === 'accepted' ? 'accepted' : status === 'dismissed' ? 'dismissed' : 'reopened';
  await log(ctx, finding.businessId, 'system', `Audit finding "${finding.title}" ${verb} by ${ctx.userLabel}${text ? `: ${text}` : ''}`, { findingId: finding.id });
  return updated;
}

// ── Score override ───────────────────────────────────────────────────────────

export const OVERRIDE_JUSTIFICATION_MIN = 20;

/** A person sets the opportunity score. The computed score stays visible and every change is audited. */
export async function setScoreOverride(ctx: ServiceContext, business: Business, opportunity: number, justification: string) {
  await requireResearchSchema(ctx);
  const value = Math.round(opportunity);
  if (!Number.isFinite(opportunity) || value < 0 || value > 100) throw new StoreError('The score must be between 0 and 100.', 'invalid');
  const text = justification.trim();
  if (text.length < OVERRIDE_JUSTIFICATION_MIN) throw new StoreError(`Explain the override in at least ${OVERRIDE_JUSTIFICATION_MIN} characters.`, 'invalid');
  if (text.length > 1000) throw new StoreError('Keep the justification under 1,000 characters.', 'invalid');
  const scoreOverride = { opportunity: value, justification: text, by: ctx.userId, byName: ctx.userLabel, at: now() };
  const next = { ...business, scoreOverride };
  const updated = await ctx.store.updateBusiness(business.id, { scoreOverride, ...scoreFields(next, await ctx.store.listVerifications(business.id), ctx.settings) });
  const computed = updated.scoreBreakdown?.opportunity ?? null;
  await log(ctx, business.id, 'system', `Opportunity score overridden to ${value}${computed === null ? '' : ` (computed ${computed})`} by ${ctx.userLabel}: ${text}`);
  return updated;
}

export async function clearScoreOverride(ctx: ServiceContext, business: Business) {
  if (!business.scoreOverride) return business;
  const next = { ...business, scoreOverride: null };
  const updated = await ctx.store.updateBusiness(business.id, { scoreOverride: null, ...scoreFields(next, await ctx.store.listVerifications(business.id), ctx.settings) });
  await log(ctx, business.id, 'system', `Score override removed by ${ctx.userLabel}; the computed score (${updated.opportunityScore ?? '—'}) applies again.`);
  return updated;
}
