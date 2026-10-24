'use client';

import { Bot, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MAX_QUERIES } from '@/lib/automation/agents/verification';
import { latestVerification } from '@/lib/domain/rescore';
import type { Business, WebsiteVerification } from '@/lib/domain/types';
import { CLASSIFICATION_META } from '@/lib/domain/website-assessment';
import { cn, formatDate, todayIso } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { describeQueued, describeRun, runAgentForMany, useAutomationAction, useAutomationAvailable, useQueueMode } from '@/lib/workspace/automation';
import { useBusinesses, useResearchSchema, useVerifications } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ScorePill, WebsiteStatusBadge } from '@/components/records/badges';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';
import { ClassificationBadge } from '@/components/prospects/profile/agent-verification';

type Bucket = 'review' | 'unverified' | 'inconclusive' | 'ownership' | 'recheck';

const BUCKETS: Record<Bucket, { label: string; description: string }> = {
  review: { label: 'Needs review', description: 'An agent result is waiting for a person to confirm or reject it.' },
  unverified: { label: 'Not yet verified', description: 'No documented website research yet. Cannot be qualified.' },
  inconclusive: { label: 'Inconclusive', description: 'Checks so far found insufficient evidence.' },
  ownership: { label: 'Confirm ownership', description: 'A likely website exists but ownership is unconfirmed.' },
  recheck: { label: 'Re-check due', description: 'A scheduled re-check date has passed, or the last check is over six months old.' },
};

function bucketFor(b: Business, latest: WebsiteVerification | null, all: WebsiteVerification[], today: string, staleBefore: string): { bucket: Bucket; reason: string; pending?: WebsiteVerification } | null {
  const pending = all.filter((v) => v.actorType === 'agent' && v.reviewStatus === 'pending').sort((x, y) => y.checkedAt.localeCompare(x.checkedAt))[0];
  if (pending) {
    const label = pending.classification ? CLASSIFICATION_META[pending.classification].label : 'Agent result';
    return { bucket: 'review', reason: `${label}, evidence ${pending.confidenceScore ?? '—'}/100, checked ${formatDate(pending.checkedAt)}`, pending };
  }
  if (b.websiteStatus === 'unverified') return { bucket: 'unverified', reason: 'No verification recorded' };
  if (b.websiteStatus === 'insufficient_evidence') return { bucket: 'inconclusive', reason: latest?.evidenceSummary ?? 'Inconclusive' };
  if (b.websiteStatus === 'potential_official') return { bucket: 'ownership', reason: latest?.domain ? `Possible site: ${latest.domain}` : 'Possible site found' };
  if (latest?.nextCheckAt && latest.nextCheckAt <= today) return { bucket: 'recheck', reason: `Re-check scheduled for ${formatDate(latest.nextCheckAt)}` };
  if (latest && latest.checkedAt < staleBefore) return { bucket: 'recheck', reason: `Last checked ${formatDate(latest.checkedAt)}` };
  return null;
}

