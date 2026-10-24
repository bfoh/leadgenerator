'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { COST_GROUPS, OUTCOME_GROUPS, buckets, costGroup, funnel, granularityFor, industryRollup, outcomeGroup, series, topCounts } from '@/lib/domain/analytics';
import { QUALIFIED_SCORE } from '@/lib/domain/campaigns';
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_META, STAGE_LABELS } from '@/lib/domain/constants';
import { isOpenStage } from '@/lib/domain/pipeline';
import { REPLY_INTENT_META, REPLY_INTENTS } from '@/lib/domain/replies';
import { BAND_META, bandFor, type ScoreBand } from '@/lib/domain/scoring';
import { cn, download } from '@/lib/utils';
import { useActivities, useBusinesses, useInboundMessages, useMessagingSchema, useProposals, useUsage, useVerifications } from '@/lib/workspace/hooks';
import { BarList, ChartCard, Columns, StatTile, type TableSpec } from '@/components/charts/chart-card';
import { Button } from '@/components/ui/button';
import { useReadings } from '@/components/outreach/reply-ui';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';

const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '12 months' },
];

const usd = (v: number) => (v === 0 ? '$0' : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
/** Below this many replies in range, the split is shown but not worth reading patterns into. */
const MIN_REPLIES_FOR_PATTERNS = 10;

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
}

