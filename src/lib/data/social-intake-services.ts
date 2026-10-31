// Bulk intake and social research services. Discovery results stay in memory; this module is the only
// place that turns one into a prospect, and it does so only with a stated retention basis. No search
// title, snippet, ranking or platform content is passed to the store.

import {
  assessSocialIntake,
  intakeBusinessName,
  intakeNotes,
  socialSourceForIntake,
  summarizeIntake,
  SOCIAL_INTAKE_LIMIT,
  type SocialIntakeAssessment,
  type SocialIntakeSummary,
} from '@/lib/domain/social-intake';
import { SOCIAL_DISCOVERY_LABELS, parseSocialProfileUrl, type SocialCandidate } from '@/lib/domain/social-discovery';
import {
  RESEARCH_CATEGORY_LABELS,
  SOCIAL_RETENTION_BASES,
  SOCIAL_SOURCE_PROVENANCE_LABELS,
  canAdvanceVerification,
  researchObservationInsertSchema,
  socialSourceInsertSchema,
  type BusinessSocialSource,
  type ResearchObservation,
  type ResearchObservationInsert,
  type SocialRetentionBasis,
  type SocialSourceInsert,
  type SocialVerificationStatus,
} from '@/lib/domain/social-research';
import type { BusinessForm } from '@/lib/domain/schemas';
import { createBusiness, log, type ServiceContext } from './services';
import { SOCIAL_RESEARCH_MIGRATION_REQUIRED, StoreError } from './store';

export interface BulkSocialIntakeInput {
  candidates: SocialCandidate[];
  /** Null is allowed: live candidates then come back as "needs permitted source". */
  basis: SocialRetentionBasis | null;
  /** Search context is recorded as a hint, never as a verified address. */
  category: string;
  country: string;
  region: string | null;
  city: string | null;
  neighborhood: string | null;
  /** Profile links a Google reference in the same batch already claims (cross-provider duplicates). */
  claimedProfileKeys?: Map<string, { businessId: string; name: string }> | null;
}

export interface SocialIntakeResult extends SocialIntakeAssessment {
  sourceId: string | null;
}

export interface BulkSocialIntakeResult {
  results: SocialIntakeResult[];
  summary: SocialIntakeSummary;
}

function intakeForm(candidate: SocialCandidate, input: BulkSocialIntakeInput, basis: SocialRetentionBasis, capturedBy: string): BusinessForm {
  const parsed = parseSocialProfileUrl(candidate.profileUrl);
  if (!parsed) throw new StoreError('Only a public profile URL can be captured.', 'invalid');
  return {
    name: intakeBusinessName(candidate),
    category: input.category || 'Other',
    country: input.country,
    region: input.region,
    districtCode: '',
    city: input.city ?? '',
    neighborhood: input.neighborhood,
    address: '',
    businessStatus: 'unknown',
    officialWebsite: '',
    socialProfiles: [{ platform: parsed.platform, url: parsed.profileUrl }],
    enquiryChannel: '',
    phone: '',
    email: '',
    contactSource: '',
    interestLevel: 'unknown',
    budgetSignal: 'unknown',
    serviceNeeds: [],
    estimatedValue: null,
    expectedCloseDate: null,
    nextAction: 'Verify the business from an independent source',
    nextActionDue: null,
    notes: intakeNotes(candidate, basis, capturedBy),
    sourceUrl: parsed.profileUrl,
    sourceKind: 'social_profile',
    placesPlaceId: '',
  };
}

/**
 * Processes up to 20 selected results in one action. Each result is independent: a failure is
 * reported beside that result and never rolls back another prospect. Retrying is safe because a
 * recorded profile is matched before anything is written.
 */
