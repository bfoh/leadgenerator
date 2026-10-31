// Bulk intake for Google Places results, and for a mixed batch of Places and social results. Discovery
// results stay in memory; only a Place ID (with the searched location and the workspace's own
// category) or a permitted social profile reaches the store.

import {
  PLACES_INTAKE_LIMIT,
  assessPlacesIntake,
  listedProfileKey,
  placesReferenceForm,
  summarizePlacesIntake,
  type PlacesCandidate,
  type PlacesIntakeAssessment,
  type PlacesIntakeSummary,
} from '@/lib/domain/places-intake';
import { type SocialCandidate } from '@/lib/domain/social-discovery';
import type { SocialRetentionBasis } from '@/lib/domain/social-research';
import { bulkAddSocialCandidates, type BulkSocialIntakeResult } from './social-intake-services';
import { createBusiness, log, type ServiceContext } from './services';
import { StoreError } from './store';

export interface PlacesIntakeInput {
  candidates: PlacesCandidate[];
  /** The workspace's own classification of the search — not Google's category. */
  category: string;
  country: string;
  region: string | null;
  city: string | null;
  neighborhood: string | null;
}

export type PlacesIntakeResult = PlacesIntakeAssessment;

export interface BulkPlacesIntakeResult {
  results: PlacesIntakeResult[];
  summary: PlacesIntakeSummary;
}

export interface BulkMixedIntakeInput extends PlacesIntakeInput {
  social: SocialCandidate[];
  basis: SocialRetentionBasis | null;
}

export interface MixedIntakeSummary extends PlacesIntakeSummary {
  not_eligible: number;
}

export interface BulkMixedIntakeResult {
  places: BulkPlacesIntakeResult;
  social: BulkSocialIntakeResult | null;
  summary: MixedIntakeSummary;
}

/**
 * Processes up to 20 selected Places results in one action. Each result is independent: a failure is
 * reported beside that result and never rolls back another reference. Retrying is safe because a
 * recorded Place ID is matched before anything is written.
 */
export async function bulkAddPlacesCandidates(
  ctx: ServiceContext,
  input: PlacesIntakeInput,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkPlacesIntakeResult> {
  if (!input.candidates.length) throw new StoreError('Select at least one business to add.', 'invalid');
  if (input.candidates.length > PLACES_INTAKE_LIMIT) throw new StoreError(`Add at most ${PLACES_INTAKE_LIMIT} businesses at a time.`, 'invalid');
  return addPlaces(ctx, input, onProgress);
}

async function addPlaces(
  ctx: ServiceContext,
  input: PlacesIntakeInput,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkPlacesIntakeResult> {
  const working = [...(await ctx.store.listBusinesses())];
  const results: PlacesIntakeResult[] = [];

  for (const [index, candidate] of input.candidates.entries()) {
    const assessment = assessPlacesIntake(candidate, { existingBusinesses: working, search: input });
    let result: PlacesIntakeResult = assessment;

    if (assessment.outcome === 'added') {
      try {
        const business = await createBusiness(ctx, placesReferenceForm(candidate, input, ctx.userLabel));
        working.push(business);
        await log(
          ctx,
          business.id,
          'note',
          candidate.isDemo
            ? 'Fictional demo discovery result saved for practice'
            : 'Google Places reference saved: Place ID only, no listing content',
          { sourceKind: business.sourceKind, hasPlaceId: Boolean(business.placesPlaceId) },
        );
        result = { ...assessment, businessId: business.id, businessName: business.name };
      } catch (error) {
        result = {
          ...assessment,
          outcome: 'failed',
          businessId: null,
          businessName: null,
          reason: `This reference could not be saved: ${error instanceof Error ? error.message : 'unknown error'}`,
        };
      }
    }

    results.push(result);
    onProgress?.(index + 1, input.candidates.length);
  }

  return { results, summary: summarizePlacesIntake(results) };
}

/**
 * One selection, one action, however many providers surfaced the business. Places runs first because a
 * Place ID is the one Google value that may be kept, so a cross-provider duplicate resolves to that
 * reference instead of a second prospect. The social half then reports the claimed profile as
 * "Needs review" with a link to it.
 */
export async function bulkAddMixedCandidates(
  ctx: ServiceContext,
  input: BulkMixedIntakeInput,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkMixedIntakeResult> {
  const total = input.candidates.length + input.social.length;
  if (!total) throw new StoreError('Select at least one result to add.', 'invalid');
  if (total > PLACES_INTAKE_LIMIT) throw new StoreError(`Add at most ${PLACES_INTAKE_LIMIT} results at a time.`, 'invalid');

  const places = await addPlaces(ctx, input, onProgress ? (done) => onProgress(done, total) : undefined);

  const claimedProfileKeys = new Map<string, { businessId: string; name: string }>();
  for (const [index, candidate] of input.candidates.entries()) {
    const result = places.results[index];
    const key = listedProfileKey(candidate);
    if (key && result?.businessId) claimedProfileKeys.set(key, { businessId: result.businessId, name: result.businessName ?? result.listingName });
  }

  const social = input.social.length
    ? await bulkAddSocialCandidates(
        ctx,
        {
          candidates: input.social,
          basis: input.basis,
          category: input.category,
          country: input.country,
          region: input.region,
          city: input.city,
          neighborhood: input.neighborhood,
          claimedProfileKeys,
        },
        onProgress ? (done) => onProgress(places.results.length + done, total) : undefined,
      )
    : null;

  return {
    places,
    social,
    summary: {
      added: places.summary.added + (social?.summary.added ?? 0),
      already_exists: places.summary.already_exists + (social?.summary.already_exists ?? 0),
      needs_review: places.summary.needs_review + (social?.summary.needs_review ?? 0),
      needs_permitted_source: places.summary.needs_permitted_source + (social?.summary.needs_permitted_source ?? 0),
      failed: places.summary.failed,
      not_eligible: social?.summary.not_eligible ?? 0,
      total,
    },
  };
}
