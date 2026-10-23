'use client';

// Phase 8 controls: the pause switch that holds every dispatch, the workspace sending policy
// (quiet hours, sending days, daily limits, per-recipient spacing) and approved-message policies.
// The gateway applies all of them at approval and dispatch, and the database enforces them again
// when a message moves to sending (migration 007).

import { Database, Pause, Play, Plus, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AutomationSettings } from '@/lib/automation/types';
import * as messaging from '@/lib/data/messaging-services';
import { SENDING_MIGRATION_REQUIRED } from '@/lib/data/store';
import {
  MESSAGE_CHANNEL_LABELS,
  MESSAGE_PURPOSE_LABELS,
  POLICY_DAILY_CAP_MAX,
  POLICY_MAX_DAYS,
  POLICY_STATUS_META,
  policyIssue,
  policyTemplateIssues,
  type MessagePolicy,
  type MessageTemplate,
} from '@/lib/domain/messaging';
import {
  DAILY_LIMIT_CEILING,
  POLICY_TIMEZONES,
  WEEKDAY_LABELS,
  describePolicyWindow,
  formatLocal,
  nextSendWindow,
  sendingPolicySchema,
  type SendingPolicy,
} from '@/lib/domain/sending-policy';
import { formatDateTime } from '@/lib/utils';
import { updateAutomationSettings, useAutomationAction, useAutomationSettings } from '@/lib/workspace/automation';
import { useAction, useMessagePolicies, useSendingSchema, useTemplates } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';

export function PoliciesTab() {
  const { can } = useWorkspace();
  const { data: schema } = useSendingSchema();
  const { data: settings } = useAutomationSettings();
  if (schema === false) {
    return (
      <Notice tone="warning" icon={Database} title="Sending policies are not set up for this workspace">
        {SENDING_MIGRATION_REQUIRED} Take a backup first (RUNBOOK.md, “Apply migration 007”). Until then no template is covered by a policy, so no message can be approved.
      </Notice>
    );
  }
  const manage = can('automation.manage');
  return (
    <div className="space-y-5">
      {!manage && <Notice tone="neutral">Only owners and administrators change sending controls and message policies. You can view them here.</Notice>}
      {settings && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <PauseCard settings={settings} manage={manage} />
          <WindowCard policy={settings.sendingPolicy} paused={settings.sendingPaused} />
        </div>
      )}
      <MessagePoliciesCard manage={can('outreach.approve')} />
      {settings && <SendingPolicyCard key={settings.updatedAt} settings={settings} manage={manage} />}
    </div>
  );
}

// ── Pause ────────────────────────────────────────────────────────────────────

function PauseCard({ settings, manage }: { settings: AutomationSettings; manage: boolean }) {
  const [reason, setReason] = useState('');
  const toggle = useAutomationAction((actx, paused: boolean) => updateAutomationSettings(actx, { sendingPaused: paused, sendingPauseReason: reason.trim() || null }), {
    success: (s) => (s.sendingPaused ? 'Sending paused. Queued messages wait; nothing is dispatched.' : 'Sending resumed'),
    onSuccess: () => setReason(''),
  });
  const paused = settings.sendingPaused;
  return (
    <Card>
      <CardHeader
        title="Pause all sending"
        description="Holds every dispatch at once, sandbox tests included. Queued messages stay queued and go when sending resumes, if every check still passes."
        actions={<Badge tone={paused ? 'warning' : 'success'}>{paused ? 'Paused' : 'Sending allowed'}</Badge>}
      />
      <CardBody className="space-y-3">
        {paused && (
          <p className="text-sm text-muted">
            Paused{settings.sendingPausedAt ? ` ${formatDateTime(settings.sendingPausedAt)}` : ''}: {settings.sendingPauseReason}
          </p>
        )}
        <Field label={paused ? 'Why sending can resume' : 'Reason (optional)'} required={paused} hint={paused ? 'Recorded in the audit trail.' : undefined}>
          {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} disabled={!manage} />}
        </Field>
        {paused ? (
          <Button variant="primary" disabled={!manage || !reason.trim()} loading={toggle.pending} onClick={() => void toggle.run(false)}>
            <Play aria-hidden /> Resume sending
          </Button>
        ) : (
          <Button variant="outline-danger" disabled={!manage} loading={toggle.pending} onClick={() => void toggle.run(true)}>
            <Pause aria-hidden /> Pause all sending
          </Button>
        )}
        <p className="text-xs text-subtle">
          The outbound emergency stop (Automation Center → Controls) is separate: it keeps messages to businesses off and cannot be lifted in this version.
        </p>
      </CardBody>
    </Card>
  );
}

