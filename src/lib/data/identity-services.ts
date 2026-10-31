import type { Business } from '@/lib/domain/types';
import {
  acceptanceFor,
  identityProfileOf,
  parsePlaceIdentityEvidence,
  type IdentityPatch,
  type PlaceIdentityReading,
} from '@/lib/domain/place-identity';
import { scoreFields } from '@/lib/domain/rescore';
import { recordResearchObservation } from './social-intake-services';
import { log, type ServiceContext } from './services';
import { StoreError } from './store';

// Accepting an identification. The evidence is re-parsed and re-read against the record as it is now,
// so what lands in the workspace is derived from the evidence rather than trusted from the browser.

export interface PlaceIdentityAcceptance {
  business: Business;
  patch: IdentityPatch;
  reading: PlaceIdentityReading;
  /** The provenance entry in the research list, when the workspace has that migration. */
  observationId: string | null;
}

export async function acceptPlaceIdentity(ctx: ServiceContext, business: Business, rawEvidence: unknown): Promise<PlaceIdentityAcceptance> {
  const current = await ctx.store.getBusiness(business.id);
  if (!current) throw new StoreError('Prospect not found', 'not_found');

  let evidence;
  try {
    evidence = parsePlaceIdentityEvidence(rawEvidence);
  } catch {
    throw new StoreError('That check cannot be read. Run it again.', 'invalid');
  }

  const decision = acceptanceFor(evidence, identityProfileOf(current));
  if (!decision.ok) throw new StoreError(decision.reason, 'invalid');
  const { reading, patch } = decision;
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

  return { business: saved, patch, reading, observationId };
}
