'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PROJECT_TYPES, PROJECT_TYPE_LABELS } from '@/lib/domain/constants';
import { LINE_ITEM_CATEGORIES, LINE_ITEM_KINDS, LINE_ITEM_KIND_LABELS, type AddOn, type ServicePackage } from '@/lib/domain/packages';
import { formatMoney } from '@/lib/domain/proposal';
import { cn, slug } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ObjectListEditor } from '@/components/ui/list-editor';
import { Notice } from '@/components/ui/misc';
import { useSaveSettings } from './use-save-settings';

type LineItem = ServicePackage['lineItems'][number];
type Phase = ServicePackage['phases'][number];

const CATEGORY_LABELS: Record<(typeof LINE_ITEM_CATEGORIES)[number], string> = {
  development: 'Development',
  maintenance: 'Maintenance',
  hosting: 'Hosting',
  domain: 'Domain',
  integration: 'Integration',
  other: 'Other',
};

function newKey(name: string, taken: string[]) {
  const base = (slug(name) || 'package').slice(0, 32);
  let key = base.length >= 2 ? base : `${base}-pkg`;
  for (let n = 2; taken.includes(key); n++) key = `${base}-${n}`;
  return key;
}

const lines = (text: string) => text.split('\n');
const clean = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

export function PackagesTab() {
  const { settings, can } = useWorkspace();
  const editable = can('settings.manage');
  const [packages, setPackages] = useState<ServicePackage[]>(settings.packages);
  const [addOns, setAddOns] = useState<AddOn[]>(settings.addOns);
  const [index, setIndex] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = useSaveSettings('Packages saved');
  const current = packages[index];
  const update = (patch: Partial<ServicePackage>) => setPackages((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const unpriced = packages.reduce((s, p) => s + p.lineItems.filter((l) => l.defaultUnitPrice == null).length, 0);
  const unpricedAddOns = addOns.filter((a) => a.unitPrice == null).length;

  function addPackage() {
    const key = newKey('custom package', packages.map((p) => p.key));
    setPackages((list) => [...list, { key, name: 'New package', summary: '', projectType: 'website', features: [], exclusions: [], phases: [], lineItems: [] }]);
    setIndex(packages.length);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    save.run({
      ...settings,
      packages: packages.map((p) => ({ ...p, name: p.name.trim(), features: clean(p.features), exclusions: clean(p.exclusions), lineItems: p.lineItems.map((l) => ({ ...l, description: l.description.trim() })) })),
      addOns: addOns.map((a, i) => ({ ...a, key: a.key || newKey(a.name || 'add-on', addOns.filter((_, j) => j !== i).map((x) => x.key)), name: a.name.trim(), description: a.description.trim() })),
    });
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-5">
      <Notice tone="info" title="Prices are yours to set">
        Default packages ship without prices. Enter your agency’s own rates; any line left blank prints as “To be quoted”. Changes apply to new proposals only — existing proposals keep their own line items.
        {unpriced > 0 && ` ${unpriced} line items are currently unpriced.`}
      </Notice>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Packages" />
          <ul className="p-1.5" role="listbox" aria-label="Packages">
            {packages.map((p, i) => (
              <li key={p.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  onClick={() => setIndex(i)}
                  className={cn('w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-hover', i === index && 'bg-surface-muted font-medium')}
                >
                  {p.name || 'Untitled package'}
                  <span className="block text-xs font-normal text-subtle">{PROJECT_TYPE_LABELS[p.projectType]}</span>
                </button>
              </li>
            ))}
          </ul>
          {editable && (
            <div className="border-t border-border p-2">
              <Button size="sm" variant="ghost" onClick={addPackage} disabled={packages.length >= 30}>
                <Plus /> Add package
              </Button>
            </div>
          )}
        </Card>

        {current ? (
          <Card>
            <CardHeader
              title={current.name || 'Untitled package'}
              description={`Key: ${current.key}`}
              actions={
                editable && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </Button>
                )
              }
            />
            <CardBody>
              <fieldset disabled={!editable} className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" required>
                    {(p) => <Input {...p} value={current.name} onChange={(e) => update({ name: e.target.value })} maxLength={80} />}
                  </Field>
                  <Field label="Project type">
                    {(p) => (
                      <Select {...p} value={current.projectType} onChange={(e) => update({ projectType: e.target.value as ServicePackage['projectType'] })}>
                        {PROJECT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {PROJECT_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Summary" className="sm:col-span-2">
                    {(p) => <Textarea {...p} rows={2} value={current.summary} onChange={(e) => update({ summary: e.target.value })} maxLength={500} />}
                  </Field>
                  <Field label="Features" hint="One per line.">
                    {(p) => <Textarea {...p} rows={6} value={current.features.join('\n')} onChange={(e) => update({ features: lines(e.target.value) })} />}
                  </Field>
                  <Field label="Exclusions" hint="One per line.">
                    {(p) => <Textarea {...p} rows={6} value={current.exclusions.join('\n')} onChange={(e) => update({ exclusions: lines(e.target.value) })} />}
                  </Field>
                </div>
                <ObjectListEditor<LineItem>
                  label="Line items"
                  hint="Default unit price in GHS. Leave blank for “To be quoted”."
                  items={current.lineItems}
                  onChange={(lineItems) => update({ lineItems })}
                  disabled={!editable}
                  create={() => ({ kind: 'one_time', category: 'development', description: '', quantity: 1, defaultUnitPrice: null })}
                  itemLabel={(l, i) => `${l.description || `Line item ${i + 1}`}${l.defaultUnitPrice != null ? ` · ${formatMoney(l.defaultUnitPrice)}` : ' · to be quoted'}`}
                  fields={[
                    { key: 'description', label: 'Description', kind: 'text', wide: true },
                    { key: 'kind', label: 'Billing', kind: 'select', options: LINE_ITEM_KINDS.map((k) => ({ value: k, label: LINE_ITEM_KIND_LABELS[k] })) },
                    { key: 'category', label: 'Category', kind: 'select', options: LINE_ITEM_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
                    { key: 'quantity', label: 'Quantity', kind: 'number' },
                    { key: 'defaultUnitPrice', label: 'Unit price (GHS)', kind: 'number' },
                  ]}
                />
                <ObjectListEditor<Phase>
                  label="Phases"
                  hint="Become proposal phases and, after acceptance, project milestones."
                  items={current.phases}
                  onChange={(phases) => update({ phases })}
                  disabled={!editable}
                  create={() => ({ name: '', description: '', duration: '' })}
                  itemLabel={(p, i) => p.name || `Phase ${i + 1}`}
                  fields={[
                    { key: 'name', label: 'Name', kind: 'text' },
                    { key: 'duration', label: 'Duration', kind: 'text' },
                    { key: 'description', label: 'Description', kind: 'textarea' },
                  ]}
                />
              </fieldset>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-subtle">No packages. Add one to start building proposals.</p>
            </CardBody>
          </Card>
        )}
      </div>
      <Card>
        <CardHeader
          title="Add-on price list"
          description={`Optional features proposal templates may add, such as booking calendars or Mobile Money checkout. Drafts use only these prices; blank prices print as “To be quoted”.${unpricedAddOns ? ` ${unpricedAddOns} of ${addOns.length} add-ons are unpriced.` : ''}`}
        />
        <CardBody>
          <ObjectListEditor<AddOn>
            label="Add-ons"
            hint="An add-on a recorded need asks for is quoted as a required line; others are offered as optional lines. Removing one stops templates from using it."
            items={addOns}
            onChange={setAddOns}
            disabled={!editable}
            create={() => ({ key: '', name: '', description: '', kind: 'one_time', category: 'development', unitPrice: null })}
            itemLabel={(a, i) => `${a.name || `Add-on ${i + 1}`}${a.unitPrice != null ? ` · ${formatMoney(a.unitPrice)}` : ' · to be quoted'}`}
            fields={[
              { key: 'name', label: 'Name', kind: 'text' },
              { key: 'unitPrice', label: 'Price (GHS)', kind: 'number' },
              { key: 'kind', label: 'Billing', kind: 'select', options: (['one_time', 'monthly', 'annual'] as const).map((k) => ({ value: k, label: LINE_ITEM_KIND_LABELS[k] })) },
              { key: 'category', label: 'Category', kind: 'select', options: LINE_ITEM_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
              { key: 'description', label: 'Description', kind: 'text', wide: true },
            ]}
          />
        </CardBody>
      </Card>
      {editable && (
        <Button type="submit" variant="primary" loading={save.pending}>
          Save packages
        </Button>
      )}
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        size="sm"
        title={`Remove “${current?.name}”?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setPackages((list) => list.filter((_, i) => i !== index));
                setIndex(0);
                setConfirmDelete(false);
              }}
            >
              Remove package
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Existing proposals built from it are unaffected. The removal takes effect when you save packages.</p>
      </Dialog>
    </form>
  );
}
