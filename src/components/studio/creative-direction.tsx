'use client';

import { Compass, FileText, Layers, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import * as creative from '@/lib/data/creative-direction-services';
import {
  currentDirectionApproval,
  latestBriefConfirmation,
  type BriefPreferences,
  type ConceptEdit,
  type CreativeConcept,
  type StudioCreativeBrief,
} from '@/lib/domain/creative-direction';
import { currentBrandKitApproval } from '@/lib/domain/studio-assets';
import type { StudioProject } from '@/lib/domain/studio';
import {
  useAction,
  useCreativeBriefReviews,
  useCreativeBriefs,
  useCreativeDirectionReviews,
  useCreativeDirections,
  useCreativeDirectionSchema,
  useStudioBrandKit,
} from '@/lib/workspace/hooks';
import { CreativeBriefPanel } from './creative-brief';
import { CreativeDirectionPanel } from './creative-concepts';

/** The Creative Director: brief, three territories, review and a named approval. */
export function StudioCreativeDirectionPanel({ project, editable }: { project: StudioProject; editable: boolean }) {
  const schema = useCreativeDirectionSchema();
  const { data: briefs = [], isLoading: briefsLoading } = useCreativeBriefs(project.id);
  const { data: briefReviews = [] } = useCreativeBriefReviews(project.id);
  const { data: directions = [], isLoading: directionsLoading } = useCreativeDirections(project.id);
  const { data: directionReviews = [] } = useCreativeDirectionReviews(project.id);
  const { data: kitData, isLoading: kitLoading } = useStudioBrandKit(project.id);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [directionId, setDirectionId] = useState<string | null>(null);

  const buildBrief = useAction((ctx, p: StudioProject) => creative.saveCreativeBrief(ctx, p), {
    success: 'Creative Direction Brief saved',
    onSuccess: (brief) => setBriefId(brief.id),
  });
  const adjustBrief = useAction(
    (ctx, p: StudioProject, preferences: BriefPreferences, note: string) => creative.saveCreativeBrief(ctx, p, { preferences, note }),
    { success: 'New brief version saved', onSuccess: (brief) => setBriefId(brief.id) },
  );
  const confirmBrief = useAction(
    (ctx, p: StudioProject, brief: StudioCreativeBrief, note: string) => creative.confirmCreativeBrief(ctx, p, brief, note),
    { success: 'Creative Direction Brief confirmed' },
  );
  const propose = useAction((ctx, p: StudioProject) => creative.saveCreativeDirection(ctx, p), {
    success: 'Three concepts proposed',
    onSuccess: (direction) => setDirectionId(direction.id),
  });
  const feedback = useAction(
    (ctx, p: StudioProject, direction: typeof directions[number], concept: CreativeConcept, decision: 'feedback' | 'request_changes' | 'reject', note: string) =>
      creative.recordDirectionFeedback(ctx, p, direction, concept.key, decision, note),
    { success: 'Decision recorded' },
  );
  const editConcept = useAction(
    (ctx, p: StudioProject, direction: typeof directions[number], concept: CreativeConcept, edit: ConceptEdit, note: string) =>
      creative.saveDirectionRevision(ctx, p, direction, concept.key, edit, note),
    { success: 'New direction version saved', onSuccess: (direction) => setDirectionId(direction.id) },
  );
  const approveConcept = useAction(
    (ctx, p: StudioProject, direction: typeof directions[number], conceptKey: string, note: string) =>
      creative.approveDirectionConcept(ctx, p, direction, conceptKey, note),
    { success: 'Concept approved' },
  );

  const busy = buildBrief.pending || adjustBrief.pending || confirmBrief.pending || propose.pending || feedback.pending || editConcept.pending || approveConcept.pending;

  if ((schema.isLoading || kitLoading || briefsLoading || directionsLoading) && schema.data !== false) return <PageSkeleton />;
  if (schema.data === false) {
    return (
      <Notice tone="warning" title="Database migration required">
        Apply migration 014 (supabase/migrations/014_studio_creative_direction.sql) to use the Creative Director. Migration 013 is also required.
      </Notice>
    );
  }

  const approvedKit = kitData ? currentBrandKitApproval(kitData.approvals) : null;
  const latestBrief = briefs[0] ?? null;
  const selectedBrief = briefs.find((brief) => brief.id === briefId) ?? latestBrief;
  const confirmation = latestBriefConfirmation(briefReviews);
  const selectedConfirmed = Boolean(confirmation && selectedBrief && confirmation.briefId === selectedBrief.id);
  const latestConfirmed = Boolean(confirmation && latestBrief && confirmation.briefId === latestBrief.id);
  const selectedDirection = directions.find((direction) => direction.id === directionId) ?? directions[0] ?? null;
  const directionApproval = selectedDirection ? currentDirectionApproval(directionReviews.filter((review) => review.directionId === selectedDirection.id)) : null;

  async function handleConfirm(note: string): Promise<boolean> {
    if (!selectedBrief) return false;
    return Boolean(await confirmBrief.run(project, selectedBrief, note));
  }
  async function handleAdjust(preferences: BriefPreferences, note: string): Promise<boolean> {
    return Boolean(await adjustBrief.run(project, preferences, note));
  }
  async function handleFeedback(concept: CreativeConcept, decision: 'feedback' | 'request_changes' | 'reject', note: string): Promise<boolean> {
    if (!selectedDirection) return false;
    return Boolean(await feedback.run(project, selectedDirection, concept, decision, note));
  }
  async function handleEdit(concept: CreativeConcept, edit: ConceptEdit, note: string): Promise<boolean> {
    if (!selectedDirection) return false;
    return Boolean(await editConcept.run(project, selectedDirection, concept, edit, note));
  }
  async function handleApprove(concept: CreativeConcept, note: string): Promise<boolean> {
    if (!selectedDirection) return false;
    return Boolean(await approveConcept.run(project, selectedDirection, concept.key, note));
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><Compass className="size-4" aria-hidden /> Creative direction</h2>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            An argued brief, then three territories that differ in composition, type, colour, imagery, motion and conversion — not one layout with colour options.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {briefs.length > 1 && selectedBrief && (
            <label className="flex items-center gap-2 text-xs text-subtle">
              Brief
              <Select aria-label="Brief version" className="w-auto" value={selectedBrief.id} onChange={(e) => setBriefId(e.target.value)}>
                {briefs.map((brief) => {
                  const isConfirmed = confirmation?.briefId === brief.id;
                  return <option key={brief.id} value={brief.id}>Version {brief.version}{brief.id === latestBrief?.id ? ' (latest)' : ''}{isConfirmed ? ' · confirmed' : ''}</option>;
                })}
              </Select>
            </label>
          )}
          {directions.length > 1 && selectedDirection && (
            <label className="flex items-center gap-2 text-xs text-subtle">
              Direction
              <Select aria-label="Direction version" className="w-auto" value={selectedDirection.id} onChange={(e) => setDirectionId(e.target.value)}>
                {directions.map((direction) => (
                  <option key={direction.id} value={direction.id}>Version {direction.version}{direction.id === directions[0]?.id ? ' (latest)' : ''}</option>
                ))}
              </Select>
            </label>
          )}
        </div>
      </div>

      {!approvedKit && (
        <Notice tone="warning" title="An approved Brand Kit comes first">
          Creative direction builds from the approved palette, typography, personality and files. Open the Brand Kit tab, save a version and approve it. The Studio will not invent a brand to fill the gap.
        </Notice>
      )}

      {!selectedBrief ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No Creative Direction Brief yet"
            description={approvedKit ? 'The Studio can build the brief from the reviewed evidence and the approved kit. Nothing about the business is invented: gaps become questions.' : 'Approve a Brand Kit version first; the brief is built from it and the reviewed evidence.'}
            action={editable && approvedKit ? <Button loading={buildBrief.pending} onClick={() => void buildBrief.run(project)}><FileText aria-hidden /> Build the brief</Button> : undefined}
          />
        </Card>
      ) : (
        <CreativeBriefPanel
          brief={selectedBrief}
          confirmation={selectedConfirmed ? confirmation : null}
          editable={editable && selectedBrief.id === latestBrief?.id}
          busy={busy}
          onConfirm={handleConfirm}
          onAdjust={handleAdjust}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><Layers className="size-4" aria-hidden /> Three concepts</h2>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Each concept is a different argument. The comparison, the trade-offs and the advisory review exist so a person can choose with reasons, not by preference alone.
          </p>
        </div>
        {editable && directions.length > 0 && (
          <Button
            variant="primary"
            loading={propose.pending}
            disabled={!latestConfirmed || !approvedKit}
            title={!approvedKit ? 'Approve a Brand Kit first' : !latestConfirmed ? 'Confirm the latest brief first' : undefined}
            onClick={() => void propose.run(project)}
          >
            <RefreshCw aria-hidden /> Propose from this brief
          </Button>
        )}
      </div>

      {!directions.length ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="No directions yet"
            description={!approvedKit ? 'Approve a Brand Kit first.' : !latestConfirmed ? 'Confirm the latest brief, then the Studio will propose three structural territories.' : 'The Studio will propose three concepts with distinct compositions, typographies, palettes, imagery, motion and conversion paths.'}
            action={editable && approvedKit && latestConfirmed ? <Button loading={propose.pending} onClick={() => void propose.run(project)}><Layers aria-hidden /> Propose three directions</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          {directionApproval && (
            <Notice tone="success" title="This direction has an approved concept">
              {selectedDirection?.content.concepts.find((concept) => concept.key === directionApproval.conceptKey)?.name ?? directionApproval.conceptKey} is the concept phase 4 would build from. Direction version {selectedDirection?.version}. A later change request revokes this approval.
            </Notice>
          )}
          {selectedDirection && (
            <CreativeDirectionPanel
              direction={selectedDirection}
              reviews={directionReviews}
              editable={editable}
              busy={busy}
              onFeedback={handleFeedback}
              onEdit={handleEdit}
              onApprove={handleApprove}
            />
          )}
        </>
      )}

      {selectedBrief && !selectedConfirmed && selectedBrief.id === latestBrief?.id && (
        <Notice tone="info" title="The latest brief is not confirmed">
          Confirming it is what enables the three-concept proposal. Adjustments save a new version, which must be confirmed again.
        </Notice>
      )}

      {directions.length > 0 && (
        <p className="text-xs text-subtle">
          Directions are immutable versions. Editing a concept saves a new version; earlier versions and their approvals remain as history. <Badge tone="neutral">Generated offline</Badge>
        </p>
      )}
    </>
  );
}


