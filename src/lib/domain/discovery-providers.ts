// Discovery providers declare, in one place, what their data may be used for, what may be stored,
// what attribution is required and whether an integration actually exists in this app. Nothing here
// is inferred from a logo or a sales page: `status: 'not_integrated'` means exactly that, and a
// provider with no permitted uses cannot be used by anything.
//
// Campaigns may run only through a provider that permits unattended discovery *and* CRM processing.
// Google Places permits neither: it is an interactive, user-initiated search source (see the Places
// retention rules in src/lib/server/providers/google-places.ts and docs/DATA_PROVIDER_POLICY_MATRIX.md).

export type ProviderUse = 'interactive_discovery' | 'unattended_discovery' | 'crm_processing' | 'outreach' | 'bulk_export';

export type ProviderKind = 'internal_records' | 'places' | 'licensed_directory' | 'commercial_b2b' | 'self_submitted' | 'public_dataset' | 'national_registry';

/** `live` runs in this app today; `not_integrated` is a documented place for a future integration. */
export type ProviderStatus = 'live' | 'not_integrated';

export interface ProviderCapabilities {
  search: boolean;
  details: boolean;
  websiteField: boolean;
  phoneField: boolean;
  emailField: boolean;
  bulk: boolean;
  scheduled: boolean;
}

export interface ProviderRetention {
  /** Fields that may be written to the CRM under the provider's terms. */
  storableFields: string[];
  /** Fields that may be shown while researching but never stored. */
  displayOnlyFields: string[];
  /** Longest permitted cache, in seconds; 0 means no caching. */
  cacheSeconds: number;
  policyUrl: string | null;
  notes: string;
}

export interface ProviderAttribution {
  required: boolean;
  text: string | null;
  url: string | null;
  notes: string;
}

export interface ProviderLicence {
  name: string | null;
  url: string | null;
  reviewedOn: string | null;
  notes: string;
}

export interface ProviderCost {
  model: 'free' | 'per_request' | 'subscription' | 'unknown';
  estimatedSearchUsd: number | null;
  notes: string;
}

export interface DiscoveryProviderDeclaration {
  id: string;
  name: string;
  kind: ProviderKind;
  status: ProviderStatus;
  /** Uses the provider's terms allow. Empty means none may be claimed until a licence is reviewed. */
  permittedUses: ProviderUse[];
  /** A person must start every search; no schedule, no bulk run. */
  requiresUserInitiation: boolean;
  /** A signed licence or data-processing agreement is required before any use. */
  requiresLicence: boolean;
  capabilities: ProviderCapabilities;
  attribution: ProviderAttribution;
  retention: ProviderRetention;
  licence: ProviderLicence;
  cost: ProviderCost;
  notes: string;
}

const NONE: ProviderCapabilities = { search: false, details: false, websiteField: false, phoneField: false, emailField: false, bulk: false, scheduled: false };

/**
 * A provider this app has no connector for. Every capability is false and no use is permitted: a
 * placeholder must never look usable. A licence review is what turns one into a real declaration.
 */
function notIntegrated(
  id: string,
  name: string,
  kind: ProviderKind,
  options: { requiresUserInitiation: boolean; requiresLicence: boolean; licenceNotes: string; retentionNotes: string; notes: string },
): DiscoveryProviderDeclaration {
  return {
    id,
    name,
    kind,
    status: 'not_integrated',
    permittedUses: [],
    requiresUserInitiation: options.requiresUserInitiation,
    requiresLicence: options.requiresLicence,
    capabilities: NONE,
    attribution: { required: false, text: null, url: null, notes: 'Set by the licence or contract; not reviewed.' },
    retention: { storableFields: [], displayOnlyFields: [], cacheSeconds: 0, policyUrl: null, notes: options.retentionNotes },
    licence: { name: null, url: null, reviewedOn: null, notes: options.licenceNotes },
    cost: { model: 'unknown', estimatedSearchUsd: null, notes: 'No integration, so no cost model is claimed.' },
    notes: options.notes,
  };
}


