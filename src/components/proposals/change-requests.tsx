'use client';

import { Check, GitPullRequestArrow, Undo2, X } from 'lucide-react';
import { useState } from 'react';
import { decideChangeRequest, recordChangeRequest } from '@/lib/data/response-services';
import { CHANGE_KIND_LABELS, CHANGE_KINDS, CHANGE_STATUS_META, type ChangeKind, type ChangeRequest, type ChangeStatus } from '@/lib/domain/conversion';
import type { Proposal } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils';
import { useAction, useChangeRequests, useConversionSchema, useInboundMessages } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';

/** This proposal's change requests (empty until migration 008 is applied). */
export function useProposalChanges(proposal: Pick<Proposal, 'id' | 'businessId'>) {
  const { data: schema } = useConversionSchema();
  const { data: requests = [] } = useChangeRequests(proposal.businessId, schema === true);
  return { available: schema === true, requests: requests.filter((r) => r.proposalId === proposal.id) };
}

type Decision = Exclude<ChangeStatus, 'open'>;

/**
 * Proposal discussion: what the client asked to change (price, scope, timeline, payment or contract
 * terms). Sales records requests; only owners and admins agree or decline them, with a note, and an
 * agreed change goes into a revised proposal that is approved and issued again before acceptance.
 */
export function ChangeRequests({ proposal }: { proposal: Proposal }) {
  const { can, workspace, ctx } = useWorkspace();
  const { available, requests } = useProposalChanges(proposal);
  const { data: inbound = [] } = useInboundMessages(proposal.businessId, available);
  const [kind, setKind] = useState<ChangeKind>('scope');
  const [summary, setSummary] = useState('');
  const [replyId, setReplyId] = useState('');
  const [deciding, setDeciding] = useState<{ request: ChangeRequest; status: Decision } | null>(null);
  const record = useAction((c) => recordChangeRequest(c, proposal, { kind, summary, inboundMessageId: replyId || null }), {
    success: 'Change request recorded for an owner or admin to decide',
    onSuccess: () => {
      setSummary('');
      setReplyId('');
    },
  });
  if (!available) return null;
  const recordable = (proposal.status === 'approved' || proposal.status === 'sent') && can('proposals.write');
  if (!recordable && requests.length === 0) return null;
  const negotiates = can('proposals.negotiate');

  return (
    <Card className="mb-5">
      <CardHeader
        title="Discussion and change requests"
        as="h2"
        description="What the client asked to change. Recording a request agrees nothing: an owner or admin decides each one with a note, and an agreed change goes into a revised proposal that is approved and issued again before acceptance can be recorded."
      />
      <CardBody className="space-y-4">
        {requests.length === 0 ? (
          <p className="text-sm text-subtle">No change requests.</p>
        ) : (
          <ul className="space-y-3" data-testid="change-requests">
            {requests.map((r) => {
              const withdrawable = r.status === 'open' && (negotiates || r.requestedBy === ctx.userId);
              return (
                <li key={r.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={CHANGE_STATUS_META[r.status].tone}>{CHANGE_STATUS_META[r.status].label}</Badge>
                    <span className="text-xs font-medium text-muted">{CHANGE_KIND_LABELS[r.kind]}</span>
                    <span className="text-xs text-subtle">recorded {formatDateTime(r.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{r.summary}</p>
                  {r.decisionNote && (
                    <p className="mt-1 text-xs text-subtle">
                      Decision{r.decidedAt ? ` (${formatDateTime(r.decidedAt)})` : ''}: {r.decisionNote}
                    </p>
                  )}
                  {r.status === 'open' && (negotiates || withdrawable) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {negotiates && (
                        <>
                          <Button size="sm" onClick={() => setDeciding({ request: r, status: 'approved' })}>
                            <Check aria-hidden /> Agree
                          </Button>
                          <Button size="sm" onClick={() => setDeciding({ request: r, status: 'declined' })}>
                            <X aria-hidden /> Decline
                          </Button>
                        </>
                      )}
                      {withdrawable && (
                        <Button size="sm" variant="ghost" onClick={() => setDeciding({ request: r, status: 'withdrawn' })}>
                          <Undo2 aria-hidden /> Withdraw
                        </Button>
                      )}
                    </div>
                  )}
                  {r.status === 'open' && !negotiates && <p className="mt-1 text-xs text-subtle">Waiting for an owner or admin.</p>}
                </li>
              );
            })}
          </ul>
        )}

        {recordable && (
          <form
            data-testid="change-request-form"
            className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void record.run();
            }}
          >
            <Field label="What they want to change" required>
              {(p) => (
                <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as ChangeKind)}>
                  {CHANGE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CHANGE_KIND_LABELS[k]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {inbound.length > 0 && (
              <Field label="From the reply (optional)">
                {(p) => (
                  <Select {...p} value={replyId} onChange={(e) => setReplyId(e.target.value)}>
                    <option value="">Not linked to a reply</option>
                    {inbound.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.senderHint} · {formatDateTime(m.receivedAt)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="The request, in their words" required className="sm:col-span-2" hint="For example “a 10% discount if paid upfront” or “add an online booking page”. Do not agree to it here.">
              {(p) => <Textarea {...p} rows={2} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />}
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" loading={record.pending} disabled={summary.trim().length < 5}>
                <GitPullRequestArrow aria-hidden /> Record change request
              </Button>
            </div>
          </form>
        )}
      </CardBody>
      {deciding && <DecideDialog proposal={proposal} request={deciding.request} status={deciding.status} role={workspace.role} onClose={() => setDeciding(null)} />}
    </Card>
  );
}

const DECISION_COPY: Record<Decision, { title: string; description: string; action: string }> = {
  approved: {
    title: 'Agree to this change?',
    description: 'You are agreeing to change the commercial terms. Next, revise the proposal to include it, approve it and issue it again; acceptance stays blocked until then.',
    action: 'Agree',
  },
  declined: { title: 'Decline this change?', description: 'The proposal stays as issued. Tell the client yourself; nothing is sent.', action: 'Decline' },
  withdrawn: { title: 'Withdraw this request?', description: 'For a request recorded by mistake, or one the client dropped.', action: 'Withdraw' },
};

function DecideDialog({ proposal, request, status, role, onClose }: { proposal: Proposal; request: ChangeRequest; status: Decision; role: Parameters<typeof decideChangeRequest>[5]; onClose: () => void }) {
  const [note, setNote] = useState('');
  const decide = useAction((c) => decideChangeRequest(c, request, proposal, status, note, role), { success: `Change request ${CHANGE_STATUS_META[status].label.toLowerCase()}`, onSuccess: onClose });
  const copy = DECISION_COPY[status];
  const needsNote = status !== 'withdrawn';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={decide.pending} disabled={needsNote && !note.trim()} onClick={() => void decide.run()}>
            {copy.action}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        <span className="font-medium">{CHANGE_KIND_LABELS[request.kind]}:</span> {request.summary}
      </p>
      <Field label={needsNote ? 'Why (kept on the record)' : 'Note (optional)'} required={needsNote}>
        {(p) => <Textarea {...p} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
