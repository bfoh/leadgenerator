// Provider declarations for autonomous business discovery. One place states what each source is,
// what its licence actually permits, what may be stored, how long, and whether a connector exists.
// Nothing here is inferred from a logo or a sales page. See docs/AUTONOMOUS_DISCOVERY.md.
//
// `blocked` means the terms forbid this use. `not_integrated` means no connector exists (reviewed or
// unverified). `synthetic` is the offline development provider. Only a source whose declaration
// permits unattended search and CRM storage, and whose connector is enabled, may run in a campaign.

export const DISCOVERY_USES = [
  'interactive_search',
  'unattended_search',
  'crm_storage',
  'contact_storage',
  'marketing',
  'redistribution',
] as const;
export type DiscoveryUse = (typeof DISCOVERY_USES)[number];

export const DISCOVERY_SOURCE_KINDS = ['synthetic', 'open_dataset', 'commercial_api', 'directory', 'registry', 'places'] as const;
export type DiscoverySourceKind = (typeof DISCOVERY_SOURCE_KINDS)[number];

export const DISCOVERY_SOURCE_STATUSES = ['available', 'synthetic', 'not_integrated', 'blocked'] as const;
export type DiscoverySourceStatus = (typeof DISCOVERY_SOURCE_STATUSES)[number];

export interface DiscoverySourceFields {
  name: boolean;
  category: boolean;
  address: boolean;
  region: boolean;
  district: boolean;
  town: boolean;
  website: boolean;
  phone: boolean;
  email: boolean;
  operatingStatus: boolean;
  providerId: boolean;
  confidence: boolean;
}

export interface DiscoverySourceCoverage {
  countries: string[];
  /** Ghana coverage: `national`, `partial`, `unmeasured` or `not_applicable`. */
  ghana: 'national' | 'partial' | 'unmeasured' | 'not_applicable';
  /** True only after a measured Ghana sample has been reviewed — never a vendor claim. */
  ghanaMeasured: boolean;
  notes: string;
}

export interface DiscoverySourcePermissions {
  uses: DiscoveryUse[];
  /** Days a provider record may stay in staging; null means no contractual limit (Ghana law still applies). */
  retentionDays: number | null;
  attribution: { required: boolean; text: string | null; url: string | null };
  deletion: string;
  notes: string;
}

export interface DiscoverySourceLicence {
  name: string | null;
  url: string | null;
  reviewedOn: string | null;
  /** The exact evidence relied on, not a marketing claim. */
  evidence: string;
}

export interface DiscoverySourceDeclaration {
  id: string;
  name: string;
  kind: DiscoverySourceKind;
  status: DiscoverySourceStatus;
  coverage: DiscoverySourceCoverage;
  fields: DiscoverySourceFields;
  permissions: DiscoverySourcePermissions;
  licence: DiscoverySourceLicence;
  access: { mode: 'none' | 'bulk' | 'api' | 'in_process'; endpoint: string | null; notes: string };
  cost: { model: 'free' | 'per_request' | 'subscription' | 'unknown'; perSearchUsd: number | null; notes: string };
  limits: { maxPageSize: number; requestsPerMinute: number; dailyRecords: number | null };
  notes: string;
}

const NO_FIELDS: DiscoverySourceFields = {
  name: false,
  category: false,
  address: false,
  region: false,
  district: false,
  town: false,
  website: false,
  phone: false,
  email: false,
  operatingStatus: false,
  providerId: false,
  confidence: false,
};

function source(declaration: Omit<DiscoverySourceDeclaration, 'fields'> & { fields?: Partial<DiscoverySourceFields> }): DiscoverySourceDeclaration {
  return { ...declaration, fields: { ...NO_FIELDS, ...declaration.fields } };
}

