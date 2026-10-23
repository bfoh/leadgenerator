'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Database, FileText, ListChecks } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import * as messaging from '@/lib/data/messaging-services';
import { applyFollowUps, openDays, previewFollowUps } from '@/lib/data/response-services';
import { CHANGE_KIND_LABELS } from '@/lib/domain/conversion';
import { MESSAGE_CHANNEL_LABELS, PROVIDER_LABELS, type InboundMessage } from '@/lib/domain/messaging';
import { DEFAULT_SENDING_POLICY } from '@/lib/domain/sending-policy';
import type { Business } from '@/lib/domain/types';
import { formatDate, formatDateTime } from '@/lib/utils';
import { useAutomationSettings } from '@/lib/workspace/automation';
import { useAction, useChangeRequests, useConversionSchema, useInboundMessages, useMessagingSchema, useProposals } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/misc';
import { IntentBadge, ReadReplyDialog, ReadingNote, useReadings } from '@/components/outreach/reply-ui';

/** Replies, the follow-up plan, the meeting brief and open change requests for one prospect (phase 9). */
export function NextStepsTab({ business }: { business: Business }) {
  const { data: schema } = useConversionSchema();
  if (schema === false) {
    return (
      <Notice tone="warning" icon={Database} title="Replies and conversion are not set up for this workspace">
        Apply database migration 008 (supabase/migrations/008_response_conversion.sql) to read replies, plan follow-ups, prepare meeting briefs and record proposal change requests. See docs/RUNBOOK.md §14.
      </Notice>
    );
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <FollowUpPlan business={business} />
        <MeetingBriefCard business={business} />
      </div>
      <div className="space-y-5">
        <Replies business={business} />
        <OpenChanges business={business} />
      </div>
    </div>
  );
}

function FollowUpPlan({ business }: { business: Business }) {
  const { ctx, can, workspace } = useWorkspace();
  const { data: automation } = useAutomationSettings();
  const policy = automation?.sendingPolicy ?? DEFAULT_SENDING_POLICY;
  const plan = useQuery({ queryKey: [workspace.organizationId, 'follow-up-plan', business.id, policy], queryFn: () => previewFollowUps(ctx, business, policy) });
  const apply = useAction((c) => applyFollowUps(c, business, policy), { success: (p) => (p.length ? `${p.length} task${p.length === 1 ? '' : 's'} added` : 'Nothing new to add') });
  const tasks = plan.data ?? [];
  return (
    <Card>
      <CardHeader
        title="Follow-up plan"
        description="What to do next, from the conversation so far. Tasks only: a follow-up message is drafted by a person (or the drafting agent) from an approved template and checked by the gateway. Silence is never read as interest."
        actions={
          can('activities.write') && tasks.length > 0 ? (
            <Button size="sm" loading={apply.pending} onClick={() => void apply.run()}>
              <ListChecks aria-hidden /> Add as tasks
            </Button>
          ) : null
        }
      />
      <CardBody>
        {plan.isLoading ? (
          <p className="text-sm text-subtle">Planning…</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-subtle" data-testid="follow-up-empty">
            Nothing new to plan: every next step already has an open task, or the conversation has not started.
          </p>
        ) : (
          <ul className="space-y-2.5" data-testid="follow-up-plan">
            {tasks.map((t) => (
              <li key={t.title} className="text-sm">
                <p className="font-medium">{t.title}</p>
                <p className="text-xs text-subtle">
                  Due {formatDate(t.dueDate)} · {t.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function MeetingBriefCard({ business }: { business: Business }) {
  return (
    <Card>
      <CardHeader
        title="Meeting brief"
        description="One page for a call or visit: what the records support, the website position as recorded, the conversation so far, the issued proposal, questions to ask and what not to promise. Nothing is estimated; unknowns become questions."
      />
      <CardBody>
        <ButtonLink href={`/print/meetings/${business.id}`} external>
          <ClipboardList aria-hidden /> Open the meeting brief
        </ButtonLink>
      </CardBody>
    </Card>
  );
}

function Replies({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const { data: messagingSchema } = useMessagingSchema();
  const { data: inbound = [] } = useInboundMessages(business.id, messagingSchema === true);
  const ids = useMemo(() => inbound.map((m) => m.id), [inbound]);
  const { readings } = useReadings(ids);
  const [reading, setReading] = useState<InboundMessage | null>(null);
  const handled = useAction((ctx, m: InboundMessage, value: boolean) => messaging.setInboundHandled(ctx, m, value), { success: 'Updated' });
  return (
    <Card>
      <CardHeader title="Replies" description="What this business wrote, and what each reply means. The rules read every reply as it arrives; you can correct a reading or ask the AI to read it again." />
      {messagingSchema !== true || inbound.length === 0 ? (
        <EmptyState icon={FileText} title="No replies yet" description="Replies received through the provider, or logged on the Outreach inbox, appear here." />
      ) : (
        <ul className="divide-y divide-border" data-testid="prospect-replies">
          {inbound.map((m) => (
            <li key={m.id} className="space-y-1.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {m.optOut ? <Badge tone="danger">Opt-out · suppressed</Badge> : <IntentBadge reading={readings.get(m.id)} />}
                {m.handledAt ? <Badge>Handled</Badge> : <Badge tone="warning">To handle</Badge>}
                <span className="text-xs text-subtle">
                  {m.senderHint} · {MESSAGE_CHANNEL_LABELS[m.channel]} · {PROVIDER_LABELS[m.provider]} · {formatDateTime(m.receivedAt)}
                </span>
              </div>
              <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted">{m.body ?? 'The provider did not include the text.'}</p>
              {!m.optOut && <ReadingNote reading={readings.get(m.id)} />}
              {can('outreach.write') && (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setReading(m)}>
                    {m.optOut ? 'Why it is an opt-out' : 'What does it mean?'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handled.run(m, !m.handledAt)}>
                    {m.handledAt ? 'Mark as not handled' : 'Mark as handled'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {reading && <ReadReplyDialog message={reading} reading={readings.get(reading.id)} business={business} onClose={() => setReading(null)} />}
    </Card>
  );
}

function OpenChanges({ business }: { business: Business }) {
  const { data: requests = [] } = useChangeRequests(business.id);
  const { data: proposals = [] } = useProposals();
  const open = requests.filter((r) => r.status === 'open');
  if (open.length === 0) return null;
  return (
    <Card>
      <CardHeader title={`Open change requests (${open.length})`} description="What the client asked to change. An owner or admin decides each one on the proposal; acceptance waits until then." />
      <ul className="divide-y divide-border">
        {open.map((r) => {
          const p = proposals.find((x) => x.id === r.proposalId);
          return (
            <li key={r.id} className="px-4 py-2.5 text-sm">
              <p>
                <Badge tone="warning">{CHANGE_KIND_LABELS[r.kind]}</Badge> <span className="ml-1">{r.summary}</span>
              </p>
              <p className="mt-0.5 text-xs text-subtle">
                {p ? (
                  <Link href={`/proposals/${p.id}`} className="underline-offset-2 hover:underline">
                    {p.title}
                  </Link>
                ) : (
                  'Proposal'
                )}{' '}
                · open {openDays(r)} day{openDays(r) === 1 ? '' : 's'}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
