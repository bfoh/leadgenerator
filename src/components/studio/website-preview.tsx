'use client';

import { ArrowUpRight, GitCompareArrows, History, ImageIcon, Monitor, Save, ShieldAlert, Smartphone, Tablet, Type } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/field';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import { WebsiteRenderer } from '@/components/website/website-renderer';
import { currentBrandKitApproval } from '@/lib/domain/studio-assets';
import { currentDirectionApproval, prototypeAssets, type StudioCreativeDirection } from '@/lib/domain/creative-direction';
import type { StudioProject } from '@/lib/domain/studio';
import type { AssetRole } from '@/lib/domain/website-editorial';
import type { BlueprintMediaSource } from '@/lib/domain/website-compositions';
import { buildWebsiteBlueprint } from '@/lib/domain/website-compositions';
import { compareBlueprints, type WebsiteBlueprint } from '@/lib/domain/website-blueprint';
import { saveWebsitePrototype } from '@/lib/data/website-prototype-services';
import { errorMessage, formatDateTime } from '@/lib/utils';
import {
  useAction,
  useBusinesses,
  useCreativeBriefs,
  useCreativeDirectionReviews,
  useCreativeDirections,
  useStudioAssets,
  useStudioBrandKit,
  useStudioWebsitePrototypes,
  useWebsitePrototypeSchema,
} from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import type { BlueprintAsset } from '@/lib/domain/website-blueprint';

const DEVICES = [
  { key: 'desktop' as const, label: 'Desktop', width: '100%', icon: Monitor },
  { key: 'tablet' as const, label: 'Tablet', width: '820px', icon: Tablet },
  { key: 'mobile' as const, label: 'Mobile', width: '390px', icon: Smartphone },
];

const ROLE_ORDER: AssetRole[] = ['hero', 'portrait', 'detail', 'scene', 'context', 'texture', 'drawing', 'drawing-alt'];

function mediaAlt(asset: BlueprintAsset): string {
  return asset.alt || asset.caption || `Approved concept asset: ${asset.fileName}`;
}

