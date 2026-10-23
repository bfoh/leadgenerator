import type { SendingPolicy } from '@/lib/domain/sending-policy';
import type { Timestamp } from '@/lib/domain/types';
import type { AgentKey, AutomationMode, BudgetProvider, ErrorKind, JobStatus, RunStatus, WorkflowState } from './constants';

export interface BudgetLimit {
  dailyUsd: number | null;
  monthlyUsd: number | null;
}
export type Budgets = Partial<Record<BudgetProvider, BudgetLimit>>;

export interface AutomationSettings {
  organizationId: string;
  mode: AutomationMode;
  paused: boolean;
  outboundStopped: boolean;
  outboundStopReason: string | null;
  outboundStopChangedAt: Timestamp | null;
  disabledAgents: AgentKey[];
  maxConcurrentJobs: number;
  budgets: Budgets;
  /** Phase 8 (migration 007): when and how much may be sent, and the switch that holds all dispatch. */
  sendingPolicy: SendingPolicy;
  sendingPaused: boolean;
  sendingPauseReason: string | null;
  sendingPausedAt: Timestamp | null;
  updatedAt: Timestamp;
}
export type AutomationSettingsPatch = Partial<
  Pick<AutomationSettings, 'mode' | 'paused' | 'disabledAgents' | 'maxConcurrentJobs' | 'budgets' | 'sendingPolicy' | 'sendingPaused' | 'sendingPauseReason'>
>;

/** One recorded change to the workspace's automation settings (audit trail). */
export interface SettingsChange {
  id: string;
  actorId: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  createdAt: Timestamp;
}

export interface AutomationJob {
  id: string;
  organizationId: string;
  agent: AgentKey;
  status: JobStatus;
  priority: number;
  businessId: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  idempotencyKey: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: Timestamp;
  leaseToken: string | null;
  lockedUntil: Timestamp | null;
  worker: string | null;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  lastError: string | null;
  errorKind: ErrorKind | null;
  cancelRequested: boolean;
  parentJobId: string | null;
  traceId: string;
  estimatedCostUsd: number;
  approvedBy: string | null;
  approvedAt: Timestamp | null;
  createdBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface JobRequest {
  agent: AgentKey;
  businessId?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  priority?: number;
  runAfter?: Timestamp | null;
  parentJobId?: string | null;
  requiresApproval?: boolean;
  estimatedCostUsd?: number;
  maxAttempts?: number;
}

export type JobOutcome = 'succeeded' | 'retry' | 'deferred' | 'failed' | 'cancelled' | 'awaiting_approval';

export interface FinishRequest {
  outcome: JobOutcome;
  result?: Record<string, unknown> | null;
  error?: string | null;
  errorKind?: ErrorKind | null;
  runAfter?: Timestamp | null;
}

export interface ProviderCall {
  provider: string;
  operation: string;
  units: number;
  estimatedCostUsd: number;
  ok: boolean;
}

export interface AgentRun {
  id: string;
  organizationId: string;
  jobId: string | null;
  businessId: string | null;
  agent: AgentKey;
  agentVersion: string;
  status: RunStatus;
  summary: string;
  decision: string | null;
  confidence: number | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  providerCalls: ProviderCall[];
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number;
  error: string | null;
  traceId: string | null;
  worker: string | null;
  actorId: string | null;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  durationMs: number;
  createdAt: Timestamp;
}
export type AgentRunInsert = Omit<AgentRun, 'id' | 'organizationId' | 'createdAt' | 'actorId'>;

export interface WorkflowTransition {
  id: string;
  organizationId: string;
  businessId: string;
  fromState: WorkflowState | null;
  toState: WorkflowState;
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  reason: string | null;
  createdAt: Timestamp;
}

export interface JobFilter {
  statuses?: JobStatus[];
  agent?: AgentKey;
  businessId?: string;
  traceId?: string;
  limit?: number;
}
