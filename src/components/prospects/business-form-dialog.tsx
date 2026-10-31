'use client';

import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { z } from 'zod';
import * as svc from '@/lib/data/services';
import {
  BUDGET_LABELS,
  BUDGET_SIGNALS,
  BUSINESS_STATUSES,
  BUSINESS_STATUS_LABELS,
  INTEREST_LABELS,
  INTEREST_LEVELS,
  SOCIAL_PLATFORMS,
  SOURCE_KIND_LABELS,
  type SocialPlatform,
  type SourceKind,
} from '@/lib/domain/constants';
import { findDuplicates } from '@/lib/domain/dedupe';
import { districtsIn, findDistrict } from '@/lib/domain/districts';
import { COUNTRIES, citiesFor, findCountry, neighborhoodsFor, regionForCity } from '@/lib/domain/geo';
import { normalizePlaceId, placeReferenceName } from '@/lib/domain/places-intake';
import { INDEPENDENT_SOURCE_KINDS, SAVE_MODES, saveModeFor, sourceEvidenceIssues, sourceKindForMode, SOURCE_EVIDENCE_RULES, type IndependentSourceKind, type SaveMode } from '@/lib/domain/research-source';
import { businessFormSchema, businessToForm, fieldErrors, type BusinessForm } from '@/lib/domain/schemas';
import { categoryGroups } from '@/lib/domain/settings';
import type { Business, BusinessInsert } from '@/lib/domain/types';
import { useAction, useBusinesses } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

type FormInput = z.input<typeof businessFormSchema>;

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  whatsapp_business: 'WhatsApp Business',
  other: 'Other',
};

/** Field names as a person reads them, so a failed save names what to fix. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Business name',
  category: 'Category',
  country: 'Country',
  region: 'Region',
  districtCode: 'District',
  city: 'City / town',
  neighborhood: 'Neighbourhood',
  address: 'Address',
  businessStatus: 'Operating status',
  officialWebsite: 'Official website',
  enquiryChannel: 'Enquiry channel',
  phone: 'Business phone',
  email: 'Business email',
  contactSource: 'Where the contact details were published',
  serviceNeeds: 'Service needs',
  estimatedValue: 'Estimated value',
  expectedCloseDate: 'Expected close date',
  nextAction: 'Next action',
  nextActionDue: 'Next action due',
  notes: 'Research notes',
  sourceUrl: 'Source URL',
  sourceKind: 'Source type',
  placesPlaceId: 'Google Place ID',
};

/** Actionable summary: "Google Place ID: paste the ID…", never "Check the highlighted fields." */
export function describeFormIssues(issues: Record<string, string>): string {
  const entries = Object.entries(issues);
  if (!entries.length) return '';
  const label = (field: string) => (field.startsWith('socialProfiles') ? 'Social profile URL' : (FIELD_LABELS[field] ?? 'A field'));
  const shown = entries.slice(0, 2).map(([field, message]) => {
    const name = label(field);
    return message.toLowerCase().startsWith(name.toLowerCase()) ? message : `${name}: ${message}`;
  });
  return entries.length > 2 ? `${shown.join(' ')} (+${entries.length - 2} more to fix)` : shown.join(' ');
}

const SAVE_MODE_COPY: Record<SaveMode, { title: string; detail: string }> = {
  place_reference: {
    title: 'Save Place ID as a research reference',
    detail: 'Keeps the Google Place ID, the location you choose and a name generated from the ID. No listing name, address, phone, review or photo is stored.',
  },
  independent: {
    title: 'Add independently supported business details',
    detail: 'Cites the source you checked: the business’s own page, a licensed directory, its own submission or your own research.',
  },
};

const SOURCE_URL_HINTS: Record<IndependentSourceKind, string> = {
  manual: 'The page you checked while researching this business.',
  directory: 'The directory entry you confirmed the details from.',
  search: 'The page the search led to — not a Google or social listing.',
  direct_submission: 'Optional: the form or page the business used, if there is one.',
  referral: 'Optional: a link to the referral note, if there is one.',
  provider_discovery: 'The permitted provider’s record you reviewed.',
  social_profile: 'The business’s own public profile page.',
  legacy_seed: 'Optional: the archived source, if one exists.',
};

