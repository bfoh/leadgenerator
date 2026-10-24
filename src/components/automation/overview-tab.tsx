'use client';

import { Bot, ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AGENTS } from '@/lib/automation/agents/catalog';
import { MAX_QUERIES } from '@/lib/automation/agents/verification';
import { hasLimit, monthStart, spendByProvider, spentFor } from '@/lib/automation/budget';
import { BUDGET_PROVIDER_LABELS, BUDGET_PROVIDERS, JOB_STATUS_META, JOB_STATUSES, type JobStatus } from '@/lib/automation/constants';
import type { QueueRunSummary } from '@/lib/automation/engine';
import type { AutomationSettings } from '@/lib/automation/types';
import { cn, relativeTime } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { RESEARCH_PIPELINE, agentName, describeQueued, describeRun, researchable, runResearchNow, useAgentRuns, useAutomationAction, useQueueMode } from '@/lib/workspace/automation';
import { useBusinesses, useUsage } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, Notice } from '@/components/ui/misc';
import { RunStatusBadge, usd } from './badges';
import { SystemHealthCard } from './health-card';

export function OverviewTab({
  settings,
  counts,
  last,
  live,
  onShowJobs,
}: {
  settings: AutomationSettings;
  counts: Record<JobStatus, number> | undefined;
  last: { at: string; summary: QueueRunSummary } | null;
  live: boolean;
  onShowJobs: (status: JobStatus | null) => void;
}) {
  return (
    <div className="space-y-5">
      <SystemHealthCard settings={settings} />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Jobs by status">
        {JOB_STATUSES.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onShowJobs(s)}
              className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong"
            >
              <span className="block text-2xl font-semibold tabular">{counts ? counts[s] : '–'}</span>
              <span className="block text-xs text-subtle">{JOB_STATUS_META[s].label}</span>
            </button>
          </li>
        ))}
      </ul>
      {last && (
        <p className="text-xs text-subtle" role="status">
          Last processed {relativeTime(last.at)}: {describeRun(last.summary)}
        </p>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ResearchPipeline settings={settings} />
        <SpendCard settings={settings} />
      </div>
      <RecentRuns live={live} />
    </div>
  );
}

function ResearchPipeline({ settings }: { settings: AutomationSettings }) {
  const { can } = useWorkspace();
  const queueMode = useQueueMode();
  const { data: businesses = [] } = useBusinesses();
  const { data: status } = useServerStatus();
  const [confirming, setConfirming] = useState(false);
  const eligible = businesses.filter(researchable);
  const run = useAutomationAction((actx, list: typeof eligible) => runResearchNow(actx, queueMode, list), {
    success: ({ queued, run: r }) => `${describeQueued(queued)} ${describeRun(r)}`,
    onSuccess: () => setConfirming(false),
  });
  const aiReports = Boolean(status?.ai.configured && hasLimit(settings.budgets.anthropic));
  const research = status?.research;
  const search = research?.simulated
    ? 'Simulated test search (no network, no cost).'
    : !research?.search.configured
      ? 'Web search is not configured, so only recorded and name-derived domains are checked.'
      : hasLimit(settings.budgets.brave_search)
        ? `Up to ${MAX_QUERIES} Brave searches per prospect (about $${(MAX_QUERIES * research.search.costPerQueryUsd).toFixed(2)}), within your Brave Search budget.`
        : 'Web search is skipped until you set a Brave Search budget (Controls); recorded and name-derived domains are still checked.';
  const paidSearch = Boolean(research?.search.configured && !research.simulated && hasLimit(settings.budgets.brave_search));
  const off = RESEARCH_PIPELINE.filter((k) => settings.disabledAgents.includes(k)).map((k) => AGENTS[k].name);

  return (
    <Card>
      <CardHeader title="Research pipeline" description="Checks identity, verifies the website, audits it and scores each open prospect; prospects that qualify get contact research and an internal report." />
      <CardBody className="space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Business Identity looks for duplicates. Possible duplicates stop here for a person to decide.</li>
          <li>Website Verification checks recorded and candidate sites (honouring robots.txt). {search} Uncertain results wait for your review.</li>
          <li>Digital Audit records evidence-backed findings, separating verified issues from growth hypotheses.</li>
          <li>Opportunity Scoring recalculates the score from recorded evidence (no paid calls; your overrides stay).</li>
          <li>
            For verified prospects in the high or qualify band only, Contact Research records the contact details the business publishes on its verified official website (homepage and one
            contact page, robots.txt honoured), each with its source, and Contact Validation checks them (syntax, mail servers, E.164, duplicates). No guessing, no social platforms, no
            mailbox probing; a found detail is not permission to message it.
          </li>
          <li>
            Those prospects then get an Opportunity Report —{' '}
            {aiReports ? 'written by AI within your Anthropic budget.' : 'rule-based, because AI reports in automation need AI configured and an Anthropic budget (Controls).'}
          </li>
        </ol>
        <p className="text-xs text-subtle">Nothing is sent to businesses. Prospects with research already queued are skipped.</p>
        {off.length > 0 && <Notice tone="warning">{off.join(', ')} {off.length === 1 ? 'is' : 'are'} turned off on the Agents tab, so those steps will wait.</Notice>}
        {can('automation.run') ? (
          <Button variant="primary" disabled={!eligible.length} onClick={() => setConfirming(true)}>
            <Bot aria-hidden /> Run research for {eligible.length} open prospect{eligible.length === 1 ? '' : 's'}
          </Button>
        ) : (
          <p className="text-xs text-subtle">Your role can view automation but not start it.</p>
        )}
      </CardBody>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title="Run the research pipeline?"
        description={`Queues the research pipeline for ${eligible.length} open prospect${eligible.length === 1 ? '' : 's'} and starts processing now.`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" loading={run.pending} onClick={() => void run.run(eligible)}>
              Queue and process
            </Button>
          </>
        }
      >
        <p className="text-sm text-subtle">
          {paidSearch ? 'Web searches are charged to the Brave Search budget. ' : ''}
          {aiReports
            ? 'AI reports are charged to the Anthropic budget; jobs wait for the next day or month when it is used up.'
            : paidSearch
              ? 'Reports will be rule-based.'
              : 'Reports will be rule-based and no paid search is used, so this run costs nothing.'}{' '}
          Processing continues in batches while this page is open, or with the scheduled worker if it is configured.
        </p>
      </Dialog>
    </Card>
  );
}

