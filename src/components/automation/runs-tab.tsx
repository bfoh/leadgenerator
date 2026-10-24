'use client';

import { ListChecks } from 'lucide-react';
import Link from 'next/link';
import { workerLabel } from '@/lib/automation/constants';
import { formatDateTime } from '@/lib/utils';
import { agentName, useAgentRuns } from '@/lib/workspace/automation';
import { useBusinesses } from '@/lib/workspace/hooks';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { JsonBlock, RunStatusBadge, usd } from './badges';

export function RunsTab({ live }: { live: boolean }) {
  const { data: runs, isLoading } = useAgentRuns({ limit: 200 }, true, live);
  const { data: businesses = [] } = useBusinesses();
  const names = new Map(businesses.map((b) => [b.id, b.name]));

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Agent run log"
        description="Append-only record of every agent run: version, decision, confidence, provider calls, tokens and estimated cost. Secrets and message content are never logged."
      />
      {isLoading ? (
        <Skeleton className="m-4 h-40" />
      ) : !runs?.length ? (
        <EmptyState icon={ListChecks} title="No runs yet" />
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((r) => (
            <li key={r.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <RunStatusBadge status={r.status} />
                <span className="text-sm font-medium">{agentName(r.agent)}</span>
                <span className="text-xs text-subtle">{r.agentVersion}</span>
                {r.businessId && (
                  <Link href={`/prospects/${r.businessId}?tab=activity`} className="text-sm text-muted underline-offset-2 hover:underline">
                    {names.get(r.businessId) ?? 'Deleted prospect'}
                  </Link>
                )}
                <span className="ml-auto text-xs text-subtle">{formatDateTime(r.startedAt)}</span>
              </div>
              <p className="text-sm">{r.summary}</p>
              <p className="text-xs text-subtle">
                {[
                  r.decision && `Decision: ${r.decision}`,
                  r.confidence != null && `Confidence ${r.confidence}%`,
                  `${(r.durationMs / 1000).toFixed(1)} s`,
                  workerLabel(r.worker),
                  r.estimatedCostUsd ? usd(r.estimatedCostUsd) : 'No paid calls',
                  r.model,
                  r.inputTokens != null && `${r.inputTokens.toLocaleString()} in / ${(r.outputTokens ?? 0).toLocaleString()} out tokens`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {r.error && <p className="text-xs text-danger">{r.error}</p>}
              <div className="space-y-1.5">
                <JsonBlock label="Provider calls" value={r.providerCalls.length ? r.providerCalls : null} />
                <JsonBlock label="Output" value={r.output} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
