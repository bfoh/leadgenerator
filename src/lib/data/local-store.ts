// Demo-mode persistence in browser storage. Emulates the database behaviours that matter to the
// workflow (audit trail, proposal locking and versioning, report versioning, cascades) so demo and
// cloud mode behave the same.

import seed from '@/data/research.json';
import { AUTOMATION_KEY, forgetBusinessAutomation } from '@/lib/automation/local-keys';
import type { WorkflowTransition } from '@/lib/automation/types';
import { workflowAfterChange, workflowStateOf } from '@/lib/automation/workflow';
import {
  CONTACT_MUTABLE_FIELDS,
  CONTACT_SOURCE_TYPES,
  type ConsentRecord,
  type ContactPoint,
  type Suppression,
  type SuppressionInsert,
  WRITTEN_CAPTURE,
  sha256Hex,
} from '@/lib/domain/contacts';
import {
  DEDUPE_RESERVED,
  bodyHashInput,
  dedupeKeyInput,
  type EligibilityDecision,
  type InboundMessage,
  type MessagePolicy,
  type MessageTemplate,
  type OutreachMessage,
  POLICY_DAILY_CAP_MAX,
  POLICY_MAX_DAYS,
  policyTemplateIssues,
} from '@/lib/domain/messaging';
import { CHANGE_KINDS, acceptanceBlockers, type ChangeRequest } from '@/lib/domain/conversion';
import { MERGEABLE_FIELDS, mergedPermission, type MergeableField } from '@/lib/domain/identity';
import { mapLegacyLead, type LegacyLead } from '@/lib/domain/legacy';
import { REPLY_INTENTS, type ReplyClassification } from '@/lib/domain/replies';
import { readReport } from '@/lib/domain/report';
import { scoreFields } from '@/lib/domain/rescore';
import { DEFAULT_SETTINGS, resolveSettings, type OrgSettings } from '@/lib/domain/settings';
import {
  studioObservationProblems,
  studioReviewProblems,
  type StudioObservation,
  type StudioProject,
  type StudioReview,
} from '@/lib/domain/studio';
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
  UsageRecord,
  WebsiteVerification,
} from '@/lib/domain/types';
import { StoreError, type DataStore } from './store';

export const DEMO_KEY = 'dof-v7-demo';
export const LEGACY_DEMO_KEY = 'dof-cloud-v1-local';
export const DEMO_USER_ID = 'demo-user';
export const DEMO_ORG_ID = 'demo-org';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

interface DemoState {
  version: 1;
  organization: { id: string; name: string; settings: OrgSettings };
  businesses: Business[];
  verifications: WebsiteVerification[];
  activities: Activity[];
  tasks: Task[];
  reports: OpportunityReport[];
  proposals: Proposal[];
  proposalVersions: ProposalVersion[];
  projects: Project[];
  milestones: ProjectMilestone[];
  audit: AuditEvent[];
  usage: UsageRecord[];
  /** Added with research automation (filled in on load for demo data saved by earlier builds). */
  identityLinks: IdentityLink[];
  auditFindings: AuditFinding[];
  /** Added with contact intelligence (filled in on load for older demo data). */
  contactPoints: ContactPoint[];
  consentRecords: ConsentRecord[];
  suppressions: Suppression[];
  /** Added with messaging (filled in on load for older demo data). */
  messageTemplates: MessageTemplate[];
  outreachMessages: OutreachMessage[];
  eligibilityDecisions: EligibilityDecision[];
  inboundMessages: InboundMessage[];
  /** Added with the sending policy (phase 8; filled in on load for older demo data). */
  messagePolicies: MessagePolicy[];
  /** Added with responses and conversion (phase 9; filled in on load for older demo data). */
  replyClassifications: ReplyClassification[];
  changeRequests: ChangeRequest[];
  /** Added with the website Studio (filled in on load for older demo data). */
  studioProjects: StudioProject[];
  studioObservations: StudioObservation[];
  studioReviews: StudioReview[];
  /** Added with automation; absent in demo data saved by earlier builds. */
  workflowTransitions?: WorkflowTransition[];
}

type Tables = Omit<DemoState, 'version' | 'organization' | 'workflowTransitions'>;
type Row = { id: string; organizationId: string };

const AUDITED: (keyof Tables)[] = [
  'businesses',
  'verifications',
  'proposals',
  'projects',
  'identityLinks',
  'auditFindings',
  'contactPoints',
  'consentRecords',
  'suppressions',
  'messageTemplates',
  'outreachMessages',
  'messagePolicies',
  'changeRequests',
  'studioProjects',
];
const AUDIT_TABLE_NAMES: Partial<Record<keyof Tables, string>> = {
  businesses: 'businesses',
  verifications: 'website_verifications',
  proposals: 'proposals',
  projects: 'projects',
  identityLinks: 'identity_links',
  auditFindings: 'audit_findings',
  contactPoints: 'contact_points',
  consentRecords: 'consent_records',
  suppressions: 'suppressions',
  messageTemplates: 'message_templates',
  outreachMessages: 'outreach_messages',
  messagePolicies: 'message_policies',
  changeRequests: 'proposal_change_requests',
  studioProjects: 'studio_projects',
};
/** Mirrors guard_verification_update and guard_audit_finding_update in migration 004. */
const VERIFICATION_REVIEW_FIELDS = new Set(['reviewStatus', 'reviewNote', 'reviewedBy', 'reviewedAt']);
const FINDING_REVIEW_FIELDS = new Set(['reviewStatus', 'reviewNote', 'reviewedBy', 'reviewedAt']);
const SAME_BUSINESS_VIA_MERGE = 'Use merge or undo merge to record that two prospects are the same business.';
const AUDIT_IGNORED = new Set(['updatedAt', 'scoreBreakdown', 'scoredAt', 'version']);

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const clone = <T,>(v: T): T => structuredClone(v);

/** Builds the initial demo dataset from the 20 v1–v3 research records (or v6 browser data). */
export function seedDemoState(legacy: LegacyLead[] = seed as LegacyLead[], now = new Date()): DemoState {
  const at = now.toISOString();
  const state: DemoState = {
    version: 1,
    organization: { id: DEMO_ORG_ID, name: 'Demo agency', settings: clone(DEFAULT_SETTINGS) },
    businesses: [],
    verifications: [],
    activities: [],
    tasks: [],
    reports: [],
    proposals: [],
    proposalVersions: [],
    projects: [],
    milestones: [],
    audit: [],
    usage: [],
    identityLinks: [],
    auditFindings: [],
    contactPoints: [],
    consentRecords: [],
    suppressions: [],
    messageTemplates: [],
    outreachMessages: [],
    eligibilityDecisions: [],
    messagePolicies: [],
    inboundMessages: [],
    replyClassifications: [],
    changeRequests: [],
    studioProjects: [],
    studioObservations: [],
    studioReviews: [],
    workflowTransitions: [],
  };
  for (const lead of legacy) {
    const { business, verifications } = mapLegacyLead(lead, at);
    const id = uuid();
    const rows = verifications.map<WebsiteVerification>((v) => ({ ...v, id: uuid(), organizationId: DEMO_ORG_ID, businessId: id, createdAt: at, updatedAt: at }));
    state.verifications.push(...rows);
    const row: Business = {
      ...business,
      ...scoreFields(business, rows, state.organization.settings, now),
      id,
      organizationId: DEMO_ORG_ID,
      createdBy: null,
      createdAt: at,
      updatedAt: at,
    };
    Object.assign(row, workflowAfterChange(null, row, at));
    state.businesses.push(row);
    state.workflowTransitions!.push(transitionRow(row, null, at, null));
  }
  return state;
}

function transitionRow(b: Business, from: WorkflowTransition['fromState'], at: string, actorId: string | null): WorkflowTransition {
  return {
    id: uuid(),
    organizationId: DEMO_ORG_ID,
    businessId: b.id,
    fromState: from,
    toState: workflowStateOf(b),
    actorType: b.workflowStateActor ?? 'system',
    actorId,
    reason: b.workflowStateReason ?? null,
    createdAt: at,
  };
}

/** Mirrors person_moves, worker_moves and outreach_messages_dedupe_idx in migration 006. */
const PERSON_MOVES = ['draft>approved', 'approved>draft', 'approved>queued', 'draft>cancelled', 'approved>cancelled', 'queued>cancelled'];
const WORKER_MOVES = [
  ...['approved>queued', 'queued>sending', 'queued>blocked', 'queued>cancelled', 'draft>cancelled', 'approved>cancelled'],
  ...['sending>sent', 'sending>failed', 'sending>delivery_unknown', 'sending>delivered', 'sending>read', 'sending>bounced', 'sending>complained'],
  ...['sent>delivered', 'sent>read', 'sent>failed', 'sent>bounced', 'sent>complained', 'delivered>read', 'delivered>bounced', 'delivered>complained', 'read>complained'],
  ...['delivery_unknown>sent', 'delivery_unknown>delivered', 'delivery_unknown>read', 'delivery_unknown>failed', 'delivery_unknown>bounced', 'delivery_unknown>complained'],
];
const INSERT_ONLY = new Set<keyof Tables>(['activities', 'consentRecords', 'suppressions', 'eligibilityDecisions', 'inboundMessages', 'replyClassifications', 'studioObservations', 'studioReviews']);
const PROVIDER_SOURCES = new Set(['licensed_dataset', 'authorized_directory', 'enrichment_provider']);
/** Mirrors the generated match_key / channel_key and the active-entry unique index of migration 005. */
const suppressionMatch = (s: Pick<Suppression, 'kind' | 'valueHash' | 'businessId' | 'id' | 'channel'>) => `${s.kind}|${s.valueHash ?? s.businessId ?? s.id}|${s.channel ?? '*'}`;

