import 'server-only';

import type { ContactSourceType, ContactType, ProviderLicence } from '@/lib/domain/contacts';

// Licensed contact-data providers: B2B datasets, authorised directories and approved enrichment
// services. None is connected. Each needs its actual terms reviewed by the owner (may details be
// stored, used for marketing, for how long) before it is added here, with that review recorded in
// its licence. Details a provider returns are stored only through buildContactPoint(), which refuses
// them unless the licence permits storage, and they carry the provider's identifier and licence.

export interface LicensedContactResult {
  type: Extract<ContactType, 'email' | 'phone' | 'whatsapp'>;
  value: string;
  scope: 'business' | 'person';
  personName?: string | null;
  personRole?: string | null;
  /** The provider's identifier for the record, kept as provenance. */
  providerRecordId: string;
  sourceUrl?: string | null;
}

export interface ContactDataProvider {
  /** Stored as source_provider on every contact point. */
  id: string;
  name: string;
  sourceType: Extract<ContactSourceType, 'licensed_dataset' | 'authorized_directory' | 'enrichment_provider'>;
  licence: ProviderLicence;
  isConfigured(): boolean;
  lookup(query: { name: string; city: string | null; website: string | null }, signal: AbortSignal): Promise<LicensedContactResult[]>;
  /** Mailbox deliverability, only where the provider is authorised to offer it. */
  verifyEmail?(email: string, signal: AbortSignal): Promise<'deliverable' | 'undeliverable' | 'unknown'>;
}

export const CONTACT_DATA_PROVIDERS: readonly ContactDataProvider[] = [];

export function contactProviderStatus() {
  return CONTACT_DATA_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    sourceType: p.sourceType,
    configured: p.isConfigured(),
    storagePermitted: p.licence.storagePermitted,
    marketingUsePermitted: p.licence.marketingUsePermitted,
    licenceReviewedAt: p.licence.reviewedAt,
  }));
}

export function licenceFor(providerId: string | null | undefined): ProviderLicence | null {
  return CONTACT_DATA_PROVIDERS.find((p) => p.id === providerId)?.licence ?? null;
}
