import type { ResourceEntry, ResourceEntryInsert } from '@/lib/domain/business-resources';
import type {
  BusinessSocialSource,
  ResearchObservation,
  ResearchObservationInsert,
  SocialSourceInsert,
  SocialVerificationStatus,
} from '@/lib/domain/social-research';
// Persistence contract shared by demo mode (LocalStore) and cloud mode (SupabaseStore).
// Business rules live in services.ts, not in implementations.

import type { WorkflowTransition } from '@/lib/automation/types';
import type { Role } from '@/lib/domain/constants';
import type { ConsentInsert, ConsentRecord, ContactPoint, ContactPointInsert, ContactPointPatch, Suppression, SuppressionInsert } from '@/lib/domain/contacts';
import type { ChangeRequest, ChangeRequestInsert, ChangeRequestPatch } from '@/lib/domain/conversion';
import type { MergeableField } from '@/lib/domain/identity';
import type {
  DecisionInsert,
  EligibilityDecision,
  InboundInsert,
  InboundMessage,
  InboundPatch,
  MessageEventPatch,
  MessagePolicy,
  MessagePolicyInsert,
  MessagePolicyPatch,
  MessageStatus,
  MessageTemplate,
  OutreachMessage,
  OutreachMessageInsert,
  OutreachMessagePatch,
  TemplateInsert,
  TemplatePatch,
} from '@/lib/domain/messaging';
import type { ClassificationInsert, ReplyClassification } from '@/lib/domain/replies';
import type { OrgSettings } from '@/lib/domain/settings';
import type { StudioObservation, StudioObservationInsert, StudioProject, StudioProjectInsert, StudioProjectPatch, StudioReview, StudioReviewInsert } from '@/lib/domain/studio';
import type {
  StudioAsset,
  StudioAssetEvent,
  StudioAssetEventInsert,
  StudioAssetInsert,
  StudioAssetPatch,
  StudioAssetReference,
  StudioAssetReferenceInsert,
  StudioBrandKit,
  StudioBrandKitApproval,
  StudioBrandKitApprovalInsert,
  StudioBrandKitVersion,
  StudioBrandKitVersionInsert,
} from '@/lib/domain/studio-assets';
import type {
  StudioCreativeBrief,
  StudioCreativeBriefInsert,
  StudioCreativeBriefReview,
  StudioCreativeBriefReviewInsert,
  StudioCreativeDirection,
  StudioCreativeDirectionInsert,
  StudioCreativeDirectionReview,
  StudioCreativeDirectionReviewInsert,
} from '@/lib/domain/creative-direction';
import type { StudioWebsitePrototype, StudioWebsitePrototypeInsert } from '@/lib/domain/website-prototype';
import type {
  Activity,
  ActivityInsert,
  AuditEvent,
  AuditFinding,
  AuditFindingInsert,
  Business,
  BusinessInsert,
  IdentityLink,
  IdentityLinkInsert,
  Invitation,
  Member,
  MilestoneInsert,
  OpportunityReport,
  Project,
  ProjectInsert,
  ProjectMilestone,
  Proposal,
  ProposalInsert,
  ProposalVersion,
  ReportInsert,
  Task,
  TaskInsert,
  UsageInsert,
  UsageRecord,
  VerificationInsert,
  WebsiteVerification,
} from '@/lib/domain/types';

export interface DataStore {
  readonly mode: 'demo' | 'cloud';

  listBusinesses(): Promise<Business[]>;
  getBusiness(id: string): Promise<Business | null>;
  createBusiness(input: BusinessInsert): Promise<Business>;
  updateBusiness(id: string, patch: Partial<BusinessInsert>): Promise<Business>;
  deleteBusiness(id: string): Promise<void>;
  /** Automation lifecycle history (migration 003); empty when the database predates it. */
  listWorkflowTransitions(businessId?: string): Promise<WorkflowTransition[]>;

  listVerifications(businessId?: string): Promise<WebsiteVerification[]>;
  createVerification(input: VerificationInsert): Promise<WebsiteVerification>;
  /** Agent records accept only review changes (reviewStatus, reviewNote); see migration 004. */
  updateVerification(id: string, patch: Partial<VerificationInsert>): Promise<WebsiteVerification>;

