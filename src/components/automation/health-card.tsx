'use client';

import { Activity, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { hasLimit, monthStart, spendByProvider, spentFor } from '@/lib/automation/budget';
import { BUDGET_PROVIDER_LABELS, BUDGET_PROVIDERS } from '@/lib/automation/constants';
import type { AutomationSettings } from '@/lib/automation/types';
import { operationalAlerts, type AlertLevel, type HealthSnapshot } from '@/lib/domain/monitoring';
import { useServerStatus } from '@/lib/workspace/api';
import { useJobCounts, useJobs, useWorkerActivity } from '@/lib/workspace/automation';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { useChangeRequests, useConversionSchema, useMessagingSchema, useOutreachMessages, useTasks, useUsage } from '@/lib/workspace/hooks';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';

const LEVEL: Record<AlertLevel, { label: string; tone: 'danger' | 'warning' | 'info' }> = {
  critical: { label: 'Act now', tone: 'danger' },
  warning: { label: 'Check', tone: 'warning' },
  info: { label: 'Note', tone: 'info' },
};
const DAY = 86_400_000;

/** System health: dead letters, stuck jobs, uncertain deliveries, overdue opt-outs and budgets, from stored records. */
export function SystemHealthCard({ settings }: { settings: AutomationSettings }) {
  const now = useMemo(() => new Date(), []);
  const { workspace } = useWorkspace();
  const { data: status } = useServerStatus();
  const backgroundWorker = workspace.mode === 'cloud' && status?.automation?.backgroundWorker === true;
  const { data: counts } = useJobCounts();
  const { data: activity } = useWorkerActivity(workspace.mode === 'cloud');
  const { data: running = [] } = useJobs({ statuses: ['running'] });
  const { data: messaging } = useMessagingSchema();
  const { data: messages = [] } = useOutreachMessages(undefined, messaging === true);
  const { data: tasks = [] } = useTasks();
  const { data: conversion } = useConversionSchema();
  const { data: requests = [] } = useChangeRequests(undefined, conversion === true);
  const { data: usage = [] } = useUsage(monthStart(now).toISOString());

  const alerts = useMemo(() => {
    const today = now.toISOString().slice(0, 10);
    const spend = spendByProvider(usage, now);
    const budgets: HealthSnapshot['budgets'] = [];
    for (const p of BUDGET_PROVIDERS) {
      const limit = settings.budgets[p];
      if (!hasLimit(limit)) continue;
      if (limit.dailyUsd != null) budgets.push({ label: BUDGET_PROVIDER_LABELS[p], window: 'day', spentUsd: spentFor(spend, p, 'day'), limitUsd: limit.dailyUsd });
      if (limit.monthlyUsd != null) budgets.push({ label: BUDGET_PROVIDER_LABELS[p], window: 'month', spentUsd: spentFor(spend, p, 'month'), limitUsd: limit.monthlyUsd });
    }
    return operationalAlerts({
      failedJobs: counts?.failed ?? 0,
      stuckJobs: running.filter((j) => j.lockedUntil && j.lockedUntil < now.toISOString()).length,
      awaitingApproval: counts?.awaiting_approval ?? 0,
      deliveryUnknown: messages.filter((m) => m.status === 'delivery_unknown').length,
      failedMessages: messages.filter((m) => m.status === 'failed').length,
      overdueOptOutTasks: tasks.filter((t) => !t.completedAt && t.title.startsWith('Confirm the opt-out') && t.dueDate != null && t.dueDate < today).length,
      staleChangeRequests: requests.filter((r) => r.status === 'open' && now.getTime() - new Date(r.createdAt).getTime() > 2 * DAY).length,
      budgets,
      automationPaused: settings.paused,
      sendingPaused: settings.sendingPaused,
      overdueJobs: activity?.overdueJobs ?? 0,
      backgroundWorker,
    });
  }, [counts, running, messages, tasks, requests, usage, settings, now, activity, backgroundWorker]);

  return (
    <Card data-testid="system-health">
      <CardHeader title="System health" as="h2" description="What needs a person today, from the records in this workspace. Nothing here fixes itself." />
      <CardBody>
        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <CheckCircle2 className="size-4 text-success" aria-hidden /> Nothing needs attention: no failed or stuck jobs, uncertain deliveries, overdue opt-outs or budgets near their limit.
          </p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.key} className="flex flex-wrap items-start gap-2 rounded-md border border-border px-3 py-2">
                <Badge tone={LEVEL[a.level].tone}>{LEVEL[a.level].label}</Badge>
                <div className="min-w-0 flex-1">
                  <Link href={a.href} className="text-sm font-medium underline-offset-2 hover:underline">
                    <Activity className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                    {a.title}
                  </Link>
                  <p className="text-xs text-subtle">{a.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
