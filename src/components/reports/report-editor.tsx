'use client';

import { useState } from 'react';
import type { EvidencePack } from '@/lib/domain/evidence';
import {
  NARRATIVE_SECTIONS,
  NEXT_ACTION_META,
  REPORT_SECTIONS,
  STATEMENT_KINDS,
  STATEMENT_KIND_META,
  allowedNextActions,
  reportDraftSchema,
  type NarrativeSection,
  type NextAction,
  type ReportContent,
  type ReportDraft,
  type ReportStatement,
  type StatementKind,
} from '@/lib/domain/report';
import { Button } from '@/components/ui/button';
import { Field, FormError, Select, Textarea } from '@/components/ui/field';
import { ObjectListEditor } from '@/components/ui/list-editor';

type Row = { kind: StatementKind; text: string; evidence: string };
const KIND_OPTIONS = STATEMENT_KINDS.map((k) => ({ value: k, label: STATEMENT_KIND_META[k].label }));
const ids = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
const toRows = (list: ReportStatement[]): Row[] => list.map((s) => ({ kind: s.kind, text: s.text, evidence: s.evidenceIds.join(', ') }));
const fromRows = (rows: Row[]): ReportStatement[] => rows.filter((r) => r.text.trim()).map((r) => ({ kind: r.kind, text: r.text.trim(), evidenceIds: ids(r.evidence) }));
const titleOf = (key: string) => REPORT_SECTIONS.find((s) => s.key === key)!.title;

function StatementList({ label, rows, onChange, hint }: { label: string; rows: Row[]; onChange: (rows: Row[]) => void; hint: string }) {
  return (
    <ObjectListEditor
      label={label}
      hint={hint}
      items={rows}
      onChange={onChange}
      create={() => ({ kind: 'recommendation' as StatementKind, text: '', evidence: '' })}
      itemLabel={(r, i) => `${STATEMENT_KIND_META[r.kind].label} ${i + 1}`}
      fields={[
        { key: 'kind', label: 'Label', kind: 'select', options: KIND_OPTIONS },
        { key: 'evidence', label: 'Evidence IDs', kind: 'text', placeholder: 'E1, E3' },
        { key: 'text', label: 'Statement', kind: 'textarea' },
      ]}
    />
  );
}