export function VerificationQueue() {
  const { data: businesses, isLoading } = useBusinesses();
  const { data: verifications = [] } = useVerifications();
  const [bucket, setBucket] = useState<Bucket | 'all'>('all');
  const [staleBefore] = useState(() => new Date(Date.now() - 180 * 86_400_000).toISOString());

  const rows = useMemo(() => {
    const today = todayIso();
    const byBusiness = new Map<string, WebsiteVerification[]>();
    for (const v of verifications) byBusiness.set(v.businessId, [...(byBusiness.get(v.businessId) ?? []), v]);
    return (businesses ?? [])
      .filter((b) => !['lost', 'archived', 'won'].includes(b.stage) && b.contactPermission !== 'opted_out' && !b.mergedIntoId)
      .flatMap((b) => {
        const list = byBusiness.get(b.id) ?? [];
        const latest = latestVerification(list);
        const hit = bucketFor(b, latest, list, today, staleBefore);
        return hit ? [{ business: b, latest, ...hit }] : [];
      })
      .sort((a, b) => (b.business.opportunityScore ?? 0) - (a.business.opportunityScore ?? 0));
  }, [businesses, verifications, staleBefore]);

  if (isLoading) return <PageSkeleton />;
  const counts = Object.fromEntries((Object.keys(BUCKETS) as Bucket[]).map((k) => [k, rows.filter((r) => r.bucket === k).length])) as Record<Bucket, number>;
  const shown = bucket === 'all' ? rows : rows.filter((r) => r.bucket === bucket);
  // Results awaiting review are not re-run automatically; a person decides them first.
  const runnable = shown.filter((r) => r.bucket !== 'review').map((r) => r.business);

  return (
    <>
      <PageHeader
        title="Verification queue"
        description="Prospects that need documented website checks before they can be qualified or reported on. Highest opportunity first."
        actions={<BulkVerify businesses={runnable} />}
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="radiogroup" aria-label="Queue filter">
        {(Object.keys(BUCKETS) as Bucket[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={bucket === k}
            onClick={() => setBucket(bucket === k ? 'all' : k)}
            className={cn('rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong', bucket === k && 'border-accent ring-1 ring-accent')}
          >
            <p className="text-2xl font-semibold tabular">{counts[k]}</p>
            <p className="text-sm font-medium">{BUCKETS[k].label}</p>
            <p className="text-xs text-subtle">{BUCKETS[k].description}</p>
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Queue is clear" description="Every open prospect has a current verification record." />
        ) : (
          <ul className="divide-y divide-border">
            {shown.map(({ business: b, reason, bucket: k, pending }) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/prospects/${b.id}`} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                  <p className="truncate text-xs text-subtle">
                    {b.category} · {b.city} · {reason}
                  </p>
                </div>
                {pending?.classification ? <ClassificationBadge classification={pending.classification} /> : <WebsiteStatusBadge status={b.websiteStatus} />}
                <span className="w-24">
                  <ScorePill score={b.opportunityScore} />
                </span>
                <Link href={`/prospects/${b.id}?tab=verification`} className={buttonClasses(k === 'unverified' || k === 'review' ? 'primary' : 'secondary', 'sm')}>
                  {k === 'recheck' ? 'Re-check' : k === 'review' ? 'Review' : 'Verify'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/** Runs the Website Verification agent for the prospects in the current filter, after confirmation. */
function BulkVerify({ businesses }: { businesses: Business[] }) {
  const { can } = useWorkspace();
  const { data: available } = useAutomationAvailable();
  const { data: schema } = useResearchSchema();
  const { data: status } = useServerStatus();
  const [confirming, setConfirming] = useState(false);
  const queueMode = useQueueMode();
  const run = useAutomationAction((actx, list: Business[]) => runAgentForMany(actx, queueMode, 'website_verification', list), {
    success: ({ queued, run: r }) => `${describeQueued(queued).replace('Research pipeline', 'Website verification')} ${describeRun(r)}`,
    onSuccess: () => setConfirming(false),
  });
  if (!available || !schema || !status?.serverTools || !can('automation.run') || !businesses.length) return null;
  const search = status.research?.search;
  const perProspect = search?.configured && !status.research?.simulated ? search.costPerQueryUsd * MAX_QUERIES : 0;
  return (
    <>
      <Button onClick={() => setConfirming(true)}>
        <Bot aria-hidden /> Verify {businesses.length} automatically
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title="Run automated website verification?"
        description={`Queues the Website Verification agent for ${businesses.length} prospect${businesses.length === 1 ? '' : 's'} in this view and starts processing now.`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" loading={run.pending} onClick={() => void run.run(businesses)}>
              Queue and process
            </Button>
          </>
        }
      >
        <p className="text-sm text-subtle">
          {perProspect
            ? `Web search runs only within your Brave Search budget (at most about $${(perProspect * businesses.length).toFixed(2)} for this batch); without a budget it is skipped and only recorded and name-derived domains are checked.`
            : 'No paid search will be used.'}{' '}
          Uncertain results wait for your review and never replace a person’s verification. Nothing is sent to businesses.
        </p>
      </Dialog>
    </>
  );
}