  /** False when the cloud database has not had migration 004 (identity, audit, agent evidence). */
  researchSchemaAvailable(): Promise<boolean>;
  listIdentityLinks(businessId?: string): Promise<IdentityLink[]>;
  createIdentityLink(input: IdentityLinkInsert): Promise<IdentityLink>;
  updateIdentityLink(id: string, patch: Partial<Pick<IdentityLink, 'relation' | 'status' | 'note'>>): Promise<IdentityLink>;
  /** Owners/admins: archives the secondary as merged into the primary, copies the listed empty fields, carries opt-outs over. */
  mergeBusinesses(primaryId: string, secondaryId: string, fields: MergeableField[], note: string | null): Promise<{ primary: Business; secondary: Business }>;
  /** Owners/admins: restores a merged record to its previous stage and marks the pair as different businesses. */
  undoMerge(secondaryId: string): Promise<Business>;
  listAuditFindings(businessId?: string): Promise<AuditFinding[]>;
  createAuditFindings(input: AuditFindingInsert[]): Promise<AuditFinding[]>;
  /** Findings are evidence records: only their review fields change. */
  updateAuditFinding(id: string, patch: Partial<Pick<AuditFinding, 'reviewStatus' | 'reviewNote'>>): Promise<AuditFinding>;

  /** False when the cloud database has not had migration 005 (contact points, consent, suppression). */
  contactSchemaAvailable(): Promise<boolean>;
  listContactPoints(businessId?: string): Promise<ContactPoint[]>;
  /** Provenance is fixed at insert; a corrected value is a new record. */
  createContactPoints(input: ContactPointInsert[]): Promise<ContactPoint[]>;
  updateContactPoint(id: string, patch: ContactPointPatch): Promise<ContactPoint>;
  /** Owners/admins. Consent history and suppressions are kept. */
  deleteContactPoints(ids: string[]): Promise<void>;
  listConsentRecords(businessId?: string): Promise<ConsentRecord[]>;
  /** Append-only and recorded by a signed-in person. A withdrawal suppresses the contact. */
  createConsentRecord(input: ConsentInsert): Promise<ConsentRecord>;
  listSuppressions(): Promise<Suppression[]>;
  createSuppression(input: SuppressionInsert): Promise<Suppression>;
  /** Owners/admins, against a newer consent record. Suppressions are never deleted. */
  liftSuppression(id: string, lift: { reason: string; consentId: string }): Promise<Suppression>;

  /** False when the cloud database has not had migration 006 (templates, outbound queue, received messages). */
  messagingSchemaAvailable(): Promise<boolean>;
  listTemplates(): Promise<MessageTemplate[]>;
  /** Owners/admins. New templates are drafts; editing content returns a template to draft. */
  createTemplate(input: TemplateInsert): Promise<MessageTemplate>;
  /** Email: owners/admins approve, pause and disable. WhatsApp status comes from Meta (people may only disable). */
  updateTemplate(id: string, patch: TemplatePatch): Promise<MessageTemplate>;
  deleteTemplate(id: string): Promise<void>;
  listOutreachMessages(businessId?: string): Promise<OutreachMessage[]>;
  getOutreachMessage(id: string): Promise<OutreachMessage | null>;
  /** Always a draft; the store computes the body hash. */
  createOutreachMessage(input: OutreachMessageInsert): Promise<OutreachMessage>;
  /** Draft edits, and the moves people make: approve (with a current decision), back to draft, queue, cancel. */
  updateOutreachMessage(id: string, patch: OutreachMessagePatch): Promise<OutreachMessage>;
  /**
   * Dispatch and delivery facts. The database accepts them only from the server's service-role
   * client; demo mode's simulated provider uses it too. With expectedStatus the change applies only
   * if the message still has that status (null otherwise), so two dispatchers cannot both send.
   */
  recordMessageEvent(id: string, patch: MessageEventPatch, expectedStatus?: MessageStatus): Promise<OutreachMessage | null>;
  /** Owners/admins; drafts and cancelled messages only. */
  deleteOutreachMessage(id: string): Promise<void>;
  listDecisions(messageId?: string): Promise<EligibilityDecision[]>;
  /** Append-only. */
  createDecision(input: DecisionInsert): Promise<EligibilityDecision>;
  listInboundMessages(businessId?: string): Promise<InboundMessage[]>;
  /** Idempotent per provider message ID. People may only log provider 'manual'; an opt-out suppresses the sender. */
  createInboundMessage(input: InboundInsert): Promise<{ message: InboundMessage; created: boolean }>;
  updateInboundMessage(id: string, patch: InboundPatch): Promise<InboundMessage>;

