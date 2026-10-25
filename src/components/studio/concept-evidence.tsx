'use client';

import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import * as studio from '@/lib/data/studio-services';
import {
  CATEGORY_LABELS,
  REUSE_META,
  type EvidenceReview,
  type ReviewDecision,
  type StudioObservation,
  type StudioProject,
  type StudioProjectPatch,
  type StudioReview,
} from '@/lib/domain/studio';
import { hostOf } from '@/lib/domain/web-research';
import { formatDateTime } from '@/lib/utils';
import { useAction } from '@/lib/workspace/hooks';

const DECISION_META: Record<ReviewDecision, { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  confirm: { label: 'Confirmed', tone: 'success' },
  reject: { label: 'Rejected', tone: 'danger' },
  note: { label: 'Noted', tone: 'neutral' },
};

/** What the analysis will actually read: the typed address, with a scheme when one is missing. */
function normaliseAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** The concept's own name, address and brief. Editable while the concept is live. */
export function ConceptBrief({
  project,
  editable,
  siteUrl,
}: {
  project: StudioProject;
  editable: boolean;
  siteUrl: string | null;
}) {
  const [name, setName] = useState(project.name);
  const [url, setUrl] = useState(project.websiteUrl ?? '');
  const [brief, setBrief] = useState(project.brief);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useAction((ctx, patch: StudioProjectPatch) => studio.updateStudioConcept(ctx, project, patch), {
    success: 'Concept saved',
  });

  const dirty = name.trim() !== project.name || normaliseAddress(url) !== (project.websiteUrl ?? '') || brief !== project.brief;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) return setProblem('Give the concept a name of at least two characters.');
    const address = normaliseAddress(url);
    if (address.length > 2000) return setProblem('That address is too long.');
    setProblem(null);
    void save.run({ name: trimmed, websiteUrl: address || null, brief });
  }

  if (!editable && !project.brief && !project.websiteUrl) return null;

  return (
    <Card>
      <CardHeader
        title="Concept brief"
        description="What we are building for this business. The address below is the page the analysis reads."
        actions={
          editable && dirty ? (
            <Button size="sm" variant="primary" loading={save.pending} onClick={submit}>
              Save
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {editable ? (
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <Field label="Concept name">
              {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Website address" hint={siteUrl ? undefined : 'No address on record yet.'}>
              {(props) => <Input {...props} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" inputMode="url" />}
            </Field>
            <Field label="Brief" hint="What the business needs, in our words. Kept with the concept, never sent." className="sm:col-span-2">
              {(props) => <Textarea {...props} rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} placeholder="A shop that needs to sell online, keeps its name and colours, and wants room for a lookbook." />}
            </Field>
            {problem && (
              <p role="alert" className="text-xs text-danger sm:col-span-2">
                {problem}
              </p>
            )}
          </form>
        ) : (
          <p className="whitespace-pre-line text-sm text-muted">{project.brief || 'No brief yet.'}</p>
        )}
      </CardBody>
    </Card>
  );
}

/** One recorded entry, with the person's latest decision about it. Evidence itself is never edited. */
export function ObservationRow({
  observation,
  review,
  decision,
  canWrite,
  onReview,
}: {
  observation: StudioObservation;
  review: EvidenceReview | null;
  decision: ReviewDecision | null;
  canWrite: boolean;
  onReview: (decision: ReviewDecision) => void;
}) {
  const reuse = REUSE_META[observation.reusePermission];
  const source = hostOf(observation.sourceUrl);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{observation.label}</span>
          <Badge>{CATEGORY_LABELS[observation.category]}</Badge>
          {observation.confidence < 100 && (
            <span className="text-[11px] text-subtle" title="How sure the reading is">
              {observation.confidence}% confidence
            </span>
          )}
          {decision && <Badge tone={DECISION_META[decision].tone}>{DECISION_META[decision].label}</Badge>}
        </div>
        {observation.detail && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{observation.detail}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
          <span title={reuse.description}>{reuse.label}</span>
          {observation.sourceUrl && (
            <a href={observation.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              {source ?? observation.sourceUrl}
            </a>
          )}
          {observation.assetUrl && (
            <a href={observation.assetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
              Referenced {observation.assetKind}
            </a>
          )}
          {observation.assetUrl && <span>Not downloaded or copied</span>}
        </div>
        {review?.note && (
          <p className="mt-1.5 text-xs text-subtle">
            {DECISION_META[review.decision].label} · {review.note}
          </p>
        )}
      </div>
      {canWrite && (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant={decision === 'confirm' ? 'primary' : 'secondary'} onClick={() => onReview('confirm')} aria-label={`Confirm ${observation.label}`}>
            Confirm
          </Button>
          <Button size="sm" variant={decision === 'reject' ? 'primary' : 'secondary'} onClick={() => onReview('reject')} aria-label={`Reject ${observation.label}`}>
            Reject
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => onReview('note')} aria-label={`Add a note about ${observation.label}`}>
            <MessageSquare aria-hidden />
          </Button>
        </div>
      )}
    </li>
  );
}

/** Why a decision was made, newest first. Separate from the evidence, which never changes. */
export function ReviewTrail({ reviews }: { reviews: StudioReview[] }) {
  if (!reviews.length) return null;
  return (
    <Card>
      <CardHeader title="Decisions" description="Who checked which entry, and why. A note is an observation; confirm and reject are decisions." />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">
          {reviews.slice(0, 20).map((review) => (
            <li key={review.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <Badge tone={DECISION_META[review.decision].tone}>{DECISION_META[review.decision].label}</Badge>
              <span className="min-w-0 flex-1 text-muted">{review.note || 'No note added.'}</span>
              <span className="text-[11px] text-subtle">{formatDateTime(review.createdAt)}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Rejecting or noting needs an explanation, so the decision can be understood later. */
export function ReviewDialog({
  observation,
  decision,
  pending,
  onCancel,
  onSubmit,
}: {
  observation: StudioObservation | null;
  decision: ReviewDecision;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const label = DECISION_META[decision].label.toLowerCase();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = note.trim();
    if (trimmed.length < 3) return setProblem('Explain the decision in a few words.');
    setProblem(null);
    onSubmit(trimmed);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      size="sm"
      title={decision === 'reject' ? 'Reject this entry' : 'Add a note'}
      description={
        observation
          ? `About “${observation.label}”. The entry itself stays as it was recorded; your ${label} is kept alongside it.`
          : `About this concept. Your ${label} is kept with the concept.`
      }
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={decision === 'reject' ? 'danger' : 'primary'} loading={pending} onClick={submit}>
            {decision === 'reject' ? 'Reject entry' : 'Save note'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Why" error={problem ?? undefined} hint="Visible to the team. Nobody outside sees this.">
          {(props) => (
            <Textarea
              {...props}
              autoFocus
              rows={3}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (problem) setProblem(null);
              }}
              maxLength={1000}
              placeholder={decision === 'reject' ? 'The page shows a phone number we already know is disconnected.' : 'Ask the business to confirm this before we design around it.'}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

