'use client';

// Outbound message UI shared by the Outreach page and the prospect Contacts tab. Drafting never
// sends; approval runs the eligibility gateway and stores its decision; dispatch happens on the
// server (cloud) or in the clearly labelled simulated provider (demo). Timing rules (quiet hours,
// limits, spacing, a requested time) make a queued message wait rather than fail.

import { Bot, CheckCircle2, CircleAlert, Clock, Mail, MessageCircle, Send, ShieldCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import * as messaging from '@/lib/data/messaging-services';
import type { ContactPoint } from '@/lib/domain/contacts';
import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_PURPOSES,
  MESSAGE_PURPOSE_LABELS,
  MESSAGE_STATUS_META,
  PROVIDER_LABELS,
  PERSONAL_NOTE_MAX_WORDS,
  renderTemplate,
  validatePersonalNote,
  variableValues,
  wordCount,
  type GatewayCheck,
  type InboundMessage,
  type MessagePurpose,
  type OutreachMessage,
} from '@/lib/domain/messaging';
import { DEFAULT_SENDING_POLICY, MAX_SCHEDULE_AHEAD_DAYS, formatLocal, zonedTime } from '@/lib/domain/sending-policy';
import type { Business } from '@/lib/domain/types';
import { cn, errorMessage, formatDateTime } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { describeRun, researchable, runAgentNow, useAutomationAction, useAutomationAvailable } from '@/lib/workspace/automation';
import { useAction, useDecisions, useMessagingSchema, useOutreachMessages, useTemplates } from '@/lib/workspace/hooks';
import { dispatchOnServer, useMessagingEnv, type ServerDispatchResult } from '@/lib/workspace/messaging';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';

export function MessageStatusBadge({ message }: { message: Pick<OutreachMessage, 'status' | 'sandbox'> }) {
  const meta = MESSAGE_STATUS_META[message.status];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
      {message.sandbox ? ' · sandbox' : ''}
    </Badge>
  );
}

const CHECK_LABELS: Record<GatewayCheck['key'], string> = {
  mode: 'Mode and emergency stop',
  state: 'Message status',
  business: 'Business',
  suppression: 'Suppression list',
  consent: 'Consent',
  contact: 'Contact point',
  template: 'Template',
  policy: 'Message policy',
  sender: 'Sender',
  duplicate: 'Duplicates',
  frequency: 'Per-recipient limits',
  volume: 'Daily limits',
  schedule: 'Sending window',
  approval: 'Human approval',
};

