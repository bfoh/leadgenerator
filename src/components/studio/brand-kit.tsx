'use client';

import { Check, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import * as vault from '@/lib/data/studio-asset-services';
import {
  ASSET_KIND_META,
  brandKitProblems,
  brandKitSummary,
  currentBrandKitApproval,
  emptyBrandKitContent,
  latestBrandKitVersion,
  type BrandKitContent,
  type StudioBrandKitApproval,
  type StudioBrandKitVersion,
} from '@/lib/domain/studio-assets';
import type { StudioProject } from '@/lib/domain/studio';
import { formatDateTime } from '@/lib/utils';
import { useAction, useAssetVaultSchema, useStudioAssets, useStudioBrandKit } from '@/lib/workspace/hooks';

const IMAGE_KINDS = ['product_photo', 'venue_photo', 'licensed_image', 'illustration', 'other'];
const toggle = (values: string[], id: string) => (values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
const lines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);
const commaList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
const replaceAt = <T,>(values: T[], index: number, value: T): T[] => values.map((item, i) => (i === index ? value : item));
const approvalOf = (versionId: string, approvals: StudioBrandKitApproval[]) => approvals.find((approval) => approval.versionId === versionId);

/** The Brand Kit the later design phases build from: structured, versioned and approved by a person. */
export function StudioBrandKitPanel({ project, editable }: { project: StudioProject; editable: boolean }) {
  const schema = useAssetVaultSchema();
  const { data: assets = [], isLoading: assetsLoading } = useStudioAssets(project.id);
  const { data, isLoading } = useStudioBrandKit(project.id);
  const [edited, setEdited] = useState<{ versionId: string | null; content: BrandKitContent } | null>(null);
  const [approving, setApproving] = useState<StudioBrandKitVersion | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = useAction((ctx, content: BrandKitContent, note: string) => vault.saveBrandKitVersion(ctx, project, content, note), { success: 'Brand Kit version saved' });
  const approve = useAction((ctx, version: StudioBrandKitVersion, note: string) => vault.approveBrandKitVersion(ctx, project, version, note), { success: 'Brand Kit version approved' });

  if ((isLoading || assetsLoading) && schema.data !== false) return <PageSkeleton />;
  if (schema.data === false) {
    return (
      <Notice tone="warning" title="Database migration required">
        Apply migration 013 (supabase/migrations/013_studio_asset_vault.sql) to use the Brand Kit.
      </Notice>
    );
  }

  const versions = data?.versions ?? [];
  const approvals = data?.approvals ?? [];
  const approvedVersionId = currentBrandKitApproval(approvals)?.versionId ?? null;
  const approvedVersion = versions.find((version) => version.id === approvedVersionId) ?? null;
  const latest = latestBrandKitVersion(versions);
  const current = edited?.versionId === (latest?.id ?? null) ? edited.content : (latest?.content ?? emptyBrandKitContent());
  const problems = brandKitProblems(current, assets);
  const approvalProblems = latest ? brandKitProblems(latest.content, assets, { forApproval: true }) : [];

  const approvedLogos = assets.filter((asset) => asset.status === 'approved' && ['logo', 'brand_mark'].includes(asset.kind));
  const approvedPhotography = assets.filter((asset) => asset.status === 'approved' && asset.mimeType.startsWith('image/') && IMAGE_KINDS.includes(asset.kind));
  const approvedFonts = assets.filter((asset) => asset.status === 'approved' && asset.kind === 'typography_reference');
  const update = (content: BrandKitContent) => setEdited({ versionId: latest?.id ?? null, content });

  function saveDraft() {
    if (problems.length) return setProblem(problems[0]);
    setProblem(null);
    void save.run(current, `Draft from ${approvedVersion ? `approved version ${approvedVersion.version}` : 'the vault'}`);
  }

  return (
    <>
      <Card>
        <CardHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              Brand Kit
              {approvedVersion ? <Badge tone="success">Version {approvedVersion.version} approved</Badge> : <Badge tone="warning">No approved version</Badge>}
              {latest && latest.id !== approvedVersionId && <Badge tone="neutral">Draft {latest.version}</Badge>}
            </span>
          }
          description="The decisions the design phases inherit: logo variants, palette, typography with its licence, photography, personality, visual direction and tone of voice. It never invents a house style; every choice is argued and traceable."
          actions={
            editable ? (
              <Button size="sm" variant="primary" loading={save.pending} onClick={saveDraft}>
                Save as version {(latest?.version ?? 0) + 1}
              </Button>
            ) : undefined
          }
        />
        <CardBody className="space-y-3">
          {approvedVersion ? (
            <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2 text-sm">
              <p className="font-medium">
                Approved version {approvedVersion.version} · {brandKitSummary(approvedVersion.content)}
              </p>
              <p className="mt-0.5 text-xs text-subtle">
                Approved {approvalOf(approvedVersion.id, approvals)?.approvedAt ? formatDateTime(approvalOf(approvedVersion.id, approvals)!.approvedAt) : '—'}
                {approvalOf(approvedVersion.id, approvals)?.note ? ` — “${approvalOf(approvedVersion.id, approvals)!.note}”` : ''}
              </p>
            </div>
          ) : (
            <Notice tone="neutral" title="No approved Brand Kit yet">
              Complete the sections below, save a version, then approve it. Until a version is approved, the Creative Direction phase must not start.
            </Notice>
          )}
          {problem && <p className="text-sm text-danger">{problem}</p>}
          {!editable && <p className="text-sm text-subtle">Your role can read the Brand Kit but not change it.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Logo variants" description="Approved logos and brand marks only. A candidate must be approved in the vault first." />
        <CardBody>
          {approvedLogos.length === 0 ? (
            <p className="text-sm text-subtle">No approved logo yet. Upload one in the Asset vault and approve it with its permission recorded.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {approvedLogos.map((asset) => (
                <Checkbox
                  key={asset.id}
                  label={
                    <span className="flex flex-wrap items-center gap-2">
                      {asset.fileName} <Badge tone={ASSET_KIND_META[asset.kind].tone}>{ASSET_KIND_META[asset.kind].label}</Badge>
                    </span>
                  }
                  description={`${asset.ownerName} · ${asset.licenceName ?? 'permission recorded'}`}
                  checked={current.logoAssetIds.includes(asset.id)}
                  disabled={!editable}
                  onChange={() => update({ ...current, logoAssetIds: toggle(current.logoAssetIds, asset.id) })}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Colour palette"
          description="Named colours with a role, not a generic palette. Two or more are required to approve the kit."
          actions={
            editable ? (
              <Button size="sm" onClick={() => update({ ...current, palette: [...current.palette, { name: '', hex: '#1B2A41', role: '' }] })}>
                <Plus aria-hidden /> Colour
              </Button>
            ) : undefined
          }
        />
        <CardBody className="space-y-3">
          {current.palette.length === 0 && <p className="text-sm text-subtle">No colours yet.</p>}
          {current.palette.map((entry, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]">
              <TextField label={`Colour ${index + 1} name`} value={entry.name} disabled={!editable} onChange={(name) => update({ ...current, palette: replaceAt(current.palette, index, { ...entry, name }) })} />
              <TextField label="Hex" value={entry.hex} disabled={!editable} onChange={(hex) => update({ ...current, palette: replaceAt(current.palette, index, { ...entry, hex }) })} />
              <TextField label="Role" value={entry.role} disabled={!editable} placeholder="Background, accent…" onChange={(role) => update({ ...current, palette: replaceAt(current.palette, index, { ...entry, role }) })} />
              <div className="flex items-end pb-0.5">
                <span aria-hidden className="mr-1 size-8.5 rounded border border-border" style={{ background: /^#[0-9a-f]{6}$/i.test(entry.hex) ? entry.hex : 'transparent' }} />
                {editable && (
                  <Button size="sm" variant="ghost" aria-label={`Remove colour ${index + 1}`} onClick={() => update({ ...current, palette: current.palette.filter((_, i) => i !== index) })}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>


      <Card>
        <CardHeader
          title="Typography"
          description="The pairing, its weights and the web licence that permits it. Typography is chosen on purpose, never inherited from a template."
          actions={
            editable ? (
              <Button size="sm" onClick={() => update({ ...current, typography: [...current.typography, { role: '', family: '', weights: '', licence: '', assetId: null }] })}>
                <Plus aria-hidden /> Typeface
              </Button>
            ) : undefined
          }
        />
        <CardBody className="space-y-3">
          {current.typography.length === 0 && <p className="text-sm text-subtle">No typefaces yet. At least one with its licence is required to approve the kit.</p>}
          {current.typography.map((entry, index) => (
            <div key={index} className="space-y-2 rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <TextField label="Role" value={entry.role} disabled={!editable} placeholder="Display" onChange={(role) => update({ ...current, typography: replaceAt(current.typography, index, { ...entry, role }) })} />
                <TextField label="Family" value={entry.family} disabled={!editable} placeholder="Fraunces" onChange={(family) => update({ ...current, typography: replaceAt(current.typography, index, { ...entry, family }) })} />
                <TextField label="Weights" value={entry.weights} disabled={!editable} placeholder="400, 600, italic" onChange={(weights) => update({ ...current, typography: replaceAt(current.typography, index, { ...entry, weights }) })} />
                <TextField label="Web licence" value={entry.licence} disabled={!editable} placeholder="SIL Open Font License 1.1" onChange={(licence) => update({ ...current, typography: replaceAt(current.typography, index, { ...entry, licence }) })} />
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {approvedFonts.length > 0 && (
                  <Field label="Font file">
                    {(props) => (
                      <select
                        {...props}
                        className="h-8.5 rounded-md border border-border bg-surface px-2 text-sm"
                        value={entry.assetId ?? ''}
                        disabled={!editable}
                        onChange={(e) => update({ ...current, typography: replaceAt(current.typography, index, { ...entry, assetId: e.target.value || null }) })}
                      >
                        <option value="">No file in the vault</option>
                        {approvedFonts.map((font) => (
                          <option key={font.id} value={font.id}>
                            {font.fileName}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
                {editable && (
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Remove typeface ${index + 1}`} onClick={() => update({ ...current, typography: current.typography.filter((_, i) => i !== index) })}>
                    <Trash2 aria-hidden /> Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Photography collection" description="Approved photographs and artwork the direction may use. Each keeps its own licence and attribution." />
        <CardBody>
          {approvedPhotography.length === 0 ? (
            <p className="text-sm text-subtle">No approved photography yet. Product, venue or licensed images appear here once approved.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {approvedPhotography.map((asset) => (
                <Checkbox
                  key={asset.id}
                  label={`${asset.fileName} · ${ASSET_KIND_META[asset.kind].label}`}
                  description={asset.attributionRequired ? `Credit: ${asset.attributionText}` : (asset.licenceName ?? 'Permission recorded')}
                  checked={current.photographyAssetIds.includes(asset.id)}
                  disabled={!editable}
                  onChange={() => update({ ...current, photographyAssetIds: toggle(current.photographyAssetIds, asset.id) })}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>


      <Card>
        <CardHeader title="Personality and direction" description="The argument behind the design: who the business is, and what the site should feel like." />
        <CardBody className="space-y-3">
          <Field label="Personality" hint="Three to twelve traits, separated by commas. Concrete beats generic: “quietly confident, exacting, warm”.">
            {(props) => (
              <Input
                {...props}
                value={current.personality.join(', ')}
                disabled={!editable}
                onChange={(e) => update({ ...current, personality: commaList(e.target.value).slice(0, 12) })}
                placeholder="Quietly confident, exacting, warm"
              />
            )}
          </Field>
          <Field label="Visual direction" hint="At least a short paragraph before the kit can be approved: composition, light, texture, colour logic, motion and what the design deliberately avoids.">
            {(props) => (
              <Textarea
                {...props}
                rows={5}
                maxLength={2000}
                value={current.visualDirection}
                disabled={!editable}
                onChange={(e) => update({ ...current, visualDirection: e.target.value })}
                placeholder="Editorial and unhurried: a warm off-white ground, one deep kente red used sparingly, and photography given room to breathe. Type does the talking — a high-contrast display face against a quiet text face. Motion is a slow reveal on scroll, never a carousel. No stock smiling-at-camera imagery, no drop shadows."
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tone of voice" description="How the business speaks, with examples. Later phases write copy from this, not from a generic brand voice." />
        <CardBody className="space-y-3">
          <Field label="Summary">
            {(props) => (
              <Input
                {...props}
                value={current.toneOfVoice.summary}
                disabled={!editable}
                maxLength={600}
                onChange={(e) => update({ ...current, toneOfVoice: { ...current.toneOfVoice, summary: e.target.value } })}
                placeholder="Plain, precise and proud of the craft. Short sentences; no exclamation marks."
              />
            )}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Always" hint="One per line.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={current.toneOfVoice.do.join('\n')}
                  disabled={!editable}
                  onChange={(e) => update({ ...current, toneOfVoice: { ...current.toneOfVoice, do: lines(e.target.value).slice(0, 8) } })}
                  placeholder={'Name the fabric and the finish\nSay what a fitting involves'}
                />
              )}
            </Field>
            <Field label="Never" hint="One per line.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={current.toneOfVoice.dont.join('\n')}
                  disabled={!editable}
                  onChange={(e) => update({ ...current, toneOfVoice: { ...current.toneOfVoice, dont: lines(e.target.value).slice(0, 8) } })}
                  placeholder={'“Best in Ghana”\nEmoji in body copy'}
                />
              )}
            </Field>
          </div>
        </CardBody>
      </Card>


      <Card>
        <CardHeader title="Version history" description="A saved version never changes. Approval records who approved which version, and when." />
        <CardBody className={versions.length ? 'p-0' : undefined}>
          {versions.length === 0 ? (
            <EmptyState icon={Check} title="No versions yet" description="Save the first version once the vault has an approved logo and the direction is written." />
          ) : (
            <ul className="divide-y divide-border">
              {versions.map((version) => {
                const approval = approvalOf(version.id, approvals);
                const isLatest = version.id === latest?.id;
                return (
                  <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                    <Badge tone={approval ? 'success' : 'neutral'}>Version {version.version}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block">{brandKitSummary(version.content)}</span>
                      <span className="block text-xs text-subtle">
                        Saved {formatDateTime(version.createdAt)}
                        {approval ? ` · approved ${formatDateTime(approval.approvedAt)} — “${approval.note}”` : ' · not approved'}
                      </span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setEdited({ versionId: latest?.id ?? null, content: version.content })}>
                      Load
                    </Button>
                    {editable && isLatest && !approval && (
                      <Button size="sm" variant="primary" disabled={approvalProblems.length > 0} title={approvalProblems[0]} onClick={() => setApproving(version)}>
                        Approve
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {approving && (
        <ApproveKitDialog
          version={approving}
          pending={approve.pending}
          onClose={() => setApproving(null)}
          onSubmit={async (note) => {
            const saved = await approve.run(approving, note);
            if (saved) setApproving(null);
          }}
        />
      )}
    </>
  );
}

function ApproveKitDialog({ version, pending, onClose, onSubmit }: { version: StudioBrandKitVersion; pending: boolean; onClose: () => void; onSubmit: (note: string) => void }) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 3) return setProblem('Explain what was approved in a few words.');
    setProblem(null);
    onSubmit(note.trim());
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={`Approve Brand Kit version ${version.version}?`}
      description="The design phases build from this version. Approving does not grant permission to publish any asset; the vault's permissions still apply."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Approve version
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="What was approved, and why" error={problem ?? undefined} required>
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
              placeholder="Agreed with Nsroma on 25 October; the kente red and the Fraunces / Lato pairing are final."
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function TextField({ label, value, disabled, placeholder, onChange }: { label: string; value: string; disabled: boolean; placeholder?: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      {(props) => <Input {...props} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} maxLength={200} />}
    </Field>
  );
}

