'use client';

import { Inbox, MessageSquarePlus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import * as messaging from '@/lib/data/messaging-services';
import type { ContactPoint } from '@/lib/domain/contacts';
import { MESSAGE_CHANNEL_LABELS, PROVIDER_LABELS, type InboundMessage } from '@/lib/domain/messaging';
import { HOT_INTENTS } from '@/lib/domain/replies';
import type { Business } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils';
import { useAction, useContactPoints, useInboundMessages } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';
import { DraftMessageDialog } from './message-ui';
import { IntentBadge, ReadReplyDialog, ReadingNote, useReadings } from './reply-ui';

const INBOX_FILTERS = {
  all: 'All',
  attention: 'Needs attention',
  open: 'To handle',
  opt_out: 'Opt-outs',
} as const;
type InboxFilter = keyof typeof INBOX_FILTERS;

export function InboxTab({ businesses }: { businesses: Business[] }) {
  const { workspace, can } = useWorkspace();
  const { data: inbound = [] } = useInboundMessages();
  const { data: points = [] } = useContactPoints();
  const [logging, setLogging] = useState(false);
  const [replying, setReplying] = useState<InboundMessage | null>(null);
  const [reading, setReading] = useState<InboundMessage | null>(null);
  const requested = useSearchParams().get('filter');
  const [filter, setFilter] = useState<InboxFilter>(requested && requested in INBOX_FILTERS ? (requested as InboxFilter) : 'all');
  const { available: readable, readings } = useReadings();
  const groups = useMemo(() => {
    const hot = (m: InboundMessage) => !m.handledAt && !m.optOut && HOT_INTENTS.includes(readings.get(m.id)?.intent ?? 'unclear');
    return {
      all: inbound,
      attention: inbound.filter(hot),
      open: inbound.filter((m) => !m.handledAt),
      opt_out: inbound.filter((m) => m.optOut || readings.get(m.id)?.intent === 'opt_out'),
    } satisfies Record<InboxFilter, InboundMessage[]>;
  }, [inbound, readings]);
  const shown = groups[filter];
  const handled = useAction((ctx, m: InboundMessage, value: boolean) => messaging.setInboundHandled(ctx, m, value), { success: 'Updated' });
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);
  const reply = replying
    ? {
        business: byId.get(replying.businessId ?? ''),
        point: points.find((p) => p.id === replying.contactPointId),
      }
    : null;

  return (
    <Card>
      <CardHeader
        title="Received messages"
        description="Replies arrive through the provider webhooks. An opt-out reply (STOP, unsubscribe, “do not contact”…) suppresses the sender on every channel immediately. Each reply is read by the rules (interested, meeting request, pricing question, not now…) and becomes a task for your team; nothing is ever answered automatically."
        actions={
          can('outreach.write') ? (
            <Button size="sm" onClick={() => setLogging(true)}>
              <MessageSquarePlus aria-hidden /> {workspace.mode === 'demo' ? 'Simulate or log a reply' : 'Log a reply received elsewhere'}
            </Button>
          ) : null
        }
      />
      {!readable && inbound.length > 0 && (
        <p className="border-b border-border px-4 py-2 text-xs text-subtle">Apply database migration 008 to read what replies mean (interested, meeting request, pricing question…) and get interested-lead alerts.</p>
      )}
      {readable && inbound.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2" role="group" aria-label="Show">
          {(Object.keys(INBOX_FILTERS) as InboxFilter[]).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {INBOX_FILTERS[f]} <span className="tabular opacity-70">{groups[f].length}</span>
            </Button>
          ))}
        </div>
      )}
      {inbound.length === 0 ? (
        <EmptyState icon={Inbox} title="No replies yet" description="Replies to sandbox tests and, later, to approved outreach appear here with the prospect they came from." />
      ) : shown.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-subtle">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((m) => {
            const b = m.businessId ? byId.get(m.businessId) : null;
            return (
              <li key={m.id} className="space-y-1.5 px-4 py-3" data-testid="inbound-message">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.senderHint}</span>
                  <span className="text-xs text-subtle">
                    {MESSAGE_CHANNEL_LABELS[m.channel]} · {PROVIDER_LABELS[m.provider]} · {formatDateTime(m.receivedAt)}
                  </span>
                  {m.optOut && <Badge tone="danger">Opt-out · suppressed</Badge>}
                  {readable && !m.optOut && <IntentBadge reading={readings.get(m.id)} />}
                  {m.handledAt ? <Badge>Handled</Badge> : <Badge tone="warning">To handle</Badge>}
                </div>
                <p className="text-xs">
                  {b ? (
                    <Link href={`/prospects/${b.id}?tab=contacts`} className="text-muted underline-offset-2 hover:underline">
                      {b.name}
                    </Link>
                  ) : (
                    <span className="text-subtle">No prospect matches this sender.</span>
                  )}
                </p>
                {m.subject && <p className="text-sm font-medium">{m.subject}</p>}
                <p className="whitespace-pre-wrap text-sm text-muted">{m.body ?? 'The provider did not include the text. Read it in the mailbox.'}</p>
                {readable && !m.optOut && <ReadingNote reading={readings.get(m.id)} />}
                {can('outreach.write') && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => void handled.run(m, !m.handledAt)}>
                      {m.handledAt ? 'Mark as not handled' : 'Mark as handled'}
                    </Button>
                    {readable && (
                      <Button size="sm" variant="ghost" onClick={() => setReading(m)}>
                        {m.optOut ? 'Why it is an opt-out' : 'What does it mean?'}
                      </Button>
                    )}
                    {!m.optOut && b && m.contactPointId && (
                      <Button size="sm" variant="ghost" onClick={() => setReplying(m)}>
                        Draft a reply
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {reading && <ReadReplyDialog message={reading} reading={readings.get(reading.id)} business={reading.businessId ? (byId.get(reading.businessId) ?? null) : null} onClose={() => setReading(null)} />}
      {logging && <LogReplyDialog businesses={businesses} points={points} onClose={() => setLogging(false)} />}
      {replying && reply?.business && reply.point && <DraftMessageDialog business={reply.business} point={reply.point} inReplyTo={replying} onClose={() => setReplying(null)} />}
    </Card>
  );
}

function LogReplyDialog({ businesses, points, onClose }: { businesses: Business[]; points: ContactPoint[]; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const messagingPoints = points.filter((p) => (p.type === 'email' || p.type === 'whatsapp') && p.valueHash);
  const [pointId, setPointId] = useState(messagingPoints[0]?.id ?? '');
  const [provider, setProvider] = useState<'simulated' | 'manual'>(workspace.mode === 'demo' ? 'simulated' : 'manual');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const point = messagingPoints.find((p) => p.id === pointId);
  const business = businesses.find((b) => b.id === point?.businessId);
  const record = useAction(messaging.recordReply, {
    success: (m) => (m.optOut ? 'Opt-out recorded; the sender is suppressed' : 'Reply recorded and read'),
    onSuccess: onClose,
  });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={workspace.mode === 'demo' ? 'Simulate or log a reply' : 'Log a reply received elsewhere'}
      description="Logged replies are kept for the record and run the same opt-out rules. They never open a reply window: only replies received through the provider do."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!point || !business} loading={record.pending} onClick={() => point && business && void record.run({ business, point, text, subject, provider })}>
            Record reply
          </Button>
        </>
      }
    >
      {messagingPoints.length === 0 ? (
        <Notice tone="info">Record an email address or WhatsApp number on a prospect first.</Notice>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" required className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={pointId} onChange={(e) => setPointId(e.target.value)}>
                {messagingPoints.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.hint} · {businesses.find((b) => b.id === x.businessId)?.name ?? 'Prospect'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {workspace.mode === 'demo' && (
            <Field label="Kind" hint="A simulated reply stands in for the provider webhook (demo only).">
              {(p) => (
                <Select {...p} value={provider} onChange={(e) => setProvider(e.target.value as 'simulated' | 'manual')}>
                  <option value="simulated">Simulated provider reply (demo)</option>
                  <option value="manual">Logged by a person</option>
                </Select>
              )}
            </Field>
          )}
          {point?.type === 'email' && <Field label="Subject">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />}</Field>}
          <Field label="Reply text" required className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={10_000} />}
          </Field>
        </div>
      )}
    </Dialog>
  );
}
