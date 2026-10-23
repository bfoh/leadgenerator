'use client';

import { Bot, Flame } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { leadAlerts, reclassifyReply } from '@/lib/data/response-services';
import { MESSAGE_CHANNEL_LABELS, type InboundMessage } from '@/lib/domain/messaging';
import { REPLY_INTENT_META, REPLY_INTENTS, latestClassifications, type ReplyClassification, type ReplyIntent } from '@/lib/domain/replies';
import type { Business } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { describeRun, researchable, runAgentNow, useAutomationAction, useAutomationAvailable } from '@/lib/workspace/automation';
import { useAction, useConversionSchema, useInboundMessages, useReplyClassifications } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

const SOURCE_LABELS: Record<ReplyClassification['source'], string> = {
  rules: 'rules',
  ai: 'AI',
  person: 'set by a person',
};

/** The current reading of each received message (empty until migration 008 is applied). */
export function useReadings(inboundIds?: readonly string[]) {
  const { data: schema } = useConversionSchema();
  const { data: rows = [] } = useReplyClassifications(inboundIds, schema === true && (!inboundIds || inboundIds.length > 0));
  return {
    available: schema === true,
    readings: useMemo(() => latestClassifications(rows), [rows]),
    rows,
  };
}

export function IntentBadge({ reading }: { reading: ReplyClassification | undefined }) {
  if (!reading) return <Badge tone="neutral">Not read yet</Badge>;
  const meta = REPLY_INTENT_META[reading.intent];
  return (
    <Badge tone={meta.tone} title={`${meta.next} (Read by ${SOURCE_LABELS[reading.source]}${reading.source === 'person' ? '' : `, ${reading.confidence}% sure`}.)`}>
      {meta.hot && <Flame className="size-3" aria-hidden />}
      {meta.label}
      <span className="font-normal"> · {SOURCE_LABELS[reading.source]}</span>
    </Badge>
  );
}

/** What the reading means for the team, under the message. */
export function ReadingNote({ reading }: { reading: ReplyClassification | undefined }) {
  if (!reading) return null;
  return (
    <p className="text-xs text-subtle">
      {reading.summary ? <span className="text-muted">“{reading.summary}” · </span> : null}
      Next: {REPLY_INTENT_META[reading.intent].next}
    </p>
  );
}

/**
 * Read a message again: a person sets what it means, or asks the Response Classification agent to
 * read it with AI. An opt-out stays an opt-out whoever reads it.
 */