export function emptyBusinessForm(overrides: Partial<FormInput> = {}): FormInput {
  return {
    name: '',
    category: '',
    country: 'GH',
    region: '',
    districtCode: '',
    city: '',
    neighborhood: '',
    address: '',
    businessStatus: 'unknown',
    officialWebsite: '',
    socialProfiles: [],
    enquiryChannel: '',
    phone: '',
    email: '',
    contactSource: '',
    interestLevel: 'unknown',
    budgetSignal: 'unknown',
    serviceNeeds: [],
    estimatedValue: '',
    expectedCloseDate: '',
    nextAction: '',
    nextActionDue: '',
    notes: '',
    sourceUrl: '',
    sourceKind: 'manual',
    placesPlaceId: '',
    ...overrides,
  };
}

function text(v: unknown) {
  return v == null ? '' : String(v);
}

export function BusinessFormDialog({
  open,
  onOpenChange,
  business,
  initial,
  extra,
  notice,
  requireIndependentSource,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  business?: Business;
  initial?: Partial<FormInput>;
  extra?: Partial<BusinessInsert>;
  notice?: React.ReactNode;
  /** Places content cannot be stored: the record must cite a non-Google source for its details. */
  requireIndependentSource?: boolean;
  onSaved?: (business: Business) => void;
}) {
  const { settings } = useWorkspace();
  const { data: existing = [] } = useBusinesses();
  const [form, setForm] = useState<FormInput>(() => (business ? businessToForm(business) : emptyBusinessForm(initial)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useAction((ctx, f: BusinessForm) => svc.createBusiness(ctx, f, extra), {
    success: 'Research candidate added',
    onSuccess: (b) => {
      onOpenChange(false);
      onSaved?.(b);
    },
  });
  const update = useAction((ctx, b: Business, f: BusinessForm) => svc.updateBusinessProfile(ctx, b, f), {
    success: 'Profile saved',
    onSuccess: (b) => {
      onOpenChange(false);
      onSaved?.(b);
    },
  });

  const set = <K extends keyof FormInput>(key: K, value: FormInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const country = findCountry(text(form.country));
  const groups = categoryGroups(settings);
  const duplicates = useMemo(
    () =>
      text(form.name).trim().length > 2
        ? findDuplicates(
            { id: business?.id, name: text(form.name), city: text(form.city), officialWebsite: text(form.officialWebsite) || null, phone: text(form.phone) || null, placesPlaceId: text(form.placesPlaceId) || null },
            existing,
          ).slice(0, 3)
        : [],
    [form.name, form.city, form.officialWebsite, form.phone, form.placesPlaceId, existing, business?.id],
  );
  const socials = (form.socialProfiles ?? []) as { platform: SocialPlatform; url: string }[];
  const mode = saveModeFor(text(form.sourceKind) as SourceKind);
  const referenceMode = mode === 'place_reference';
  const independentKind = (referenceMode ? 'manual' : text(form.sourceKind)) as IndependentSourceKind;
  const urlRequired = !referenceMode && (SOURCE_EVIDENCE_RULES[independentKind]?.url === 'required' || Boolean(requireIndependentSource));

  function setMode(next: SaveMode) {
    setErrors({});
    setForm((f) => ({ ...f, sourceKind: sourceKindForMode(next, text(f.sourceKind) as SourceKind) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const typedPlaceId = text(form.placesPlaceId);
    const placeId = normalizePlaceId(typedPlaceId);
    const typedName = text(form.name).trim();
    // A Place ID reference needs no invented name: the placeholder is derived from the ID itself.
    const name = referenceMode && !typedName && placeId ? placeReferenceName(placeId) : text(form.name);
    const parsed = businessFormSchema.safeParse({
      ...form,
      name,
      // A reference cites the Place ID, never a Google page or a leftover URL from the other mode.
      sourceUrl: referenceMode ? '' : text(form.sourceUrl),
      placesPlaceId: referenceMode ? (placeId ?? typedPlaceId) : typedPlaceId,
      socialProfiles: socials.filter((s) => s.url.trim()),
      serviceNeeds: ((form.serviceNeeds ?? []) as string[]).map((s) => s.trim()).filter(Boolean),
    });
    const issues: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);
    for (const issue of sourceEvidenceIssues({
      sourceKind: text(form.sourceKind) as SourceKind,
      sourceUrl: text(form.sourceUrl),
      placesPlaceId: typedPlaceId,
      contactSource: text(form.contactSource),
      notes: text(form.notes),
      requireIndependentSource: urlRequired,
    })) {
      if (!issues[issue.field]) issues[issue.field] = issue.message;
    }
    if (!parsed.success || Object.keys(issues).length) {
      setErrors(issues);
      setFormError(describeFormIssues(issues));
      return;
    }
    setErrors({});
    if (duplicates.some((d) => d.strength === 'exact') && !business) {
      setFormError('This business is already tracked. Open the existing record instead.');
      return;
    }
    if (business) await update.run(business, parsed.data);
    else await create.run(parsed.data);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={business ? `Edit ${business.name}` : 'Add research candidate'}
      description={
        business
          ? 'Changes are recorded in the audit trail.'
          : referenceMode
            ? 'Only the Place ID, the location you choose and a placeholder name are saved — nothing Google lists.'
            : 'Record what you know. Leave anything unconfirmed blank — it will show as unknown.'
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="business-form" loading={create.pending || update.pending}>
            {business ? 'Save changes' : referenceMode ? 'Save reference' : 'Add candidate'}
          </Button>
        </>
      }
    >
      <form id="business-form" onSubmit={submit} noValidate className="space-y-6">
        {notice}
        {duplicates.length > 0 && (
          <Notice tone={duplicates[0].strength === 'exact' ? 'danger' : 'warning'} icon={AlertTriangle} title="Possible duplicate">
            <ul className="space-y-0.5">
              {duplicates.map((d) => (
                <li key={d.record.id}>
                  <Link href={`/prospects/${d.record.id}`} target="_blank">
                    {d.record.name}
                  </Link>{' '}
                  ({d.record.city}) — {d.reasons.join(', ')}
                </li>
              ))}
            </ul>
          </Notice>
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Business</legend>
          <Field
            label="Business name"
            required={!referenceMode}
            error={errors.name}
            hint={referenceMode ? 'Optional here: leave it blank to use a name generated from the Place ID.' : undefined}
            className="sm:col-span-2"
          >
            {(p) => <Input {...p} value={text(form.name)} onChange={(e) => set('name', e.target.value)} autoFocus />}
          </Field>
          <Field label="Category" required error={errors.category} hint="Type to search, or pick from an industry group. A custom category is allowed.">
            {(p) => (
              <>
                <Input {...p} list="category-options" value={text(form.category)} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Furniture showroom" />
                <datalist id="category-options">
                  {groups.map((group) => (
                    <optgroup key={group.key} label={group.label}>
                      {group.categories.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </optgroup>
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Operating status" error={errors.businessStatus}>
            {(p) => (
              <Select {...p} value={text(form.businessStatus)} onChange={(e) => set('businessStatus', e.target.value as FormInput['businessStatus'])}>
                {BUSINESS_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {BUSINESS_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Location</legend>
          <Field label="Country" error={errors.country}>
            {(p) => (
              <Select {...p} value={text(form.country)} onChange={(e) => set('country', e.target.value)}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Region" error={errors.region}>
            {(p) => (
              <Select {...p} value={text(form.region)} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value, districtCode: '' }))}>
                <option value="">Not recorded</option>
                {country?.regions.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="District" error={errors.districtCode} hint={text(form.region) ? undefined : 'Choose a region first.'}>
            {(p) => (
              <Select
                {...p}
                value={text(form.districtCode)}
                disabled={!text(form.region)}
                onChange={(e) => {
                  const code = e.target.value;
                  setForm((f) => ({ ...f, districtCode: code, region: code ? (findDistrict(code)?.region ?? f.region) : f.region }));
                }}
              >
                <option value="">Not recorded</option>
                {districtsIn(text(form.region)).map((district) => (
                  <option key={district.code} value={district.code}>
                    {district.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="City / town" error={errors.city} hint="Optional when a district or region is recorded.">
            {(p) => (
              <>
                <Input
                  {...p}
                  list="city-options"
                  value={text(form.city)}
                  onChange={(e) => {
                    const city = e.target.value;
                    setForm((f) => ({ ...f, city, region: regionForCity(city, text(f.country)) ?? f.region }));
                  }}
                />
                <datalist id="city-options">
                  {citiesFor(text(form.country), text(form.region) || null).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Neighbourhood" error={errors.neighborhood}>
            {(p) => (
              <>
                <Input {...p} list="neighborhood-options" value={text(form.neighborhood)} onChange={(e) => set('neighborhood', e.target.value)} />
                <datalist id="neighborhood-options">
                  {neighborhoodsFor(text(form.city), text(form.country)).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field label="Address or landmark" error={errors.address} className="sm:col-span-2">
            {(p) => <Input {...p} value={text(form.address)} onChange={(e) => set('address', e.target.value)} />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Online presence</legend>
          <Field
            label="Official website (if confirmed)"
            error={errors.officialWebsite}
            hint="Website status is set by documented verification, not here."
            className="sm:col-span-2"
          >
            {(p) => <Input {...p} value={text(form.officialWebsite)} onChange={(e) => set('officialWebsite', e.target.value)} placeholder="example.com.gh" />}
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <p className="text-xs font-medium text-muted">Business-declared social profiles</p>
            {socials.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Select
                  aria-label="Platform"
                  className="w-40"
                  value={s.platform}
                  onChange={(e) => set('socialProfiles', socials.map((x, j) => (j === i ? { ...x, platform: e.target.value as SocialPlatform } : x)))}
                >
                  {SOCIAL_PLATFORMS.map((pl) => (
                    <option key={pl} value={pl}>
                      {PLATFORM_LABELS[pl]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Profile URL"
                  aria-invalid={errors[`socialProfiles.${i}.url`] ? true : undefined}
                  value={s.url}
                  placeholder="https://"
                  onChange={(e) => set('socialProfiles', socials.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                />
                <Button size="icon" variant="ghost" aria-label="Remove profile" onClick={() => set('socialProfiles', socials.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            {Object.keys(errors).some((k) => k.startsWith('socialProfiles')) && <p className="text-xs text-danger">Each profile needs a full http(s) URL.</p>}
            <Button size="sm" variant="ghost" onClick={() => set('socialProfiles', [...socials, { platform: 'facebook', url: '' }])}>
              <Plus /> Add profile
            </Button>
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Business contact details</legend>
          <p className="text-xs text-subtle sm:col-span-2">
            Record only business contact details the business published itself. A listed number is not permission to market to it — permission is recorded separately.
          </p>
          <Field label="Enquiry channel" hint="e.g. Showroom front desk, Instagram DMs" error={errors.enquiryChannel}>
            {(p) => <Input {...p} value={text(form.enquiryChannel)} onChange={(e) => set('enquiryChannel', e.target.value)} />}
          </Field>
          <Field label="Business phone" error={errors.phone}>
            {(p) => <Input {...p} type="tel" value={text(form.phone)} onChange={(e) => set('phone', e.target.value)} />}
          </Field>
          <Field label="Business email" error={errors.email}>
            {(p) => <Input {...p} type="email" value={text(form.email)} onChange={(e) => set('email', e.target.value)} />}
          </Field>
          <Field label="Where the contact details were published" error={errors.contactSource}>
            {(p) => <Input {...p} value={text(form.contactSource)} onChange={(e) => set('contactSource', e.target.value)} placeholder="e.g. Facebook page About section" />}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Commercial (as stated by the business)</legend>
          <Field label="Interest level" error={errors.interestLevel}>
            {(p) => (
              <Select {...p} value={text(form.interestLevel)} onChange={(e) => set('interestLevel', e.target.value as FormInput['interestLevel'])}>
                {INTEREST_LEVELS.map((s) => (
                  <option key={s} value={s}>
                    {INTEREST_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Budget signal" error={errors.budgetSignal}>
            {(p) => (
              <Select {...p} value={text(form.budgetSignal)} onChange={(e) => set('budgetSignal', e.target.value as FormInput['budgetSignal'])}>
                {BUDGET_SIGNALS.map((s) => (
                  <option key={s} value={s}>
                    {BUDGET_LABELS[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Service needs" hint="Comma-separated, e.g. Online catalogue, Booking" error={errors.serviceNeeds} className="sm:col-span-2">
            {(p) => (
              <Input
                {...p}
                value={((form.serviceNeeds ?? []) as string[]).join(', ')}
                onChange={(e) =>
                  set(
                    'serviceNeeds',
                    e.target.value.split(',').map((s, i, all) => (i < all.length - 1 ? s.trim() : s.trimStart())).filter((s, i, all) => s || i === all.length - 1),
                  )
                }
              />
            )}
          </Field>
          <Field label="Estimated value (GHS)" hint="Only once discussed with the business" error={errors.estimatedValue}>
            {(p) => <Input {...p} inputMode="decimal" value={text(form.estimatedValue)} onChange={(e) => set('estimatedValue', e.target.value)} />}
          </Field>
          <Field label="Expected close date" error={errors.expectedCloseDate}>
            {(p) => <Input {...p} type="date" value={text(form.expectedCloseDate)} onChange={(e) => set('expectedCloseDate', e.target.value)} />}
          </Field>
          <Field label="Next action" error={errors.nextAction}>
            {(p) => <Input {...p} value={text(form.nextAction)} onChange={(e) => set('nextAction', e.target.value)} />}
          </Field>
          <Field label="Next action due" error={errors.nextActionDue}>
            {(p) => <Input {...p} type="date" value={text(form.nextActionDue)} onChange={(e) => set('nextActionDue', e.target.value)} />}
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-subtle">Source and notes</legend>
          <div role="radiogroup" aria-label="What are you saving?" className="grid gap-2 sm:grid-cols-2">
            {SAVE_MODES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  'rounded-md border p-3 text-left transition-colors',
                  mode === option ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-surface-hover',
                )}
              >
                <span className="block text-sm font-medium">{SAVE_MODE_COPY[option].title}</span>
                <span className="mt-0.5 block text-xs text-subtle">{SAVE_MODE_COPY[option].detail}</span>
              </button>
            ))}
          </div>

          {referenceMode ? (
            <div className="space-y-3 rounded-md border border-border bg-surface-muted/40 p-3">
              <Field
                label="Google Place ID"
                required
                error={errors.placesPlaceId}
                hint="The ID from the place’s Google Maps URL, usually starting with “ChIJ”. It is checked here only: no Google request is made, and no listing detail is saved."
              >
                {(p) => (
                  <Input
                    {...p}
                    value={text(form.placesPlaceId)}
                    onChange={(e) => set('placesPlaceId', e.target.value)}
                    placeholder="ChIJ…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
              <p className="text-xs text-subtle">
                Need the business’s name, website or phone? Choose “Add independently supported business details” and cite a source you can check. A
                Place ID on its own never establishes that a listing is accurate or that anyone may be contacted.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Source type" error={errors.sourceKind}>
                {(p) => (
                  <Select {...p} value={independentKind} onChange={(e) => set('sourceKind', e.target.value as FormInput['sourceKind'])}>
                    {INDEPENDENT_SOURCE_KINDS.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_KIND_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Source URL" required={urlRequired} error={errors.sourceUrl} hint={SOURCE_URL_HINTS[independentKind]}>
                {(p) => <Input {...p} value={text(form.sourceUrl)} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="https://" />}
              </Field>
              {text(form.placesPlaceId) && (
                <Field
                  label="Google Place ID"
                  error={errors.placesPlaceId}
                  hint="Kept as a reference only — it never supplies the details above."
                  className="sm:col-span-2"
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={text(form.placesPlaceId)}
                      onChange={(e) => set('placesPlaceId', e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  )}
                </Field>
              )}
            </div>
          )}

          <Field label="Research notes" error={errors.notes}>
            {(p) => <Textarea {...p} rows={4} value={text(form.notes)} onChange={(e) => set('notes', e.target.value)} />}
          </Field>
        </fieldset>
        <FormError message={formError} />
      </form>
    </Dialog>
  );
}
