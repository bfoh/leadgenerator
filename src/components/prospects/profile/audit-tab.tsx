'use client';

import { Bot, Check, ClipboardList, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import * as research from '@/lib/data/research-services';
import { AUDIT_CATEGORY_LABELS, SEVERITY_META } from '@/lib/domain/audit';
import type { AuditFinding, Business } from '@/lib/domain/types';
import { formatDate, formatDateTime } from '@/lib/utils';
import { describeRun, researchable, runAgentNow, useAutomationAction, useAutomationAvailable } from '@/lib/workspace/automation';
import { useAction, useAuditFindings, useResearchSchema } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';
import { ExternalLinkText } from './overview-tab';

const REVIEW_LABELS = { unreviewed: 'Not reviewed', accepted: 'Accepted', dismissed: 'Dismissed', superseded: 'Superseded' } as const;
const REVIEW_TONES = { unreviewed: 'info', accepted: 'success', dismissed: 'neutral', superseded: 'neutral' } as const;

export function AuditTab({ business }: { business: Business }) {
  const { can, workspace } = useWorkspace();
  const { data: schema } = useResearchSchema();
  const { data: findings = [], isLoading } = useAuditFindings(business.id);
  const { data: available } = useAutomationAvailable();
  const [showHistory, setShowHistory] = useState(false);
  const run = useAutomationAction((a, b: Business) => runAgentNow(a, workspace.mode, 'digital_audit', b), { success: ({ run: r }) => describeRun(r) });

  if (schema === false) {
    return <EmptyState icon={ClipboardList} title="Digital audit is not set up" description="Apply database migration 004 to record evidence-backed audit findings." />;
  }
  const current = findings.filter((f) => f.reviewStatus !== 'superseded');
  const earlier = findings.filter((f) => f.reviewStatus === 'superseded');
  const issues = current.filter((f) => f.kind === 'verified_issue');
  const opportunities = current.filter((f) => f.kind === 'opportunity');
  const runButton =
    available && can('automation.run') && researchable(business) ? (
      <Button loading={run.pending} onClick={() => void run.run(business)}>
        <Bot aria-hidden /> {current.length ? 'Re-run audit' : 'Run digital audit'}
      </Button>
    ) : null;

  return (
    <div className="space-y-5">
      <Notice tone="neutral" icon={ClipboardList}>
        Findings come only from recorded evidence (the verification in force and the site check). Verified issues were observed directly; growth opportunities are hypotheses
        for a conversation, not facts about the business. Nothing here claims anything about sales, customers or revenue.
      </Notice>
      {isLoading ? null : current.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No audit findings yet"
          description={business.websiteStatus === 'unverified' ? 'Verify the website first; the audit works from that evidence.' : 'Run the Digital Audit agent to turn the current verification into findings.'}
          action={runButton}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-subtle">
              {issues.length} verified issue{issues.length === 1 ? '' : 's'} · {opportunities.length} growth hypothes{opportunities.length === 1 ? 'is' : 'es'}
            </p>
            {runButton}
          </div>
          <FindingList title="Verified issues" description="Observed directly in the recorded checks." findings={issues} />
          <FindingList title="Growth opportunities (hypotheses)" description="What the evidence suggests could help, based on the sector and what was not found. Confirm with the business." findings={opportunities} />
        </>
      )}
      {earlier.length > 0 && (
        <div>
          <button type="button" className="text-xs text-subtle underline" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            {showHistory ? 'Hide' : 'Show'} {earlier.length} earlier finding{earlier.length === 1 ? '' : 's'} replaced by newer audits
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-xs text-subtle">
              {earlier.map((f) => (
                <li key={f.id}>
                  {formatDate(f.createdAt)} · {f.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FindingList({ title, description, findings }: { title: string; description: string; findings: AuditFinding[] }) {
  if (!findings.length) return null;
  return (
    <Card>
      <CardHeader title={title} description={description} as="h3" />
      <ol className="divide-y divide-border">
        {findings.map((f) => (
          <FindingItem key={f.id} finding={f} />
        ))}
      </ol>
    </Card>
  );
}

function FindingItem({ finding: f }: { finding: AuditFinding }) {
  const { can } = useWorkspace();
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState('');
  const review = useAction((ctx, status: 'accepted' | 'dismissed' | 'unreviewed') => research.reviewFinding(ctx, f, status, status === 'dismissed' ? note : ''), {
    success: (r) => `Finding ${REVIEW_LABELS[r.reviewStatus].toLowerCase()}`,
    onSuccess: () => {
      setDismissing(false);
      setNote('');
    },
  });
  const writable = can('verification.write');

  return (
    <li className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{f.title}</p>
        <Badge tone={SEVERITY_META[f.severity].tone}>{SEVERITY_META[f.severity].label} severity</Badge>
        <Badge>{AUDIT_CATEGORY_LABELS[f.category]}</Badge>
        <Badge tone={REVIEW_TONES[f.reviewStatus]}>{REVIEW_LABELS[f.reviewStatus]}</Badge>
        <span className="text-xs text-subtle">Confidence {f.confidence}/100</span>
      </div>
      <section>
        <h4 className="text-xs font-semibold text-muted">Evidence</h4>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm">
          {f.evidence.map((e, i) => (
            <li key={i} className="break-words">
              {e.statement}
              {e.source && (
                <>
                  {' '}
                  <ExternalLinkText href={e.source}>source</ExternalLinkText>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      {f.impactHypothesis && (
        <p className="text-sm">
          <span className="text-xs font-semibold text-muted">Possible business impact (hypothesis): </span>
          {f.impactHypothesis}
        </p>
      )}
      {f.recommendation && (
        <p className="text-sm">
          <span className="text-xs font-semibold text-muted">Recommended solution: </span>
          {f.recommendation}
        </p>
      )}
      <p className="text-xs text-subtle">
        Finding {f.findingKey} · {f.agentVersion} · {formatDateTime(f.createdAt)}
        {f.reviewedAt ? ` · reviewed ${formatDateTime(f.reviewedAt)}` : ''}
        {f.reviewNote ? ` · “${f.reviewNote}”` : ''}
      </p>
      {writable && (
        <div className="flex flex-wrap gap-1">
          {f.reviewStatus !== 'accepted' && (
            <Button size="sm" loading={review.pending} onClick={() => void review.run('accepted')}>
              <Check /> Accept
            </Button>
          )}
          {f.reviewStatus !== 'dismissed' && (
            <Button size="sm" variant="ghost" onClick={() => setDismissing(true)}>
              <X /> Dismiss
            </Button>
          )}
          {f.reviewStatus !== 'unreviewed' && (
            <Button size="sm" variant="ghost" loading={review.pending} onClick={() => void review.run('unreviewed')}>
              <RotateCcw /> Reopen
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={dismissing}
        onOpenChange={setDismissing}
        size="sm"
        title="Dismiss this finding?"
        description="Dismissed findings are kept with your reason and are not raised again on the same evidence."
        footer={
          <>
            <Button onClick={() => setDismissing(false)}>Cancel</Button>
            <Button variant="primary" loading={review.pending} onClick={() => void review.run('dismissed')}>
              Dismiss finding
            </Button>
          </>
        }
      >
        <Field label="Why does it not apply?" required>
          {(p) => <Textarea {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="For example: bookings are handled by phone by choice." />}
        </Field>
      </Dialog>
    </li>
  );
}