export const DISCOVERY_SOURCE_CATALOG: readonly DiscoverySourceDeclaration[] = [
  source({
    id: 'offline_synthetic',
    name: 'Offline synthetic provider',
    kind: 'synthetic',
    status: 'synthetic',
    coverage: {
      countries: ['GH'],
      ghana: 'national',
      ghanaMeasured: false,
      notes: 'Deterministic test records across all 16 regions. Never real businesses and never evidence about a real market.',
    },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, operatingStatus: true, providerId: true, confidence: true },
    permissions: {
      uses: ['unattended_search', 'crm_storage'],
      retentionDays: 30,
      attribution: { required: true, text: 'Synthetic development data', url: null },
      deletion: 'Staging records expire after 30 days. Promoted records stay labelled synthetic.',
      notes: 'Created for this project; no third-party data, contact details or marketing use.',
    },
    licence: {
      name: 'Internal test data',
      url: null,
      reviewedOn: '2026-10-24',
      evidence: 'Generated in code from the Ghana region/district reference list. Contains no real business identity, website or phone number.',
    },
    access: { mode: 'in_process', endpoint: null, notes: 'Registered in the server provider registry; no network call.' },
    cost: { model: 'free', perSearchUsd: 0, notes: 'No external request.' },
    limits: { maxPageSize: 20, requestsPerMinute: 60, dailyRecords: 500 },
    notes:
      'Disabled unless DISCOVERY_SYNTHETIC_PROVIDER=true. Exercises pagination, quotas, deduplication and review end to end without a real provider. It is not a market-data source.',
  }),
  source({
    id: 'overture_places',
    name: 'Overture Maps — Places',
    kind: 'open_dataset',
    status: 'not_integrated',
    coverage: {
      countries: ['global'],
      ghana: 'unmeasured',
      ghanaMeasured: false,
      notes: 'A global monthly Parquet release. Ghana coverage and category quality have not been measured; do not assume density from the global total.',
    },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, phone: true, email: true, operatingStatus: true, providerId: true, confidence: true },
    permissions: {
      uses: ['unattended_search', 'crm_storage'],
      retentionDays: null,
      attribution: {
        required: true,
        text: 'Place data © Overture Maps Foundation and its sources (including Meta, Microsoft and Foursquare)',
        url: 'https://docs.overturemaps.org/attribution/',
      },
      deletion: 'CDLA-Permissive-2.0 has no deletion deadline. A personal-data erasure request under Ghana Act 843 still applies.',
      notes: 'Business identity and location may be stored. Emails/phones are contact data: contact storage and marketing are not permitted by this declaration.',
    },
    licence: {
      name: 'CDLA-Permissive-2.0 (most sources) and Apache-2.0 (Foursquare source)',
      url: 'https://docs.overturemaps.org/attribution/',
      reviewedOn: '2026-10-24',
      evidence:
        'Overture states the Places theme is published under CDLA Permissive 2.0 and Apache 2.0, contains no OpenStreetMap data and carries none of the ODbL share-alike obligations. CDLA-Permissive-2.0 permits use, modification and sharing; the licence text must travel with shared Data, and Results carry no restrictions. Foursquare-derived rows require its NOTICE to be preserved.',
    },
    access: {
      mode: 'bulk',
      endpoint: 's3://overturemaps-us-west-2/release/',
      notes: 'Monthly releases; query with DuckDB/Parquet. No API connector exists in this app, and no download has been performed.',
    },
    cost: { model: 'free', perSearchUsd: 0, notes: 'No licence fee; cloud egress and compute are borne by us.' },
    limits: { maxPageSize: 1000, requestsPerMinute: 60, dailyRecords: null },
    notes:
      'The strongest licensing candidate found: permissive, commercial storage allowed, no ODbL share-alike. Deliberately not integrated: Ghana coverage must be measured, a bulk importer built, and the owner must approve the first run.',
  }),
  source({
    id: 'openstreetmap',
    name: 'OpenStreetMap (planet / Overpass)',
    kind: 'open_dataset',
    status: 'not_integrated',
    coverage: {
      countries: ['global'],
      ghana: 'unmeasured',
      ghanaMeasured: false,
      notes: 'Community-mapped POIs exist in Ghana, but completeness and business status vary by area and have not been measured.',
    },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, phone: true, email: true, operatingStatus: true, providerId: true, confidence: false },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: true, text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
      deletion: 'ODbL attribution and share-alike continue for any distributed derivative database.',
      notes: 'Not permitted for this CRM without a legal review of ODbL share-alike and the Nominatim/Overpass usage policies.',
    },
    licence: {
      name: 'Open Database License (ODbL) 1.0',
      url: 'https://www.openstreetmap.org/copyright',
      reviewedOn: '2026-10-24',
      evidence:
        'OSM is licensed under ODbL: “If you alter or build upon our data, you may distribute the result only under the same license.” Nominatim’s policy forbids “downloading all POIs in an area” and systematic queries; bulk users must use an extract or their own instance. A proprietary CRM built from a substantial OSM extract may be a derivative database, so no use is claimed.',
    },
    access: { mode: 'none', endpoint: null, notes: 'No connector. Public Nominatim is not a bulk POI source; Overpass fair-use limits would still apply.' },
    cost: { model: 'free', perSearchUsd: 0, notes: 'Data is free; self-hosting and legal review are not.' },
    limits: { maxPageSize: 0, requestsPerMinute: 1, dailyRecords: 0 },
    notes: 'Rejected for the first autonomous connector. Revisit only with counsel’s written view on ODbL and a self-hosted extract pipeline.',
  }),
  source({
    id: 'foursquare_api',
    name: 'Foursquare Places API',
    kind: 'commercial_api',
    status: 'not_integrated',
    coverage: {
      countries: ['global'],
      ghana: 'unmeasured',
      ghanaMeasured: false,
      notes: 'Global vendor coverage; Ghana density and freshness are not verified by this project.',
    },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, phone: true, email: false, operatingStatus: true, providerId: true, confidence: true },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: true, text: 'Foursquare attribution as required by the applicable EULA', url: 'https://foursquare.com/legal/terms' },
      deletion: 'The Developer Master Terms require destruction and removal of all copies of Product data on termination, with audit rights.',
      notes: 'Product data is treated as confidential. No storage, CRM or lead-generation use is claimed without the applicable paid EULA and a DPA.',
    },
    licence: {
      name: 'Foursquare Developer Master Terms (29 Feb 2024) and applicable EULA',
      url: 'https://foursquare.com/legal/terms/developermasterterms/',
      reviewedOn: '2026-10-24',
      evidence:
        'The Master Terms state that the Products and their underlying data are Foursquare’s Confidential Information even where individual facts are public, and require the customer on termination to “destroy and remove from all computers, hard drives, networks, and other storage media, any and all copies of the Products and Product data”. No clause permitting an indefinite CRM copy was found.',
    },
    access: { mode: 'none', endpoint: null, notes: 'No API key, plan or connector. Pricing is not published in a form this project has verified.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'Quoted per plan; no purchase has been made.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'A commercial contract could permit CRM use, but nothing is assumed from a public developer page. Not integrated.',
  }),
  source({
    id: 'google_places',
    name: 'Google Places API (New)',
    kind: 'places',
    status: 'blocked',
    coverage: {
      countries: ['global'],
      ghana: 'unmeasured',
      ghanaMeasured: false,
      notes: 'Strong Ghana coverage in practice, but the licence forbids the use this milestone needs.',
    },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, phone: true, email: false, operatingStatus: true, providerId: true, confidence: false },
    permissions: {
      uses: ['interactive_search'],
      retentionDays: 0,
      attribution: { required: true, text: 'Results from Google Maps', url: 'https://www.google.com/maps' },
      deletion: 'Place IDs may persist; other content may not be cached or stored except as the agreement permits.',
      notes: 'Manual, user-initiated search only. No unattended discovery, CRM storage, lead list, bulk download or contact use.',
    },
    licence: {
      name: 'Google Maps Platform Terms of Service and Places policies',
      url: 'https://developers.google.com/maps/documentation/places/web-service/policies',
      reviewedOn: '2026-10-24',
      evidence:
        'Google’s Places policy states that content “except for place IDs, cannot be cached or stored unless permitted by agreement”, and that applications must provide publicly available Terms and a Privacy Policy referencing Google’s terms. The existing integration therefore stores only the Place ID and shows everything else transiently.',
    },
    access: { mode: 'api', endpoint: 'https://places.googleapis.com/v1/', notes: 'Existing interactive connector; never called by the discovery worker.' },
    cost: { model: 'per_request', perSearchUsd: 0.035, notes: 'Existing per-request billing and daily quota; not used by autonomous discovery.' },
    limits: { maxPageSize: 20, requestsPerMinute: 60, dailyRecords: null },
    notes: 'Permanently blocked for campaigns by both application and database checks.',
  }),
  source({
    id: 'yellow_pages_ghana',
    name: 'Yellow Pages Ghana',
    kind: 'directory',
    status: 'blocked',
    coverage: {
      countries: ['GH'],
      ghana: 'national',
      ghanaMeasured: false,
      notes: 'The site advertises 35,533 businesses across every region; that is the publisher’s claim and has not been audited.',
    },
    fields: { name: true, category: true, address: true, region: true, district: false, town: true, website: true, phone: true, email: false, operatingStatus: false, providerId: false, confidence: false },
    permissions: {
      uses: [],
      retentionDays: 0,
      attribution: { required: false, text: null, url: null },
      deletion: 'No data may be copied, so there is nothing to delete.',
      notes: 'Automated collection and building a commercial database are expressly prohibited without written permission. Commercial data licensing is available on request; no agreement exists.',
    },
    licence: {
      name: 'Yellow Pages Ghana Terms of Use (24 Oct 2026)',
      url: 'https://www.yellowpages.com.gh/terms',
      reviewedOn: '2026-10-24',
      evidence:
        'The Terms prohibit using “automated tools, bots, scrapers, crawlers, or similar data-gathering methods” and “systematically download, copy, or reproduce business listings or contact information in bulk”, and prohibit using the service “to build, populate, or maintain any commercial database or directory that competes with Yellow Pages Ghana”. A separate commercial data licence is offered only by contacting the publisher.',
    },
    access: { mode: 'none', endpoint: null, notes: 'No API and no licence. Scraping is not implemented and must not be added.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'A commercial licence is quoted on request; no purchase has been made.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'Only a signed commercial data agreement could change this. Public visibility is not permission.',
  }),
  source({
    id: 'ghana_business_directory',
    name: 'Other Ghana business directories (BusinessGhana, GhanaYello)',
    kind: 'directory',
    status: 'not_integrated',
    coverage: {
      countries: ['GH'],
      ghana: 'national',
      ghanaMeasured: false,
      notes: 'Directory coverage is advertised but not measured. Terms could not be retrieved reliably for review (one returned HTTP 403), so nothing is claimed.',
    },
    fields: { name: true, category: true, address: true, region: true, district: false, town: true, website: true, phone: true, email: false, operatingStatus: false, providerId: false, confidence: false },
    permissions: {
      uses: [],
      retentionDays: 0,
      attribution: { required: false, text: null, url: null },
      deletion: 'No data is held because no reuse right has been established.',
      notes: 'No API or bulk licence has been reviewed. The default position is that directory compilations are protected and automated copying is not permitted.',
    },
    licence: {
      name: null,
      url: null,
      reviewedOn: null,
      evidence: 'Not verified: the terms pages were unavailable during review. No permission is inferred from public visibility.',
    },
    access: { mode: 'none', endpoint: null, notes: 'No connector.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'No published API pricing found.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'A written licence and a technical access method are prerequisites. Not integrated.',
  }),
  source({
    id: 'national_registry_ghana',
    name: 'Registrar-General’s Department (Ghana)',
    kind: 'registry',
    status: 'not_integrated',
    coverage: {
      countries: ['GH'],
      ghana: 'national',
      ghanaMeasured: false,
      notes: 'The official register of companies and business names. National in principle; no extract has been obtained or measured.',
    },
    fields: { name: true, category: false, address: true, region: true, district: false, town: true, website: false, phone: false, email: false, operatingStatus: true, providerId: true, confidence: false },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: false, text: null, url: null },
      deletion: 'Depends on the data-sharing agreement; no agreement exists.',
      notes: 'A public register is not a public API. A written data-sharing agreement, lawful basis and privacy assessment are required before any CRM storage.',
    },
    licence: {
      name: null,
      url: 'https://rgd.gov.gh/',
      reviewedOn: '2026-10-24',
      evidence:
        'The Department’s public site describes registration and estate services but publishes no bulk-download or public API. No extract or permission was obtained. Presence on the public site is not a reuse licence.',
    },
    access: { mode: 'none', endpoint: null, notes: 'No connector and no agreement.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'Any extract fee is unknown.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'The most authoritative source, and the slowest to activate: it needs a negotiated agreement and a lawful-basis review.',
  }),
  source({
    id: 'licensed_b2b_contacts',
    name: 'Licensed B2B contact providers (Apollo, ZoomInfo and similar)',
    kind: 'commercial_api',
    status: 'not_integrated',
    coverage: {
      countries: ['global'],
      ghana: 'unmeasured',
      ghanaMeasured: false,
      notes: 'Global vendor databases; Ghana business coverage, accuracy and freshness are not verified. These are contact-intelligence sources, not a business discovery source for this milestone.',
    },
    fields: { name: true, category: true, address: true, region: true, district: false, town: true, website: true, phone: true, email: true, operatingStatus: false, providerId: true, confidence: true },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: false, text: null, url: null },
      deletion: 'Contract-specific; personal-data deletion and opt-out obligations must be implemented before use.',
      notes: 'Contact intelligence is separate from business discovery. A contract and DPA are required; a public phone or email is never consent to market to it.',
    },
    licence: {
      name: 'Vendor terms and data-processing agreement',
      url: 'https://www.apollo.io/terms',
      reviewedOn: '2026-10-24',
      evidence:
        'Apollo’s Terms of Service (10 Aug 2026) grant use of the Services under a paid plan and place the compliance burden for personal information on the customer (Sections 6 and 12). They do not establish Ghana coverage or a marketing basis. No contract exists; nothing is integrated.',
    },
    access: { mode: 'none', endpoint: null, notes: 'No account, API key or connector.' },
    cost: { model: 'subscription', perSearchUsd: null, notes: 'Plan pricing only; no purchase has been made.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'If evaluated later, it belongs in the contact-intelligence track, behind the existing consent, suppression and outbound safeguards.',
  }),
  source({
    id: 'here_places',
    name: 'HERE Places API',
    kind: 'commercial_api',
    status: 'not_integrated',
    coverage: { countries: ['global'], ghana: 'unmeasured', ghanaMeasured: false, notes: 'Global commercial coverage; Ghana density not measured.' },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, phone: true, email: false, operatingStatus: true, providerId: true, confidence: true },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: true, text: 'HERE attribution per the applicable terms', url: 'https://legal.here.com/' },
      deletion: 'Contract-specific; no agreement exists.',
      notes: 'No use claimed. The platform terms could not be retrieved during this review (HTTP 503), so even the storage position is unverified.',
    },
    licence: { name: 'HERE Platform Terms', url: 'https://legal.here.com/en-gb/terms', reviewedOn: null, evidence: 'Not verified: the terms page returned HTTP 503 on 2026-10-24. No permission is inferred.' },
    access: { mode: 'none', endpoint: null, notes: 'No connector.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'No quote obtained.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'Not integrated. A quote, EULA and storage review are prerequisites.',
  }),
  source({
    id: 'tomtom_places',
    name: 'TomTom Search API',
    kind: 'commercial_api',
    status: 'not_integrated',
    coverage: { countries: ['global'], ghana: 'unmeasured', ghanaMeasured: false, notes: 'Global commercial coverage; Ghana density not measured.' },
    fields: { name: true, category: true, address: true, region: true, district: true, town: true, website: true, phone: true, email: false, operatingStatus: true, providerId: true, confidence: true },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: true, text: 'TomTom attribution per the applicable terms', url: 'https://www.tomtom.com/legal/' },
      deletion: 'Contract-specific; no agreement exists.',
      notes: 'No use claimed. The developer terms are rendered by script and could not be read in this review.',
    },
    licence: { name: 'TomTom Developer Terms', url: 'https://docs.tomtom.com/legal/terms-and-conditions', reviewedOn: null, evidence: 'Not verified: the page did not expose its terms text on 2026-10-24. No permission is inferred.' },
    access: { mode: 'none', endpoint: null, notes: 'No connector.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'No quote obtained.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'Not integrated.',
  }),
  source({
    id: 'licensed_directory',
    name: 'Licensed business directory (future)',
    kind: 'directory',
    status: 'not_integrated',
    coverage: { countries: ['GH'], ghana: 'unmeasured', ghanaMeasured: false, notes: 'A placeholder for a directory with a signed data licence.' },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: false, text: null, url: null },
      deletion: 'Per the future licence.',
      notes: 'No licence has been reviewed.',
    },
    licence: { name: null, url: null, reviewedOn: null, evidence: 'No licence reviewed.' },
    access: { mode: 'none', endpoint: null, notes: 'No connector.' },
    cost: { model: 'unknown', perSearchUsd: null, notes: 'Unknown.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'A licence review is what turns this placeholder into a real declaration.',
  }),
  source({
    id: 'business_submission',
    name: 'Business-submitted records (future)',
    kind: 'registry',
    status: 'not_integrated',
    coverage: { countries: ['GH'], ghana: 'national', ghanaMeasured: false, notes: 'First-party submissions; the intake form does not exist yet.' },
    permissions: {
      uses: [],
      retentionDays: null,
      attribution: { required: false, text: null, url: null },
      deletion: 'What the business submits, held under the consent it gives.',
      notes: 'No form or consent wording exists, so no data path is claimed.',
    },
    licence: { name: 'First-party submission consent', url: null, reviewedOn: null, evidence: 'The intake form and consent wording have not been built.' },
    access: { mode: 'none', endpoint: null, notes: 'No form.' },
    cost: { model: 'free', perSearchUsd: 0, notes: 'First-party.' },
    limits: { maxPageSize: 0, requestsPerMinute: 0, dailyRecords: 0 },
    notes: 'The cleanest lawful basis, but it needs a public form and a reviewed consent notice.',
  }),
];