  /** False when the cloud database has not had migration 007 (approved-message policies, sending policy). */
  sendingSchemaAvailable(): Promise<boolean>;
  listMessagePolicies(): Promise<MessagePolicy[]>;
  /** Owners/admins. Covers the template's current approved version; the creator is the approver. */
  createMessagePolicy(input: MessagePolicyInsert): Promise<MessagePolicy>;
  /** Owners/admins: rename, change the cap or note, pause, resume, revoke (final). Policies are never deleted. */
  updateMessagePolicy(id: string, patch: MessagePolicyPatch): Promise<MessagePolicy>;
  /** Audit events for the named tables (database names), newest first. */
  listAuditTrail(tables: string[], limit?: number): Promise<AuditEvent[]>;

  /** False when the cloud database has not had migration 008 (reply classifications, proposal change requests). */
  conversionSchemaAvailable(): Promise<boolean>;
  /** Newest first; for the given received messages only, when listed (a message's prospect can change after it arrives). */
  listReplyClassifications(inboundMessageIds?: readonly string[]): Promise<ReplyClassification[]>;
  /** Append-only. An opt-out reply can only be classified as an opt-out; corrections by people use source 'person'. */
  createReplyClassification(input: ClassificationInsert): Promise<ReplyClassification>;
  listChangeRequests(businessId?: string): Promise<ChangeRequest[]>;
  /** Against an approved or issued proposal; starts open. */
  createChangeRequest(input: ChangeRequestInsert): Promise<ChangeRequest>;
  /** Owners/admins approve or decline (with a note); the requester or an owner/admin withdraws. Final. */
  updateChangeRequest(id: string, patch: ChangeRequestPatch): Promise<ChangeRequest>;

  listActivities(businessId?: string): Promise<Activity[]>;
  createActivity(input: ActivityInsert): Promise<Activity>;

  listTasks(): Promise<Task[]>;
  createTask(input: TaskInsert): Promise<Task>;
  updateTask(id: string, patch: Partial<TaskInsert>): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  listReports(businessId?: string): Promise<OpportunityReport[]>;
  createReport(input: ReportInsert): Promise<OpportunityReport>;

  listProposals(): Promise<Proposal[]>;
  getProposal(id: string): Promise<Proposal | null>;
  createProposal(input: ProposalInsert): Promise<Proposal>;
  updateProposal(id: string, patch: Partial<ProposalInsert>): Promise<Proposal>;
  deleteProposal(id: string): Promise<void>;
  listProposalVersions(proposalId: string): Promise<ProposalVersion[]>;

  listProjects(): Promise<Project[]>;
  createProject(input: ProjectInsert): Promise<Project>;
  updateProject(id: string, patch: Partial<ProjectInsert>): Promise<Project>;
  listMilestones(projectId?: string): Promise<ProjectMilestone[]>;
  createMilestone(input: MilestoneInsert): Promise<ProjectMilestone>;
  updateMilestone(id: string, patch: Partial<MilestoneInsert>): Promise<ProjectMilestone>;
  deleteMilestone(id: string): Promise<void>;

  /** False when the cloud database has not had migration 012 (Studio concepts and their evidence). */
  studioSchemaAvailable(): Promise<boolean>;
  listStudioProjects(businessId?: string): Promise<StudioProject[]>;
  getStudioProject(id: string): Promise<StudioProject | null>;
  /** One live (non-archived) concept per business; an archived one does not block a new concept. */
  createStudioProject(input: StudioProjectInsert): Promise<StudioProject>;
  /** The concept itself is editable; its evidence is not. */
  updateStudioProject(id: string, patch: StudioProjectPatch): Promise<StudioProject>;
  /** Owners/admins. Removes the concept with its evidence and reviews. */
  deleteStudioProject(id: string): Promise<void>;
  /** Append-only evidence, newest run first. */
  listStudioObservations(projectId?: string): Promise<StudioObservation[]>;
  createStudioObservations(input: StudioObservationInsert[]): Promise<StudioObservation[]>;
  /** Append-only decisions, newest first. */
  listStudioReviews(projectId?: string): Promise<StudioReview[]>;
  createStudioReview(input: StudioReviewInsert): Promise<StudioReview>;