/** Edits a report; saving creates a new version that is re-validated against the original evidence. */
export function ReportEditor({ initial, pack, pending, onSave, onCancel }: { initial: ReportContent; pack: EvidencePack; pending: boolean; onSave: (draft: ReportDraft) => void; onCancel: () => void }) {
  const [c, setC] = useState<ReportDraft>(initial);
  const [rows, setRows] = useState(() => Object.fromEntries(NARRATIVE_SECTIONS.map((k) => [k, toRows(initial[k].statements)])) as Record<NarrativeSection, Row[]>);
  const [solutionRows, setSolutionRows] = useState(toRows(initial.recommendedSolution.statements));
  const [benefitRows, setBenefitRows] = useState(toRows(initial.expectedBenefits));
  const [opportunities, setOpportunities] = useState(initial.opportunities.map((o) => ({ ...o, evidence: o.evidenceIds.join(', ') })));
  const [items, setItems] = useState(initial.recommendedSolution.items.map((s) => ({ ...s, evidence: s.evidenceIds.join(', ') })));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) => setC((x) => ({ ...x, [key]: value }));
  const allowed = allowedNextActions(pack);
  const actions: NextAction[] = allowed.includes(c.nextAction.action) ? allowed : [c.nextAction.action, ...allowed];
  const hint = `Facts and findings need evidence IDs (available: ${pack.items.map((i) => i.id).join(', ')}). Without one they move to limitations; statements about revenue, customers, staff, owners, prices, awards or reviews the evidence does not mention are removed when you save.`;

  function save() {
    const draft: ReportDraft = {
      ...c,
      ...(Object.fromEntries(NARRATIVE_SECTIONS.map((k) => [k, { summary: c[k].summary.trim(), statements: fromRows(rows[k]) }])) as Record<NarrativeSection, ReportDraft[NarrativeSection]>),
      opportunities: opportunities.filter((o) => o.title.trim() || o.description.trim()).map(({ evidence, ...o }) => ({ ...o, evidenceIds: ids(evidence) })),
      recommendedSolution: {
        summary: c.recommendedSolution.summary.trim(),
        items: items.filter((s) => s.service.trim()).map(({ evidence, ...s }) => ({ ...s, evidenceIds: ids(evidence) })),
        statements: fromRows(solutionRows),
      },
      implementationPhases: c.implementationPhases.filter((p) => p.name.trim()).map((p) => ({ ...p, deliverables: p.deliverables.map((d) => d.trim()).filter(Boolean) })),
      expectedBenefits: fromRows(benefitRows),
      limitations: c.limitations.filter((u) => u.item.trim()),
    };
    const parsed = reportDraftSchema.safeParse(draft);
    if (!parsed.success || !draft.businessOverview.summary) return setError('Add a business overview and complete the highlighted items.');
    setError(null);
    onSave(parsed.data);
  }

  return (
    <div className="space-y-6">
      {NARRATIVE_SECTIONS.map((key, n) => (
        <fieldset key={key} className="space-y-3 border-b border-border pb-6">
          <legend className="mb-2 text-sm font-semibold">
            {n + 1}. {titleOf(key)}
          </legend>
          <Field label="Summary" required={key === 'businessOverview'}>
            {(p) => <Textarea {...p} rows={3} value={c[key].summary} onChange={(e) => set(key, { ...c[key], summary: e.target.value })} />}
          </Field>
          <StatementList label="Statements" hint={hint} rows={rows[key]} onChange={(r) => setRows((x) => ({ ...x, [key]: r }))} />
        </fieldset>
      ))}

      <ObjectListEditor
        label={`6. ${titleOf('opportunities')}`}
        hint="Evidence-supported opportunities need evidence IDs; without them they are shown as recommendations."
        items={opportunities}
        onChange={setOpportunities}
        create={() => ({ title: '', description: '', kind: 'recommendation' as const, evidenceIds: [], evidence: '' })}
        itemLabel={(o, i) => o.title || `Opportunity ${i + 1}`}
        fields={[
          { key: 'title', label: 'Title', kind: 'text', wide: true },
          {
            key: 'kind',
            label: 'Label',
            kind: 'select',
            options: [
              { value: 'evidence_supported', label: STATEMENT_KIND_META.evidence_supported.label },
              { value: 'recommendation', label: STATEMENT_KIND_META.recommendation.label },
            ],
          },
          { key: 'evidence', label: 'Evidence IDs', kind: 'text', placeholder: 'E4' },
          { key: 'description', label: 'Description', kind: 'textarea' },
        ]}
      />

      <fieldset className="space-y-3 border-b border-border pb-6">
        <legend className="mb-2 text-sm font-semibold">7. {titleOf('recommendedSolution')}</legend>
        <Field label="Summary">
          {(p) => <Textarea {...p} rows={3} value={c.recommendedSolution.summary} onChange={(e) => set('recommendedSolution', { ...c.recommendedSolution, summary: e.target.value })} />}
        </Field>
        <ObjectListEditor
          label="Recommended services"
          hint="No prices here: a proposal takes them from the configured price list."
          items={items}
          onChange={setItems}
          create={() => ({ service: '', priority: 'secondary' as const, rationale: '', evidenceIds: [], evidence: '' })}
          itemLabel={(s, i) => s.service || `Service ${i + 1}`}
          fields={[
            { key: 'service', label: 'Service', kind: 'text' },
            {
              key: 'priority',
              label: 'Priority',
              kind: 'select',
              options: [
                { value: 'primary', label: 'Primary' },
                { value: 'secondary', label: 'Secondary' },
                { value: 'future', label: 'Future' },
              ],
            },
            { key: 'evidence', label: 'Evidence IDs', kind: 'text', placeholder: 'E2' },
            { key: 'rationale', label: 'Rationale', kind: 'textarea' },
          ]}
        />
        <StatementList label="Delivery advice" hint={hint} rows={solutionRows} onChange={setSolutionRows} />
      </fieldset>

      <ObjectListEditor
        label={`8. ${titleOf('implementationPhases')}`}
        items={c.implementationPhases}
        onChange={(v) => set('implementationPhases', v)}
        create={() => ({ name: '', objective: '', deliverables: [], indicativeDuration: '' })}
        itemLabel={(p, i) => p.name || `Phase ${i + 1}`}
        fields={[
          { key: 'name', label: 'Name', kind: 'text' },
          { key: 'indicativeDuration', label: 'Indicative duration', kind: 'text' },
          { key: 'objective', label: 'Objective', kind: 'textarea' },
          { key: 'deliverables', label: 'Deliverables (one per line)', kind: 'lines' },
        ]}
      />

      <StatementList label={`9. ${titleOf('expectedBenefits')}`} hint="Potential benefits only — no financial projections or guarantees. Unlabelled benefits are saved as assumptions." rows={benefitRows} onChange={setBenefitRows} />

      <ObjectListEditor
        label={`10. ${titleOf('limitations')}`}
        items={c.limitations}
        onChange={(v) => set('limitations', v)}
        create={() => ({ item: '', howToConfirm: '' })}
        itemLabel={(u, i) => u.item || `Limitation ${i + 1}`}
        fields={[
          { key: 'item', label: 'What is unknown or limited', kind: 'textarea' },
          { key: 'howToConfirm', label: 'How to confirm', kind: 'text', wide: true },
        ]}
      />

      <p className="text-xs text-subtle">11. {titleOf('evidenceReferences')} are computed from the citations above when you save.</p>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">12. {titleOf('nextAction')}</legend>
        <Field label="Action" hint="Only actions the research and recorded permission allow are offered.">
          {(p) => (
            <Select {...p} value={c.nextAction.action} onChange={(e) => set('nextAction', { ...c.nextAction, action: e.target.value as NextAction })}>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {NEXT_ACTION_META[a].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Rationale">{(p) => <Textarea {...p} rows={2} value={c.nextAction.rationale} onChange={(e) => set('nextAction', { ...c.nextAction, rationale: e.target.value })} />}</Field>
      </fieldset>

      <FormError message={error} />
      <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-border bg-surface px-5 py-3 sm:-mx-8 sm:px-8">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={save} loading={pending}>
          Save as new version
        </Button>
      </div>
    </div>
  );
}