const SOURCE_BY_ID = new Map(DISCOVERY_SOURCE_CATALOG.map((entry) => [entry.id, entry]));

export function discoverySource(id: string | null | undefined): DiscoverySourceDeclaration | null {
  return (id && SOURCE_BY_ID.get(id)) || null;
}

export function sourceAllows(sourceId: string, use: DiscoveryUse): boolean {
  return discoverySource(sourceId)?.permissions.uses.includes(use) ?? false;
}

export interface DiscoveryEnablement {
  /** The synthetic connector is enabled by server configuration. Never true for a real provider. */
  syntheticEnabled?: boolean;
}

/**
 * Why an autonomous connector may not run, or null when it may. This is the application half of the
 * permission gate; the database independently refuses Google Places as a campaign provider.
 */
export function discoverySourceBlocker(sourceId: string, options: DiscoveryEnablement = {}): string | null {
  const entry = discoverySource(sourceId);
  if (!entry) return 'Unknown discovery source.';
  if (entry.status === 'blocked') return `${entry.name} does not permit automated business discovery with CRM storage.`;
  if (entry.status === 'not_integrated') return `${entry.name} is not integrated in this version.`;
  if (entry.status === 'synthetic' && !options.syntheticEnabled) {
    return `${entry.name} is a development connector and is disabled on this deployment.`;
  }
  if (!entry.permissions.uses.includes('unattended_search')) return `${entry.name} does not permit unattended search.`;
  if (!entry.permissions.uses.includes('crm_storage')) return `${entry.name} does not permit CRM storage.`;
  return null;
}

/** Sources an autonomous campaign may select right now. */
export function campaignDiscoverySources(options: DiscoveryEnablement = {}): DiscoverySourceDeclaration[] {
  return DISCOVERY_SOURCE_CATALOG.filter((entry) => discoverySourceBlocker(entry.id, options) === null);
}

/** True when a source's declaration permits contact details in the canonical CRM. */
export function sourceStoresContactDetails(sourceId: string): boolean {
  return sourceAllows(sourceId, 'contact_storage');
}

export function discoveryRetentionDeadline(entry: DiscoverySourceDeclaration, retrievedAt: Date): string | null {
  if (entry.permissions.retentionDays == null) return null;
  return new Date(retrievedAt.getTime() + entry.permissions.retentionDays * 86_400_000).toISOString();
}

export function discoveryCostEstimate(entry: DiscoverySourceDeclaration, pages = 1): number {
  if (entry.cost.model === 'free') return 0;
  if (entry.cost.model === 'per_request') return Math.max(0, pages) * (entry.cost.perSearchUsd ?? 0);
  return 0;
}
