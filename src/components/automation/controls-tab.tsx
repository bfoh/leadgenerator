'use client';

import { OctagonX, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { budgetsSchema } from '@/lib/automation/budget';
import { aiReportEstimateUsd } from '@/lib/automation/pricing';
import { AUTOMATION_MODES, BUDGET_PROVIDER_LABELS, BUDGET_PROVIDERS, MODE_META, type AutomationMode, type BudgetProvider } from '@/lib/automation/constants';
import type { AutomationSettings, Budgets } from '@/lib/automation/types';
import { cn, formatDateTime } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { updateAutomationSettings, useAutomationAction } from '@/lib/workspace/automation';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';
import { usd } from './badges';

const OUTREACH_UNAVAILABLE = 'Not available in this version. The eligibility gateway and channel adapters exist for sandbox tests (Outreach); sending policies, message policies and quiet hours are in place (Outreach → Policies), and messages to businesses still need the owner and counsel checklist (Outreach → Setup).';

export function ControlsTab({ settings }: { settings: AutomationSettings }) {
  const { can } = useWorkspace();
  const manage = can('automation.manage');
  return (
    <div className="space-y-5">
      {!manage && (
        <Notice tone="neutral">Only owners and administrators can change automation controls. You can view them here.</Notice>
      )}
      <ModeCard settings={settings} manage={manage} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <QueueCard settings={settings} manage={manage} />
        <EmergencyStopCard settings={settings} />
      </div>
      <BudgetsCard settings={settings} manage={manage} />
    </div>
  );
}

function ModeCard({ settings, manage }: { settings: AutomationSettings; manage: boolean }) {
  const save = useAutomationAction(updateAutomationSettings, { success: (s) => `Mode set to ${MODE_META[s.mode].label}` });
  // Shows the choice straight away. It gives way to the saved settings once they change, and is
  // dropped if saving fails.
  const [choosing, setChoosing] = useState<{ mode: AutomationMode; basedOn: string } | null>(null);
  const shown = choosing && choosing.basedOn === settings.updatedAt ? choosing.mode : settings.mode;
  const choose = async (mode: AutomationMode) => {
    setChoosing({ mode, basedOn: settings.updatedAt });
    if (!(await save.run({ mode }))) setChoosing(null);
  };
  return (
    <Card>
      <CardHeader title="Automation mode" description="What agents may do without a person. New workspaces start in Research only; an API key alone never turns on outreach." />
      <CardBody>
        <fieldset>
          <legend className="sr-only">Automation mode</legend>
          <div className="grid gap-2 md:grid-cols-2">
            {AUTOMATION_MODES.map((mode: AutomationMode) => {
              const meta = MODE_META[mode];
              const unavailable = meta.outreach;
              const checked = shown === mode;
              return (
                <label
                  key={mode}
                  className={cn(
                    'flex gap-3 rounded-lg border border-border px-3.5 py-3 text-sm',
                    checked && 'border-accent ring-1 ring-accent',
                    unavailable || !manage ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-border-strong',
                  )}
                >
                  <input
                    type="radio"
                    name="automation-mode"
                    value={mode}
                    checked={checked}
                    disabled={unavailable || !manage || save.pending}
                    onChange={() => void choose(mode)}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                    aria-describedby={`mode-${mode}-help`}
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {meta.label}
                      {mode === 'research_only' && <Badge tone="neutral">Default</Badge>}
                      {unavailable && <Badge tone="warning">Unavailable</Badge>}
                    </span>
                    <span id={`mode-${mode}-help`} className="mt-0.5 block text-xs text-subtle">
                      {meta.description}
                      {unavailable && <span className="mt-1 block text-warning">{OUTREACH_UNAVAILABLE}</span>}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </CardBody>
    </Card>
  );
}

function QueueCard({ settings, manage }: { settings: AutomationSettings; manage: boolean }) {
  const save = useAutomationAction(updateAutomationSettings, {
    success: (s) => (s.paused ? 'Automation paused. Running jobs finish; nothing new starts.' : 'Automation resumed'),
  });
  const concurrency = useAutomationAction(updateAutomationSettings, { success: (s) => `Up to ${s.maxConcurrentJobs} jobs at a time` });
  return (
    <Card>
      <CardHeader title="Queue" description="Pausing stops new jobs from starting. Queued jobs keep their place." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Status:{' '}
            <Badge tone={settings.paused ? 'warning' : 'success'} dot>
              {settings.paused ? 'Paused' : 'Running'}
            </Badge>
          </p>
          {manage && (
            <Button variant={settings.paused ? 'primary' : 'secondary'} loading={save.pending} onClick={() => void save.run({ paused: !settings.paused })}>
              {settings.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              {settings.paused ? 'Resume automation' : 'Pause automation'}
            </Button>
          )}
        </div>
        <Field label="Jobs at the same time" hint="Lower values spread provider calls out; the maximum is 10.">
          {(p) => (
            <Select
              {...p}
              className="w-32"
              value={settings.maxConcurrentJobs}
              disabled={!manage || concurrency.pending}
              onChange={(e) => void concurrency.run({ maxConcurrentJobs: Number(e.target.value) })}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </CardBody>
    </Card>
  );
}

function EmergencyStopCard({ settings }: { settings: AutomationSettings }) {
  return (
    <Card className="border-danger/30">
      <CardHeader title="Outbound emergency stop" description="Blocks every email and WhatsApp message from the queue, whatever the mode." />
      <CardBody className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium text-danger">
          <OctagonX className="size-4" aria-hidden /> {settings.outboundStopped ? 'Engaged' : 'Released'}
        </p>
        <p className="text-sm text-muted">
          In this version the stop stays engaged and cannot be released: the gateway blocks every message to a business, and only the agency’s own sandbox test
          recipients can receive one (Outreach → Setup). When outreach is enabled, engaging it will cancel queued sends at once and stop running ones; only an owner
          will be able to release it, with a recorded reason.
        </p>
        {settings.outboundStopChangedAt && <p className="text-xs text-subtle">Last changed {formatDateTime(settings.outboundStopChangedAt)}</p>}
      </CardBody>
    </Card>
  );
}

type BudgetForm = Record<BudgetProvider, { dailyUsd: string; monthlyUsd: string }>;

function toForm(budgets: Budgets): BudgetForm {
  return Object.fromEntries(
    BUDGET_PROVIDERS.map((p) => [p, { dailyUsd: budgets[p]?.dailyUsd?.toString() ?? '', monthlyUsd: budgets[p]?.monthlyUsd?.toString() ?? '' }]),
  ) as BudgetForm;
}

function parseForm(form: BudgetForm): { budgets: Budgets } | { error: string } {
  const budgets: Budgets = {};
  for (const p of BUDGET_PROVIDERS) {
    const parse = (raw: string) => (raw.trim() === '' ? null : Number(raw));
    const dailyUsd = parse(form[p].dailyUsd);
    const monthlyUsd = parse(form[p].monthlyUsd);
    for (const v of [dailyUsd, monthlyUsd]) {
      if (v != null && (!Number.isFinite(v) || v < 0 || v > 100_000)) return { error: `${BUDGET_PROVIDER_LABELS[p]}: enter an amount between 0 and 100,000 US dollars, or leave it blank.` };
    }
    if (dailyUsd != null || monthlyUsd != null) budgets[p] = { dailyUsd, monthlyUsd };
  }
  const parsed = budgetsSchema.safeParse(budgets);
  return parsed.success ? { budgets: parsed.data } : { error: 'Check the budget amounts.' };
}

function BudgetsCard({ settings, manage }: { settings: AutomationSettings; manage: boolean }) {
  const [form, setForm] = useState(() => toForm(settings.budgets));
  const [error, setError] = useState<string | null>(null);
  const save = useAutomationAction(updateAutomationSettings, { success: 'Budgets saved' });
  const { data: status } = useServerStatus();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = parseForm(form);
    if ('error' in result) return setError(result.error);
    setError(null);
    void save.run({ budgets: result.budgets });
  };
  const set = (p: BudgetProvider, key: 'dailyUsd' | 'monthlyUsd', value: string) => setForm((f) => ({ ...f, [p]: { ...f[p], [key]: value } }));

  return (
    <Card>
      <CardHeader
        title="Budgets (US dollars, estimated)"
        description="Hard stops checked before every paid call, for automated and manual work. Blank means no limit, except that automated paid work never runs without a budget for its provider. Windows are the GMT day and month."
      />
      <form onSubmit={submit} noValidate>
        <CardBody className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left text-xs text-subtle">
                  <th scope="col" className="pb-2 font-medium">
                    Provider
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Daily limit
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    Monthly limit
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {BUDGET_PROVIDERS.map((p) => (
                  <tr key={p}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {BUDGET_PROVIDER_LABELS[p]}
                    </th>
                    {(['dailyUsd', 'monthlyUsd'] as const).map((key) => (
                      <td key={key} className="py-2 pr-3">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          placeholder="No limit"
                          aria-label={`${BUDGET_PROVIDER_LABELS[p]} ${key === 'dailyUsd' ? 'daily' : 'monthly'} limit in US dollars`}
                          value={form[p][key]}
                          disabled={!manage}
                          onChange={(e) => set(p, key, e.target.value)}
                          className="w-32"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs text-subtle">
            {status?.ai.model
              ? `Each AI report is checked against an upper estimate of ${usd(aiReportEstimateUsd(status.ai.model))} (${status.ai.model}) before it runs; the actual cost is recorded afterwards. `
              : 'AI reports are checked against an upper cost estimate before they run; the actual cost is recorded afterwards. '}
            Google Cloud budget alerts notify you but do not stop spending, so keep these limits set.
          </p>
          {manage && (
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={save.pending}>
                Save budgets
              </Button>
              <Button
                onClick={() => {
                  setForm(toForm(settings.budgets));
                  setError(null);
                }}
              >
                Reset
              </Button>
            </div>
          )}
        </CardBody>
      </form>
    </Card>
  );
}
