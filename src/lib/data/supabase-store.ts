import { resourceEntrySchema, type ResourceEntry } from '@/lib/domain/business-resources';
import {
  researchObservationInsertSchema,
  socialSourceInsertSchema,
  type BusinessSocialSource,
  type ResearchObservation,
} from '@/lib/domain/social-research';
// Cloud-mode persistence through Supabase's Data API. Row Level Security is the authorization
// boundary; this class maps camelCase domain objects to snake_case columns and errors to StoreError
// messages people can act on. Every query is also scoped to the store's organization, so the class
// stays tenant-safe when the scheduled worker uses it with a server-side client.

import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { WorkflowTransition } from '@/lib/automation/types';
import type { Role } from '@/lib/domain/constants';
import type { ConsentRecord, ContactPoint, Suppression } from '@/lib/domain/contacts';
import type { ChangeRequest } from '@/lib/domain/conversion';
import { readReport } from '@/lib/domain/report';
import { resolveSettings, type OrgSettings } from '@/lib/domain/settings';
import type { MergeableField } from '@/lib/domain/identity';
import type {
  Activity,
  AuditEvent,
  AuditFinding,
  Business,
  IdentityLink,
  Invitation,
  Member,
  OpportunityReport,
  Project,
  ProjectMilestone,
  Proposal,
  ProposalVersion,
  Task,
  UsageInsert,
  UsageRecord,
  WebsiteVerification,
} from '@/lib/domain/types';
import type { EligibilityDecision, InboundInsert, InboundMessage, MessageEventPatch, MessagePolicy, MessageStatus, MessageTemplate, OutreachMessage } from '@/lib/domain/messaging';
import type { ReplyClassification } from '@/lib/domain/replies';
import type { StudioObservation, StudioProject, StudioReview } from '@/lib/domain/studio';
import type {
  StudioAsset,
  StudioAssetEvent,
  StudioAssetReference,
  StudioBrandKit,
  StudioBrandKitApproval,
  StudioBrandKitVersion,
} from '@/lib/domain/studio-assets';
import type {
  StudioCreativeBrief,
  StudioCreativeBriefReview,
  StudioCreativeDirection,
  StudioCreativeDirectionReview,
} from '@/lib/domain/creative-direction';
import type { StudioWebsitePrototype } from '@/lib/domain/website-prototype';
import { ASSET_VAULT_MIGRATION_REQUIRED, CONTACTS_MIGRATION_REQUIRED, CONVERSION_MIGRATION_REQUIRED, CREATIVE_DIRECTION_MIGRATION_REQUIRED, MESSAGING_MIGRATION_REQUIRED, RESEARCH_MIGRATION_REQUIRED, SENDING_MIGRATION_REQUIRED, SOCIAL_RESEARCH_MIGRATION_REQUIRED, STUDIO_MIGRATION_REQUIRED, WEBSITE_PROTOTYPE_MIGRATION_REQUIRED, StoreError, type DataStore } from './store';

const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Converts top-level keys only; JSON columns keep their own shape. */
export function toRow(obj: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));
}
export function fromRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && NUMERIC.has(k) ? Number(v) : v])) as T;
}
const NUMERIC = new Set(['estimated_value', 'one_time_total', 'monthly_total', 'contract_value', 'estimated_cost_usd']);

export function storeError(error: PostgrestError | null, fallback = 'The request could not be completed.'): StoreError {
  if (!error) return new StoreError(fallback);
  switch (error.code) {
    case '42501':
      // Guard triggers raise 42501 with a readable explanation; a role failure does not.
      if (/immutable|only moves forward|cannot be changed|revocation|verification status/i.test(error.message)) return new StoreError(error.message, 'invalid');
      return new StoreError('Your role does not allow this action.', 'forbidden');
    case '23505':
      if (/business_social_sources_profile_uidx/.test(error.message)) return new StoreError('This profile is already linked to a prospect.', 'conflict');
      if (/suppressions_active_idx/.test(error.message)) return new StoreError('This contact is already on the suppression list.', 'conflict');
      if (/contact_points_value_key/.test(error.message)) return new StoreError('This contact detail is already recorded for the prospect.', 'conflict');
      if (/outreach_messages_dedupe_idx/.test(error.message)) return new StoreError('The same text is already queued or sent to this recipient.', 'conflict');
      if (/message_templates_name_key/.test(error.message)) return new StoreError('A template with this name and language already exists for the channel.', 'conflict');
      return new StoreError('A matching record already exists.', 'conflict');
    case '23503':
      return new StoreError('This record is linked to other records (for example projects). Remove those first.', 'conflict');
    case '23514':
      if (/businesses_merged_archived_check/.test(error.message)) return new StoreError('A merged prospect stays archived. Undo the merge to work on it again.', 'invalid');
      if (/contact_points_provenance_check/.test(error.message)) return new StoreError('Every contact detail needs its source: a link, a provider with its licence, or a note.', 'invalid');
      if (/contact_points_source_type_check/.test(error.message)) return new StoreError('This source cannot be stored as a contact detail.', 'invalid');
      if (/consent_records_written_check/.test(error.message)) return new StoreError('Direct marketing needs prior written consent with its wording (Act 843 s.40).', 'invalid');
      // Guard triggers raise readable messages; check-constraint violations do not.
      return new StoreError(/violates/.test(error.message) ? `Some values are not allowed: ${error.message}` : error.message, 'invalid');
    case '22023':
      return new StoreError(error.message, 'invalid');
    case 'PGRST116':
    case 'P0002':
      return new StoreError(error.message && error.code === 'P0002' ? error.message : 'Record not found.', 'not_found');
    default:
      return new StoreError(error.message || fallback);
  }
}

