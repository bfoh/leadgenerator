'use client';
/* eslint-disable @next/next/no-img-element -- A transient same-origin preview of the business's own site and private-storage previews must not be optimized or cached. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';
import { attachAuthorizedVisualOriginal, approveVisualCandidates, discoverVisualCandidates, importVisualCandidate, rejectVisualCandidate, requestVisualAuthorization } from '@/lib/data/visual-acquisition-services';
import { websiteResourceCandidates, type WebsiteResources } from '@/lib/domain/business-resources';
import type { StudioProject } from '@/lib/domain/studio';
import type { StudioAsset } from '@/lib/domain/studio-assets';
import type { Business } from '@/lib/domain/types';
import {
  EXPORT_STATE_META,
  IMAGE_TYPE_META,
  RIGHTS_BASIS_META,
  VISUAL_RIGHTS_BASES,
  candidateReadyToApprove,
  visualAcquisitionSummary,
  visualCandidateExportState,
  visualRequirementStatus,
  visualRequirementsFor,
  type VisualCandidate,
  type VisualImportRequest,
  type VisualRequirementStatus,
} from '@/lib/domain/visual-acquisition';
import { formatBytes } from '@/lib/domain/studio-assets';
import { errorMessage } from '@/lib/utils';
import { api } from '@/lib/workspace/api';
import { useAction, useStudioAssets, useVisualAcquisitionSchema, useVisualCandidates } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';

function useSignedUrl(asset: StudioAsset | null): string | null {
  const { assets: storage } = useWorkspace();
  const [signed, setSigned] = useState<{ path: string; url: string } | null>(null);
  const created = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!asset || !asset.mimeType.startsWith('image/')) return;
    const path = asset.storagePath;
    void storage.signedUrl(path).then((url) => {
      if (!active || !url) return;
      if (created.current && created.current !== url) URL.revokeObjectURL(created.current);
      created.current = url.startsWith('blob:') ? url : null;
      setSigned({ path, url });
    });
    return () => {
      active = false;
      if (created.current) URL.revokeObjectURL(created.current);
      created.current = null;
    };
  }, [asset, storage]);
  return signed && asset && signed.path === asset.storagePath ? signed.url : null;
}

function CandidatePreview({ candidate, asset, website }: { candidate: VisualCandidate; asset: StudioAsset | null; website: string | null }) {
  const stored = useSignedUrl(asset);
  const remote =
    candidate.status === 'reference_only' && candidate.sourceKind === 'official_site' && website
      ? `/api/resources/preview?url=${encodeURIComponent(candidate.imageUrl)}&website=${encodeURIComponent(website)}`
      : null;
  const src = stored ?? remote;
  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
      {src ? (
        <img src={src} alt={`Preview of ${candidate.label}`} className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <p className="px-3 text-center text-xs text-subtle">
          {candidate.status === 'rejected' ? 'Rejected' : 'Preview withheld'} — no permission to copy this file
        </p>
      )}
    </div>
  );
}

function CandidateCard({
  candidate,
  asset,
  website,
  busy,
  selected,
  onSelect,
  onAuthorize,
  onRequest,
  onReject,
  onApprove,
}: {
  candidate: VisualCandidate;
  asset: StudioAsset | null;
  website: string | null;
  busy: boolean;
  selected: boolean;
  onSelect: (value: boolean) => void;
  onAuthorize: () => void;
  onRequest: () => void;
  onReject: () => void;
  onApprove: () => void;
}) {
  const type = IMAGE_TYPE_META[candidate.imageType];
  const state = visualCandidateExportState(candidate, asset);
  const exportMeta = EXPORT_STATE_META[state];
  const rights = RIGHTS_BASIS_META[candidate.rightsBasis];
  const approvable = candidate.status === 'imported' && candidateReadyToApprove(candidate, asset).length === 0;
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <CandidatePreview candidate={candidate} asset={asset} website={website} />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={candidate.label}>{candidate.label}</p>
              <p className="text-xs text-subtle">{type.label} · {candidate.sourceKind === 'official_site' ? 'On the business’s own site' : 'Third-party reference'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone={type.tone}>{type.label}</Badge>
              <Badge tone={exportMeta.tone}>{exportMeta.label}</Badge>
            </div>
          </div>
          <p className="break-all text-xs">
            <a href={candidate.imageUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
              Open the source file ↗
            </a>
          </p>
          {candidate.attribution && <p className="text-xs text-subtle">Credit on the page: {candidate.attribution}</p>}
          <p className="text-xs text-muted">{candidate.relevance}</p>
          <p className="text-xs">
            <Badge tone={rights.tone}>{rights.label}</Badge>{' '}
            <span className="text-subtle">{rights.description}</span>
          </p>
          {candidate.rightsEvidence && <p className="text-xs text-subtle">Rights evidence: {candidate.rightsEvidence}</p>}
          {candidate.requestedAt && <p className="text-xs text-warning">Authorization requested: {candidate.requestNote}</p>}
          {candidate.reviewNote && <p className="text-xs text-subtle">Review: {candidate.reviewNote}</p>}
          {asset && (
            <p className="text-xs text-subtle">
              Vault file: {asset.fileName} · {formatBytes(asset.bytes)} · {asset.status}
              {candidate.importedVia === 'uploaded' ? ' · uploaded original' : candidate.importedVia === 'downloaded' ? ' · copied from the verified site' : ''}
            </p>
          )}
          {!approvable && candidate.status === 'imported' && candidateReadyToApprove(candidate, asset).length > 0 && (
            <p className="text-xs text-warning">{candidateReadyToApprove(candidate, asset)[0]}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {candidate.status === 'reference_only' && (
              <>
                <Button size="sm" variant="primary" disabled={busy} onClick={onAuthorize}>
                  {candidate.sourceKind === 'official_site' ? 'Authorize and import' : 'Upload authorized original'}
                </Button>
                <Button size="sm" disabled={busy} onClick={onRequest}>Request authorization</Button>
              </>
            )}
            {candidate.status === 'imported' && approvable && (
              <>
                <Checkbox label={`Select ${candidate.label}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
                <Button size="sm" variant="primary" disabled={busy} onClick={onApprove}>Approve</Button>
              </>
            )}
            {candidate.status !== 'rejected' && <Button size="sm" disabled={busy} onClick={onReject}>Reject</Button>}
          </div>
        </div>
      </div>
    </li>
  );
}

function Requirements({ requirements }: { requirements: VisualRequirementStatus[] }) {
  return (
    <div className="rounded border border-border p-3">
      <h3 className="text-sm font-semibold">What this business still needs</h3>
      <p className="mt-1 text-xs text-subtle">Based on its category. Only an approved, export-cleared file satisfies a requirement.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {requirements.map((r) => (
          <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2">
            <span>{r.label}{r.met ? '' : <span className="text-xs text-subtle"> — {r.detail}</span>}</span>
            <Badge tone={r.met ? 'success' : r.matched ? 'warning' : 'neutral'}>
              {r.met ? 'Ready for the kit' : r.matched ? `${r.matched} in the vault, not exportable` : 'Missing'}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuthorizeDialog({
  candidate,
  business,
  project,
  onClose,
}: {
  candidate: VisualCandidate;
  business: Business;
  project: StudioProject;
  onClose: () => void;
}) {
  const [basis, setBasis] = useState<(typeof VISUAL_RIGHTS_BASES)[number]>(
    candidate.sourceKind === 'official_site' ? 'business_owned_website' : 'written_permission',
  );
  const [evidence, setEvidence] = useState('');
  const [ownership, setOwnership] = useState(false);
  const [exportAuthorized, setExportAuthorized] = useState(true);
  const [licenceName, setLicenceName] = useState('');
  const [licenceReference, setLicenceReference] = useState('');
  const [licenceExpiresOn, setLicenceExpiresOn] = useState('');
  const [attributionRequired, setAttributionRequired] = useState(false);
  const [attributionText, setAttributionText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  function request(): VisualImportRequest {
    return {
      rightsBasis: basis,
      evidence: evidence.trim(),
      businessOwnershipConfirmed: ownership,
      exportAuthorized,
      licenceName,
      licenceReference,
      licenceExpiresOn,
      attributionRequired,
      attributionText,
    };
  }
  const importCopy = useAction((ctx, original: { bytes: Uint8Array; fileName: string; mimeType: string; finalUrl: string }) =>
    importVisualCandidate(ctx, business, project, candidate, request(), original), { success: 'Stored in the vault — approve it before it can be exported' });
  const uploadCopy = useAction((ctx, upload: { fileName: string; declaredType: string; bytes: Uint8Array }) =>
    attachAuthorizedVisualOriginal(ctx, business, project, candidate, request(), upload), { success: 'Authorized original stored in the vault' });

  async function submit() {
    setProblem(null);
    if (evidence.trim().length < 15) return setProblem('Record the evidence behind the rights decision (who confirmed it, when, and what it permits).');
    if (basis === 'business_owned_website' && !ownership) return setProblem('Confirm that the verified homepage is the business’s own website.');
    if (basis === 'licensed_stock' && !licenceName.trim()) return setProblem('Name the licence that covers this file.');
    if (candidate.sourceKind === 'third_party_reference' && !file) return setProblem('Choose the authorized original file supplied by its owner.');
    setPending(true);
    try {
      if (candidate.sourceKind === 'official_site') {
        const result = await api.post<{ base64: string; fileName: string; mimeType: string; finalUrl: string }>('/api/resources/candidates/original', {
          sourceUrl: candidate.imageUrl,
          pageUrl: candidate.pageUrl,
          businessWebsite: business.officialWebsite,
          permissionEvidence: evidence.trim(),
          confirmed: true,
        });
        const bytes = Uint8Array.from(atob(result.base64), (v) => v.charCodeAt(0));
        const saved = await importCopy.run({ bytes, fileName: result.fileName, mimeType: result.mimeType, finalUrl: result.finalUrl });
        if (saved) onClose();
      } else {
        const bytes = new Uint8Array(await file!.arrayBuffer());
        const saved = await uploadCopy.run({ fileName: file!.name, declaredType: file!.type, bytes });
        if (saved) onClose();
      }
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setPending(false);
    }
  }


  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title={`Authorize “${candidate.label}”`}
      description="A page showing an image is not a licence. Record why this file may be kept, and decide export separately."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending || importCopy.pending || uploadCopy.pending} onClick={() => void submit()}>
            {candidate.sourceKind === 'official_site' ? 'Read and store a copy' : 'Store the authorized original'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && <FormError message={problem} />}
        <p className="break-all text-xs text-subtle">Source: {candidate.imageUrl}</p>
        <Field label="Rights basis" hint="Choose what actually permits this copy. “Not established” keeps it a reference." required>
          {(p) => (
            <Select {...p} value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
              {VISUAL_RIGHTS_BASES.filter((value) => value !== 'not_established').map((value) => (
                <option key={value} value={value}>{RIGHTS_BASIS_META[value].label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Rights evidence" hint="Who confirmed it, when, and what it permits. This appears in the kit manifest." required>
          {(p) => <Textarea {...p} value={evidence} maxLength={1000} onChange={(e) => setEvidence(e.target.value)} />}
        </Field>
        {basis === 'business_owned_website' && (
          <Checkbox
            label="I confirmed this file is published on the business’s own verified website"
            checked={ownership}
            onChange={(e) => setOwnership(e.target.checked)}
          />
        )}
        {basis === 'licensed_stock' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Licence name" required>{(p) => <Input {...p} value={licenceName} maxLength={200} onChange={(e) => setLicenceName(e.target.value)} />}</Field>
            <Field label="Licence reference">{(p) => <Input {...p} value={licenceReference} maxLength={500} onChange={(e) => setLicenceReference(e.target.value)} />}</Field>
            <Field label="Expires on">{(p) => <Input {...p} type="date" value={licenceExpiresOn} onChange={(e) => setLicenceExpiresOn(e.target.value)} />}</Field>
          </div>
        )}
        <Checkbox label="Attribution is required where this is published" checked={attributionRequired} onChange={(e) => setAttributionRequired(e.target.checked)} />
        {attributionRequired && (
          <Field label="Attribution text" required>{(p) => <Input {...p} value={attributionText} maxLength={400} onChange={(e) => setAttributionText(e.target.value)} />}</Field>
        )}
        <Checkbox
          label="The recorded evidence grants export rights (the kit may carry this file)"
          checked={exportAuthorized}
          onChange={(e) => setExportAuthorized(e.target.checked)}
        />
        <p className="text-xs text-subtle">Publication on a live site is never granted here. Storing a copy does not approve it: it still needs review.</p>
        {candidate.sourceKind === 'third_party_reference' && (
          <Field label="Authorized original from the rights holder" hint="This file is served by a third party, so it is never downloaded. Upload the version its owner supplied." required>
            {(p) => <Input {...p} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function NoteDialog({
  title,
  description,
  label,
  pending,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  label: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={note.trim().length < 5} onClick={() => onSubmit(note.trim())}>Save</Button>
        </>
      }
    >
      <Field label={label} required>{(p) => <Textarea {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Dialog>
  );
}

/**
 * The visual acquisition queue. It shows every candidate the verified homepage published, what the
 * rights position actually is, and what the kit would carry — and it never copies a file before a
 * person has recorded why they may.
 */