  /** False when the cloud database has not had migration 013 (asset vault, Brand Kit, storage bucket). */
  assetVaultAvailable(): Promise<boolean>;
  resourceCollectorAvailable(): Promise<boolean>;
  listResourceEntries(businessId: string): Promise<ResourceEntry[]>;
  createResourceEntry(input: ResourceEntryInsert): Promise<ResourceEntry>;
  revokeResourceEntry(id: string): Promise<ResourceEntry>;
  /** False when the cloud database has not had migration 017 (social sources, research observations). */
  socialResearchAvailable(): Promise<boolean>;
  /** Active and revoked links, newest capture first. Optional business filter for one prospect. */
  listSocialSources(businessId?: string): Promise<BusinessSocialSource[]>;
  createSocialSource(input: SocialSourceInsert): Promise<BusinessSocialSource>;
  /** Forward-only; the database guard refuses a downgrade or a changed profile identity. */
  updateSocialSourceVerification(
    id: string,
    patch: { verificationStatus: SocialVerificationStatus; verificationEvidence: string },
  ): Promise<BusinessSocialSource>;
  revokeSocialSource(id: string): Promise<BusinessSocialSource>;
  /** Observations with provenance and a status; revoked entries are excluded from kits. */
  listResearchObservations(businessId?: string): Promise<ResearchObservation[]>;
  createResearchObservation(input: ResearchObservationInsert): Promise<ResearchObservation>;
  revokeResearchObservation(id: string): Promise<ResearchObservation>;
  listStudioAssets(projectId?: string): Promise<StudioAsset[]>;
  getStudioAsset(id: string): Promise<StudioAsset | null>;
  createStudioAsset(input: StudioAssetInsert): Promise<StudioAsset>;
  updateStudioAsset(id: string, patch: StudioAssetPatch): Promise<StudioAsset>;
  /** Owners/admins. Removes the record; the caller removes the stored file first. */
  deleteStudioAsset(id: string): Promise<void>;
  /** Append-only history, newest first. */
  listStudioAssetEvents(projectId?: string): Promise<StudioAssetEvent[]>;
  createStudioAssetEvent(input: StudioAssetEventInsert): Promise<StudioAssetEvent>;
  /** Remote material, recorded but never imported. */
  listStudioAssetReferences(projectId?: string): Promise<StudioAssetReference[]>;
  createStudioAssetReference(input: StudioAssetReferenceInsert): Promise<StudioAssetReference>;
  updateStudioAssetReference(id: string, patch: Partial<Pick<StudioAssetReference, 'status' | 'note'>>): Promise<StudioAssetReference>;
  deleteStudioAssetReference(id: string): Promise<void>;
  /** The kit belongs to one concept; its versions are immutable and approvals are append-only. */
  getStudioBrandKit(projectId: string): Promise<StudioBrandKit | null>;
  createStudioBrandKit(projectId: string): Promise<StudioBrandKit>;
  listStudioBrandKitVersions(kitId: string): Promise<StudioBrandKitVersion[]>;
  createStudioBrandKitVersion(input: StudioBrandKitVersionInsert): Promise<StudioBrandKitVersion>;
  listStudioBrandKitApprovals(kitId: string): Promise<StudioBrandKitApproval[]>;
  createStudioBrandKitApproval(input: StudioBrandKitApprovalInsert): Promise<StudioBrandKitApproval>;