function addSuppression(list: Suppression[], input: SuppressionInsert, at: string, userId: string | null): Suppression | null {
  const row: Suppression = { ...input, id: uuid(), organizationId: DEMO_ORG_ID, createdAt: at, createdBy: userId, liftedAt: null, liftedBy: null, liftReason: null, liftConsentId: null };
  if (list.some((s) => !s.liftedAt && suppressionMatch(s) === suppressionMatch(row))) return null;
  list.push(row);
  return row;
}

function suppressBusinessInto(list: Suppression[], b: Business, points: ContactPoint[], at: string, userId: string | null) {
  const base = { channel: null, reason: 'opted_out' as const, source: 'business_opt_out' as const, consentRecordId: null, note: null };
  addSuppression(list, { ...base, kind: 'business', valueHash: null, businessId: b.id, hint: b.name.slice(0, 120) }, at, userId);
  for (const p of points) {
    if (!p.valueHash) continue;
    addSuppression(list, { ...base, kind: p.type === 'email' ? 'email' : 'phone', valueHash: p.valueHash, businessId: null, hint: p.hint }, at, userId);
  }
}

export class LocalStore implements DataStore {
  readonly mode = 'demo' as const;
  private state: DemoState;

  constructor(
    private readonly storage: KeyValueStorage | null,
    private readonly userId = DEMO_USER_ID,
  ) {
    this.state = this.load();
  }

  private load(): DemoState {
    try {
      const raw = this.storage?.getItem(DEMO_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DemoState;
        if (parsed?.version === 1 && Array.isArray(parsed.businesses)) {
          parsed.organization.settings = resolveSettings(parsed.organization.settings);
          // Mirrors migration 003's one-time backfill for demo data saved before automation existed.
          parsed.workflowTransitions ??= [];
          parsed.identityLinks ??= [];
          parsed.auditFindings ??= [];
          parsed.contactPoints ??= [];
          parsed.consentRecords ??= [];
          parsed.messageTemplates ??= [];
          parsed.outreachMessages ??= [];
          parsed.eligibilityDecisions ??= [];
          parsed.messagePolicies ??= [];
          parsed.inboundMessages ??= [];
          parsed.replyClassifications ??= [];
          parsed.changeRequests ??= [];
          parsed.studioProjects ??= [];
          parsed.studioObservations ??= [];
          parsed.studioReviews ??= [];
          // Mirrors migration 005's backfill: businesses already opted out are suppressed.
          if (!parsed.suppressions) {
            parsed.suppressions = [];
            for (const b of parsed.businesses) if (b.contactPermission === 'opted_out') suppressBusinessInto(parsed.suppressions, b, [], new Date().toISOString(), null);
          }
          for (const b of parsed.businesses) {
            if (b.workflowState) continue;
            b.workflowState = workflowStateOf(b);
            b.workflowStateAt = b.updatedAt;
            b.workflowStateReason = 'Derived from the CRM stage when automation was installed';
            b.workflowStateActor = 'system';
          }
          return parsed;
        }
      }
      // First run after upgrading from v6: carry the browser's v6 records forward.
      const legacyRaw = this.storage?.getItem(LEGACY_DEMO_KEY);
      const legacy = legacyRaw ? (JSON.parse(legacyRaw) as LegacyLead[]) : null;
      const state = seedDemoState(Array.isArray(legacy) && legacy.length ? legacy : undefined);
      this.persist(state);
      return state;
    } catch {
      return seedDemoState();
    }
  }

  private persist(state = this.state) {
    try {
      this.storage?.setItem(DEMO_KEY, JSON.stringify(state));
    } catch {
      throw new StoreError('Browser storage is full or unavailable. Export your data and reset the demo.', 'unavailable');
    }
  }

  /** Clears demo data (including the automation queue) and re-seeds the research records. */
  reset() {
    this.state = seedDemoState();
    this.persist();
    this.storage?.removeItem(AUTOMATION_KEY);
  }

  private now() {
    return new Date().toISOString();
  }

  private audit(table: keyof Tables, action: AuditEvent['action'], before: Row | null, after: Row | null) {
    const tableName = AUDIT_TABLE_NAMES[table];
    if (!tableName || !AUDITED.includes(table)) return;
    const record = (after ?? before)!;
    if (action === 'delete') {
      this.state.audit = this.state.audit.filter((e) => !(e.tableName === tableName && e.recordId === record.id));
    }
    let changes: AuditEvent['changes'] = null;
    if (action === 'update' && before && after) {
      changes = {};
      for (const [k, v] of Object.entries(after)) {
        if (AUDIT_IGNORED.has(k)) continue;
        const old = (before as Record<string, unknown>)[k];
        if (JSON.stringify(old) !== JSON.stringify(v)) changes[k] = { old: old ?? null, new: v ?? null };
      }
      if (!Object.keys(changes).length) return;
    }
    this.state.audit.push({ id: uuid(), organizationId: DEMO_ORG_ID, tableName, recordId: record.id, action, actorId: this.userId, changes, createdAt: this.now() });
  }

  private insert<K extends keyof Tables>(table: K, values: Omit<Tables[K][number], 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>): Tables[K][number] {
    const at = this.now();
    const row = { ...values, id: uuid(), organizationId: DEMO_ORG_ID, createdAt: at, ...(INSERT_ONLY.has(table) ? {} : { updatedAt: at }) } as Tables[K][number];
    (this.state[table] as Tables[K][number][]).push(row);
    this.audit(table, 'insert', null, row as Row);
    return clone(row);
  }

  private update<K extends keyof Tables>(table: K, id: string, patch: Partial<Tables[K][number]>): Tables[K][number] {
    const list = this.state[table] as (Tables[K][number] & Row)[];
    const index = list.findIndex((r) => r.id === id);
    if (index < 0) throw new StoreError('Record not found', 'not_found');
    const before = list[index];
    const after = { ...before, ...patch, id: before.id, organizationId: before.organizationId, updatedAt: this.now() };
    list[index] = after;
    this.audit(table, 'update', before, after);
    return clone(after);
  }

  private remove<K extends keyof Tables>(table: K, predicate: (row: Tables[K][number]) => boolean) {
    const list = this.state[table] as (Tables[K][number] & Row)[];
    for (const row of list.filter(predicate)) this.audit(table, 'delete', row, null);
    (this.state as unknown as Record<string, unknown[]>)[table] = list.filter((r) => !predicate(r));
  }

  private async commit<T>(fn: () => T): Promise<T> {
    const snapshot = JSON.stringify(this.state);
    try {
      const result = fn();
      this.persist();
      return result;
    } catch (error) {
      this.state = JSON.parse(snapshot);
      throw error;
    }
  }

