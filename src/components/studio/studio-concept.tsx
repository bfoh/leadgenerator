'use client';

import { Archive, ArchiveRestore, ArrowLeft, ExternalLink, Palette, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as studio from '@/lib/data/studio-services';
import type { PageFacts } from '@/lib/domain/page-signals';
import {
  CLASSIFICATION_META,
  INTELLIGENCE_META,
  PROJECT_STATUS_META,
  countClassifications,
  decisionOf,
  groupByClassification,
  observationsOfRun,
  runsOf,
  verificationOf,
  type ReviewDecision,
  type StudioObservation,
  type StudioProject,
  type StudioReview,
} from '@/lib/domain/studio';
import { hostOf } from '@/lib/domain/web-research';
import { errorMessage, formatDateTime } from '@/lib/utils';
import { ApiError, api } from '@/lib/workspace/api';
import { useAction, useBusinesses, useStudioAssets, useStudioObservations, useStudioProject, useStudioReviews } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { StudioAssetVault } from './asset-vault';
import { CollectResourcesButton } from '@/components/resources/collect-resources-button';
import { StudioBrandKitPanel } from './brand-kit';
import { ConceptBrief, ObservationRow, ReviewDialog, ReviewTrail } from './concept-evidence';
import { StudioCreativeDirectionPanel } from './creative-direction';
import { StudioWebsitePanel } from './website-preview';

interface InspectResponse {
  facts: PageFacts | null;
  robots: 'allowed' | 'disallowed' | 'unavailable' | 'not_checked';
  check: { ok: boolean; error: string | null; status: number | null } | null;
  simulated: boolean;
}

/** Why a page produced no facts, in words the team can act on. */
function unreadableReason(res: InspectResponse | null, failure: string | null): string {
  if (failure) return `The site could not be read: ${failure}`;
  if (!res) return 'The site could not be read.';
  if (res.robots === 'disallowed') return 'The site’s robots.txt asks crawlers to stay out, so no page was read. Ask the business for a copy of their content instead.';
  if (res.robots === 'unavailable') return 'robots.txt could not be checked, so no page was read. Try again later.';
  if (res.check?.error) return `The homepage did not load: ${res.check.error}`;
  if (res.check?.status) return `The homepage answered with HTTP ${res.check.status}, so there was nothing to read.`;
  return 'The homepage returned no readable content.';
}

export function StudioConceptView({ id }: { id: string }) {
  const { can } = useWorkspace();
  const router = useRouter();
  const { data: project, isLoading } = useStudioProject(id);
  const { data: observations = [] } = useStudioObservations(id);
  const { data: reviews = [] } = useStudioReviews(id);
  const { data: assets = [] } = useStudioAssets(id);
  const { data: businesses = [] } = useBusinesses();
  const [run, setRun] = useState<number | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ observation: StudioObservation | null; decision: ReviewDecision } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reading, setReading] = useState(false);

  const business = project ? (businesses.find((b) => b.id === project.businessId) ?? null) : null;
  const siteUrl = project ? (project.websiteUrl ?? business?.officialWebsite ?? null) : null;
  const canWrite = can('studio.write');
  const editable = canWrite && project?.status !== 'archived';

  const analyse = useAction(
    (ctx, p: StudioProject, facts: PageFacts | null, note: string | null, simulated: boolean) =>
      studio.analyseStudioConcept(ctx, p, facts, { note, simulated }),
    { success: 'Analysis recorded' },
  );
  const archive = useAction((ctx, p: StudioProject) => studio.archiveStudioConcept(ctx, p), { success: 'Concept archived' });
  const restore = useAction((ctx, p: StudioProject) => studio.restoreStudioConcept(ctx, p), { success: 'Concept restored' });
  const remove = useAction((ctx, p: StudioProject) => studio.deleteStudioConcept(ctx, p), {
    success: 'Concept deleted',
    onSuccess: () => router.push('/studio'),
  });
  const decide = useAction((ctx, p: StudioProject, o: StudioObservation | null, d: ReviewDecision, n: string) => studio.reviewStudioObservation(ctx, p, o, d, n), {
    success: 'Decision recorded',
  });

  /**
   * Reads the page through the same guarded check the agents use, then records what it showed.
   * A site that cannot be read is recorded as such: the concept then says it has no evidence.
   */
  async function analyseSite(p: StudioProject, url: string) {
    setReading(true);
    let inspected: InspectResponse | null = null;
    try {
      inspected = await api.post<InspectResponse>('/api/studio/inspect', { url });
    } catch (error) {
      const failure = error instanceof ApiError && error.status < 500 ? error.message : null;
      await analyse.run(p, null, unreadableReason(null, failure ?? errorMessage(error)), false);
      setReading(false);
      return;
    }
    await analyse.run(p, inspected.facts, inspected.facts ? null : unreadableReason(inspected, null), inspected.simulated);
    setReading(false);
  }

  if (isLoading) return <PageSkeleton />;
  if (!project) {
    return (
      <Card>
        <EmptyState
          icon={Palette}
          title="Concept not found"
          description="It may have been deleted, or the address is wrong."
          action={<ButtonLink href="/studio">All website concepts</ButtonLink>}
        />
      </Card>
    );
  }

  const archived = project.status === 'archived';
  const busy = reading || analyse.pending;

  return (
    <>
      <header className="mb-5">
        <Link href="/studio" className="mb-3 inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> Website concepts
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
            <div className="mt-3"><CollectResourcesButton businessId={project.businessId} /></div>
            <p className="mt-0.5 text-sm text-subtle">
              {business ? (
                <Link href={`/prospects/${business.id}`} className="hover:text-foreground hover:underline">
                  {business.name}
                </Link>
              ) : (
                'Prospect removed'
              )}
              {siteUrl && (
                <>
                  {' · '}
                  <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                    {hostOf(siteUrl) ?? siteUrl}
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </>
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={PROJECT_STATUS_META[project.status].tone}>{PROJECT_STATUS_META[project.status].label}</Badge>
              <Badge tone={INTELLIGENCE_META[project.intelligenceStatus].tone}>{INTELLIGENCE_META[project.intelligenceStatus].label}</Badge>
              {project.intelligenceAt && <span className="text-xs text-subtle">Read {formatDateTime(project.intelligenceAt)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <Button variant="primary" loading={busy} disabled={!siteUrl} onClick={() => siteUrl && void analyseSite(project, siteUrl)}>
                <RefreshCw aria-hidden /> {observations.length ? 'Analyse again' : 'Analyse the site'}
              </Button>
            )}
            {canWrite && (
              <>
                <Button loading={archive.pending || restore.pending} onClick={() => void (archived ? restore.run(project) : archive.run(project))}>
                  {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} {archived ? 'Restore' : 'Archive'}
                </Button>
                {can('records.delete') && (
                  <Button variant="outline-danger" onClick={() => setDeleting(true)} aria-label="Delete concept">
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </header>
      {archived && (
        <Notice tone="neutral" className="mb-4" title="Archived concept">
          This concept keeps its evidence as history. Restore it to analyse the site again.
        </Notice>
      )}
      {!siteUrl && (
        <Notice tone="warning" className="mb-4" title="No website address yet">
          This prospect has no website on record. Add the address below before analysing, so every piece of evidence can point back to its source.
        </Notice>
      )}

      <Tabs defaultValue="evidence">
        <TabsList label="Studio sections" className="flex-wrap">
          <TabsTrigger value="evidence" count={observations.length}>Evidence</TabsTrigger>
          <TabsTrigger value="assets" count={assets.length}>Asset vault</TabsTrigger>
          <TabsTrigger value="brand-kit">Brand Kit</TabsTrigger>
          <TabsTrigger value="creative-direction">Creative direction</TabsTrigger>
          <TabsTrigger value="website">Website prototype</TabsTrigger>
        </TabsList>
        <TabsContent value="evidence" className="space-y-5 pt-5">
          <ConceptBrief project={project} editable={editable} siteUrl={siteUrl} />
          {observations.length === 0 ? (
            <Card>
              <EmptyState
                icon={Palette}
                title={project.intelligenceStatus === 'unavailable' ? 'The site could not be read' : 'No evidence yet'}
                description={project.intelligenceNote ?? 'Analyse the business’s homepage to record what it shows, what it leaves out, and what only the business can tell you.'}
                action={
                  editable && siteUrl ? (
                    <Button loading={busy} onClick={() => void analyseSite(project, siteUrl)}>
                      <RefreshCw aria-hidden /> Analyse the site
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <Evidence
              project={project}
              observations={observations}
              reviews={reviews}
              run={run}
              onRunChange={setRun}
              editable={editable}
              onReview={(observation, decision) =>
                decision === 'confirm' ? void decide.run(project, observation, 'confirm', '') : setReviewTarget({ observation, decision })
              }
            />
          )}
        </TabsContent>
        <TabsContent value="assets" className="space-y-5 pt-5">
          <StudioAssetVault
            project={project}
            editable={editable}
            canDelete={can('records.delete')}
            canExport={can('data.export')}
            businessName={business?.name ?? project.name.replace(/ — website concept$/, '')}
          />
        </TabsContent>
        <TabsContent value="brand-kit" className="space-y-5 pt-5">
          <StudioBrandKitPanel project={project} editable={editable} />
        </TabsContent>
        <TabsContent value="creative-direction" className="space-y-5 pt-5">
          <StudioCreativeDirectionPanel project={project} editable={editable} />
        </TabsContent>
        <TabsContent value="website" className="space-y-5 pt-5">
          <StudioWebsitePanel project={project} editable={editable} />
        </TabsContent>
      </Tabs>
      {reviewTarget && (
        <ReviewDialog
          observation={reviewTarget.observation}
          decision={reviewTarget.decision}
          pending={decide.pending}
          onCancel={() => setReviewTarget(null)}
          onSubmit={async (note) => {
            const saved = await decide.run(project, reviewTarget.observation, reviewTarget.decision, note);
            if (saved) setReviewTarget(null);
          }}
        />
      )}
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        size="sm"
        title={`Delete ${project.name}?`}
        description="This permanently removes the concept with its evidence and review history. The prospect itself is not affected."
        footer={
          <>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
            <Button variant="danger" loading={remove.pending} onClick={() => void remove.run(project)}>
              Delete permanently
            </Button>
          </>
        }
      >
        <p className="text-sm text-subtle">
          {observations.length} evidence entr{observations.length === 1 ? 'y' : 'ies'} and {reviews.length} review{reviews.length === 1 ? '' : 's'} will be removed. Archive the concept instead to keep them as history.
        </p>
      </Dialog>
    </>
  );
}

/**
 * One analysis run, grouped by how each entry is known. The grouping is the point: a fact, a gap,
 * a placeholder, our suggestion and a reference we may not use never sit in the same list.
 */
function Evidence({
  project,
  observations,
  reviews,
  run,
  onRunChange,
  editable,
  onReview,
}: {
  project: StudioProject;
  observations: StudioObservation[];
  reviews: StudioReview[];
  run: number | null;
  onRunChange: (run: number) => void;
  editable: boolean;
  onReview: (observation: StudioObservation, decision: ReviewDecision) => void;
}) {
  const runs = runsOf(observations);
  const current = run ?? runs[0];
  const shown = observationsOfRun(observations, current);
  const groups = groupByClassification(shown);
  const counts = countClassifications(shown);
  const simulated = Boolean(project.intelligenceNote?.startsWith('Simulated reading'));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-subtle">Analysis run</span>
          {runs.length > 1 ? (
            <Select aria-label="Analysis run" value={String(current)} onChange={(e) => onRunChange(Number(e.target.value))} className="w-auto">
              {runs.map((r) => (
                <option key={r} value={r}>
                  Run {r}
                  {r === runs[0] ? ' (latest)' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <span className="text-sm font-medium">1</span>
          )}
          <span className="text-xs text-subtle">
            {counts.total} entr{counts.total === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <p className="text-xs text-subtle">Every run is kept. Nothing here is overwritten.</p>
      </div>
      {project.intelligenceNote && (
        <Notice tone={simulated ? 'info' : 'neutral'} title={simulated ? 'Simulated reading' : 'What this run found'}>
          {project.intelligenceNote}
        </Notice>
      )}
      {groups.map((group) => (
        <Card key={group.classification}>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {CLASSIFICATION_META[group.classification].label}
                <Badge tone={CLASSIFICATION_META[group.classification].tone}>{group.observations.length}</Badge>
              </span>
            }
            description={CLASSIFICATION_META[group.classification].description}
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-border">
              {group.observations.map((observation) => (
                <ObservationRow
                  key={observation.id}
                  observation={observation}
                  review={verificationOf(observation.id, reviews)}
                  decision={decisionOf(observation.id, reviews)}
                  canWrite={editable}
                  onReview={(decision) => onReview(observation, decision)}
                />
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
      <Notice tone="neutral" title="Our suggestions are not their brand">
        Anything under “Our suggestion” was written by us, not found on their site. Nothing about a logo or photograph is copied or downloaded: the Studio records where it was referenced and leaves permission to the business.
      </Notice>
      <ReviewTrail reviews={reviews} />
    </>
  );
}