function WindowCard({ policy, paused }: { policy: SendingPolicy; paused: boolean }) {
  const [now] = useState(() => new Date());
  const next = nextSendWindow(now, policy);
  return (
    <Card>
      <CardHeader title="When messages go" description="Applied at dispatch. A message caught by these rules waits in the queue; it is never sent early." />
      <CardBody className="space-y-2 text-sm">
        <p>
          <span className="font-medium">Sending window:</span> {describePolicyWindow(policy)}.
        </p>
        <p>
          <span className="font-medium">Next window:</span> {paused ? 'when sending resumes' : next.getTime() === now.getTime() ? 'open now' : formatLocal(next, policy.timezone)}.
        </p>
        <p>
          <span className="font-medium">Daily limits:</span> {policy.dailyLimit.email} emails and {policy.dailyLimit.whatsapp} WhatsApp messages.
        </p>
        <p>
          <span className="font-medium">Each recipient:</span> at most one business-initiated message every {policy.recipientMinGapDays} days and {policy.recipientMax30Days} in 30 days;{' '}
          {policy.maxUnansweredFollowUps === 0 ? 'no follow-ups without a reply' : `up to ${policy.maxUnansweredFollowUps} follow-up${policy.maxUnansweredFollowUps === 1 ? '' : 's'} without a reply`}.
        </p>
      </CardBody>
    </Card>
  );
}

// ── Sending policy form ──────────────────────────────────────────────────────

function NumberField({ label, hint, value, onChange, min, max, disabled }: { label: string; hint?: string; value: number; onChange: (n: number) => void; min: number; max: number; disabled: boolean }) {
  return (
    <Field label={label} hint={hint ?? `${min}–${max}`}>
      {(p) => <Input {...p} type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.valueAsNumber)} disabled={disabled} />}
    </Field>
  );
}

