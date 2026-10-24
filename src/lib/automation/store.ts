// Queue and policy persistence for automation. Implemented by LocalAutomationStore (demo, browser
// storage) and SupabaseAutomationStore (cloud, RPC functions from migration 003). Both enforce the
// same job state machine; see docs/AGENT_WORKFLOWS.md §3.

import { DEFAULT_SENDING_POLICY } from '@/lib/domain/sending-policy';
import type { JobStatus } from './constants';
import type {
  AgentRun,
  AgentRunInsert,
  AutomationJob,
  AutomationSettings,
  AutomationSettingsPatch,
  FinishRequest,
  JobFilter,
  JobRequest,
  SettingsChange,
} from './types';

export interface RunFilter {
  businessId?: string;
  jobId?: string;
  traceId?: string;
  limit?: number;
}

/** What has processed this workspace's queue, so the browser can show it instead of running it. */
export interface WorkerActivity {
  /** When the scheduled background worker last started a job here; null if it never has. */
  lastBackgroundRunAt: string | null;
  /** Claimable jobs (not paused, agent on, not outbound) due for longer than OVERDUE_AFTER_MS. */
  overdueJobs: number;
}

export interface AutomationStore {
  readonly mode: 'demo' | 'cloud';
  /** False when the cloud database has not had migration 003 applied. */
  isAvailable(): Promise<boolean>;

  getSettings(): Promise<AutomationSettings>;
  updateSettings(patch: AutomationSettingsPatch): Promise<AutomationSettings>;
  /** Recorded changes to the settings, newest first (the database audit trail in cloud mode). */
  listSettingsHistory(limit?: number): Promise<SettingsChange[]>;

  enqueue(request: JobRequest): Promise<{ job: AutomationJob; created: boolean }>;
  /** Claims due jobs for this workspace, recovering expired leases first. */
  claim(worker: string, limit: number, leaseSeconds: number): Promise<AutomationJob[]>;
  finish(job: AutomationJob, request: FinishRequest): Promise<AutomationJob>;
  cancel(jobId: string, reason?: string): Promise<AutomationJob>;
  retry(jobId: string): Promise<AutomationJob>;
  approve(jobId: string): Promise<AutomationJob>;

  getJob(id: string): Promise<AutomationJob | null>;
  listJobs(filter?: JobFilter): Promise<AutomationJob[]>;
  countJobs(): Promise<Record<JobStatus, number>>;

  recordRun(run: AgentRunInsert): Promise<AgentRun>;
  listRuns(filter?: RunFilter): Promise<AgentRun[]>;
  workerActivity(now?: Date): Promise<WorkerActivity>;
}

export class AutomationError extends Error {
  constructor(
    message: string,
    readonly code: 'unavailable' | 'forbidden' | 'conflict' | 'invalid' | 'not_found' | 'stale_lease' = 'invalid',
  ) {
    super(message);
    this.name = 'AutomationError';
  }
}

export const DEFAULT_SETTINGS_FOR = (organizationId: string, now: string): AutomationSettings => ({
  organizationId,
  mode: 'research_only',
  paused: false,
  outboundStopped: true,
  outboundStopReason: null,
  outboundStopChangedAt: null,
  disabledAgents: [],
  maxConcurrentJobs: 2,
  budgets: {},
  sendingPolicy: structuredClone(DEFAULT_SENDING_POLICY),
  sendingPaused: false,
  sendingPauseReason: null,
  sendingPausedAt: null,
  updatedAt: now,
});

export function emptyCounts(): Record<JobStatus, number> {
  return { pending: 0, running: 0, awaiting_approval: 0, succeeded: 0, failed: 0, cancelled: 0 };
}
