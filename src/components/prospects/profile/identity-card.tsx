'use client';

import { GitMerge, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import * as research from '@/lib/data/research-services';
import { MERGEABLE_LABELS, assessIdentity, fillableFields, linkBetween, mergedPermission, type MergeableField } from '@/lib/domain/identity';
import type { Business } from '@/lib/domain/types';
import { CONTACT_PERMISSION_META } from '@/lib/domain/constants';
import { useAction, useBusinesses, useIdentityLinks, useResearchSchema } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

const STRENGTH_TONE = { exact: 'danger', likely: 'warning', possible: 'neutral' } as const;

/** Identity confidence, possible duplicates and the decisions people made about them. */
export function IdentityCard({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const { data: schema } = useResearchSchema();
  const { data: all = [] } = useBusinesses();
  const { data: links = [] } = useIdentityLinks(business.id);
  const [merging, setMerging] = useState<Business | null>(null);
  const assessment = useMemo(() => assessIdentity(business, all, links), [business, all, links]);
  const byId = useMemo(() => new Map(all.map((b) => [b.id, b])), [all]);
  const decide = useAction((ctx, other: Business, decision: research.IdentityDecision) => research.decideIdentity(ctx, business, other, decision), {
    success: (r) => (r.link.status === 'dismissed' ? 'Suggestion dismissed' : `Recorded: ${research.identityRelationLabel(r.link).toLowerCase()}`),
  });
  const undo = useAction((ctx, secondary: Business) => research.undoProspectMerge(ctx, secondary, business), { success: 'Merge undone' });

  if (schema === false) {
    return (
      <Card>
        <CardHeader title="Identity" />
        <CardBody>
          <p className="text-sm text-subtle">Apply database migration 004 to use duplicate decisions, branches and merges.</p>
        </CardBody>
      </Card>
    );
  }
  if (business.mergedIntoId) return null; // The merged banner in the header explains this record.

  const writable = can('prospects.write');
  const decided = links.filter((l) => l.status !== 'suggested' || l.relation !== 'possible_duplicate');
  const confidence = business.identityConfidence ?? assessment.confidence;
  const parent = business.parentBusinessId ? byId.get(business.parentBusinessId) : null;

  return (
    <Card>
      <CardHeader title="Identity" description="Is this the business we think it is, and is it already in the CRM? Nothing is merged automatically." />
      <CardBody className="space-y-3 text-sm">
        <details>
          <summary className="cursor-pointer">
            Identity confidence <strong>{confidence}/100</strong>
            {business.identityCheckedAt ? <span className="text-xs text-subtle"> · checked {business.identityCheckedAt.slice(0, 10)}</span> : null}
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {assessment.factors.map((f) => (
              <li key={f.label} className="flex justify-between gap-3">
                <span>
                  {f.label}
                  <span className="block text-subtle">{f.detail}</span>
                </span>
                <span className={f.points < 0 ? 'font-mono text-danger' : 'font-mono'}>{f.points > 0 ? `+${f.points}` : f.points}</span>
              </li>
            ))}
          </ul>
        </details>
        {(business.alternateNames ?? []).length > 0 && (
          <p className="text-xs">
            <span className="text-subtle">Also known as:</span> {business.alternateNames!.join(', ')}
          </p>
        )}
        {parent && (
          <p className="text-xs">
            <span className="text-subtle">Branch of</span>{' '}
            <Link href={`/prospects/${parent.id}`} className="underline-offset-2 hover:underline">
              {parent.name}
            </Link>
          </p>
        )}

        {assessment.suggestions.length > 0 ? (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-muted">Possible duplicates</h3>
            <ul className="space-y-2.5">
              {assessment.suggestions.map((s) => (
                <li key={s.other.id} className="rounded-md border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/prospects/${s.other.id}`} className="font-medium underline-offset-2 hover:underline">
                      {s.other.name}
                    </Link>
                    <Badge tone={STRENGTH_TONE[s.strength]}>{s.strength} match</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-subtle">
                    {s.other.city} · {s.reasons.join('; ')}
                  </p>
                  {writable && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {can('identity.merge') && (
                        <Button size="sm" onClick={() => setMerging(s.other)}>
                          <GitMerge /> Merge…
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" loading={decide.pending} onClick={() => void decide.run(s.other, 'branch')} title={`Record ${business.name} as a branch of ${s.other.name}`}>
                        Branch of it
                      </Button>
                      <Button size="sm" variant="ghost" loading={decide.pending} onClick={() => void decide.run(s.other, 'distinct')}>
                        Different business
                      </Button>
                      {linkBetween(links, business.id, s.other.id) && (
                        <Button size="sm" variant="ghost" loading={decide.pending} onClick={() => void decide.run(s.other, 'dismissed')}>
                          Dismiss
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-xs text-subtle">No undecided duplicates in this workspace.</p>
        )}

        {decided.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-muted">Decisions</h3>
            <ul className="space-y-1.5 text-xs">
              {decided.map((l) => {
                const otherId = l.businessId === business.id ? l.otherBusinessId : l.businessId;
                const other = byId.get(otherId);
                const mergedHere = l.relation === 'same_business' && other?.mergedIntoId === business.id;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge>{research.identityRelationLabel(l)}</Badge>
                    {other ? (
                      <Link href={`/prospects/${other.id}`} className="underline-offset-2 hover:underline">
                        {other.name}
                      </Link>
                    ) : (
                      <span className="text-subtle">Deleted prospect</span>
                    )}
                    {l.decidedAt && <span className="text-subtle">{l.decidedAt.slice(0, 10)}</span>}
                    {mergedHere && can('identity.merge') && other && (
                      <Button size="sm" variant="ghost" loading={undo.pending} onClick={() => void undo.run(other)}>
                        <Undo2 /> Undo merge
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </CardBody>
      {merging && <MergeDialog a={business} b={merging} onClose={() => setMerging(null)} />}
    </Card>
  );
}

function MergeDialog({ a, b, onClose }: { a: Business; b: Business; onClose: () => void }) {
  const [keep, setKeep] = useState<'a' | 'b'>(() => (b.createdAt < a.createdAt ? 'b' : 'a'));
  const primary = keep === 'a' ? a : b;
  const secondary = keep === 'a' ? b : a;
  const fillable = fillableFields(primary, secondary);
  const [fields, setFields] = useState<MergeableField[]>(fillable);
  const [note, setNote] = useState('');
  const chosen = fields.filter((f) => fillable.includes(f));
  const after = mergedPermission(primary, secondary);
  const merge = useAction((ctx) => research.mergeProspects(ctx, primary, secondary, chosen, note), { success: `Merged into ${primary.name}`, onSuccess: onClose });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title="Merge duplicate prospects"
      description="Nothing is deleted. The other record is archived with a link to the one you keep, and the merge can be undone."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={merge.pending} onClick={() => void merge.run()}>
            <GitMerge /> Merge into {primary.name}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <fieldset className="space-y-1.5">
          <legend className="mb-1 font-medium">Keep this record</legend>
          {(['a', 'b'] as const).map((k) => {
            const r = k === 'a' ? a : b;
            return (
              <label key={k} className="flex items-start gap-2">
                <input type="radio" name="keep" checked={keep === k} onChange={() => setKeep(k)} className="mt-1 accent-[var(--accent)]" />
                <span>
                  {r.name} <span className="text-xs text-subtle">· {r.city} · added {r.createdAt.slice(0, 10)}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 font-medium">Copy into the kept record (only where it has none)</legend>
          {fillable.length === 0 ? (
            <p className="text-xs text-subtle">Nothing to copy: the kept record already has every detail the other one has.</p>
          ) : (
            fillable.map((f) => (
              <Checkbox
                key={f}
                label={MERGEABLE_LABELS[f]}
                description={String(secondary[f])}
                checked={chosen.includes(f)}
                onChange={(e) => setFields((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))}
              />
            ))
          )}
        </fieldset>
        {after.contactPermission !== primary.contactPermission && (
          <Notice tone="warning" title="Contact permission carries over">
            {secondary.name} is recorded as “{CONTACT_PERMISSION_META[secondary.contactPermission].label}”, so the merged record will be too. Undoing the merge does not lift it.
          </Notice>
        )}
        <Field label="Note (optional)">{(p) => <Textarea {...p} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="Why these are the same business." />}</Field>
      </div>
    </Dialog>
  );
}
