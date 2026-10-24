// Operational alerts (phase 10): what a person should look at today, computed from stored records
// only. Pure, so the System health card and the tests share one definition. Thresholds are listed in
// docs/MONITORING.md; change both together.

export type AlertLevel = 'critical' | 'warning' | 'info';

export interface OperationalAlert {
  key: string;
  level: AlertLevel;
  title: string;
  detail: string;
  /** Where to deal with it. */
  href: string;
}

export interface HealthSnapshot {
  /** Jobs that ran out of attempts or failed permanently (dead letters). */
  failedJobs: number;
  /** Jobs still marked running after their lease expired (the worker stopped). */
  stuckJobs: number;
  awaitingApproval: number;
  /** Messages whose delivery could not be confirmed: never retried, a person must check. */
  deliveryUnknown: number;
  failedMessages: number;
  /** Open opt-out confirmation tasks past their due date (a compliance matter). */
  overdueOptOutTasks: number;
  /** Change requests open for longer than two days. */
  staleChangeRequests: number;
  /** Spend against each budget limit in its window. */
  budgets: { label: string; window: 'day' | 'month'; spentUsd: number; limitUsd: number }[];
  automationPaused: boolean;
  sendingPaused: boolean;
  /** Claimable jobs due for more than five minutes: nothing is processing the queue. */
  overdueJobs: number;
  /** Whether a scheduled background worker is configured (cloud mode). */
  backgroundWorker: boolean;
}

export const BUDGET_WARNING_SHARE = 0.8;

const ORDER: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = (n: number) => `$${n.toFixed(2)}`;

export function operationalAlerts(s: HealthSnapshot): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  if (s.overdueOptOutTasks > 0) {
    alerts.push({
      key: 'opt-out-tasks',
      level: 'critical',
      title: `${plural(s.overdueOptOutTasks, 'opt-out')} not confirmed on time`,
      detail: 'The sender is already suppressed; confirm and record the withdrawal so the records match what they asked for.',
      href: '/outreach?tab=inbox&filter=opt_out',
    });
  }
  if (s.deliveryUnknown > 0) {
    alerts.push({
      key: 'delivery-unknown',
      level: 'critical',
      title: `${plural(s.deliveryUnknown, 'message')} with unknown delivery`,
      detail: 'Check with the provider whether each one arrived before doing anything else. They are never resent automatically.',
      href: '/outreach',
    });
  }
  for (const b of s.budgets) {
    if (b.limitUsd <= 0) continue;
    const share = b.spentUsd / b.limitUsd;
    if (share >= 1) {
      alerts.push({ key: `budget-${b.label}-${b.window}`, level: 'critical', title: `${b.label} ${b.window === 'day' ? 'daily' : 'monthly'} budget used up`, detail: `${usd(b.spentUsd)} of ${usd(b.limitUsd)}. Paid work for it is stopped until the next ${b.window}.`, href: '/automation?tab=controls' });
    } else if (share >= BUDGET_WARNING_SHARE) {
      alerts.push({ key: `budget-${b.label}-${b.window}`, level: 'warning', title: `${b.label} ${b.window === 'day' ? 'daily' : 'monthly'} budget at ${Math.floor(share * 100)}%`, detail: `${usd(b.spentUsd)} of ${usd(b.limitUsd)}.`, href: '/automation?tab=controls' });
    }
  }
  if (s.overdueJobs > 0) {
    alerts.push({
      key: 'overdue-jobs',
      level: 'warning',
      title: `${plural(s.overdueJobs, 'job')} overdue`,
      detail: s.backgroundWorker
        ? 'The background worker has not picked them up for over five minutes. Check its schedule (pg_cron) and the worker route (runbook §7).'
        : 'No background worker is configured, so jobs run only while someone presses Process queue now or keeps this page processing. An owner can set one up (runbook §7).',
      href: '/automation?tab=jobs&status=pending',
    });
  }
  if (s.stuckJobs > 0) {
    alerts.push({ key: 'stuck-jobs', level: 'warning', title: `${plural(s.stuckJobs, 'job')} stopped mid-run`, detail: 'Their lease expired. The next queue run retries research work and fails outbound work as uncertain.', href: '/automation?tab=jobs&status=running' });
  }
  if (s.failedJobs > 0) {
    alerts.push({ key: 'failed-jobs', level: 'warning', title: `${plural(s.failedJobs, 'failed job')}`, detail: 'Read the error on each, fix the cause, then retry or leave it.', href: '/automation?tab=jobs&status=failed' });
  }
  if (s.failedMessages > 0) {
    alerts.push({ key: 'failed-messages', level: 'warning', title: `${plural(s.failedMessages, 'message')} failed`, detail: 'The provider refused them; see the reason on each message.', href: '/outreach' });
  }
  if (s.staleChangeRequests > 0) {
    alerts.push({ key: 'change-requests', level: 'warning', title: `${plural(s.staleChangeRequests, 'change request')} waiting more than two days`, detail: 'An owner or admin decides each one; acceptance is blocked until then.', href: '/proposals' });
  }
  if (s.awaitingApproval > 0) {
    alerts.push({ key: 'approvals', level: 'info', title: `${plural(s.awaitingApproval, 'job')} waiting for approval`, detail: 'They run only after an owner or admin approves them.', href: '/automation?tab=jobs&status=awaiting_approval' });
  }
  if (s.automationPaused) alerts.push({ key: 'automation-paused', level: 'info', title: 'Automation is paused', detail: 'No queued job runs until it is resumed.', href: '/automation?tab=controls' });
  if (s.sendingPaused) alerts.push({ key: 'sending-paused', level: 'info', title: 'Sending is paused', detail: 'Every dispatch waits, sandbox included.', href: '/outreach?tab=policies' });
  return alerts.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