  /** False when the cloud database has not had migration 014 (creative direction). */
  creativeDirectionSchemaAvailable(): Promise<boolean>;
  /** Immutable, numbered briefs for one concept, newest first. */
  listStudioCreativeBriefs(projectId?: string): Promise<StudioCreativeBrief[]>;
  getStudioCreativeBrief(id: string): Promise<StudioCreativeBrief | null>;
  createStudioCreativeBrief(input: StudioCreativeBriefInsert): Promise<StudioCreativeBrief>;
  /** Confirm, reject or note; append-only. */
  listStudioCreativeBriefReviews(projectId?: string): Promise<StudioCreativeBriefReview[]>;
  createStudioCreativeBriefReview(input: StudioCreativeBriefReviewInsert): Promise<StudioCreativeBriefReview>;
  /** Immutable direction sets, each holding three concepts, newest first. */
  listStudioCreativeDirections(projectId?: string): Promise<StudioCreativeDirection[]>;
  getStudioCreativeDirection(id: string): Promise<StudioCreativeDirection | null>;
  createStudioCreativeDirection(input: StudioCreativeDirectionInsert): Promise<StudioCreativeDirection>;
  /** Feedback, change requests, approvals and rejections; append-only. */
  listStudioCreativeDirectionReviews(projectId?: string): Promise<StudioCreativeDirectionReview[]>;
  createStudioCreativeDirectionReview(input: StudioCreativeDirectionReviewInsert): Promise<StudioCreativeDirectionReview>;

  /** False when the cloud database has not had migration 015 (rendered website prototypes). */
  websitePrototypeSchemaAvailable(): Promise<boolean>;
  /** Immutable rendered blueprints for one concept, newest first. */
  listStudioWebsitePrototypes(projectId?: string): Promise<StudioWebsitePrototype[]>;
  createStudioWebsitePrototype(input: StudioWebsitePrototypeInsert): Promise<StudioWebsitePrototype>;

  getSettings(): Promise<OrgSettings>;
  updateSettings(settings: OrgSettings, organizationName?: string): Promise<OrgSettings>;

  listAuditEvents(recordId: string): Promise<AuditEvent[]>;
  listUsage(sinceIso: string): Promise<UsageRecord[]>;
  /** Insert-only usage log: client-side charges in demo mode, and data exports in both modes. */
  recordUsage(usage: UsageInsert): Promise<void>;

  listMembers(): Promise<Member[]>;
  listInvitations(): Promise<Invitation[]>;
  createInvitation(email: string, role: Role): Promise<Invitation>;
  deleteInvitation(id: string): Promise<void>;
  updateMemberRole(userId: string, role: Role): Promise<void>;
  removeMember(userId: string): Promise<void>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'forbidden' | 'conflict' | 'invalid' | 'unavailable' = 'invalid',
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

export const RESEARCH_MIGRATION_REQUIRED =
  'Apply database migration 004 (supabase/migrations/004_research_verification.sql) to use agent verification, identity, audit and score override features.';

export const MESSAGING_MIGRATION_REQUIRED =
  'Apply database migration 006 (supabase/migrations/006_messaging.sql) to use message templates, the outbound queue and received messages.';

export const SENDING_MIGRATION_REQUIRED =
  'Apply database migration 007 (supabase/migrations/007_sending_policy.sql) to use message policies, quiet hours, daily limits and scheduling.';

export const CONVERSION_MIGRATION_REQUIRED =
  'Apply database migration 008 (supabase/migrations/008_response_conversion.sql) to use reply classification and proposal change requests.';

export const CONTACTS_MIGRATION_REQUIRED =
  'Apply database migration 005 (supabase/migrations/005_contact_intelligence.sql) to use contact points, consent records and the suppression list.';

export const STUDIO_MIGRATION_REQUIRED =
  'Apply database migration 012 (supabase/migrations/012_studio_brand_intelligence.sql) to use website concepts and their evidence.';

export const ASSET_VAULT_MIGRATION_REQUIRED =
  'Apply database migration 013 (supabase/migrations/013_studio_asset_vault.sql) to use the asset vault, Brand Kit and approved exports.';

export const CREATIVE_DIRECTION_MIGRATION_REQUIRED =
  'Apply database migration 014 (supabase/migrations/014_studio_creative_direction.sql) to use the Creative Direction Brief, territories and approvals.';

export const WEBSITE_PROTOTYPE_MIGRATION_REQUIRED =
  'Apply database migration 015 (supabase/migrations/015_studio_website_prototypes.sql) to save rendered website prototype versions.';

export const SOCIAL_RESEARCH_MIGRATION_REQUIRED =
  'Apply database migration 017 (supabase/migrations/017_social_research_intelligence.sql) to link social sources and record research observations.';
