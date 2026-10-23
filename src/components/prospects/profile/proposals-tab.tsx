'use client';

import { FileSignature, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import * as svc from '@/lib/data/services';
import { formatMoney } from '@/lib/domain/proposal';
import { planProposal } from '@/lib/domain/proposal-templates';
import type { Business, OpportunityReport } from '@/lib/domain/types';
import { relativeTime } from '@/lib/utils';
import { useAction, useProposals, useReports } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ProposalStatusBadge } from '@/components/records/badges';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/misc';

export function ProposalsTab({ business }: { business: Business }) {
  const { can, settings } = useWorkspace();
  const router = useRouter();
  const { data: proposals = [] } = useProposals();
  const { data: reports = [] } = useReports(business.id);
  const latest = [...reports].sort((a, b) => b.version - a.version)[0] ?? null;
  const recommended = planProposal({ business, settings });
  const [pkgKey, setPkgKey] = useState(recommended?.pkg.key ?? settings.packages[0]?.key ?? '');
  const plan = planProposal({ business, settings, packageKey: pkgKey });
  const [reportId, setReportId] = useState<string>(latest?.id ?? '');
  const create = useAction(
    (ctx, report: OpportunityReport | null) => {
      const pkg = ctx.settings.packages.find((p) => p.key === pkgKey);
      if (!pkg) throw new Error('Choose a package.');
      return svc.createProposal(ctx, business, pkg, report);
    },
    { success: 'Draft proposal created', onSuccess: (p) => router.push(`/proposals/${p.id}`) },
  );
  const mine = proposals.filter((p) => p.businessId === business.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedReport = reports.find((r) => r.id === (reportId || latest?.id)) ?? null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Proposals" />
        {mine.length === 0 ? (
          <EmptyState icon={FileSignature} title="No proposals yet" description="Start a draft from one of your service packages. In Research + proposals mode the Proposal Generation agent drafts one once a report supports it." />
        ) : (
          <ul className="divide-y divide-border">
            {mine.map((p) => (
              <li key={p.id}>
                <Link href={`/proposals/${p.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-hover/60">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                  <ProposalStatusBadge status={p.status} />
                  <span className="text-sm tabular">{formatMoney(p.oneTimeTotal)}</span>
                  <span className="text-xs text-subtle">v{p.version} · {relativeTime(p.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {can('proposals.write') && (
        <Card className="self-start">
          <CardHeader title="New proposal" as="h3" />
          <CardBody>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                create.run(reportId === 'none' ? null : selectedReport);
              }}
            >
              <Field label="Service package" hint="Prices come from Settings → Packages and the add-on price list. Unpriced items show “To be quoted”.">
                {(p) => (
                  <Select {...p} value={pkgKey} onChange={(e) => setPkgKey(e.target.value)}>
                    {settings.packages.map((pkg) => (
                      <option key={pkg.key} value={pkg.key}>
                        {pkg.name}
                        {pkg.key === recommended?.recommendedKey ? ' (recommended)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {plan && (
                <div className="rounded-md border border-border bg-surface-muted/50 p-3 text-xs" data-testid="proposal-plan">
                  <p className="font-medium">
                    {plan.template.label} template{plan.pkg.key === plan.recommendedKey ? ' · recommended package' : ''}
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-subtle">
                    {plan.reasons.slice(0, 4).map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  {plan.addOns.length > 0 && (
                    <p className="mt-1.5 text-subtle">
                      Add-ons: {plan.addOns.map((a) => `${a.addOn.name}${a.included ? '' : ' (optional)'}`).join(', ')}
                    </p>
                  )}
                </div>
              )}
              <Field label="Base on report" hint="Copies the overview and opportunities into the draft.">
                {(p) => (
                  <Select {...p} value={reportId || latest?.id || 'none'} onChange={(e) => setReportId(e.target.value)}>
                    <option value="none">No report</option>
                    {[...reports]
                      .sort((a, b) => b.version - a.version)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          Version {r.version}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
              <Button type="submit" variant="primary" loading={create.pending} disabled={!settings.packages.length}>
                <Plus /> Create draft
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
