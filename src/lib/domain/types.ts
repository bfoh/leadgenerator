import type {
  ActivityType,
  BudgetSignal,
  BusinessStatus,
  Confidence,
  ContactPermission,
  InterestLevel,
  InvoiceStatus,
  LawfulBasis,
  MaintenanceStatus,
  ProjectStatus,
  ProjectType,
  ProposalStatus,
  Role,
  SocialPlatform,
  SourceKind,
  Stage,
  VerificationMethod,
  VerificationOutcome,
  WebsiteStatus,
} from './constants';
import type { ReportContent, ReportValidation } from './report';
import type { ProposalContent } from './proposal';
import type { ScoreResult } from './scoring';
import type { EvidencePack } from './evidence';
import type { WorkflowState } from '@/lib/automation/constants';
import type { WebsiteClassification } from './website-assessment';
import type { AuditCategory, AuditKind, AuditSeverity, FindingEvidence } from './audit';

/** ISO-8601 timestamp string. */
export type Timestamp = string;
/** YYYY-MM-DD. */
export type DateString = string;

export interface SocialProfile {
  platform: SocialPlatform;
  url: string;
}

export interface Business {
  id: string;
  organizationId: string;
  name: string;
  category: string;
  country: string;
  region: string | null;
  city: string;
  neighborhood: string | null;
  address: string | null;
  businessStatus: BusinessStatus;

  officialWebsite: string | null;
  websiteStatus: WebsiteStatus;
  websiteOutdated: boolean;
  socialProfiles: SocialProfile[];

  enquiryChannel: string | null;
  phone: string | null;
  email: string | null;
  contactSource: string | null;
  contactPermission: ContactPermission;
  lawfulBasis: LawfulBasis | null;
  permissionEvidence: string | null;
  permissionRecordedAt: Timestamp | null;
  optedOutAt: Timestamp | null;

  interestLevel: InterestLevel;
  budgetSignal: BudgetSignal;
  serviceNeeds: string[];

  opportunityScore: number | null;
  confidenceScore: number | null;
  scoreBreakdown: ScoreResult | null;
  scoredAt: Timestamp | null;

  stage: Stage;
  ownerId: string | null;
  estimatedValue: number | null;
  expectedCloseDate: DateString | null;
  lostReason: string | null;
  nextAction: string | null;
  nextActionDue: DateString | null;
  lastInteractionAt: Timestamp | null;

  notes: string;
  sourceUrl: string | null;
  sourceKind: SourceKind;
  placesPlaceId: string | null;
  legacyId: string | null;
  legacy: Record<string, unknown> | null;

  /** Automation lifecycle (migration 003). Absent when the database predates it; see workflowStateOf(). */
  workflowState?: WorkflowState;
  workflowStateAt?: Timestamp;
  workflowStateReason?: string | null;
  workflowStateActor?: 'user' | 'agent' | 'system';

