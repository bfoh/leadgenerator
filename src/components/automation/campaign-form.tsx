'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CAMPAIGN_FREQUENCIES, FREQUENCY_LABELS, GHANA_REGIONS, MAX_BATCH_SIZE, MAX_DAILY_TARGETS, WEEKDAY_LABELS, type CampaignFrequency, type CampaignScope, type ResearchCampaign } from '@/lib/domain/campaigns';
import { categoryGroups } from '@/lib/domain/settings';
import { IndustryScopePicker } from './industry-scope-picker';
import { DISCOVERY_SOURCE_CATALOG, discoverySourceBlocker } from '@/lib/domain/discovery-sources';
import { districtsIn } from '@/lib/domain/districts';
import { errorMessage } from '@/lib/utils';
import { useServerStatus } from '@/lib/workspace/api';
import { campaignApi, useCampaignRefresh, type CampaignPreview, type CampaignWriteBody } from '@/lib/workspace/campaigns';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function CampaignForm({
  open,
  onOpenChange,
  campaign,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved campaign to edit; omit to create a new one. */
  campaign?: ResearchCampaign;
  /** Research is running: the scope and schedule are locked until the batch finishes. */
  busy?: boolean;
}) {
  const editing = Boolean(campaign);
  const refresh = useCampaignRefresh();
  const { settings } = useWorkspace();
  const serverStatus = useServerStatus();
  const syntheticEnabled = serverStatus.data?.autonomousDiscovery?.syntheticEnabled ?? false;
  const groups = categoryGroups(settings);
  const [name, setName] = useState(campaign?.name ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [providerKey, setProviderKey] = useState(campaign?.providerKey ?? 'tracked_records');
  const [discoveryEnabled, setDiscoveryEnabled] = useState(campaign?.discovery.enabled ?? false);
  const [discoveryDailyLimit, setDiscoveryDailyLimit] = useState(String(campaign?.discovery.dailyLimit ?? 25));
  const [discoveryTotalLimit, setDiscoveryTotalLimit] = useState(String(campaign?.discovery.totalLimit ?? 100));
  const [discoveryQuality, setDiscoveryQuality] = useState(String(campaign?.discovery.qualityThreshold ?? 60));
  const [discoverySpendCap, setDiscoverySpendCap] = useState(campaign?.discovery.spendCapUsd != null ? String(campaign.discovery.spendCapUsd) : '');
  const [discoveryRequireReview, setDiscoveryRequireReview] = useState(campaign?.discovery.requireReview ?? true);
  const [nationwide, setNationwide] = useState(!campaign || campaign.scope.regions.length === 0);
  const [regions, setRegions] = useState<string[]>(campaign?.scope.regions ?? []);
  const [districtCodes, setDistrictCodes] = useState<string[]>(campaign?.scope.districtCodes ?? []);
  const [towns, setTowns] = useState(campaign?.scope.towns.join(', ') ?? '');
  const [categories, setCategories] = useState<string[]>(campaign?.scope.categories ?? []);
  const [frequency, setFrequency] = useState<CampaignFrequency>(campaign?.schedule.frequency ?? 'manual');
  const [hour, setHour] = useState(campaign?.schedule.hour ?? 6);
  const [weekday, setWeekday] = useState(campaign?.schedule.weekday ?? 1);
  const [day, setDay] = useState(campaign?.schedule.day ?? 1);
  const [batchSize, setBatchSize] = useState(String(campaign?.batchSize ?? 10));
  const [dailyLimit, setDailyLimit] = useState(String(campaign?.dailyTargetLimit ?? 50));
  const [budget, setBudget] = useState(campaign?.monthlyBudgetUsd != null ? String(campaign.monthlyBudgetUsd) : '');
  const [autoComplete, setAutoComplete] = useState(campaign?.autoComplete ?? true);
  const [activate, setActivate] = useState(!editing);
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
  const providerOptions = [
    { id: 'tracked_records', name: 'Prospects already tracked (no discovery)', blocker: null as string | null },
    ...DISCOVERY_SOURCE_CATALOG.map((source) => ({
      id: source.id,
      name: source.name,
      blocker: discoverySourceBlocker(source.id, { syntheticEnabled }),
    })),
  ];
  if (!providerOptions.some((option) => option.id === providerKey)) {
    providerOptions.push({ id: providerKey, name: providerKey, blocker: 'This provider is no longer available.' });
  }

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
        discovery: {
          enabled: providerKey !== 'tracked_records' && discoveryEnabled,
          dailyLimit: Number(discoveryDailyLimit) || 25,
          totalLimit: Number(discoveryTotalLimit) || 100,
          spendCapUsd: discoverySpendCap.trim() ? Number(discoverySpendCap) : null,
          qualityThreshold: Number(discoveryQuality) || 60,
          requireReview: discoveryRequireReview,
        },
        schedule: { frequency, hour, weekday: frequency === 'weekly' ? weekday : null, day: frequency === 'monthly' ? day : null },
        autoComplete,
      };
      if (campaign) {
        await campaignApi.update(campaign.id, body);
        toast.success('Campaign saved. Its recorded runs and prospect history are unchanged.');
      } else {
        const { campaign: created } = await campaignApi.create(body);
        if (activate) await campaignApi.update(created.id, { status: 'active' });
        toast.success(activate ? 'Campaign created and activated.' : 'Campaign saved as a draft.');
      }
      refresh();
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
      title={editing ? 'Edit campaign' : 'New research campaign'}
      description={
        editing
          ? 'Change the name, scope, schedule, quotas or budget. Runs already recorded and prospects already researched stay exactly as they are.'
          : 'Choose who to research, how often, and how much work may start. Campaigns research prospects you already track; a permitted discovery connector can add new businesses. They never search Google Places and never contact anyone.'
      }
      size="xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="campaign-form" variant="primary" loading={pending}>
            {editing ? 'Save changes' : activate ? 'Create and activate' : 'Save draft'}
          </Button>
        </>
      }
    >
      <form id="campaign-form" onSubmit={submit} className="space-y-5" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <FormRow label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ashanti pharmacies, Q4" required />
          </FormRow>
          <FormRow
            label="Prospect source"
            hint={
              editing
                ? 'Fixed when the campaign was created.'
                : 'Tracked prospects only, or a permitted discovery connector. Only the offline synthetic connector is available in this version.'
            }
          >
            <Select
              value={providerKey}
              onChange={(e) => {
                setProviderKey(e.target.value);
                if (e.target.value !== 'tracked_records') setDiscoveryEnabled(true);
              }}
              aria-label="Prospect source"
              disabled={editing}
            >
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={Boolean(provider.blocker)}>
                  {provider.name}
                  {provider.blocker ? ' — unavailable' : ''}
                </option>
              ))}
            </Select>
          </FormRow>
        </div>
        <FormRow label="Purpose (optional)" hint="Shown in the campaign list and its run log.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} />
        </FormRow>

        <fieldset className="space-y-3 rounded-lg border border-border px-3.5 py-3" disabled={busy}>
          <legend className="px-1 text-sm font-medium">Where</legend>
          {busy && (
            <Notice tone="info" title="Research is running">
              The scope and schedule are locked until the current batch finishes. The name, quotas, budget and auto-complete preference can still change.
            </Notice>
          )}
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
            <div className="sm:col-span-2">
              <IndustryScopePicker groups={groups} selected={categories} onChange={(next) => { setCategories(next); reset(); }} disabled={busy} />
            </div>
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-border px-3.5 py-3">
          <legend className="px-1 text-sm font-medium">When and how much</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormRow label="Schedule">
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value as CampaignFrequency)} disabled={busy}>
                {CAMPAIGN_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </Select>
            </FormRow>
            {frequency !== 'manual' && (
              <FormRow label="Hour (GMT)">
                <Select value={hour} onChange={(e) => setHour(Number(e.target.value))} disabled={busy}>
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
                <Select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={busy}>
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
                <Input type="number" min={1} max={28} value={day} onChange={(e) => setDay(Number(e.target.value))} disabled={busy} />
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

        <fieldset className="space-y-3 rounded-lg border border-border px-3.5 py-3" disabled={busy}>
          <legend className="px-1 text-sm font-medium">Autonomous discovery</legend>
          {providerKey === 'tracked_records' ? (
            <p className="text-xs text-subtle">
              This campaign only researches prospects you already track. Choose a discovery connector above to add new businesses automatically.
            </p>
          ) : (
            <>
              <Checkbox
                label="Discover new businesses on each scheduled run"
                description="Fetches one page per due run, within the provider's rate limit and the quotas below. No contact details are copied, and no message is sent."
                checked={discoveryEnabled}
                onChange={(e) => setDiscoveryEnabled(e.target.checked)}
              />
              <div className="grid gap-4 sm:grid-cols-4">
                <FormRow label="Records per day">
                  <Input type="number" min={1} max={500} value={discoveryDailyLimit} onChange={(e) => setDiscoveryDailyLimit(e.target.value)} />
                </FormRow>
                <FormRow label="Records in total">
                  <Input type="number" min={1} max={10000} value={discoveryTotalLimit} onChange={(e) => setDiscoveryTotalLimit(e.target.value)} />
                </FormRow>
                <FormRow label="Minimum quality (0–100)" hint="Below this, a record is rejected.">
                  <Input type="number" min={0} max={100} value={discoveryQuality} onChange={(e) => setDiscoveryQuality(e.target.value)} />
                </FormRow>
                <FormRow label="Discovery spend cap (USD, optional)" hint="Separate from the campaign budget.">
                  <Input type="number" min={0} step="0.01" value={discoverySpendCap} onChange={(e) => setDiscoverySpendCap(e.target.value)} placeholder="No cap" />
                </FormRow>
              </div>
              <Checkbox
                label="Require a person to review every discovered business"
                description="Recommended. Turning this off imports only records that clear a quality score of at least 80 with no identity concerns. The offline synthetic connector is the only one available; it is clearly labelled and disabled unless the server enables it."
                checked={discoveryRequireReview}
                onChange={(e) => setDiscoveryRequireReview(e.target.checked)}
              />
            </>
          )}
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
        <Checkbox
          label="Complete automatically when the scope is exhausted"
          description="When every matching prospect has been researched and none is left, the campaign closes itself. Recorded runs and prospect history stay readable. Leave this off to keep adding prospects to the same campaign later."
          checked={autoComplete}
          onChange={(e) => setAutoComplete(e.target.checked)}
        />
        {!editing && (
          <Checkbox label="Activate now" description="Queue the first batch immediately; otherwise the campaign is saved as a draft." checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        )}

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


