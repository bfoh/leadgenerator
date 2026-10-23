'use client';

import { AlertTriangle, ArrowLeft, Check, CalendarClock, Download, FolderKanban, History, Lock, MessageSquareText, Plus, Printer, RotateCcw, Send, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import * as svc from '@/lib/data/services';
import { acceptanceBlockers } from '@/lib/domain/conversion';
import { PROPOSAL_STATUS_META, type ProposalStatus } from '@/lib/domain/constants';
import { LINE_ITEM_CATEGORIES, LINE_ITEM_KINDS, LINE_ITEM_KIND_LABELS, type LineItemCategory, type LineItemKind } from '@/lib/domain/packages';
import { PROPOSAL_TRANSITIONS, approvalIssues, computeTotals, formatMoney, isExpired, newId, proposalContentSchema, proposalToMarkdown, type ProposalContent } from '@/lib/domain/proposal';
import type { Business, Proposal } from '@/lib/domain/types';
import { download, formatDate, formatDateTime, slug } from '@/lib/utils';
import { useAction, useActivities, useBusiness, useProjects, useProposal, useProposalVersions } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ProposalStatusBadge } from '@/components/records/badges';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { ObjectListEditor, StringListEditor } from '@/components/ui/list-editor';
import { EmptyState, Notice, PageSkeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChangeRequests, useProposalChanges } from './change-requests';
import { ProposalBasisCard } from './proposal-basis';
import { ProposalDocument } from './proposal-document';

export function ProposalEditor({ id }: { id: string }) {
  const { data: proposal, isLoading } = useProposal(id);
  const business = useBusiness(proposal?.businessId ?? '');
  if (isLoading || (proposal && business.isLoading)) return <PageSkeleton />;
  if (!proposal) return <EmptyState title="Proposal not found" action={<ButtonLink href="/proposals">Back to proposals</ButtonLink>} />;
  return <Loaded key={`${proposal.id}:${proposal.version}:${proposal.status}`} proposal={proposal} business={business.data ?? null} />;
}

const ACTION_META: Partial<Record<ProposalStatus, { label: string; icon: typeof Check; variant: 'primary' | 'secondary' | 'danger' }>> = {
  approved: { label: 'Approve', icon: Check, variant: 'primary' },
  sent: { label: 'Mark as sent', icon: Send, variant: 'primary' },
  accepted: { label: 'Accepted', icon: ThumbsUp, variant: 'primary' },
  declined: { label: 'Declined', icon: ThumbsDown, variant: 'secondary' },
  draft: { label: 'Revise as draft', icon: RotateCcw, variant: 'secondary' },
  withdrawn: { label: 'Withdraw', icon: X, variant: 'secondary' },
};

