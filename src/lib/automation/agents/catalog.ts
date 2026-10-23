// The fifteen job kinds (fourteen logical agents; the opportunity and proposal agents are separate
// steps). Agents without `run` are planned and are listed with the phase that delivers them; the
// engine refuses jobs for them. See docs/AGENT_WORKFLOWS.md §1.

import { z } from 'zod';
import type { AgentKey } from '../constants';
import { contactResearchAgent, contactValidationAgent } from './contacts';
import { outreachDraftingAgent } from './outreach';
import { proposalGenerationAgent } from './proposals';
import { opportunityReportAgent, opportunityScoringAgent } from './research';
import { followUpPlanningAgent, responseClassificationAgent } from './responses';
import { businessIdentityAgent, digitalAuditAgent, websiteVerificationAgent } from './verification';
import type { AgentDefinition } from './types';

const none = z.object({}).passthrough();

function planned(def: Omit<AgentDefinition, 'input' | 'version' | 'timeoutMs' | 'needsBusiness'> & { needsBusiness?: boolean }): AgentDefinition {
  return { version: 'planned', timeoutMs: 60_000, needsBusiness: def.needsBusiness ?? true, input: none, ...def };
}

export const AGENTS: Record<AgentKey, AgentDefinition> = {
  discovery: planned({
    key: 'discovery',
    name: 'Discovery',
    description: 'Runs a saved, user-approved search against licensed providers and lists candidates for a person to track.',
    phase: 3,
    minimumMode: 'research_only',
    may: 'Store permitted identifiers (such as a Place ID) for candidates a person chooses to track.',
    never: 'Harvest in bulk, run on a schedule, or store fields a provider restricts.',
    providers: ['google_places'],
    needsBusiness: false,
    stepState: 'discovered',
  }),
  business_identity: businessIdentityAgent as AgentDefinition,
  website_verification: websiteVerificationAgent as AgentDefinition,
  contact_research: contactResearchAgent as AgentDefinition,
  contact_validation: contactValidationAgent as AgentDefinition,
  digital_audit: digitalAuditAgent as AgentDefinition,
  opportunity_scoring: opportunityScoringAgent as AgentDefinition,
  opportunity_report: opportunityReportAgent as AgentDefinition,
  proposal_generation: proposalGenerationAgent as AgentDefinition,
  outreach_drafting: outreachDraftingAgent as AgentDefinition,
  permission_approval: planned({
    key: 'permission_approval',
    name: 'Permission & Approval Gateway',
    description:
      'Deterministic eligibility check run on every message at preview, approval and dispatch: consent, suppression, contact validation, template and message policy, frequency caps, daily limits, quiet hours and human approval. It runs inside the messaging services rather than as a queued job.',
    phase: 7,
    minimumMode: 'approval_based_outreach',
    may: 'Record eligibility decisions.',
    never: 'Use AI, or be overridden by another agent.',
    providers: [],
    stepState: 'outreach_eligibility_check',
  }),
  outreach_execution: planned({
    key: 'outreach_execution',
    name: 'Outreach Execution',
    description:
      'Would send approved, eligible messages through the official email or WhatsApp Cloud API without a person pressing a button. Not built: in this version a person presses “Dispatch due messages”, the server re-runs the gateway, and only the agency’s sandbox test recipients can receive anything.',
    phase: 8,
    minimumMode: 'approval_based_outreach',
    may: 'Send one approved message and record its delivery status.',
    never: 'Send without a passing gateway decision, or retry when delivery is uncertain.',
    providers: ['email', 'whatsapp'],
    stepState: 'contacted',
  }),
  response_classification: responseClassificationAgent as AgentDefinition,
  follow_up_planning: followUpPlanningAgent as AgentDefinition,
  sales_intelligence: planned({
    key: 'sales_intelligence',
    name: 'Sales Intelligence',
    description:
      'Would summarise pipeline patterns and conversion insights as a queued job. Not built as an agent: the Analytics page shows replies by what they mean and proposal outcomes, computed from stored records only, and says when there is too little data to read anything into it.',
    phase: 11,
    minimumMode: 'research_only',
    may: 'Produce read-only insights.',
    never: 'Change records.',
    providers: [],
    needsBusiness: false,
    stepState: null,
  }),
};

export const AGENT_LIST = Object.values(AGENTS);

export function isAvailable(agent: AgentDefinition) {
  return typeof agent.run === 'function';
}
