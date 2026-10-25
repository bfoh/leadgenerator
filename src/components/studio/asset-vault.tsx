'use client';

import { useQueryClient } from '@tanstack/react-query';
import { FileText, ImageIcon, Link2, PackageOpen, Plus, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import * as vault from '@/lib/data/studio-asset-services';
import {
  ASSET_KINDS,
  ASSET_KIND_META,
  ASSET_MIME_TYPES,
  ASSET_ORIGINS,
  ASSET_STATUSES,
  ASSET_STATUS_META,
  MAX_ASSET_BYTES,
  ORIGIN_META,
  PERMISSION_META,
  PERMISSION_STATES,
  PERMISSION_USES,
  REFERENCE_SOURCES,
  REFERENCE_SOURCE_META,
  REFERENCE_STATUS_META,
  assetApprovalProblems,
  assetExpired,
  assetExportProblems,
  checkAssetUpload,
  formatBytes,
  type AssetPermissionState,
  type DetectedAssetFile,
  type StudioAsset,
  type StudioAssetEvent,
  type StudioAssetKind,
  type StudioAssetOrigin,
  type StudioAssetReference,
} from '@/lib/domain/studio-assets';
import type { StudioProject } from '@/lib/domain/studio';
import { errorMessage, formatDate, formatDateTime, safeHref } from '@/lib/utils';
import { ApiError, api } from '@/lib/workspace/api';
import { useAction, useStudioAssetEvents, useStudioAssetReferences, useStudioAssets, useStudioSchema, useAssetVaultSchema } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';

const STATUS_FILTERS = ['all', ...ASSET_STATUSES] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const EMPTY_PERMISSIONS = {
  inspectPermission: 'granted' as AssetPermissionState,
  storePermission: 'granted' as AssetPermissionState,
  prototypePermission: 'granted' as AssetPermissionState,
  exportPermission: 'granted' as AssetPermissionState,
  // Publishing is never assumed: it needs its own decision, every time.
  publishPermission: 'denied' as AssetPermissionState,
};

/** A file read in the browser, ready for validation and storage. */
interface FileUpload {
  fileName: string;
  declaredType: string;
  bytes: Uint8Array;
}

interface UploadValues {
  kind: StudioAssetKind;
  origin: StudioAssetOrigin;
  ownerName: string;
  supplier: string;
  sourceUrl: string;
  licenceName: string;
  licenceReference: string;
  licenceExpiresOn: string;
  attributionRequired: boolean;
  attributionText: string;
  permissionEvidence: string;
  note: string;
  inspectPermission: AssetPermissionState;
  storePermission: AssetPermissionState;
  prototypePermission: AssetPermissionState;
  exportPermission: AssetPermissionState;
  publishPermission: AssetPermissionState;
}

function initialValues(ownerName: string): UploadValues {
  return {
    kind: 'logo',
    origin: 'client_supplied',
    ownerName,
    supplier: '',
    sourceUrl: '',
    licenceName: '',
    licenceReference: '',
    licenceExpiresOn: '',
    attributionRequired: false,
    attributionText: '',
    permissionEvidence: '',
    note: '',
    ...EMPTY_PERMISSIONS,
  };
}

/** A preview URL from private storage, revoked when the card unmounts. */
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

function AssetPreview({ asset }: { asset: StudioAsset }) {
  const url = useSignedUrl(asset);
  const isImage = asset.mimeType.startsWith('image/');
  return (
    <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Preview of ${asset.fileName}`} className="size-full object-contain" />
      ) : isImage ? (
        <ImageIcon className="size-7 text-subtle" aria-hidden />
      ) : (
        <FileText className="size-7 text-subtle" aria-hidden />
      )}
    </div>
  );
}

function PermissionTrail({ asset }: { asset: StudioAsset }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PERMISSION_USES.map((use) => (
        <Badge key={use.key} tone={PERMISSION_META[asset[use.key]].tone} title={`${use.label}: ${PERMISSION_META[asset[use.key]].label}`}>
          {use.label.split(' ')[0]} · {PERMISSION_META[asset[use.key]].label}
        </Badge>
      ))}
    </div>
  );
}

type DecisionMode = 'reject' | 'revoke' | 'note';

function downloadZip(zip: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(zip)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StudioAssetVault({
  project,
  editable,
  canDelete,
  canExport,
  businessName,
}: {
  project: StudioProject;
  editable: boolean;
  canDelete: boolean;
  canExport: boolean;
  businessName: string;
}) {
  const schema = useAssetVaultSchema();
  const studioSchema = useStudioSchema();
  const { can } = useWorkspace();
  const { data: assets = [], isLoading } = useStudioAssets(project.id);
  const { data: references = [] } = useStudioAssetReferences(project.id);
  const { data: events = [] } = useStudioAssetEvents(project.id);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<StudioAssetKind | ''>('');
  const [uploading, setUploading] = useState(false);
  const [decision, setDecision] = useState<{ asset: StudioAsset; mode: DecisionMode } | null>(null);
  const [replacing, setReplacing] = useState<StudioAsset | null>(null);
  const [deleting, setDeleting] = useState<StudioAsset | null>(null);
  const [referencing, setReferencing] = useState(false);
  const [declining, setDeclining] = useState<StudioAssetReference | null>(null);

  const approve = useAction((ctx, asset: StudioAsset) => vault.approveStudioAsset(ctx, project, asset, 'Approved for this concept.'), { success: 'Asset approved' });
  const reject = useAction((ctx, asset: StudioAsset, reason: string) => vault.rejectStudioAsset(ctx, project, asset, reason), { success: 'Asset rejected' });
  const revoke = useAction((ctx, asset: StudioAsset, reason: string) => vault.revokeStudioAsset(ctx, project, asset, reason), { success: 'Permission revoked' });
  const annotate = useAction((ctx, asset: StudioAsset, note: string) => vault.annotateStudioAsset(ctx, project, asset, note), { success: 'Note saved' });
  const replace = useAction((ctx, asset: StudioAsset, file: FileUpload, note: string) => vault.replaceStudioAsset(ctx, project, asset, file, note), { success: 'Asset replaced' });
  const remove = useAction((ctx, asset: StudioAsset) => vault.deleteStudioAsset(ctx, project, asset), { success: 'Asset deleted' });
  const decline = useAction((ctx, reference: StudioAssetReference, note: string) => vault.declineStudioAssetReference(ctx, project, reference, note), { success: 'Reference declined' });
  const exportPack = useAction((ctx) => vault.exportStudioAssetPack(ctx, project), {
    success: (result) => `Exported ${result.included} file${result.included === 1 ? '' : 's'}${result.excluded ? ` (${result.excluded} excluded)` : ''}`,
    onSuccess: (result) => downloadZip(result.zip, result.filename),
  });

  if (isLoading && schema.data !== false) return <PageSkeleton />;

  const rows = assets.filter((asset) => (status === 'all' || asset.status === status) && (!kind || asset.kind === kind));
  const approved = assets.filter((asset) => asset.status === 'approved').length;
  const waiting = assets.filter((asset) => asset.status === 'candidate').length;
  const expired = assets.filter((asset) => asset.status === 'approved' && assetExpired(asset)).length;
  const exportable = assets.filter((asset) => assetExportProblems(asset).length === 0).length;


  return (
    <>
      {schema.data === false && (
        <Notice tone="warning" title="Database migration required">
          Apply migration 013 (supabase/migrations/013_studio_asset_vault.sql) to use the asset vault, Brand Kit and approved exports. Until then this tab stays empty.
        </Notice>
      )}
      {studioSchema.data === false && (
        <Notice tone="warning" className="mt-3" title="Studio migration required">
          Migration 012 has not been applied, so there is no concept to attach assets to.
        </Notice>
      )}
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Asset vault
              <Badge tone="success">{approved} approved</Badge>
              {waiting > 0 && <Badge tone="warning">{waiting} waiting</Badge>}
              {expired > 0 && <Badge tone="danger">{expired} expired</Badge>}
            </span>
          }
          description="Files the business owns or has licensed, each with five separate permissions. Someone else’s imagery is recorded as a reference below and is never imported."
          actions={
            <div className="flex flex-wrap gap-2">
              {canExport && (
                <Button
                  size="sm"
                  loading={exportPack.pending}
                  disabled={!exportable}
                  title={exportable ? `Export ${exportable} approved file(s)` : 'No asset is approved with export permission and a current licence.'}
                  onClick={() => void exportPack.run()}
                >
                  <PackageOpen aria-hidden /> Export pack{exportable ? ` (${exportable})` : ''}
                </Button>
              )}
              {editable && (
                <Button size="sm" variant="primary" onClick={() => setUploading(true)}>
                  <Upload aria-hidden /> Add asset
                </Button>
              )}
            </div>
          }
        />
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="w-auto">
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All statuses' : ASSET_STATUS_META[value].label}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value as StudioAssetKind | '')} className="w-auto">
              <option value="">All kinds</option>
              {ASSET_KINDS.map((value) => (
                <option key={value} value={value}>
                  {ASSET_KIND_META[value].label}
                </option>
              ))}
            </Select>
            <span className="ml-auto text-xs text-subtle">
              {rows.length} of {assets.length} files
            </span>
          </div>
        </CardBody>
      </Card>

      {assets.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="No files in the vault yet"
            description="Upload the business’s logo, photography, brand documents or licensed imagery. Nothing can be used in a concept until a person approves it with the permission recorded."
            action={
              editable ? (
                <Button variant="primary" onClick={() => setUploading(true)}>
                  <Plus aria-hidden /> Add the first asset
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldAlert} title="No files with this status" description="Change the filters to see the rest of the vault." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              editable={editable}
              canDelete={canDelete || can('records.delete')}
              onApprove={() => void approve.run(asset)}
              onDecision={setDecision}
              onReplace={() => setReplacing(asset)}
              onDelete={() => setDeleting(asset)}
            />
          ))}
        </div>
      )}


      <References references={references} editable={editable} onAdd={() => setReferencing(true)} onDecline={setDeclining} />
      {events.length > 0 && <AssetHistory events={events} assets={assets} />}

      {uploading && <UploadDialog project={project} ownerName={businessName} onClose={() => setUploading(false)} />}
      {replacing && (
        <ReplaceDialog
          asset={replacing}
          pending={replace.pending}
          onClose={() => setReplacing(null)}
          onSubmit={async (file, note) => {
            const saved = await replace.run(replacing, file, note);
            if (saved) setReplacing(null);
          }}
        />
      )}
      {decision && (
        <TextDecisionDialog
          mode={decision.mode}
          asset={decision.asset}
          pending={reject.pending || revoke.pending || annotate.pending}
          onClose={() => setDecision(null)}
          onSubmit={async (text) => {
            const saved =
              decision.mode === 'reject'
                ? await reject.run(decision.asset, text)
                : decision.mode === 'revoke'
                  ? await revoke.run(decision.asset, text)
                  : await annotate.run(decision.asset, text);
            if (saved) setDecision(null);
          }}
        />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          size="sm"
          title={`Delete ${deleting.fileName}?`}
          description="The file, its stored bytes and its history are removed. Reject or revoke it instead to keep the record."
          footer={
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={remove.pending}
                onClick={async () => {
                  await remove.run(deleting);
                  setDeleting(null);
                }}
              >
                Delete permanently
              </Button>
            </>
          }
        >
          <p className="text-sm text-subtle">Anything that used this file must be replaced before the concept can be published.</p>
        </Dialog>
      )}
      {referencing && <ReferenceDialog project={project} onClose={() => setReferencing(false)} />}
      {declining && (
        <TextDecisionDialog
          mode="note"
          asset={null}
          reference={declining}
          pending={decline.pending}
          onClose={() => setDeclining(null)}
          onSubmit={async (text) => {
            const saved = await decline.run(declining, text);
            if (saved) setDeclining(null);
          }}
        />
      )}
    </>
  );
}


function AssetCard({
  asset,
  editable,
  canDelete,
  onApprove,
  onDecision,
  onReplace,
  onDelete,
}: {
  asset: StudioAsset;
  editable: boolean;
  canDelete: boolean;
  onApprove: () => void;
  onDecision: (target: { asset: StudioAsset; mode: DecisionMode }) => void;
  onReplace: () => void;
  onDelete: () => void;
}) {
  const { assets: storage } = useWorkspace();
  const blockers = assetApprovalProblems(asset);
  const expired = assetExpired(asset);

  async function open() {
    const url = await storage.signedUrl(asset.storagePath, 120);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else toast.error('The stored file could not be opened.');
  }

  return (
    <Card className="flex flex-col">
      <CardBody className="flex flex-1 flex-col gap-3">
        <AssetPreview asset={asset} />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={asset.fileName}>
              {asset.fileName}
            </p>
            <Badge tone={ASSET_STATUS_META[asset.status].tone}>{ASSET_STATUS_META[asset.status].label}</Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
            <span>{ASSET_KIND_META[asset.kind].label}</span>
            <span aria-hidden>·</span>
            <span>{formatBytes(asset.bytes)}</span>
            {asset.width && asset.height && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {asset.width}×{asset.height}
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatDate(asset.createdAt)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={ORIGIN_META[asset.origin].tone}>{ORIGIN_META[asset.origin].label}</Badge>
          {asset.licenceName && <Badge tone="neutral">{asset.licenceName}</Badge>}
          {asset.licenceExpiresOn && <Badge tone={expired ? 'danger' : 'neutral'}>Licence to {formatDate(asset.licenceExpiresOn)}</Badge>}
          {asset.attributionRequired && <Badge tone="warning">Attribution required</Badge>}
        </div>
        <PermissionTrail asset={asset} />
        {asset.note && <p className="text-xs text-muted">{asset.note}</p>}
        {asset.reviewNote && <p className="text-xs text-subtle">Review: {asset.reviewNote}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {editable && asset.status === 'candidate' && (
            <Button size="sm" variant="primary" disabled={blockers.length > 0} title={blockers[0]} onClick={onApprove}>
              Approve
            </Button>
          )}
          {editable && asset.status !== 'superseded' && (
            <Button size="sm" onClick={() => onDecision({ asset, mode: 'reject' })}>
              Reject
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="ghost" aria-label={`More actions for ${asset.fileName}`}>
                More
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => void open()}>Open file</MenuItem>
              <MenuItem onSelect={() => onDecision({ asset, mode: 'note' })} disabled={!editable}>
                Add a note
              </MenuItem>
              <MenuItem onSelect={onReplace} disabled={!editable || asset.status === 'superseded'}>
                Replace file
              </MenuItem>
              <MenuItem onSelect={() => onDecision({ asset, mode: 'revoke' })} disabled={!editable || asset.status !== 'approved'} danger>
                Revoke permission
              </MenuItem>
              <MenuItem onSelect={onDelete} disabled={!canDelete} danger>
                <span className="inline-flex items-center gap-2">
                  <Trash2 className="size-3.5" aria-hidden /> Delete asset
                </span>
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
        {asset.status === 'candidate' && blockers.length > 0 && <p className="text-xs text-warning">{blockers[0]}</p>}
        {asset.status === 'approved' && expired && <p className="text-xs text-danger">The licence has expired. Renew it or replace the file before export.</p>}
      </CardBody>
    </Card>
  );
}


function References({
  references,
  editable,
  onAdd,
  onDecline,
}: {
  references: StudioAssetReference[];
  editable: boolean;
  onAdd: () => void;
  onDecline: (reference: StudioAssetReference) => void;
}) {
  return (
    <Card>
      <CardHeader
        title="Remote references"
        description="Material that belongs to someone else. It is recorded so the direction can cite it, never downloaded, never shown inline and never included in a pack."
        actions={
          editable ? (
            <Button size="sm" onClick={onAdd}>
              <Link2 aria-hidden /> Record a reference
            </Button>
          ) : undefined
        }
      />
      <CardBody className={references.length ? 'p-0' : undefined}>
        {references.length === 0 ? (
          <p className="px-1 py-2 text-sm text-subtle">
            Nothing recorded. If the business points to a Google Maps photo, an Instagram post or a competitor’s page, record it here — the file itself must come from the business or its rights holder.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {references.map((reference) => {
              const href = safeHref(reference.address);
              return (
                <li key={reference.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{reference.label}</p>
                    {href && (
                      <a href={href} target="_blank" rel="noreferrer noopener" className="block truncate text-xs text-subtle hover:text-foreground hover:underline">
                        {href}
                      </a>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
                      <Badge tone="neutral">{REFERENCE_SOURCE_META[reference.source].label}</Badge>
                      <Badge tone={REFERENCE_STATUS_META[reference.status].tone}>{REFERENCE_STATUS_META[reference.status].label}</Badge>
                      <span>{formatDate(reference.createdAt)}</span>
                    </p>
                    {reference.note && <p className="mt-1 text-xs text-muted">{reference.note}</p>}
                  </div>
                  {editable && reference.status === 'recorded' && (
                    <Button size="sm" variant="ghost" onClick={() => onDecline(reference)}>
                      Decline
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

const EVENT_LABELS: Record<StudioAssetEvent['action'], string> = {
  uploaded: 'Added',
  annotated: 'Noted',
  approved: 'Approved',
  rejected: 'Rejected',
  revoked: 'Permission revoked',
  replaced: 'Replaced',
};

function AssetHistory({ events, assets }: { events: StudioAssetEvent[]; assets: StudioAsset[] }) {
  const names = new Map(assets.map((asset) => [asset.id, asset.fileName]));
  return (
    <Card>
      <CardHeader title="Approval history" description="Every decision about a file, newest first. History is never edited or removed." />
      <CardBody className="p-0">
        <ul className="divide-y divide-border">
          {events.slice(0, 12).map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <Badge tone={event.action === 'rejected' || event.action === 'revoked' ? 'danger' : event.action === 'approved' ? 'success' : 'neutral'}>
                {EVENT_LABELS[event.action]}
              </Badge>
              <span className="min-w-0 flex-1 truncate">
                {names.get(event.assetId) ?? 'Deleted asset'}
                {event.note ? ` — ${event.note}` : ''}
              </span>
              <span className="text-[11px] text-subtle">{formatDateTime(event.createdAt)}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}


function TextDecisionDialog({
  mode,
  asset,
  reference,
  pending,
  onClose,
  onSubmit,
}: {
  mode: DecisionMode;
  asset: StudioAsset | null;
  reference?: StudioAssetReference;
  pending: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const title = reference ? 'Decline this reference' : mode === 'reject' ? 'Reject this asset' : mode === 'revoke' ? 'Revoke permission' : 'Add a note';
  const subject = reference ? reference.label : (asset?.fileName ?? 'this asset');
  const label = reference ? 'Why (optional)' : mode === 'note' ? 'Note' : 'Why';
  const action = reference ? 'Decline reference' : mode === 'reject' ? 'Reject asset' : mode === 'revoke' ? 'Revoke permission' : 'Save note';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference && text.trim().length < 3) return setProblem('Write at least a few words, so the decision can be understood later.');
    setProblem(null);
    onSubmit(text.trim());
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={title}
      description={
        reference
          ? `“${subject}” stays in the ledger as declined. Nothing was downloaded.`
          : mode === 'revoke'
            ? `“${subject}” stays in the vault, but its export, publish and prototype permissions become denied. Anything using it must be replaced.`
            : mode === 'reject'
              ? `“${subject}” becomes unusable in this concept. The file and this reason stay in the history.`
              : `About “${subject}”. The note is kept with the asset and its history.`
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'reject' || mode === 'revoke' ? 'danger' : 'primary'} loading={pending} onClick={submit}>
            {action}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label={label} error={problem ?? undefined} hint={reference ? undefined : 'Visible to the team only.'}>
          {(props) => (
            <Textarea
              {...props}
              autoFocus
              rows={3}
              maxLength={1000}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (problem) setProblem(null);
              }}
              placeholder={mode === 'revoke' ? 'The licence was withdrawn by the photographer on 24 October.' : 'The logo is a low-resolution screenshot from Facebook.'}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function ReferenceDialog({ project, onClose }: { project: StudioProject; onClose: () => void }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<(typeof REFERENCE_SOURCES)[number]>('client_statement');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAction((ctx, input: { address: string; label: string; source: (typeof REFERENCE_SOURCES)[number]; note: string }) => vault.recordStudioAssetReference(ctx, project, input), {
    success: 'Reference recorded',
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https?:\/\//i.test(address.trim())) return setProblem('Enter the full address, starting with https://.');
    if (!label.trim()) return setProblem('Say what the reference shows.');
    setProblem(null);
    void add.run({ address: address.trim(), label: label.trim(), source, note: note.trim() }).then((saved) => {
      if (saved) onClose();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title="Record a remote reference"
      description="For material the business points to but does not own. The Studio never fetches, copies or displays it; to use the image, ask the business or the rights holder for the file and its permission."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={add.pending} onClick={submit}>
            Record reference
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Address" error={problem ?? undefined} required>
          {(props) => <Input {...props} autoFocus value={address} onChange={(e) => setAddress(e.target.value)} maxLength={2000} placeholder="https://maps.google.com/…" />}
        </Field>
        <Field label="What it shows" required>
          {(props) => <Input {...props} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} placeholder="Shopfront photograph on their Maps listing" />}
        </Field>
        <Field label="Where it came from">
          {(props) => (
            <Select {...props} value={source} onChange={(e) => setSource(e.target.value as (typeof REFERENCE_SOURCES)[number])}>
              {REFERENCE_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {REFERENCE_SOURCE_META[value].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Why it matters" hint={REFERENCE_SOURCE_META[source].description}>
          {(props) => <Textarea {...props} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}


const ASSET_MIME_TYPES_LIST = ASSET_MIME_TYPES.map((type) => type.mimeType).join(',');

function ReplaceDialog({ asset, pending, onClose, onSubmit }: { asset: StudioAsset; pending: boolean; onClose: () => void; onSubmit: (file: FileUpload, note: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(next: File | null) {
    setFile(next);
    setBytes(null);
    setProblem(null);
    if (!next) return;
    const read = new Uint8Array(await next.arrayBuffer());
    const check = checkAssetUpload({ fileName: next.name, declaredType: next.type, bytes: read });
    if (!check.ok) return setProblem(check.problems[0]);
    if (check.file && !ASSET_KIND_META[asset.kind].fileClasses.includes(check.file.fileClass)) {
      return setProblem(`A ${ASSET_KIND_META[asset.kind].label.toLowerCase()} must stay the same kind of file.`);
    }
    setBytes(read);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !bytes) return setProblem('Choose the replacement file.');
    onSubmit({ fileName: file.name, declaredType: file.type || 'application/octet-stream', bytes }, note);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={`Replace ${asset.fileName}`}
      description="The new file starts as a candidate with the same provenance and permissions until someone reviews it. The old file stays as history."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Replace file
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Replacement file" error={problem ?? undefined} required>
          {(props) => <Input {...props} type="file" accept={ASSET_MIME_TYPES_LIST} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />}
        </Field>
        <Field label="Why it is being replaced">
          {(props) => (
            <Textarea {...props} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="The business supplied a larger export of the same logo." />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function UploadDialog({ project, ownerName, onClose }: { project: StudioProject; ownerName: string; onClose: () => void }) {
  const { store } = useWorkspace();
  const qc = useQueryClient();
  const [values, setValues] = useState<UploadValues>(() => initialValues(ownerName));
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [detected, setDetected] = useState<DetectedAssetFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const upload = useAction((ctx, input: vault.AssetUploadInput) => vault.uploadStudioAsset(ctx, project, input), { success: 'Asset added' });
  const set = <K extends keyof UploadValues>(key: K, value: UploadValues[K]) => setValues((current) => ({ ...current, [key]: value }));

  async function choose(next: File | null) {
    setFile(next);
    setBytes(null);
    setDetected(null);
    setProblem(null);
    if (!next) return;
    if (next.size > MAX_ASSET_BYTES) return setProblem(`The file is ${formatBytes(next.size)}; the limit is ${formatBytes(MAX_ASSET_BYTES)}.`);
    const read = new Uint8Array(await next.arrayBuffer());
    const check = checkAssetUpload({ fileName: next.name, declaredType: next.type, bytes: read });
    if (!check.ok || !check.file) return setProblem(check.problems[0] ?? 'The file could not be validated.');
    setBytes(read);
    setDetected(check.file);
    if (!ASSET_KIND_META[values.kind].fileClasses.includes(check.file.fileClass)) {
      const kind = ASSET_KINDS.find((candidate) => ASSET_KIND_META[candidate].fileClasses.includes(check.file!.fileClass)) ?? 'other';
      set('kind', kind);
    }
  }

  function validate(): string | null {
    if (!file || !bytes || !detected) return 'Choose a file first.';
    if (values.ownerName.trim().length < 2) return 'Say who owns or supplied the rights.';
    if (values.permissionEvidence.trim().length < 10) return 'Record the evidence behind the permission: an email reference, agreement or order number.';
    if (values.origin === 'licensed' && !values.licenceName.trim()) return 'Name the licence this file is used under.';
    if (values.attributionRequired && !values.attributionText.trim()) return 'Write the attribution line, or turn the requirement off.';
    if (values.licenceExpiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(values.licenceExpiresOn)) return 'Write the licence expiry as YYYY-MM-DD.';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validate();
    if (invalid) return setProblem(invalid);
    if (!file || !bytes) return;
    setProblem(null);
    setPending(true);
    const input = {
      ...values,
      supplier: values.supplier || null,
      sourceUrl: values.sourceUrl || null,
      licenceName: values.licenceName || null,
      licenceReference: values.licenceReference || null,
      licenceExpiresOn: values.licenceExpiresOn || null,
      attributionText: values.attributionText || null,
      fileName: file.name,
      declaredType: file.type || 'application/octet-stream',
      bytes,
    };
    try {
      if (store.mode === 'demo') {
        const saved = await upload.run(input);
        if (saved) onClose();
      } else {
        const form = new FormData();
        form.set('file', file);
        form.set('metadata', JSON.stringify({ ...input, projectId: project.id, bytes: undefined, fileName: undefined, declaredType: undefined }));
        await api.postForm('/api/studio/assets', form);
        await qc.invalidateQueries();
        toast.success('Asset added');
        onClose();
      }
    } catch (error) {
      setProblem(error instanceof ApiError && error.status ? error.message : errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Add an asset"
      description="Only a file the business owns or has licensed belongs here. Uploading records where it came from, the licence, and what we may do with it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending || upload.pending} onClick={submit}>
            Add to vault
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {problem && <FormError message={problem} />}


        <Field label="File" hint={`PNG, JPEG, WebP, GIF, PDF, plain text, MP4, WOFF, WOFF2, TTF or OTF · up to ${formatBytes(MAX_ASSET_BYTES)}`} required>
          {(props) => <Input {...props} type="file" accept={ASSET_MIME_TYPES_LIST} onChange={(e) => void choose(e.target.files?.[0] ?? null)} />}
        </Field>
        {detected && (
          <p className="text-xs text-success">
            {detected.mimeType} · {detected.width ? `${detected.width}×${detected.height}` : 'no dimensions'} · {formatBytes(bytes?.length ?? 0)}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What it is">
            {(props) => (
              <Select {...props} value={values.kind} onChange={(e) => set('kind', e.target.value as StudioAssetKind)}>
                {ASSET_KINDS.filter((kind) => !detected || ASSET_KIND_META[kind].fileClasses.includes(detected.fileClass)).map((kind) => (
                  <option key={kind} value={kind}>
                    {ASSET_KIND_META[kind].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Where it came from">
            {(props) => (
              <Select {...props} value={values.origin} onChange={(e) => set('origin', e.target.value as StudioAssetOrigin)}>
                {ASSET_ORIGINS.map((origin) => (
                  <option key={origin} value={origin}>
                    {ORIGIN_META[origin].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rights holder" hint="Who owns it, or who supplied it on the owner’s behalf." required>
            {(props) => <Input {...props} value={values.ownerName} onChange={(e) => set('ownerName', e.target.value)} maxLength={200} />}
          </Field>
          <Field label="Supplier" hint="The photographer, agency or person who sent the file.">
            {(props) => <Input {...props} value={values.supplier} onChange={(e) => set('supplier', e.target.value)} maxLength={200} />}
          </Field>
          <Field label="Source address" hint="Only where the file was legitimately obtained.">
            {(props) => <Input {...props} value={values.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} maxLength={2000} placeholder="https://…" />}
          </Field>
          <Field label="Licence" hint="The agreement or marketplace licence, if there is one.">
            {(props) => <Input {...props} value={values.licenceName} onChange={(e) => set('licenceName', e.target.value)} maxLength={200} placeholder="SIL Open Font License 1.1" />}
          </Field>
          <Field label="Licence reference">
            {(props) => <Input {...props} value={values.licenceReference} onChange={(e) => set('licenceReference', e.target.value)} maxLength={500} placeholder="Order 4821 / agreement dated 12 Sep 2026" />}
          </Field>
          <Field label="Licence expires">
            {(props) => <Input {...props} type="date" value={values.licenceExpiresOn} onChange={(e) => set('licenceExpiresOn', e.target.value)} />}
          </Field>
        </div>
        <Field label="Permission evidence" hint="What a regulator or the client could ask to see: an email reference, signed note or order number." required>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={1000}
              value={values.permissionEvidence}
              onChange={(e) => set('permissionEvidence', e.target.value)}
              placeholder="Email from the owner, 21 Oct 2026: “These are our own photographs, use them on the new site.”"
            />
          )}
        </Field>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">What may we do with it?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PERMISSION_USES.map((use) => (
              <Field key={use.key} label={use.label} hint={use.question}>
                {(props) => (
                  <Select {...props} value={values[use.key]} onChange={(e) => set(use.key, e.target.value as AssetPermissionState)}>
                    {PERMISSION_STATES.map((state) => (
                      <option key={state} value={state}>
                        {PERMISSION_META[state].label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </div>
        </fieldset>
        <Checkbox
          label="Attribution is required"
          description="The licence asks for a credit wherever the file appears."
          checked={values.attributionRequired}
          onChange={(e) => set('attributionRequired', e.target.checked)}
        />
        {values.attributionRequired && (
          <Field label="Attribution line" required>
            {(props) => (
              <Input
                {...props}
                value={values.attributionText}
                onChange={(e) => set('attributionText', e.target.value)}
                maxLength={400}
                placeholder="Photograph © Ama Mensah, used with permission."
              />
            )}
          </Field>
        )}
        <Field label="Note for the team">
          {(props) => <Textarea {...props} rows={2} maxLength={2000} value={values.note} onChange={(e) => set('note', e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

