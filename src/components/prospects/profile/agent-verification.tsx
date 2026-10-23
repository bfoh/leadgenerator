'use client';

import { Bot, Check, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { searchPlan } from '@/lib/automation/agents/verification';
import * as research from '@/lib/data/research-services';
import type { Business, WebsiteVerification } from '@/lib/domain/types';
import {
  CLASSIFICATION_META,
  CONFIDENCE_BAND_META,
  ORIGIN_LABELS,
  QUERY_PURPOSE_LABELS,
  VERDICT_LABELS,
  confidenceBand,
  readEvidence,
  type WebsiteClassification,
  type WebsiteEvidence,
} from '@/lib/domain/website-assessment';
import { cn, formatDateTime } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { describeRun, researchable, runAgentNow, useAutomationAction, useAutomationAvailable, useAutomationContext, useAutomationSettings } from '@/lib/workspace/automation';
import { useAction, useResearchSchema } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

export function ClassificationBadge({ classification }: { classification: WebsiteClassification }) {
  const meta = CLASSIFICATION_META[classification];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function EvidenceConfidenceBadge({ score }: { score: number }) {
  const band = CONFIDENCE_BAND_META[confidenceBand(score)];
  return (
    <Badge tone={band.tone} title={`${band.range}: ${band.label}`}>
      Evidence {score}/100 · {band.label}
    </Badge>
  );
}

const REVIEW_META = {
  pending: { label: 'Needs review', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  not_required: { label: 'No review needed', tone: 'neutral' },
} as const;

export function ReviewStatusBadge({ v }: { v: WebsiteVerification }) {
  if ((v.actorType ?? 'user') !== 'agent' || !v.reviewStatus) return null;
  const meta = REVIEW_META[v.reviewStatus];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** Runs the Website Verification agent for this prospect on request. */
export function AutomatedVerificationCard({ business, verifications }: { business: Business; verifications: WebsiteVerification[] }) {
  const { can, workspace } = useWorkspace();
  const { data: status } = useServerStatus();
  const { data: available } = useAutomationAvailable();
  const { data: settings } = useAutomationSettings();
  const { data: schema } = useResearchSchema();
  const actx = useAutomationContext();
  const run = useAutomationAction((a, b: Business) => runAgentNow(a, workspace.mode, 'website_verification', b, { force: true }), {
    success: ({ run: r }) => describeRun(r),
  });
  const pending = verifications.filter((v) => v.actorType === 'agent' && v.reviewStatus === 'pending');
  const plan = settings ? searchPlan(actx.tools, settings) : null;

  const blocker = !status?.serverTools
    ? 'Automated checks run on the server. Enable Supabase sign-in, or set DEMO_SERVER_TOOLS=true on a private deployment.'
    : schema === false
      ? 'Apply database migration 004 to record automated verifications.'
      : !available
        ? 'Automation is not set up for this workspace yet (migration 003).'
        : !researchable(business)
          ? 'Automation does not run on closed, merged or opted-out prospects.'
          : null;

  return (
    <Card>
      <CardHeader
        title="Automated verification"
        as="h3"
        description="The Website Verification agent follows the 13-step check, honours robots.txt, and records a classification with the factors behind its evidence confidence. Uncertain results wait for your review."
      />
      <CardBody className="space-y-3">
        {status?.research?.simulated && (
          <Notice tone="warning" title="Simulated providers">
            This server uses the simulated test world (SIMULATE_EXTERNAL_TOOLS). Results are labelled simulated and are not real research.
          </Notice>
        )}
        {plan && !blocker && <p className="text-xs text-subtle">{plan.allowed ? `Web search: ${status?.research?.search.provider ?? 'configured'}.` : plan.reason}</p>}
        {pending.length > 0 && (
          <Notice tone="warning" title={`${pending.length} result${pending.length === 1 ? '' : 's'} awaiting review`}>
            Confirm or reject it in the history below. Until then it does not replace a person’s verification.
          </Notice>
        )}
        {blocker ? (
          <p className="text-sm text-subtle">{blocker}</p>
        ) : can('automation.run') ? (
          <Button loading={run.pending} onClick={() => void run.run(business)}>
            <Bot aria-hidden /> Run automated verification
          </Button>
        ) : (
          <p className="text-sm text-subtle">Your role can view results but not start automation.</p>
        )}
      </CardBody>
    </Card>
  );
}

/** Confirm or reject an agent's verification. */
export function AgentReview({ business, v }: { business: Business; v: WebsiteVerification }) {
  const { can } = useWorkspace();
  const [decision, setDecision] = useState<research.ReviewDecision | null>(null);
  const [note, setNote] = useState('');
  const review = useAction((ctx, d: research.ReviewDecision) => research.reviewVerification(ctx, business, v, d, note), {
    success: (r) => (r.verification.reviewStatus === 'confirmed' ? 'Result confirmed' : 'Result rejected'),
    onSuccess: () => {
      setDecision(null);
      setNote('');
    },
  });
  if (!can('verification.write')) return null;
  return (
    <>
      <Button size="sm" variant={v.reviewStatus === 'pending' ? 'primary' : 'ghost'} onClick={() => setDecision('confirmed')} disabled={v.reviewStatus === 'confirmed'}>
        <Check /> Confirm
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDecision('rejected')} disabled={v.reviewStatus === 'rejected'}>
        <X /> Reject
      </Button>
      <Dialog
        open={decision !== null}
        onOpenChange={(open) => !open && setDecision(null)}
        size="sm"
        title={decision === 'confirmed' ? 'Confirm this result?' : 'Reject this result?'}
        description={
          decision === 'confirmed'
            ? 'The result becomes the verification in force for this prospect and is recorded with your name.'
            : 'A rejected result never counts. The prospect falls back to the previous verification.'
        }
        footer={
          <>
            <Button onClick={() => setDecision(null)}>Cancel</Button>
            <Button variant={decision === 'rejected' ? 'danger' : 'primary'} loading={review.pending} onClick={() => decision && void review.run(decision)}>
              {decision === 'confirmed' ? 'Confirm result' : 'Reject result'}
            </Button>
          </>
        }
      >
        <Field label={decision === 'rejected' ? 'Why is it wrong?' : 'Note (optional)'} required={decision === 'rejected'}>
          {(p) => <Textarea {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'rejected' ? 'For example: the site belongs to a different business in Kumasi.' : 'What you checked.'} />}
        </Field>
      </Dialog>
    </>
  );
}

const STEP_TONE = { done: 'text-success', skipped: 'text-warning', not_applicable: 'text-subtle' } as const;

/** Everything an agent verification recorded: factors, the 13 steps, queries and sites checked. */
export function EvidenceDetails({ v }: { v: WebsiteVerification }) {
  const e = readEvidence(v.evidence);
  if (!e) return null;
  const probes = e.domainProbes ?? [];
  return (
    <details className="rounded-md border border-border text-xs">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        <ShieldCheck className="mr-1 inline size-3.5 text-subtle" aria-hidden />
        Evidence and confidence factors · agent {v.agentVersion}
        {e.search.simulated ? ' · simulated providers' : ''}
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        <p className="text-sm">{e.decision}.</p>
        {(e.reviewReasons ?? []).length > 0 && (
          <Notice tone="warning" title="Why review is needed">
            <ul className="list-disc pl-4">
              {(e.reviewReasons ?? []).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Notice>
        )}
        <Factors e={e} />
        {(e.contradictions.length > 0 || (e.notes ?? []).length > 0) && (
          <section>
            <h4 className="mb-1 font-semibold text-muted">Contradictions and notes</h4>
            <ul className="list-disc space-y-0.5 pl-4">
              {e.contradictions.map((c) => (
                <li key={c} className="text-danger">
                  {c}
                </li>
              ))}
              {(e.notes ?? []).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h4 className="mb-1 font-semibold text-muted">Verification steps</h4>
          <ol className="space-y-1">
            {e.steps.map((s) => (
              <li key={s.n} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-1">
                <span className={cn('font-mono', STEP_TONE[s.status])}>{s.n}.</span>
                <span>
                  <span className="font-medium">{s.label}</span> <span className={STEP_TONE[s.status]}>({s.status.replace('_', ' ')})</span>
                  <span className="block break-words text-subtle">{s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h4 className="mb-1 font-semibold text-muted">Searches</h4>
          {e.search.queries.length === 0 ? (
            <p className="text-subtle">{e.search.skippedReason ?? 'No web search was run.'}</p>
          ) : (
            <ul className="space-y-0.5">
              {e.search.queries.map((q) => (
                <li key={`${q.purpose}:${q.query}`} className="break-words">
                  <span className="font-mono">{q.query}</span> <span className="text-subtle">· {QUERY_PURPOSE_LABELS[q.purpose]} · {q.ok ? `${q.resultCount} results` : q.error}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-subtle">Search results are used to decide what to check and are not stored (provider terms).</p>
        </section>
        <section>
          <h4 className="mb-1 font-semibold text-muted">Sites checked</h4>
          {e.candidates.length === 0 ? (
            <p className="text-subtle">No candidate websites.</p>
          ) : (
            <ul className="space-y-1.5">
              {e.candidates.map((c) => (
                <li key={c.site} className="break-words">
                  <span className="font-medium">{c.site}</span> — {VERDICT_LABELS[c.verdict]}
                  {c.verdict !== 'not_inspected' && c.verdict !== 'unreachable' ? ` (ownership ${c.ownershipScore}/100)` : ''}
                  <span className="block text-subtle">
                    {(c.origins ?? []).map((o) => ORIGIN_LABELS[o]).join(', ')} · robots.txt {(c.robots ?? 'not_checked').replace('_', ' ')}
                    {c.check ? ` · ${c.check.ok ? `HTTP ${c.check.status}` : (c.check.error ?? 'failed')}` : ''}
                    {c.signals?.brandPlaces.length ? ` · name in ${c.signals.brandPlaces.join(', ')}` : ''}
                    {c.signals?.city ? ' · mentions the city' : ''}
                    {c.signals?.phoneMatch ? ' · recorded phone on the site' : ''}
                    {c.signals?.linksToDeclaredSocial ? ' · links to the recorded social profile' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="text-subtle">
          Checked {formatDateTime(e.finishedAt ?? v.checkedAt)}. {probes.length} name-based domain{probes.length === 1 ? '' : 's'} probed, {probes.filter((p) => p.resolves).length} resolving.
          {e.failure ? ` Failure first seen ${e.failure.firstSeenAt.slice(0, 10)} (${e.failure.persistent ? 'repeated' : 'first observation'}).` : ''}
        </p>
      </div>
    </details>
  );
}

function Factors({ e }: { e: WebsiteEvidence }) {
  return (
    <section>
      <h4 className="mb-1 font-semibold text-muted">
        Evidence confidence {e.confidenceScore}/100 — {CONFIDENCE_BAND_META[e.band].label}
      </h4>
      <table className="w-full text-left">
        <caption className="sr-only">Factors behind the evidence confidence score</caption>
        <thead className="text-subtle">
          <tr>
            <th scope="col" className="py-1 pr-2 font-medium">
              Factor
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Points
            </th>
            <th scope="col" className="py-1 font-medium">
              Why
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {e.factors.map((f) => (
            <tr key={f.key} className="align-top">
              <th scope="row" className="py-1 pr-2 font-normal">
                {f.label}
              </th>
              <td className={cn('py-1 pr-2 text-right font-mono tabular-nums', f.points < 0 && 'text-danger')}>
                {f.points}
                {f.max ? `/${f.max}` : ''}
              </td>
              <td className="py-1 break-words text-subtle">{f.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
