'use client';

import { FolderKanban, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import * as svc from '@/lib/data/services';
import { INVOICE_STATUS_LABELS, PROJECT_STATUSES, PROJECT_STATUS_META, PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectStatus, type ProjectType } from '@/lib/domain/constants';
import { formatMoney } from '@/lib/domain/proposal';
import { cn, formatDate, todayIso } from '@/lib/utils';
import { useAction, useBusinesses, useMilestones, useProjects } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ProjectStatusBadge } from '@/components/records/badges';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';

export function ProjectsList() {
  const { can } = useWorkspace();
  const { data: projects, isLoading } = useProjects();
  const { data: milestones = [] } = useMilestones();
  const { data: businesses = [] } = useBusinesses();
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const names = useMemo(() => new Map(businesses.map((b) => [b.id, b.name])), [businesses]);

  if (isLoading) return <PageSkeleton />;
  const today = todayIso();
  const rows = (projects ?? []).filter((p) => !status || p.status === status).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <>
      <PageHeader
        title="Projects"
        description="Delivery work for won business. Accepted proposals convert here with their phases as milestones."
        actions={
          can('projects.write') && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden /> New project
            </Button>
          )
        }
      />
      <div className="mb-3">
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | '')} className="w-auto">
          <option value="">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={projects?.length ? 'No projects with this status' : 'No projects yet'}
            description="Mark a proposal as accepted, then use “Convert to project”. You can also create a project directly for an existing client."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-surface-muted/60 text-left text-xs text-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Project</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Milestones</th>
                  <th scope="col" className="px-4 py-2 font-medium">Due</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Contract value</th>
                  <th scope="col" className="px-4 py-2 font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p) => {
                  const ms = milestones.filter((m) => m.projectId === p.id);
                  const done = ms.filter((m) => m.completedAt).length;
                  const late = p.dueDate && p.dueDate < today && !['delivered', 'maintenance', 'cancelled'].includes(p.status);
                  return (
                    <tr key={p.id} className="hover:bg-surface-hover/60">
                      <td className="max-w-sm px-4 py-2.5">
                        <Link href={`/projects/${p.id}`} className="block truncate font-medium hover:underline">
                          {p.name}
                        </Link>
                        <span className="text-xs text-subtle">
                          {names.get(p.businessId) ?? 'Deleted business'} · {PROJECT_TYPE_LABELS[p.projectType]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <ProjectStatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-2.5 tabular text-muted">{ms.length ? `${done} / ${ms.length}` : '—'}</td>
                      <td className={cn('px-4 py-2.5 text-xs', late ? 'text-danger' : 'text-subtle')}>{p.dueDate ? formatDate(p.dueDate) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular">{p.contractValue != null ? formatMoney(p.contractValue, p.currency) : '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-subtle">{INVOICE_STATUS_LABELS[p.invoiceStatus]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data: businesses = [] } = useBusinesses();
  const [businessId, setBusinessId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<ProjectType>('website');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAction(svc.createProject, { success: 'Project created', onSuccess: (p) => router.push(`/projects/${p.id}`) });
  const options = [...businesses].filter((b) => b.contactPermission !== 'opted_out').sort((a, b) => Number(b.stage === 'won') - Number(a.stage === 'won') || a.name.localeCompare(b.name));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const business = businesses.find((b) => b.id === businessId);
    const next: Record<string, string> = {};
    if (!business) next.business = 'Choose the client';
    if (!name.trim()) next.name = 'Name the project';
    setErrors(next);
    if (business && name.trim()) create.run(business, name, type);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New project"
      description="For work agreed outside the proposal builder. Projects from accepted proposals are created with “Convert to project”."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-project" loading={create.pending}>
            Create project
          </Button>
        </>
      }
    >
      <form id="new-project" onSubmit={submit} noValidate className="space-y-4">
        <Field label="Client" required error={errors.business}>
          {(p) => (
            <Select {...p} value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              <option value="">Choose a business…</option>
              {options.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.stage === 'won' ? ' (won)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Project name" required error={errors.name}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Type">
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PROJECT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
