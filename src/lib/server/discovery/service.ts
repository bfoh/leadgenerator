import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assessDiscoveredRecord,
  canonicalDiscoveryCategory,
  decodeDiscoveryCursor,
  discoveryDedupeKey,
  discoveryRequestFingerprint,
  discoveryRequestSchema,
  DISCOVERY_REGION_NAMES,
  findDiscoveryDuplicate,
  type DiscoveredRecord,
  type DiscoveryRequest,
} from '@/lib/domain/discovery-framework';
import {
  discoveryCostEstimate,
  discoveryRetentionDeadline,
  discoverySource,
  discoverySourceBlocker,
  sourceStoresContactDetails,
  type DiscoverySourceDeclaration,
} from '@/lib/domain/discovery-sources';
import { findDistrict } from '@/lib/domain/districts';
import { serverEnv } from '../env';
import { discoveryAdapter } from './registry';
import { DiscoveryProviderError, type DiscoveryProviderAdapter } from './provider';

type Row = Record<string, unknown>;

export interface DiscoveryRunOptions {
  organizationId: string;
  campaignId: string | null;
  request: DiscoveryRequest;
  requireReview: boolean;
  qualityThreshold: number;
  spendCapUsd?: number | null;
  now?: Date;
  signal?: AbortSignal;
  /** Test seam; production resolves the adapter from the registry. */
  adapter?: DiscoveryProviderAdapter;
}

export interface DiscoveryRunResult {
  status: 'succeeded' | 'skipped' | 'failed';
  runId: string | null;
  fetched: number;
  staged: number;
  duplicates: number;
  rejected: number;
  promoted: number;
  spendUsd: number;
  nextCursor: string | null;
  note: string;
}

export interface DiscoveryRecordView {
  id: string;
  organizationId: string;
  campaignId: string | null;
  providerKey: string;
  providerRecordId: string;
  name: string;
  category: string | null;
  region: string | null;
  districtCode: string | null;
  town: string | null;
  address: string | null;
  website: string | null;
  operatingStatus: string;
  qualityScore: number;
  identityConfidence: number;
  status: 'pending_review' | 'promoted' | 'rejected';
  reviewReasons: string[];
  decisionNote: string | null;
  businessId: string | null;
  retrievedAt: string;
  retentionUntil: string;
  sourceUrl: string | null;
}

const nowIso = (date: Date) => date.toISOString();
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function sourceFor(id: string): { declaration: DiscoverySourceDeclaration; adapter: DiscoveryProviderAdapter } {
  const adapter = discoveryAdapter(id);
  const blocker = discoverySourceBlocker(id, { syntheticEnabled: serverEnv.discovery.synthetic() });
  if (blocker) throw new DiscoveryProviderError(blocker, 'forbidden');
  if (!adapter) throw new DiscoveryProviderError('No connector exists for this discovery source.', 'forbidden');
  if (!adapter.isEnabled()) throw new DiscoveryProviderError('The discovery connector is disabled on this server.', 'forbidden');
  return { declaration: adapter.declaration, adapter };
}

async function logEvent(
  sb: SupabaseClient,
  values: { organizationId: string; campaignId: string | null; runId: string | null; recordId?: string | null; event: string; detail?: string | null; actorType?: 'user' | 'agent' | 'system'; actorId?: string | null },
) {
  const { error } = await sb.from('discovery_events').insert({
    organization_id: values.organizationId,
    campaign_id: values.campaignId,
    run_id: values.runId,
    record_id: values.recordId ?? null,
    event: values.event,
    detail: values.detail ? clip(values.detail, 1000) : null,
    actor_type: values.actorType ?? 'system',
    actor_id: values.actorId ?? null,
  });
  // An audit write failure must be visible, but it must not turn a successful provider page into a
  // failure that would be retried and charge the provider twice.
  if (error) console.error('discovery_event_failed', error.code);
}

async function withinRateLimit(sb: SupabaseClient, organizationId: string, sourceId: string, requestsPerMinute: number, now: Date) {
  if (requestsPerMinute <= 0) return false;
  const since = new Date(now.getTime() - 60_000).toISOString();
  const { count, error } = await sb
    .from('discovery_runs')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('provider_key', sourceId)
    .in('status', ['running', 'succeeded', 'failed'])
    .gte('started_at', since);
  if (error) throw new DiscoveryProviderError('Could not check the discovery rate limit.', 'unavailable', true);
  return (count ?? 0) < requestsPerMinute;
}

