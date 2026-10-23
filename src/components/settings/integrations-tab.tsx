'use client';

import { CheckCircle2, CircleDashed } from 'lucide-react';
import { useServerStatus } from '@/lib/workspace/api';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Notice, Skeleton } from '@/components/ui/misc';

function Row({ name, configured, detail, env }: { name: string; configured: boolean; detail: React.ReactNode; env: string[] }) {
  const Icon = configured ? CheckCircle2 : CircleDashed;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <Icon className={configured ? 'mt-0.5 size-4 text-success' : 'mt-0.5 size-4 text-subtle'} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {name} <Badge tone={configured ? 'success' : 'neutral'}>{configured ? 'Configured' : 'Not configured'}</Badge>
        </p>
        <div className="mt-0.5 text-xs text-subtle">{detail}</div>
      </div>
      <div className="flex flex-wrap gap-1">
        {env.map((e) => (
          <code key={e} className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-muted">
            {e}
          </code>
        ))}
      </div>
    </li>
  );
}

export function IntegrationsTab() {
  const { workspace } = useWorkspace();
  const { data: status, isLoading, error } = useServerStatus();

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !status) return <Notice tone="danger">Could not load integration status from the server.</Notice>;

  const live = status.discovery.filter((p) => !p.capabilities.isDemo);
  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <CardHeader title="Integrations" description="Keys live in server environment variables only. This page shows whether each one is set — never the value." />
        <ul className="divide-y divide-border">
          <Row
            name="Database and sign-in (Supabase)"
            configured={workspace.mode === 'cloud'}
            detail={workspace.mode === 'cloud' ? 'Cloud mode: records are stored in Supabase with row-level security per organization.' : 'Demo mode: records are stored in this browser only.'}
            env={['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']}
          />
          {live.map((p) => (
            <Row
              key={p.id}
              name={`Discovery: ${p.name}`}
              configured={p.configured}
              detail={`About $${p.estimatedCostUsd.search.toFixed(3)} per search and $${p.estimatedCostUsd.details.toFixed(3)} per details lookup (estimate). ${p.retention.notes}`}
              env={p.id === 'google_places' ? ['GOOGLE_PLACES_API_KEY'] : []}
            />
          ))}
          <Row
            name={`Web search: ${status.webSearch.name}`}
            configured={status.webSearch.configured}
            detail="Used on a prospect’s verification tab to look for an official website. Results are shown, not stored, until a researcher records them."
            env={['BRAVE_SEARCH_API_KEY']}
          />
          <Row
            name="AI opportunity reports (Anthropic)"
            configured={status.ai.configured}
            detail={status.ai.configured ? `Model: ${status.ai.model}. Without it, reports use the rule-based generator.` : 'Reports use the rule-based generator until a key is set.'}
            env={['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']}
          />
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Daily limits" description="Per organization (cloud) or per server instance (demo). Set with environment variables." />
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between">
                <span>Discovery searches</span>
                <span className="tabular text-muted">{status.quotas.discovery}</span>
              </li>
              <li className="flex justify-between">
                <span>AI reports</span>
                <span className="tabular text-muted">{status.quotas.aiReports}</span>
              </li>
              <li className="flex justify-between">
                <span>Website checks</span>
                <span className="tabular text-muted">{status.quotas.websiteChecks}</span>
              </li>
              <li className="flex justify-between">
                <span>Web searches</span>
                <span className="tabular text-muted">{status.quotas.webSearch}</span>
              </li>
            </ul>
          </CardBody>
        </Card>
        {status.mode === 'demo' && (
          <Notice tone={status.serverTools ? 'warning' : 'neutral'} title={status.serverTools ? 'Server tools are on in demo mode' : 'Server tools are off'}>
            {status.serverTools
              ? 'Discovery, website checks, web search and AI reports run without sign-in because this is a development server or DEMO_SERVER_TOOLS=true. Do not expose a deployment like this publicly with paid keys set.'
              : 'Paid and network tools are disabled for unauthenticated demo deployments. Configure Supabase so people sign in, or set DEMO_SERVER_TOOLS=true on a private deployment.'}
          </Notice>
        )}
      </div>
    </div>
  );
}
