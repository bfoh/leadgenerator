// Workflow state machine. deriveWorkflowState and workflowAfterChange mirror the SQL in
// supabase/migrations/003 (derive_workflow_state, sync_workflow_state) so demo and cloud agree.
// checkTransition is the single place that decides who may move a business between states.

import type { Business } from '@/lib/domain/types';
import { WORKFLOW_META, type AgentKey, type WorkflowState } from './constants';

type WorkflowInput = Pick<Business, 'stage' | 'websiteStatus' | 'contactPermission' | 'interestLevel'>;

export function deriveWorkflowState(b: WorkflowInput): WorkflowState {
  if (b.contactPermission === 'opted_out') return 'opted_out';
  switch (b.stage) {
    case 'won':
      return 'client_won';
    case 'lost':
      return b.interestLevel === 'none' ? 'not_interested' : 'disqualified';
    case 'archived':
      return 'archived';
    case 'negotiation':
      return 'negotiation';
    case 'discovery_meeting':
      return 'meeting';
    case 'proposal_sent':
      return 'response_monitoring';
    case 'contact_authorized':
      return 'ready_for_outreach';
    case 'introduction_requested':
      return 'outreach_eligibility_check';
    case 'proposal_draft':
      return 'proposal_draft';
    case 'qualified':
      return 'qualification';
    case 'verification_pending':
      return 'website_verification';
    default:
      return b.websiteStatus === 'unverified' ? 'discovered' : 'contact_research';
  }
}

/** The stored state, or the derived one when the database predates migration 003. */
export function workflowStateOf(b: Business): WorkflowState {
  return b.workflowState ?? deriveWorkflowState(b);
}

export interface WorkflowFields {
  workflowState: WorkflowState;
  workflowStateAt: string;
  workflowStateReason: string | null;
  workflowStateActor: 'user' | 'agent' | 'system';
}

/** Demo-store mirror of the sync_workflow_state trigger. */
export function workflowAfterChange(before: Business | null, after: Business, now: string): WorkflowFields {
  if (!before) {
    let state = after.workflowState && after.workflowState !== 'discovered' ? after.workflowState : deriveWorkflowState(after);
    if (after.contactPermission === 'opted_out' && state !== 'opted_out' && state !== 'archived') state = 'opted_out';
    return { workflowState: state, workflowStateAt: now, workflowStateReason: after.workflowStateReason ?? 'Record created', workflowStateActor: after.workflowStateActor ?? 'system' };
  }
  const prev = workflowStateOf(before);
  let next: WorkflowFields = {
    workflowState: after.workflowState ?? prev,
    workflowStateAt: after.workflowStateAt ?? before.workflowStateAt ?? now,
    workflowStateReason: after.workflowStateReason ?? null,
    workflowStateActor: after.workflowStateActor ?? 'system',
  };
  if (after.contactPermission === 'opted_out' && next.workflowState !== 'opted_out' && next.workflowState !== 'archived') {
    next = { ...next, workflowState: 'opted_out', workflowStateReason: 'Opt-out recorded: contact and automation stopped', workflowStateActor: 'system' };
  } else if (after.stage !== before.stage && next.workflowState === prev) {
    const mapped = stageWorkflow(after);
    if (mapped && mapped !== prev && prev !== 'opted_out') {
      next = { ...next, workflowState: mapped, workflowStateReason: `CRM stage changed to ${after.stage.replace(/_/g, ' ')}`, workflowStateActor: 'user' };
    }
  }
  if (next.workflowState !== prev) return { ...next, workflowStateAt: now };
  return {
    workflowState: prev,
    workflowStateAt: before.workflowStateAt ?? now,
    workflowStateReason: before.workflowStateReason ?? null,
    workflowStateActor: before.workflowStateActor ?? 'system',
  };
}

function stageWorkflow(b: WorkflowInput): WorkflowState | null {
  switch (b.stage) {
    case 'won':
      return 'client_won';
    case 'lost':
      return b.interestLevel === 'none' ? 'not_interested' : 'disqualified';
    case 'archived':
      return 'archived';
    case 'discovery_meeting':
      return 'meeting';
    case 'negotiation':
      return 'negotiation';
    default:
      return null;
  }
}

