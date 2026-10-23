// Automation vocabularies. CHECK constraints in supabase/migrations/003 mirror these lists — change
// both together.

import type { Tone } from '@/lib/domain/constants';

export const AGENT_KEYS = [
  'discovery',
  'business_identity',
  'website_verification',
  'contact_research',
  'contact_validation',
  'digital_audit',
  'opportunity_scoring',
  'opportunity_report',
  'proposal_generation',
  'outreach_drafting',
  'permission_approval',
  'outreach_execution',
  'response_classification',
  'follow_up_planning',
  'sales_intelligence',
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

/** Agents whose work leaves the workspace. Never retried automatically when delivery is uncertain. */
export const OUTBOUND_AGENTS: readonly AgentKey[] = ['outreach_execution'];

export const AUTOMATION_MODES = ['research_only', 'research_and_proposals', 'approval_based_outreach', 'eligible_automated_outreach'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const MODE_META: Record<AutomationMode, { label: string; description: string; outreach: boolean }> = {
  research_only: {
    label: 'Research only',
    description: 'Agents research, verify, score and write internal reports. Nothing is drafted for or sent to a business.',
    outreach: false,
  },
  research_and_proposals: {
    label: 'Research + proposals',
    description: 'Adds proposal drafts, message drafts and follow-up tasks for your team. Nothing is approved, issued or sent without a person.',
    outreach: false,
  },
  approval_based_outreach: {
    label: 'Approval-based outreach',
    description: 'Adds sending: each message goes only after a person approves it and the eligibility gateway passes it again at dispatch.',
    outreach: true,
  },
  eligible_automated_outreach: {
    label: 'Eligible automated outreach',
    description: 'Sends approved message types automatically, only to recipients with a current consent record, within caps and quiet hours.',
    outreach: true,
  },
};

export function modeRank(mode: AutomationMode) {
  return AUTOMATION_MODES.indexOf(mode);
}

export function modeAllows(current: AutomationMode, minimum: AutomationMode) {
  return modeRank(current) >= modeRank(minimum);
}

export const JOB_STATUSES = ['pending', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const JOB_STATUS_META: Record<JobStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'warning' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const OPEN_JOB_STATUSES: readonly JobStatus[] = ['pending', 'running', 'awaiting_approval'];

export const ERROR_KINDS = ['retryable', 'permanent', 'budget', 'policy', 'timeout', 'uncertain_delivery', 'cancelled'] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
export const ERROR_KIND_LABELS: Record<ErrorKind, string> = {
  retryable: 'Temporary error',
  permanent: 'Permanent error',
  budget: 'Budget limit',
  policy: 'Blocked by policy',
  timeout: 'Timed out',
  uncertain_delivery: 'Delivery status unknown',
  cancelled: 'Cancelled',
};

export const RUN_STATUSES = ['succeeded', 'failed', 'skipped', 'cancelled', 'deferred'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_META: Record<RunStatus, { label: string; tone: Tone }> = {
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  deferred: { label: 'Deferred', tone: 'warning' },
};

export const WORKFLOW_STATES = [
  'discovered',
  'identity_research',
  'website_verification',
  'contact_research',
  'qualification',
  'opportunity_report',
  'proposal_draft',
  'outreach_eligibility_check',
  'human_approval',
  'ready_for_outreach',
  'contacted',
  'response_monitoring',
  'interested',
  'meeting',
  'negotiation',
  'client_won',
  'research_incomplete',
  'needs_human_review',
  'unreachable',
  'not_interested',
  'opted_out',
  'disqualified',
  'archived',
  'failed',
  'retry_pending',
] as const;
export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export type WorkflowGroup = 'research' | 'outreach' | 'conversion' | 'holding' | 'closed';

export const WORKFLOW_META: Record<WorkflowState, { label: string; group: WorkflowGroup; tone: Tone }> = {
  discovered: { label: 'Discovered', group: 'research', tone: 'neutral' },
  identity_research: { label: 'Identity research', group: 'research', tone: 'neutral' },
  website_verification: { label: 'Website verification', group: 'research', tone: 'neutral' },
  contact_research: { label: 'Contact research', group: 'research', tone: 'neutral' },
  qualification: { label: 'Qualification', group: 'research', tone: 'info' },
  opportunity_report: { label: 'Opportunity report', group: 'research', tone: 'info' },
  proposal_draft: { label: 'Proposal draft', group: 'research', tone: 'info' },
  outreach_eligibility_check: { label: 'Outreach eligibility check', group: 'outreach', tone: 'warning' },
  human_approval: { label: 'Human approval', group: 'outreach', tone: 'warning' },
  ready_for_outreach: { label: 'Ready for outreach', group: 'outreach', tone: 'accent' },
  contacted: { label: 'Contacted', group: 'outreach', tone: 'accent' },
  response_monitoring: { label: 'Response monitoring', group: 'outreach', tone: 'accent' },
  interested: { label: 'Interested', group: 'conversion', tone: 'success' },
  meeting: { label: 'Meeting', group: 'conversion', tone: 'success' },
  negotiation: { label: 'Negotiation', group: 'conversion', tone: 'success' },
  client_won: { label: 'Client won', group: 'conversion', tone: 'success' },
  research_incomplete: { label: 'Research incomplete', group: 'holding', tone: 'warning' },
  needs_human_review: { label: 'Needs human review', group: 'holding', tone: 'warning' },
  unreachable: { label: 'Unreachable', group: 'holding', tone: 'warning' },
  retry_pending: { label: 'Retry pending', group: 'holding', tone: 'warning' },
  failed: { label: 'Automation failed', group: 'holding', tone: 'danger' },
  not_interested: { label: 'Not interested', group: 'closed', tone: 'neutral' },
  opted_out: { label: 'Opted out', group: 'closed', tone: 'danger' },
  disqualified: { label: 'Disqualified', group: 'closed', tone: 'neutral' },
  archived: { label: 'Archived', group: 'closed', tone: 'neutral' },
};

export const WORKFLOW_GROUP_LABELS: Record<WorkflowGroup, string> = {
  research: 'Research',
  outreach: 'Outreach',
  conversion: 'Conversion',
  holding: 'Needs attention',
  closed: 'Closed',
};

export const BUDGET_PROVIDERS = ['google_places', 'brave_search', 'anthropic', 'total'] as const;
export type BudgetProvider = (typeof BUDGET_PROVIDERS)[number];
export const BUDGET_PROVIDER_LABELS: Record<BudgetProvider, string> = {
  google_places: 'Google Places',
  brave_search: 'Brave Search',
  anthropic: 'Anthropic (AI)',
  total: 'All providers',
};
/** usage_records.provider values for each budget key. */
export const USAGE_PROVIDER: Record<Exclude<BudgetProvider, 'total'>, string> = {
  google_places: 'google_places',
  brave_search: 'brave_search',
  anthropic: 'anthropic',
};
