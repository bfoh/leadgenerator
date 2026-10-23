'use client';

import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_CATEGORIES } from '@/lib/domain/categories';
import { BAND_META, DEFAULT_WEIGHTS, FACTOR_LABELS, SCORE_FACTORS, type ScoreBand, type ScoreWeights } from '@/lib/domain/scoring';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Input } from '@/components/ui/field';
import { StringListEditor } from '@/components/ui/list-editor';
import { Notice } from '@/components/ui/misc';
import { useSaveSettings } from './use-save-settings';

export function ScoringTab() {
  const { settings, can } = useWorkspace();
  const editable = can('settings.manage');
  const [weights, setWeights] = useState<ScoreWeights>(settings.scoringWeights);
  const save = useSaveSettings('Scoring weights saved');
  const total = SCORE_FACTORS.reduce((s, f) => s + (Number.isFinite(weights[f]) ? weights[f] : 0), 0);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Opportunity score weights" description="Each factor scores 0–100; the weights decide how much each contributes. Shares are normalised, so they need not add up to 100." />
        <CardBody>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save.run({ ...settings, scoringWeights: weights }, { rescore: true });
            }}
          >
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-subtle">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Factor</th>
                  <th scope="col" className="pb-2 font-medium">Weight</th>
                  <th scope="col" className="pb-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SCORE_FACTORS.map((f) => (
                  <tr key={f}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {FACTOR_LABELS[f]}
                    </th>
                    <td className="py-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`${FACTOR_LABELS[f]} weight`}
                        disabled={!editable}
                        value={Number.isFinite(weights[f]) ? weights[f] : ''}
                        onChange={(e) => setWeights((w) => ({ ...w, [f]: e.target.value === '' ? NaN : Number(e.target.value) }))}
                        className="w-24"
                      />
                    </td>
                    <td className="py-2 text-right tabular text-muted">{total ? `${Math.round(((Number.isFinite(weights[f]) ? weights[f] : 0) / total) * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {editable && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="submit" variant="primary" loading={save.pending}>
                  Save and rescore all prospects
                </Button>
                <Button variant="ghost" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
                  <RotateCcw className="size-4" aria-hidden /> Restore defaults
                </Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>
      <div className="space-y-5">
        <Card>
          <CardHeader title="Priority bands" />
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {(['high', 'qualify', 'research', 'low'] as ScoreBand[]).map((b) => (
                <li key={b} className="flex justify-between gap-3">
                  <span>{BAND_META[b].label}</span>
                  <span className="tabular text-subtle">{BAND_META[b].range}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Notice tone="info" title="Score and confidence are separate">
          The opportunity score ranks how promising a prospect looks. Confidence reflects how much of that is backed by recorded evidence — unknown factors lower confidence instead of being guessed.
        </Notice>
      </div>
    </div>
  );
}

export function CategoriesTab() {
  const { settings, can } = useWorkspace();
  const editable = can('settings.manage');
  const [focus, setFocus] = useState<string[]>(settings.focusCategories);
  const [custom, setCustom] = useState<string[]>(settings.customCategories);
  const save = useSaveSettings('Categories saved');
  const cleanCustom = [...new Set(custom.map((c) => c.trim()).filter(Boolean))];
  const all = [...new Set([...DEFAULT_CATEGORIES.map((c) => c.label), ...cleanCustom])];
  const toggle = (c: string) => setFocus((f) => (f.includes(c) ? f.filter((x) => x !== c) : [...f, c]));

  return (
    <form
      noValidate
      className="grid grid-cols-1 gap-5 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ ...settings, customCategories: cleanCustom, focusCategories: focus.filter((f) => all.includes(f)) }, { rescore: true });
      }}
    >
      <Card>
        <CardHeader title="Focus categories" description="Prospects in these categories score higher on industry fit. Others are still tracked." />
        <CardBody>
          <fieldset disabled={!editable} className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Focus categories</legend>
            {all.map((c) => (
              <Checkbox key={c} label={c} checked={focus.includes(c)} onChange={() => toggle(c)} />
            ))}
          </fieldset>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Custom categories" description="Added to category pickers alongside the built-in list." />
        <CardBody>
          <StringListEditor label="Categories" items={custom} onChange={setCustom} disabled={!editable} placeholder="e.g. Printing press" />
        </CardBody>
      </Card>
      {editable && (
        <div className="lg:col-span-2">
          <Button type="submit" variant="primary" loading={save.pending}>
            Save and rescore all prospects
          </Button>
        </div>
      )}
    </form>
  );
}