export function ReadReplyDialog({ message, reading, business, onClose }: { message: InboundMessage; reading: ReplyClassification | undefined; business: Business | null; onClose: () => void }) {
  const { can, workspace } = useWorkspace();
  const { data: status } = useServerStatus();
  const { data: automation } = useAutomationAvailable();
  const [intent, setIntent] = useState<ReplyIntent>(reading?.intent ?? 'unclear');
  const [summary, setSummary] = useState(reading?.source === 'person' ? (reading.summary ?? '') : '');
  const save = useAction(
    (ctx) =>
      reclassifyReply(ctx, {
        message,
        by: { kind: 'person', intent, summary },
      }),
    {
      success: ({ reading: r, suppressed }) => `Reading saved: ${REPLY_INTENT_META[r.intent].label.toLowerCase()}${suppressed ? '; the sender is now suppressed' : ''}`,
      onSuccess: onClose,
    },
  );
  const aiReady = Boolean(status?.ai.configured) && Boolean(automation) && can('automation.run') && business != null && researchable(business) && !message.optOut && Boolean(message.body?.trim());
  const ai = useAutomationAction(
    (a, b: Business) =>
      runAgentNow(a, workspace.mode, 'response_classification', b, {
        messageId: message.id,
        ai: true,
      }),
    {
      success: ({ created, run: r }) =>
        r.outcomes.find((o) => o.agent === 'response_classification')?.message ?? (created ? describeRun(r) : 'The agent already ran for this prospect in the last minute. Try again in a minute.'),
      onSuccess: onClose,
    },
  );
  const wasAiOptOut = reading?.intent === 'opt_out' && !message.optOut;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="What does this reply mean?"
      description={`${MESSAGE_CHANNEL_LABELS[message.channel]} from ${message.senderHint}, ${formatDateTime(message.receivedAt)}. A reading creates a task for your team; nothing is sent.`}
      footer={
        message.optOut ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            {aiReady && (
              <Button loading={ai.pending} onClick={() => void ai.run(business!)}>
                <Bot aria-hidden /> Read with AI
              </Button>
            )}
            <Button variant="primary" loading={save.pending} onClick={() => void save.run()}>
              Save reading
            </Button>
          </>
        )
      }
    >
      {message.optOut ? (
        <Notice tone="danger" title="An opt-out stays an opt-out">
          The reply matched the opt-out rules (“{message.optOutMatch}”) and the sender is suppressed on every channel. No classifier or person can read it as anything else; only an owner or admin can lift the
          suppression, against new consent.
        </Notice>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Current reading: <IntentBadge reading={reading} />
          </p>
          {wasAiOptOut && (
            <Notice tone="warning">The sender was suppressed when this reply was read as an opt-out. Changing the reading does not lift that suppression; an owner or admin lifts it against new consent.</Notice>
          )}
          <Field label="It means" required>
            {(p) => (
              <Select {...p} value={intent} onChange={(e) => setIntent(e.target.value as ReplyIntent)}>
                {REPLY_INTENTS.map((i) => (
                  <option key={i} value={i}>
                    {REPLY_INTENT_META[i].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="text-xs text-subtle">{REPLY_INTENT_META[intent].next}</p>
          {intent === 'opt_out' && <Notice tone="warning">Saving this suppresses the sender on every channel.</Notice>}
          <Field label="What they asked for (optional)" hint="One line for the team. Contact details are removed.">
            {(p) => <Input {...p} value={summary} maxLength={300} onChange={(e) => setSummary(e.target.value)} />}
          </Field>
          {!aiReady && status?.ai.configured && !message.optOut && <p className="text-xs text-subtle">Reading with AI needs automation set up for this workspace and a prospect that is open.</p>}
        </div>
      )}
    </Dialog>
  );
}

/** Interested-lead alerts: unhandled replies whose reading needs an answer today. */
export function LeadAlertsCard({ businesses }: { businesses: Business[] }) {
  const { data: schema } = useConversionSchema();
  const { data: inbound = [] } = useInboundMessages(undefined, schema === true);
  const { readings, rows } = useReadings();
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);
  const alerts = useMemo(() => leadAlerts(inbound, rows), [inbound, rows]);
  if (schema !== true || alerts.length === 0) return null;
  return (
    <Card data-testid="lead-alerts">
      <CardHeader
        title={`Interested leads (${alerts.length})`}
        description="Replies read as interested, a meeting request or a question about price or the proposal, not yet handled. Answer them today; prices come only from an issued proposal or your price list."
        actions={
          <Link href="/outreach?tab=inbox&filter=attention" className="text-xs text-muted underline-offset-2 hover:underline">
            Open the inbox
          </Link>
        }
      />
      <ul className="divide-y divide-border">
        {alerts.slice(0, 6).map(({ message }) => {
          const b = message.businessId ? byId.get(message.businessId) : null;
          return (
            <li key={message.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                {b ? (
                  <Link href={`/prospects/${b.id}?tab=next`} className="font-medium underline-offset-2 hover:underline">
                    {b.name}
                  </Link>
                ) : (
                  <span className="font-medium">{message.senderHint}</span>
                )}
                <span className="ml-2 text-xs text-subtle">{formatDateTime(message.receivedAt)}</span>
              </span>
              <IntentBadge reading={readings.get(message.id)} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