export function StudioWebsitePanel({ project, editable }: { project: StudioProject; editable: boolean }) {
  const { assets: storage } = useWorkspace();
  const schema = useWebsitePrototypeSchema();
  const { data: businesses = [] } = useBusinesses();
  const { data: briefs = [], isLoading: briefsLoading } = useCreativeBriefs(project.id);
  const { data: directions = [], isLoading: directionsLoading } = useCreativeDirections(project.id);
  const { data: reviews = [], isLoading: reviewsLoading } = useCreativeDirectionReviews(project.id);
  const { data: vault = [], isLoading: assetsLoading } = useStudioAssets(project.id);
  const { data: kitData, isLoading: kitLoading } = useStudioBrandKit(project.id);
  const { data: prototypes = [], isLoading: prototypesLoading } = useStudioWebsitePrototypes(project.id);

  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [pageSlug, setPageSlug] = useState('home');
  const [mediaSources, setMediaSources] = useState<BlueprintMediaSource[]>([]);
  const [savingOpen, setSavingOpen] = useState(false);
  const [saveNote, setSaveNote] = useState('Rendered from the approved creative direction.');
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);

  const save = useAction(
    (ctx, p: StudioProject, direction: StudioCreativeDirection, conceptKey: string, blueprint: WebsiteBlueprint, note: string) =>
      saveWebsitePrototype(ctx, p, direction, conceptKey, blueprint, note),
    {
      success: (row) => `Prototype version ${row.version} saved`,
      onSuccess: (row) => {
        setSavingOpen(false);
        setCompareVersionId(row.id);
        setPreviewVersionId(null);
      },
    },
  );

  const approval = currentDirectionApproval(reviews);
  const direction = approval ? (directions.find((entry) => entry.id === approval.directionId) ?? null) : null;
  const concept = direction?.content.concepts.find((entry) => entry.key === approval?.conceptKey) ?? null;
  const brief = direction ? (briefs.find((entry) => entry.id === direction.content.briefVersionId) ?? null) : null;
  const brandApproval = kitData ? currentBrandKitApproval(kitData.approvals) : null;
  const kitVersion = direction && kitData ? (kitData.versions.find((entry) => entry.id === direction.content.brandKitVersionId) ?? null) : null;
  const business = businesses.find((entry) => entry.id === project.businessId) ?? null;

  const usableImages = useMemo(
    () =>
      prototypeAssets(vault).filter(
        (asset) => asset.mimeType.startsWith('image/') && !['logo', 'brand_mark'].includes(asset.kind),
      ),
    [vault],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const items = await Promise.all(
        usableImages.map(async (asset) => {
          const url = await storage.signedUrl(asset.storagePath);
          if (!url) return null;
          return {
            assetId: asset.id,
            src: url,
            width: asset.width ?? 1200,
            height: asset.height ?? 1500,
            alt: asset.note.trim() || `Approved concept asset: ${asset.fileName.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '')}.`,
          } satisfies BlueprintMediaSource;
        }),
      );
      if (!cancelled) setMediaSources(items.filter((item): item is BlueprintMediaSource => Boolean(item)));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [storage, usableImages]);

  const draft = useMemo(() => {
    if (!brief || !direction || !concept || !business || !kitVersion) return null;
    const roleAssets: Partial<Record<AssetRole, string>> = {};
    usableImages.forEach((asset, index) => {
      const role = ROLE_ORDER[index];
      if (role) roleAssets[role] = asset.id;
    });
    try {
      return buildWebsiteBlueprint({
        project,
        business,
        brief: brief.content,
        direction: { id: direction.id, version: direction.version, content: direction.content },
        conceptKey: concept.key,
        kit: { versionId: kitVersion.id, version: kitVersion.version },
        assets: vault,
        roleAssets,
        availableMediaIds: mediaSources.map((source) => source.assetId),
        synthetic: false,
      });
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [brief, business, concept, direction, kitVersion, mediaSources, project, usableImages, vault]);

  const selectedSaved = prototypes.find((entry) => entry.id === previewVersionId) ?? null;
  const activeBlueprint = selectedSaved?.content ?? (draft && !('error' in draft) ? draft : null);
  const media = mediaSources;
  const compareSource = prototypes.find((entry) => entry.id === compareVersionId) ?? null;
  const comparison = compareSource && draft && !('error' in draft) ? compareBlueprints(compareSource.content, draft) : null;
  const effectivePageSlug = activeBlueprint?.pages.some((entry) => entry.slug === pageSlug)
    ? pageSlug
    : (activeBlueprint?.pages[0]?.slug ?? 'home');

  const loading = schema.isLoading || briefsLoading || directionsLoading || reviewsLoading || assetsLoading || kitLoading || prototypesLoading;
  if (loading && schema.data !== false) return <PageSkeleton />;
  if (schema.data === false) {
    return (
      <Notice tone="warning" title="Database migration required">
        Apply migration 015 (supabase/migrations/015_studio_website_prototypes.sql) to render and save website prototypes. Migrations 012, 013 and 014 are also required.
      </Notice>
    );
  }

  if (!approval || !direction || !concept) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="No approved concept to render"
          description="A website prototype is built only from a current human approval for a specific concept. Open Creative direction, review the three territories and approve one. A later change request or rejection revokes this preview."
          action={
            <ButtonLink href="/showcase" variant="secondary">
              See the three flagship examples
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  if (!brief || !kitVersion || !business) {
    return (
      <Notice tone="warning" title="The approved direction is incomplete">
        This direction names a brief or Brand Kit version that is not available. Reopen the Creative direction tab, confirm the latest brief and regenerate the direction. A renderer will not substitute different content or a different kit.
      </Notice>
    );
  }

  if (draft && 'error' in draft) {
    return (
      <Notice tone="danger" title="The blueprint could not be built">
        {draft.error}
      </Notice>
    );
  }

  const draftBlueprint = draft && !('error' in draft) ? draft : null;
  const kitMismatch = !brandApproval || brandApproval.versionId !== kitVersion.id;
  const canSave = Boolean(editable && draftBlueprint?.readiness.previewReady && !kitMismatch);
  const savedCount = prototypes.length;
  const activeDevice = DEVICES.find((entry) => entry.key === device) ?? DEVICES[0];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Website prototype</h2>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Approved concept <strong className="font-medium text-foreground">{concept.name}</strong> — direction version {direction.version}. Built by the trusted renderer from the blueprint, the approved Brand Kit and prototype-cleared vault files.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {previewVersionId && (
            <Button variant="secondary" onClick={() => setPreviewVersionId(null)}>
              Return to current draft
            </Button>
          )}
          <Button variant="secondary" loading={save.pending} disabled={!canSave} onClick={() => setSavingOpen(true)}>
            <Save aria-hidden /> Save version
          </Button>
          <ButtonLink href="/showcase" variant="secondary">
            Flagship examples <ArrowUpRight aria-hidden />
          </ButtonLink>
        </div>
      </div>

      <Notice tone={kitMismatch ? 'warning' : 'success'} title={kitMismatch ? 'The Brand Kit has moved on' : 'Approved direction is bound to this render'}>
        {kitMismatch
          ? 'The direction was built from a different Brand Kit version than the current approval. Regenerate the creative direction before saving a prototype.'
          : `Brief version ${brief.version}, Brand Kit version ${kitVersion.version}, direction version ${direction.version}. Approval and prototype permissions are checked again on save.`}
      </Notice>

      {draftBlueprint && (
        <Notice tone={draftBlueprint.readiness.previewReady ? 'info' : 'warning'} title={draftBlueprint.readiness.previewReady ? 'Preview is ready; publication is not' : 'Preview has blockers'}>
          {draftBlueprint.readiness.previewReady
            ? `${draftBlueprint.pages.length} pages, ${draftBlueprint.assets.length} approved media assets. Publishing remains blocked until a separate permission check and final copy approval.`
            : draftBlueprint.readiness.blockers.join(' ')}
        </Notice>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-2">
            <div className="flex items-center gap-1" role="group" aria-label="Preview size">
              {DEVICES.map((entry) => (
                <Button
                  key={entry.key}
                  size="sm"
                  variant={device === entry.key ? 'primary' : 'ghost'}
                  aria-pressed={device === entry.key}
                  onClick={() => setDevice(entry.key)}
                >
                  <entry.icon aria-hidden /> {entry.label}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeBlueprint && activeBlueprint.pages.length > 1 && (
                <label className="flex items-center gap-2 text-xs text-subtle">
                  Page
                  <Select aria-label="Preview page" className="w-auto" value={effectivePageSlug} onChange={(event) => setPageSlug(event.target.value)}>
                    {activeBlueprint.pages.map((page) => (
                      <option key={page.slug} value={page.slug}>{page.label}</option>
                    ))}
                  </Select>
                </label>
              )}
              <Badge tone={selectedSaved ? 'info' : 'success'}>{selectedSaved ? `Saved version ${selectedSaved.version}` : 'Current draft'}</Badge>
            </div>
          </div>

          {activeBlueprint ? (
            <div className="overflow-auto rounded-xl border border-border-strong bg-[#101010] p-2 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-white/55">
                <span className="truncate">Concept prototype / {concept.name} / {effectivePageSlug}</span>
                <span>{activeDevice.label} · {activeDevice.width === '100%' ? 'fluid' : activeDevice.width}</span>
              </div>
              <div className="mx-auto overflow-hidden bg-white shadow-2xl transition-[max-width] duration-300" style={{ maxWidth: activeDevice.width }}>
                <WebsiteRenderer
                  key={selectedSaved?.id ?? 'draft'}
                  blueprint={activeBlueprint}
                  pageSlug={effectivePageSlug}
                  media={media}
                  basePath={`/studio/${project.id}/web-preview`}
                  embedded
                  onNavigate={(slug) => setPageSlug(slug)}
                />
              </div>
            </div>
          ) : (
            <Card>
              <EmptyState icon={Monitor} title="Preview not built" description="The approved direction, brief, kit and business record are required to build the blueprint." />
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title={<span className="flex items-center gap-1.5"><ShieldAlert className="size-4" aria-hidden />Readiness and limits</span>} />
            <CardBody className="space-y-3 text-sm">
              {draftBlueprint && (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">Preview</span>
                    <Badge tone={draftBlueprint.readiness.previewReady ? 'success' : 'warning'}>
                      {draftBlueprint.readiness.previewReady ? 'Ready' : 'Blocked'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">Publish</span>
                    <Badge tone="neutral">Blocked by design</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-subtle">Approved media</span>
                    <span className="tabular">{draftBlueprint.assets.length}</span>
                  </div>
                  {draftBlueprint.readiness.blockers.map((blocker) => (
                    <p key={blocker} className="text-xs text-danger">{blocker}</p>
                  ))}
                  {draftBlueprint.readiness.warnings.slice(0, 4).map((warning) => (
                    <p key={warning} className="text-xs text-subtle">{warning}</p>
                  ))}
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-1.5"><History className="size-4" aria-hidden />Missing information</span>} />
            <CardBody>
              <ul className="space-y-2 text-xs text-subtle">
                {draftBlueprint?.missingInformation.slice(0, 6).map((item) => (
                  <li key={item.id} className={item.blocking ? 'text-warning' : ''}>
                    {item.question}
                  </li>
                ))}
                {!draftBlueprint?.missingInformation.length && <li>No open questions from the confirmed brief.</li>}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-1.5"><ImageIcon className="size-4" aria-hidden />Media and licences</span>} />
            <CardBody>
              <ul className="space-y-2 text-xs">
                {draftBlueprint?.assets.map((asset) => (
                  <li key={asset.id} className="border-b border-border pb-2 last:border-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{asset.fileName}</span>
                      <Badge tone="success">Prototype</Badge>
                    </div>
                    <p className="mt-0.5 text-subtle">{asset.licence.name}{asset.licence.expiresOn ? ` · expires ${asset.licence.expiresOn}` : ''}</p>
                    <p className="mt-0.5 text-[11px] text-subtle">{mediaAlt(asset)}</p>
                  </li>
                ))}
                {!draftBlueprint?.assets.length && <li className="text-subtle">No approved image assets. The renderer uses labelled image-pending plates.</li>}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-1.5"><Type className="size-4" aria-hidden />Type and motion</span>} />
            <CardBody className="space-y-2 text-xs text-subtle">
              <p><strong className="font-medium text-foreground">{draftBlueprint?.typography.display.requestedFamily}</strong> / {draftBlueprint?.typography.body.requestedFamily}</p>
              <p>{draftBlueprint?.typography.note}</p>
              <p>{draftBlueprint?.tokens.motion.label} · {draftBlueprint?.tokens.motion.durationMs}ms · reduced motion supported.</p>
              {draftBlueprint?.typography.warnings.map((warning) => <p key={warning} className="text-warning">{warning}</p>)}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={<span className="flex items-center gap-1.5"><History className="size-4" aria-hidden />Saved prototype versions</span>}
              description="Immutable. Open one to inspect the exact blueprint that was saved."
            />
            <CardBody className="space-y-2">
              {prototypes.map((prototype) => (
                <div key={prototype.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Version {prototype.version}</p>
                    <p className="text-[11px] text-subtle">{formatDateTime(prototype.createdAt)} · {prototype.content.direction.conceptName}</p>
                  </div>
                  <Button size="sm" variant={previewVersionId === prototype.id ? 'primary' : 'ghost'} onClick={() => setPreviewVersionId(prototype.id)}>
                    Open
                  </Button>
                </div>
              ))}
              {!savedCount && <p className="text-xs text-subtle">No saved versions yet. The current draft is generated from the approved direction but not stored.</p>}
            </CardBody>
          </Card>

          {prototypes.length > 0 && (
            <Card>
              <CardHeader title={<span className="flex items-center gap-1.5"><GitCompareArrows className="size-4" aria-hidden />Compare design variants</span>} />
              <CardBody className="space-y-3">
                <label className="flex items-center gap-2 text-xs text-subtle">
                  Compare current draft with
                  <Select aria-label="Compare version" className="w-auto" value={compareVersionId ?? ''} onChange={(event) => setCompareVersionId(event.target.value || null)}>
                    <option value="">Choose a version</option>
                    {prototypes.map((prototype) => <option key={prototype.id} value={prototype.id}>Version {prototype.version}</option>)}
                  </Select>
                </label>
                {comparison ? (
                  <ul className="space-y-1 text-xs text-subtle">
                    {comparison.summary.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                ) : (
                  <p className="text-xs text-subtle">Choose a saved version to compare direction, composition, typography, palette and changed pages.</p>
                )}
              </CardBody>
            </Card>
          )}
        </aside>
      </div>

      <Dialog
        open={savingOpen}
        onOpenChange={setSavingOpen}
        title="Save this prototype version"
        description={`Version ${savedCount + 1} will be immutable. It stays internal; no public link is created.`}
        footer={
          <>
            <Button onClick={() => setSavingOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={save.pending}
              disabled={!canSave || saveNote.trim().length < 3}
              onClick={() => {
                if (draftBlueprint) void save.run(project, direction, concept.key, draftBlueprint, saveNote);
              }}
            >
              Save version
            </Button>
          </>
        }
      >
        <Field label="What changed, and why" hint="At least 3 characters. This note is part of the immutable history." required>
          {(field) => (
            <Textarea {...field} value={saveNote} onChange={(event) => setSaveNote(event.target.value)} rows={3} maxLength={1000} />
          )}
        </Field>
        <p className="mt-3 text-xs text-subtle">
          Saving does not approve the website for publication. Asset permissions, copy, accessibility and performance still need separate sign-off.
        </p>
      </Dialog>
    </>
  );
}