/** States from which a research step may (re)set the workflow; later states are left alone. */
const RESEARCH_REENTRY: readonly WorkflowState[] = [
  'discovered',
  'identity_research',
  'website_verification',
  'contact_research',
  'qualification',
  'opportunity_report',
  'research_incomplete',
  'needs_human_review',
  'retry_pending',
  'failed',
];

export const canResetFrom = (business: Business) => RESEARCH_REENTRY.includes(workflowStateOf(business));

// ── Transition rules (docs/AGENT_WORKFLOWS.md §2.2) ─────────────────────────────

export type WorkflowActor = { kind: 'user' } | { kind: 'agent'; agent: AgentKey } | { kind: 'system' };
export type TransitionCheck = { ok: true } | { ok: false; reason: string };

const groupOf = (s: WorkflowState) => WORKFLOW_META[s].group;

/** States that involve contact with the business and therefore need recorded permission. */
export const PERMISSION_WORKFLOW_STATES: readonly WorkflowState[] = ['ready_for_outreach', 'contacted', 'response_monitoring', 'interested', 'meeting', 'negotiation'];

/** The only outreach-side moves an agent may make, and only these agents. */
const AGENT_OUTREACH_EDGES: Partial<Record<AgentKey, { from: readonly WorkflowState[]; to: readonly WorkflowState[] }>> = {
  permission_approval: {
    from: ['qualification', 'opportunity_report', 'proposal_draft', 'outreach_eligibility_check', 'human_approval'],
    to: ['outreach_eligibility_check', 'human_approval', 'ready_for_outreach'],
  },
  outreach_execution: { from: ['ready_for_outreach'], to: ['contacted'] },
  // Closing (not interested) is a person's decision; the agent only records that a reply came, or interest.
  response_classification: { from: ['contacted', 'response_monitoring'], to: ['response_monitoring', 'interested'] },
};

type PermissionInput = Pick<Business, 'contactPermission' | 'lawfulBasis'>;

export function checkTransition(from: WorkflowState, to: WorkflowState, actor: WorkflowActor, business: PermissionInput): TransitionCheck {
  if (from === to) return { ok: true };
  if (business.contactPermission === 'opted_out' && to !== 'opted_out' && to !== 'archived') {
    return { ok: false, reason: 'This business opted out. It can only be archived until the opt-out is withdrawn.' };
  }
  if (to === 'opted_out') return { ok: true };
  if (actor.kind === 'system') return { ok: true };

  const fromGroup = groupOf(from);
  const toGroup = groupOf(to);

  if (from === 'opted_out' || fromGroup === 'closed' || from === 'client_won') {
    if (actor.kind !== 'user') return { ok: false, reason: `Only a person can reopen a business that is ${WORKFLOW_META[from].label.toLowerCase()}.` };
    if (from === 'opted_out' && toGroup !== 'research' && to !== 'archived') return { ok: false, reason: 'A business leaving opt-out starts again in research.' };
  }

  if (PERMISSION_WORKFLOW_STATES.includes(to) && !(business.contactPermission === 'granted' && business.lawfulBasis)) {
    return { ok: false, reason: `${WORKFLOW_META[to].label} needs recorded permission to contact this business, with its lawful basis.` };
  }

  if (actor.kind === 'user') return { ok: true };

  // Agents
  if (toGroup === 'holding') return { ok: true };
  if ((fromGroup === 'research' || fromGroup === 'holding') && toGroup === 'research') return { ok: true };
  const edges = AGENT_OUTREACH_EDGES[actor.agent];
  if (edges && edges.from.includes(from) && edges.to.includes(to)) return { ok: true };
  return { ok: false, reason: `The ${actor.agent.replace(/_/g, ' ')} agent may not move a business from ${WORKFLOW_META[from].label} to ${WORKFLOW_META[to].label}.` };
}
