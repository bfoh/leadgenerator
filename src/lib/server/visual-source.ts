import 'server-only';

import type { DataStore } from '@/lib/data/store';
import type { Business } from '@/lib/domain/types';
import { candidateSourceCheck, type VisualCandidate } from '@/lib/domain/visual-acquisition';
import { HttpError } from './http';

// Both acquisition routes read a file. Neither may be told where to read it: a caller can send any
// address, so the address is looked up from the workspace's own record instead. That is what makes
// "only the business's own website, only a candidate that is still undecided" a property of the
// server rather than of the dialog that happened to call it.

type CandidateLookup = Pick<DataStore, 'getVisualCandidate' | 'getBusiness' | 'getStudioProject'>;

export interface AuthorizedSource {
  candidate: VisualCandidate;
  business: Business;
}

export async function resolveAuthorizedSource(store: CandidateLookup, candidateId: string): Promise<AuthorizedSource> {
  const candidate = await store.getVisualCandidate(candidateId);
  if (!candidate) throw new HttpError(404, 'That image is not recorded in this workspace.');
  const business = await store.getBusiness(candidate.businessId);
  if (!business) throw new HttpError(404, 'The prospect for that image is not in this workspace.');
  const project = await store.getStudioProject(candidate.projectId);
  if (!project || project.businessId !== business.id) throw new HttpError(404, 'The vault for that image is not this prospect’s.');
  if (candidate.status !== 'reference_only') throw new HttpError(409, 'This candidate has already been decided; record a new one to read the file again.');
  const check = candidateSourceCheck(candidate.pageUrl, candidate.imageUrl, business.officialWebsite);
  if (!check.ok) throw new HttpError(400, check.problem ?? 'That image cannot be read.');
  if (check.sourceKind !== 'official_site') {
    throw new HttpError(400, 'That image is served by a third party. Ask the owner for the original, or upload it with permission.');
  }
  return { candidate, business };
}
