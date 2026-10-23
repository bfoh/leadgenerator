'use client';

import { CalendarClock, KanbanSquare, Lock, Rows3 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import * as svc from '@/lib/data/services';
import { CONTACT_PERMISSION_META, STAGES, STAGE_LABELS, type Stage } from '@/lib/domain/constants';
import { canEnterStage } from '@/lib/domain/pipeline';
import { formatMoney } from '@/lib/domain/proposal';
import type { Business } from '@/lib/domain/types';
import { cn, formatDate, formatDateTime, todayIso } from '@/lib/utils';
import { useAction, useActivities, useBusinesses, useTasks } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { PermissionBadge, ScorePill, StageBadge } from '@/components/records/badges';
import { StageControl } from '@/components/records/stage-control';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';

const BOARD_STAGES: Stage[] = STAGES.filter((s) => s !== 'archived');

export function PipelineView() {
  const { data: businesses, isLoading } = useBusinesses();
  const [view, setView] = useState<'board' | 'table'>('board');
  const [city, setCity] = useState('');
  const [query, setQuery] = useState('');
  const all = useMemo(() => businesses ?? [], [businesses]);
  const cities = useMemo(() => [...new Set(all.map((b) => b.city))].sort(), [all]);
  const shown = all.filter((b) => b.stage !== 'archived' && (!city || b.city === city) && (!query.trim() || b.name.toLowerCase().includes(query.trim().toLowerCase())));

  if (isLoading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Sales pipeline"
        description="Outreach stages unlock only after contact permission is recorded. Drag cards or use the stage menu; locked stages explain why."
        actions={
          <div role="radiogroup" aria-label="View" className="inline-flex rounded-md border border-border bg-surface p-0.5">
            {(
              [
                ['board', 'Board', KanbanSquare],
                ['table', 'Table', Rows3],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => setView(v)}
                className={cn('inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-subtle', view === v && 'bg-surface-muted text-foreground')}
              >
                <Icon className="size-3.5" aria-hidden /> {label}
              </button>
            ))}
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input aria-label="Search pipeline" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="sm:w-56" />
        <Select aria-label="Filter by city" value={city} onChange={(e) => setCity(e.target.value)} className="w-auto">
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
      </div>
      {view === 'board' ? <Board businesses={shown} /> : <PipelineTable businesses={shown} />}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OpenTasks businesses={all} />
        <UpcomingMeetings businesses={all} />
      </div>
    </>
  );
}

function Board({ businesses }: { businesses: Business[] }) {
  const { can } = useWorkspace();
  const [dragging, setDragging] = useState<Business | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [lostFor, setLostFor] = useState<Business | null>(null);
  const [reason, setReason] = useState('');
  const move = useAction((ctx, b: Business, stage: Stage, lostReason?: string) => svc.changeStage(ctx, b, stage, { lostReason }), {
    success: (b) => `${b.name} → ${STAGE_LABELS[b.stage]}`,
    onSuccess: () => {
      setLostFor(null);
      setReason('');
    },
  });
  const writable = can('prospects.write');

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex gap-3" style={{ minWidth: `${BOARD_STAGES.length * 262}px` }}>
          {BOARD_STAGES.map((stage) => {
            const cards = businesses.filter((b) => b.stage === stage).sort((a, b) => (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
            const value = cards.reduce((s, b) => s + (b.estimatedValue ?? 0), 0);
            const gate = dragging && dragging.stage !== stage ? canEnterStage(dragging, stage) : null;
            return (
              <section
                key={stage}
                aria-label={STAGE_LABELS[stage]}
                className={cn(
                  'flex w-[250px] shrink-0 flex-col rounded-lg border border-border bg-surface-muted/50',
                  over === stage && gate?.ok && 'border-accent bg-accent-soft/40',
                  over === stage && gate && !gate.ok && 'border-danger/50',
                )}
                onDragOver={(e) => {
                  if (!dragging || !writable) return;
                  e.preventDefault();
                  setOver(stage);
                }}
                onDragLeave={() => setOver((o) => (o === stage ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const b = dragging;
                  setDragging(null);
                  if (!b || b.stage === stage) return;
                  if (stage === 'lost') return setLostFor(b);
                  move.run(b, stage);
                }}
              >
                <header className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <h2 className="truncate text-xs font-semibold">{STAGE_LABELS[stage]}</h2>
                  <span className="text-[11px] tabular text-subtle">{cards.length}</span>
                </header>
                {value > 0 && <p className="-mt-1.5 px-3 pb-2 text-[11px] text-subtle">{formatMoney(value)} recorded</p>}
                {gate && !gate.ok && over === stage && (
                  <p className="mx-2 mb-2 flex gap-1.5 rounded bg-danger-soft px-2 py-1.5 text-[11px] text-danger">
                    <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {gate.reason}
                  </p>
                )}
                <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                  {cards.map((b) => (
                    <li
                      key={b.id}
                      draggable={writable}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(b);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      className={cn('rounded-md border border-border bg-surface p-2.5 shadow-xs', writable && 'cursor-grab active:cursor-grabbing', dragging?.id === b.id && 'opacity-50')}
                    >
                      <Link href={`/prospects/${b.id}`} className="block truncate text-[13px] font-medium hover:underline">
                        {b.name}
                      </Link>
                      <p className="truncate text-[11px] text-subtle">
                        {b.category} · {b.city}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <ScorePill score={b.opportunityScore} />
                        <span
                          className={cn('size-2 rounded-full', { neutral: 'bg-subtle', warning: 'bg-warning', success: 'bg-success', danger: 'bg-danger', info: 'bg-info', accent: 'bg-accent' }[CONTACT_PERMISSION_META[b.contactPermission].tone])}
                          title={CONTACT_PERMISSION_META[b.contactPermission].label}
                          aria-label={CONTACT_PERMISSION_META[b.contactPermission].label}
                          role="img"
                        />
                      </div>
                      {b.estimatedValue != null && <p className="mt-1 text-[11px] tabular text-muted">{formatMoney(b.estimatedValue)}</p>}
                      {b.nextActionDue && (
                        <p className={cn('mt-1 text-[11px]', b.nextActionDue < todayIso() ? 'text-danger' : 'text-subtle')}>
                          {b.nextAction ?? 'Next action'} · {formatDate(b.nextActionDue)}
                        </p>
                      )}
                      <div className="mt-2">
                        <StageControl business={b} size="sm" label="Move" />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <Dialog
        open={lostFor != null}
        onOpenChange={(o) => !o && setLostFor(null)}
        size="sm"
        title={`Mark ${lostFor?.name ?? ''} as lost`}
        footer={
          <>
            <Button onClick={() => setLostFor(null)}>Cancel</Button>
            <Button variant="danger" loading={move.pending} disabled={!reason.trim()} onClick={() => lostFor && move.run(lostFor, 'lost', reason)}>
              Mark as lost
            </Button>
          </>
        }
      >
        <Field label="Lost reason" required>
          {(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Dialog>
    </>
  );
}

function PipelineTable({ businesses }: { businesses: Business[] }) {
  const sorted = [...businesses].sort((a, b) => BOARD_STAGES.indexOf(b.stage) - BOARD_STAGES.indexOf(a.stage) || (b.opportunityScore ?? 0) - (a.opportunityScore ?? 0));
  if (!sorted.length) return <EmptyState title="Nothing in the pipeline" />;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-border bg-surface-muted/60 text-left text-xs text-subtle">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Business</th>
              <th scope="col" className="px-4 py-2 font-medium">Stage</th>
              <th scope="col" className="px-4 py-2 font-medium">Permission</th>
              <th scope="col" className="px-4 py-2 font-medium">Score</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Value</th>
              <th scope="col" className="px-4 py-2 font-medium">Expected close</th>
              <th scope="col" className="px-4 py-2 font-medium">Last contact</th>
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2">
                  <Link href={`/prospects/${b.id}`} className="font-medium hover:underline">
                    {b.name}
                  </Link>
                  <p className="text-xs text-subtle">{b.city}</p>
                </td>
                <td className="px-4 py-2">
                  <StageBadge stage={b.stage} />
                </td>
                <td className="px-4 py-2">
                  <PermissionBadge permission={b.contactPermission} />
                </td>
                <td className="px-4 py-2">
                  <ScorePill score={b.opportunityScore} confidence={b.confidenceScore} />
                </td>
                <td className="px-4 py-2 text-right tabular">{b.estimatedValue != null ? formatMoney(b.estimatedValue) : '—'}</td>
                <td className="px-4 py-2 text-xs">{formatDate(b.expectedCloseDate)}</td>
                <td className="px-4 py-2 text-xs text-subtle">{formatDate(b.lastInteractionAt)}</td>
                <td className="px-4 py-2 text-right">
                  <StageControl business={b} size="sm" label="Move" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function OpenTasks({ businesses }: { businesses: Business[] }) {
  const { data: tasks = [] } = useTasks();
  const toggle = useAction((ctx, id: string) => ctx.store.updateTask(id, { completedAt: new Date().toISOString() }), { success: 'Task completed' });
  const { can } = useWorkspace();
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const open = tasks.filter((t) => !t.completedAt).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const today = todayIso();
  return (
    <Card>
      <CardHeader title="Open tasks" description={`${open.length} open`} />
      {open.length === 0 ? (
        <EmptyState title="No open tasks" className="py-8" />
      ) : (
        <ul className="divide-y divide-border">
          {open.slice(0, 12).map((t) => (
            <li key={t.id} className="flex items-start gap-2.5 px-4 py-2.5">
              <input
                type="checkbox"
                aria-label={`Complete “${t.title}”`}
                disabled={!can('activities.write')}
                className="mt-0.5 size-4 accent-[var(--accent)]"
                onChange={() => toggle.run(t.id)}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{t.title}</p>
                <p className="text-xs text-subtle">
                  {t.businessId && (
                    <Link href={`/prospects/${t.businessId}?tab=activity`} className="hover:underline">
                      {names.get(t.businessId) ?? 'Prospect'}
                    </Link>
                  )}
                  {t.dueDate && <span className={cn(t.dueDate < today && 'text-danger')}> · due {formatDate(t.dueDate)}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function UpcomingMeetings({ businesses }: { businesses: Business[] }) {
  const { data: activities = [] } = useActivities();
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  const now = new Date().toISOString();
  const upcoming = activities.filter((a) => a.scheduledFor && a.scheduledFor >= now).sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));
  return (
    <Card>
      <CardHeader title="Scheduled contact" description="Meetings and calls logged for the future" />
      {upcoming.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing scheduled" className="py-8" />
      ) : (
        <ul className="divide-y divide-border">
          {upcoming.slice(0, 10).map((a) => (
            <li key={a.id} className="px-4 py-2.5">
              <p className="text-sm">{a.summary}</p>
              <p className="text-xs text-subtle">
                <Link href={`/prospects/${a.businessId}?tab=activity`} className="hover:underline">
                  {names.get(a.businessId) ?? 'Prospect'}
                </Link>{' '}
                · {formatDateTime(a.scheduledFor)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
