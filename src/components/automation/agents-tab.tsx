'use client';

import { Check, X } from 'lucide-react';
import { AGENT_LIST, isAvailable } from '@/lib/automation/agents/catalog';
import type { AgentDefinition } from '@/lib/automation/agents/types';
import { MODE_META } from '@/lib/automation/constants';
import type { AutomationSettings } from '@/lib/automation/types';
import { updateAutomationSettings, useAutomationAction } from '@/lib/workspace/automation';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/field';

const PROVIDER_LABELS: Record<string, string> = {
  google_places: 'Google Places',
  brave_search: 'Brave Search',
  anthropic: 'Anthropic',
  email: 'Email provider',
  whatsapp: 'WhatsApp Cloud API',
};

/** The agent catalog. `settings` is null when the database does not have the automation tables. */
export function AgentsTab({ settings }: { settings: AutomationSettings | null }) {
  const available = AGENT_LIST.filter(isAvailable);
  const planned = AGENT_LIST.filter((a) => !isAvailable(a)).sort((a, b) => a.phase - b.phase);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Available now" description="These agents run from the queue. Turning one off holds its jobs in the queue until it is turned back on." />
        <ul className="divide-y divide-border">
          {available.map((a) => (
            <AgentRow key={a.key} agent={a} settings={settings} />
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Planned" description="Listed with the roadmap phase that delivers them (docs/IMPLEMENTATION_ROADMAP.md). The queue refuses jobs for them until then." />
        <ul className="divide-y divide-border">
          {planned.map((a) => (
            <AgentRow key={a.key} agent={a} settings={settings} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AgentRow({ agent, settings }: { agent: AgentDefinition; settings: AutomationSettings | null }) {
  const { can } = useWorkspace();
  const save = useAutomationAction(updateAutomationSettings);
  const ready = isAvailable(agent);
  const enabled = settings ? !settings.disabledAgents.includes(agent.key) : false;
  const toggle = (on: boolean) => {
    if (!settings) return;
    const disabledAgents = on ? settings.disabledAgents.filter((k) => k !== agent.key) : [...settings.disabledAgents, agent.key];
    void save.run({ disabledAgents });
  };

  return (
    <li className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {agent.name}
          {ready ? (
            <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? `On · v${agent.version.replace(/^\D+-/, '')}` : 'Off'}</Badge>
          ) : (
            <Badge tone="neutral">{agent.phase > 10 ? 'Planned · after phase 10' : `Planned · Phase ${agent.phase}`}</Badge>
          )}
          {MODE_META[agent.minimumMode].outreach && <Badge tone="warning">Outreach</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-subtle">{agent.description}</p>
        <p className="mt-1 text-xs text-subtle">
          Needs mode: {MODE_META[agent.minimumMode].label}
          {agent.providers.length ? ` · Uses: ${agent.providers.map((p) => PROVIDER_LABELS[p] ?? p).join(', ')}` : ' · No paid providers'}
        </p>
        {ready && settings && can('automation.manage') && (
          <Checkbox className="mt-2" label="Enabled" checked={enabled} disabled={save.pending} onChange={(e) => toggle(e.target.checked)} aria-label={`${agent.name} enabled`} />
        )}
      </div>
      <ul className="space-y-1.5 text-xs">
        <li className="flex gap-2">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
          <span>
            <span className="font-medium">May: </span>
            <span className="text-muted">{agent.may}</span>
          </span>
        </li>
        <li className="flex gap-2">
          <X className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <span>
            <span className="font-medium">Never: </span>
            <span className="text-muted">{agent.never}</span>
          </span>
        </li>
      </ul>
    </li>
  );
}
