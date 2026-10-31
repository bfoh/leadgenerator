'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/misc';
import { IdentifyBusiness } from '@/components/prospects/profile/identify-business';
import type { ResourceEntry } from '@/lib/domain/business-resources';
import {
  IDENTITY_STANDING_META,
  kitReadiness,
  RESOURCE_KIT_DOCUMENTS,
  type KitReadiness,
  type VisualGroupSummary,
  type VisualReuse,
} from '@/lib/domain/resource-readiness';
import type { StudioProject } from '@/lib/domain/studio';
import type { Business } from '@/lib/domain/types';
import {
  useAssetVaultSchema,
  useResearchObservations,
  useSocialResearchSchema,
  useSocialSources,
  useStudioAssets,
} from '@/lib/workspace/hooks';

const REUSE_LABEL: Record<VisualReuse, string> = {
  preview_only: 'Preview only',
  link_only: 'Link only',
  permitted: 'Export permitted',
  illustrative: 'Illustrative',
};

const amount = (g: VisualGroupSummary) =>
  g.exportable ? `${g.exportable} file${g.exportable === 1 ? '' : 's'}` : g.links ? `${g.links} link${g.links === 1 ? '' : 's'}` : 'Nothing included';

/**
 * States what the download would contain before it is downloaded. The same readiness the ZIP
 * writes into manifest.json is computed here from the same domain rules, so the card cannot
 * promise a complete kit the file does not deliver.
 */
export function KitReadinessCard({
  business,
  entries,
  project,
  canExport,
  pending,
  onDownload,
}: {
  business: Business;
  entries: ResourceEntry[];
  project: StudioProject | null;
  canExport: boolean;
  pending: boolean;
  onDownload: () => Promise<boolean>;
}) {
  const socialSchema = useSocialResearchSchema();
  const vaultSchema = useAssetVaultSchema();
  const socialReady = socialSchema.data === true;
  const { data: socialSources = [] } = useSocialSources(business.id, socialReady);
  const { data: observations = [] } = useResearchObservations(business.id, socialReady);
  const { data: assets = [] } = useStudioAssets(project?.id, Boolean(project) && vaultSchema.data === true);
  const [open, setOpen] = useState(false);
  const readiness = kitReadiness({ business, resources: entries, socialSources, observations, assets, hasVault: Boolean(project) });
  const identity = IDENTITY_STANDING_META[readiness.identity.standing];

  async function runDownload() {
    if (await onDownload()) setOpen(false);
  }

  return (
    <Card data-testid="kit-readiness">
      <CardHeader
        title="Resource kit readiness"
        description="What this download would contain, and what it still lacks."
        actions={
          <>
            <Badge tone={readiness.tone} dot>
              {readiness.label}
            </Badge>
            {canExport && (
              <Button variant="primary" onClick={() => setOpen(true)} disabled={pending}>
                Download Website Resource Kit
              </Button>
            )}
          </>
        }
      />
      <CardBody className="space-y-5">
        <p className="text-sm text-subtle">{readiness.summary}</p>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ['Independent entries', readiness.counts.resources],
            ['Research observations', readiness.counts.observations],
            ['Social references', readiness.counts.socialReferences],
            ['Authorized files', readiness.counts.images],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border border-border px-3 py-2">
              <dt className="text-xs text-subtle">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="rounded border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Business identity</span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={identity.tone}>{identity.label}</Badge>
              {readiness.identity.standing !== 'verified' && <IdentifyBusiness business={business} />}
            </div>
          </div>
          <p className="mt-2 text-xs text-subtle">{readiness.identity.basis}</p>
          <p className="mt-1 text-xs text-subtle">{identity.description}</p>
        </div>

        <section className="space-y-2" aria-labelledby="visual-resources-heading">
          <div>
            <h3 id="visual-resources-heading" className="text-sm font-semibold">
              Visual resources
            </h3>
            <p className="text-xs text-subtle">Every kind of image this prospect could contribute, and what a kit may carry from it.</p>
          </div>
          <ul className="space-y-2">
            {readiness.visual.groups.map((g) => (
              <li key={g.key} className="rounded border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{g.label}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={g.tone}>{REUSE_LABEL[g.reuse]}</Badge>
                    <span className="text-xs text-subtle">{amount(g)}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-subtle">{g.description}</p>
                <p className="mt-1 text-xs">{g.rule}</p>
                {g.withheld > 0 && (
                  <p className="mt-1 text-xs text-warning">
                    {g.withheld} record{g.withheld === 1 ? '' : 's'} in this group {g.withheld === 1 ? 'is' : 'are'} withheld from the download.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Still missing</h3>
            {readiness.missing.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {readiness.missing.map((m) => (
                  <li key={m.key}>
                    <span className="font-medium">{m.label}</span>
                    <span className="text-subtle"> — {m.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-subtle">Nothing on the checklist is outstanding.</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold">Withheld by permission</h3>
            {readiness.permissionGaps.length ? (
              <ul className="mt-2 space-y-2 text-sm">
                {readiness.permissionGaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-subtle">Every recorded file and entry is export-eligible.</p>
            )}
          </div>
        </div>

        <Notice tone={readiness.studio.ready ? 'success' : 'neutral'} title="Website Studio handoff">
          {readiness.studio.reason}
        </Notice>

        <p className="text-xs text-subtle">
          Google listing content and photo previews are never included: only the Place ID is kept. Social references travel as links, never as images.
          Publication and contact permission are always separate decisions.
        </p>
      </CardBody>

      <DownloadDialog
        open={open}
        onOpenChange={setOpen}
        business={business}
        readiness={readiness}
        pending={pending}
        onConfirm={() => void runDownload()}
      />
    </Card>
  );
}

/** The pre-export review: what will be in the file, and what the download will not fix. */
function DownloadDialog({
  open,
  onOpenChange,
  business,
  readiness,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business: Business;
  readiness: KitReadiness;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Download Website Resource Kit"
      description={`${business.name} · ${readiness.label}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={onConfirm}>
            {readiness.complete ? 'Download complete kit' : 'Download incomplete kit'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {readiness.complete ? (
          <Notice tone="success" title="This kit is complete">
            A verified identity, independent observations and export-permitted files travel with it.
          </Notice>
        ) : (
          <Notice tone="warning" title="This download is incomplete">
            It is still worth taking: {readiness.missing.length} item{readiness.missing.length === 1 ? '' : 's'} on the checklist {readiness.missing.length === 1 ? 'is' : 'are'}{' '}
            outstanding. MISSING-RESOURCES.md and manifest.json both say the kit is not ready, so nobody mistakes it for a finished pack.
          </Notice>
        )}

        <div>
          <h4 className="font-medium">Included</h4>
          <ul className="mt-1 space-y-1 text-subtle">
            {RESOURCE_KIT_DOCUMENTS.map((name) => (
              <li key={name}>{name}</li>
            ))}
            <li>
              {readiness.counts.images ? `assets/ — ${readiness.counts.images} authorized file${readiness.counts.images === 1 ? '' : 's'}` : 'assets/ — no authorized file yet'}
            </li>
          </ul>
        </div>

        {readiness.missing.length > 0 && (
          <div>
            <h4 className="font-medium">Not in this kit</h4>
            <ul className="mt-1 space-y-1 text-subtle">
              {readiness.missing.map((m) => (
                <li key={m.key}>{m.label}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-subtle">
          Export is not publication permission. Review every file, claim and licence with the owner before anything goes live.
        </p>
      </div>
    </Dialog>
  );
}