async function dailyRecordsUsed(sb: SupabaseClient, organizationId: string, sourceId: string, now: Date) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { data, error } = await sb
    .from('discovery_runs')
    .select('records_fetched')
    .eq('organization_id', organizationId)
    .eq('provider_key', sourceId)
    .gte('started_at', since)
    .limit(1000);
  if (error) throw new DiscoveryProviderError('Could not check the discovery daily limit.', 'unavailable', true);
  return (data ?? []).reduce((sum, row) => sum + (Number(row.records_fetched) || 0), 0);
}

async function searchWithRetry(adapter: DiscoveryProviderAdapter, request: DiscoveryRequest, signal: AbortSignal) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.search(request, signal);
    } catch (error) {
      last = error;
      const retryable = error instanceof DiscoveryProviderError && error.retryable;
      if (!retryable || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw last;
}

export const DEFAULT_DISCOVERY_RETENTION_DAYS = 365;

async function campaignDiscoverySpend(sb: SupabaseClient, organizationId: string, campaignId: string) {
  const { data, error } = await sb.from('discovery_runs').select('spend_usd').eq('organization_id', organizationId).eq('campaign_id', campaignId).limit(5000);
  if (error) throw new DiscoveryProviderError('Could not check the campaign discovery spend.', 'unavailable', true);
  return (data ?? []).reduce((sum, row) => sum + (Number(row.spend_usd) || 0), 0);
}

/**
 * Fetch one provider page, stage permitted records and (only when review is explicitly off and the
 * record clears both quality bars) promote it. The caller owns campaign quotas: this function only
 * enforces the provider's own rate/daily limits, the campaign spend cap and retention.
 */
export async function runDiscoveryPage(sb: SupabaseClient, options: DiscoveryRunOptions): Promise<DiscoveryRunResult> {
  const now = options.now ?? new Date();
  const request = discoveryRequestSchema.parse(options.request);
  const { declaration, adapter } = sourceFor(request.sourceId);
  const fingerprint = discoveryRequestFingerprint(request);
  if (request.cursor && decodeDiscoveryCursor(request.cursor, fingerprint) === null) {
    throw new DiscoveryProviderError('The discovery cursor does not belong to this search.', 'invalid');
  }

  const createRun = async (status: 'running' | 'skipped' | 'failed', note: string | null, errorKind: string | null = null) => {
    const { data, error } = await sb
      .from('discovery_runs')
      .insert({
        organization_id: options.organizationId,
        campaign_id: options.campaignId,
        provider_key: request.sourceId,
        status,
        query: {
          regions: request.regions,
          districtCodes: request.districtCodes,
          towns: request.towns,
          categories: request.categories,
          pageSize: request.pageSize,
          cursor: request.cursor || null,
          minQuality: request.minQuality,
        },
        note,
        error_kind: errorKind,
        finished_at: status === 'running' ? null : nowIso(now),
      })
      .select('id')
      .single();
    if (error) throw new DiscoveryProviderError('Could not record the discovery run.', 'unavailable', true);
    return String(data.id);
  };

  if (!(await withinRateLimit(sb, options.organizationId, request.sourceId, declaration.limits.requestsPerMinute, now))) {
    const runId = await createRun('skipped', 'The provider rate limit is reached; this run will be retried on the next tick.', 'rate_limited');
    await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, event: 'quota_reached', detail: 'Provider rate limit reached.' });
    return { status: 'skipped', runId, fetched: 0, staged: 0, duplicates: 0, rejected: 0, promoted: 0, spendUsd: 0, nextCursor: request.cursor || null, note: 'The provider rate limit is reached; this run will be retried on the next tick.' };
  }

  if (declaration.limits.dailyRecords != null) {
    const used = await dailyRecordsUsed(sb, options.organizationId, request.sourceId, now);
    if (used >= declaration.limits.dailyRecords) {
      const runId = await createRun('skipped', 'The provider daily record limit is reached.', 'quota');
      await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, event: 'quota_reached', detail: 'Provider daily record limit reached.' });
      return { status: 'skipped', runId, fetched: 0, staged: 0, duplicates: 0, rejected: 0, promoted: 0, spendUsd: 0, nextCursor: request.cursor || null, note: `The provider daily limit of ${declaration.limits.dailyRecords} records is reached.` };
    }
  }

  const estimate = discoveryCostEstimate(declaration, 1);
  if (estimate > 0 && options.campaignId && options.spendCapUsd != null) {
    const spent = await campaignDiscoverySpend(sb, options.organizationId, options.campaignId);
    if (spent + estimate > options.spendCapUsd) {
      const runId = await createRun('skipped', 'The campaign discovery spend cap is reached.', 'budget');
      await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, event: 'quota_reached', detail: 'Campaign discovery spend cap reached.' });
      return { status: 'skipped', runId, fetched: 0, staged: 0, duplicates: 0, rejected: 0, promoted: 0, spendUsd: 0, nextCursor: request.cursor || null, note: 'The campaign discovery spend cap is reached.' };
    }
  }

  const runId = await createRun('running', null);
  await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, event: 'started', detail: `${declaration.name}: one page requested.` });

  let page: Awaited<ReturnType<DiscoveryProviderAdapter['search']>>;
  try {
    page = await searchWithRetry(options.adapter ?? adapter, request, options.signal ?? AbortSignal.timeout(15_000));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The discovery provider failed.';
    await sb.from('discovery_runs').update({ status: 'failed', error_kind: 'provider', note: clip(message, 1000), finished_at: nowIso(now) }).eq('id', runId);
    await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, event: 'failed', detail: message });
    return { status: 'failed', runId, fetched: 0, staged: 0, duplicates: 0, rejected: 0, promoted: 0, spendUsd: 0, nextCursor: request.cursor || null, note: message };
  }

  const [{ data: businessRows, error: businessError }, { data: recordRows, error: recordError }] = await Promise.all([
    sb
      .from('businesses')
      .select('id, name, city, district_code, official_website, phone, provider_key, provider_record_id')
      .eq('organization_id', options.organizationId)
      .limit(2000),
    sb
      .from('provider_discovery_records')
      .select('id, name, town, district_code, website, phone, provider_key, provider_record_id')
      .eq('organization_id', options.organizationId)
      .in('status', ['pending_review', 'promoted'])
      .limit(5000),
  ]);
  if (businessError || recordError) {
    await sb.from('discovery_runs').update({ status: 'failed', error_kind: 'storage', note: 'Could not load duplicate candidates.', finished_at: nowIso(now) }).eq('id', runId);
    throw new DiscoveryProviderError('Could not check for duplicates.', 'unavailable', true);
  }

  const candidates = [
    ...(businessRows ?? []).map((row) => ({
      name: String(row.name),
      town: (row.city as string | null) ?? null,
      districtCode: (row.district_code as string | null) ?? null,
      website: (row.official_website as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      providerKey: (row.provider_key as string | null) ?? null,
      providerRecordId: (row.provider_record_id as string | null) ?? null,
    })),
    ...(recordRows ?? []).map((row) => ({
      name: String(row.name),
      town: (row.town as string | null) ?? null,
      districtCode: (row.district_code as string | null) ?? null,
      website: (row.website as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      providerKey: (row.provider_key as string | null) ?? null,
      providerRecordId: (row.provider_record_id as string | null) ?? null,
    })),
  ];

  const retention = discoveryRetentionDeadline(declaration, now);
  const retentionUntil = retention ?? new Date(now.getTime() + DEFAULT_DISCOVERY_RETENTION_DAYS * 86_400_000).toISOString();
  const licenceSnapshot = {
    name: declaration.licence.name,
    url: declaration.licence.url,
    reviewedOn: declaration.licence.reviewedOn,
    attribution: declaration.permissions.attribution,
    retentionDays: declaration.permissions.retentionDays,
  };
  const storesContacts = sourceStoresContactDetails(declaration.id);
  let staged = 0;
  let duplicates = 0;
  let rejected = 0;
  let promoted = 0;

  for (const raw of page.records) {
    const district = findDistrict(raw.districtCode ?? undefined);
    const record: DiscoveredRecord = {
      ...raw,
      category: canonicalDiscoveryCategory(raw.category),
      districtCode: district?.code ?? null,
      // Keep the provider's region for assessment so a region/district disagreement is visible; the
      // district's region wins only when promotion creates the canonical business.
      region: raw.region && DISCOVERY_REGION_NAMES.includes(raw.region.trim()) ? raw.region.trim() : null,
      providerRecordId: raw.providerRecordId.slice(0, 300),
      sourceId: declaration.id,
      retrievedAt: nowIso(now),
    };
    const quality = assessDiscoveredRecord(record, { minQuality: options.qualityThreshold });
    if (!quality.accepted || quality.score < options.qualityThreshold) {
      rejected += 1;
      await logEvent(sb, {
        organizationId: options.organizationId,
        campaignId: options.campaignId,
        runId,
        event: 'record_rejected',
        detail: `${record.providerRecordId}: ${quality.issues.concat(quality.reviewReasons).join(' ') || 'below the quality threshold'}`,
      });
      continue;
    }
    const duplicate = findDiscoveryDuplicate(record, candidates);
    if (duplicate) {
      duplicates += 1;
      await logEvent(sb, {
        organizationId: options.organizationId,
        campaignId: options.campaignId,
        runId,
        event: 'duplicate_skipped',
        detail: `${record.providerRecordId}: ${duplicate.reason}`,
      });
      continue;
    }

    const { data: inserted, error } = await sb
      .from('provider_discovery_records')
      .insert({
        organization_id: options.organizationId,
        campaign_id: options.campaignId,
        provider_key: declaration.id,
        provider_record_id: record.providerRecordId,
        name: record.name.slice(0, 200),
        category: record.category ? record.category.slice(0, 80) : null,
        address: record.address ? record.address.slice(0, 300) : null,
        region: record.region,
        district_code: record.districtCode,
        town: record.town ? record.town.slice(0, 80) : null,
        website: record.website,
        phone: storesContacts ? record.phone : null,
        email: storesContacts ? record.email : null,
        operating_status: record.operatingStatus,
        provider_confidence: record.confidence,
        quality_score: quality.score,
        identity_confidence: quality.identityConfidence,
        dedupe_key: discoveryDedupeKey(record),
        status: 'pending_review',
        review_reasons: quality.reviewReasons.slice(0, 20),
        source_url: record.sourceUrl,
        licence_snapshot: licenceSnapshot,
        retrieved_at: nowIso(now),
        retention_until: retentionUntil,
      })
      .select('id')
      .single();
    if (error?.code === '23505') {
      duplicates += 1;
      continue;
    }
    if (error || !inserted) throw new DiscoveryProviderError('Could not stage a discovered record.', 'unavailable', true);
    staged += 1;
    const recordId = String(inserted.id);
    candidates.push({
      name: record.name,
      town: record.town,
      districtCode: record.districtCode,
      website: record.website,
      phone: storesContacts ? record.phone : null,
      providerKey: declaration.id,
      providerRecordId: record.providerRecordId,
    });
    await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, recordId, event: 'record_staged', detail: `${record.name} (${record.providerRecordId})` });

    if (!options.requireReview && !quality.needsReview && quality.score >= Math.max(options.qualityThreshold, 80)) {
      try {
        await promoteDiscoveredRecord(sb, {
          organizationId: options.organizationId,
          recordId,
          actorId: null,
          note: 'Auto-promoted by the campaign because review was off and the record cleared the high-confidence gate.',
        });
        promoted += 1;
      } catch {
        await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, recordId, event: 'failed', detail: 'Staged, but automatic promotion failed; left for human review.' });
      }
    }
  }

  await logEvent(sb, {
    organizationId: options.organizationId,
    campaignId: options.campaignId,
    runId,
    event: 'page_fetched',
    detail: `${page.records.length} record(s) read; ${staged} staged, ${duplicates} duplicate(s), ${rejected} rejected, ${promoted} promoted.`,
  });
  const note = `${page.records.length} record(s) read; ${staged} staged, ${duplicates} duplicate(s), ${rejected} rejected, ${promoted} promoted.`;
  await sb
    .from('discovery_runs')
    .update({
      status: 'succeeded',
      pages: 1,
      records_fetched: page.records.length,
      records_staged: staged,
      duplicates_skipped: duplicates,
      records_rejected: rejected,
      records_promoted: promoted,
      spend_usd: estimate,
      note: clip(note, 1000),
      finished_at: nowIso(now),
    })
    .eq('id', runId);
  await logEvent(sb, { organizationId: options.organizationId, campaignId: options.campaignId, runId, event: 'completed', detail: note });

  return { status: 'succeeded', runId, fetched: page.records.length, staged, duplicates, rejected, promoted, spendUsd: estimate, nextCursor: page.nextCursor, note };
}

