import type { z } from 'zod';
import type { ServiceContext } from '@/lib/data/services';
import type { ExtractedContacts } from '@/lib/domain/contact-extraction';
import type { MxResult } from '@/lib/domain/contacts';
import type { EvidencePack } from '@/lib/domain/evidence';
import type { AiClassification } from '@/lib/domain/replies';
import type { ReportContent, ReportValidation } from '@/lib/domain/report';
import type { PageFacts } from '@/lib/domain/page-signals';
import type { Business, ReportUsage, TechnicalCheck } from '@/lib/domain/types';
import type { CandidateCheck, SearchHit } from '@/lib/domain/website-assessment';
import type { CostEstimate } from '../budget';
import type { AgentKey, AutomationMode, ErrorKind, WorkflowState } from '../constants';
import type { AutomationSettings, JobRequest, ProviderCall } from '../types';

/**
 * Privileged operations agents may request. Implemented server-side (direct calls with quota and
 * usage recording) and in the browser (this app's route handlers). Agents get nothing else.
 */
export interface ToolGateway {
  readonly aiConfigured: boolean;
  readonly aiModel: string | null;
  aiReport(pack: EvidencePack, context: { jobId: string }, signal: AbortSignal): Promise<{ content: ReportContent; validation: ReportValidation; model: string; usage: ReportUsage; call: ProviderCall }>;
  /**
   * One evidence-grounded sentence for a message draft's {{personal_note}} (phase 8). Text only:
   * the agent puts it in a draft that a person approves, and the eligibility gateway still decides.
   */
  aiOutreachNote?(pack: EvidencePack, context: { jobId: string }, signal: AbortSignal): Promise<{ note: string | null; evidenceIds: string[]; reason: string | null; model: string; usage: ReportUsage; call: ProviderCall }>;
  /**
   * The AI reading of one received message (phase 9). A label only: it is reconciled with the
   * deterministic rules, which alone decide an opt-out and cannot be overruled.
   */
  aiClassifyReply?(
    message: { channel: 'email' | 'whatsapp'; subject: string | null; body: string },
    context: { jobId: string },
    signal: AbortSignal,
  ): Promise<{ result: AiClassification; model: string; usage: ReportUsage; call: ProviderCall }>;
  /** Website verification tools (phase 3). `simulated` marks the test-only simulated world. */
  readonly research: ResearchTools;
  webSearch(query: string, context: { jobId: string; purpose: string }, signal: AbortSignal): Promise<{ hits: SearchHit[]; provider: string; call: ProviderCall }>;
  probeDomains(domains: string[], signal: AbortSignal): Promise<{ domain: string; resolves: boolean }[]>;
  inspectWebsite(url: string, signal: AbortSignal): Promise<InspectedWebsite>;
  /** Contact research tools (phase 4): pages of the business's own website, and MX lookups. */
  readonly contacts: { available: boolean; simulated: boolean };
  readContactPage(url: string, signal: AbortSignal): Promise<ContactPageRead>;
  lookupMx(domains: string[], signal: AbortSignal): Promise<MxResult[]>;
}

export interface ResearchTools {
  available: boolean;
  simulated: boolean;
  search: { configured: boolean; provider: string | null; costPerQueryUsd: number };
}

export interface InspectedWebsite {
  check: TechnicalCheck | null;
  /** Includes transient match keys; agents store only storablePageFacts(). */
  facts: PageFacts | null;
  robots: CandidateCheck['robots'];
}

export interface ContactPageRead {
  check: TechnicalCheck | null;
  robots: CandidateCheck['robots'];
  /** Details the page publishes; the page URL becomes their recorded source. */
  contacts: ExtractedContacts | null;
}

export interface AgentContext<I> {
  input: I;
  jobId: string;
  traceId: string;
  business: Business | null;
  svc: ServiceContext;
  tools: ToolGateway;
  settings: AutomationSettings;
  signal: AbortSignal;
  now: Date;
  /** Records a provider call for the run log (usage itself is recorded by the gateway). */
  charge(call: ProviderCall): void;
}

export interface AgentResult {
  summary: string;
  decision?: string | null;
  /** 0–100 */
  confidence?: number | null;
  output?: Record<string, unknown>;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Proposed workflow move; the engine validates it with checkTransition. */
  transition?: { to: WorkflowState; reason: string } | null;
  followUps?: Omit<JobRequest, 'parentJobId' | 'idempotencyKey'>[];
}

export interface CostContext<I> {
  input: I;
  settings: AutomationSettings;
  tools: Pick<ToolGateway, 'aiConfigured' | 'aiModel' | 'research'>;
}

export interface AgentDefinition<I = unknown> {
  key: AgentKey;
  name: string;
  version: string;
  description: string;
  /** Roadmap phase in which the agent becomes available. */
  phase: number;
  minimumMode: AutomationMode;
  /** What the agent may change, and what it must never do (shown in the Automation Center). */
  may: string;
  never: string;
  providers: string[];
  needsBusiness: boolean;
  /** Workflow state the business is in while this step is its current step. */
  stepState: WorkflowState | null;
  timeoutMs: number;
  input: z.ZodType<I>;
  estimate?(ctx: CostContext<I>): CostEstimate;
  run?(ctx: AgentContext<I>): Promise<AgentResult>;
}

/** Errors an agent raises deliberately; anything else is classified by the engine. */
export class AgentError extends Error {
  constructor(
    message: string,
    readonly kind: Extract<ErrorKind, 'retryable' | 'permanent' | 'policy'> = 'permanent',
  ) {
    super(message);
    this.name = 'AgentError';
  }
}