  /** Identity and score overrides (migration 004). Absent when the database predates it. */
  alternateNames?: string[];
  parentBusinessId?: string | null;
  mergedIntoId?: string | null;
  identityConfidence?: number | null;
  identityCheckedAt?: Timestamp | null;
  scoreOverride?: ScoreOverride | null;

  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A person's override of the computed opportunity score. The computed score stays in scoreBreakdown. */
export interface ScoreOverride {
  opportunity: number;
  justification: string;
  by: string | null;
  byName: string;
  at: Timestamp;
}

export interface TechnicalCheck {
  url: string;
  finalUrl: string | null;
  ok: boolean;
  status: number | null;
  redirects: { url: string; status: number }[];
  https: boolean;
  responseMs: number | null;
  title: string | null;
  hasViewport: boolean | null;
  generator: string | null;
  error: string | null;
  checkedAt: Timestamp;
}

export interface WebsiteVerification {
  id: string;
  organizationId: string;
  businessId: string;
  status: VerificationOutcome;
  checkedAt: Timestamp;
  methods: VerificationMethod[];
  domain: string | null;
  sourceUrl: string | null;
  evidenceSummary: string;
  confidence: Confidence;
  websiteOutdated: boolean;
  technical: TechnicalCheck | null;
  reviewerId: string | null;
  reviewerName: string | null;
  nextCheckAt: DateString | null;
  /** Agent evidence and review (migration 004). Absent on manual records and older databases. */
  actorType?: 'user' | 'agent';
  classification?: WebsiteClassification | null;
  confidenceScore?: number | null;
  evidence?: Record<string, unknown> | null;
  agentVersion?: string | null;
  jobId?: string | null;
  reviewStatus?: VerificationReviewStatus;
  reviewedBy?: string | null;
  reviewedAt?: Timestamp | null;
  reviewNote?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type VerificationReviewStatus = 'not_required' | 'pending' | 'confirmed' | 'rejected';

export type IdentityRelation = 'possible_duplicate' | 'same_business' | 'branch' | 'distinct';
export type IdentityLinkStatus = 'suggested' | 'confirmed' | 'dismissed';

/** A relationship between two prospects: a suggested duplicate, a confirmed merge, a branch, or "different". */
export interface IdentityLink {
  id: string;
  organizationId: string;
  businessId: string;
  otherBusinessId: string;
  relation: IdentityRelation;
  status: IdentityLinkStatus;
  strength: 'exact' | 'likely' | 'possible';
  reasons: string[];
  suggestedBy: 'user' | 'agent';
  agentVersion: string | null;
  decidedBy: string | null;
  decidedAt: Timestamp | null;
  note: string | null;
  mergeSnapshot: Record<string, unknown> | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type FindingReviewStatus = 'unreviewed' | 'accepted' | 'dismissed' | 'superseded';

export interface AuditFinding {
  id: string;
  organizationId: string;
  businessId: string;
  findingKey: string;
  category: AuditCategory;
  kind: AuditKind;
  title: string;
  evidence: FindingEvidence[];
  severity: AuditSeverity;
  confidence: number;
  impactHypothesis: string;
  recommendation: string;
  reviewStatus: FindingReviewStatus;
  reviewedBy: string | null;
  reviewedAt: Timestamp | null;
  reviewNote: string | null;
  verificationId: string | null;
  jobId: string | null;
  agentVersion: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Activity {
  id: string;
  organizationId: string;
  businessId: string;
  type: ActivityType;
  summary: string;
  details: Record<string, unknown> | null;
  occurredAt: Timestamp;
  scheduledFor: Timestamp | null;
  actorId: string | null;
  createdAt: Timestamp;
}

export interface Task {
  id: string;
  organizationId: string;
  businessId: string | null;
  projectId: string | null;
  title: string;
  dueDate: DateString | null;
  completedAt: Timestamp | null;
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type ReportGenerator = 'deterministic' | 'ai' | 'manual_edit';

export interface ReportUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface OpportunityReport {
  id: string;
  organizationId: string;
  businessId: string;
  version: number;
  content: ReportContent;
  generator: ReportGenerator;
  model: string | null;
  inputSnapshot: EvidencePack;
  validation: ReportValidation | null;
  usage: ReportUsage | null;
  createdBy: string | null;
  createdAt: Timestamp;
}

export interface Proposal {
  id: string;
  organizationId: string;
  businessId: string;
  reportId: string | null;
  title: string;
  status: ProposalStatus;
  packageKey: string | null;
  content: ProposalContent;
  currency: string;
  oneTimeTotal: number | null;
  monthlyTotal: number | null;
  version: number;
  approvedAt: Timestamp | null;
  approvedBy: string | null;
  sentAt: Timestamp | null;
  decidedAt: Timestamp | null;
  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProposalVersion {
  id: string;
  organizationId: string;
  proposalId: string;
  version: number;
  status: ProposalStatus;
  title: string;
  content: ProposalContent;
  createdBy: string | null;
  createdAt: Timestamp;
}

export interface Project {
  id: string;
  organizationId: string;
  businessId: string;
  proposalId: string | null;
  name: string;
  projectType: ProjectType;
  status: ProjectStatus;
  contractValue: number | null;
  currency: string;
  startDate: DateString | null;
  dueDate: DateString | null;
  deploymentUrl: string | null;
  maintenanceStatus: MaintenanceStatus;
  invoiceStatus: InvoiceStatus;
  deliverables: string[];
  notes: string;
  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ProjectMilestone {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  dueDate: DateString | null;
  completedAt: Timestamp | null;
  sortOrder: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  tableName: string;
  recordId: string;
  action: 'insert' | 'update' | 'delete';
  actorId: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  createdAt: Timestamp;
}

export interface UsageRecord {
  id: string;
  organizationId: string;
  userId: string | null;
  provider: string;
  operation: string;
  units: number;
  estimatedCostUsd: number;
  metadata: Record<string, unknown> | null;
  createdAt: Timestamp;
}

export interface Member {
  userId: string;
  email: string | null;
  role: Role;
  createdAt: Timestamp;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  createdAt: Timestamp;
  acceptedAt: Timestamp | null;
}

export interface Workspace {
  mode: 'demo' | 'cloud';
  organizationId: string;
  organizationName: string;
  userId: string;
  email: string | null;
  role: Role;
}

type System = 'id' | 'organizationId' | 'createdAt' | 'updatedAt';
export type BusinessInsert = Omit<Business, System | 'createdBy'>;
export type VerificationInsert = Omit<WebsiteVerification, System>;
export type IdentityLinkInsert = Omit<IdentityLink, System>;
export type AuditFindingInsert = Omit<AuditFinding, System | 'reviewedBy' | 'reviewedAt' | 'reviewNote'>;
export type ActivityInsert = Omit<Activity, 'id' | 'organizationId' | 'createdAt'>;
export type TaskInsert = Omit<Task, System | 'createdBy'>;
export type ReportInsert = Omit<OpportunityReport, 'id' | 'organizationId' | 'createdAt' | 'version' | 'createdBy'>;
export type ProposalInsert = Omit<Proposal, System | 'version' | 'createdBy'>;
export type ProjectInsert = Omit<Project, System | 'createdBy'>;
export type MilestoneInsert = Omit<ProjectMilestone, System>;
export type UsageInsert = Pick<UsageRecord, 'provider' | 'operation' | 'units' | 'estimatedCostUsd' | 'metadata'>;