/** The gateway's checks: failures, then waits, then passes. */
export function GatewayChecklist({ checks }: { checks: GatewayCheck[] }) {
  const rank = (c: GatewayCheck) => (c.passed ? 2 : c.waitUntil !== undefined ? 1 : 0);
  const sorted = [...checks].sort((a, b) => rank(a) - rank(b));
  return (
    <ul className="space-y-1.5 text-sm" data-testid="gateway-checks">
      {sorted.map((c, i) => (
        <li key={i} className="flex gap-2">
          {c.passed ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" />
          ) : c.waitUntil !== undefined ? (
            <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Waiting" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Failed" />
          )}
          <span>
            <span className="font-medium">{CHECK_LABELS[c.key]}:</span> <span className="text-muted">{c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function MessageList({ messages, businesses, onOpen, empty }: { messages: OutreachMessage[]; businesses: Pick<Business, 'id' | 'name'>[]; onOpen: (m: OutreachMessage) => void; empty: React.ReactNode }) {
  const names = useMemo(() => new Map(businesses.map((b) => [b.id, b.name])), [businesses]);
  if (!messages.length) return <>{empty}</>;
  return (
    <ul className="divide-y divide-border">
      {messages.map((m) => {
        const Icon = m.channel === 'email' ? Mail : MessageCircle;
        return (
          <li key={m.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="outreach-message">
            <div className="flex min-w-0 gap-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="truncate font-medium">{m.subject ?? m.body.slice(0, 80)}</p>
                <p className="text-xs text-subtle">
                  {MESSAGE_CHANNEL_LABELS[m.channel]} to {m.recipientHint} · {names.get(m.businessId) ?? 'Prospect'} · {MESSAGE_PURPOSE_LABELS[m.purpose]} · {formatDateTime(m.updatedAt)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <MessageStatusBadge message={m} />
                  {m.status === 'queued' && m.scheduledFor && <span className="text-xs text-subtle">Due {formatDateTime(m.scheduledFor)}</span>}
                </div>
              </div>
            </div>
            <Button size="sm" className="self-end sm:self-auto" onClick={() => onOpen(m)} aria-label={`Open message to ${m.recipientHint}`}>
              Open
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// ── Drafting ─────────────────────────────────────────────────────────────────

export function DraftMessageDialog({ business, point, inReplyTo, onClose }: { business: Business; point: ContactPoint; inReplyTo?: InboundMessage | null; onClose: () => void }) {
  const { ctx } = useWorkspace();
  const channel = messaging.channelForPoint(point)!;
  const { data: templates = [] } = useTemplates();
  const usable = templates.filter((t) => t.channel === channel && t.status === 'approved');
  const [purpose, setPurpose] = useState<MessagePurpose>(inReplyTo ? 'reply' : 'introduction');
  // Null until someone chooses: the first approved template, once the templates have loaded.
  const [templateChoice, setTemplateChoice] = useState<string | null>(inReplyTo ? '' : null);
  const templateId = templateChoice ?? (purpose === 'reply' ? '' : (usable[0]?.id ?? ''));
  const [subject, setSubject] = useState(inReplyTo?.subject ? `Re: ${inReplyTo.subject}`.slice(0, 200) : '');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [drafted, setDrafted] = useState<OutreachMessage | null>(null);
  const template = usable.find((t) => t.id === templateId) ?? null;
  const needsNote = messaging.usesPersonalNote(template);
  const noteErrors = needsNote && note.trim() ? validatePersonalNote(note) : [];
  const draft = useAction(messaging.draftMessage, { success: 'Draft saved. Nothing has been sent.', onSuccess: setDrafted });
  const values = variableValues(ctx.settings, business, ctx.userLabel, note.trim() || '[personal note]');
  const preview = template ? renderTemplate(template.body, values) : null;

  if (drafted) return <MessageDialog message={drafted} onClose={onClose} />;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Draft ${channel === 'email' ? 'an email' : 'a WhatsApp message'}`}
      description={`To ${point.hint} at ${business.name}. A draft is checked by the eligibility gateway when an owner or admin approves it; nothing is sent from here.`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={draft.pending}
            disabled={(purpose !== 'reply' && !template) || (needsNote && (!note.trim() || noteErrors.length > 0))}
            onClick={() => void draft.run({ business, point, purpose, template: purpose === 'reply' && !template ? null : template, subject, body, inReplyTo, personalNote: note })}
          >
            Save draft
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Purpose" required>
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as MessagePurpose)}>
              {MESSAGE_PURPOSES.map((x) => (
                <option key={x} value={x}>
                  {MESSAGE_PURPOSE_LABELS[x]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Template" hint={usable.length ? undefined : `No approved ${MESSAGE_CHANNEL_LABELS[channel]} template yet (Outreach → Templates).`}>
          {(p) => (
            <Select {...p} value={templateId} onChange={(e) => setTemplateChoice(e.target.value)}>
              <option value="">{purpose === 'reply' ? 'Free-text reply' : 'Choose a template'}</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {needsNote && (
          <Field
            label="Personal note"
            required
            className="sm:col-span-2"
            error={noteErrors[0]}
            hint={`One sentence from this prospect’s research (${PERSONAL_NOTE_MAX_WORDS} words at most): no prices, links, figures or claims that they have no website.`}
          >
            {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />}
          </Field>
        )}
        {template && preview ? (
          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-medium text-muted">Preview</p>
            <div className="whitespace-pre-wrap rounded-md border border-border bg-surface-muted p-3 text-sm" data-testid="draft-preview">
              {template.subject && <p className="mb-2 font-medium">{renderTemplate(template.subject, values).text}</p>}
              {preview.text}
            </div>
            {preview.missing.length > 0 && (
              <Notice tone="warning">
                Missing: {preview.missing.map((m) => `{{${m}}}`).join(', ')}. Fill in your agency details in{' '}
                <Link href="/settings" className="underline">
                  Settings → Agency
                </Link>
                .
              </Notice>
            )}
            {channel === 'email' && <p className="text-xs text-subtle">The server adds your name, agency, postal address and an unsubscribe link below the text when it sends.</p>}
          </div>
        ) : purpose === 'reply' ? (
          <>
            {channel === 'email' && (
              <Field label="Subject" className="sm:col-span-2">
                {(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}
              </Field>
            )}
            <Field label="Reply" required hint="Free text is allowed only within the reply window after the business wrote to you (WhatsApp: 24 hours)." className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />}
            </Field>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

// ── One message ──────────────────────────────────────────────────────────────

export function MessageDialog({ message: initial, onClose }: { message: OutreachMessage; onClose: () => void }) {
  const { workspace, can } = useWorkspace();
  const qc = useQueryClient();
  const { data: all } = useOutreachMessages(initial.businessId);
  const message = all?.find((m) => m.id === initial.id) ?? initial;
  const { data: decisions = [] } = useDecisions(message.id);
  const { env, loading: envLoading } = useMessagingEnv();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(message.subject ?? '');
  const [body, setBody] = useState(message.body);
  const [cancelReason, setCancelReason] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const latest = decisions[0] ?? null;
  const tz = env?.sendingPolicy.timezone ?? DEFAULT_SENDING_POLICY.timezone;

  const check = useAction((ctx, m: OutreachMessage) => messaging.evaluateMessage(ctx, m, env!, 'preview'), {
    success: ({ result }) => (result.eligible ? 'Eligible for approval' : `Not eligible: ${result.reasons.length} reason${result.reasons.length === 1 ? '' : 's'}`),
  });
  const approve = useAction((ctx, m: OutreachMessage) => messaging.approveMessage(ctx, m, env!, workspace.role), {
    success: (r) => (r.approved ? 'Approved after the eligibility check' : 'Not approved: the eligibility gateway blocked it'),
  });
  const save = useAction((ctx, m: OutreachMessage) => messaging.editDraft(ctx, m, { subject, body }), { success: 'Draft updated', onSuccess: () => setEditing(false) });
  const back = useAction(messaging.returnToDraft, { success: 'Returned to draft' });
  const queue = useAction((ctx, m: OutreachMessage) => messaging.queueMessage(ctx, m, { scheduledFor: scheduleAt ? wallTimeToIso(scheduleAt, tz) : null, timezone: tz }), {
    success: (m) => (scheduleAt && m.scheduledFor ? `Queued for ${formatLocal(m.scheduledFor, tz)}. The gateway checks it again then.` : 'Queued. The gateway checks it again at dispatch.'),
  });
  const cancel = useAction((ctx, m: OutreachMessage) => messaging.cancelMessage(ctx, m, cancelReason), { success: 'Cancelled. Nothing was sent.' });
  const remove = useAction(messaging.deleteDraft, { success: 'Draft deleted', onSuccess: onClose });
  const simulate = useAction((ctx, m: OutreachMessage) => messaging.simulateDispatch(ctx, m, env!), {
    success: (r) =>
      r.sent
        ? 'Simulated send — nothing was sent'
        : 'duplicate' in r
          ? 'Already dispatched'
          : 'deferred' in r
            ? waitingToast(r.message.scheduledFor, env?.sendingPaused ?? false, tz)
            : 'Blocked at dispatch by the gateway',
  });

  async function dispatch() {
    setDispatching(true);
    try {
      const r: ServerDispatchResult = await dispatchOnServer(message.id);
      if (r.duplicate) toast.info('This message was already dispatched.');
      else if (r.deferred) toast.info(waitingToast(r.scheduledFor ?? null, env?.sendingPaused ?? false, tz));
      else if (r.status === 'sent' || r.status === 'delivered') toast.success(r.sandbox ? 'Sent to the sandbox test recipient' : 'Sent');
      else toast.error(r.reasons[0] ?? `Not sent (${MESSAGE_STATUS_META[r.status].label.toLowerCase()})`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDispatching(false);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === workspace.organizationId });
    }
  }

  const draft = message.status === 'draft';
  const canApprove = can('outreach.approve');
  const meta = MESSAGE_STATUS_META[message.status];
  const timeline = [
    ['Drafted', message.createdAt],
    ['Approved', message.approvedAt],
    ['Queued', message.queuedAt],
    [message.status === 'queued' ? 'Due' : 'Was due', message.status === 'queued' || message.sendingAt ? message.scheduledFor : null],
    ['Handed to provider', message.sendingAt],
    ['Sent', message.sentAt],
    ['Delivered', message.deliveredAt],
    ['Read', message.readAt],
    [message.status === 'blocked' ? 'Blocked' : 'Failed', message.failedAt],
    ['Cancelled', message.cancelledAt],
  ].filter(([, at]) => at) as [string, string][];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${MESSAGE_CHANNEL_LABELS[message.channel]} to ${message.recipientHint}`}
      description={`${MESSAGE_PURPOSE_LABELS[message.purpose]} · ${meta.description}`}
      size="lg"
      footer={
        <>
          {draft && can('outreach.write') && (
            <>
              {can('records.delete') && (
                <Button variant="outline-danger" loading={remove.pending} onClick={() => void remove.run(message)}>
                  Delete draft
                </Button>
              )}
              <Button disabled={!env} loading={check.pending} onClick={() => void check.run(message)}>
                <ShieldCheck aria-hidden /> Check eligibility
              </Button>
              {canApprove && (
                <Button variant="primary" disabled={!env || editing} loading={approve.pending} onClick={() => void approve.run(message)}>
                  Approve
                </Button>
              )}
            </>
          )}
          {message.status === 'approved' && can('outreach.write') && (
            <>
              <Button loading={back.pending} onClick={() => void back.run(message)}>
                Return to draft
              </Button>
              <Button variant="primary" loading={queue.pending} onClick={() => void queue.run(message)}>
                {scheduleAt ? 'Schedule' : 'Queue for sending'}
              </Button>
            </>
          )}
          {message.status === 'queued' && canApprove && (
            workspace.mode === 'demo' ? (
              <Button variant="primary" disabled={!env} loading={simulate.pending} onClick={() => void simulate.run(message)}>
                <Send aria-hidden /> Simulate dispatch
              </Button>
            ) : (
              <Button variant="primary" loading={dispatching} onClick={() => void dispatch()} title="The server checks every rule again before calling the provider.">
                <Send aria-hidden /> Dispatch now
              </Button>
            )
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="message-detail">
        <div className="flex flex-wrap items-center gap-2">
          <MessageStatusBadge message={message} />
          <span className="text-xs text-subtle">
            {message.templateId ? `Template version ${message.templateVersion}` : 'Free-text reply'}
            {message.provider ? ` · ${PROVIDER_LABELS[message.provider]}` : ''}
          </span>
        </div>
        {workspace.mode === 'demo' && message.status === 'queued' && (
          <Notice tone="info" title="Demo mode">
            Dispatch here is simulated: the same checks run, nothing leaves the browser.
          </Notice>
        )}
        {message.status === 'delivery_unknown' && (
          <Notice tone="warning" icon={CircleAlert} title="Delivery unknown">
            The request left the server but no answer came back. It is never retried automatically. Check the provider’s dashboard before doing anything else.
          </Notice>
        )}
        {message.statusReason && <p className="text-sm text-muted">{message.statusReason}</p>}
        {message.status === 'approved' && can('outreach.write') && (
          <Field
            label={`Send at (optional, ${tz} time)`}
            hint={`Leave empty to send as soon as the sending policy allows. Up to ${MAX_SCHEDULE_AHEAD_DAYS} days ahead; quiet hours, limits and spacing still apply at that time.`}
          >
            {(p) => <Input {...p} type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />}
          </Field>
        )}

        {editing ? (
          <div className="space-y-3">
            {message.channel === 'email' && (
              <Field label="Subject">{(p) => <Input {...p} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />}</Field>
            )}
            <Field label="Message" hint={message.channel === 'email' ? `${wordCount(body)} words` : undefined}>
              {(p) => <Textarea {...p} rows={8} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />}
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={save.pending} onClick={() => void save.run(message)}>
                Save draft
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Discard changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="whitespace-pre-wrap rounded-md border border-border bg-surface-muted p-3 text-sm">
            {message.subject && <p className="mb-2 font-medium">{message.subject}</p>}
            {message.body}
          </div>
        )}
        {draft && !editing && can('outreach.write') && message.channel === 'email' && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit text
          </Button>
        )}

        <section aria-labelledby="gateway-heading" className="space-y-2">
          <h3 id="gateway-heading" className="text-sm font-semibold">
            Eligibility gateway
          </h3>
          {envLoading && <p className="text-xs text-subtle">Loading the workspace policy…</p>}
          {latest ? (
            <>
              <p className="text-xs text-subtle">
                {OUTCOME_LABELS[latest.outcome]} at {latest.stage} · {formatDateTime(latest.createdAt)} · {latest.gatewayVersion}
                {latest.sandbox ? ' · sandbox test recipient' : ''}
              </p>
              <GatewayChecklist checks={latest.checks} />
            </>
          ) : (
            <p className="text-sm text-subtle">Not checked yet. Approval runs every check and stores the decision.</p>
          )}
        </section>

        {timeline.length > 0 && (
          <section aria-labelledby="timeline-heading">
            <h3 id="timeline-heading" className="text-sm font-semibold">
              Timeline
            </h3>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {timeline.map(([label, at]) => (
                <li key={label}>
                  {label}: {formatDateTime(at)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {['draft', 'approved', 'queued'].includes(message.status) && can('outreach.write') && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end">
            <Field label="Reason for cancelling (optional)" className="flex-1">
              {(p) => <Input {...p} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={300} />}
            </Field>
            <Button variant="outline-danger" loading={cancel.pending} onClick={() => void cancel.run(message)}>
              Cancel message
            </Button>
          </div>
        )}
        <p className="text-xs text-subtle">
          <Link href={`/prospects/${message.businessId}?tab=contacts`} className="underline">
            Open the prospect
          </Link>
        </p>
      </div>
    </Dialog>
  );
}

const OUTCOME_LABELS = { eligible: 'Eligible', blocked: 'Blocked', deferred: 'Waiting' } as const;

/** A datetime-local value read as wall-clock time in the policy's time zone. */
function wallTimeToIso(value: string, tz: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return value;
  return zonedTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]) * 60 + Number(m[5]), tz).toISOString();
}

function waitingToast(until: string | null, paused: boolean, tz: string) {
  if (paused || !until) return 'Not sent yet: sending is paused. It stays queued.';
  return `Not sent yet: it waits until ${formatLocal(until, tz)} (sending policy).`;
}

/** Empty state for message lists. */
export function NoMessages({ text }: { text: string }) {
  return <EmptyState icon={Mail} title="No messages" description={text} className={cn('py-10')} />;
}

type AgentPurpose = 'introduction' | 'follow_up' | 'proposal';

/** Queues the Outreach Drafting agent for one prospect and runs it now. It writes a draft at most. */
function AgentDraftDialog({ business, onClose }: { business: Business; onClose: () => void }) {
  const { workspace } = useWorkspace();
  const { data: status } = useServerStatus();
  const aiConfigured = Boolean(status?.ai.configured);
  const [purpose, setPurpose] = useState<AgentPurpose>('introduction');
  const [ai, setAi] = useState(false);
  const run = useAutomationAction((a, b: Business) => runAgentNow(a, workspace.mode, 'outreach_drafting', b, { purpose, ai: ai && aiConfigured }), {
    success: ({ created, run: r }) =>
      r.outcomes.find((o) => o.agent === 'outreach_drafting')?.message ??
      (created ? describeRun(r) : 'The agent already ran for this prospect in the last minute. Try again in a minute.'),
    onSuccess: onClose,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Draft with the agent"
      description={`The Outreach Drafting agent picks a contact with consent on file and an approved template covered by a message policy, using the eligibility gateway’s checks, and writes one draft for ${business.name}. It cannot approve or send.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={run.pending} onClick={() => void run.run(business)}>
            <Bot aria-hidden /> Write the draft
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Purpose" required>
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as AgentPurpose)}>
              {(['introduction', 'follow_up', 'proposal'] as const).map((x) => (
                <option key={x} value={x}>
                  {MESSAGE_PURPOSE_LABELS[x]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox
          label="Write the personal note with AI"
          description={
            aiConfigured
              ? 'For templates with {{personal_note}}: one sentence citing recorded evidence, checked against the note rules. It uses the AI budget; you review the draft before approval.'
              : 'AI notes are not configured on this server (ANTHROPIC_API_KEY). Templates without a personal note can still be drafted.'
          }
          checked={ai && aiConfigured}
          disabled={!aiConfigured}
          onChange={(e) => setAi(e.target.checked)}
        />
      </div>
    </Dialog>
  );
}

/** A prospect's messages, for its Contacts tab. Hidden until the messaging migration is installed. */
export function ProspectMessages({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const { data: schema } = useMessagingSchema();
  const { data: messages = [] } = useOutreachMessages(business.id, schema === true);
  const { data: automation } = useAutomationAvailable();
  const [open, setOpen] = useState<OutreachMessage | null>(null);
  const [agent, setAgent] = useState(false);
  if (schema !== true) return null;
  const agentAvailable = Boolean(automation) && can('automation.run') && can('outreach.write') && researchable(business);
  return (
    <Card>
      <CardHeader
        title="Messages"
        description="Drafted from an email address or WhatsApp number above, or by the Outreach Drafting agent. Each one passes the eligibility gateway at approval and again at dispatch; in this version only sandbox test recipients can receive one."
        actions={
          agentAvailable && (
            <Button size="sm" onClick={() => setAgent(true)}>
              <Bot aria-hidden /> Draft with the agent
            </Button>
          )
        }
      />
      <MessageList messages={messages} businesses={[business]} onOpen={setOpen} empty={<NoMessages text="No messages for this prospect. Use “Draft a message…” in a contact detail’s actions menu." />} />
      {open && <MessageDialog message={open} onClose={() => setOpen(null)} />}
      {agent && <AgentDraftDialog business={business} onClose={() => setAgent(false)} />}
    </Card>
  );
}