/**
 * Promote one staged record into the canonical CRM. Only a pending record can be promoted, only a
 * source that still permits CRM storage, and contact details are never copied. The staging row keeps
 * the provider identity for duplicate detection and audit.
 */
export async function promoteDiscoveredRecord(
  sb: SupabaseClient,
  options: { organizationId: string; recordId: string; actorId: string | null; note?: string | null },
): Promise<{ businessId: string }> {
  const { data: record, error } = await sb
    .from('provider_discovery_records')
    .select('*')
    .eq('organization_id', options.organizationId)
    .eq('id', options.recordId)
    .maybeSingle();
  if (error) throw new DiscoveryProviderError('Could not load the discovered record.', 'unavailable', true);
  if (!record) throw new DiscoveryProviderError('Discovery record not found.', 'invalid');
  if (record.status === 'promoted' && record.business_id) return { businessId: String(record.business_id) };
  if (record.status !== 'pending_review') throw new DiscoveryProviderError('Only a pending discovery record can be promoted.', 'invalid');

  const declaration = discoverySource(record.provider_key as string);
  if (!declaration) throw new DiscoveryProviderError('Unknown discovery source.', 'forbidden');
  const blocker = discoverySourceBlocker(declaration.id, { syntheticEnabled: serverEnv.discovery.synthetic() });
  if (blocker) throw new DiscoveryProviderError(blocker, 'forbidden');
  if (!declaration.permissions.uses.includes('crm_storage')) {
    throw new DiscoveryProviderError(`${declaration.name} does not permit CRM storage.`, 'forbidden');
  }

  const district = findDistrict((record.district_code as string | null) ?? undefined);
  const storedRegion = (record.region as string | null)?.trim() ?? null;
  const region = district?.region ?? (storedRegion && DISCOVERY_REGION_NAMES.includes(storedRegion) ? storedRegion : null);
  const town = (record.town as string | null) ?? null;
  if (!region && !town) throw new DiscoveryProviderError('The record has no usable location.', 'invalid');

  const attribution = declaration.permissions.attribution.text;
  const note = clip(
    `Imported from ${declaration.name} record ${record.provider_record_id}.${attribution ? ` ${attribution}.` : ''} Website and contact details were not copied; verify them independently before use.`,
    10_000,
  );
  const { data: business, error: insertError } = await sb
    .from('businesses')
    .insert({
      organization_id: options.organizationId,
      name: record.name,
      category: canonicalDiscoveryCategory((record.category as string | null) ?? null),
      country: 'GH',
      region,
      district_code: district?.code ?? null,
      city: town,
      address: (record.address as string | null) ?? null,
      business_status: 'unknown',
      website_status: 'unverified',
      contact_permission: 'unknown',
      stage: 'research_candidate',
      notes: note,
      source_kind: 'provider_discovery',
      source_url: (record.source_url as string | null) ?? null,
      provider_key: record.provider_key,
      provider_record_id: record.provider_record_id,
      created_by: options.actorId,
    })
    .select('id')
    .single();

  let businessId: string;
  if (insertError?.code === '23505') {
    const { data: existing, error: existingError } = await sb
      .from('businesses')
      .select('id')
      .eq('organization_id', options.organizationId)
      .eq('provider_key', record.provider_key)
      .eq('provider_record_id', record.provider_record_id)
      .maybeSingle();
    if (existingError || !existing) throw new DiscoveryProviderError('Could not resolve the existing business for this provider record.', 'unavailable', true);
    businessId = String(existing.id);
  } else if (insertError || !business) {
    throw new DiscoveryProviderError('Could not create the business from the discovered record.', 'unavailable', true);
  } else {
    businessId = String(business.id);
  }

  const { error: updateError } = await sb
    .from('provider_discovery_records')
    .update({
      status: 'promoted',
      business_id: businessId,
      decided_by: options.actorId,
      decided_at: new Date().toISOString(),
      decision_note: clip(options.note ?? 'Promoted after review.', 1000),
    })
    .eq('organization_id', options.organizationId)
    .eq('id', options.recordId);
  if (updateError) throw new DiscoveryProviderError('The business was created but the discovery record could not be marked promoted.', 'unavailable', true);

  await logEvent(sb, {
    organizationId: options.organizationId,
    campaignId: (record.campaign_id as string | null) ?? null,
    runId: null,
    recordId: options.recordId,
    event: 'record_promoted',
    detail: `${record.name} → business ${businessId}`,
    actorType: options.actorId ? 'user' : 'system',
    actorId: options.actorId,
  });
  return { businessId };
}

