'use client';

import { Bot } from 'lucide-react';
import Link from 'next/link';
import { WORKFLOW_META } from '@/lib/automation/constants';
import { workflowStateOf } from '@/lib/automation/workflow';
import type { Business } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils';
import {
  agentName,
  describeQueued,
  describeRun,
  researchable,
  runResearchNow,
  useAgentRuns,
  useAutomationAction,
  useAutomationAvailable,
  useWorkflowTransitions,
} from '@/lib/workspace/automation';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { RunStatusBadge, WorkflowStateBadge, usd } from './badges';

export function ProspectWorkflowBadge({ business }: { business: Business }) {
  return <WorkflowStateBadge state={workflowStateOf(business)} />;
}

/** Queues the research pipeline for one prospect and processes it straight away. */
export function AutomateResearchButton({ business }: { business: Business }) {
  const { can, workspace } = useWorkspace();
  const { data: available } = useAutomationAvailable();
  const run = useAutomationAction((actx, b: Business) => runResearchNow(actx, workspace.mode, [b]), {
    success: ({ queued, run: r }) => (queued.created ? describeRun(r) : describeQueued(queued)),
  });
  if (!available || !can('automation.run') || !researchable(business)) return null;
  return (
    <Button loading={run.pending} onClick={() => void run.run(business)} title="Check identity, verify the website, audit and score from the evidence; if it qualifies, record the contact details its official website publishes and write an internal report. Uncertain results wait for review. Nothing is sent.">
      <Bot aria-hidden /> Automate research
    </Button>
  );
}

/** Selection-bar action on the prospects list. */
export function BulkAutomateResearch({ businesses, onDone }: { businesses: Business[]; onDone: () => void }) {
  const { can, workspace } = useWorkspace();
  const { data: available } = useAutomationAvailable();
  const run = useAutomationAction((actx, list: Business[]) => runResearchNow(actx, workspace.mode, list), {
    success: ({ queued, run: r }) => `${describeQueued(queued)} ${describeRun(r)}`,
    onSuccess: onDone,
  });
  if (!available || !can('automation.run')) return null;
  return (
    <Button size="sm" loading={run.pending} onClick={() => void run.run(businesses)}>
      <Bot aria-hidden /> Automate research
    </Button>
  );
}

/** Workflow transitions and agent runs for one prospect (Activity tab). */
export function ProspectAutomationHistory({ business }: { business: Business }) {
  const { data: available } = useAutomationAvailable();
  const { data: transitions = [] } = useWorkflowTransitions(business.id);
  const { data: runs = [] } = useAgentRuns({ businessId: business.id, limit: 20 });
  const state = workflowStateOf(business);

  return (
    <Card>
      <CardHeader
        title="Workflow and agents"
        description="The automated workflow is tracked separately from the sales stage. Every move and agent run is recorded."
        actions={<WorkflowStateBadge state={state} />}
      />
      {business.workflowStateReason && <p className="border-b border-border px-4 py-2 text-xs text-subtle">Current state: {business.workflowStateReason}</p>}
      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
        <section className="px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold text-muted">Workflow history</h3>
          {transitions.length === 0 ? (
            <p className="text-sm text-subtle">No recorded moves yet.</p>
          ) : (
            <ol className="space-y-2">
              {transitions.slice(0, 20).map((t) => (
                <li key={t.id} className="text-sm">
                  <p>
                    {t.fromState ? `${WORKFLOW_META[t.fromState].label} → ` : ''}
                    <span className="font-medium">{WORKFLOW_META[t.toState].label}</span>
                  </p>
                  <p className="text-xs text-subtle">
                    {formatDateTime(t.createdAt)} · {t.actorType === 'agent' ? 'Agent' : t.actorType === 'user' ? 'Team member' : 'System'}
                    {t.reason ? ` · ${t.reason}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="border-t border-border px-4 py-3 md:border-t-0">
          <h3 className="mb-2 text-xs font-semibold text-muted">Agent runs</h3>
          {!available ? (
            <p className="text-sm text-subtle">Automation is not set up for this workspace yet.</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-subtle">No agent has run on this prospect.</p>
          ) : (
            <ol className="space-y-2">
              {runs.map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <RunStatusBadge status={r.status} />
                    <span className="font-medium">{agentName(r.agent)}</span>
                  </p>
                  <p className="mt-0.5">{r.summary}</p>
                  <p className="text-xs text-subtle">
                    {formatDateTime(r.startedAt)}
                    {r.estimatedCostUsd ? ` · ${usd(r.estimatedCostUsd)}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {available && (
            <Link href="/automation?tab=runs" className="mt-3 inline-block text-xs text-subtle underline-offset-2 hover:underline">
              Open the run log
            </Link>
          )}
        </section>
      </div>
    </Card>
  );
}
