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
import { CONTACTS_MIGRATION_REQUIRED, CONVERSION_MIGRATION_REQUIRED, MESSAGING_MIGRATION_REQUIRED, RESEARCH_MIGRATION_REQUIRED, SENDING_MIGRATION_REQUIRED, StoreError, type DataStore } from './store';

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
      return new StoreError('Your role does not allow this action.', 'forbidden');
    case '23505':
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

  listBusinesses() {
    return this.all<Business>('businesses');
  }
  getBusiness(id: string) {
    return this.one<Business>('businesses', id);
  }
  createBusiness: DataStore['createBusiness'] = (input) => this.insert<Business>('businesses', input);
  updateBusiness: DataStore['updateBusiness'] = (id, patch) => this.patch<Business>('businesses', id, patch);
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
