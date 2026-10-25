'use client';

import { Check, MessageSquare, Pencil, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Notice } from '@/components/ui/misc';
import {
  currentDirectionApproval,
  qualityLabel,
  type ConceptEdit,
  type CreativeConcept,
  type CreativeDirectionContent,
  type DirectionReviewDecision,
  type StudioCreativeDirection,
  type StudioCreativeDirectionReview,
} from '@/lib/domain/creative-direction';
import { fontById } from '@/lib/domain/font-catalogue';
import { formatDateTime } from '@/lib/utils';
import { ConceptBoard } from './creative-board';
import { ApproveConceptDialog, EditConceptDialog, FeedbackDialog } from './creative-concept-dialogs';

const DECISION_META: Record<DirectionReviewDecision, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  approve: { label: 'Approved', tone: 'success' },
  feedback: { label: 'Feedback', tone: 'neutral' },
  request_changes: { label: 'Changes requested', tone: 'warning' },
  reject: { label: 'Rejected', tone: 'danger' },
};

export function CreativeDirectionPanel({
  direction,
  reviews,
  editable,
  busy,
  onFeedback,
  onEdit,
  onApprove,
}: {
  direction: StudioCreativeDirection;
  reviews: StudioCreativeDirectionReview[];
  editable: boolean;
  busy: boolean;
  onFeedback: (concept: CreativeConcept, decision: 'feedback' | 'request_changes' | 'reject', note: string) => Promise<boolean>;
  onEdit: (concept: CreativeConcept, edit: ConceptEdit, note: string) => Promise<boolean>;
  onApprove: (concept: CreativeConcept, note: string) => Promise<boolean>;
}) {
  const content: CreativeDirectionContent = direction.content;
  const [boardKey, setBoardKey] = useState(content.recommendation.conceptKey);
  const [dialog, setDialog] = useState<{ type: 'feedback' | 'edit' | 'approve'; concept: CreativeConcept } | null>(null);
  const board = content.concepts.find((concept) => concept.key === boardKey) ?? content.concepts[0];
  const approval = currentDirectionApproval(reviews);
  const approvedConcept = approval ? content.concepts.find((concept) => concept.key === approval.conceptKey) : null;
  const scopedReviews = reviews.filter((review) => review.directionId === direction.id);

  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Direction version {direction.version}
              <Badge tone={approvedConcept ? 'success' : 'neutral'}>{approvedConcept ? `Approved: ${approvedConcept.name}` : 'Not approved'}</Badge>
              <Badge tone="accent"><Sparkles className="mr-1 size-3" aria-hidden />Advisory recommendation</Badge>
            </span>
          }
          description={`Built from brief version ${content.briefVersion} and Brand Kit version ${content.brandKitVersion} by the deterministic Studio engine. Saved ${formatDateTime(direction.createdAt)}${direction.note ? ` — “${direction.note}”` : ''}.`}
        />
        <CardBody className="space-y-3">
          <Notice tone="warning" title="A direction study, not a website">
            These boards show composition, typography, colour and motion intent. They are not pages, do not load the licensed font files, and are not a preview of a finished build. Page construction is phase 4.
          </Notice>
          <p className="text-sm text-muted">{content.recommendation.why}</p>
          <p className="text-xs text-subtle">{content.recommendation.advisory}</p>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Compare the three concepts" description="The comparison is structural: composition, type, colour, imagery, motion, conversion and responsive treatment. Changing only colours and fonts would fail this test." />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <caption className="sr-only">Comparison of the three creative concepts in this direction</caption>
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left">
                <th scope="col" className="w-40 px-4 py-2 text-xs font-medium text-subtle">Dimension</th>
                {content.concepts.map((concept) => (
                  <th key={concept.key} scope="col" className="px-4 py-2 text-xs font-semibold">
                    {concept.name}
                    {concept.key === content.recommendation.conceptKey && <Badge tone="accent" className="ml-2">Recommended</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.comparison.map((row) => (
                <tr key={row.dimension} className="border-b border-border align-top last:border-0">
                  <th scope="row" className="px-4 py-3 text-left text-xs font-medium text-subtle">{row.dimension}</th>
                  {row.values.map((value) => (
                    <td key={value.conceptKey} className="px-4 py-3 text-sm text-muted">{value.value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {content.concepts.map((concept) => {
          const display = fontById(concept.typography.displayFontId);
          const body = fontById(concept.typography.bodyFontId);
          const isApproved = approvedConcept?.key === concept.key;
          return (
            <Card key={concept.key} className={isApproved ? 'border-success/40' : undefined}>
              <CardHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {concept.name}
                    {isApproved && <Badge tone="success" dot>Approved</Badge>}
                  </span>
                }
                description={`${concept.composition.label} · ${concept.motion.label}`}
                as="h3"
              />
              <CardBody className="space-y-3">
                <p className="text-sm text-muted">{concept.idea}</p>
                <div
                  className="rounded-md border border-border p-3"
                  style={{
                    background: concept.tokens.palette.find((entry) => entry.role === 'background')?.hex,
                    color: concept.tokens.palette.find((entry) => entry.role === 'text')?.hex,
                  }}
                >
                  <p className="text-2xl leading-[1.02]" style={{ fontFamily: display ? `"${display.family}", Georgia, serif` : undefined }}>{concept.story.headline}</p>
                  <p className="mt-2 text-xs" style={{ fontFamily: body ? `"${body.family}", -apple-system, sans-serif` : undefined }}>
                    {display?.family ?? concept.typography.displayFamily} / {body?.family ?? concept.typography.bodyFamily}
                  </p>
                </div>
                <div className="flex gap-1" aria-label="Palette">
                  {concept.tokens.palette.filter((entry) => ['background', 'surface', 'text', 'accent', 'support'].includes(entry.role)).map((entry) => (
                    <span key={entry.role} className="size-6 rounded border border-border" style={{ background: entry.hex }} title={`${entry.name} ${entry.hex}`} />
                  ))}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-subtle">Primary action</dt><dd className="font-medium">{concept.conversion.primaryCta}</dd></div>
                  <div><dt className="text-subtle">Advisory score</dt><dd className="font-medium">{concept.quality.overall}/100</dd></div>
                </dl>
                <ul className="space-y-1 text-xs text-subtle">
                  {concept.tradeoffs.slice(0, 2).map((tradeoff) => <li key={tradeoff}>— {tradeoff}</li>)}
                </ul>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant={board.key === concept.key ? 'primary' : undefined} onClick={() => setBoardKey(concept.key)}>Open board</Button>
                  {editable && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'feedback', concept })}><MessageSquare aria-hidden /> Review</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'edit', concept })}><Pencil aria-hidden /> Edit</Button>
                      {!isApproved && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'approve', concept })}><Check aria-hidden /> Approve</Button>}
                    </>
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      <ConceptBoard concept={board} concepts={content.concepts} onSelect={setBoardKey} />

      <Card>
        <CardHeader title={`Design review — ${board.name}`} description={board.quality.advisory} />
        <CardBody>
          <ul className="grid gap-3 sm:grid-cols-2">
            {board.quality.dimensions.map((dimension) => (
              <li key={dimension.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{qualityLabel(dimension.key)}</p>
                  <span className="text-xs tabular text-subtle">{dimension.score}/100</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`${qualityLabel(dimension.key)}: ${dimension.score} out of 100, advisory`}>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${dimension.score}%` }} />
                </div>
                <p className="mt-1 text-xs text-subtle">{dimension.note}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Review and approval history" description="Append-only. An approval names the concept and the direction version; a later change request revokes it." />
        <CardBody className="p-0">
          {scopedReviews.length === 0 ? (
            <p className="px-4 py-6 text-sm text-subtle">No review recorded for this version yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...scopedReviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((review) => {
                const concept = content.concepts.find((entry) => entry.key === review.conceptKey);
                const meta = DECISION_META[review.decision];
                return (
                  <li key={review.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="font-medium">{concept?.name ?? review.conceptKey}</span>
                    <span className="min-w-0 flex-1 text-muted">“{review.note}”</span>
                    <span className="text-xs text-subtle">{formatDateTime(review.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {dialog?.type === 'feedback' && (
        <FeedbackDialog concept={dialog.concept} pending={busy} onClose={() => setDialog(null)} onSubmit={(decision, note) => onFeedback(dialog.concept, decision, note)} />
      )}
      {dialog?.type === 'edit' && (
        <EditConceptDialog concept={dialog.concept} pending={busy} onClose={() => setDialog(null)} onSubmit={(edit, note) => onEdit(dialog.concept, edit, note)} />
      )}
      {dialog?.type === 'approve' && (
        <ApproveConceptDialog concept={dialog.concept} pending={busy} onClose={() => setDialog(null)} onSubmit={(note) => onApprove(dialog.concept, note)} />
      )}
    </>
  );
}


