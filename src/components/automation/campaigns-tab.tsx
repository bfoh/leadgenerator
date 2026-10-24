'use client';

import { CalendarClock, FlaskConical, Plus, RefreshCw, Target, Users } from 'lucide-react';
import { useState } from 'react';
import { DISCOVERY_PROVIDER_CATALOG, campaignProviderBlocker } from '@/lib/domain/discovery-providers';
import { ApiError } from '@/lib/workspace/api';
import { useCampaigns } from '@/lib/workspace/campaigns';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/misc';
import { CampaignCard } from './campaign-card';
import { CampaignForm } from './campaign-form';
import { usd } from './badges';

const DESCRIPTION =
  'Campaigns run the research agents over prospects you already track: identity, website verification, contacts, audit, scoring and an evidence-based opportunity report. They never search Google Places and never contact a business.';

export function CampaignsTab() {
  const { workspace, can } = useWorkspace();
  const manage = can('automation.manage');
  const canRun = can('automation.run');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'draft'>('all');
  const { data, isLoading, error, refetch, isFetching } = useCampaigns();

  if (workspace.mode !== 'cloud') {
    return (
      <Notice tone="info" title="Campaigns need the cloud workspace">
        Demo mode keeps every record in this browser, so there is nowhere to queue background research. Sign in to your Supabase-backed workspace to run campaigns.
      </Notice>
    );
  }

  const campaigns = data?.campaigns ?? [];
  const shown = campaigns.filter((c) => (filter === 'all' ? true : filter === 'active' ? c.status === 'active' : c.status === 'draft'));
  const totals = campaigns.reduce(
    (acc, c) => ({
      targets: acc.targets + c.counts.total,
      completed: acc.completed + c.counts.completed,
      qualified: acc.qualified + c.counts.qualified,
      research: acc.research + c.counts.researching + c.counts.queued,
      spend: acc.spend + c.spendUsd,
      active: acc.active + (c.status === 'active' ? 1 : 0),
    }),
    { targets: 0, completed: 0, qualified: 0, research: 0, spend: 0, active: 0 },
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Research campaigns"
          description={DESCRIPTION}
          actions={
            manage ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden /> New campaign
              </Button>
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          <ul className="grid grid-cols-2 gap-2 lg:grid-cols-5" aria-label="Campaign totals">
            {[
              { icon: FlaskConical, label: 'Active campaigns', value: String(totals.active) },
              { icon: Users, label: 'Prospects in campaigns', value: String(totals.targets) },
              { icon: CalendarClock, label: 'In progress', value: String(totals.research) },
              { icon: Target, label: 'Qualified opportunities', value: String(totals.qualified) },
              { icon: RefreshCw, label: 'Recorded spend', value: usd(totals.spend) },
            ].map(({ icon: Icon, label, value }) => (
              <li key={label} className="rounded-lg border border-border bg-surface px-3.5 py-2.5">
                <span className="flex items-center gap-1.5 text-xs text-subtle">
                  <Icon className="size-3.5" aria-hidden /> {label}
                </span>
                <span className="mt-0.5 block text-xl font-semibold tabular">{value}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-subtle">
            {totals.completed} of {totals.targets} targeted prospect(s) finished research. Each campaign starts at most its stated number of prospects per run and
            respects its daily limit and budget. The scheduled worker does the work; this page only shows it.
          </p>
          {!manage && <p className="text-xs text-subtle">Only owners and administrators can create, activate or pause campaigns. You can read their progress here.</p>}
        </CardBody>
      </Card>

      {error && (
        <Notice tone={(error as ApiError).status === 503 ? 'warning' : 'danger'} title="Campaigns could not be loaded">
          {(error as ApiError).status === 503
            ? 'This workspace does not have the campaign tables yet. An owner needs to apply supabase/migrations/009_research_campaigns.sql (and 010 for districts) after a backup; see docs/RUNBOOK.md.'
            : error.message}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Filter campaigns">
          {(['all', 'active', 'draft'] as const).map((key) => (
            <Button key={key} variant={filter === key ? 'primary' : 'secondary'} onClick={() => setFilter(key)} aria-pressed={filter === key}>
              {key === 'all' ? 'All' : key === 'active' ? 'Active' : 'Drafts'}
            </Button>
          ))}
        </div>
        <Button onClick={() => void refetch()} loading={isFetching} aria-label="Refresh campaigns">
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-subtle">Loading campaigns…</p>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title={campaigns.length ? 'No campaigns match this filter' : 'No campaigns yet'}
          description={campaigns.length ? 'Choose “All” to see every campaign.' : 'Create one to research a region, a district or every tracked prospect in Ghana.'}
          action={manage && !campaigns.length ? <Button variant="primary" onClick={() => setCreating(true)}>New campaign</Button> : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((campaign) => (
            <li key={campaign.id}>
              <CampaignCard
                campaign={campaign}
                manage={manage}
                canRun={canRun}
                open={selected === campaign.id}
                onOpen={() => setSelected(selected === campaign.id ? null : campaign.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <ProviderPolicyCard />
      <CampaignForm open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function ProviderPolicyCard() {
  return (
    <Card>
      <CardHeader
        title="Where campaign data may come from"
        description="Each provider declares what it permits. A campaign may use only a provider that allows unattended discovery and CRM processing; none of the placeholders below is integrated."
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-subtle">
              <th scope="col" className="px-4 py-2 font-medium">Provider</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium">Permitted uses</th>
              <th scope="col" className="px-4 py-2 font-medium">Attribution / retention</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {DISCOVERY_PROVIDER_CATALOG.map((provider) => {
              const blocker = campaignProviderBlocker(provider.id);
              return (
                <tr key={provider.id}>
                  <th scope="row" className="px-4 py-2.5 text-left align-top font-medium">
                    {provider.name}
                  </th>
                  <td className="px-4 py-2.5 align-top">
                    <Badge tone={blocker ? 'neutral' : 'success'}>{blocker ? 'Not for campaigns' : 'Campaign-ready'}</Badge>
                    <p className="mt-1 text-xs text-subtle">{provider.status === 'live' ? 'Integrated' : 'Not integrated'}</p>
                  </td>
                  <td className="px-4 py-2.5 align-top text-xs text-muted">
                    {provider.permittedUses.length ? provider.permittedUses.map((u) => u.replace(/_/g, ' ')).join(', ') : 'None claimed'}
                  </td>
                  <td className="px-4 py-2.5 align-top text-xs text-muted">
                    {provider.attribution.required ? provider.attribution.text : provider.attribution.notes}
                    <span className="block text-subtle">{provider.retention.notes}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CardBody>
        <p className="text-xs text-subtle">
          Google Places stays user-initiated: a person starts every search, only the Place ID may be stored, and it can never be a campaign provider. A licensed
          directory or B2B provider becomes available only after its licence is reviewed and a connector is built.
        </p>
      </CardBody>
    </Card>
  );
}

