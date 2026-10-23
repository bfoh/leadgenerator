'use client';

import { Compass, Plus, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ACTIVITY_LABELS, STAGE_LABELS, STAGES, WEBSITE_STATUSES, WEBSITE_STATUS_META, type Stage } from '@/lib/domain/constants';
import { isOpenStage } from '@/lib/domain/pipeline';
import { formatMoney } from '@/lib/domain/proposal';
import { cn, formatDate, relativeTime, todayIso } from '@/lib/utils';
import { useActivities, useBusinesses, useProjects, useProposals, useVerifications } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { BarList, ChartCard, StatTile } from '@/components/charts/chart-card';
import { LeadAlertsCard } from '@/components/outreach/reply-ui';
import { OpenTasks, UpcomingMeetings } from '@/components/pipeline/pipeline-view';
import { ScorePill, WebsiteStatusBadge } from '@/components/records/badges';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui/misc';

const PERIODS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
] as const;
type PeriodKey = (typeof PERIODS)[number]['key'];

const FUNNEL_STAGES: Stage[] = STAGES.filter((s) => s !== 'archived');

export function OverviewView() {
  const { workspace } = useWorkspace();
  const { data: businesses, isLoading } = useBusinesses();
  const { data: verifications = [] } = useVerifications();
  const { data: proposals = [] } = useProposals();
  const { data: projects = [] } = useProjects();
  const { data: activities = [] } = useActivities();
  const [period, setPeriod] = useState<PeriodKey>('30');
  const [now] = useState(() => Date.now());

  const since = useMemo(() => {
    const days = PERIODS.find((p) => p.key === period)?.days;
    return days ? new Date(now - days * 86_400_000).toISOString() : '';
  }, [period, now]);

  if (isLoading || !businesses) return <PageSkeleton />;

  const today = todayIso();
  const open = businesses.filter((b) => isOpenStage(b.stage));
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const qualifiedOrLater = open.filter((b) => STAGES.indexOf(b.stage) >= STAGES.indexOf('qualified'));
  const needsVerification = open.filter((b) => b.websiteStatus === 'unverified' || b.websiteStatus === 'insufficient_evidence');
  const valued = open.filter((b) => b.estimatedValue != null);
  const pipelineValue = valued.reduce((s, b) => s + (b.estimatedValue ?? 0), 0);
  const activeProjects = projects.filter((p) => ['planning', 'in_progress', 'maintenance'].includes(p.status));
  const overdue = open.filter((b) => b.nextActionDue && b.nextActionDue < today).sort((a, b) => a.nextActionDue!.localeCompare(b.nextActionDue!));

  const inPeriod = (iso: string | null) => Boolean(iso) && iso! >= since;
  const added = businesses.filter((b) => inPeriod(b.createdAt)).length;
  const checks = verifications.filter((v) => inPeriod(v.checkedAt)).length;
  const sent = proposals.filter((p) => inPeriod(p.sentAt)).length;
  const decided = proposals.filter((p) => inPeriod(p.decidedAt) && (p.status === 'accepted' || p.status === 'declined'));
  const accepted = decided.filter((p) => p.status === 'accepted').length;

  const stageData = FUNNEL_STAGES.map((s) => ({ label: STAGE_LABELS[s], value: businesses.filter((b) => b.stage === s).length }));
  const websiteData = WEBSITE_STATUSES.map((s) => ({ label: WEBSITE_STATUS_META[s].label, value: open.filter((b) => b.websiteStatus === s).length })).filter((d) => d.value > 0);
  const recent = [...activities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 8);
  const topToVerify = [...needsVerification].sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0)).slice(0, 6);
  const periodLabel = period === 'all' ? 'all time' : `last ${PERIODS.find((p) => p.key === period)!.label}`;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${workspace.organizationName} · business development at a glance`}
        actions={
          <>
            <ButtonLink href="/discover" variant="secondary">
              <Compass className="size-4" aria-hidden /> Discover
            </ButtonLink>
            <ButtonLink href="/prospects?new=1">
              <Plus className="size-4" aria-hidden /> Add prospect
            </ButtonLink>
          </>
        }
      />

      {workspace.mode === 'demo' && (
        <Notice tone="info" title="Demo workspace" className="mb-4">
          Records are saved in this browser only. The demo starts with the 20 research records carried over from earlier versions; every figure below is computed from the records stored here, never estimated.
        </Notice>
      )}

      {businesses.length === 0 ? (
        <Card>
          <EmptyState
            icon={Compass}
            title="No prospects yet"
            description="Search for businesses in Discover, add one you already know, or import the earlier research records from Settings."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <ButtonLink href="/discover">Open Discover</ButtonLink>
                <ButtonLink href="/prospects?new=1" variant="secondary">
                  Add prospect
                </ButtonLink>
                <ButtonLink href="/settings?tab=data" variant="ghost">
                  <Settings2 className="size-4" aria-hidden /> Import research
                </ButtonLink>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <LeadAlertsCard businesses={businesses} />
          <section aria-labelledby="state-heading">
            <h2 id="state-heading" className="sr-only">
              Current state
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatTile label="Open prospects" value={String(open.length)} sub={`${businesses.length} records in total`} href="/prospects" />
              <StatTile label="Qualified or further" value={String(qualifiedOrLater.length)} sub="Open, at or past Qualified" href="/pipeline" />
              <StatTile label="Need verification" value={String(needsVerification.length)} sub="Unverified or inconclusive" href="/verification" />
              <StatTile
                label="Estimated pipeline"
                value={valued.length ? formatMoney(pipelineValue) : '—'}
                sub={valued.length ? `${valued.length} of ${open.length} open have an estimate` : 'No estimates entered'}
                href="/pipeline"
              />
              <StatTile label="Active projects" value={String(activeProjects.length)} sub={`${projects.length} projects in total`} href="/projects" />
            </div>
          </section>

          <section aria-labelledby="period-heading">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 id="period-heading" className="text-sm font-medium">
                Activity, {periodLabel}
              </h2>
              <div role="radiogroup" aria-label="Period" className="inline-flex rounded-md border border-border bg-surface p-0.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={period === p.key}
                    onClick={() => setPeriod(p.key)}
                    className={cn('rounded px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground', period === p.key && 'bg-surface-muted font-medium text-foreground')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Prospects added" value={String(added)} />
              <StatTile label="Website checks recorded" value={String(checks)} />
              <StatTile label="Proposals sent" value={String(sent)} />
              <StatTile label="Proposals accepted" value={String(accepted)} sub={decided.length ? `${accepted} of ${decided.length} decided` : 'None decided'} />
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Pipeline by stage"
              description="All prospects except archived, in stage order"
              table={{ columns: ['Stage', 'Prospects'], rows: stageData.map((d) => [d.label, d.value]) }}
            >
              <BarList data={stageData} valueLabel="Prospects" />
            </ChartCard>
            <ChartCard
              title="Website status of open prospects"
              description="From the latest recorded verification. “No official website found” is not proof of absence."
              table={{ columns: ['Status', 'Prospects'], rows: websiteData.map((d) => [d.label, d.value]) }}
              empty={websiteData.length ? null : 'No open prospects'}
            >
              <BarList data={websiteData} valueLabel="Prospects" />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Verify next"
                description="Highest-scoring open prospects without conclusive website evidence"
                actions={
                  <Link href="/verification" className="text-xs text-subtle hover:text-foreground hover:underline">
                    Queue
                  </Link>
                }
              />
              {topToVerify.length === 0 ? (
                <EmptyState title="Nothing waiting for verification" className="py-8" />
              ) : (
                <ul className="divide-y divide-border">
                  {topToVerify.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`/prospects/${b.id}?tab=verification`} className="text-sm font-medium hover:underline">
                          {b.name}
                        </Link>
                        <p className="truncate text-xs text-subtle">
                          {b.category} · {b.city}
                        </p>
                      </div>
                      <span className="hidden shrink-0 sm:block">
                        <WebsiteStatusBadge status={b.websiteStatus} />
                      </span>
                      <ScorePill score={b.opportunityScore} confidence={b.confidenceScore} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Overdue next actions" description="Open prospects whose next action date has passed" />
              {overdue.length === 0 ? (
                <EmptyState title="Nothing overdue" className="py-8" />
              ) : (
                <ul className="divide-y divide-border">
                  {overdue.slice(0, 8).map((b) => (
                    <li key={b.id} className="px-4 py-2.5">
                      <Link href={`/prospects/${b.id}`} className="text-sm font-medium hover:underline">
                        {b.name}
                      </Link>
                      <p className="text-xs text-subtle">
                        {b.nextAction ?? 'Next action'} · <span className="text-danger">due {formatDate(b.nextActionDue)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <OpenTasks businesses={businesses} />
            <UpcomingMeetings businesses={businesses} />
            <Card>
              <CardHeader title="Recent activity" />
              {recent.length === 0 ? (
                <EmptyState title="No activity yet" className="py-8" />
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((a) => (
                    <li key={a.id} className="px-4 py-2.5">
                      <p className="text-sm">{a.summary}</p>
                      <p className="text-xs text-subtle">
                        {ACTIVITY_LABELS[a.type]} ·{' '}
                        <Link href={`/prospects/${a.businessId}?tab=activity`} className="hover:underline">
                          {names.get(a.businessId) ?? 'Prospect'}
                        </Link>{' '}
                        · {relativeTime(a.occurredAt, now)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
