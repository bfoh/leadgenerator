'use client';

import { ArrowLeft, Check, ExternalLink, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import * as svc from '@/lib/data/services';
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  MAINTENANCE_STATUSES,
  PROJECT_STATUSES,
  PROJECT_STATUS_META,
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
} from '@/lib/domain/constants';
import { formatMoney } from '@/lib/domain/proposal';
import { fieldErrors, projectFormSchema } from '@/lib/domain/schemas';
import type { Project, ProjectMilestone } from '@/lib/domain/types';
import { cn, formatDate, safeHref, todayIso } from '@/lib/utils';
import { useAction, useBusiness, useMilestones, useProjects } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { TaskList } from '@/components/prospects/profile/activity-tab';
import { ProjectStatusBadge } from '@/components/records/badges';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { StringListEditor } from '@/components/ui/list-editor';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';

const MAINTENANCE_LABELS: Record<(typeof MAINTENANCE_STATUSES)[number], string> = { none: 'None', offered: 'Offered', active: 'Active', ended: 'Ended' };

export function ProjectView({ id }: { id: string }) {
  const { data: projects, isLoading } = useProjects();
  const project = projects?.find((p) => p.id === id);
  const { data: business } = useBusiness(project?.businessId ?? '');

  if (isLoading) return <PageSkeleton />;
  if (!project) {
    return (
      <Card>
        <EmptyState title="Project not found" description="It may have been deleted, or you may not have access." action={<ButtonLink href="/projects">Back to projects</ButtonLink>} />
      </Card>
    );
  }

  const site = safeHref(project.deploymentUrl);
  return (
    <>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Projects
      </Link>
      <PageHeader
        title={project.name}
        eyebrow={<ProjectStatusBadge status={project.status} />}
        description={
          <>
            {business ? (
              <Link href={`/prospects/${business.id}`} className="hover:underline">
                {business.name}
              </Link>
            ) : (
              'Deleted business'
            )}{' '}
            · {PROJECT_TYPE_LABELS[project.projectType]}
            {project.proposalId && (
              <>
                {' '}
                ·{' '}
                <Link href={`/proposals/${project.proposalId}`} className="hover:underline">
                  Source proposal
                </Link>
              </>
            )}
          </>
        }
        actions={
          site && (
            <ButtonLink href={site} external variant="secondary">
              <ExternalLink className="size-4" aria-hidden /> Open site
            </ButtonLink>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <DetailsForm key={project.updatedAt} project={project} />
        </div>
        <div className="space-y-5">
          <Milestones project={project} />
          <TaskList projectId={project.id} title="Project tasks" />
        </div>
      </div>
    </>
  );
}

function DetailsForm({ project }: { project: Project }) {
  const { can } = useWorkspace();
  const writable = can('projects.write');
  const [form, setForm] = useState({
    name: project.name,
    projectType: project.projectType,
    status: project.status,
    contractValue: project.contractValue == null ? '' : String(project.contractValue),
    startDate: project.startDate ?? '',
    dueDate: project.dueDate ?? '',
    deploymentUrl: project.deploymentUrl ?? '',
    maintenanceStatus: project.maintenanceStatus,
    invoiceStatus: project.invoiceStatus,
    notes: project.notes,
  });
  const [deliverables, setDeliverables] = useState(project.deliverables);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction(svc.updateProjectDetails, { success: 'Project saved' });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = projectFormSchema.safeParse(form);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    save.run(project, parsed.data, deliverables);
  }

  return (
    <Card>
      <CardHeader title="Project details" description={project.contractValue != null ? `Contract value ${formatMoney(project.contractValue, project.currency)}` : 'Contract value not recorded'} />
      <CardBody>
        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset disabled={!writable} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name} className="sm:col-span-2">
              {(p) => <Input {...p} value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} />}
            </Field>
            <Field label="Type">
              {(p) => (
                <Select {...p} value={form.projectType} onChange={(e) => set('projectType', e.target.value as Project['projectType'])}>
                  {PROJECT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PROJECT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(p) => (
                <Select {...p} value={form.status} onChange={(e) => set('status', e.target.value as Project['status'])}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_META[s].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={`Contract value (${project.currency})`} error={errors.contractValue} hint="As agreed with the client. Leave blank if not yet agreed.">
              {(p) => <Input {...p} type="number" min={0} step="0.01" inputMode="decimal" value={form.contractValue} onChange={(e) => set('contractValue', e.target.value)} />}
            </Field>
            <Field label="Invoice status">
              {(p) => (
                <Select {...p} value={form.invoiceStatus} onChange={(e) => set('invoiceStatus', e.target.value as Project['invoiceStatus'])}>
                  {INVOICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {INVOICE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Start date" error={errors.startDate}>
              {(p) => <Input {...p} type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />}
            </Field>
            <Field label="Due date" error={errors.dueDate}>
              {(p) => <Input {...p} type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}
            </Field>
            <Field label="Deployment URL" error={errors.deploymentUrl}>
              {(p) => <Input {...p} type="url" inputMode="url" placeholder="https://" value={form.deploymentUrl} onChange={(e) => set('deploymentUrl', e.target.value)} />}
            </Field>
            <Field label="Maintenance">
              {(p) => (
                <Select {...p} value={form.maintenanceStatus} onChange={(e) => set('maintenanceStatus', e.target.value as Project['maintenanceStatus'])}>
                  {MAINTENANCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {MAINTENANCE_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="sm:col-span-2">
              <StringListEditor label="Deliverables" items={deliverables} onChange={setDeliverables} disabled={!writable} placeholder="e.g. Five-page responsive website" />
            </div>
            <Field label="Notes" error={errors.notes} className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />}
            </Field>
          </fieldset>
          {writable ? (
            <Button type="submit" variant="primary" loading={save.pending}>
              Save project
            </Button>
          ) : (
            <p className="text-xs text-subtle">Your role can view projects but not edit them.</p>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

function Milestones({ project }: { project: Project }) {
  const { can } = useWorkspace();
  const writable = can('projects.write');
  const { data: milestones = [] } = useMilestones(project.id);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const today = todayIso();
  const sorted = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder);
  const add = useAction((ctx, t: string, d: string | null) =>
    ctx.store.createMilestone({ projectId: project.id, title: t, dueDate: d, completedAt: null, sortOrder: sorted.length ? sorted[sorted.length - 1].sortOrder + 1 : 0 }),
  );
  const toggle = useAction((ctx, m: ProjectMilestone) => ctx.store.updateMilestone(m.id, { completedAt: m.completedAt ? null : new Date().toISOString() }));
  const remove = useAction((ctx, m: ProjectMilestone) => ctx.store.deleteMilestone(m.id), { success: 'Milestone removed' });
  const done = sorted.filter((m) => m.completedAt).length;

  return (
    <Card>
      <CardHeader title="Milestones" description={sorted.length ? `${done} of ${sorted.length} complete` : undefined} />
      <CardBody className="space-y-3">
        {sorted.length === 0 ? (
          <EmptyState title="No milestones" className="py-4" />
        ) : (
          <ol className="divide-y divide-border">
            {sorted.map((m) => (
              <li key={m.id} className="flex items-start gap-2 py-2">
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => toggle.run(m)}
                  aria-pressed={Boolean(m.completedAt)}
                  aria-label={m.completedAt ? `Mark “${m.title}” as not complete` : `Mark “${m.title}” as complete`}
                  className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-border-strong', m.completedAt && 'border-success bg-success text-white')}
                >
                  {m.completedAt && <Check className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', m.completedAt && 'text-subtle line-through')}>{m.title}</p>
                  {(m.dueDate || m.completedAt) && (
                    <p className={cn('text-xs', !m.completedAt && m.dueDate && m.dueDate < today ? 'text-danger' : 'text-subtle')}>
                      {m.completedAt ? `Completed ${formatDate(m.completedAt)}` : `Due ${formatDate(m.dueDate)}`}
                    </p>
                  )}
                </div>
                {writable && (
                  <button type="button" onClick={() => remove.run(m)} className="rounded p-1 text-subtle hover:bg-surface-hover hover:text-danger" aria-label={`Delete milestone “${m.title}”`}>
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        {writable && (
          <form
            noValidate
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!title.trim()) return;
              if (await add.run(title.trim().slice(0, 200), due || null)) {
                setTitle('');
                setDue('');
              }
            }}
          >
            <Input aria-label="New milestone" placeholder="New milestone" value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1" />
            <Input aria-label="Milestone due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-auto" />
            <Button type="submit" size="icon" aria-label="Add milestone" loading={add.pending} disabled={!title.trim()}>
              <Plus />
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