const PAGE = 1000;
const MISSING = new Set(['42P01', 'PGRST205']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Verification columns added by migration 004. */
const VERIFICATION_004 = ['actorType', 'classification', 'confidenceScore', 'evidence', 'agentVersion', 'jobId', 'reviewStatus', 'reviewedBy', 'reviewedAt', 'reviewNote'] as const;

export class SupabaseStore implements DataStore {
  readonly mode = 'cloud' as const;

  private research: Promise<boolean> | null = null;
  private contacts: Promise<boolean> | null = null;
  private messaging: Promise<boolean> | null = null;
  private sending: Promise<boolean> | null = null;
  private conversion: Promise<boolean> | null = null;
  private studio: Promise<boolean> | null = null;
  private vault: Promise<boolean> | null = null;
  private creative: Promise<boolean> | null = null;
  private prototype: Promise<boolean> | null = null;

  constructor(
    private readonly sb: SupabaseClient,
    readonly organizationId: string,
  ) {}

  /** Whether migration 004 is applied. Probed once per store. */
  researchSchemaAvailable() {
    this.research ??= (async () => {
      const { error } = await this.sb.from('identity_links').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.research = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.research;
  }

  private async requireResearchSchema() {
    if (!(await this.researchSchemaAvailable())) throw new StoreError(RESEARCH_MIGRATION_REQUIRED, 'unavailable');
  }

  /** Whether migration 005 is applied. Probed once per store. */
  contactSchemaAvailable() {
    this.contacts ??= (async () => {
      const { error } = await this.sb.from('contact_points').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.contacts = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.contacts;
  }

  private async requireContactSchema() {
    if (!(await this.contactSchemaAvailable())) throw new StoreError(CONTACTS_MIGRATION_REQUIRED, 'unavailable');
  }

  private async all<T>(table: string, configure?: (q: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => typeof q): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.sb.from(table).select('*').eq('organization_id', this.organizationId);
      if (configure) q = configure(q);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw storeError(error);
      out.push(...(data ?? []).map((r) => fromRow<T>(r)));
      if (!data || data.length < PAGE) return out;
    }
  }

  private async one<T>(table: string, id: string): Promise<T | null> {
    const { data, error } = await this.sb.from(table).select('*').eq('organization_id', this.organizationId).eq('id', id).maybeSingle();
    if (error) throw storeError(error);
    return data ? fromRow<T>(data) : null;
  }

  private async insert<T>(table: string, values: object): Promise<T> {
    const { data, error } = await this.sb
      .from(table)
      .insert({ ...toRow(values), organization_id: this.organizationId })
      .select('*')
      .single();
    if (error) throw storeError(error);
    return fromRow<T>(data);
  }

  /** Inserts a row whose actor and timestamp columns are stamped by the database. */
  private async insertRow<T>(table: string, values: object): Promise<T> {
    const { data, error } = await this.sb
      .from(table)
      .insert({ ...toRow(values), organization_id: this.organizationId })
      .select('*')
      .single();
    if (error) throw storeError(error);
    return fromRow<T>(data);
  }

  private async patch<T>(table: string, id: string, values: object): Promise<T> {
    const { organization_id: _o, id: _i, created_at: _c, updated_at: _u, ...row } = toRow(values);
    void _o;
    void _i;
    void _c;
    void _u;
    const { data, error } = await this.sb.from(table).update(row).eq('organization_id', this.organizationId).eq('id', id).select('*').maybeSingle();
    if (error) throw storeError(error);
    if (!data) throw new StoreError('Record not found or not editable with your role.', 'forbidden');
    return fromRow<T>(data);
  }

  private async remove(table: string, id: string) {
    const { error, count } = await this.sb.from(table).delete({ count: 'exact' }).eq('organization_id', this.organizationId).eq('id', id);
    if (error) throw storeError(error);
    if (count === 0) throw new StoreError('Record not found or your role cannot delete it.', 'forbidden');
  }

  /** A region- or district-level record stores NULL for the town; the app reads it as an empty string. */
  private toBusiness(row: Record<string, unknown>): Business {
    const business = fromRow<Business>(row);
    return { ...business, city: business.city ?? '', districtCode: business.districtCode ?? null };
  }

  /** An empty town is stored as NULL (migration 010 allows it when a region or district is known). */
  private businessPatch(values: object): Record<string, unknown> {
    const row = { ...values } as Record<string, unknown>;
    if (typeof row.city === 'string') row.city = row.city.trim() || null;
    if ('districtCode' in row && (row.districtCode === '' || row.districtCode === undefined)) row.districtCode = null;
    return row;
  }

  async listBusinesses() {
    return (await this.all<Record<string, unknown>>('businesses')).map((row) => this.toBusiness(row));
  }
  async getBusiness(id: string) {
    const row = await this.one<Record<string, unknown>>('businesses', id);
    return row ? this.toBusiness(row) : null;
  }
  createBusiness: DataStore['createBusiness'] = async (input) => this.toBusiness(await this.insert<Record<string, unknown>>('businesses', this.businessPatch(input)));
  updateBusiness: DataStore['updateBusiness'] = async (id, patch) =>
    this.toBusiness(await this.patch<Record<string, unknown>>('businesses', id, this.businessPatch(patch)));
  deleteBusiness = (id: string) => this.remove('businesses', id);
  async listWorkflowTransitions(businessId?: string) {
    try {
      return await this.all<WorkflowTransition>('workflow_transitions', (q) => (businessId ? q.eq('business_id', businessId) : q).order('created_at', { ascending: false }));
    } catch (error) {
      // Databases without migration 003 have no transition log yet.
      if (error instanceof StoreError && /workflow_transitions|schema cache|does not exist/i.test(error.message)) return [];
      throw error;
    }
  }

  listVerifications(businessId?: string) {
    return this.all<WebsiteVerification>('website_verifications', (q) =>
      (businessId ? q.eq('business_id', businessId) : q).order('checked_at', { ascending: false }),
    );
  }
  createVerification: DataStore['createVerification'] = async (input) => {
    if (input.actorType === 'agent') await this.requireResearchSchema();
    else if (!(await this.researchSchemaAvailable())) {
      // A manual record on a database without migration 004: its columns do not exist yet.
      const legacy: Record<string, unknown> = { ...input };
      for (const key of VERIFICATION_004) delete legacy[key];
      return this.insert('website_verifications', legacy);
    }
    return this.insert('website_verifications', input);
  };
  updateVerification: DataStore['updateVerification'] = (id, patch) => this.patch('website_verifications', id, patch);

  async listIdentityLinks(businessId?: string) {
    if (!(await this.researchSchemaAvailable())) return [];
    if (businessId && !UUID.test(businessId)) throw new StoreError('Record not found.', 'not_found');
    return this.all<IdentityLink>('identity_links', (q) =>
      (businessId ? q.or(`business_id.eq.${businessId},other_business_id.eq.${businessId}`) : q).order('created_at', { ascending: false }),
    );
  }
  createIdentityLink: DataStore['createIdentityLink'] = async ({ decidedBy: _by, decidedAt: _at, ...input }) => {
    void _by;
    void _at;
    await this.requireResearchSchema();
    return this.insert<IdentityLink>('identity_links', input);
  };
  updateIdentityLink: DataStore['updateIdentityLink'] = (id, patch) => this.patch<IdentityLink>('identity_links', id, patch);

  async mergeBusinesses(primaryId: string, secondaryId: string, fields: MergeableField[], note: string | null) {
    await this.requireResearchSchema();
    const { error } = await this.sb.rpc('merge_businesses', { p_primary: primaryId, p_secondary: secondaryId, p_fields: fields.map((f) => f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)), p_note: note });
    if (error) throw storeError(error);
    const [primary, secondary] = await Promise.all([this.getBusiness(primaryId), this.getBusiness(secondaryId)]);
    if (!primary || !secondary) throw new StoreError('Record not found.', 'not_found');
    return { primary, secondary };
  }
  async undoMerge(secondaryId: string) {
    await this.requireResearchSchema();
    const { error } = await this.sb.rpc('undo_business_merge', { p_secondary: secondaryId });
    if (error) throw storeError(error);
    const restored = await this.getBusiness(secondaryId);
    if (!restored) throw new StoreError('Record not found.', 'not_found');
    return restored;
  }

  async listAuditFindings(businessId?: string) {
    if (!(await this.researchSchemaAvailable())) return [];
    return this.all<AuditFinding>('audit_findings', (q) => (businessId ? q.eq('business_id', businessId) : q).order('created_at', { ascending: false }));
  }
  async createAuditFindings(input: Parameters<DataStore['createAuditFindings']>[0]) {
    if (!input.length) return [];
    await this.requireResearchSchema();
    const { data, error } = await this.sb
      .from('audit_findings')
      .insert(input.map((f) => ({ ...toRow(f), organization_id: this.organizationId })))
      .select('*');
    if (error) throw storeError(error);
    return (data ?? []).map((r) => fromRow<AuditFinding>(r));
  }
  updateAuditFinding: DataStore['updateAuditFinding'] = (id, patch) => this.patch<AuditFinding>('audit_findings', id, patch);

  async listContactPoints(businessId?: string) {
    if (!(await this.contactSchemaAvailable())) return [];
    return this.all<ContactPoint>('contact_points', (q) => (businessId ? q.eq('business_id', businessId) : q).order('created_at', { ascending: true }));
  }
  async createContactPoints(input: Parameters<DataStore['createContactPoints']>[0]) {
    if (!input.length) return [];
    await this.requireContactSchema();
    const { data, error } = await this.sb
      .from('contact_points')
      .insert(input.map(({ acquiredBy: _by, ...p }) => (void _by, { ...toRow(p), organization_id: this.organizationId })))
      .select('*');
    if (error) throw storeError(error);
    return (data ?? []).map((r) => fromRow<ContactPoint>(r));
  }
  updateContactPoint: DataStore['updateContactPoint'] = (id, patch) => this.patch<ContactPoint>('contact_points', id, patch);
  async deleteContactPoints(ids: string[]) {
    if (!ids.length) return;
    if (ids.some((id) => !UUID.test(id))) throw new StoreError('Record not found.', 'not_found');
    const { error, count } = await this.sb.from('contact_points').delete({ count: 'exact' }).eq('organization_id', this.organizationId).in('id', ids);
    if (error) throw storeError(error);
    if (count !== ids.length) throw new StoreError('Some contact details were not deleted; your role may not allow it.', 'forbidden');
  }
  async listConsentRecords(businessId?: string) {
    if (!(await this.contactSchemaAvailable())) return [];
    return this.all<ConsentRecord>('consent_records', (q) => (businessId ? q.eq('business_id', businessId) : q).order('captured_at', { ascending: false }).order('created_at', { ascending: false }));
  }
  createConsentRecord: DataStore['createConsentRecord'] = async (input) => {
    await this.requireContactSchema();
    return this.insert<ConsentRecord>('consent_records', input);
  };
  async listSuppressions() {
    if (!(await this.contactSchemaAvailable())) return [];
    return this.all<Suppression>('suppressions', (q) => q.order('created_at', { ascending: false }));
  }
  createSuppression: DataStore['createSuppression'] = async (input) => {
    await this.requireContactSchema();
    return this.insert<Suppression>('suppressions', input);
  };
  liftSuppression: DataStore['liftSuppression'] = async (id, lift) => {
    await this.requireContactSchema();
    // The database stamps who lifted it and when, and checks the consent record covers it.
    return this.patch<Suppression>('suppressions', id, { liftReason: lift.reason.trim(), liftConsentId: lift.consentId });
  };

  /** Whether migration 006 is applied. Probed once per store. */
  messagingSchemaAvailable() {
    this.messaging ??= (async () => {
      const { error } = await this.sb.from('outreach_messages').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.messaging = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.messaging;
  }

  private async requireMessagingSchema() {
    if (!(await this.messagingSchemaAvailable())) throw new StoreError(MESSAGING_MIGRATION_REQUIRED, 'unavailable');
  }

  async listTemplates() {
    if (!(await this.messagingSchemaAvailable())) return [];
    return this.all<MessageTemplate>('message_templates', (q) => q.order('channel').order('name'));
  }
  createTemplate: DataStore['createTemplate'] = async (input) => {
    await this.requireMessagingSchema();
    return this.insert<MessageTemplate>('message_templates', input);
  };
  updateTemplate: DataStore['updateTemplate'] = (id, patch) => this.patch<MessageTemplate>('message_templates', id, patch);
  deleteTemplate = (id: string) => this.remove('message_templates', id);

  async listOutreachMessages(businessId?: string) {
    if (!(await this.messagingSchemaAvailable())) return [];
    return this.all<OutreachMessage>('outreach_messages', (q) => (businessId ? q.eq('business_id', businessId) : q).order('created_at', { ascending: false }));
  }
  async getOutreachMessage(id: string) {
    if (!UUID.test(id) || !(await this.messagingSchemaAvailable())) return null;
    return this.one<OutreachMessage>('outreach_messages', id);
  }
  createOutreachMessage: DataStore['createOutreachMessage'] = async (input) => {
    await this.requireMessagingSchema();
    // The database computes body_hash and stamps the author.
    return this.insert<OutreachMessage>('outreach_messages', input);
  };
  updateOutreachMessage: DataStore['updateOutreachMessage'] = (id, patch) => this.patch<OutreachMessage>('outreach_messages', id, patch);
  async recordMessageEvent(id: string, patch: MessageEventPatch, expectedStatus?: MessageStatus) {
    await this.requireMessagingSchema();
    let q = this.sb.from('outreach_messages').update(toRow(patch)).eq('organization_id', this.organizationId).eq('id', id);
    if (expectedStatus) q = q.eq('status', expectedStatus);
    const { data, error } = await q.select('*').maybeSingle();
    if (error) throw storeError(error);
    return data ? fromRow<OutreachMessage>(data) : null;
  }
  deleteOutreachMessage = (id: string) => this.remove('outreach_messages', id);

  async listDecisions(messageId?: string) {
    if (!(await this.messagingSchemaAvailable())) return [];
    if (messageId && !UUID.test(messageId)) return [];
    return this.all<EligibilityDecision>('eligibility_decisions', (q) => (messageId ? q.eq('message_id', messageId) : q).order('created_at', { ascending: false }));
  }
  createDecision: DataStore['createDecision'] = async (input) => {
    await this.requireMessagingSchema();
    return this.insert<EligibilityDecision>('eligibility_decisions', input);
  };

  /** Whether migration 007 is applied. Probed once per store. */
  sendingSchemaAvailable() {
    this.sending ??= (async () => {
      const { error } = await this.sb.from('message_policies').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.sending = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.sending;
  }
  private async requireSendingSchema() {
    if (!(await this.sendingSchemaAvailable())) throw new StoreError(SENDING_MIGRATION_REQUIRED, 'unavailable');
  }
  // Without migration 007 there are no policies, so nothing is covered: the gateway blocks approval
  // and says why. The database stamps approver, version, channel and purpose from the template.
  async listMessagePolicies() {
    if (!(await this.sendingSchemaAvailable())) return [];
    return this.all<MessagePolicy>('message_policies', (q) => q.order('created_at', { ascending: false }));
  }
  createMessagePolicy: DataStore['createMessagePolicy'] = async (input) => {
    await this.requireSendingSchema();
    return this.insert<MessagePolicy>('message_policies', input);
  };
  updateMessagePolicy: DataStore['updateMessagePolicy'] = (id, patch) => this.patch<MessagePolicy>('message_policies', id, patch);
  async listAuditTrail(tables: string[], limit = 200) {
    const { data, error } = await this.sb
      .from('audit_events')
      .select('*')
      .eq('organization_id', this.organizationId)
      .in('table_name', tables)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw storeError(error);
    return (data ?? []).map((r) => fromRow<AuditEvent>(r));
  }

  /** Whether migration 008 is applied. Probed once per store. */
  conversionSchemaAvailable() {
    this.conversion ??= (async () => {
      const { error } = await this.sb.from('reply_classifications').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.conversion = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.conversion;
  }
  private async requireConversionSchema() {
    if (!(await this.conversionSchemaAvailable())) throw new StoreError(CONVERSION_MIGRATION_REQUIRED, 'unavailable');
  }
  async listReplyClassifications(inboundMessageIds?: readonly string[]) {
    if (!(await this.conversionSchemaAvailable()) || inboundMessageIds?.length === 0) return [];
    return this.all<ReplyClassification>('reply_classifications', (q) => (inboundMessageIds ? q.in('inbound_message_id', [...inboundMessageIds]) : q).order('created_at', { ascending: false }));
  }
  // The database stamps the actor and refuses to reclassify an opt-out.
  createReplyClassification: DataStore['createReplyClassification'] = async (input) => {
    await this.requireConversionSchema();
    return this.insert<ReplyClassification>('reply_classifications', input);
  };
  async listChangeRequests(businessId?: string) {
    if (!(await this.conversionSchemaAvailable())) return [];
    return this.all<ChangeRequest>('proposal_change_requests', (q) => (businessId ? q.eq('business_id', businessId) : q).order('created_at', { ascending: false }));
  }
  createChangeRequest: DataStore['createChangeRequest'] = async (input) => {
    await this.requireConversionSchema();
    return this.insert<ChangeRequest>('proposal_change_requests', input);
  };
  updateChangeRequest: DataStore['updateChangeRequest'] = (id, patch) => this.patch<ChangeRequest>('proposal_change_requests', id, patch);

  /** Whether migration 012 is applied. Probed once per store. */
  studioSchemaAvailable() {
    this.studio ??= (async () => {
      const { error } = await this.sb.from('studio_projects').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.studio = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.studio;
  }
  private async requireStudioSchema() {
    if (!(await this.studioSchemaAvailable())) throw new StoreError(STUDIO_MIGRATION_REQUIRED, 'unavailable');
  }
  async resourceCollectorAvailable() {
    const { error } = await this.sb.from('business_resource_entries').select('id', { head: true }).eq('organization_id', this.organizationId).limit(1);
    if (error && MISSING.has(error.code)) return false;
    if (error) throw storeError(error);
    return true;
  }
  async listResourceEntries(businessId: string) {
    if (!(await this.resourceCollectorAvailable())) return [];
    return this.all<ResourceEntry>('business_resource_entries', (q) => q.eq('business_id', businessId).order('created_at'));
  }
  createResourceEntry: DataStore['createResourceEntry'] = async (input) => {
    if (!(await this.resourceCollectorAvailable())) throw new StoreError('Resource entries require migration 016. Google viewing and the existing vault remain available.', 'unavailable');
    return this.insert<ResourceEntry>('business_resource_entries', resourceEntrySchema.parse(input));
  };
  revokeResourceEntry: DataStore['revokeResourceEntry'] = async (id) => this.patch<ResourceEntry>('business_resource_entries', id, { revokedAt: new Date().toISOString() });

  async socialResearchAvailable() {
    const { error } = await this.sb.from('business_social_sources').select('id', { head: true }).eq('organization_id', this.organizationId).limit(1);
    if (error && MISSING.has(error.code)) return false;
    if (error) throw storeError(error);
    return true;
  }
  async listSocialSources(businessId?: string) {
    if (!(await this.socialResearchAvailable())) return [];
    return this.all<BusinessSocialSource>('business_social_sources', (q) =>
      (businessId ? q.eq('business_id', businessId) : q).order('captured_at', { ascending: false }),
    );
  }
  createSocialSource: DataStore['createSocialSource'] = async (input) => {
    if (!(await this.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
    return this.insert<BusinessSocialSource>('business_social_sources', socialSourceInsertSchema.parse(input));
  };
  updateSocialSourceVerification: DataStore['updateSocialSourceVerification'] = async (id, patch) => {
    if (!(await this.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
    return this.patch<BusinessSocialSource>('business_social_sources', id, patch);
  };
  revokeSocialSource: DataStore['revokeSocialSource'] = async (id) => {
    if (!(await this.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
    return this.patch<BusinessSocialSource>('business_social_sources', id, { revokedAt: new Date().toISOString() });
  };
  async listResearchObservations(businessId?: string) {
    if (!(await this.socialResearchAvailable())) return [];
    return this.all<ResearchObservation>('business_research_observations', (q) =>
      (businessId ? q.eq('business_id', businessId) : q).order('captured_at', { ascending: false }),
    );
  }
  createResearchObservation: DataStore['createResearchObservation'] = async (input) => {
    if (!(await this.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
    return this.insert<ResearchObservation>('business_research_observations', researchObservationInsertSchema.parse(input));
  };
  revokeResearchObservation: DataStore['revokeResearchObservation'] = async (id) => {
    if (!(await this.socialResearchAvailable())) throw new StoreError(SOCIAL_RESEARCH_MIGRATION_REQUIRED, 'unavailable');
    return this.patch<ResearchObservation>('business_research_observations', id, { revokedAt: new Date().toISOString() });
  };

  async listStudioProjects(businessId?: string) {
    if (!(await this.studioSchemaAvailable())) return [];
    return this.all<StudioProject>('studio_projects', (q) => (businessId ? q.eq('business_id', businessId) : q).order('updated_at', { ascending: false }));
  }
  async getStudioProject(id: string) {
    if (!UUID.test(id) || !(await this.studioSchemaAvailable())) return null;
    return this.one<StudioProject>('studio_projects', id);
  }
  // studio_projects_business_uidx enforces one live concept per business; the run marker is stamped
  // by studio_project_analysis_stamped when an analysis has actually run.
  createStudioProject: DataStore['createStudioProject'] = async (input) => {
    await this.requireStudioSchema();
    return this.insert<StudioProject>('studio_projects', input);
  };
  updateStudioProject: DataStore['updateStudioProject'] = async (id, patch) => {
    await this.requireStudioSchema();
    return this.patch<StudioProject>('studio_projects', id, patch);
  };
  // The append-only guards in migration 012 let the database decide; a rejected delete is a 403.
  deleteStudioProject: DataStore['deleteStudioProject'] = async (id) => {
    await this.requireStudioSchema();
    await this.remove('studio_projects', id);
  };
  async listStudioObservations(projectId?: string) {
    if (!(await this.studioSchemaAvailable())) return [];
    return this.all<StudioObservation>('studio_observations', (q) =>
      (projectId ? q.eq('project_id', projectId) : q).order('run_number', { ascending: false }).order('key', { ascending: true }),
    );
  }
  // Evidence is append-only: one insert per analysis, and the same key may not repeat within a run.
  createStudioObservations: DataStore['createStudioObservations'] = async (input) => {
    if (!input.length) return [];
    await this.requireStudioSchema();
    const { data, error } = await this.sb
      .from('studio_observations')
      .insert(input.map((row) => ({ ...toRow(row), organization_id: this.organizationId })))
      .select('*');
    if (error) throw storeError(error);
    return (data ?? []).map((row) => fromRow<StudioObservation>(row));
  };
  async listStudioReviews(projectId?: string) {
    if (!(await this.studioSchemaAvailable())) return [];
    return this.all<StudioReview>('studio_reviews', (q) => (projectId ? q.eq('project_id', projectId) : q).order('created_at', { ascending: false }));
  }
  // The reviewer is stamped from the session, and the database requires a reason unless confirming.
  createStudioReview: DataStore['createStudioReview'] = async (input) => {
    await this.requireStudioSchema();
    return this.insert<StudioReview>('studio_reviews', input);
  };

  // ── Asset vault and Brand Kit (migration 013) ──
  /** Whether migration 013 is applied. Probed once per store. */
  assetVaultAvailable() {
    this.vault ??= (async () => {
      const { error } = await this.sb.from('studio_assets').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.vault = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.vault;
  }
  private async requireAssetVault() {
    if (!(await this.assetVaultAvailable())) throw new StoreError(ASSET_VAULT_MIGRATION_REQUIRED, 'unavailable');
  }
  async listStudioAssets(projectId?: string) {
    if (!(await this.assetVaultAvailable())) return [];
    return this.all<StudioAsset>('studio_assets', (q) => (projectId ? q.eq('project_id', projectId) : q).order('created_at', { ascending: false }));
  }
  async getStudioAsset(id: string) {
    if (!UUID.test(id) || !(await this.assetVaultAvailable())) return null;
    return this.one<StudioAsset>('studio_assets', id);
  }
  createStudioAsset: DataStore['createStudioAsset'] = async (input) => {
    await this.requireAssetVault();
    return this.insert<StudioAsset>('studio_assets', input);
  };
  updateStudioAsset: DataStore['updateStudioAsset'] = async (id, patch) => {
    await this.requireAssetVault();
    return this.patch<StudioAsset>('studio_assets', id, patch);
  };
  deleteStudioAsset: DataStore['deleteStudioAsset'] = async (id) => {
    await this.requireAssetVault();
    await this.remove('studio_assets', id);
  };
  async listStudioAssetEvents(projectId?: string) {
    if (!(await this.assetVaultAvailable())) return [];
    return this.all<StudioAssetEvent>('studio_asset_events', (q) => (projectId ? q.eq('project_id', projectId) : q).order('created_at', { ascending: false }));
  }
  createStudioAssetEvent: DataStore['createStudioAssetEvent'] = async (input) => {
    await this.requireAssetVault();
    return this.insertRow<StudioAssetEvent>('studio_asset_events', input);
  };
  async listStudioAssetReferences(projectId?: string) {
    if (!(await this.assetVaultAvailable())) return [];
    return this.all<StudioAssetReference>('studio_asset_references', (q) => (projectId ? q.eq('project_id', projectId) : q).order('created_at', { ascending: false }));
  }
  createStudioAssetReference: DataStore['createStudioAssetReference'] = async (input) => {
    await this.requireAssetVault();
    return this.insertRow<StudioAssetReference>('studio_asset_references', input);
  };
  updateStudioAssetReference: DataStore['updateStudioAssetReference'] = async (id, patch) => {
    await this.requireAssetVault();
    return this.patch<StudioAssetReference>('studio_asset_references', id, patch);
  };
  deleteStudioAssetReference: DataStore['deleteStudioAssetReference'] = async (id) => {
    await this.requireAssetVault();
    await this.remove('studio_asset_references', id);
  };
  async getStudioBrandKit(projectId: string) {
    if (!UUID.test(projectId) || !(await this.assetVaultAvailable())) return null;
    const { data, error } = await this.sb.from('studio_brand_kits').select('*').eq('organization_id', this.organizationId).eq('project_id', projectId).maybeSingle();
    if (error) throw storeError(error);
    return data ? fromRow<StudioBrandKit>(data) : null;
  }
  createStudioBrandKit: DataStore['createStudioBrandKit'] = async (projectId) => {
    await this.requireAssetVault();
    return this.insertRow<StudioBrandKit>('studio_brand_kits', { projectId });
  };
  async listStudioBrandKitVersions(kitId: string) {
    if (!UUID.test(kitId) || !(await this.assetVaultAvailable())) return [];
    return this.all<StudioBrandKitVersion>('studio_brand_kit_versions', (q) => q.eq('kit_id', kitId).order('version', { ascending: false }));
  }
  createStudioBrandKitVersion: DataStore['createStudioBrandKitVersion'] = async (input) => {
    await this.requireAssetVault();
    return this.insertRow<StudioBrandKitVersion>('studio_brand_kit_versions', input);
  };
  async listStudioBrandKitApprovals(kitId: string) {
    if (!UUID.test(kitId) || !(await this.assetVaultAvailable())) return [];
    return this.all<StudioBrandKitApproval>('studio_brand_kit_approvals', (q) => q.eq('kit_id', kitId).order('approved_at', { ascending: false }));
  }
  createStudioBrandKitApproval: DataStore['createStudioBrandKitApproval'] = async (input) => {
    await this.requireAssetVault();
    return this.insertRow<StudioBrandKitApproval>('studio_brand_kit_approvals', input);
  };

  // ── Creative direction (migration 014) ──
  /** Whether migration 014 is applied. Probed once per store. */
  creativeDirectionSchemaAvailable() {
    this.creative ??= (async () => {
      const { error } = await this.sb.from('studio_creative_briefs').select('id', { head: true, count: 'exact' }).eq('organization_id', this.organizationId).limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.creative = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.creative;
  }
  private async requireCreativeDirection() {
    if (!(await this.creativeDirectionSchemaAvailable())) throw new StoreError(CREATIVE_DIRECTION_MIGRATION_REQUIRED, 'unavailable');
  }
  async listStudioCreativeBriefs(projectId?: string) {
    if (!(await this.creativeDirectionSchemaAvailable())) return [];
    return this.all<StudioCreativeBrief>('studio_creative_briefs', (q) => (projectId ? q.eq('project_id', projectId) : q).order('version', { ascending: false }));
  }
  async getStudioCreativeBrief(id: string) {
    if (!UUID.test(id) || !(await this.creativeDirectionSchemaAvailable())) return null;
    return this.one<StudioCreativeBrief>('studio_creative_briefs', id);
  }
  createStudioCreativeBrief: DataStore['createStudioCreativeBrief'] = async (input) => {
    await this.requireCreativeDirection();
    return this.insertRow<StudioCreativeBrief>('studio_creative_briefs', input);
  };
  async listStudioCreativeBriefReviews(projectId?: string) {
    if (!(await this.creativeDirectionSchemaAvailable())) return [];
    return this.all<StudioCreativeBriefReview>('studio_creative_brief_reviews', (q) => (projectId ? q.eq('project_id', projectId) : q).order('created_at', { ascending: false }));
  }
  createStudioCreativeBriefReview: DataStore['createStudioCreativeBriefReview'] = async (input) => {
    await this.requireCreativeDirection();
    return this.insertRow<StudioCreativeBriefReview>('studio_creative_brief_reviews', input);
  };
  async listStudioCreativeDirections(projectId?: string) {
    if (!(await this.creativeDirectionSchemaAvailable())) return [];
    return this.all<StudioCreativeDirection>('studio_creative_directions', (q) => (projectId ? q.eq('project_id', projectId) : q).order('version', { ascending: false }));
  }
  async getStudioCreativeDirection(id: string) {
    if (!UUID.test(id) || !(await this.creativeDirectionSchemaAvailable())) return null;
    return this.one<StudioCreativeDirection>('studio_creative_directions', id);
  }
  createStudioCreativeDirection: DataStore['createStudioCreativeDirection'] = async (input) => {
    await this.requireCreativeDirection();
    return this.insertRow<StudioCreativeDirection>('studio_creative_directions', input);
  };
  async listStudioCreativeDirectionReviews(projectId?: string) {
    if (!(await this.creativeDirectionSchemaAvailable())) return [];
    return this.all<StudioCreativeDirectionReview>('studio_creative_direction_reviews', (q) => (projectId ? q.eq('project_id', projectId) : q).order('created_at', { ascending: false }));
  }
  createStudioCreativeDirectionReview: DataStore['createStudioCreativeDirectionReview'] = async (input) => {
    await this.requireCreativeDirection();
    return this.insertRow<StudioCreativeDirectionReview>('studio_creative_direction_reviews', input);
  };

  // ── Rendered website prototypes (migration 015) ──
  /** Whether migration 015 is applied. Probed once per store. */
  websitePrototypeSchemaAvailable() {
    this.prototype ??= (async () => {
      const { error } = await this.sb
        .from('studio_website_prototypes')
        .select('id', { head: true, count: 'exact' })
        .eq('organization_id', this.organizationId)
        .limit(1);
      if (error && MISSING.has(error.code)) return false;
      if (error) {
        this.prototype = null;
        throw storeError(error);
      }
      return true;
    })();
    return this.prototype;
  }
  private async requireWebsitePrototypeSchema() {
    if (!(await this.websitePrototypeSchemaAvailable())) throw new StoreError(WEBSITE_PROTOTYPE_MIGRATION_REQUIRED, 'unavailable');
  }
  async listStudioWebsitePrototypes(projectId?: string) {
    if (!(await this.websitePrototypeSchemaAvailable())) return [];
    return this.all<StudioWebsitePrototype>('studio_website_prototypes', (q) =>
      (projectId ? q.eq('project_id', projectId) : q).order('version', { ascending: false }),
    );
  }
  createStudioWebsitePrototype: DataStore['createStudioWebsitePrototype'] = async (input) => {
    await this.requireWebsitePrototypeSchema();
    return this.insertRow<StudioWebsitePrototype>('studio_website_prototypes', input);
  };


  async listInboundMessages(businessId?: string) {
    if (!(await this.messagingSchemaAvailable())) return [];
    return this.all<InboundMessage>('inbound_messages', (q) => (businessId ? q.eq('business_id', businessId) : q).order('received_at', { ascending: false }));
  }
  async createInboundMessage(input: InboundInsert) {
    await this.requireMessagingSchema();
    const { data, error } = await this.sb
      .from('inbound_messages')
      .upsert({ ...toRow(input), organization_id: this.organizationId }, { onConflict: 'organization_id,provider,provider_message_id', ignoreDuplicates: true })
      .select('*');
    if (error) throw storeError(error);
    if (data?.length) return { message: fromRow<InboundMessage>(data[0]), created: true };
    const { data: existing, error: readError } = await this.sb
      .from('inbound_messages')
      .select('*')
      .eq('organization_id', this.organizationId)
      .eq('provider', input.provider)
      .eq('provider_message_id', input.providerMessageId)
      .maybeSingle();
    if (readError || !existing) throw storeError(readError, 'The message could not be recorded.');
    return { message: fromRow<InboundMessage>(existing), created: false };
  }
  updateInboundMessage: DataStore['updateInboundMessage'] = (id, patch) => this.patch<InboundMessage>('inbound_messages', id, patch);

  listActivities(businessId?: string) {
    return this.all<Activity>('activities', (q) => (businessId ? q.eq('business_id', businessId) : q).order('occurred_at', { ascending: false }));
  }
  createActivity: DataStore['createActivity'] = ({ actorId: _actor, ...input }) => {
    void _actor;
    return this.insert('activities', input);
  };

  listTasks() {
    return this.all<Task>('tasks');
  }
  createTask: DataStore['createTask'] = (input) => this.insert('tasks', input);
  updateTask: DataStore['updateTask'] = (id, patch) => this.patch('tasks', id, patch);
  deleteTask = (id: string) => this.remove('tasks', id);

  async listReports(businessId?: string) {
    const rows = await this.all<OpportunityReport>('opportunity_reports', (q) => (businessId ? q.eq('business_id', businessId) : q).order('version', { ascending: false }));
    return rows.map(readReport);
  }
  // version is assigned by the next_report_version trigger.
  createReport: DataStore['createReport'] = (input) => this.insert('opportunity_reports', { ...input, version: 0 });

  listProposals() {
    return this.all<Proposal>('proposals');
  }
  getProposal(id: string) {
    return this.one<Proposal>('proposals', id);
  }
  createProposal: DataStore['createProposal'] = (input) => this.insert('proposals', input);
  updateProposal: DataStore['updateProposal'] = (id, patch) => this.patch('proposals', id, patch);
  deleteProposal = (id: string) => this.remove('proposals', id);
  listProposalVersions(proposalId: string) {
    return this.all<ProposalVersion>('proposal_versions', (q) => q.eq('proposal_id', proposalId).order('version', { ascending: false }));
  }

  listProjects() {
    return this.all<Project>('projects');
  }
  createProject: DataStore['createProject'] = (input) => this.insert('projects', input);
  updateProject: DataStore['updateProject'] = (id, patch) => this.patch('projects', id, patch);
  listMilestones(projectId?: string) {
    return this.all<ProjectMilestone>('project_milestones', (q) => (projectId ? q.eq('project_id', projectId) : q).order('sort_order'));
  }
  createMilestone: DataStore['createMilestone'] = (input) => this.insert('project_milestones', input);
  updateMilestone: DataStore['updateMilestone'] = (id, patch) => this.patch('project_milestones', id, patch);
  deleteMilestone = (id: string) => this.remove('project_milestones', id);

  async getSettings(): Promise<OrgSettings> {
    const { data, error } = await this.sb.from('organizations').select('settings').eq('id', this.organizationId).single();
    if (error) throw storeError(error);
    return resolveSettings(data.settings);
  }
  async updateSettings(settings: OrgSettings, organizationName?: string) {
    const clean = resolveSettings(settings);
    const values: Record<string, unknown> = { settings: clean };
    if (organizationName?.trim()) values.name = organizationName.trim();
    const { error, count } = await this.sb.from('organizations').update(values, { count: 'exact' }).eq('id', this.organizationId);
    if (error) throw storeError(error);
    if (count === 0) throw new StoreError('Only owners and administrators can change settings.', 'forbidden');
    return clean;
  }

  listAuditEvents(recordId: string) {
    return this.all<AuditEvent>('audit_events', (q) => q.eq('record_id', recordId).order('created_at', { ascending: false }));
  }
  listUsage(sinceIso: string) {
    return this.all<UsageRecord>('usage_records', (q) => q.gte('created_at', sinceIso));
  }
  async recordUsage(usage: UsageInsert) {
    const { data } = await this.sb.auth.getUser();
    if (!data.user) throw new StoreError('Sign in again to continue.', 'forbidden');
    const { error } = await this.sb.from('usage_records').insert({ ...toRow(usage), organization_id: this.organizationId, user_id: data.user.id });
    if (error) throw storeError(error);
  }

  async listMembers(): Promise<Member[]> {
    const { data, error } = await this.sb.rpc('list_organization_members', { org: this.organizationId });
    if (error) throw storeError(error);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Member>(r));
  }
  listInvitations() {
    return this.all<Invitation>('organization_invitations', (q) => q.is('accepted_at', null));
  }
  createInvitation(email: string, role: Role) {
    return this.insert<Invitation>('organization_invitations', { email: email.trim().toLowerCase(), role });
  }
  deleteInvitation = (id: string) => this.remove('organization_invitations', id);
  async updateMemberRole(userId: string, role: Role) {
    const { error, count } = await this.sb
      .from('organization_members')
      .update({ role }, { count: 'exact' })
      .eq('organization_id', this.organizationId)
      .eq('user_id', userId);
    if (error) throw storeError(error);
    if (count === 0) throw new StoreError('Your role cannot change this member.', 'forbidden');
  }
  async removeMember(userId: string) {
    const { error, count } = await this.sb
      .from('organization_members')
      .delete({ count: 'exact' })
      .eq('organization_id', this.organizationId)
      .eq('user_id', userId);
    if (error) throw storeError(error);
    if (count === 0) throw new StoreError('Your role cannot remove this member.', 'forbidden');
  }
}
