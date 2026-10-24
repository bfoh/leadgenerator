'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CAMPAIGN_FREQUENCIES, FREQUENCY_LABELS, GHANA_REGIONS, MAX_BATCH_SIZE, MAX_DAILY_TARGETS, WEEKDAY_LABELS, type CampaignFrequency, type CampaignScope } from '@/lib/domain/campaigns';
import { DEFAULT_CATEGORIES } from '@/lib/domain/categories';
import { DISCOVERY_PROVIDER_CATALOG, campaignProviderBlocker } from '@/lib/domain/discovery-providers';
import { districtsIn } from '@/lib/domain/districts';
import { errorMessage } from '@/lib/utils';
import { campaignApi, useCampaignRefresh, type CampaignPreview, type CampaignWriteBody } from '@/lib/workspace/campaigns';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const CATEGORY_LABELS = DEFAULT_CATEGORIES.map((c) => c.label);

export function CampaignForm({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const refresh = useCampaignRefresh();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [providerKey, setProviderKey] = useState('tracked_records');
  const [nationwide, setNationwide] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [districtCodes, setDistrictCodes] = useState<string[]>([]);
  const [towns, setTowns] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<CampaignFrequency>('manual');
  const [hour, setHour] = useState(6);
  const [weekday, setWeekday] = useState(1);
  const [day, setDay] = useState(1);
  const [batchSize, setBatchSize] = useState('10');
  const [dailyLimit, setDailyLimit] = useState('50');
  const [budget, setBudget] = useState('');
  const [activate, setActivate] = useState(true);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const scope: CampaignScope = {
    regions: nationwide ? [] : regions,
    districtCodes: nationwide ? [] : districtCodes,
    towns: towns
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    categories,
  };
  const districtOptions = nationwide ? [] : regions.flatMap((region) => districtsIn(region)).sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const reset = () => setPreview(null);

  async function runPreview() {
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await campaignApi.preview(scope));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const body: CampaignWriteBody = {
        name: name.trim(),
        description: description.trim() || null,
        providerKey,
        scope,
        batchSize: Number(batchSize) || 10,
        dailyTargetLimit: Number(dailyLimit) || 50,
        monthlyBudgetUsd: budget.trim() ? Number(budget) : null,
        schedule: { frequency, hour, weekday: frequency === 'weekly' ? weekday : null, day: frequency === 'monthly' ? day : null },
      };
      const { campaign } = await campaignApi.create(body);
      if (activate) await campaignApi.update(campaign.id, { status: 'active' });
      refresh();
      toast.success(activate ? 'Campaign created and activated.' : 'Campaign saved as a draft.');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New research campaign"
      description="Choose who to research, how often, and how much work may start. Campaigns re-read prospects you already track; they never search Google Places and never contact anyone."
      size="xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="campaign-form" variant="primary" loading={pending}>
            {activate ? 'Create and activate' : 'Save draft'}
          </Button>
        </>
      }
    >
      <form id="campaign-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <FormRow label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ashanti pharmacies, Q4" required />
          </FormRow>
          <FormRow label="Research provider">
            <Select value={providerKey} onChange={(e) => setProviderKey(e.target.value)} aria-label="Research provider">
              {DISCOVERY_PROVIDER_CATALOG.map((provider) => {
                const blocker = campaignProviderBlocker(provider.id);
                return (
                  <option key={provider.id} value={provider.id} disabled={Boolean(blocker)}>
                    {provider.name}
                    {blocker ? ' — not available for campaigns' : provider.status === 'not_integrated' ? ' — not integrated' : ''}
                  </option>
                );
              })}
            </Select>
          </FormRow>
        </div>
        <FormRow label="Purpose (optional)" hint="Shown in the campaign list and its run log.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
        </FormRow>

        <fieldset className="space-y-3 rounded-lg border border-border px-3.5 py-3">
          <legend className="px-1 text-sm font-medium">Where</legend>
          <div className="flex flex-wrap gap-4">
            <Checkbox label="Nationwide (all 16 regions)" checked={nationwide} onChange={(e) => { setNationwide(e.target.checked); reset(); }} />
            <Checkbox label="Choose regions" checked={!nationwide} onChange={(e) => { setNationwide(!e.target.checked); if (!e.target.checked) setDistrictCodes([]); reset(); }} />
          </div>
          {!nationwide && (
            <div>
              <p className="mb-1.5 text-xs text-subtle">Regions ({regions.length} selected)</p>
              <div className="grid max-h-40 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
                {GHANA_REGIONS.map((region) => (
                  <Checkbox
                    key={region.code}
                    label={region.name}
                    checked={regions.includes(region.name)}
                    onChange={() => {
                      toggle(regions, region.name, setRegions);
                      setDistrictCodes([]);
                      reset();
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {!nationwide && districtOptions.length > 0 && (
            <details className="rounded-md border border-border bg-surface-muted/50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium">
                Districts ({districtCodes.length} of {districtOptions.length} selected) — optional
              </summary>
              <div className="mt-2 grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto pr-2 sm:grid-cols-3">
                {districtOptions.map((district) => (
                  <Checkbox
                    key={district.code}
                    label={district.name}
                    checked={districtCodes.includes(district.code)}
                    onChange={() => {
                      toggle(districtCodes, district.code, setDistrictCodes);
                      reset();
                    }}
                  />
                ))}
              </div>
            </details>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Towns or neighbourhoods (optional)" hint="Comma-separated; exact names, matched case-insensitively. Blank means every town.">
              <Input value={towns} onChange={(e) => { setTowns(e.target.value); reset(); }} placeholder="Kumasi, Obuasi" maxLength={400} />
            </FormRow>
            <div>
              <p className="mb-1.5 text-xs font-medium">Industries ({categories.length ? `${categories.length} selected` : 'all industries'})</p>
              <div className="grid max-h-32 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto pr-2">
                {CATEGORY_LABELS.map((label) => (
                  <Checkbox key={label} label={label} checked={categories.includes(label)} onChange={() => { toggle(categories, label, setCategories); reset(); }} />
                ))}
              </div>
            </div>
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-border px-3.5 py-3">
          <legend className="px-1 text-sm font-medium">When and how much</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormRow label="Schedule">
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value as CampaignFrequency)}>
                {CAMPAIGN_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </Select>
            </FormRow>
            {frequency !== 'manual' && (
              <FormRow label="Hour (GMT)">
                <Select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </Select>
              </FormRow>
            )}
            {frequency === 'weekly' && (
              <FormRow label="Day of the week">
                <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormRow>
            )}
            {frequency === 'monthly' && (
              <FormRow label="Day of the month">
                <Input type="number" min={1} max={28} value={day} onChange={(e) => setDay(Number(e.target.value))} />
              </FormRow>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <FormRow label="Prospects per run" hint={`Up to ${MAX_BATCH_SIZE}.`}>
              <Input type="number" min={1} max={MAX_BATCH_SIZE} value={batchSize} onChange={(e) => setBatchSize(e.target.value)} />
            </FormRow>
            <FormRow label="Prospects per day" hint={`Up to ${MAX_DAILY_TARGETS}.`}>
              <Input type="number" min={1} max={MAX_DAILY_TARGETS} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
            </FormRow>
            <FormRow label="Monthly budget (USD, optional)" hint="No new prospects start once the campaign has spent this much.">
              <Input type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No campaign limit" />
            </FormRow>
          </div>
        </fieldset>

        <Card className="border-dashed">
          <CardBody className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={runPreview} loading={previewing}>
                Preview the audience
              </Button>
              {preview && (
                <p className="text-sm" role="status">
                  <strong className="tabular">{preview.matched}</strong> tracked prospect(s) match; {preview.excluded} excluded by consent or record state.
                </p>
              )}
            </div>
            {preview && preview.sample.length > 0 && (
              <ul className="space-y-0.5 text-xs text-muted">
                {preview.sample.map((item) => (
                  <li key={item.id}>
                    {item.name} · {[item.city, item.region, item.category].filter(Boolean).join(' · ')}
                  </li>
                ))}
              </ul>
            )}
            {preview && preview.matched === 0 && <p className="text-xs text-warning">Nothing matches yet. Add prospects, or widen the scope.</p>}
          </CardBody>
        </Card>

        {error && <Notice tone="danger">{error}</Notice>}
        <Checkbox label="Activate now" description="Queue the first batch immediately; otherwise the campaign is saved as a draft." checked={activate} onChange={(e) => setActivate(e.target.checked)} />

      </form>
    </Dialog>
  );
}

/** Label + control + hint. The control sits inside the label, so it is named without extra wiring. */
function FormRow({ label, hint, required, children }: { label: React.ReactNode; hint?: React.ReactNode; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className="block text-xs text-subtle">{hint}</span>}
    </label>
  );
}


