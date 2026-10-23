'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Database, Mail, Send } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { dueMessages, simulateDueDispatch, type DueRunSummary } from '@/lib/data/messaging-services';
import { MESSAGING_MIGRATION_REQUIRED } from '@/lib/data/store';
import { OPEN_MESSAGE_STATUSES, SENT_STATUSES, type OutreachMessage } from '@/lib/domain/messaging';
import { errorMessage } from '@/lib/utils';
import { useBusinesses, useInboundMessages, useMessagingSchema, useOutreachMessages } from '@/lib/workspace/hooks';
import { dispatchDueOnServer, useMessagingEnv } from '@/lib/workspace/messaging';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice, PageHeader, PageSkeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AuditTab } from './audit-tab';
import { InboxTab } from './inbox-tab';
import { MessageDialog, MessageList } from './message-ui';
import { PoliciesTab } from './policies-tab';
import { SetupTab } from './setup-tab';
import { TemplatesTab } from './templates-tab';

const TABS = [
  { key: 'messages', label: 'Messages' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'templates', label: 'Templates' },
  { key: 'policies', label: 'Policies' },
  { key: 'setup', label: 'Setup' },
  { key: 'audit', label: 'Audit' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const FILTERS = {
  open: 'Drafts and queue',
  sent: 'Sent',
  closed: 'Blocked, failed or cancelled',
  all: 'All',
} as const;
type Filter = keyof typeof FILTERS;

const DESCRIPTION =
  'Email and WhatsApp messages, each checked by the eligibility gateway (consent, suppression, contact validation, template and message policy, sender, duplicates, per-recipient and daily limits, quiet hours and human approval). In this version only the agency’s own sandbox test recipients can receive them.';

function describeDue(r: DueRunSummary) {
  if (r.paused) return 'Sending is paused; nothing was dispatched.';
  if (!r.checked) return 'No queued message is due.';
  return [r.sent && `${r.sent} sent`, r.deferred && `${r.deferred} waiting`, r.blocked && `${r.blocked} blocked`].filter(Boolean).join(', ') || `${r.checked} checked`;
}

export function OutreachWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: schema } = useMessagingSchema();
  const enabled = schema === true;
  const { data: businesses } = useBusinesses();
  const { data: messages } = useOutreachMessages(undefined, enabled);
  const { data: inbound = [] } = useInboundMessages(undefined, enabled);
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<OutreachMessage | null>(null);
  const { workspace, ctx, can } = useWorkspace();
  const { env } = useMessagingEnv();
  const qc = useQueryClient();
  const [dispatching, setDispatching] = useState(false);
  // Demo: the simulated provider in the browser. Cloud: the server re-checks each due message.
  async function dispatchDue() {
    setDispatching(true);
    try {
      const r = workspace.mode === 'demo' ? await simulateDueDispatch(ctx, env!) : await dispatchDueOnServer();
      toast.info(`${describeDue(r)}${workspace.mode === 'demo' && r.sent ? ' (simulated; nothing left the browser)' : ''}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDispatching(false);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === workspace.organizationId });
    }
  }

  const requested = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : 'messages';
  const navigate = (next: string) => router.replace(`${pathname}${next === 'messages' ? '' : `?tab=${next}`}`, { scroll: false });

  const groups = useMemo(() => {
    const list = messages ?? [];
    return {
      open: list.filter((m) => OPEN_MESSAGE_STATUSES.includes(m.status)),
      sent: list.filter((m) => SENT_STATUSES.includes(m.status) && m.status !== 'sending'),
      closed: list.filter((m) => ['blocked', 'failed', 'cancelled'].includes(m.status)),
      all: list,
    } satisfies Record<Filter, OutreachMessage[]>;
  }, [messages]);

  if (schema === false) {
    return (
      <>
        <PageHeader title="Outreach" description={DESCRIPTION} />
        <Notice tone="warning" icon={Database} title="Messaging is not set up for this workspace">
          {MESSAGING_MIGRATION_REQUIRED} Take a backup first (RUNBOOK.md, “Apply migration 006”).
        </Notice>
      </>
    );
  }
  if (!messages || !businesses) return <PageSkeleton />;
  const toHandle = inbound.filter((m) => !m.handledAt).length;
  const due = dueMessages(messages).length;

  return (
    <>
      <PageHeader title="Outreach" description={DESCRIPTION} />
      <Tabs value={tab} onValueChange={navigate}>
        <TabsList label="Outreach sections" className="mb-5">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} count={t.key === 'messages' ? groups.open.length : t.key === 'inbox' ? toHandle : undefined}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="messages">
          <Card>
            <CardHeader
              title={FILTERS[filter]}
              description="Draft a message from a prospect’s Contacts tab. Approval stores the gateway’s decision; the gateway runs again at dispatch, and quiet hours, limits and spacing make a queued message wait."
              actions={
                can('outreach.approve') && (
                  <Button size="sm" disabled={!env || !due} loading={dispatching} onClick={() => void dispatchDue()} title="Each due message passes every check again; timing rules make it wait.">
                    <Send aria-hidden /> {workspace.mode === 'demo' ? 'Simulate due messages' : 'Dispatch due messages'} <span className="tabular opacity-70">{due}</span>
                  </Button>
                )
              }
            />
            <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2" role="group" aria-label="Filter messages">
              {(Object.keys(FILTERS) as Filter[]).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? 'primary' : 'ghost'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {FILTERS[f]} <span className="tabular opacity-70">{groups[f].length}</span>
                </Button>
              ))}
            </div>
            <MessageList
              messages={groups[filter]}
              businesses={businesses}
              onOpen={setOpen}
              empty={<EmptyState icon={Mail} title="No messages here" description="Messages start as drafts on a prospect’s Contacts tab (actions menu of an email address or WhatsApp number)." />}
            />
          </Card>
        </TabsContent>
        <TabsContent value="inbox">
          <InboxTab businesses={businesses} />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="policies">
          <PoliciesTab />
        </TabsContent>
        <TabsContent value="setup">
          <SetupTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
      </Tabs>
      {open && <MessageDialog message={open} onClose={() => setOpen(null)} />}
    </>
  );
}