export function AnalyticsView() {
  const [days, setDays] = useState(90);
  const [now] = useState(() => new Date());
  const since = useMemo(() => new Date(now.getTime() - days * 86_400_000).toISOString(), [now, days]);
  const { data: businesses, isLoading } = useBusinesses();
  const { data: activities = [] } = useActivities();
  const { data: verifications = [] } = useVerifications();
  const { data: proposals = [] } = useProposals();
  const { data: usage = [] } = useUsage(since);
  const { data: messagingSchema } = useMessagingSchema();
  const { data: inbound = [] } = useInboundMessages(undefined, messagingSchema === true);
  const { available: readable, readings } = useReadings();

  const view = useMemo(() => {
    if (!businesses) return null;
    const list = buckets(days, now);
    const open = businesses.filter((b) => isOpenStage(b.stage));
    const steps = funnel(businesses, activities);
    const total = steps[0]?.count ?? 0;

    const bands: { label: string; value: number }[] = (['high', 'qualify', 'research', 'low'] as ScoreBand[]).map((band) => ({
      label: `${BAND_META[band].label} (${BAND_META[band].range})`,
      value: open.filter((b) => b.opportunityScore != null && bandFor(b.opportunityScore) === band).length,
    }));
    const unscored = open.filter((b) => b.opportunityScore == null).length;
    if (unscored) bands.push({ label: 'Not scored', value: unscored });

    const checks = series(verifications, list, (v) => v.checkedAt, (v) => outcomeGroup(v.status), OUTCOME_GROUPS.map((g) => g.key));
    const cost = series(usage, list, (u) => u.createdAt, (u) => costGroup(u.provider), COST_GROUPS.map((g) => g.key), (u) => u.estimatedCostUsd);

    // Industry rollups: the thirty groups in catalogue order, each keeping the exact stored category
    // labels underneath so a group can always be drilled into.
    const industries = industryRollup(businesses, activities, proposals);
    const covered = [...industries.groups, ...(industries.unclassified ? [industries.unclassified] : [])].filter((group) => group.open > 0).sort((a, b) => b.open - a.open || a.label.localeCompare(b.label));
    const industryChart = [...covered.slice(0, 8).map((group) => ({ label: group.label, value: group.open }))];
    const otherOpen = covered.slice(8).reduce((sum, group) => sum + group.open, 0);
    if (otherOpen) industryChart.push({ label: 'Other groups', value: otherOpen });

    const proposalStatus = PROPOSAL_STATUSES.map((s) => ({ label: PROPOSAL_STATUS_META[s].label, value: proposals.filter((p) => p.status === s).length }));
    const decided = proposals.filter((p) => p.decidedAt && p.decidedAt >= since && (p.status === 'accepted' || p.status === 'declined'));
    const accepted = decided.filter((p) => p.status === 'accepted').length;

    const byOperation = new Map<string, { calls: number; units: number; cost: number }>();
    for (const u of usage) {
      const key = `${u.provider} · ${u.operation}`;
      const row = byOperation.get(key) ?? { calls: 0, units: 0, cost: 0 };
      byOperation.set(key, { calls: row.calls + 1, units: row.units + u.units, cost: row.cost + u.estimatedCostUsd });
    }
    const totalCost = usage.reduce((s, u) => s + u.estimatedCostUsd, 0);
    const scored = open.filter((b) => b.opportunityScore != null);
    const replies = inbound.filter((m) => m.receivedAt >= since);
    const intentOf = (id: string, optOut: boolean) => (optOut ? 'opt_out' : (readings.get(id)?.intent ?? null));
    const replyIntents = [
      ...REPLY_INTENTS.map((i) => ({ label: REPLY_INTENT_META[i].label, value: replies.filter((m) => intentOf(m.id, m.optOut) === i).length })),
      { label: 'Not read yet', value: replies.filter((m) => intentOf(m.id, m.optOut) == null).length },
    ].filter((r) => r.value > 0);

    return {
      list,
      total,
      steps: steps.map((s) => ({ label: STAGE_LABELS[s.stage], value: s.count })),
      bands,
      checks,
      checksTotal: verifications.filter((v) => v.checkedAt >= since).length,
      cost,
      totalCost,
      proposalStatus,
      decided: decided.length,
      accepted,
      industries,
      industryChart,
      cities: topCounts(open.map((b) => b.city || 'Unknown'), 6),
      lost: topCounts(
        businesses.filter((b) => b.stage === 'lost').map((b) => (b.lostReason ?? 'No reason recorded').trim()),
        6,
        'Other reasons',
      ),
      operations: [...byOperation.entries()].sort((a, b) => b[1].cost - a[1].cost || b[1].calls - a[1].calls),
      openCount: open.length,
      avgScore: scored.length ? Math.round(scored.reduce((s, b) => s + (b.opportunityScore ?? 0), 0) / scored.length) : null,
      scoredCount: scored.length,
      replyIntents,
      repliesTotal: replies.length,
    };
  }, [businesses, activities, verifications, proposals, usage, days, now, since, inbound, readings]);

  if (isLoading || !view) return <PageSkeleton />;

  const industryRows = [...view.industries.groups, ...(view.industries.unclassified ? [view.industries.unclassified] : [])];

  const rangeLabel = RANGES.find((r) => r.days === days)!.label;
  const grain = { day: 'day', week: 'week', month: 'month' }[granularityFor(days)];

  const tables: Record<string, TableSpec> = {
    funnel: { columns: ['Furthest stage reached', 'Prospects', 'Share of all'], rows: view.steps.map((s) => [s.label, s.value, pct(s.value, view.total)]) },
    bands: { columns: ['Score band', 'Open prospects'], rows: view.bands.map((b) => [b.label, b.value]) },
    checks: { columns: ['Period', ...OUTCOME_GROUPS.map((g) => g.label)], rows: view.checks.map((r) => [r.label, ...OUTCOME_GROUPS.map((g) => r[g.key])]) },
    proposals: { columns: ['Status', 'Proposals'], rows: view.proposalStatus.map((s) => [s.label, s.value]) },
    cost: { columns: ['Period', ...COST_GROUPS.map((g) => `${g.label} (USD)`)], rows: view.cost.map((r) => [r.label, ...COST_GROUPS.map((g) => usd(Number(r[g.key])))]) },
    categories: { columns: ['Industry group', 'Open prospects'], rows: view.industryChart.map((c) => [c.label, c.value]) },
    industry: {
      columns: ['Industry group', 'Prospects', 'Open', 'Qualified', 'Won', 'Proposals accepted', 'Proposals decided', 'Conversion', 'Avg score'],
      rows: [...view.industries.groups, ...(view.industries.unclassified ? [view.industries.unclassified] : [])].map((g) => [
        g.label,
        g.prospects,
        g.open,
        g.qualified,
        g.won,
        g.proposalsAccepted,
        g.proposalsDecided,
        pct(g.won, g.prospects),
        g.avgScore ?? '—',
      ]),
    },
    industryCategories: {
      columns: ['Industry group', 'Stored category', 'Prospects', 'Open', 'Qualified', 'Won'],
      rows: [...view.industries.groups, ...(view.industries.unclassified ? [view.industries.unclassified] : [])]
        .filter((g) => g.categories.length > 0)
        .flatMap((g) => g.categories.map((c) => [g.label, c.label, c.prospects, c.open, c.qualified, c.won])),
    },
    cities: { columns: ['City', 'Open prospects'], rows: view.cities.map((c) => [c.label, c.value]) },
    lost: { columns: ['Lost reason', 'Prospects'], rows: view.lost.map((c) => [c.label, c.value]) },
    replies: { columns: ['What the reply means', 'Replies'], rows: view.replyIntents.map((r) => [r.label, r.value]) },
  };

  function exportCsv() {
    const lines = ['section,label,value'];
    for (const [section, t] of Object.entries(tables)) {
      for (const row of t.rows) {
        if (row.length === 2) lines.push([section, row[0], row[1]].map(csvCell).join(','));
        else row.slice(1).forEach((v, i) => lines.push([section, `${row[0]} — ${t.columns[i + 1]}`, v].map(csvCell).join(',')));
      }
    }
    download(`analytics-${now.toISOString().slice(0, 10)}-${days}d.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Computed from the records in this workspace. Costs are estimates from logged API usage, not invoices."
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!businesses?.length}>
            <Download className="size-4" aria-hidden /> Export CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="radio"
              aria-checked={days === r.days}
              onClick={() => setDays(r.days)}
              className={cn('rounded px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground', days === r.days && 'bg-surface-muted font-medium text-foreground')}
            >
              {r.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle">The range applies to checks, decisions and costs. Pipeline, scores and industry counts show the current state; won totals keep earlier records.</p>
      </div>

      {!businesses?.length ? (
        <Card>
          <EmptyState title="No data yet" description="Analytics appear once prospects are added or imported." />
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Open prospects" value={String(view.openCount)} sub={`${businesses.length} records in total`} />
            <StatTile label="Average opportunity score" value={view.avgScore == null ? '—' : String(view.avgScore)} sub={`${view.scoredCount} scored open prospects`} />
            <StatTile label={`Proposal win rate, ${rangeLabel}`} value={pct(view.accepted, view.decided)} sub={view.decided ? `${view.accepted} accepted of ${view.decided} decided` : 'No decisions in range'} />
            <StatTile label={`Estimated API cost, ${rangeLabel}`} value={usd(view.totalCost)} sub={`${view.checksTotal} website checks recorded`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Pipeline progression" description="Prospects that reached each stage, from current stage and logged stage changes" table={tables.funnel}>
              <BarList data={view.steps} valueLabel="Prospects" />
            </ChartCard>
            <ChartCard title="Opportunity score bands" description="Open prospects. The score ranks opportunity; confidence is shown on each record." table={tables.bands}>
              <BarList data={view.bands} valueLabel="Open prospects" />
            </ChartCard>
            <ChartCard
              title="Website checks recorded"
              description={`Per ${grain}, by outcome`}
              table={tables.checks}
              empty={view.checksTotal ? null : `No checks recorded in the last ${rangeLabel}`}
            >
              <Columns data={view.checks} series={OUTCOME_GROUPS} />
            </ChartCard>
            <ChartCard
              title="Estimated API cost"
              description={`Per ${grain}, USD, by provider`}
              table={tables.cost}
              empty={view.totalCost > 0 ? null : `No billable usage logged in the last ${rangeLabel}`}
            >
              <Columns data={view.cost} series={COST_GROUPS} format={usd} />
            </ChartCard>
            <ChartCard title="Proposals by status" description="All proposals" table={tables.proposals} empty={proposals.length ? null : 'No proposals yet'}>
              <BarList data={view.proposalStatus} valueLabel="Proposals" />
            </ChartCard>
            {readable && (
              <ChartCard
                title="Replies by what they mean"
                description={
                  view.repliesTotal >= MIN_REPLIES_FOR_PATTERNS
                    ? `${view.repliesTotal} replies received in the last ${rangeLabel}, by their current reading`
                    : `${view.repliesTotal} repl${view.repliesTotal === 1 ? 'y' : 'ies'} in the last ${rangeLabel}: too few to read patterns into`
                }
                table={tables.replies}
                empty={view.repliesTotal ? null : `No replies received in the last ${rangeLabel}`}
              >
                <BarList data={view.replyIntents} valueLabel="Replies" />
              </ChartCard>
            )}
            <ChartCard title="Lost reasons" description="As recorded when a prospect was marked lost" table={tables.lost} empty={view.lost.length ? null : 'No lost prospects'}>
              <BarList data={view.lost} valueLabel="Prospects" />
            </ChartCard>
            <ChartCard title="Open prospects by industry group" description="Top eight groups; the rest are combined. Each group keeps its exact stored categories in the table below." table={tables.categories} empty={view.industryChart.length ? null : 'No open prospects'}>
              <BarList data={view.industryChart} valueLabel="Open prospects" />
            </ChartCard>
            <ChartCard title="Open prospects by city" table={tables.cities} empty={view.cities.length ? null : 'No open prospects'}>
              <BarList data={view.cities} valueLabel="Open prospects" />
            </ChartCard>
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              title="Industry performance"
              description={`Every record grouped by the 30-industry catalogue, with the exact stored category labels underneath. Open and qualified are current; won and decided proposals are lifetime, so earlier records keep their credit. Qualified means an open prospect scoring ${QUALIFIED_SCORE} or more — the same bar campaigns use.`}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-muted/40 px-4 py-2 text-xs text-muted">
              <span>
                <strong className="text-foreground">{view.industries.totals.groupsCovered}</strong> of {view.industries.groups.length} groups have records
              </span>
              <span>
                <strong className="text-foreground">{view.industries.totals.open}</strong> open
              </span>
              <span>
                <strong className="text-foreground">{view.industries.totals.qualified}</strong> qualified
              </span>
              <span>
                <strong className="text-foreground">{view.industries.totals.won}</strong> won
              </span>
              <span>{view.industries.totals.proposalsDecided ? `${pct(view.industries.totals.proposalsAccepted, view.industries.totals.proposalsDecided)} of decided proposals accepted` : 'No proposal decisions recorded'}</span>
            </div>
            <ul className="divide-y divide-border">
              {industryRows.map((group) => (
                <li key={group.key}>
                  <details data-testid="industry-group" data-group={group.key} className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-surface-hover">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{group.label}</span>
                        <span className="ml-2 text-xs text-subtle">{group.prospects ? `${group.prospects} record${group.prospects === 1 ? '' : 's'}` : 'No records yet'}</span>
                      </span>
                      <span className="text-xs tabular text-muted">{group.open} open</span>
                      <span className="text-xs tabular text-muted">{group.qualified} qualified</span>
                      <span className="text-xs tabular text-muted">
                        {group.won} won · {pct(group.won, group.prospects)}
                      </span>
                      <span className="text-xs tabular text-muted">{group.proposalsDecided ? `${pct(group.proposalsAccepted, group.proposalsDecided)} proposals` : 'No proposal decisions'}</span>
                    </summary>
                    <div className="px-4 pb-3">
                      <p className="mb-2 text-xs text-subtle">
                        {group.description} Average score of open, scored prospects: {group.avgScore ?? '—'}.
                      </p>
                      {group.categories.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[560px] text-sm">
                            <thead className="border-b border-border text-left text-xs text-subtle">
                              <tr>
                                <th scope="col" className="py-1.5 pr-3 font-medium">Stored category</th>
                                <th scope="col" className="px-3 py-1.5 text-right font-medium">Records</th>
                                <th scope="col" className="px-3 py-1.5 text-right font-medium">Open</th>
                                <th scope="col" className="px-3 py-1.5 text-right font-medium">Qualified</th>
                                <th scope="col" className="px-3 py-1.5 text-right font-medium">Won</th>
                                <th scope="col" className="py-1.5 pl-3 text-right font-medium">Proposals accepted</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {group.categories.map((category) => (
                                <tr key={category.label}>
                                  <td className="py-1.5 pr-3">
                                    <Link
                                      href={`/prospects?category=${encodeURIComponent(category.label)}&stage=all`}
                                      className="underline decoration-border underline-offset-2 hover:decoration-current"
                                      title={`Open the ${category.prospects} record${category.prospects === 1 ? '' : 's'} filed as “${category.label}”`}
                                    >
                                      {category.label}
                                    </Link>
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular">{category.prospects}</td>
                                  <td className="px-3 py-1.5 text-right tabular">{category.open}</td>
                                  <td className="px-3 py-1.5 text-right tabular">{category.qualified}</td>
                                  <td className="px-3 py-1.5 text-right tabular">{category.won}</td>
                                  <td className="py-1.5 pl-3 text-right tabular">{category.proposalsAccepted}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-xs text-subtle">No records in this group yet. Choose it in Discover or a campaign to start researching it.</p>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Usage by operation" description={`Logged calls in the last ${rangeLabel}: discovery, website checks, web search, AI reports and exports.`} />
            {view.operations.length === 0 ? (
              <EmptyState title="No usage logged in this range" className="py-8" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b border-border bg-surface-muted/60 text-left text-xs text-subtle">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Provider · operation</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Calls</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Units</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Estimated cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {view.operations.map(([key, r]) => (
                      <tr key={key}>
                        <td className="px-4 py-2">{key}</td>
                        <td className="px-4 py-2 text-right tabular">{r.calls}</td>
                        <td className="px-4 py-2 text-right tabular">{r.units}</td>
                        <td className="px-4 py-2 text-right tabular">{usd(r.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
