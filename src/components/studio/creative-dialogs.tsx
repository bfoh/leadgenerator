'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';
import type { BriefPreferences, CreativeBriefContent, StudioCreativeBrief } from '@/lib/domain/creative-direction';

const commaList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

export function ConfirmBriefDialog({
  brief,
  pending,
  onClose,
  onSubmit,
}: {
  brief: StudioCreativeBrief;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setProblem('Explain what you are confirming in a few words.');
    setProblem(null);
    if (await onSubmit(note.trim())) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={`Confirm brief version ${brief.version}?`}
      description="Confirmation is the gate to creative direction. Open questions remain listed; they are not answered by confirming."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Confirm brief</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Notice tone="warning" title={brief.content.missingInformation.some((item) => item.blocking) ? 'Blocking questions remain' : 'No blocking licence or kit question'}>
          {brief.content.missingInformation.some((item) => item.blocking)
            ? `This brief records ${brief.content.missingInformation.filter((item) => item.blocking).length} question(s) the business must answer. You may confirm the brief as a working basis, but the direction cannot be published until they are answered.`
            : 'The brief is internally complete. The business still has to confirm the offer, rights and copy before publication.'}
        </Notice>
        <Field label="What are you confirming, and why" error={problem ?? undefined} required hint="Name the evidence you checked and any question you accept as open.">
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
              placeholder="Reviewed with Ama on 25 October: the kit, the page evidence and the open price question are recorded correctly."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

export function AdjustBriefDialog({
  content,
  pending,
  onClose,
  onSubmit,
}: {
  content: CreativeBriefContent;
  pending: boolean;
  onClose: () => void;
  onSubmit: (preferences: BriefPreferences, note: string) => Promise<boolean>;
}) {
  const [personality, setPersonality] = useState((content.brandKit?.personality ?? []).join(', '));
  const [positioning, setPositioning] = useState(content.sections.positioning.summary);
  const [audience, setAudience] = useState(content.sections.audience.summary);
  const [atmosphere, setAtmosphere] = useState(content.sections.atmosphere.summary);
  const [objectives, setObjectives] = useState(content.sections.objectives.summary);
  const [avoid, setAvoid] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setProblem('Say what changed and why; this note becomes the version history.');
    setProblem(null);
    const preferences: BriefPreferences = {
      personality: commaList(personality).slice(0, 12),
      positioning,
      audience,
      atmosphere,
      objectives,
      avoid: commaList(avoid).slice(0, 12),
    };
    if (await onSubmit(preferences, note.trim())) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Adjust the brief"
      description="A new immutable version is saved. Verified facts and approved Brand Kit content are not rewritten; your changes are added as labelled suggestions."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Save version</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Working personality" hint="Comma-separated. This is a Studio preference, not a claim about the business.">
          {(props) => <Input {...props} value={personality} onChange={(e) => setPersonality(e.target.value)} maxLength={300} />}
        </Field>
        <Field label="Positioning" hint="What should this business be recognised for?">
          {(props) => <Textarea {...props} rows={3} maxLength={700} value={positioning} onChange={(e) => setPositioning(e.target.value)} />}
        </Field>
        <Field label="Audience" hint="Who is deciding, and what do they need before they act?">
          {(props) => <Textarea {...props} rows={3} maxLength={700} value={audience} onChange={(e) => setAudience(e.target.value)} />}
        </Field>
        <Field label="Emotional atmosphere" hint="How should the site feel? Keep it specific enough to reject a wrong direction.">
          {(props) => <Textarea {...props} rows={3} maxLength={700} value={atmosphere} onChange={(e) => setAtmosphere(e.target.value)} />}
        </Field>
        <Field label="Design objectives" hint="The conversion and the measures that matter.">
          {(props) => <Textarea {...props} rows={3} maxLength={700} value={objectives} onChange={(e) => setObjectives(e.target.value)} />}
        </Field>
        <Field label="Deliberately avoid" hint="Comma-separated clichés or treatments this direction must not use.">
          {(props) => <Input {...props} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="Stock photography, gold gradients, autoplay video" maxLength={400} />}
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
              placeholder="Ama described the room as quiet and low-lit; the first atmosphere was too bright."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

