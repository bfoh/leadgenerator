'use client';

// One chronological trail for outreach: every gateway decision (append-only), every change to
// messages, templates and message policies (the database audit trigger), and every change to the
// workspace's sending controls. Addresses and message text are not shown here; hints only.

import { History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { MESSAGE_STATUS_META, POLICY_STATUS_META, TEMPLATE_STATUS_META, type MessageStatus, type PolicyStatus, type TemplateStatus } from '@/lib/domain/messaging';
import { formatDateTime } from '@/lib/utils';
import { useSettingsHistory } from '@/lib/workspace/automation';
import { useAuditTrail, useMembers, useMessagePolicies, useOutreachMessages, useTemplates } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';

const TABLES = ['outreach_messages', 'message_templates', 'message_policies'];
const SHOWN = 200;

type Kind = 'decision' | 'message' | 'template' | 'policy' | 'controls';
const KIND_LABELS: Record<Kind, string> = { decision: 'Gateway', message: 'Message', template: 'Template', policy: 'Policy', controls: 'Controls' };
const FILTERS = { all: 'All', decision: 'Gateway decisions', message: 'Messages', setup: 'Templates, policies and controls' } as const;
type Filter = keyof typeof FILTERS;

interface Entry {
  id: string;
  at: string;
  kind: Kind;
  title: string;
  detail: string | null;
  actor: string;
}

// Cloud audit rows use column names; demo rows use field names.
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const CONTROL_LABELS: Record<string, string> = {
  mode: 'automation mode',
  paused: 'job queue pause',
  outboundStopped: 'outbound emergency stop',
  outboundStopReason: 'emergency stop reason',
  sendingPolicy: 'sending policy',
  sendingPaused: 'sending pause',
  sendingPauseReason: 'pause reason',
  disabledAgents: 'disabled agents',
  maxConcurrentJobs: 'concurrent jobs',
  budgets: 'budgets',
};

function statusChange<T extends string>(changes: Record<string, { old: unknown; new: unknown }> | null, meta: Record<T, { label: string }>) {
  const c = changes?.status;
  if (!c) return null;
  const label = (v: unknown) => meta[v as T]?.label ?? String(v);
  return `${label(c.old)} → ${label(c.new)}`;
}

export function AuditTab() {
  const { store, workspace, ctx } = useWorkspace();
  const [filter, setFilter] = useState<Filter>('all');
  const { data: decisions = [] } = useQuery({ queryKey: [workspace.organizationId, 'eligibility-decisions', 'all'], queryFn: () => store.listDecisions() });
  const { data: events = [] } = useAuditTrail(TABLES);
  const { data: history = [] } = useSettingsHistory();
  const { data: messages = [] } = useOutreachMessages();
  const { data: templates = [] } = useTemplates();
  const { data: policies = [] } = useMessagePolicies();
  const { data: members = [] } = useMembers();

  const entries = useMemo(() => {
    const who = (id: string | null, agent = false) => (agent ? 'Agent' : !id ? 'Server' : id === ctx.userId ? ctx.userLabel : (members.find((m) => m.userId === id)?.email ?? 'A team member'));
    const hint = new Map(messages.map((m) => [m.id, m.recipientHint]));
    const templateName = new Map(templates.map((t) => [t.id, t.name]));
    const policyName = new Map(policies.map((p) => [p.id, p.name]));
    const out: Entry[] = [];
    for (const d of decisions) {
      out.push({
        id: `d-${d.id}`,
        at: d.createdAt,
        kind: 'decision',
        title: `${d.outcome === 'eligible' ? 'Eligible' : d.outcome === 'deferred' ? 'Waiting' : 'Blocked'} at ${d.stage}${d.messageId && hint.get(d.messageId) ? ` · message to ${hint.get(d.messageId)}` : ''}${d.sandbox ? ' · sandbox' : ''}`,
        detail: d.reasons[0] ?? 'Every check passed.',
        actor: who(d.actorId, d.actorType === 'agent'),
      });
    }
    for (const e of events) {
      const kind: Kind = e.tableName === 'outreach_messages' ? 'message' : e.tableName === 'message_templates' ? 'template' : 'policy';
      const name = kind === 'message' ? `Message to ${hint.get(e.recordId) ?? 'a deleted draft'}` : kind === 'template' ? `Template “${templateName.get(e.recordId) ?? 'deleted'}”` : `Policy “${policyName.get(e.recordId) ?? 'unknown'}”`;
      const status =
        kind === 'message'
          ? statusChange<MessageStatus>(e.changes, MESSAGE_STATUS_META)
          : kind === 'template'
            ? statusChange<TemplateStatus>(e.changes, TEMPLATE_STATUS_META)
            : statusChange<PolicyStatus>(e.changes, POLICY_STATUS_META);
      const fields = Object.keys(e.changes ?? {}).map(camel).filter((k) => k !== 'status');
      out.push({
        id: `a-${e.id}`,
        at: e.createdAt,
        kind,
        title: `${name}: ${e.action === 'insert' ? (kind === 'policy' ? 'approved' : 'created') : e.action === 'delete' ? 'deleted' : (status ?? 'updated')}`,
        detail: e.action === 'update' && fields.length ? `Changed: ${fields.join(', ')}` : null,
        actor: who(e.actorId),
      });
    }
    for (const h of history) {
      const keys = Object.keys(h.changes ?? {}).map(camel).filter((k) => k in CONTROL_LABELS);
      if (!keys.length) continue;
      const paused = h.changes?.sendingPaused ?? h.changes?.sending_paused;
      out.push({
        id: `s-${h.id}`,
        at: h.createdAt,
        kind: 'controls',
        title: paused ? (paused.new ? 'Sending paused' : 'Sending resumed') : `Changed ${keys.map((k) => CONTROL_LABELS[k]).join(', ')}`,
        detail: paused ? String((h.changes?.sendingPauseReason ?? h.changes?.sending_pause_reason)?.new ?? '') || null : null,
        actor: who(h.actorId),
      });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [decisions, events, history, messages, templates, policies, members, ctx.userId, ctx.userLabel]);

  const shown = entries.filter((e) => filter === 'all' || (filter === 'setup' ? ['template', 'policy', 'controls'].includes(e.kind) : e.kind === filter));
  return (
    <Card>
      <CardHeader
        title="Audit trail"
        description="Every gateway decision, every change to messages, templates and message policies, and every change to the sending controls, newest first. Decisions cannot be edited or deleted."
      />
      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2" role="group" aria-label="Filter the audit trail">
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {FILTERS[f]}
          </Button>
        ))}
      </div>
      {shown.length ? (
        <ul className="divide-y divide-border">
          {shown.slice(0, SHOWN).map((e) => (
            <li key={e.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-3" data-testid="audit-entry">
              <Badge tone={e.kind === 'decision' ? 'info' : e.kind === 'controls' ? 'warning' : 'neutral'} className="self-start">
                {KIND_LABELS[e.kind]}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{e.title}</p>
                {e.detail && <p className="text-xs text-muted">{e.detail}</p>}
              </div>
              <p className="shrink-0 text-xs text-subtle">
                {e.actor} · {formatDateTime(e.at)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={History} title="Nothing recorded yet" description="Decisions and changes appear here as messages are drafted, checked, approved and dispatched." className="py-10" />
      )}
      {shown.length > SHOWN && <p className="border-t border-border px-4 py-2 text-xs text-subtle">Showing the latest {SHOWN} of {shown.length} entries.</p>}
    </Card>
  );
}