/** Reject a staged record. The provider row stays for audit until retention expires. */
export async function rejectDiscoveredRecord(
  sb: SupabaseClient,
  options: { organizationId: string; recordId: string; actorId: string; note?: string | null },
): Promise<void> {
  const { data: record, error } = await sb
    .from('provider_discovery_records')
    .select('id, status, campaign_id, name')
    .eq('organization_id', options.organizationId)
    .eq('id', options.recordId)
    .maybeSingle();
  if (error) throw new DiscoveryProviderError('Could not load the discovered record.', 'unavailable', true);
  if (!record) throw new DiscoveryProviderError('Discovery record not found.', 'invalid');
  if (record.status !== 'pending_review') throw new DiscoveryProviderError('Only a pending discovery record can be rejected.', 'invalid');

  const { error: updateError } = await sb
    .from('provider_discovery_records')
    .update({
      status: 'rejected',
      decided_by: options.actorId,
      decided_at: new Date().toISOString(),
      decision_note: clip(options.note?.trim() || 'Rejected after review.', 1000),
    })
    .eq('organization_id', options.organizationId)
    .eq('id', options.recordId);
  if (updateError) throw new DiscoveryProviderError('Could not reject the discovery record.', 'unavailable', true);

  await logEvent(sb, {
    organizationId: options.organizationId,
    campaignId: (record.campaign_id as string | null) ?? null,
    runId: null,
    recordId: options.recordId,
    event: 'record_rejected',
    detail: `${record.name}: ${options.note?.trim() || 'Rejected after review.'}`,
    actorType: 'user',
    actorId: options.actorId,
  });
}