function Loaded({ proposal, business }: { proposal: Proposal; business: Business | null }) {
  const { can, settings } = useWorkspace();
  const router = useRouter();
  const [content, setContent] = useState<ProposalContent>(proposal.content);
  const [title, setTitle] = useState(proposal.title);
  const [tab, setTab] = useState(proposal.status === 'draft' ? 'edit' : 'preview');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ProposalStatus | null>(null);
  const [response, setResponse] = useState('');
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.proposalId === proposal.id);
  const { requests: changes } = useProposalChanges(proposal);
  const blockers = acceptanceBlockers(proposal, changes);

  const editable = proposal.status === 'draft' && can('proposals.write');
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(proposal.content) || title !== proposal.title, [content, title, proposal]);
  const totals = computeTotals(content);
  const todayIso = new Date().toISOString().slice(0, 10);
  const issues = approvalIssues(content, todayIso);
  const expired = isExpired(proposal.content, todayIso) && ['approved', 'sent'].includes(proposal.status);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useAction((ctx, c: ProposalContent, t: string) => svc.saveProposalContent(ctx, proposal, c, t), { success: 'Draft saved' });
  const transition = useAction(
    (ctx, to: ProposalStatus, note: string) => {
      if (!business) throw new Error('The business for this proposal no longer exists.');
      return svc.transitionProposal(ctx, proposal, business, to, { response: note });
    },
    {
      success: (p) => `Proposal ${PROPOSAL_STATUS_META[p.status].label.toLowerCase()}`,
      onSuccess: () => {
        setConfirm(null);
        setResponse('');
      },
    },
  );
  const convert = useAction(
    (ctx) => {
      if (!business) throw new Error('The business for this proposal no longer exists.');
      return svc.convertToProject(ctx, business, proposal);
    },
    { success: 'Project created', onSuccess: (p) => router.push(`/projects/${p.id}`) },
  );

  const set = <K extends keyof ProposalContent>(key: K, value: ProposalContent[K]) => setContent((c) => ({ ...c, [key]: value }));

  function saveDraft() {
    const cleaned: ProposalContent = {
      ...content,
      phases: content.phases.filter((p) => p.name.trim()),
      opportunities: content.opportunities.filter((s) => s.trim()),
      deliverables: content.deliverables.filter((s) => s.trim()),
      exclusions: content.exclusions.filter((s) => s.trim()),
      clientResponsibilities: content.clientResponsibilities.filter((s) => s.trim()),
      assumptions: content.assumptions.filter((s) => s.trim()),
      nextSteps: content.nextSteps.filter((s) => s.trim()),
    };
    const parsed = proposalContentSchema.safeParse(cleaned);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return setError(`Check ${issue.path.join(' → ')}: ${issue.message}`);
    }
    setError(null);
    save.run(parsed.data, title);
  }

  const nextStatuses = PROPOSAL_TRANSITIONS[proposal.status];
  const blockReason = (to: ProposalStatus): string | null => {
    if (to === 'approved' && dirty) return 'Save your changes first.';
    if (to === 'approved' && issues.length) return issues[0];
    if (to === 'sent' && business?.contactPermission !== 'granted') return 'Record contact permission for this business first.';
    if (to === 'sent' && isExpired(proposal.content, todayIso)) return 'This proposal has expired. Revise it and set a new validity date first.';
    if (to === 'accepted' && blockers.length) return blockers[0];
    return null;
  };

  return (
    <>
      <div className="mb-4">
        <Link href={business ? `/prospects/${business.id}?tab=proposals` : '/proposals'} className="mb-2 inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden /> {business?.name ?? 'Proposals'}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{proposal.title}</h1>
              <ProposalStatusBadge status={proposal.status} />
            </div>
            <p className="mt-0.5 text-xs text-subtle">
              Version {proposal.version} · updated {formatDateTime(proposal.updatedAt)}
              {proposal.approvedAt ? ` · approved ${formatDateTime(proposal.approvedAt)}` : ''}
              {proposal.sentAt ? ` · issued ${formatDateTime(proposal.sentAt)}` : ''}
              {proposal.content.validUntil ? ` · valid until ${formatDate(proposal.content.validUntil)}` : ''}
              {proposal.decidedAt ? ` · decided ${formatDateTime(proposal.decidedAt)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => download(`proposal-${slug(proposal.title)}-v${proposal.version}.md`, proposalToMarkdown(title, proposal.status, content, proposal.currency), 'text/markdown;charset=utf-8')}>
              <Download /> Markdown
            </Button>
            <ButtonLink href={`/print/proposals/${proposal.id}`} external>
              <Printer /> Print / PDF
            </ButtonLink>
            {editable && (
              <Button variant="primary" onClick={saveDraft} loading={save.pending} disabled={!dirty}>
                {dirty ? 'Save draft' : 'Saved'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {can('proposals.write') && (nextStatuses.length > 0 || proposal.status === 'accepted') && (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-center gap-2 py-3">
            <span className="mr-1 text-xs font-medium text-subtle">Lifecycle</span>
            {nextStatuses.map((to) => {
              const meta = ACTION_META[to]!;
              const reason = blockReason(to);
              const Icon = meta.icon;
              return (
                <Button key={to} size="sm" variant={meta.variant} disabled={Boolean(reason)} title={reason ?? undefined} onClick={() => setConfirm(to)}>
                  {reason ? <Lock /> : <Icon />} {meta.label}
                </Button>
              );
            })}
            {proposal.status === 'accepted' &&
              (project ? (
                <ButtonLink size="sm" href={`/projects/${project.id}`}>
                  <FolderKanban /> Open project
                </ButtonLink>
              ) : (
                can('projects.write') && (
                  <Button size="sm" variant="primary" onClick={() => convert.run()} loading={convert.pending}>
                    <FolderKanban /> Convert to project
                  </Button>
                )
              ))}
            {proposal.status === 'draft' && issues.length > 0 && <span className="text-xs text-subtle">{issues.length} item(s) to fix before approval</span>}
            {nextStatuses.includes('accepted') && blockers.length > 0 && <span className="text-xs text-subtle">{blockers[0]}</span>}
            {nextStatuses.includes('sent') && business?.contactPermission !== 'granted' && (
              <span className="text-xs text-subtle">
                Sending needs recorded permission.{' '}
                {business && (
                  <Link href={`/prospects/${business.id}?tab=contacts`} className="underline">
                    Record permission
                  </Link>
                )}
              </span>
            )}
          </CardBody>
        </Card>
      )}

      {expired && (
        <Notice tone="warning" icon={CalendarClock} title="This proposal has expired" className="mb-5">
          It was valid until {formatDate(proposal.content.validUntil!)}. {proposal.status === 'approved' ? 'Revise it and set a new validity date before marking it as sent.' : 'If the client still wants to proceed, confirm the terms with them or revise it with a new validity date.'}
        </Notice>
      )}

      {business && ['sent', 'accepted', 'declined'].includes(proposal.status) && <ClientResponses proposal={proposal} business={business} />}

      <ChangeRequests proposal={proposal} />

      {proposal.status !== 'draft' && (
        <Notice tone="neutral" icon={Lock} className="mb-5">
          {PROPOSAL_STATUS_META[proposal.status].label} proposals are locked. {PROPOSAL_TRANSITIONS[proposal.status].includes('draft') ? 'Use “Revise as draft” to make changes; the current version stays in the history.' : ''}
        </Notice>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList label="Proposal views" className="mb-5">
          {editable && <TabsTrigger value="edit">Edit</TabsTrigger>}
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="versions">History</TabsTrigger>
        </TabsList>
        {editable && (
          <TabsContent value="edit">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-5">
                <EditorSections content={content} set={set} title={title} setTitle={setTitle} />
                <FormError message={error} />
              </div>
              <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
                <TotalsCard totals={totals} currency={proposal.currency} />
                {content.basis && <ProposalBasisCard basis={content.basis} />}
                {issues.length > 0 && (
                  <Notice tone="warning" icon={AlertTriangle} title="Before approval">
                    <ul className="list-disc space-y-0.5 pl-4">
                      {issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </Notice>
                )}
              </aside>
            </div>
          </TabsContent>
        )}
        <TabsContent value="preview">
          <Card className="mx-auto max-w-3xl p-5 sm:p-10">
            <ProposalDocument title={title} status={proposal.status} content={content} currency={proposal.currency} brand={settings.agency} />
          </Card>
        </TabsContent>
        <TabsContent value="versions">
          <div className="space-y-5">
            {!editable && proposal.content.basis && <ProposalBasisCard basis={proposal.content.basis} />}
            <VersionHistory proposal={proposal} />
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={confirm != null}
        onOpenChange={(o) => !o && setConfirm(null)}
        size="sm"
        title={confirm ? `${ACTION_META[confirm]?.label}?` : ''}
        description={
          confirm === 'approved'
            ? 'Approval locks the content. Pricing and terms should be final.'
            : confirm === 'sent'
              ? 'Record that you sent this proposal to the business yourself. Nothing is sent automatically. The prospect moves to “Proposal sent”.'
              : confirm === 'accepted'
                ? 'The prospect moves to Won and its value is set from this proposal.'
                : confirm === 'draft'
                  ? 'Creates an editable draft. The current version stays in the history.'
                  : 'This status is recorded in the proposal history.'
        }
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="primary" loading={transition.pending} onClick={() => confirm && transition.run(confirm, response)}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-subtle">
          {business?.name} · {formatMoney(totals.oneTimeTotal, proposal.currency)} one-time
          {totals.monthlyTotal ? ` + ${formatMoney(totals.monthlyTotal, proposal.currency)}/month` : ''}
        </p>
        {(confirm === 'accepted' || confirm === 'declined') && (
          <Field label="Client response (optional)" hint="What the client said, for example the reason or any conditions. Kept on this proposal's record." className="mt-4">
            {(p) => <Textarea {...p} rows={3} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} />}
          </Field>
        )}
      </Dialog>
    </>
  );
}

function ClientResponses({ proposal, business }: { proposal: Proposal; business: Business }) {
  const { can } = useWorkspace();
  const { data: activities = [] } = useActivities(business.id);
  const [text, setText] = useState('');
  const record = useAction((ctx, note: string) => svc.recordProposalResponse(ctx, proposal, business, note), { success: 'Client response recorded', onSuccess: () => setText('') });
  const responses = activities
    .filter((a) => a.details?.proposalId === proposal.id && typeof a.details?.response === 'string')
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return (
    <Card className="mb-5">
      <CardHeader title="Client response" as="h2" description="What the client said about this proposal. Anything they want changed is recorded below as a change request for an owner or admin, then goes through a revised draft and a new approval." />
      <CardBody className="space-y-4">
        {responses.length === 0 ? (
          <p className="text-sm text-subtle">No response recorded yet.</p>
        ) : (
          <ul className="space-y-3" data-testid="client-responses">
            {responses.map((a) => (
              <li key={a.id} className="rounded-md border border-border px-3 py-2">
                <p className="whitespace-pre-wrap text-sm">{String(a.details!.response)}</p>
                <p className="mt-1 text-xs text-subtle">
                  {formatDateTime(a.occurredAt)}
                  {typeof a.details?.status === 'string' && a.details.status !== 'sent' ? ` · marked ${PROPOSAL_STATUS_META[a.details.status as ProposalStatus]?.label.toLowerCase() ?? a.details.status}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        {proposal.status === 'sent' && can('proposals.write') && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              record.run(text);
            }}
          >
            <Field label="Record a response" hint="For example questions, requested changes or a decision date.">
              {(p) => <Textarea {...p} rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}
            </Field>
            <Button type="submit" size="sm" loading={record.pending} disabled={!text.trim()}>
              <MessageSquareText /> Save response
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function TotalsCard({ totals, currency }: { totals: ReturnType<typeof computeTotals>; currency: string }) {
  const money = (n: number) => formatMoney(n, currency);
  return (
    <Card>
      <CardHeader title="Totals" as="h3" />
      <CardBody className="space-y-1.5 text-sm">
        <Row label="One-time subtotal" value={money(totals.oneTimeSubtotal)} />
        {totals.taxLines.map((t) => (
          <Row key={t.label} label={`${t.label} (${t.ratePercent}%)`} value={money(t.oneTime)} />
        ))}
        <Row label="One-time total" value={money(totals.oneTimeTotal)} strong />
        {totals.monthlySubtotal > 0 && <Row label="Monthly" value={`${money(totals.monthlyTotal)}/mo`} />}
        {totals.annualSubtotal > 0 && <Row label="Annual" value={`${money(totals.annualTotal)}/yr`} />}
        {totals.optionalSubtotal > 0 && <Row label="Optional (excluded)" value={money(totals.optionalSubtotal)} />}
        {totals.unpricedRequired > 0 && <p className="pt-1 text-xs text-warning">{totals.unpricedRequired} required item(s) unpriced — shown as “To be quoted”.</p>}
      </CardBody>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between gap-3 border-t border-border pt-1.5 font-semibold' : 'flex justify-between gap-3'}>
      <span className={strong ? '' : 'text-subtle'}>{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

function EditorSections({
  content,
  set,
  title,
  setTitle,
}: {
  content: ProposalContent;
  set: <K extends keyof ProposalContent>(key: K, value: ProposalContent[K]) => void;
  title: string;
  setTitle: (t: string) => void;
}) {
  const milestoneTotal = content.milestones.reduce((s, m) => s + (Number(m.percent) || 0), 0);
  const text = (key: 'executiveSummary' | 'currentSituation' | 'recommendedSolution' | 'timeline' | 'maintenanceTerms', label: string, rows = 4) => (
    <Field label={label}>{(p) => <Textarea {...p} rows={rows} value={content[key]} onChange={(e) => set(key, e.target.value)} />}</Field>
  );

  return (
    <>
      <Card>
        <CardHeader title="Cover" as="h3" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2">
            {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Prepared for">{(p) => <Input {...p} value={content.preparedFor} onChange={(e) => set('preparedFor', e.target.value)} />}</Field>
          <Field label="Prepared by" hint={content.preparedBy ? undefined : 'Set your agency name in Settings to fill this automatically.'}>
            {(p) => <Input {...p} value={content.preparedBy} onChange={(e) => set('preparedBy', e.target.value)} />}
          </Field>
          <Field label="Date">{(p) => <Input {...p} type="date" value={content.preparedOn} onChange={(e) => set('preparedOn', e.target.value)} />}</Field>
          <Field label="Valid until">{(p) => <Input {...p} type="date" value={content.validUntil ?? ''} onChange={(e) => set('validUntil', e.target.value || null)} />}</Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Situation and solution" as="h3" />
        <CardBody className="space-y-4">
          {text('executiveSummary', '1. Executive summary')}
          {text('currentSituation', '2. Current situation')}
          <StringListEditor label="3. Identified opportunities" items={content.opportunities} onChange={(v) => set('opportunities', v)} />
          {text('recommendedSolution', '4. Recommended solution')}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Scope" as="h3" />
        <CardBody className="space-y-5">
          <StringListEditor label="5. Deliverables" items={content.deliverables} onChange={(v) => set('deliverables', v)} />
          <StringListEditor label="6. Scope exclusions" items={content.exclusions} onChange={(v) => set('exclusions', v)} />
          <ObjectListEditor
            label="7. Project phases"
            items={content.phases}
            onChange={(v) => set('phases', v)}
            create={() => ({ name: '', description: '', duration: '' })}
            itemLabel={(p, i) => p.name || `Phase ${i + 1}`}
            fields={[
              { key: 'name', label: 'Phase', kind: 'text' },
              { key: 'duration', label: 'Duration', kind: 'text' },
              { key: 'description', label: 'Description', kind: 'textarea' },
            ]}
          />
          {text('timeline', '8. Timeline', 2)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="9. Quotation" description="Enter your own prices in GH₵. Leave a price blank to show “To be quoted”. Optional items are excluded from totals." as="h3" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs text-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Description</th>
                <th scope="col" className="w-32 px-2 py-2 font-medium">Type</th>
                <th scope="col" className="w-32 px-2 py-2 font-medium">Category</th>
                <th scope="col" className="w-20 px-2 py-2 font-medium">Qty</th>
                <th scope="col" className="w-36 px-2 py-2 font-medium">Unit price (GH₵)</th>
                <th scope="col" className="w-28 px-2 py-2 text-right font-medium">Amount</th>
                <th scope="col" className="w-10 px-2 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {content.lineItems.map((l, i) => {
                const update = (patch: Partial<typeof l>) => set('lineItems', content.lineItems.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                const label = l.description || `Line ${i + 1}`;
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5">
                      <Input aria-label={`${label} description`} value={l.description} onChange={(e) => update({ description: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Select aria-label={`${label} type`} value={l.kind} onChange={(e) => update({ kind: e.target.value as LineItemKind })}>
                        {LINE_ITEM_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {LINE_ITEM_KIND_LABELS[k]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Select aria-label={`${label} category`} value={l.category} onChange={(e) => update({ category: e.target.value as LineItemCategory })}>
                        {LINE_ITEM_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c[0].toUpperCase() + c.slice(1)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input aria-label={`${label} quantity`} inputMode="decimal" value={String(l.quantity)} onChange={(e) => update({ quantity: Math.max(0.01, Number(e.target.value) || 1) })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        aria-label={`${label} unit price`}
                        inputMode="decimal"
                        placeholder="To be quoted"
                        value={l.unitPrice == null ? '' : String(l.unitPrice)}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d.]/g, '');
                          update({ unitPrice: v === '' ? null : Number(v) });
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular text-subtle">{l.unitPrice == null ? '—' : formatMoney(l.quantity * l.unitPrice)}</td>
                    <td className="px-2 py-1.5">
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${label}`} onClick={() => set('lineItems', content.lineItems.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CardBody className="space-y-5 border-t border-border">
          <Button size="sm" variant="ghost" onClick={() => set('lineItems', [...content.lineItems, { id: newId(), kind: 'one_time', category: 'development', description: '', quantity: 1, unitPrice: null }])}>
            <Plus /> Add line item
          </Button>
          <ObjectListEditor
            label="Taxes"
            hint="Applied to one-time, monthly and annual subtotals. Confirm the rates that apply to your registration (e.g. VAT and levies) with your accountant."
            items={content.taxes}
            onChange={(v) => set('taxes', v.map((t) => ({ ...t, ratePercent: Number(t.ratePercent) || 0 })))}
            create={() => ({ id: newId(), label: '', ratePercent: 0 })}
            itemLabel={(t, i) => t.label || `Tax ${i + 1}`}
            fields={[
              { key: 'label', label: 'Label', kind: 'text' },
              { key: 'ratePercent', label: 'Rate %', kind: 'number' },
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Terms" as="h3" />
        <CardBody className="space-y-5">
          <ObjectListEditor
            label="10. Payment milestones"
            hint={<span className={Math.abs(milestoneTotal - 100) > 0.01 ? 'text-danger' : 'text-success'}>Total {milestoneTotal}% — must equal 100%.</span>}
            items={content.milestones}
            onChange={(v) => set('milestones', v.map((m) => ({ ...m, percent: Number(m.percent) || 0 })))}
            create={() => ({ id: newId(), label: '', percent: 0, trigger: '' })}
            itemLabel={(m, i) => m.label || `Milestone ${i + 1}`}
            fields={[
              { key: 'label', label: 'Label', kind: 'text' },
              { key: 'percent', label: 'Percent', kind: 'number' },
              { key: 'trigger', label: 'When due', kind: 'text', wide: true },
            ]}
          />
          {text('maintenanceTerms', '11. Maintenance terms', 3)}
          <StringListEditor label="12. Client responsibilities" items={content.clientResponsibilities} onChange={(v) => set('clientResponsibilities', v)} />
          <StringListEditor label="13. Assumptions" items={content.assumptions} onChange={(v) => set('assumptions', v)} />
          <StringListEditor label="14. Next steps" items={content.nextSteps} onChange={(v) => set('nextSteps', v)} />
        </CardBody>
      </Card>
    </>
  );
}

function VersionHistory({ proposal }: { proposal: Proposal }) {
  const { settings } = useWorkspace();
  const { data: versions = [], isLoading } = useProposalVersions(proposal.id);
  const [viewing, setViewing] = useState<(typeof versions)[number] | null>(null);
  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (isLoading) return <PageSkeleton />;
  return (
    <Card>
      <CardHeader title="Version history" description="A snapshot is saved on every content or status change." />
      {sorted.length === 0 ? (
        <EmptyState icon={History} title="No snapshots yet" />
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="text-sm font-medium">v{v.version}</span>
              <ProposalStatusBadge status={v.status} />
              <span className="text-xs text-subtle">{formatDateTime(v.createdAt)}</span>
              <span className="flex-1 text-sm tabular text-muted">{formatMoney(computeTotals(v.content).oneTimeTotal)}</span>
              <Button size="sm" variant="ghost" onClick={() => setViewing(v)}>
                View
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={viewing != null} onOpenChange={(o) => !o && setViewing(null)} size="xl" title={viewing ? `Version ${viewing.version} · ${PROPOSAL_STATUS_META[viewing.status].label}` : ''} description={viewing ? formatDateTime(viewing.createdAt) : undefined}>
        {viewing && <ProposalDocument title={viewing.title} status={viewing.status} content={viewing.content} currency={proposal.currency} brand={settings.agency} />}
      </Dialog>
    </Card>
  );
}