export async function bulkAddSocialCandidates(
  ctx: ServiceContext,
  input: BulkSocialIntakeInput,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkSocialIntakeResult> {
  if (!input.candidates.length) throw new StoreError('Select at least one profile to add.', 'invalid');
  if (input.candidates.length > SOCIAL_INTAKE_LIMIT) throw new StoreError(`Add at most ${SOCIAL_INTAKE_LIMIT} profiles at a time.`, 'invalid');
  if (input.basis !== null && !SOCIAL_RETENTION_BASES.includes(input.basis)) {
    throw new StoreError('Choose a lawful retention basis first; an ordinary search result is not one.', 'invalid');
  }
  if (!(await ctx.store.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');

  const [businesses, sources] = await Promise.all([ctx.store.listBusinesses(), ctx.store.listSocialSources()]);
  const workingBusinesses = [...businesses];
  const workingSources = [...sources];
  const results: SocialIntakeResult[] = [];

  for (const [index, candidate] of input.candidates.entries()) {
    const assessment = assessSocialIntake(candidate, {
      basis: input.basis,
      existingBusinesses: workingBusinesses,
      existingSources: workingSources,
      claimedProfileKeys: input.claimedProfileKeys ?? undefined,
    });
    let result: SocialIntakeResult = { ...assessment, sourceId: null };

    if (assessment.outcome === 'added' && assessment.basis) {
      let createdId: string | null = null;
      try {
        const business = await createBusiness(ctx, intakeForm(candidate, input, assessment.basis, ctx.userLabel));
        createdId = business.id;
        const source = await ctx.store.createSocialSource(
          socialSourceForIntake(candidate, assessment.basis, business.id, ctx.userLabel),
        );
        workingBusinesses.push(business);
        workingSources.push(source);
        await log(ctx, business.id, 'note', `Social profile linked: ${SOCIAL_DISCOVERY_LABELS[source.platform]} @${source.handle}`, {
          socialSourceId: source.id,
          provenance: source.provenance,
          retentionBasis: source.retentionBasis,
        });
        result = { ...assessment, businessId: business.id, businessName: business.name, sourceId: source.id };
      } catch (error) {
        if (createdId) await ctx.store.deleteBusiness(createdId).catch(() => undefined);
        result = {
          ...assessment,
          outcome: 'not_eligible',
          businessId: null,
          businessName: intakeBusinessName(candidate),
          sourceId: null,
          reason: `This candidate could not be saved: ${error instanceof Error ? error.message : 'unknown error'}`,
        };
      }
    }

    results.push(result);
    onProgress?.(index + 1, input.candidates.length);
  }

  return { results, summary: summarizeIntake(results) };
}

/** Links one profile a person already holds. The prospect's own profile list is kept in step. */
export async function addSocialSourceToBusiness(ctx: ServiceContext, input: SocialSourceInsert): Promise<BusinessSocialSource> {
  if (!(await ctx.store.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
  const parsed = socialSourceInsertSchema.parse(input);
  const business = await ctx.store.getBusiness(parsed.businessId);
  if (!business) throw new StoreError('Prospect not found', 'not_found');
  const existing = (await ctx.store.listSocialSources()).find(
    (s) =>
      !s.revokedAt &&
      s.platform === parsed.platform &&
      s.handle.replace(/^@/, '').toLowerCase() === parsed.handle,
  );
  if (existing) {
    throw new StoreError(
      existing.businessId === parsed.businessId
        ? 'This profile is already linked to the prospect.'
        : 'This profile is already linked to another prospect in this workspace.',
      'conflict',
    );
  }
  const saved = await ctx.store.createSocialSource(parsed);
  const alreadyListed = business.socialProfiles.some((profile) => {
    const match = parseSocialProfileUrl(profile.url);
    return match?.platform === parsed.platform && match.handle.replace(/^@/, '').toLowerCase() === parsed.handle;
  });
  if (!alreadyListed) {
    await ctx.store.updateBusiness(business.id, {
      socialProfiles: [...business.socialProfiles, { platform: parsed.platform, url: parsed.profileUrl }],
    });
  }
  await log(ctx, business.id, 'note', `Social source recorded: ${SOCIAL_DISCOVERY_LABELS[parsed.platform]} @${parsed.handle}`, {
    socialSourceId: saved.id,
    provenance: saved.provenance,
    retentionBasis: saved.retentionBasis,
  });
  return saved;
}

/** Records a forward-only verification step with its evidence. */
export async function confirmSocialSource(
  ctx: ServiceContext,
  source: BusinessSocialSource,
  status: SocialVerificationStatus,
  evidence: string,
): Promise<BusinessSocialSource> {
  if (!canAdvanceVerification(source.verificationStatus, status)) throw new StoreError('Verification status only moves forward.', 'invalid');
  if (evidence.trim().length < 15) throw new StoreError('Say who confirmed the profile, when and how.', 'invalid');
  const saved = await ctx.store.updateSocialSourceVerification(source.id, { verificationStatus: status, verificationEvidence: evidence.trim() });
  await log(ctx, source.businessId, 'note', `Social source marked ${status.replace(/_/g, ' ')}: ${SOCIAL_SOURCE_PROVENANCE_LABELS[source.provenance]}`, {
    socialSourceId: source.id,
    status,
  });
  return saved;
}

export async function recordResearchObservation(ctx: ServiceContext, input: ResearchObservationInsert): Promise<ResearchObservation> {
  if (!(await ctx.store.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
  const parsed = researchObservationInsertSchema.parse(input);
  const business = await ctx.store.getBusiness(parsed.businessId);
  if (!business) throw new StoreError('Prospect not found', 'not_found');
  const saved = await ctx.store.createResearchObservation(parsed);
  await log(ctx, parsed.businessId, 'note', `Research observation recorded: ${RESEARCH_CATEGORY_LABELS[parsed.category]}`, {
    researchObservationId: saved.id,
    sourceKind: saved.sourceKind,
    status: saved.status,
  });
  return saved;
}
