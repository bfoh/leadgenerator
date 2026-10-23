'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input, Select, Textarea } from './field';

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function RowActions({ index, length, onMove, onRemove, label, disabled }: { index: number; length: number; onMove: (to: number) => void; onRemove: () => void; label: string; disabled?: boolean }) {
  if (disabled) return null;
  return (
    <div className="flex shrink-0 gap-0.5">
      <Button size="icon-sm" variant="ghost" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        <ArrowUp />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Move ${label} down`} disabled={index === length - 1} onClick={() => onMove(index + 1)}>
        <ArrowDown />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

/** Editable list of short strings (deliverables, assumptions, …). */
export function StringListEditor({
  label,
  items,
  onChange,
  placeholder,
  disabled,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <fieldset className="space-y-2" aria-describedby={hint ? `${id}-hint` : undefined}>
      <legend className="text-xs font-medium text-muted">{label}</legend>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-subtle">
          {hint}
        </p>
      )}
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <Input aria-label={`${label} ${i + 1}`} value={item} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <RowActions label={`${label} ${i + 1}`} index={i} length={items.length} disabled={disabled} onMove={(to) => onChange(move(items, i, to))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!disabled && (
        <Button size="sm" variant="ghost" onClick={() => onChange([...items, ''])}>
          <Plus /> Add
        </Button>
      )}
    </fieldset>
  );
}

export type FieldSpec<T> =
  | { key: keyof T & string; label: string; kind: 'text' | 'textarea'; placeholder?: string; wide?: boolean }
  | { key: keyof T & string; label: string; kind: 'select'; options: { value: string; label: string }[]; wide?: boolean }
  | { key: keyof T & string; label: string; kind: 'lines'; placeholder?: string; wide?: boolean }
  | { key: keyof T & string; label: string; kind: 'number'; wide?: boolean };

/** Editable list of small objects, each rendered as a compact card of fields. */
export function ObjectListEditor<T extends Record<string, unknown>>({
  label,
  items,
  onChange,
  fields,
  create,
  itemLabel,
  disabled,
  hint,
}: {
  label: string;
  items: T[];
  onChange: (items: T[]) => void;
  fields: FieldSpec<T>[];
  create: () => T;
  itemLabel: (item: T, index: number) => string;
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  const update = (i: number, key: string, value: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [key]: value } : x)));
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted">{label}</legend>
      {hint && <div className="text-xs text-subtle">{hint}</div>}
      {items.map((item, i) => (
        <div key={i} className="rounded-md border border-border bg-surface-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium text-subtle">{itemLabel(item, i)}</span>
            <RowActions label={itemLabel(item, i)} index={i} length={items.length} disabled={disabled} onMove={(to) => onChange(move(items, i, to))} onRemove={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => {
              const value = item[f.key];
              const common = { 'aria-label': `${itemLabel(item, i)} — ${f.label}`, disabled };
              return (
                <label key={f.key} className={cn('block space-y-1', (f.wide || f.kind === 'textarea' || f.kind === 'lines') && 'sm:col-span-2')}>
                  <span className="text-[11px] text-subtle">{f.label}</span>
                  {f.kind === 'text' && <Input {...common} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => update(i, f.key, e.target.value)} />}
                  {f.kind === 'number' && <Input {...common} inputMode="decimal" value={value == null ? '' : String(value)} onChange={(e) => update(i, f.key, e.target.value === '' ? null : Number(e.target.value))} />}
                  {f.kind === 'textarea' && <Textarea {...common} rows={2} value={String(value ?? '')} placeholder={f.placeholder} onChange={(e) => update(i, f.key, e.target.value)} />}
                  {f.kind === 'lines' && (
                    <Textarea
                      {...common}
                      rows={3}
                      value={((value as string[]) ?? []).join('\n')}
                      placeholder={f.placeholder ?? 'One per line'}
                      onChange={(e) => update(i, f.key, e.target.value.split('\n'))}
                    />
                  )}
                  {f.kind === 'select' && (
                    <Select {...common} value={String(value ?? '')} onChange={(e) => update(i, f.key, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {!disabled && (
        <Button size="sm" variant="ghost" onClick={() => onChange([...items, create()])}>
          <Plus /> Add
        </Button>
      )}
    </fieldset>
  );
}