export const DISCOVERY_PROVIDER_CATALOG: readonly DiscoveryProviderDeclaration[] = [
  {
    id: 'tracked_records',
    name: 'Prospects already tracked in this workspace',
    kind: 'internal_records',
    status: 'live',
    permittedUses: ['unattended_discovery', 'crm_processing', 'outreach'],
    requiresUserInitiation: false,
    requiresLicence: false,
    capabilities: { search: true, details: true, websiteField: true, phoneField: true, emailField: true, bulk: true, scheduled: true },
    attribution: { required: false, text: null, url: null, notes: 'The workspace’s own records; no third-party attribution applies.' },
    retention: {
      storableFields: ['all fields already recorded'],
      displayOnlyFields: [],
      cacheSeconds: 0,
      policyUrl: null,
      notes: 'Campaigns re-read records the workspace already holds; they do not acquire new records.',
    },
    licence: { name: null, url: null, reviewedOn: null, notes: 'No third-party licence: the data is the workspace’s own.' },
    cost: { model: 'free', estimatedSearchUsd: null, notes: 'No provider call is made to select a tracked prospect.' },
    notes:
      'The only provider a campaign may use in this version. It runs the research agents (identity, verification, contacts, audit, scoring, report) over tracked prospects and never searches for new businesses.',
  },
  {
    id: 'google_places',
    name: 'Google Places',
    kind: 'places',
    status: 'live',
    permittedUses: ['interactive_discovery'],
    requiresUserInitiation: true,
    requiresLicence: false,
    capabilities: { search: true, details: true, websiteField: true, phoneField: true, emailField: false, bulk: false, scheduled: false },
    attribution: {
      required: true,
      text: 'Results from Google Maps',
      url: 'https://www.google.com/maps',
      notes: 'Show Google Maps attribution with results and link to the listing for full details.',
    },
    retention: {
      storableFields: ['places_place_id'],
      displayOnlyFields: ['name', 'address', 'website', 'phone', 'business status', 'primary type'],
      cacheSeconds: 0,
      policyUrl: 'https://developers.google.com/maps/documentation/places/web-service/policies',
      notes:
        'Only the Place ID may be stored. Other fields are display-only and must be confirmed from an independent source. A missing website field is not evidence that no website exists.',
    },
    licence: {
      name: 'Google Maps Platform Terms of Service',
      url: 'https://cloud.google.com/maps-platform/terms',
      reviewedOn: '2026-10-24',
      notes: 'Cost metering and quotas apply. Automated bulk harvesting is not permitted and is not implemented.',
    },
    cost: { model: 'per_request', estimatedSearchUsd: null, notes: 'Charged per request by Google; the server records each call against the Google Places budget.' },
    notes:
      'User-initiated discovery only. Never authorized for unattended discovery, CRM processing or campaigns: a person starts each search, and only Place IDs may be stored.',
  },
  notIntegrated('licensed_directory', 'Licensed business directory', 'licensed_directory', {
    requiresUserInitiation: false,
    requiresLicence: true,
    licenceNotes: 'No directory licence has been reviewed. Permitted uses stay empty until one is.',
    retentionNotes: 'Depends on the licence; nothing is assumed.',
    notes: 'Placeholder for a directory with a signed data licence. No connector exists and no use is claimed.',
  }),
  notIntegrated('commercial_b2b', 'Commercial B2B data provider', 'commercial_b2b', {
    requiresUserInitiation: false,
    requiresLicence: true,
    licenceNotes: 'No data-processing agreement has been reviewed. Permitted uses stay empty until one is.',
    retentionNotes: 'Depends on the contract; nothing is assumed.',
    notes: 'Placeholder for a licensed B2B data provider. No connector exists and no use is claimed.',
  }),
  notIntegrated('business_submission', 'Business-submitted records', 'self_submitted', {
    requiresUserInitiation: true,
    requiresLicence: false,
    licenceNotes: 'First-party data; the submission form and its consent wording must be built before use.',
    retentionNotes: 'Would store only what the business submits, with the consent it gives; the intake form does not exist yet.',
    notes: 'Placeholder for a public business-submission form. No form exists, so no data path is claimed.',
  }),
  notIntegrated('public_dataset', 'Permitted public dataset', 'public_dataset', {
    requiresUserInitiation: false,
    requiresLicence: true,
    licenceNotes: 'No dataset licence has been reviewed.',
    retentionNotes: 'Depends on the dataset licence; nothing is assumed.',
    notes: 'Placeholder for an open or permitted dataset (for example a business register extract). No import exists.',
  }),
  notIntegrated('national_registry', 'National business registry / country integration', 'national_registry', {
    requiresUserInitiation: false,
    requiresLicence: true,
    licenceNotes: 'No registry agreement has been reviewed.',
    retentionNotes: 'Depends on the registry’s terms; nothing is assumed.',
    notes: 'Placeholder for a country-specific registry integration (Ghana or elsewhere). No connector exists.',
  }),

];

const BY_ID = new Map(DISCOVERY_PROVIDER_CATALOG.map((p) => [p.id, p]));

export function providerDeclaration(id: string | null | undefined): DiscoveryProviderDeclaration | null {
  return (id && BY_ID.get(id)) || null;
}

/** Whether the declaration allows this use. Unknown providers allow nothing. */
export function providerAllows(id: string, use: ProviderUse): boolean {
  return providerDeclaration(id)?.permittedUses.includes(use) ?? false;
}

/** Providers a campaign may use: unattended discovery and CRM processing, both permitted. */
export function campaignProviders(): DiscoveryProviderDeclaration[] {
  return DISCOVERY_PROVIDER_CATALOG.filter((p) => p.permittedUses.includes('unattended_discovery') && p.permittedUses.includes('crm_processing'));
}

/** Why a provider cannot be used for a campaign, or null when it can. */
export function campaignProviderBlocker(id: string): string | null {
  const provider = providerDeclaration(id);
  if (!provider) return 'Unknown discovery provider.';
  if (provider.requiresUserInitiation) return `${provider.name} needs a person to start each search, so it cannot run in a campaign.`;
  const missing = (['unattended_discovery', 'crm_processing'] as const).filter((use) => !provider.permittedUses.includes(use));
  if (missing.length) return `${provider.name} does not permit ${missing.map((u) => u.replace(/_/g, ' ')).join(' or ')}, so it cannot run in a campaign.`;
  if (provider.status !== 'live') return `${provider.name} is not integrated in this version.`;
  return null;
}

