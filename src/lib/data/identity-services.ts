import type { Business } from '@/lib/domain/types';
import { IDENTITY_BATCH_LIMIT } from '@/lib/domain/identity-batch';
import { identityDuplicateNotices, blockingIdentityDuplicates } from '@/lib/domain/identity-approval';
import {
  acceptanceFor,
  identityPatch,
  identityProfileOf,
  parsePlaceIdentityEvidence,
  readPlaceIdentity,
  type IdentityPatch,
  type IdentityProposal,
  type PlaceIdentityReading,
} from '@/lib/domain/place-identity';
import { scoreFields } from '@/lib/domain/rescore';
import { recordResearchObservation } from './social-intake-services';
import { log, type ServiceContext } from './services';
import { StoreError } from './store';

// Accepting an identification. The evidence is re-parsed and re-read against the record as it is now,
// so what lands in the workspace is derived from the evidence rather than trusted from the browser.
// The same path serves one record and a reviewed batch: a batch approval is N of these, one after the
// other, each re-checked against the workspace as the previous write left it.

/** How a person reached an approval. Recorded so the audit trail shows whether a batch did this. */
export type IdentityApprovalVia = 'single' | 'batch';

export interface PlaceIdentityAcceptanceOptions {
  /** The Place ID the person reviewed. The record must still carry it, or the update is stale. */
  expectedPlaceId?: string;
  /** Refuse a rename that would duplicate another prospect, instead of relying on the screen. */
  requireNoDuplicates?: boolean;
  /** `single` (the record's own dialog) or `batch` (a reviewed selection). */
  via?: IdentityApprovalVia;
}

export interface PlaceIdentityAcceptance {
  /** `unchanged` means the record already carried these details, so nothing was written. */
  state: 'approved' | 'unchanged';
  business: Business;
  patch: IdentityPatch;
  reading: PlaceIdentityReading;
  /** The provenance entry in the research list, when the workspace has that migration. */
  observationId: string | null;
}


export async function acceptPlaceIdentity(
  ctx: ServiceContext,
  business: Business,
  rawEvidence: unknown,
  options: PlaceIdentityAcceptanceOptions = {},
): Promise<PlaceIdentityAcceptance> {
  const current = await ctx.store.getBusiness(business.id);
  if (!current) throw new StoreError('Prospect not found', 'not_found');

  // The record the person reviewed must still be the record this evidence describes.
  if (options.expectedPlaceId !== undefined && (current.placesPlaceId ?? '') !== options.expectedPlaceId.trim()) {
    throw new StoreError('This record no longer refers to the Google reference you reviewed. Check it again before approving it.', 'conflict');
  }

  let evidence;
  try {
    evidence = parsePlaceIdentityEvidence(rawEvidence);
  } catch {
    throw new StoreError('That check cannot be read. Run it again.', 'invalid');
  }

  // Already applied: the record carries exactly what this evidence proposes, so a retry changes
  // nothing and writes no second audit entry. This is checked before staleness, because the check
  // that named the record necessarily predates the rename it made.
  const profile = identityProfileOf(current);
  const fresh = readPlaceIdentity(evidence);
  if (fresh.status === 'identified') {
    const applied = identityPatch(profile, fresh.proposal);
    const changes = [applied.renames, applied.officialWebsite, applied.category, applied.city].filter(Boolean).length;
    if (changes === 0) return { state: 'unchanged', business: current, patch: applied, reading: fresh, observationId: null };
  }

  const decision = acceptanceFor(evidence, profile);
  if (!decision.ok) throw new StoreError(decision.reason, 'invalid');
  const { reading, patch } = decision;

  // A reviewed batch never renames a record into an identity the workspace already holds: that would
  // create the duplicate the intake refuses to create, and merging is a person's decision, not ours.
  if (options.requireNoDuplicates) await assertNoIdentityDuplicate(ctx, current, reading.proposal);

  const next: Business = {
    ...current,
    name: patch.name,
    officialWebsite: patch.officialWebsite ?? current.officialWebsite,
    category: patch.category ?? current.category,
    city: patch.city ?? current.city,
  };

  const saved = await ctx.store.updateBusiness(current.id, {
    name: next.name,
    officialWebsite: next.officialWebsite,
    category: next.category,
    city: next.city,
    ...scoreFields(next, await ctx.store.listVerifications(current.id), ctx.settings),
  });

  const changed = [
    patch.renames ? `name (was “${current.name}”)` : null,
    patch.officialWebsite ? 'official website' : null,
    patch.category ? 'category' : null,
    patch.city ? 'town' : null,
  ].filter(Boolean);
  await log(ctx, saved.id, 'system', `Identified from an independent source: ${saved.name}`, {
    site: reading.proposal.site,
    sourceUrl: reading.proposal.url,
    publishedName: reading.proposal.publishedName,
    publishedNameFrom: reading.proposal.publishedNameFrom,
    confidence: reading.confidence,
    changed,
    checkedAt: evidence.checkedAt,
    // Nothing from the search itself is kept: only the site that stood for the place and its reading.
    queries: evidence.queries.length,
    // Who approved the change, when, from which record, and what it replaced: the audit trail a
    // reviewed batch needs, since no single dialog holds the person's view of the row any more.
    reviewer: { id: ctx.userId, label: ctx.userLabel },
    approvedVia: options.via ?? 'single',
    approvedAt: new Date().toISOString(),
    placeId: current.placesPlaceId,
    previous: {
      name: current.name,
      officialWebsite: current.officialWebsite,
      category: current.category,
      city: current.city,
    },
    identity: {
      name: saved.name,
      officialWebsite: saved.officialWebsite,
      category: saved.category,
      city: saved.city,
    },
    ownershipScore: reading.checks[0]?.score ?? null,
  });

  let observationId: string | null = null;
  if (await ctx.store.socialResearchAvailable()) {
    try {
      const observation = await recordResearchObservation(ctx, {
        businessId: saved.id,
        category: 'identity',
        statement: `Identified as ${saved.name} from ${reading.proposal.site}.`,
        sourceKind: 'official_website',
        sourceUrl: reading.proposal.url,
        status: 'independently_verified',
        evidence: `${reading.proposal.site} publishes “${reading.proposal.publishedName ?? saved.name}”${
          reading.proposal.city ? ` and names ${reading.proposal.city}` : ''
        }. Checked ${evidence.checkedAt.slice(0, 10)}; ownership evidence ${reading.checks[0]?.score ?? 0}/100.`,
      });
      observationId = observation.id;
    } catch {
      // The activity above is the audit trail; a missing provenance row must not undo the change.
      observationId = null;
    }
  }

  return { state: 'approved', business: saved, patch, reading, observationId };
}

