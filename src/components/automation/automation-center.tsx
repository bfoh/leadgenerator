'use client';

import { Bot, Database, OctagonX, Pause, Play, Server } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { JOB_STATUSES, MODE_META, type JobStatus } from '@/lib/automation/constants';
import type { AutomationSettings } from '@/lib/automation/types';
import { cn } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { useAutomationAvailable, useAutomationSettings, useJobCounts, useQueueRunner } from '@/lib/workspace/automation';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/field';
import { Notice, PageHeader, PageSkeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentsTab } from './agents-tab';
import { ControlsTab } from './controls-tab';
import { JobsTab } from './jobs-tab';
import { OverviewTab } from './overview-tab';
import { RunsTab } from './runs-tab';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'agents', label: 'Agents' },
  { key: 'controls', label: 'Controls' },
  { key: 'runs', label: 'Run log' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const DESCRIPTION = 'Research agents work through a durable job queue with budgets, retries and an audit trail. Nothing is sent to businesses: in this version messages can reach only the agency’s own sandbox test recipients (Outreach).';

export function AutomationCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { workspace, can } = useWorkspace();
  const available = useAutomationAvailable();
  const settings = useAutomationSettings();
  const runner = useQueueRunner();
  const { data: counts } = useJobCounts(runner.keepProcessing);

  const requested = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : 'overview';
  const requestedStatus = params.get('status');
  const status = JOB_STATUSES.includes(requestedStatus as JobStatus) ? (requestedStatus as JobStatus) : null;
  const navigate = (next: TabKey, extra?: Record<string, string>) => {
    const query = new URLSearchParams(next === 'overview' ? {} : { tab: next, ...extra }).toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  if (available.isLoading) return <PageSkeleton />;
  if (available.data !== true) {
    return (
      <>
        <PageHeader title="Automation Center" description={DESCRIPTION} />
        <Notice tone="warning" icon={Database} title="Database update required" className="mb-5">
          {available.error
            ? 'Could not reach the automation tables. Try again shortly.'
            : 'This workspace’s database does not have the automation tables yet. An owner needs to apply supabase/migrations/003_automation_infrastructure.sql after taking a backup (see RUNBOOK.md, “Apply migration 003”). Everything else keeps working without it.'}
        </Notice>
        <AgentsTab settings={null} />
      </>
    );
  }
  if (!settings.data) return <PageSkeleton />;

  const live = runner.keepProcessing || Boolean(counts && (counts.running || counts.pending));
  return (
    <>
      <PageHeader
        title="Automation Center"
        description={DESCRIPTION}
        actions={
          can('automation.run') && (
            <>
              <Checkbox
                label="Keep processing while open"
                checked={runner.keepProcessing}
                onChange={(e) => runner.setKeepProcessing(e.target.checked)}
                className="mr-1"
              />
              <Button variant="primary" loading={runner.processing} onClick={() => void runner.runOnce()}>
                <Play aria-hidden /> Process queue now
              </Button>
            </>
          )
        }
      />
      <StatusStrip settings={settings.data} mode={workspace.mode} />
      <Tabs value={tab} onValueChange={(v) => navigate(v as TabKey)}>
        <TabsList label="Automation Center sections" className="mb-5">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} count={t.key === 'jobs' && counts ? counts.pending + counts.running + counts.awaiting_approval || undefined : undefined}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab settings={settings.data} counts={counts} last={runner.last} live={live} onShowJobs={(s) => navigate('jobs', s ? { status: s } : undefined)} />
        </TabsContent>
        <TabsContent value="jobs">
          <JobsTab status={status} onStatus={(s) => navigate('jobs', s ? { status: s } : undefined)} live={live} />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsTab settings={settings.data} />
        </TabsContent>
        <TabsContent value="controls">
          <ControlsTab settings={settings.data} />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab live={live} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatusStrip({ settings, mode }: { settings: AutomationSettings; mode: 'demo' | 'cloud' }) {
  const { data: status } = useServerStatus();
  const worker = mode === 'demo' ? 'This browser tab' : status?.automation?.backgroundWorker ? 'Scheduled worker + this page' : 'This page only';
  const items = [
    { icon: Bot, label: 'Mode', value: MODE_META[settings.mode].label, tone: 'neutral' },
    settings.paused
      ? { icon: Pause, label: 'Queue', value: 'Paused', tone: 'warning' }
      : { icon: Play, label: 'Queue', value: 'Running', tone: 'success' },
    { icon: OctagonX, label: 'Outbound messages', value: 'Emergency stop engaged', tone: 'danger' },
    { icon: Server, label: 'Worker', value: worker, tone: 'neutral' },
  ] as const;
  return (
    <ul className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Automation status">
      {items.map(({ icon: Icon, label, value, tone }) => (
        <li key={label} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5">
          <Icon className={cn('size-4 shrink-0', tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-subtle')} aria-hidden />
          <div className="min-w-0">
            <p className="text-xs text-subtle">{label}</p>
            <p className="truncate text-sm font-medium">{value}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