  // ── Businesses ──
  async listBusinesses() {
    return clone(this.state.businesses);
  }
  async getBusiness(id: string) {
    return clone(this.state.businesses.find((b) => b.id === id) ?? null);
  }
  // Workflow fields follow the same rules as the sync_workflow_state trigger in migration 003.
  createBusiness: DataStore['createBusiness'] = (input) =>
    this.commit(() => {
      const at = this.now();
      const fields = workflowAfterChange(null, input as Business, at);
      const row = this.insert('businesses', { ...input, ...fields, createdBy: this.userId });
      this.transitions().push(transitionRow(row, null, at, this.userId));
      if (row.contactPermission === 'opted_out') suppressBusinessInto(this.state.suppressions, row, [], at, this.userId);
      return row;
    });
  updateBusiness: DataStore['updateBusiness'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.businesses.find((b) => b.id === id);
      if (!before) throw new StoreError('Record not found', 'not_found');
      if (patch.mergedIntoId !== undefined) throw new StoreError('Use merge or undo merge to change merged records.', 'invalid');
      // Mirrors businesses_merged_archived_check (migration 004).
      if (before.mergedIntoId && patch.stage && patch.stage !== 'archived') throw new StoreError('A merged prospect stays archived. Undo the merge to work on it again.', 'invalid');
      return this.applyBusiness(id, patch);
    });
  async listWorkflowTransitions(businessId?: string) {
    return clone(this.transitions().filter((t) => !businessId || t.businessId === businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  private transitions() {
    return (this.state.workflowTransitions ??= []);
  }
  deleteBusiness: DataStore['deleteBusiness'] = (id) =>
    this.commit(() => {
      if (this.state.projects.some((p) => p.businessId === id)) {
        throw new StoreError('This business has projects. Delete or reassign its projects first.', 'conflict');
      }
      const proposalIds = new Set(this.state.proposals.filter((p) => p.businessId === id).map((p) => p.id));
      this.remove('proposalVersions', (v) => proposalIds.has(v.proposalId));
      this.remove('changeRequests', (c) => c.businessId === id || proposalIds.has(c.proposalId));
      this.remove('proposals', (p) => p.businessId === id);
      this.remove('reports', (r) => r.businessId === id);
      this.remove('verifications', (v) => v.businessId === id);
      this.remove('activities', (a) => a.businessId === id);
      this.remove('tasks', (t) => t.businessId === id);
      this.remove('auditFindings', (f) => f.businessId === id);
      this.remove('identityLinks', (l) => l.businessId === id || l.otherBusinessId === id);
      // Mirrors the foreign keys in migration 005: contact points and consent go, suppressions stay.
      const consentIds = new Set(this.state.consentRecords.filter((c) => c.businessId === id).map((c) => c.id));
      // Migration 006: messages and received messages go with the business; decisions stay, unlinked.
      const messageIds = new Set(this.state.outreachMessages.filter((m) => m.businessId === id).map((m) => m.id));
      this.remove('outreachMessages', (m) => m.businessId === id);
      const inboundIds = new Set(this.state.inboundMessages.filter((m) => m.businessId === id).map((m) => m.id));
      this.state.inboundMessages = this.state.inboundMessages.filter((m) => m.businessId !== id);
      // Migration 008: classifications go with their message; change requests forget it.
      this.state.replyClassifications = this.state.replyClassifications.filter((c) => !inboundIds.has(c.inboundMessageId));
      for (const c of this.state.changeRequests) if (c.inboundMessageId && inboundIds.has(c.inboundMessageId)) c.inboundMessageId = null;
      for (const m of this.state.inboundMessages) if (m.replyToMessageId && messageIds.has(m.replyToMessageId)) m.replyToMessageId = null;
      for (const d of this.state.eligibilityDecisions) if (d.businessId === id) d.businessId = null;
      this.remove('contactPoints', (p) => p.businessId === id);
      this.remove('consentRecords', (c) => c.businessId === id);
      // Migration 012: a concept and its evidence live and die with the prospect they were built for.
      const studioIds = new Set(this.state.studioProjects.filter((p) => p.businessId === id).map((p) => p.id));
      this.remove('studioObservations', (o) => studioIds.has(o.projectId));
      this.remove('studioReviews', (r) => studioIds.has(r.projectId));
      this.remove('studioProjects', (p) => p.businessId === id);
      for (const sup of this.state.suppressions) {
        if (sup.businessId === id) sup.businessId = null;
        if (sup.consentRecordId && consentIds.has(sup.consentRecordId)) sup.consentRecordId = null;
        if (sup.liftConsentId && consentIds.has(sup.liftConsentId)) sup.liftConsentId = null;
      }
      for (const b of this.state.businesses) {
        if (b.parentBusinessId === id) b.parentBusinessId = null;
        if (b.mergedIntoId === id) b.mergedIntoId = null;
      }
      this.remove('businesses', (b) => b.id === id);
      this.state.workflowTransitions = this.transitions().filter((t) => t.businessId !== id);
      forgetBusinessAutomation(this.storage, id);
    });

  // ── Verification ──
  async listVerifications(businessId?: string) {
    return clone(this.state.verifications.filter((v) => !businessId || v.businessId === businessId).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)));
  }
  createVerification: DataStore['createVerification'] = (input) => this.commit(() => this.insert('verifications', { actorType: 'user', reviewStatus: 'not_required', ...input }));
  updateVerification: DataStore['updateVerification'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.verifications.find((v) => v.id === id);
      if (!before) throw new StoreError('Record not found', 'not_found');
      if (before.actorType === 'agent') {
        const changed = Object.entries(patch).filter(([k, v]) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v));
        if (changed.some(([k]) => !VERIFICATION_REVIEW_FIELDS.has(k))) {
          throw new StoreError('Agent verification records cannot be edited. Confirm or reject them, or record a new verification.', 'invalid');
        }
      }
      const review = patch.reviewStatus && patch.reviewStatus !== before.reviewStatus ? { reviewedBy: this.userId, reviewedAt: this.now() } : {};
      return this.update('verifications', id, { ...patch, ...review });
    });

  // ── Identity (migration 004 in cloud mode) ──
  async researchSchemaAvailable() {
    return true;
  }
  async listIdentityLinks(businessId?: string) {
    return clone(this.state.identityLinks.filter((l) => !businessId || l.businessId === businessId || l.otherBusinessId === businessId));
  }
  createIdentityLink: DataStore['createIdentityLink'] = (input) =>
    this.commit(() => {
      const pair = (l: { businessId: string; otherBusinessId: string }) => [l.businessId, l.otherBusinessId].sort().join(':');
      if (input.businessId === input.otherBusinessId) throw new StoreError('A prospect cannot be linked to itself.', 'invalid');
      if (input.relation === 'same_business' || input.mergeSnapshot) throw new StoreError(SAME_BUSINESS_VIA_MERGE, 'invalid');
      if (this.state.identityLinks.some((l) => pair(l) === pair(input))) throw new StoreError('A matching record already exists.', 'conflict');
      return this.insert('identityLinks', input);
    });
  updateIdentityLink: DataStore['updateIdentityLink'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.identityLinks.find((l) => l.id === id);
      if (!before) throw new StoreError('Record not found', 'not_found');
      const relationChanged = patch.relation !== undefined && patch.relation !== before.relation;
      if (relationChanged && (patch.relation === 'same_business' || before.relation === 'same_business')) throw new StoreError(SAME_BUSINESS_VIA_MERGE, 'invalid');
      const decided = (patch.status && patch.status !== before.status) || relationChanged ? { decidedBy: this.userId, decidedAt: this.now() } : {};
      return this.update('identityLinks', id, { ...patch, ...decided });
    });
  mergeBusinesses: DataStore['mergeBusinesses'] = (primaryId, secondaryId, fields, note) =>
    this.commit(() => {
      const a = this.state.businesses.find((b) => b.id === primaryId);
      const b = this.state.businesses.find((x) => x.id === secondaryId);
      if (!a || !b) throw new StoreError('Prospect not found.', 'not_found');
      if (a.id === b.id) throw new StoreError('Choose two different prospects to merge.', 'invalid');
      if (a.mergedIntoId || b.mergedIntoId) throw new StoreError('One of these prospects has already been merged.', 'conflict');
      const copied: MergeableField[] = fields.filter((f) => !a[f] && b[f]);
      const patch = Object.fromEntries(copied.map((f) => [f, b[f]])) as Partial<Business>;
      const names = [...new Set([...(a.alternateNames ?? []), ...(b.alternateNames ?? []), b.name])].filter((n) => n.toLowerCase() !== a.name.toLowerCase()).slice(0, 20);
      const permission = mergedPermission(a, b);
      const at = this.now();
      this.applyBusiness(a.id, { ...patch, ...permission, alternateNames: names });
      this.applyBusiness(b.id, { stage: 'archived', mergedIntoId: a.id, nextAction: null });
      const addedName = b.name.toLowerCase() !== a.name.toLowerCase() && !(a.alternateNames ?? []).includes(b.name);
      const snapshot = { stage: b.stage, copiedFields: copied, permissionFrom: a.contactPermission, addedName, mergedAt: at };
      const existing = this.state.identityLinks.find((l) => [l.businessId, l.otherBusinessId].sort().join(':') === [a.id, b.id].sort().join(':'));
      const decision = { relation: 'same_business' as const, status: 'confirmed' as const, decidedBy: this.userId, decidedAt: at, note: note ?? null, mergeSnapshot: snapshot };
      if (existing) this.update('identityLinks', existing.id, decision);
      else this.insert('identityLinks', { businessId: a.id, otherBusinessId: b.id, strength: 'likely', reasons: ['Merged by a person'], suggestedBy: 'user', agentVersion: null, ...decision });
      return { primary: clone(this.state.businesses.find((x) => x.id === a.id)!), secondary: clone(this.state.businesses.find((x) => x.id === b.id)!) };
    });
  undoMerge: DataStore['undoMerge'] = (secondaryId) =>
    this.commit(() => {
      const b = this.state.businesses.find((x) => x.id === secondaryId);
      if (!b?.mergedIntoId) throw new StoreError('This prospect is not merged.', 'invalid');
      const link = this.state.identityLinks.find((l) => [l.businessId, l.otherBusinessId].sort().join(':') === [b.id, b.mergedIntoId].sort().join(':'));
      const snapshot = (link?.mergeSnapshot ?? {}) as { stage?: Business['stage']; copiedFields?: MergeableField[]; addedName?: boolean };
      const primary = this.state.businesses.find((x) => x.id === b.mergedIntoId);
      if (primary) {
        // Copied values leave the primary unless changed since; a carried-over opt-out stays (a person reviews it).
        const cleared = (snapshot.copiedFields ?? []).filter((f) => MERGEABLE_FIELDS.includes(f) && primary[f] === b[f]);
        const names = snapshot.addedName === false ? primary.alternateNames : (primary.alternateNames ?? []).filter((n) => n !== b.name);
        this.applyBusiness(primary.id, { ...Object.fromEntries(cleared.map((f) => [f, null])), alternateNames: names });
      }
      const restored = this.applyBusiness(b.id, { stage: snapshot.stage && snapshot.stage !== 'archived' ? snapshot.stage : 'research_candidate', mergedIntoId: null });
      if (link) this.update('identityLinks', link.id, { relation: 'distinct', status: 'confirmed', decidedBy: this.userId, decidedAt: this.now(), note: 'Merge undone' });
      return restored;
    });
  /** updateBusiness without its own commit, for multi-record operations inside one commit. */
  private applyBusiness(id: string, patch: Partial<Business>) {
    const before = this.state.businesses.find((b) => b.id === id)!;
    const at = this.now();
    const fields = workflowAfterChange(before, { ...before, ...patch } as Business, at);
    const from = workflowStateOf(before);
    const row = this.update('businesses', id, { ...patch, ...fields });
    if (fields.workflowState !== from) this.transitions().push(transitionRow(row, from, at, this.userId));
    // Mirrors suppress_on_business_opt_out (migration 005).
    if (row.contactPermission === 'opted_out' && before.contactPermission !== 'opted_out') {
      suppressBusinessInto(this.state.suppressions, row, this.state.contactPoints.filter((p) => p.businessId === id), at, this.userId);
    }
    return row;
  }

  // ── Digital audit findings ──
  async listAuditFindings(businessId?: string) {
    return clone(this.state.auditFindings.filter((f) => !businessId || f.businessId === businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  createAuditFindings: DataStore['createAuditFindings'] = (input) =>
    this.commit(() =>
      input.map((f) => {
        if (!f.evidence.length) throw new StoreError('Every finding needs evidence.', 'invalid');
        return this.insert('auditFindings', { ...f, reviewedBy: null, reviewedAt: null, reviewNote: null });
      }),
    );
  updateAuditFinding: DataStore['updateAuditFinding'] = (id, patch) =>
    this.commit(() => {
      if (Object.keys(patch).some((k) => !FINDING_REVIEW_FIELDS.has(k))) throw new StoreError('Audit findings are evidence records; only their review can change.', 'invalid');
      const before = this.state.auditFindings.find((f) => f.id === id);
      if (!before) throw new StoreError('Record not found', 'not_found');
      const review = patch.reviewStatus && patch.reviewStatus !== before.reviewStatus && patch.reviewStatus !== 'superseded' ? { reviewedBy: this.userId, reviewedAt: this.now() } : {};
      return this.update('auditFindings', id, { ...patch, ...review });
    });

  // ── Contacts (migration 005 in cloud mode) ──
  async contactSchemaAvailable() {
    return true;
  }
  async listContactPoints(businessId?: string) {
    return clone(this.state.contactPoints.filter((p) => !businessId || p.businessId === businessId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  }
  // Mirrors the contact_points constraints and guard_contact_point (migration 005).
  createContactPoints: DataStore['createContactPoints'] = (input) =>
    this.commit(() =>
      input.map((p) => {
        if (!this.state.businesses.some((b) => b.id === p.businessId)) throw new StoreError('Prospect not found.', 'not_found');
        if (!(CONTACT_SOURCE_TYPES as readonly string[]).includes(p.sourceType)) throw new StoreError('This source cannot be stored as a contact detail.', 'invalid');
        if (!(p.sourceUrl || p.sourceProvider || p.sourceNote)) throw new StoreError('Every contact detail needs its source: a link, a provider or a note.', 'invalid');
        if (p.sourceType === 'business_website' && !p.sourceUrl) throw new StoreError('Record the page where the business published this detail.', 'invalid');
        if (PROVIDER_SOURCES.has(p.sourceType) && !(p.sourceProvider && p.sourceLicence)) throw new StoreError('Provider details need the provider and its licence.', 'invalid');
        if ((p.type === 'email' || p.type === 'phone' || p.type === 'whatsapp') && !p.valueHash) throw new StoreError('Contact hash missing.', 'invalid');
        if (p.scope === 'person' && (!p.personName || !p.personRole || p.purpose === 'research')) throw new StoreError('A personal work contact needs a name, a role and a purpose other than research.', 'invalid');
        if (this.state.contactPoints.some((x) => x.businessId === p.businessId && x.type === p.type && x.normalizedValue === p.normalizedValue)) {
          throw new StoreError('This contact detail is already recorded for the prospect.', 'conflict');
        }
        return this.insert('contactPoints', { ...p, acquiredBy: this.userId });
      }),
    );
  updateContactPoint: DataStore['updateContactPoint'] = (id, patch) =>
    this.commit(() => {
      if (Object.keys(patch).some((k) => !CONTACT_MUTABLE_FIELDS.has(k as keyof ContactPoint))) {
        throw new StoreError('Where a contact detail came from cannot be changed; record a corrected detail as a new contact point.', 'invalid');
      }
      return this.update('contactPoints', id, patch);
    });
  deleteContactPoints: DataStore['deleteContactPoints'] = (ids) =>
    this.commit(() => {
      const set = new Set(ids);
      this.remove('contactPoints', (p) => set.has(p.id));
      for (const c of this.state.consentRecords) if (c.contactPointId && set.has(c.contactPointId)) c.contactPointId = null;
      for (const m of this.state.outreachMessages) if (m.contactPointId && set.has(m.contactPointId)) m.contactPointId = null;
      for (const m of this.state.inboundMessages) if (m.contactPointId && set.has(m.contactPointId)) m.contactPointId = null;
    });
  async listConsentRecords(businessId?: string) {
    return clone(this.state.consentRecords.filter((c) => !businessId || c.businessId === businessId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.createdAt.localeCompare(a.createdAt)));
  }
  // Mirrors the consent_records constraints, guard_consent_record and suppress_on_withdrawal.
  createConsentRecord: DataStore['createConsentRecord'] = (input) =>
    this.commit(() => {
      if (!this.state.businesses.some((b) => b.id === input.businessId)) throw new StoreError('Prospect not found.', 'not_found');
      const point = input.contactPointId ? this.state.contactPoints.find((p) => p.id === input.contactPointId) : null;
      if (input.contactPointId && point?.businessId !== input.businessId) throw new StoreError('That contact point belongs to another prospect.', 'invalid');
      if ((input.status === 'granted') !== Boolean(input.lawfulBasis)) throw new StoreError('A grant needs its lawful basis; a withdrawal has none.', 'invalid');
      if (input.status === 'granted' && input.lawfulBasis === 'consent' && input.purpose === 'direct_marketing' && (!WRITTEN_CAPTURE.includes(input.capturedVia) || !input.wording)) {
        throw new StoreError('Direct marketing needs prior written consent with its wording (Act 843 s.40).', 'invalid');
      }
      if (input.evidence.trim().length < 10) throw new StoreError('Describe the evidence (at least 10 characters).', 'invalid');
      const at = this.now();
      if (input.capturedAt > new Date(Date.now() + 5 * 60_000).toISOString() || (input.expiresAt && input.expiresAt <= input.capturedAt)) throw new StoreError('Check the dates.', 'invalid');
      const row = this.insert('consentRecords', { ...input, recordedBy: this.userId });
      if (row.status === 'withdrawn') {
        for (const p of this.state.contactPoints) {
          const channel = p.type === 'email' ? 'email' : p.type === 'phone' ? 'phone' : p.type === 'whatsapp' ? 'whatsapp' : null;
          if (p.businessId !== row.businessId || !p.valueHash || channel !== row.channel || (row.contactPointId && p.id !== row.contactPointId)) continue;
          const sup = addSuppression(
            this.state.suppressions,
            { kind: p.type === 'email' ? 'email' : 'phone', valueHash: p.valueHash, businessId: null, channel: row.channel, hint: p.hint, reason: 'opted_out', source: 'consent_withdrawal', consentRecordId: row.id, note: null },
            at,
            this.userId,
          );
          if (sup) this.audit('suppressions', 'insert', null, sup);
        }
      }
      return row;
    });
  async listSuppressions() {
    return clone([...this.state.suppressions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  createSuppression: DataStore['createSuppression'] = (input) =>
    this.commit(() => {
      if (input.kind === 'business' ? !input.businessId || input.valueHash : !/^[0-9a-f]{64}$/.test(input.valueHash ?? '')) throw new StoreError('Suppression target missing.', 'invalid');
      const row = addSuppression(this.state.suppressions, input, this.now(), this.userId);
      if (!row) throw new StoreError('This contact is already on the suppression list.', 'conflict');
      this.audit('suppressions', 'insert', null, row);
      return clone(row);
    });
  // Mirrors guard_suppression (migration 005). The demo user is the workspace owner.
  liftSuppression: DataStore['liftSuppression'] = (id, lift) =>
    this.commit(() => {
      const before = this.state.suppressions.find((s) => s.id === id);
      if (!before) throw new StoreError('Record not found', 'not_found');
      if (before.liftedAt) throw new StoreError('This suppression was already lifted; add a new entry instead.', 'invalid');
      if (lift.reason.trim().length < 10) throw new StoreError('Explain why the suppression is lifted (at least 10 characters).', 'invalid');
      const c = this.state.consentRecords.find((r) => r.id === lift.consentId);
      const at = this.now();
      if (!c || c.status !== 'granted' || c.createdAt <= before.createdAt || (c.expiresAt && c.expiresAt <= at)) throw new StoreError('Lifting a suppression needs a current consent record made after it.', 'invalid');
      const covers = (hash: 'valueHash' | 'domainHash') =>
        this.state.contactPoints.some((p) => p.businessId === c.businessId && p[hash] === before.valueHash && (!c.contactPointId || c.contactPointId === p.id));
      if (
        (before.channel && c.channel !== before.channel) ||
        (before.kind === 'business' && c.businessId !== before.businessId) ||
        ((before.kind === 'email' || before.kind === 'phone') && !covers('valueHash')) ||
        (before.kind === 'email_domain' && !covers('domainHash'))
      ) {
        throw new StoreError('The consent record must cover the suppressed contact and channel.', 'invalid');
      }
      const after: Suppression = { ...before, liftedAt: at, liftedBy: this.userId, liftReason: lift.reason.trim(), liftConsentId: c.id };
      this.state.suppressions = this.state.suppressions.map((s) => (s.id === id ? after : s));
      this.audit('suppressions', 'update', before, after);
      return clone(after);
    });

  // ── Messaging (migration 006 in cloud mode). The demo user is the workspace owner. ──
  async messagingSchemaAvailable() {
    return true;
  }
  async listTemplates() {
    return clone([...this.state.messageTemplates].sort((a, b) => a.channel.localeCompare(b.channel) || a.name.localeCompare(b.name)));
  }
  // Mirrors the message_templates constraints and guard_message_template.
  private checkTemplate(t: MessageTemplate) {
    if (t.channel === 'email' ? !t.subject?.trim() || t.providerTemplateName : !t.providerTemplateName || t.subject) {
      throw new StoreError(t.channel === 'email' ? 'An email template needs a subject.' : 'A WhatsApp template needs its template name and no subject.', 'invalid');
    }
    if (t.providerTemplateName && !/^[a-z0-9_]{1,512}$/.test(t.providerTemplateName)) throw new StoreError('WhatsApp template names use lowercase letters, digits and underscores.', 'invalid');
    if (!t.name.trim() || !t.body.trim() || t.body.length > 5000) throw new StoreError('A template needs a name and a body of up to 5,000 characters.', 'invalid');
    if (this.state.messageTemplates.some((x) => x.id !== t.id && x.channel === t.channel && x.name === t.name && x.language === t.language)) {
      throw new StoreError('A template with this name and language already exists for the channel.', 'conflict');
    }
  }
  createTemplate: DataStore['createTemplate'] = (input) =>
    this.commit(() => {
      const draft = { ...input, providerTemplateId: null, providerCategory: null, status: 'draft' as const, statusReason: null, statusCheckedAt: null, approvedBy: null, approvedAt: null, version: 1, createdBy: this.userId };
      this.checkTemplate({ ...draft, id: '', organizationId: DEMO_ORG_ID, createdAt: '', updatedAt: '' });
      return this.insert('messageTemplates', draft);
    });
  updateTemplate: DataStore['updateTemplate'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.messageTemplates.find((t) => t.id === id);
      if (!before) throw new StoreError('Template not found.', 'not_found');
      const next = { ...before, ...patch };
      const content = (['channel', 'name', 'purpose', 'language', 'subject', 'body', 'providerTemplateName'] as const).some((k) => next[k] !== before[k]);
      let changes: Partial<MessageTemplate>;
      if (content) {
        if (next.channel !== before.channel) throw new StoreError('A template keeps its channel; create a new template instead.', 'invalid');
        changes = { ...patch, version: before.version + 1, approvedBy: null, approvedAt: null, status: before.status === 'disabled' ? 'disabled' : 'draft', statusReason: null };
      } else if (next.status !== before.status) {
        const move = `${before.status}>${next.status}`;
        const allowed =
          before.channel === 'email'
            ? ['draft>approved', 'draft>disabled', 'approved>paused', 'approved>disabled', 'approved>draft', 'paused>approved', 'paused>disabled', 'paused>draft', 'disabled>draft']
            : ['draft>disabled', 'pending>disabled', 'approved>disabled', 'rejected>disabled', 'paused>disabled', 'disabled>pending'];
        if (!allowed.includes(move)) {
          throw new StoreError(before.channel === 'whatsapp' ? 'WhatsApp template status comes from Meta; synchronise the templates instead.' : 'This template status change is not allowed.', 'invalid');
        }
        changes = { status: next.status, statusReason: patch.statusReason ?? before.statusReason, ...(next.status === 'approved' ? { approvedBy: this.userId, approvedAt: this.now() } : {}) };
      } else changes = { statusReason: patch.statusReason ?? before.statusReason };
      this.checkTemplate({ ...before, ...changes });
      return this.update('messageTemplates', id, changes);
    });
  deleteTemplate: DataStore['deleteTemplate'] = (id) =>
    this.commit(() => {
      // Mirrors message_policies.template_id … on delete restrict (migration 007).
      if (this.state.messagePolicies.some((p) => p.templateId === id)) throw new StoreError('A message policy refers to this template; disable the template instead of deleting it.', 'conflict');
      this.remove('messageTemplates', (t) => t.id === id);
      for (const m of this.state.outreachMessages) if (m.templateId === id) m.templateId = null;
    });

  async listOutreachMessages(businessId?: string) {
    return clone(this.state.outreachMessages.filter((m) => !businessId || m.businessId === businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async getOutreachMessage(id: string) {
    return clone(this.state.outreachMessages.find((m) => m.id === id) ?? null);
  }
  // Mirrors the outreach_messages constraints and guard_outreach_message.
  createOutreachMessage: DataStore['createOutreachMessage'] = async (input) => {
    const bodyHash = await sha256Hex(bodyHashInput(input.subject, input.body));
    return this.commit(() => {
      if (!this.state.businesses.some((b) => b.id === input.businessId)) throw new StoreError('Prospect not found.', 'not_found');
      if (input.contactPointId && this.state.contactPoints.find((p) => p.id === input.contactPointId)?.businessId !== input.businessId) throw new StoreError('That contact point belongs to another prospect.', 'invalid');
      if ((input.channel === 'email') !== Boolean(input.subject?.trim())) throw new StoreError(input.channel === 'email' ? 'An email needs a subject.' : 'WhatsApp messages have no subject.', 'invalid');
      if (!input.body.trim() || input.body.length > 5000) throw new StoreError('A message needs a body of up to 5,000 characters.', 'invalid');
      if (!/^[0-9a-f]{64}$/.test(input.recipientHash)) throw new StoreError('Recipient hash missing.', 'invalid');
      return this.insert('outreachMessages', {
        ...input,
        bodyHash,
        status: 'draft',
        statusReason: null,
        sandbox: false,
        dedupeKey: null,
        decisionId: null,
        dispatchDecisionId: null,
        provider: null,
        providerMessageId: null,
        createdBy: this.userId,
        approvedBy: null,
        approvedAt: null,
        queuedAt: null,
        scheduledFor: null,
        sendingAt: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        cancelledBy: null,
        cancelledAt: null,
      });
    });
  };
  updateOutreachMessage: DataStore['updateOutreachMessage'] = async (id, patch) => {
    const current = this.state.outreachMessages.find((m) => m.id === id);
    if (!current) throw new StoreError('Message not found.', 'not_found');
    const subject = patch.subject !== undefined ? patch.subject : current.subject;
    const body = patch.body ?? current.body;
    const bodyHash = await sha256Hex(bodyHashInput(subject, body));
    const dedupeKey = await sha256Hex(dedupeKeyInput(DEMO_ORG_ID, { ...current, bodyHash }));
    return this.commit(() => {
      const before = this.state.outreachMessages.find((m) => m.id === id)!;
      const status = patch.status ?? before.status;
      const content = bodyHash !== before.bodyHash || (patch.parameters !== undefined && JSON.stringify(patch.parameters) !== JSON.stringify(before.parameters));
      if (content && (before.status !== 'draft' || status !== 'draft')) throw new StoreError('Only a draft can be edited; cancel this message and draft a new one.', 'invalid');
      const changes: Partial<OutreachMessage> = { statusReason: patch.statusReason ?? before.statusReason };
      if (content) Object.assign(changes, { subject, body, bodyHash, parameters: patch.parameters ?? before.parameters });
      if (status !== before.status) {
        const move = `${before.status}>${status}`;
        if (!PERSON_MOVES.includes(move)) throw new StoreError(`Sending and delivery are recorded by the server; this status change is not allowed (${move}).`, 'forbidden');
        changes.status = status;
        if (status === 'approved') {
          const d = this.state.eligibilityDecisions.find((x) => x.id === patch.decisionId);
          const fresh = d && Date.now() - new Date(d.createdAt).getTime() <= 3_600_000;
          if (!d || !fresh || d.messageId !== id || d.stage !== 'approval' || d.outcome !== 'eligible' || d.bodyHash !== before.bodyHash || d.recipientHash !== before.recipientHash || d.actorId !== this.userId) {
            throw new StoreError('Approval needs a current eligibility decision for this exact message.', 'invalid');
          }
          Object.assign(changes, { decisionId: d.id, approvedBy: this.userId, approvedAt: this.now() });
        } else if (status === 'draft') Object.assign(changes, { decisionId: null, approvedBy: null, approvedAt: null });
        else if (status === 'queued') {
          if (this.state.outreachMessages.some((m) => m.id !== id && m.dedupeKey === dedupeKey && DEDUPE_RESERVED.includes(m.status))) {
            throw new StoreError('The same text is already queued or sent to this recipient.', 'conflict');
          }
          const at = this.now();
          Object.assign(changes, { dedupeKey, queuedAt: at, scheduledFor: patch.scheduledFor ?? at });
        } else if (status === 'cancelled') Object.assign(changes, { cancelledBy: this.userId, cancelledAt: this.now() });
      }
      return this.update('outreachMessages', id, changes);
    });
  };
  recordMessageEvent: DataStore['recordMessageEvent'] = (id, patch, expectedStatus) =>
    this.commit(() => {
      const before = this.state.outreachMessages.find((m) => m.id === id);
      if (!before) throw new StoreError('Message not found.', 'not_found');
      if (expectedStatus && before.status !== expectedStatus) return null;
      const status = patch.status ?? before.status;
      const changes: Partial<OutreachMessage> = { ...patch };
      if (status !== before.status) {
        if (!WORKER_MOVES.includes(`${before.status}>${status}`)) throw new StoreError(`This message status change is not allowed (${before.status}>${status}).`, 'invalid');
        const at = this.now();
        if (status === 'sending') {
          const d = this.state.eligibilityDecisions.find((x) => x.id === patch.dispatchDecisionId);
          const fresh = d && Date.now() - new Date(d.createdAt).getTime() <= 600_000;
          if (!d || !fresh || d.messageId !== id || d.stage !== 'dispatch' || d.outcome !== 'eligible' || d.bodyHash !== before.bodyHash || d.recipientHash !== before.recipientHash) {
            throw new StoreError('Dispatch needs a current eligibility decision for this exact message.', 'invalid');
          }
          Object.assign(changes, { sandbox: d.sandbox, sendingAt: at });
        } else if (status === 'sent') changes.sentAt = patch.sentAt ?? before.sentAt ?? at;
        else if (status === 'delivered') Object.assign(changes, { sentAt: before.sentAt ?? at, deliveredAt: patch.deliveredAt ?? at });
        else if (status === 'read') Object.assign(changes, { sentAt: before.sentAt ?? at, readAt: patch.readAt ?? at });
        else if (['failed', 'bounced', 'complained', 'blocked'].includes(status)) changes.failedAt = patch.failedAt ?? at;
        else if (status === 'cancelled') Object.assign(changes, { cancelledBy: this.userId, cancelledAt: at });
        else if (status === 'queued') throw new StoreError('Queue a message with updateOutreachMessage.', 'invalid');
      }
      const after = { ...before, ...changes };
      if (['sent', 'delivered', 'read'].includes(after.status) && !(after.provider && after.providerMessageId)) throw new StoreError('A sent message records its provider message ID.', 'invalid');
      if (after.providerMessageId && this.state.outreachMessages.some((m) => m.id !== id && m.provider === after.provider && m.providerMessageId === after.providerMessageId)) {
        throw new StoreError('A matching record already exists.', 'conflict');
      }
      const row = this.update('outreachMessages', id, changes);
      // Mirrors suppress_on_delivery_failure.
      if ((row.status === 'bounced' || row.status === 'complained') && before.status !== row.status) {
        const sup = addSuppression(
          this.state.suppressions,
          {
            kind: row.channel === 'email' ? 'email' : 'phone',
            valueHash: row.recipientHash,
            businessId: null,
            channel: row.status === 'bounced' ? row.channel : null,
            hint: row.recipientHint,
            reason: row.status === 'bounced' ? 'bounced' : 'complaint',
            source: 'provider_event',
            consentRecordId: null,
            note: row.statusReason?.slice(0, 500) ?? null,
          },
          this.now(),
          null,
        );
        if (sup) this.audit('suppressions', 'insert', null, sup);
      }
      return row;
    });
  deleteOutreachMessage: DataStore['deleteOutreachMessage'] = (id) =>
    this.commit(() => {
      const m = this.state.outreachMessages.find((x) => x.id === id);
      if (m && m.status !== 'draft' && m.status !== 'cancelled') throw new StoreError('Only drafts and cancelled messages can be deleted; sent messages are the record of contact.', 'forbidden');
      this.remove('outreachMessages', (x) => x.id === id);
      for (const r of this.state.inboundMessages) if (r.replyToMessageId === id) r.replyToMessageId = null;
    });

  async listDecisions(messageId?: string) {
    return clone(this.state.eligibilityDecisions.filter((d) => !messageId || d.messageId === messageId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  // Mirrors guard_eligibility_decision: append-only, and a person is the actor of their own decisions.
  createDecision: DataStore['createDecision'] = (input) =>
    this.commit(() => {
      if ((input.outcome === 'eligible') !== (input.reasons.length === 0)) throw new StoreError('An eligible decision has no reasons against it.', 'invalid');
      return this.insert('eligibilityDecisions', { ...input, actorType: 'user', actorId: this.userId });
    });

  async listInboundMessages(businessId?: string) {
    return clone(this.state.inboundMessages.filter((m) => !businessId || m.businessId === businessId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
  }
  // Mirrors guard_inbound_message and suppress_on_inbound_opt_out. The demo's simulated provider
  // stands in for the server's webhook, so it may record provider messages.
  createInboundMessage: DataStore['createInboundMessage'] = (input) =>
    this.commit(() => {
      const existing = this.state.inboundMessages.find((m) => m.provider === input.provider && m.providerMessageId === input.providerMessageId);
      if (existing) return { message: clone(existing), created: false };
      if (input.optOut !== Boolean(input.optOutMatch)) throw new StoreError('Opt-out result is inconsistent.', 'invalid');
      if (input.receivedAt > new Date(Date.now() + 5 * 60_000).toISOString()) throw new StoreError('A message cannot be received in the future.', 'invalid');
      if (!/^[0-9a-f]{64}$/.test(input.senderHash)) throw new StoreError('Sender hash missing.', 'invalid');
      const message = this.insert('inboundMessages', { ...input, handledAt: null, handledBy: null, createdBy: input.provider === 'manual' ? this.userId : null });
      if (message.optOut) {
        const sup = addSuppression(
          this.state.suppressions,
          {
            kind: message.channel === 'email' ? 'email' : 'phone',
            valueHash: message.senderHash,
            businessId: null,
            channel: null,
            hint: message.senderHint,
            reason: 'opted_out',
            source: 'inbound_opt_out',
            consentRecordId: null,
            note: `Reply matched "${message.optOutMatch}"`.slice(0, 500),
          },
          this.now(),
          null,
        );
        if (sup) this.audit('suppressions', 'insert', null, sup);
      }
      return { message, created: true };
    });
  updateInboundMessage: DataStore['updateInboundMessage'] = (id, patch) =>
    this.commit(() => {
      const index = this.state.inboundMessages.findIndex((m) => m.id === id);
      if (index < 0) throw new StoreError('Message not found.', 'not_found');
      const before = this.state.inboundMessages[index];
      if (patch.businessId && !this.state.businesses.some((b) => b.id === patch.businessId)) throw new StoreError('Prospect not found.', 'not_found');
      const handled = patch.handledAt === undefined ? {} : patch.handledAt ? { handledAt: this.now(), handledBy: this.userId } : { handledAt: null, handledBy: null };
      const after: InboundMessage = {
        ...before,
        ...(patch.businessId !== undefined ? { businessId: patch.businessId } : {}),
        ...(patch.contactPointId !== undefined ? { contactPointId: patch.contactPointId } : {}),
        ...(patch.replyToMessageId !== undefined ? { replyToMessageId: patch.replyToMessageId } : {}),
        ...handled,
      };
      this.state.inboundMessages[index] = after;
      return clone(after);
    });

  // ── Responses and conversion (migration 008) ──
  async conversionSchemaAvailable() {
    return true;
  }
  async listReplyClassifications(inboundMessageIds?: readonly string[]) {
    const ids = inboundMessageIds ? new Set(inboundMessageIds) : null;
    return clone(this.state.replyClassifications.filter((c) => !ids || ids.has(c.inboundMessageId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  // Mirrors guard_reply_classification: append-only, and an opt-out reply stays an opt-out.
  createReplyClassification: DataStore['createReplyClassification'] = (input) =>
    this.commit(() => {
      const m = this.state.inboundMessages.find((x) => x.id === input.inboundMessageId);
      if (!m) throw new StoreError('Received message not found.', 'not_found');
      if (m.optOut && input.intent !== 'opt_out') throw new StoreError('This reply is an opt-out; it cannot be classified as anything else.', 'invalid');
      if (!REPLY_INTENTS.includes(input.intent)) throw new StoreError('Unknown intent.', 'invalid');
      if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100) throw new StoreError('Confidence is a whole number from 0 to 100.', 'invalid');
      if (input.summary && input.summary.length > 500) throw new StoreError('Keep the summary to 500 characters.', 'invalid');
      if (!input.classifierVersion || input.classifierVersion.length > 60) throw new StoreError('Classifier version missing.', 'invalid');
      // The demo always has a signed-in person, so 'system' rows are recorded as theirs, as in the database.
      const actorType = input.actorType === 'agent' ? 'agent' : 'user';
      if (input.source === 'person' && actorType !== 'user') throw new StoreError('A correction is recorded by a signed-in person.', 'forbidden');
      return this.insert('replyClassifications', {
        inboundMessageId: m.id,
        intent: input.intent,
        confidence: input.confidence,
        source: input.source,
        summary: input.summary,
        classifierVersion: input.classifierVersion,
        model: input.model,
        actorType,
        actorId: this.userId,
      });
    });
  async listChangeRequests(businessId?: string) {
    return clone(this.state.changeRequests.filter((c) => !businessId || c.businessId === businessId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  // Mirrors guard_proposal_change_request. The demo user is the owner, so the role checks always pass.
  createChangeRequest: DataStore['createChangeRequest'] = (input) =>
    this.commit(() => {
      const p = this.state.proposals.find((x) => x.id === input.proposalId);
      if (!p) throw new StoreError('Proposal not found.', 'not_found');
      if (p.status !== 'approved' && p.status !== 'sent') throw new StoreError('Change requests are recorded against an approved or issued proposal.', 'invalid');
      if (!CHANGE_KINDS.includes(input.kind)) throw new StoreError('Unknown kind of change.', 'invalid');
      const summary = input.summary.trim();
      if (!summary || summary.length > 1000) throw new StoreError('Describe the change in up to 1,000 characters.', 'invalid');
      if (input.inboundMessageId && !this.state.inboundMessages.some((m) => m.id === input.inboundMessageId)) throw new StoreError('Received message not found.', 'not_found');
      return this.insert('changeRequests', {
        proposalId: p.id,
        businessId: p.businessId,
        inboundMessageId: input.inboundMessageId,
        kind: input.kind,
        summary,
        status: 'open',
        decisionNote: null,
        requestedBy: this.userId,
        decidedBy: null,
        decidedAt: null,
      });
    });
  updateChangeRequest: DataStore['updateChangeRequest'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.changeRequests.find((c) => c.id === id);
      if (!before) throw new StoreError('Change request not found.', 'not_found');
      if (before.status !== 'open') throw new StoreError('This change request has been decided; record a new one.', 'invalid');
      if (patch.status === 'open') throw new StoreError('Approve, decline or withdraw the change request.', 'invalid');
      const note = patch.decisionNote?.trim() || null;
      if (note && note.length > 1000) throw new StoreError('Keep the note to 1,000 characters.', 'invalid');
      if ((patch.status === 'approved' || patch.status === 'declined') && !note) throw new StoreError('Explain the decision.', 'invalid');
      return this.update('changeRequests', id, { status: patch.status, decisionNote: note, decidedBy: this.userId, decidedAt: this.now() });
    });

  async sendingSchemaAvailable() {
    return true;
  }
  async listMessagePolicies() {
    return clone([...this.state.messagePolicies].sort((a, b) => a.status.localeCompare(b.status) || b.createdAt.localeCompare(a.createdAt)));
  }
  private checkPolicyFields(p: Pick<MessagePolicy, 'name' | 'dailyCap' | 'note'>) {
    if (!p.name.trim() || p.name.length > 120) throw new StoreError('Give the policy a name of up to 120 characters.', 'invalid');
    if (!Number.isInteger(p.dailyCap) || p.dailyCap < 1 || p.dailyCap > POLICY_DAILY_CAP_MAX) throw new StoreError(`The daily cap is between 1 and ${POLICY_DAILY_CAP_MAX}.`, 'invalid');
    if (p.note && p.note.length > 1000) throw new StoreError('Keep the note to 1,000 characters.', 'invalid');
  }
  /** Rules the template must meet for a policy to cover (or keep covering) it. */
  private policyTemplate(templateId: string, version?: number) {
    const t = this.state.messageTemplates.find((x) => x.id === templateId);
    if (!t) throw new StoreError('Template not found.', 'not_found');
    const issues = policyTemplateIssues(t);
    if (issues.length) throw new StoreError(issues[0], 'invalid');
    if (version !== undefined && t.version !== version) throw new StoreError('The template changed since this policy was set; create a new policy for the current version.', 'conflict');
    return t;
  }
  // Mirrors guard_message_policy in migration 007.
  createMessagePolicy: DataStore['createMessagePolicy'] = (input) =>
    this.commit(() => {
      this.checkPolicyFields(input);
      const t = this.policyTemplate(input.templateId);
      const at = Date.now();
      const expires = new Date(input.expiresAt).getTime();
      if (!(expires > at) || expires > at + POLICY_MAX_DAYS * 86_400_000) throw new StoreError(`A policy expires within ${POLICY_MAX_DAYS} days.`, 'invalid');
      if (this.state.messagePolicies.some((p) => p.templateId === t.id && p.templateVersion === t.version && p.status !== 'revoked')) {
        throw new StoreError('A policy already covers this template version.', 'conflict');
      }
      return this.insert('messagePolicies', {
        name: input.name.trim(),
        note: input.note?.trim() || null,
        dailyCap: input.dailyCap,
        expiresAt: new Date(expires).toISOString(),
        channel: t.channel,
        purpose: t.purpose as MessagePolicy['purpose'],
        templateId: t.id,
        templateVersion: t.version,
        status: 'active',
        approvedBy: this.userId,
        approvedAt: this.now(),
        revokedBy: null,
        revokedAt: null,
        createdBy: this.userId,
      });
    });
  updateMessagePolicy: DataStore['updateMessagePolicy'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.messagePolicies.find((p) => p.id === id);
      if (!before) throw new StoreError('Policy not found.', 'not_found');
      if (before.status === 'revoked') throw new StoreError('A revoked policy is final; create a new one.', 'invalid');
      const next = { ...before, ...patch, name: patch.name?.trim() ?? before.name, note: patch.note !== undefined ? patch.note?.trim() || null : before.note };
      this.checkPolicyFields(next);
      const changes: Partial<MessagePolicy> = { name: next.name, note: next.note, dailyCap: next.dailyCap };
      if (next.status !== before.status) {
        if (next.status === 'active') {
          if (new Date(before.expiresAt) <= new Date()) throw new StoreError('The policy has expired; create a new one.', 'invalid');
          this.policyTemplate(before.templateId, before.templateVersion);
        }
        changes.status = next.status;
        if (next.status === 'revoked') Object.assign(changes, { revokedBy: this.userId, revokedAt: this.now() });
      }
      return this.update('messagePolicies', id, changes);
    });
  async listAuditTrail(tables: string[], limit = 200) {
    return clone(
      this.state.audit
        .filter((e) => tables.includes(e.tableName))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  }

  // ── Activities and tasks ──
  async listActivities(businessId?: string) {
    return clone(this.state.activities.filter((a) => !businessId || a.businessId === businessId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
  }
  createActivity: DataStore['createActivity'] = (input) => this.commit(() => this.insert('activities', { ...input, actorId: this.userId }));
  async listTasks() {
    return clone(this.state.tasks);
  }
  createTask: DataStore['createTask'] = (input) => this.commit(() => this.insert('tasks', { ...input, createdBy: this.userId }));
  updateTask: DataStore['updateTask'] = (id, patch) => this.commit(() => this.update('tasks', id, patch));
  deleteTask: DataStore['deleteTask'] = (id) => this.commit(() => this.remove('tasks', (t) => t.id === id));

  // ── Reports (append-only) ──
  async listReports(businessId?: string) {
    return clone(this.state.reports.filter((r) => !businessId || r.businessId === businessId).sort((a, b) => b.version - a.version)).map(readReport);
  }
  createReport: DataStore['createReport'] = (input) =>
    this.commit(() => {
      const version = Math.max(0, ...this.state.reports.filter((r) => r.businessId === input.businessId).map((r) => r.version)) + 1;
      const row: OpportunityReport = { ...input, version, id: uuid(), organizationId: DEMO_ORG_ID, createdBy: this.userId, createdAt: this.now() };
      this.state.reports.push(row);
      return clone(row);
    });

  // ── Proposals ──
  async listProposals() {
    return clone(this.state.proposals);
  }
  async getProposal(id: string) {
    return clone(this.state.proposals.find((p) => p.id === id) ?? null);
  }
  private snapshot(p: Proposal) {
    this.state.proposalVersions.push({
      id: uuid(),
      organizationId: DEMO_ORG_ID,
      proposalId: p.id,
      version: p.version,
      status: p.status,
      title: p.title,
      content: clone(p.content),
      createdBy: this.userId,
      createdAt: this.now(),
    });
  }
  createProposal: DataStore['createProposal'] = (input) =>
    this.commit(() => {
      const row = this.insert('proposals', { ...input, version: 1, createdBy: this.userId });
      this.snapshot(row);
      return row;
    });
  updateProposal: DataStore['updateProposal'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.proposals.find((p) => p.id === id);
      if (!before) throw new StoreError('Proposal not found', 'not_found');
      const contentChanged = patch.content !== undefined && JSON.stringify(patch.content) !== JSON.stringify(before.content);
      if (contentChanged && before.status !== 'draft') {
        throw new StoreError('Only draft proposals can be edited. Revise the proposal to create a new draft.', 'conflict');
      }
      // Mirrors guard_proposal_acceptance in migration 008: the approval time is stamped on approval
      // and otherwise only cleared, and acceptance waits for change requests to be settled.
      if (patch.status === 'approved' && before.status !== 'approved') patch = { ...patch, approvedAt: this.now() };
      else if (patch.approvedAt !== undefined && patch.approvedAt !== before.approvedAt && patch.approvedAt !== null) {
        throw new StoreError('The approval time is set when the proposal is approved.', 'invalid');
      }
      if (patch.status === 'accepted' && before.status !== 'accepted') {
        const blockers = acceptanceBlockers(before, this.state.changeRequests);
        if (blockers.length) throw new StoreError(blockers[0], 'invalid');
      }
      const bump = contentChanged || (patch.status && patch.status !== before.status) || (patch.title && patch.title !== before.title);
      const after = this.update('proposals', id, { ...patch, version: bump ? before.version + 1 : before.version });
      if (bump) this.snapshot(after);
      return after;
    });
  deleteProposal: DataStore['deleteProposal'] = (id) =>
    this.commit(() => {
      this.remove('proposalVersions', (v) => v.proposalId === id);
      this.remove('changeRequests', (c) => c.proposalId === id);
      this.state.projects.forEach((p) => p.proposalId === id && (p.proposalId = null));
      this.remove('proposals', (p) => p.id === id);
    });
  async listProposalVersions(proposalId: string) {
    return clone(this.state.proposalVersions.filter((v) => v.proposalId === proposalId).sort((a, b) => b.version - a.version));
  }

  // ── Projects ──
  async listProjects() {
    return clone(this.state.projects);
  }
  createProject: DataStore['createProject'] = (input) => this.commit(() => this.insert('projects', { ...input, createdBy: this.userId }));
  updateProject: DataStore['updateProject'] = (id, patch) => this.commit(() => this.update('projects', id, patch));
  async listMilestones(projectId?: string) {
    return clone(this.state.milestones.filter((m) => !projectId || m.projectId === projectId).sort((a, b) => a.sortOrder - b.sortOrder));
  }
  createMilestone: DataStore['createMilestone'] = (input) => this.commit(() => this.insert('milestones', input));
  updateMilestone: DataStore['updateMilestone'] = (id, patch) => this.commit(() => this.update('milestones', id, patch));
  deleteMilestone: DataStore['deleteMilestone'] = (id) => this.commit(() => this.remove('milestones', (m) => m.id === id));

  // ── Website Studio (migration 012) ──
  async studioSchemaAvailable() {
    return true;
  }
  async listStudioProjects(businessId?: string) {
    return clone(this.state.studioProjects.filter((p) => !businessId || p.businessId === businessId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  async getStudioProject(id: string) {
    return clone(this.state.studioProjects.find((p) => p.id === id) ?? null);
  }
  createStudioProject: DataStore['createStudioProject'] = (input) =>
    this.commit(() => {
      const name = input.name.trim();
      if (!name || name.length > 200) throw new StoreError('Give the concept a name of 1–200 characters.', 'invalid');
      if (input.websiteUrl && !/^https?:\/\//i.test(input.websiteUrl)) throw new StoreError('The website address must start with http:// or https://.', 'invalid');
      if ((input.brief ?? '').length > 5000) throw new StoreError('The brief is limited to 5,000 characters.', 'invalid');
      // Mirrors studio_projects_business_uidx.
      const live = this.state.studioProjects.find((p) => p.businessId === input.businessId && p.status !== 'archived');
      if (live) throw new StoreError('This prospect already has a live website concept. Archive it before starting another.', 'conflict');
      if (!this.state.businesses.some((b) => b.id === input.businessId)) throw new StoreError('Prospect not found', 'not_found');
      const intelligenceStatus = input.intelligenceStatus ?? 'not_started';
      return this.insert('studioProjects', {
        businessId: input.businessId,
        name,
        status: input.status ?? 'draft',
        websiteUrl: input.websiteUrl ?? null,
        brief: input.brief ?? '',
        intelligenceStatus,
        // Mirrors studio_project_analysis_stamped.
        intelligenceAt: intelligenceStatus === 'not_started' ? (input.intelligenceAt ?? null) : (input.intelligenceAt ?? this.now()),
        intelligenceNote: input.intelligenceNote ?? null,
        createdBy: this.userId,
      });
    });
  updateStudioProject: DataStore['updateStudioProject'] = (id, patch) =>
    this.commit(() => {
      const before = this.state.studioProjects.find((p) => p.id === id);
      if (!before) throw new StoreError('Website concept not found', 'not_found');
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name || name.length > 200) throw new StoreError('Give the concept a name of 1–200 characters.', 'invalid');
        patch = { ...patch, name };
      }
      if (patch.websiteUrl && !/^https?:\/\//i.test(patch.websiteUrl)) throw new StoreError('The website address must start with http:// or https://.', 'invalid');
      if (patch.brief !== undefined && patch.brief.length > 5000) throw new StoreError('The brief is limited to 5,000 characters.', 'invalid');
      if ((patch.status ?? before.status) !== 'archived') {
        const live = this.state.studioProjects.find((p) => p.id !== id && p.businessId === before.businessId && p.status !== 'archived');
        if (live) throw new StoreError('This prospect already has a live website concept. Archive it before restoring another.', 'conflict');
      }
      const intelligenceStatus = patch.intelligenceStatus ?? before.intelligenceStatus;
      const intelligenceAt = patch.intelligenceAt !== undefined ? patch.intelligenceAt : before.intelligenceAt;
      // Mirrors studio_project_analysis_stamped.
      if (intelligenceStatus !== 'not_started' && !intelligenceAt) return this.update('studioProjects', id, { ...patch, intelligenceAt: this.now() });
      return this.update('studioProjects', id, patch);
    });
  deleteStudioProject: DataStore['deleteStudioProject'] = (id) =>
    this.commit(() => {
      if (!this.state.studioProjects.some((p) => p.id === id)) throw new StoreError('Website concept not found', 'not_found');
      this.remove('studioReviews', (r) => r.projectId === id);
      this.remove('studioObservations', (o) => o.projectId === id);
      this.remove('studioProjects', (p) => p.id === id);
    });
  async listStudioObservations(projectId?: string) {
    return clone(
      this.state.studioObservations
        .filter((o) => !projectId || o.projectId === projectId)
        .sort((a, b) => b.runNumber - a.runNumber || a.key.localeCompare(b.key)),
    );
  }
  createStudioObservations: DataStore['createStudioObservations'] = (input) =>
    this.commit(() => {
      if (!input.length) return [];
      const projectId = input[0].projectId;
      if (!this.state.studioProjects.some((p) => p.id === projectId)) throw new StoreError('Website concept not found', 'not_found');
      if (input.some((o) => o.projectId !== projectId)) throw new StoreError('Evidence is written for one concept at a time.', 'invalid');
      const seen = new Set(this.state.studioObservations.filter((o) => o.projectId === projectId).map((o) => `${o.runNumber}|${o.key}`));
      for (const observation of input) {
        const duplicate = seen.has(`${observation.runNumber}|${observation.key}`) ? ['This evidence was already recorded for this analysis.'] : [];
        const problems = [...studioObservationProblems(observation), ...duplicate];
        if (problems.length) throw new StoreError(problems[0], 'invalid');
        seen.add(`${observation.runNumber}|${observation.key}`);
      }
      return input.map((observation) => this.insert('studioObservations', { ...observation, createdBy: this.userId }));
    });
  async listStudioReviews(projectId?: string) {
    return clone(this.state.studioReviews.filter((r) => !projectId || r.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  createStudioReview: DataStore['createStudioReview'] = (input) =>
    this.commit(() => {
      if (!this.state.studioProjects.some((p) => p.id === input.projectId)) throw new StoreError('Website concept not found', 'not_found');
      const problems = studioReviewProblems(input);
      if (problems.length) throw new StoreError(problems[0], 'invalid');
      if (input.observationId && !this.state.studioObservations.some((o) => o.id === input.observationId && o.projectId === input.projectId)) {
        throw new StoreError('That evidence does not belong to this concept.', 'invalid');
      }
      return this.insert('studioReviews', { ...input, observationId: input.observationId ?? null, note: input.note.trim(), reviewerId: this.userId });
    });

  // ── Settings, audit, usage ──
  async getSettings() {
    return clone(this.state.organization.settings);
  }
  updateSettings: DataStore['updateSettings'] = (settings, organizationName) =>
    this.commit(() => {
      this.state.organization.settings = resolveSettings(settings);
      if (organizationName?.trim()) this.state.organization.name = organizationName.trim();
      return clone(this.state.organization.settings);
    });
  organizationName() {
    return this.state.organization.name;
  }
  async listAuditEvents(recordId: string) {
    return clone(this.state.audit.filter((e) => e.recordId === recordId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async listUsage(sinceIso: string) {
    return clone(this.state.usage.filter((u) => u.createdAt >= sinceIso));
  }
  /** The server cannot write to browser storage, so in demo mode the client records usage it was charged. */
  recordUsage: DataStore['recordUsage'] = (u) =>
    this.commit(() => {
      this.state.usage.push({ ...u, id: uuid(), organizationId: DEMO_ORG_ID, userId: this.userId, createdAt: this.now() });
    });

  // ── Team (cloud only) ──
  async listMembers(): Promise<Member[]> {
    return [{ userId: this.userId, email: 'demo@local', role: 'owner', createdAt: this.state.businesses[0]?.createdAt ?? this.now() }];
  }
  async listInvitations(): Promise<Invitation[]> {
    return [];
  }
  async createInvitation(): Promise<Invitation> {
    throw new StoreError('Team members require cloud mode (Supabase).', 'unavailable');
  }
  async deleteInvitation(): Promise<void> {
    throw new StoreError('Team members require cloud mode (Supabase).', 'unavailable');
  }
  async updateMemberRole(): Promise<void> {
    throw new StoreError('Team members require cloud mode (Supabase).', 'unavailable');
  }
  async removeMember(): Promise<void> {
    throw new StoreError('Team members require cloud mode (Supabase).', 'unavailable');
  }
}