/**
 * Refuses an approval that would rename this record into another prospect's identity. Compared
 * against the workspace as it stands now, because the screen's copy of it may be minutes old.
 */
async function assertNoIdentityDuplicate(ctx: ServiceContext, current: Business, proposal: IdentityProposal): Promise<void> {
  const others = (await ctx.store.listBusinesses()).filter((business) => business.id !== current.id);
  const duplicates = blockingIdentityDuplicates(
    identityDuplicateNotices(
      {
        businessId: current.id,
        placeId: current.placesPlaceId ?? '',
        name: proposal.name,
        city: proposal.city ?? current.city,
        website: proposal.url || null,
      },
      others,
    ),
  );
  if (!duplicates.length) return;
  const named = duplicates.slice(0, 2).map((duplicate) => `“${duplicate.name}”`).join(', ');
  throw new StoreError(
    `Another prospect already matches this identity (${named}). Resolve the duplicate first; records are never merged automatically.`,
    'conflict',
  );
}

// ── A reviewed batch ─────────────────────────────────────────────────────────

/** One identity a person approved, as the screen sends it. */
export interface IdentityApprovalRequest {
  businessId: string;
  /** The Place ID the person reviewed; the record must still carry it. */
  placeId: string;
  evidence: unknown;
}

export interface IdentityApprovalResult {
  businessId: string;
  /** `unchanged` means the record already carried these details, so no second change was written. */
  state: 'approved' | 'unchanged' | 'failed';
  reason: string | null;
  /** The record as it stands after the approval, when it landed. */
  business: Business | null;
  /** The fields the approval changed, for the per-record result list. */
  changed: string[];
  observationId: string | null;
}

const changedFields = (patch: IdentityPatch): string[] =>
  [
    patch.renames ? 'name' : null,
    patch.officialWebsite ? 'website' : null,
    patch.category ? 'category' : null,
    patch.city ? 'town' : null,
  ].filter((field): field is string => field !== null);

/**
 * Applies a reviewed selection, one record at a time. Every record is re-read, re-authorized by the
 * caller's own store, re-checked against the Place ID the person saw, judged again from its evidence
 * and checked for duplicates as the previous approvals left the workspace. A failure stops that record
 * only: the ones already approved stay approved, and the ones after it still run, so a partial batch
 * never loses work. Nothing here runs without a person confirming the selection.
 */
export async function approveIdentityBatch(
  ctx: ServiceContext,
  requests: IdentityApprovalRequest[],
): Promise<IdentityApprovalResult[]> {
  if (requests.length > IDENTITY_BATCH_LIMIT) {
    throw new StoreError(`Approve at most ${IDENTITY_BATCH_LIMIT} identities at a time.`, 'invalid');
  }
  const seen = new Set<string>();
  const results: IdentityApprovalResult[] = [];
  for (const request of requests) {
    if (seen.has(request.businessId)) {
      results.push({
        businessId: request.businessId,
        state: 'failed',
        reason: 'This record appears twice in the selection.',
        business: null,
        changed: [],
        observationId: null,
      });
      continue;
    }
    seen.add(request.businessId);
    try {
      // The store is scoped to the caller, so a record from another organization is simply not found.
      const business = await ctx.store.getBusiness(request.businessId);
      if (!business) throw new StoreError('Prospect not found in this workspace.', 'not_found');
      const accepted = await acceptPlaceIdentity(ctx, business, request.evidence, {
        expectedPlaceId: request.placeId,
        requireNoDuplicates: true,
        via: 'batch',
      });
      results.push({
        businessId: request.businessId,
        state: accepted.state,
        reason: null,
        business: accepted.business,
        changed: accepted.state === 'approved' ? changedFields(accepted.patch) : [],
        observationId: accepted.observationId,
      });
    } catch (error) {
      results.push({
        businessId: request.businessId,
        state: 'failed',
        reason: error instanceof Error ? error.message : 'The approval could not be applied.',
        business: null,
        changed: [],
        observationId: null,
      });
    }
  }
  return results;
}

