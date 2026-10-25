'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';
import { FONT_CATALOGUE } from '@/lib/domain/font-catalogue';
import type { ConceptEdit, CreativeConcept, DirectionReviewDecision } from '@/lib/domain/creative-direction';

const DISPLAY_FONTS = FONT_CATALOGUE.filter((font) => font.roles.includes('display') || font.roles.includes('accent'));
const BODY_FONTS = FONT_CATALOGUE.filter((font) => font.roles.includes('body') || font.roles.includes('interface'));

const DECISIONS: { value: Exclude<DirectionReviewDecision, 'approve'>; label: string; hint: string }[] = [
  { value: 'feedback', label: 'Feedback', hint: 'A note for the record; it does not change approval state.' },
  { value: 'request_changes', label: 'Request changes', hint: 'Revokes an approval and sends the concept back for work.' },
  { value: 'reject', label: 'Reject', hint: 'The territory is not right for this business.' },
];

export function FeedbackDialog({
  concept,
  pending,
  onClose,
  onSubmit,
}: {
  concept: CreativeConcept;
  pending: boolean;
  onClose: () => void;
  onSubmit: (decision: 'feedback' | 'request_changes' | 'reject', note: string) => Promise<boolean>;
}) {
  const [decision, setDecision] = useState<'feedback' | 'request_changes' | 'reject'>('feedback');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setProblem('Write a note the next designer can act on.');
    setProblem(null);
    if (await onSubmit(decision, note.trim())) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={`Review ${concept.name}`}
      description="Every review is append-only and attached to this direction version and this concept."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Record decision</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Decision" hint={DECISIONS.find((entry) => entry.value === decision)?.hint}>
          {(props) => (
            <Select {...props} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
              {DECISIONS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Note" error={problem ?? undefined} required>
          {(props) => (
            <Textarea
              {...props}
              autoFocus
              rows={4}
              maxLength={1000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (problem) setProblem(null);
              }}
              placeholder="The direction is right, but the photography treatment needs a lower-light frame and the opening line is too abstract."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export function EditConceptDialog({
  concept,
  pending,
  onClose,
  onSubmit,
}: {
  concept: CreativeConcept;
  pending: boolean;
  onClose: () => void;
  onSubmit: (edit: ConceptEdit, note: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(concept.name);
  const [idea, setIdea] = useState(concept.idea);
  const [displayFontId, setDisplayFontId] = useState(concept.typography.displayFontId);
  const [bodyFontId, setBodyFontId] = useState(concept.typography.bodyFontId);
  const [primaryCta, setPrimaryCta] = useState(concept.conversion.primaryCta);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (displayFontId === bodyFontId) return setProblem('Display and body cannot be the same typeface.');
    if (note.trim().length < 3) return setProblem('Say why the concept changed; the note becomes the version history.');
    setProblem(null);
    if (await onSubmit({ name, idea, displayFontId, bodyFontId, primaryCta }, note.trim())) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={`Edit ${concept.name}`}
      description="Saving creates a new immutable direction version. The other two concepts are carried forward unchanged; brief evidence and asset permissions are not altered."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Save as new version</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Concept name" hint="2–80 characters. A name a designer can say in a meeting.">
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />}
        </Field>
        <Field label="One-sentence idea">
          {(props) => <Textarea {...props} rows={3} maxLength={700} value={idea} onChange={(e) => setIdea(e.target.value)} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display typeface">
            {(props) => (
              <Select {...props} value={displayFontId} onChange={(e) => setDisplayFontId(e.target.value)}>
                {DISPLAY_FONTS.map((font) => <option key={font.id} value={font.id}>{font.family} — {font.licence.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Body typeface">
            {(props) => (
              <Select {...props} value={bodyFontId} onChange={(e) => setBodyFontId(e.target.value)}>
                {BODY_FONTS.map((font) => <option key={font.id} value={font.id}>{font.family} — {font.licence.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Primary action">
          {(props) => <Input {...props} value={primaryCta} onChange={(e) => setPrimaryCta(e.target.value)} maxLength={120} />}
        </Field>
        <Field label="Why this version" error={problem ?? undefined} required>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (problem) setProblem(null);
              }}
              placeholder="The team found the name too abstract; the serif is closer to the kit’s voice."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export function ApproveConceptDialog({
  concept,
  pending,
  onClose,
  onSubmit,
}: {
  concept: CreativeConcept;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setProblem('Name the decision and the direction it applies to.');
    setProblem(null);
    if (await onSubmit(note.trim())) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={`Approve ${concept.name}?`}
      description="This is the direction phase 4 would build from. Approval is a person’s decision, not a score."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Approve concept</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Notice tone="info" title="Advisory review, human decision">
          The review is a set of heuristics. Approving confirms that you have judged the concept against the Studio’s creative standard, not that a score reached a threshold.
        </Notice>
        <Field label="Approval note" error={problem ?? undefined} required>
          {(props) => (
            <Textarea
              {...props}
              autoFocus
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                if (problem) setProblem(null);
              }}
              placeholder="Approved by the design lead on 25 October: this is the direction we will build, with the photography commission as a condition."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