function SendingPolicyCard({ settings, manage }: { settings: AutomationSettings; manage: boolean }) {
  const [draft, setDraft] = useState<SendingPolicy>(settings.sendingPolicy);
  const [error, setError] = useState<string | null>(null);
  const save = useAutomationAction((actx, policy: SendingPolicy) => updateAutomationSettings(actx, { sendingPolicy: policy }), { success: 'Sending policy saved' });
  const set = <K extends keyof SendingPolicy>(key: K, value: SendingPolicy[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const changed = JSON.stringify(draft) !== JSON.stringify(settings.sendingPolicy);

  const submit = () => {
    const parsed = sendingPolicySchema.safeParse(draft);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the policy.');
    setError(null);
    void save.run(parsed.data);
  };

  return (
    <Card>
      <CardHeader title="Sending policy" description="Quiet hours always cover 22:00–06:00. Limits can be lowered freely; the database refuses values outside these ranges." />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Time zone">
            {(p) => (
              <Select {...p} value={draft.timezone} onChange={(e) => set('timezone', e.target.value as SendingPolicy['timezone'])} disabled={!manage}>
                {POLICY_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Quiet hours start" hint="Between 17:00 and 22:00">
            {(p) => <Input {...p} type="time" value={draft.quietStart} onChange={(e) => set('quietStart', e.target.value)} disabled={!manage} />}
          </Field>
          <Field label="Quiet hours end" hint="Between 06:00 and 10:00">
            {(p) => <Input {...p} type="time" value={draft.quietEnd} onChange={(e) => set('quietEnd', e.target.value)} disabled={!manage} />}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Sending days</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <Checkbox
                key={d}
                label={WEEKDAY_LABELS[d]}
                checked={draft.sendDays.includes(d)}
                disabled={!manage}
                onChange={(e) => set('sendDays', e.target.checked ? [...draft.sendDays, d].sort() : draft.sendDays.filter((x) => x !== d))}
              />
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField label="Emails per day" value={draft.dailyLimit.email} onChange={(n) => set('dailyLimit', { ...draft.dailyLimit, email: n })} min={0} max={DAILY_LIMIT_CEILING} disabled={!manage} />
          <NumberField label="WhatsApp messages per day" value={draft.dailyLimit.whatsapp} onChange={(n) => set('dailyLimit', { ...draft.dailyLimit, whatsapp: n })} min={0} max={DAILY_LIMIT_CEILING} disabled={!manage} />
          <NumberField label="Days between messages to one recipient" value={draft.recipientMinGapDays} onChange={(n) => set('recipientMinGapDays', n)} min={1} max={60} disabled={!manage} />
          <NumberField label="Messages to one recipient in 30 days" value={draft.recipientMax30Days} onChange={(n) => set('recipientMax30Days', n)} min={1} max={10} disabled={!manage} />
          <NumberField label="Follow-ups without a reply" value={draft.maxUnansweredFollowUps} onChange={(n) => set('maxUnansweredFollowUps', n)} min={0} max={3} disabled={!manage} />
          <NumberField
            label="Approval stays valid for (days)"
            hint="8–30. Older approvals are not sent."
            value={draft.approvalMaxAgeDays}
            onChange={(n) => set('approvalMaxAgeDays', n)}
            min={8}
            max={30}
            disabled={!manage}
          />
        </div>
        <FormError message={error} />
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!changed} loading={save.pending} onClick={submit}>
              Save sending policy
            </Button>
            <Button disabled={!changed} onClick={() => setDraft(settings.sendingPolicy)}>
              Discard changes
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ── Approved-message policies ────────────────────────────────────────────────

function MessagePoliciesCard({ manage }: { manage: boolean }) {
  const { data: policies = [] } = useMessagePolicies();
  const { data: templates = [] } = useTemplates();
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => new Date());
  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const status = useAction(messaging.setPolicyStatus, { success: (p) => `Policy ${POLICY_STATUS_META[p.status].label.toLowerCase()}` });

  return (
    <Card>
      <CardHeader
        title="Message policies"
        description="An owner or admin’s standing approval for one message type: an approved template at its current version, with a daily cap and an expiry. A message must be covered by an active policy before it can be approved; a person still approves each one."
        actions={
          manage && (
            <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> New policy
            </Button>
          )
        }
      />
      {policies.length ? (
        <ul className="divide-y divide-border">
          {policies.map((p) => {
            const t = byId.get(p.templateId) ?? null;
            const issue = policyIssue(p, t, now);
            return (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="message-policy">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {p.name} <Badge tone={issue ? 'warning' : POLICY_STATUS_META[p.status].tone}>{issue ? 'Not covering' : POLICY_STATUS_META[p.status].label}</Badge>
                  </p>
                  <p className="text-xs text-subtle">
                    {MESSAGE_CHANNEL_LABELS[p.channel]} · {MESSAGE_PURPOSE_LABELS[p.purpose]} · “{t?.name ?? 'Deleted template'}” version {p.templateVersion} · up to {p.dailyCap} a day · expires {p.expiresAt.slice(0, 10)}
                  </p>
                  {issue && <p className="text-xs text-warning">{issue}</p>}
                  {p.note && <p className="text-xs text-muted">{p.note}</p>}
                </div>
                {manage && p.status !== 'revoked' && (
                  <div className="flex shrink-0 gap-2 self-end sm:self-auto">
                    {p.status === 'active' ? (
                      <Button size="sm" loading={status.pending} onClick={() => void status.run(p, 'paused')}>
                        Pause
                      </Button>
                    ) : (
                      <Button size="sm" loading={status.pending} onClick={() => void status.run(p, 'active')}>
                        Resume
                      </Button>
                    )}
                    <Button size="sm" variant="outline-danger" loading={status.pending} onClick={() => void status.run(p, 'revoked')} aria-label={`Revoke policy ${p.name}`}>
                      Revoke
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="No message policies"
          description="Without one, no message can be approved. Approve a template first (Templates), then cover it with a policy here."
          className="py-10"
        />
      )}
      {creating && <PolicyDialog templates={templates} policies={policies} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function PolicyDialog({ templates, policies, onClose }: { templates: MessageTemplate[]; policies: MessagePolicy[]; onClose: () => void }) {
  const eligible = templates.filter((t) => !policyTemplateIssues(t).length && !policies.some((p) => p.templateId === t.id && p.templateVersion === t.version && p.status !== 'revoked'));
  const [form, setForm] = useState<messaging.PolicyForm>({ ...messaging.DEFAULT_POLICY_FORM, templateId: eligible[0]?.id ?? '', name: eligible[0] ? `${eligible[0].name} (v${eligible[0].version})` : '' });
  const create = useAction((ctx, f: messaging.PolicyForm) => messaging.createPolicy(ctx, f, templates), { success: 'Message policy active', onSuccess: onClose });
  const set = (patch: Partial<messaging.PolicyForm>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="New message policy"
      description="You approve this message type as it is now. Editing the template ends the cover; messages still need a person’s approval, consent and every other check."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.templateId} loading={create.pending} onClick={() => void create.run(form)}>
            Approve policy
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template" required className="sm:col-span-2" hint={eligible.length ? undefined : 'No approved template without a policy. Approve one in Templates first.'}>
          {(p) => (
            <Select
              {...p}
              value={form.templateId}
              onChange={(e) => {
                const t = eligible.find((x) => x.id === e.target.value);
                set({ templateId: e.target.value, name: t ? `${t.name} (v${t.version})` : form.name });
              }}
            >
              <option value="">Choose an approved template</option>
              {eligible.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {MESSAGE_CHANNEL_LABELS[t.channel]} · {MESSAGE_PURPOSE_LABELS[t.purpose]} · v{t.version}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Policy name" required className="sm:col-span-2">
          {(p) => <Input {...p} value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />}
        </Field>
        <Field label="Messages per day under this policy" hint={`1–${POLICY_DAILY_CAP_MAX}; the workspace daily limit also applies`}>
          {(p) => <Input {...p} type="number" min={1} max={POLICY_DAILY_CAP_MAX} value={String(form.dailyCap)} onChange={(e) => set({ dailyCap: e.target.value })} />}
        </Field>
        <Field label="Valid for (days)" hint={`Up to ${POLICY_MAX_DAYS}`}>
          {(p) => <Input {...p} type="number" min={1} max={POLICY_MAX_DAYS} value={String(form.days)} onChange={(e) => set({ days: e.target.value })} />}
        </Field>
        <Field label="Note (optional)" className="sm:col-span-2" hint="Why this message type is approved, or who it is for.">
          {(p) => <Textarea {...p} rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} />}
        </Field>
      </div>
    </Dialog>
  );
}