function toRecordView(row: Row): DiscoveryRecordView {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    campaignId: (row.campaign_id as string | null) ?? null,
    providerKey: String(row.provider_key),
    providerRecordId: String(row.provider_record_id),
    name: String(row.name),
    category: (row.category as string | null) ?? null,
    region: (row.region as string | null) ?? null,
    districtCode: (row.district_code as string | null) ?? null,
    town: (row.town as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    operatingStatus: String(row.operating_status),
    qualityScore: Number(row.quality_score) || 0,
    identityConfidence: Number(row.identity_confidence) || 0,
    status: row.status as DiscoveryRecordView['status'],
    reviewReasons: (row.review_reasons as string[] | null) ?? [],
    decisionNote: (row.decision_note as string | null) ?? null,
    businessId: (row.business_id as string | null) ?? null,
    retrievedAt: String(row.retrieved_at),
    retentionUntil: String(row.retention_until),
    sourceUrl: (row.source_url as string | null) ?? null,
  };
}

/** Staged records for the campaign detail or the review queue. */
export async function listDiscoveryRecords(
  sb: SupabaseClient,
  organizationId: string,
  options: { campaignId?: string | null; status?: DiscoveryRecordView['status'] | null; limit?: number } = {},
): Promise<DiscoveryRecordView[]> {
  let query = sb.from('provider_discovery_records').select('*').eq('organization_id', organizationId);
  if (options.campaignId) query = query.eq('campaign_id', options.campaignId);
  if (options.status) query = query.eq('status', options.status);
  const { data, error } = await query.order('retrieved_at', { ascending: false }).limit(Math.min(options.limit ?? 100, 500));
  if (error) throw new DiscoveryProviderError('Could not load the discovery review queue.', 'unavailable', true);
  return (data ?? []).map(toRecordView);
}

/** Deletes provider staging rows whose retention deadline has passed. */
export async function purgeExpiredDiscoveryRecords(sb: SupabaseClient, organizationId: string): Promise<number> {
  const { data, error } = await sb.rpc('purge_expired_discovery_records', { p_org: organizationId });
  if (error) return 0;
  return Number(data) || 0;
}

