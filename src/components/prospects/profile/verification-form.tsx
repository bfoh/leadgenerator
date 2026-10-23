'use client';

import { useState } from 'react';
import type { z } from 'zod';
import {
  CONFIDENCE_LEVELS,
  VERIFICATION_METHODS,
  VERIFICATION_METHOD_LABELS,
  VERIFICATION_OUTCOMES,
  WEBSITE_STATUS_META,
  type VerificationMethod,
  type VerificationOutcome,
} from '@/lib/domain/constants';
import { fieldErrors, verificationFormSchema, type VerificationForm } from '@/lib/domain/schemas';
import type { WebsiteVerification } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/field';

export type VerificationDraft = z.input<typeof verificationFormSchema>;

const SITE_OUTCOMES: VerificationOutcome[] = ['verified_official', 'potential_official', 'unavailable', 'unhealthy'];

export function emptyVerification(overrides: Partial<VerificationDraft> = {}): VerificationDraft {
  return {
    status: 'insufficient_evidence',
    methods: [],
    domain: '',
    sourceUrl: '',
    evidenceSummary: '',
    confidence: 'medium',
    websiteOutdated: false,
    nextCheckAt: '',
    ...overrides,
  };
}

export function verificationToDraft(v: WebsiteVerification): VerificationDraft {
  return {
    status: v.status,
    methods: v.methods,
    domain: v.domain ?? '',
    sourceUrl: v.sourceUrl ?? '',
    evidenceSummary: v.evidenceSummary,
    confidence: v.confidence,
    websiteOutdated: v.websiteOutdated,
    nextCheckAt: v.nextCheckAt ?? '',
  };
}

/** Validates a draft; returns parsed values or field errors. */
export function useVerificationDraft(initial: VerificationDraft) {
  const [draft, setDraft] = useState<VerificationDraft>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const validate = (): VerificationForm | null => {
    const parsed = verificationFormSchema.safeParse(draft);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return null;
    }
    setErrors({});
    return parsed.data;
  };
  return { draft, setDraft, errors, validate, reset: (d: VerificationDraft) => (setDraft(d), setErrors({})) };
}

export function VerificationFields({
  draft,
  setDraft,
  errors,
  idPrefix,
}: {
  draft: VerificationDraft;
  setDraft: React.Dispatch<React.SetStateAction<VerificationDraft>>;
  errors: Record<string, string>;
  idPrefix: string;
}) {
  const set = <K extends keyof VerificationDraft>(key: K, value: VerificationDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const methods = (draft.methods ?? []) as VerificationMethod[];
  const status = draft.status as VerificationOutcome;
  const siteOutcome = SITE_OUTCOMES.includes(status);

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted">Outcome</legend>
        <div className="grid gap-1.5" role="radiogroup">
          {VERIFICATION_OUTCOMES.map((o) => (
            <label
              key={o}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2 transition-colors hover:bg-surface-hover',
                status === o && 'border-accent bg-accent-soft/50',
              )}
            >
              <input type="radio" name={`${idPrefix}-status`} value={o} checked={status === o} onChange={() => set('status', o)} className="mt-0.5 accent-[var(--accent)]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{WEBSITE_STATUS_META[o].label}</span>
                <span className="block text-xs text-subtle">{WEBSITE_STATUS_META[o].description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset aria-describedby={errors.methods ? `${idPrefix}-methods-error` : undefined}>
        <legend className="mb-2 text-xs font-medium text-muted">Methods used</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {VERIFICATION_METHODS.map((m) => (
            <Checkbox
              key={m}
              id={`${idPrefix}-${m}`}
              checked={methods.includes(m)}
              onChange={(e) => set('methods', e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))}
              label={<span className="text-[13px]">{VERIFICATION_METHOD_LABELS[m]}</span>}
            />
          ))}
        </div>
        {errors.methods && (
          <p id={`${idPrefix}-methods-error`} className="mt-1.5 text-xs text-danger">
            {errors.methods}
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Website or domain" required={siteOutcome} error={errors.domain} hint={siteOutcome ? undefined : 'Optional for this outcome'}>
          {(p) => <Input {...p} value={String(draft.domain ?? '')} onChange={(e) => set('domain', e.target.value)} placeholder="example.com.gh" />}
        </Field>
        <Field label="Evidence link" error={errors.sourceUrl} hint="Page that supports this outcome">
          {(p) => <Input {...p} value={String(draft.sourceUrl ?? '')} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="https://" />}
        </Field>
      </div>

      <Field label="Evidence summary" required error={errors.evidenceSummary} hint="What you checked and what you found, specific enough for a colleague to repeat.">
        {(p) => <Textarea {...p} rows={4} value={String(draft.evidenceSummary ?? '')} onChange={(e) => set('evidenceSummary', e.target.value)} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Confidence" error={errors.confidence}>
          {(p) => (
            <Select {...p} value={String(draft.confidence)} onChange={(e) => set('confidence', e.target.value as VerificationDraft['confidence'])}>
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Re-check on" error={errors.nextCheckAt} hint="Optional reminder date">
          {(p) => <Input {...p} type="date" value={String(draft.nextCheckAt ?? '')} onChange={(e) => set('nextCheckAt', e.target.value)} />}
        </Field>
      </div>
      {siteOutcome && (
        <Checkbox
          id={`${idPrefix}-outdated`}
          checked={Boolean(draft.websiteOutdated)}
          onChange={(e) => set('websiteOutdated', e.target.checked)}
          label="The website looks outdated"
          description="e.g. old content, broken layout on mobile, no HTTPS"
        />
      )}
      {status === 'none_found' && (
        <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted">
          This records that no official website was found after the checks above. It is not proof the business has no website, and reports will say so.
        </p>
      )}
      <FormError message={errors._} />
    </div>
  );
}
