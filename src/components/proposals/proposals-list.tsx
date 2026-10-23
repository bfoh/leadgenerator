'use client';

import { FileSignature } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_META, type ProposalStatus } from '@/lib/domain/constants';
import { formatMoney } from '@/lib/domain/proposal';
import { relativeTime } from '@/lib/utils';
import { useBusinesses, useProposals } from '@/lib/workspace/hooks';
import { ProposalStatusBadge } from '@/components/records/badges';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';

export function ProposalsList() {
  const { data: proposals, isLoading } = useProposals();
  const { data: businesses = [] } = useBusinesses();
  const [status, setStatus] = useState<ProposalStatus | ''>('');
  const names = useMemo(() => new Map(businesses.map((b) => [b.id, b.name])), [businesses]);
  const rows = (proposals ?? []).filter((p) => !status || p.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (isLoading) return <PageSkeleton />;

  return (
    <>
      <PageHeader title="Proposals" description="Drafts are editable; approved and sent proposals are locked and versioned. Prices are never filled in for you." />
      <div className="mb-3">
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as ProposalStatus | '')} className="w-auto">
          <option value="">All statuses</option>
          {PROPOSAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROPOSAL_STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title={proposals?.length ? 'No proposals with this status' : 'No proposals yet'}
            description="Create a proposal from a prospect’s Proposals tab."
            action={!proposals?.length ? <ButtonLink href="/prospects">Go to prospects</ButtonLink> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-surface-muted/60 text-left text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Proposal</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">One-time</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Monthly</th>
                  <th scope="col" className="px-4 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-hover/60">
                    <td className="max-w-md px-4 py-2.5">
                      <Link href={`/proposals/${p.id}`} className="block truncate font-medium hover:underline">
                        {p.title}
                      </Link>
                      <span className="text-xs text-subtle">{names.get(p.businessId) ?? 'Deleted business'} · v{p.version}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <ProposalStatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular">{formatMoney(p.oneTimeTotal, p.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular text-subtle">{p.monthlyTotal ? formatMoney(p.monthlyTotal, p.currency) : '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-subtle">{relativeTime(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