function SpendCard({ settings }: { settings: AutomationSettings }) {
  const [now] = useState(() => new Date());
  const { data: usage = [] } = useUsage(monthStart(now).toISOString());
  const spend = useMemo(() => spendByProvider(usage, now), [usage, now]);
  return (
    <Card>
      <CardHeader title="Spend against budgets" description="Estimated provider cost today and this month (GMT). Automated paid work needs a budget." />
      <ul className="divide-y divide-border">
        {BUDGET_PROVIDERS.map((p) => {
          const limit = settings.budgets[p];
          return (
            <li key={p} className="space-y-1.5 px-4 py-2.5">
              <p className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{BUDGET_PROVIDER_LABELS[p]}</span>
                <span className="text-xs text-subtle">{hasLimit(limit) ? '' : 'No budget set'}</span>
              </p>
              <Meter label="Today" spent={spentFor(spend, p, 'day')} limit={limit?.dailyUsd ?? null} />
              <Meter label="This month" spent={spentFor(spend, p, 'month')} limit={limit?.monthlyUsd ?? null} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Meter({ label, spent, limit }: { label: string; spent: number; limit: number | null }) {
  const ratio = limit ? Math.min(spent / limit, 1) : 0;
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <span className="text-subtle">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
        {limit != null && <span className={cn('block h-full rounded-full', ratio >= 1 ? 'bg-danger' : ratio >= 0.8 ? 'bg-warning' : 'bg-accent')} style={{ width: `${ratio * 100}%` }} />}
      </span>
      <span className="tabular text-muted">
        {usd(spent)}
        {limit != null ? ` of ${usd(limit)}` : ''}
      </span>
    </div>
  );
}

function RecentRuns({ live }: { live: boolean }) {
  const { data: runs = [] } = useAgentRuns({ limit: 8 }, true, live);
  const { data: businesses = [] } = useBusinesses();
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  return (
    <Card>
      <CardHeader title="Recent agent runs" description="Every run is logged with its decision, cost and duration." />
      {runs.length === 0 ? (
        <EmptyState icon={ListChecks} title="No runs yet" description="Run the research pipeline, or use “Automate research” on a prospect." />
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <RunStatusBadge status={r.status} />
              <span className="text-sm font-medium">{agentName(r.agent)}</span>
              <span className="order-last min-w-0 basis-full truncate text-sm text-muted sm:order-none sm:flex-1 sm:basis-0">
                {r.businessId && names.get(r.businessId) ? `${names.get(r.businessId)} · ` : ''}
                {r.summary}
              </span>
              <span className="ml-auto text-xs text-subtle sm:ml-0">{relativeTime(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