export function VisualAssetPanel({
  business,
  project,
  reading,
  ensureProject,
}: {
  business: Business;
  project: StudioProject | null;
  reading: WebsiteResources | null;
  ensureProject: () => Promise<StudioProject | null>;
}) {
  const schema = useVisualAcquisitionSchema();
  const available = schema.data === true;
  const { data: candidates = [] } = useVisualCandidates(business.id, available);
  const { data: assets = [] } = useStudioAssets(project?.id, Boolean(project));
  const [selected, setSelected] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<{ imageUrl: string; reason: string }[]>([]);
  const [authorizing, setAuthorizing] = useState<VisualCandidate | null>(null);
  const [requesting, setRequesting] = useState<VisualCandidate | null>(null);
  const [rejecting, setRejecting] = useState<VisualCandidate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const assetById = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const summary = visualAcquisitionSummary(candidates, assets);
  const requirements = visualRequirementStatus(visualRequirementsFor(business.category), assets);
  const drafts = useMemo(
    () => (reading?.facts ? websiteResourceCandidates(reading).filter((v) => v.kind !== 'favicon').map((v) => ({ imageUrl: v.url, label: v.label, alt: v.label })) : []),
    [reading],
  );

  const discover = useAction(
    async (ctx, list: { imageUrl: string; label: string; alt: string }[]) => {
      const target = project ?? (await ensureProject());
      if (!target) throw new Error('Open the vault before collecting images.');
      if (!reading) throw new Error('Analyze the official website first.');
      return discoverVisualCandidates(ctx, business, target, reading.url, list);
    },
    { success: (result) => `${result.created.length} image${result.created.length === 1 ? '' : 's'} recorded for review` },
  );
  const approve = useAction((ctx, list: VisualCandidate[]) => approveVisualCandidates(ctx, business, project!, list), {
    success: (result) => (result.approved.length ? `Approved ${result.approved.length}${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}` : result.skipped[0]?.reason ?? 'Nothing was approved'),
    onSuccess: () => setSelected([]),
  });
  const request = useAction((ctx, candidate: VisualCandidate, note: string) => requestVisualAuthorization(ctx, candidate, note), {
    success: 'Authorization request recorded',
    onSuccess: () => setRequesting(null),
  });
  const reject = useAction((ctx, candidate: VisualCandidate, reason: string) => rejectVisualCandidate(ctx, business, project!, candidate, reason), {
    success: 'Candidate rejected and excluded from the kit',
    onSuccess: () => setRejecting(null),
  });

  async function find() {
    setProblem(null);
    setSkipped([]);
    try {
      const result = await discover.run(drafts);
      if (result) setSkipped(result.skipped);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  }

  const awaitingRights = candidates.filter((c) => c.status === 'reference_only');
  const inVault = candidates.filter((c) => c.status === 'imported');
  const rejected = candidates.filter((c) => c.status === 'rejected');
  const selectable = inVault.filter((c) => candidateReadyToApprove(c, c.assetId ? assetById.get(c.assetId) : null).length === 0);
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.includes(c.id));

  return (
    <Card data-testid="visual-assets">
      <CardHeader
        title="Visual assets"
        description="Logos and photographs the business publishes, with the rights decision for each. A reference is not a licence, and only an approved, export-cleared file enters the kit’s assets/ folder."
        actions={
          <Button variant="primary" onClick={() => void find()} loading={discover.pending} disabled={!available || !drafts.length || !business.officialWebsite}>
            Find visual assets
          </Button>
        }
      />
      <CardBody className="space-y-5">
        {!available && schema.isFetched && (
          <Notice title="Visual acquisition needs a database update" tone="warning">
            Apply migration 020 (visual asset acquisition) to record candidates and rights decisions. The existing vault and kit keep working without it.
          </Notice>
        )}
        {!business.officialWebsite && (
          <Notice title="Official website still unknown" tone="info">
            Confirm the business’s own website first. Off-site and social images stay references: ask the owner for the originals.
          </Notice>
        )}
        {!reading && business.officialWebsite && (
          <p className="text-sm text-subtle">Analyze the official website above, then find its logo and photographs here.</p>
        )}
        <FormError message={problem} />
        {skipped.length > 0 && (
          <div className="rounded border border-border p-3 text-sm">
            <p className="font-medium">{skipped.length} reference{skipped.length === 1 ? '' : 's'} not recorded</p>
            <ul className="mt-1 space-y-1 text-xs text-subtle">
              {skipped.slice(0, 6).map((s) => <li key={s.imageUrl} className="break-all">{s.reason} — {s.imageUrl}</li>)}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Reference only', summary.referenceOnly],
            ['In the vault', summary.imported],
            ['Export-ready', summary.exportable],
            ['Awaiting approval', summary.awaitingReview],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border border-border px-3 py-2">
              <p className="text-xs text-subtle">{label}</p>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>

        <Requirements requirements={requirements} />


        <section className="space-y-2" aria-labelledby="visual-awaiting-rights">
          <div>
            <h3 id="visual-awaiting-rights" className="text-sm font-semibold">Awaiting a rights decision ({awaitingRights.length})</h3>
            <p className="text-xs text-subtle">Nothing here has been copied. Authorize a file, ask its owner, or reject it.</p>
          </div>
          {awaitingRights.length ? (
            <ul className="space-y-3">
              {awaitingRights.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  asset={null}
                  website={business.officialWebsite}
                  busy={reject.pending}
                  selected={selected.includes(candidate.id)}
                  onSelect={() => undefined}
                  onAuthorize={() => setAuthorizing(candidate)}
                  onRequest={() => setRequesting(candidate)}
                  onReject={() => setRejecting(candidate)}
                  onApprove={() => undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">No reference-only candidates. Find visual assets after reading the official website.</p>
          )}
        </section>

        <section className="space-y-2" aria-labelledby="visual-in-vault">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="visual-in-vault" className="text-sm font-semibold">Approval queue ({inVault.length})</h3>
              <p className="text-xs text-subtle">Stored copies. Approving one adds it to the next kit only if its export permission is recorded.</p>
            </div>
            {selectable.length > 0 && project && (
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  label={`Select all ${selectable.length} awaiting review`}
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? selectable.map((c) => c.id) : [])}
                />
                <Button
                  size="sm"
                  variant="primary"
                  loading={approve.pending}
                  disabled={!selected.length}
                  onClick={() => void approve.run(candidates.filter((c) => selected.includes(c.id)))}
                >
                  Approve selected ({selected.length})
                </Button>
              </div>
            )}
          </div>
          {inVault.length ? (
            <ul className="space-y-3">
              {inVault.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  asset={candidate.assetId ? assetById.get(candidate.assetId) ?? null : null}
                  website={business.officialWebsite}
                  busy={approve.pending || reject.pending}
                  selected={selected.includes(candidate.id)}
                  onSelect={(value: boolean) => setSelected((current) => (value ? [...new Set([...current, candidate.id])] : current.filter((id) => id !== candidate.id)))}
                  onAuthorize={() => undefined}
                  onRequest={() => setRequesting(candidate)}
                  onReject={() => setRejecting(candidate)}
                  onApprove={() => void approve.run([candidate])}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle">Nothing stored yet. Authorized copies appear here for approval.</p>
          )}
        </section>

        {rejected.length > 0 && (
          <details className="rounded border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Rejected ({rejected.length})</summary>
            <ul className="mt-3 space-y-3">
              {rejected.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  asset={candidate.assetId ? assetById.get(candidate.assetId) ?? null : null}
                  website={business.officialWebsite}
                  busy
                  selected={false}
                  onSelect={() => undefined}
                  onAuthorize={() => undefined}
                  onRequest={() => undefined}
                  onReject={() => undefined}
                  onApprove={() => undefined}
                />
              ))}
            </ul>
          </details>
        )}
      </CardBody>

      {authorizing && project && <AuthorizeDialog candidate={authorizing} business={business} project={project} onClose={() => setAuthorizing(null)} />}
      {requesting && (
        <NoteDialog
          title={`Request authorization for “${requesting.label}”`}
          description="Record who was asked, when and how. The candidate stays a reference until permission arrives."
          label="Authorization request note"
          pending={request.pending}
          onClose={() => setRequesting(null)}
          onSubmit={(note) => void request.run(requesting, note)}
        />
      )}
      {rejecting && (
        <NoteDialog
          title={`Reject “${rejecting.label}”`}
          description="A rejected image is excluded from the queue and the kit. The reason stays on the record."
          label="Why this image cannot be used"
          pending={reject.pending}
          onClose={() => setRejecting(null)}
          onSubmit={(reason) => void reject.run(rejecting, reason)}
        />
      )}
    </Card>
  );
}

