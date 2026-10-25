// A saved, immutable rendered prototype. The blueprint is the whole document; media remains in the
// private vault and is signed again when a version is opened. A prototype is not a publication.

import type { WebsiteBlueprint } from './website-blueprint';

export interface StudioWebsitePrototype {
  id: string;
  organizationId: string;
  projectId: string;
  directionId: string;
  conceptKey: string;
  version: number;
  content: WebsiteBlueprint;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export type StudioWebsitePrototypeInsert = Omit<StudioWebsitePrototype, 'id' | 'organizationId' | 'createdBy' | 'createdAt'>;
