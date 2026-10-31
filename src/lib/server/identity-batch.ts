// Preparing a batch request: which asked-for records may actually be checked, and why the others may
// not. Kept apart from the route so the rejections — a record from another workspace, a Place ID that
// changed since the list was loaded, a name that is only a reference label — can be tested without an
// HTTP request, and so the browser's version of a record is never the one a cloud check runs against.

import {
  identityBatchEligibility,
  identityNameProblem,
  type IdentityCheckResult,
  type IdentityJob,
} from '@/lib/domain/identity-batch';
import { identityProfileOf, type IdentityProfile } from '@/lib/domain/place-identity';
import type { Business } from '@/lib/domain/types';

/** One record as the browser asked for it to be checked. */
export interface IdentityBatchRequest {
  businessId: string;
  /** The reference the person saw. It must still be the record's Place ID. */
  placeId: string;
  name: string;
  /** Demo mode only: the browser holds the demo store, so the record travels with the request. */
  profile?: IdentityProfile;
}

export interface IdentityBatchPreparation {
  jobs: IdentityJob[];
  rejected: IdentityCheckResult[];
}

/**
 * Resolves each request against the caller's own workspace. `lookup` must be scoped to the caller
 * (a store built from their session), so a record from another organization is simply not found. When
 * `lookup` is null — demo mode, where there is no server-side store — the profile sent with the
 * request is the record, and a request that carries none is refused.
 */
export async function prepareIdentityBatch(
  inputs: IdentityBatchRequest[],
  lookup: ((businessId: string) => Promise<Business | null>) | null,
): Promise<IdentityBatchPreparation> {
  const jobs: IdentityJob[] = [];
  const rejected: IdentityCheckResult[] = [];
  const reject = (businessId: string, reason: string) =>
    rejected.push({ businessId, state: 'failed', evidence: null, reading: null, reason });

  for (const input of inputs) {
    const problem = identityNameProblem(input.name);
    if (problem) {
      reject(input.businessId, problem);
      continue;
    }

    let placeId = input.placeId;
    let recordName = input.name;
    let profile: IdentityProfile | undefined;

    if (lookup) {
      // Read here, from the caller's workspace, so a browser cannot ask for a check against a profile
      // it made up, and so a record that has since been merged or renamed elsewhere is not checked.
      const business = await lookup(input.businessId);
      if (!business) {
        reject(input.businessId, 'Prospect not found in this workspace.');
        continue;
      }
      const eligible = identityBatchEligibility(business);
      if (!eligible.eligible) {
        reject(input.businessId, eligible.reason);
        continue;
      }
      if (business.placesPlaceId !== input.placeId) {
        reject(input.businessId, 'This record changed since the list was loaded. Reload and run the batch again.');
        continue;
      }
      placeId = business.placesPlaceId ?? input.placeId;
      recordName = business.name;
      profile = identityProfileOf(business);
    } else {
      profile = input.profile;
      if (!profile) {
        reject(input.businessId, 'The record is missing from the request.');
        continue;
      }
      recordName = profile.name || input.name;
    }

    jobs.push({
      businessId: input.businessId,
      placeId,
      recordName,
      name: input.name,
      profile,
      state: 'pending',
      evidence: null,
      reading: null,
      reason: null,
      checkedAt: null,
    });
  }

  return { jobs, rejected };
}
