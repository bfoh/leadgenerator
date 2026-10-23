'use client';

import { CalendarClock, Check, ListTodo, MessageSquare, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import * as svc from '@/lib/data/services';
import { ACTIVITY_LABELS, CONTACT_ACTIVITIES, LOGGABLE_ACTIVITIES, type ActivityType } from '@/lib/domain/constants';
import { taskFormSchema, fieldErrors } from '@/lib/domain/schemas';
import type { Business, Task } from '@/lib/domain/types';
import { cn, formatDate, formatDateTime, todayIso } from '@/lib/utils';
import { useAction, useActivities, useTasks } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { ProspectAutomationHistory } from '@/components/automation/prospect-automation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/misc';

export function ActivityTab({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const { data: activities = [] } = useActivities(business.id);
  const sorted = [...activities].sort((a, b) => (b.scheduledFor ?? b.occurredAt).localeCompare(a.scheduledFor ?? a.occurredAt));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        {can('activities.write') && <LogActivity business={business} />}
        <Card>
          <CardHeader title="Timeline" description="Stage changes, verifications, reports and proposals are logged automatically." />
          {sorted.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No activity yet" />
          ) : (
            <ol className="divide-y divide-border">
              {sorted.map((a) => {
                const text = typeof a.details?.text === 'string' ? a.details.text : null;
                return (
                  <li key={a.id} className="flex gap-3 px-4 py-3">
                    <Badge tone={CONTACT_ACTIVITIES.includes(a.type) ? 'info' : a.type === 'stage_change' ? 'accent' : 'neutral'} className="mt-0.5 shrink-0">
                      {ACTIVITY_LABELS[a.type]}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{a.summary}</p>
                      {text && <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{text}</p>}
                      <p className="mt-0.5 text-xs text-subtle">
                        {a.scheduledFor ? (
                          <>
                            <CalendarClock className="mr-1 inline size-3" aria-hidden />
                            Scheduled for {formatDateTime(a.scheduledFor)}
                          </>
                        ) : (
                          formatDateTime(a.occurredAt)
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <ProspectAutomationHistory business={business} />
      </div>
      <TaskList businessId={business.id} />
    </div>
  );
}

function LogActivity({ business }: { business: Business }) {
  const permitted = business.contactPermission === 'granted';
  const [type, setType] = useState<ActivityType>('note');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [scheduled, setScheduled] = useState('');
  const [error, setError] = useState<string | null>(null);
  const log = useAction(svc.logActivity, {
    success: 'Logged',
    onSuccess: () => {
      setSummary('');
      setDetails('');
      setScheduled('');
    },
  });
  const contact = CONTACT_ACTIVITIES.includes(type);

  return (
    <Card>
      <CardHeader title="Log activity" description={permitted ? 'Calls, meetings and messages require recorded permission — this business has it.' : 'Calls, meetings, emails and WhatsApp need recorded contact permission first. Notes are always allowed.'} />
      <CardBody>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!summary.trim()) return setError('Add a short summary');
            setError(null);
            log.run(business, { type, summary, details, scheduledFor: scheduled ? new Date(scheduled).toISOString() : null });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <Field label="Type">
              {(p) => (
                <Select {...p} value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
                  {LOGGABLE_ACTIVITIES.map((t) => (
                    <option key={t} value={t} disabled={CONTACT_ACTIVITIES.includes(t) && !permitted}>
                      {ACTIVITY_LABELS[t]}
                      {CONTACT_ACTIVITIES.includes(t) && !permitted ? ' (needs permission)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Summary" required error={error ?? undefined}>
              {(p) => <Input {...p} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={500} />}
            </Field>
          </div>
          <Field label="Details">{(p) => <Textarea {...p} rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
          {contact && (
            <Field label="Schedule for later" hint="Leave blank if it already happened. Meetings in the future appear in Overview.">
              {(p) => <Input {...p} type="datetime-local" value={scheduled} onChange={(e) => setScheduled(e.target.value)} className="sm:w-64" />}
            </Field>
          )}
          <Button type="submit" variant="primary" loading={log.pending}>
            {scheduled ? 'Schedule' : 'Log'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function TaskList({ businessId, projectId, title = 'Tasks' }: { businessId?: string; projectId?: string; title?: string }) {
  const { can } = useWorkspace();
  const { data: tasks = [] } = useTasks();
  const [newTitle, setNewTitle] = useState('');
  const [due, setDue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mine = tasks
    .filter((t) => (businessId ? t.businessId === businessId : true) && (projectId ? t.projectId === projectId : true))
    .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const add = useAction((ctx, title: string, dueDate: string | null) =>
    ctx.store.createTask({ businessId: businessId ?? null, projectId: projectId ?? null, title, dueDate, completedAt: null, assigneeId: ctx.userId }),
  );
  const toggle = useAction((ctx, task: Task) => ctx.store.updateTask(task.id, { completedAt: task.completedAt ? null : new Date().toISOString() }));
  const remove = useAction((ctx, task: Task) => ctx.store.deleteTask(task.id), { success: 'Task deleted' });
  const today = todayIso();
  const writable = can('activities.write');

  return (
    <Card className="self-start">
      <CardHeader title={title} />
      <CardBody className="space-y-3">
        {writable && (
          <form
            noValidate
            className="space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const parsed = taskFormSchema.safeParse({ title: newTitle, dueDate: due });
              if (!parsed.success) return setErrors(fieldErrors(parsed.error));
              setErrors({});
              const created = await add.run(parsed.data.title, parsed.data.dueDate);
              if (created) {
                setNewTitle('');
                setDue('');
                toast.success('Task added');
              }
            }}
          >
            <Field label="New task" error={errors.title}>
              {(p) => <Input {...p} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Confirm Instagram handle" />}
            </Field>
            <div className="flex gap-2">
              <Input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.target.value)} />
              <Button type="submit" loading={add.pending}>
                Add
              </Button>
            </div>
          </form>
        )}
        {mine.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks" className="py-6" />
        ) : (
          <ul className="divide-y divide-border">
            {mine.map((t) => (
              <li key={t.id} className="flex items-start gap-2 py-2">
                <button
                  type="button"
                  disabled={!writable}
                  onClick={() => toggle.run(t)}
                  aria-label={t.completedAt ? `Mark “${t.title}” as not done` : `Mark “${t.title}” as done`}
                  aria-pressed={Boolean(t.completedAt)}
                  className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-border-strong', t.completedAt && 'border-success bg-success text-white')}
                >
                  {t.completedAt && <Check className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', t.completedAt && 'text-subtle line-through')}>{t.title}</p>
                  {t.dueDate && <p className={cn('text-xs', !t.completedAt && t.dueDate < today ? 'text-danger' : 'text-subtle')}>Due {formatDate(t.dueDate)}</p>}
                </div>
                {writable && (
                  <button type="button" onClick={() => remove.run(t)} className="rounded p-1 text-subtle hover:bg-surface-hover hover:text-danger" aria-label={`Delete task “${t.title}”`}>
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
