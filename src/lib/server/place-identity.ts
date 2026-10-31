import 'server-only';

import {
  PLACE_IDENTITY_INSPECTION_LIMIT,
  assessBusinessFor,
  corroboratingSources,
  looksLikePlaceholderName,
  planIdentityQueries,
  readPlaceIdentity,
  toIdentityCandidate,
  type IdentityCandidate,
  type IdentityProfile,
  type IdentityQueryRecord,
  type PlaceIdentityEvidence,
  type PlaceIdentityReading,
} from '@/lib/domain/place-identity';
import { judgeCandidate, searchCandidates, type SearchHit } from '@/lib/domain/website-assessment';
import type { RequestContext } from './context';
import { serverEnv } from './env';
import { HttpError } from './http';
import { runInspection, runWebSearch } from './research-tools';

// Identifying a Place-ID-only reference. A few bounded searches and one homepage read per shortlisted
// site produce evidence that holds hosts, published names and scores, never results or page text.
// Nothing here writes to the workspace: a person reviews the reading and accepts it separately.

export interface PlaceIdentityCheckRun {
  evidence: PlaceIdentityEvidence;
  reading: PlaceIdentityReading;
  /** True when the run read the labelled simulated world rather than the public web. */
  simulated: boolean;
}

/** The name a person typed, which is the only input a check needs. */
export function searchableName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 200);
  if (name.length < 3) throw new HttpError(400, 'Enter the business name you want to check (at least three characters).');
  if (looksLikePlaceholderName(name)) throw new HttpError(400, 'A reference label is not a business name. Enter the name you want to check.');
  return name;
}

/**
 * One identification run: plan the queries, keep the hits in memory, shortlist candidate sites, read
 * one homepage each and judge them with the same ownership rules website verification uses. A search
 * or read that fails for a transient reason is recorded and the run continues; a missing key or an
 * exhausted quota stops it, because those are the person's to fix rather than the business's.
 */
export async function runPlaceIdentityCheck(ctx: RequestContext, input: { profile: IdentityProfile; name: string }): Promise<PlaceIdentityCheckRun> {
  const name = searchableName(input.name);
  const business = assessBusinessFor(input.profile, name);
  const hits: SearchHit[] = [];
  const queries: IdentityQueryRecord[] = [];

  for (const planned of planIdentityQueries(input.profile, name)) {
    try {
      const outcome = await runWebSearch(ctx, planned.query, { purpose: `identity_${planned.purpose}` });
      hits.push(...outcome.hits);
      queries.push({ purpose: planned.purpose, resultCount: outcome.hits.length, ok: true });
    } catch (error) {
      // HttpError carries the actionable reason (not configured, quota spent, budget reached).
      if (error instanceof HttpError) throw error;
      queries.push({ purpose: planned.purpose, resultCount: 0, ok: false });
    }
  }

  const candidates: IdentityCandidate[] = [];
  for (const target of searchCandidates(hits, business, PLACE_IDENTITY_INSPECTION_LIMIT).slice(0, PLACE_IDENTITY_INSPECTION_LIMIT)) {
    try {
      const page = await runInspection(ctx, target.url);
      const judged = judgeCandidate(
        { site: target.site, url: target.url, origins: ['search_result'], dns: null, robots: page.robots, check: page.check, facts: page.facts },
        business,
      );
      candidates.push(toIdentityCandidate(judged, name));
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 503)) throw error;
      // A site that cannot be read at all is simply not part of the reading.
    }
  }

  const evidence: PlaceIdentityEvidence = {
    schema: 1,
    checkedAt: new Date().toISOString(),
    profile: input.profile,
    queries,
    candidates,
    corroboration: corroboratingSources(hits, name, { excludeHosts: candidates.map((c) => c.site) }),
  };
  return { evidence, reading: readPlaceIdentity(evidence), simulated: serverEnv.simulateExternalTools() };
}
