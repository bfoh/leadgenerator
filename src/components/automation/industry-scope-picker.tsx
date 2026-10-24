'use client';

// Campaign industry targeting, grouped by industry. A group entry selects the whole industry in one
// slot, which matters because a campaign scope is capped at 50 entries: 50 groups cover every sector
// in the taxonomy, while 50 individual categories would cover only a corner of it.

import { useMemo, useState } from 'react';
import type { CategoryGroup } from '@/lib/domain/categories';
import { Checkbox, Input } from '@/components/ui/field';

export function IndustryScopePicker({
  groups,
  selected,
  onChange,
  disabled = false,
  limit = 50,
}: {
  groups: CategoryGroup[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  limit?: number;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const atLimit = selected.length >= limit;

  const visible = useMemo(() => {
    if (!needle) return groups;
    return groups
      .map((group) => {
        const groupHit = group.label.toLowerCase().includes(needle);
        return { ...group, categories: groupHit ? group.categories : group.categories.filter((label) => label.toLowerCase().includes(needle)) };
      })
      .filter((group) => group.label.toLowerCase().includes(needle) || group.categories.length > 0);
  }, [groups, needle]);

  const toggle = (value: string) => {
    if (disabled) return;
    if (selected.includes(value)) return onChange(selected.filter((entry) => entry !== value));
    if (atLimit) return;
    onChange([...selected, value]);
  };

  const toggleGroup = (group: CategoryGroup) => {
    if (disabled) return;
    const categories = selected.filter((entry) => group.categories.includes(entry));
    if (selected.includes(group.label)) {
      onChange(selected.filter((entry) => entry !== group.label));
      return;
    }
    if (atLimit) return;
    // Replacing the group's individual categories with the group itself keeps the scope small.
    onChange([...selected.filter((entry) => !categories.includes(entry)), group.label]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs font-medium" htmlFor="industry-scope-search">
          Industries{' '}
          <span className="font-normal text-subtle">
            ({selected.length ? `${selected.length} of ${limit} selected` : 'all industries'})
          </span>
        </label>
        <Input
          id="industry-scope-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search industries or categories"
          className="h-8 max-w-56"
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-2">
        {visible.map((group) => (
          <details key={group.key} className="rounded-md border border-border/60 px-2 py-1.5" open={Boolean(needle) || selected.includes(group.label)}>
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-xs">
              <span className="font-medium">{group.label}</span>
              <span className="text-subtle">
                {selected.includes(group.label) ? 'whole group' : `${group.categories.length} categories`}
              </span>
            </summary>
            <div className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
              <Checkbox
                label={`Whole group: ${group.label}`}
                description="Counts as one entry in the 50-entry scope limit."
                checked={selected.includes(group.label)}
                disabled={disabled || (atLimit && !selected.includes(group.label))}
                onChange={() => toggleGroup(group)}
              />
              <div className="grid gap-1 sm:grid-cols-2">
                {group.categories.map((label) => (
                  <Checkbox
                    key={label}
                    label={label}
                    checked={selected.includes(label)}
                    disabled={disabled || (atLimit && !selected.includes(label)) || selected.includes(group.label)}
                    onChange={() => toggle(label)}
                  />
                ))}
              </div>
            </div>
          </details>
        ))}
        {!visible.length && <p className="px-1 py-2 text-xs text-subtle">No industry matches “{query.trim()}”.</p>}
      </div>
      <p className="text-xs text-subtle">
        {atLimit
          ? `The scope limit is ${limit} entries. Remove one to add another, or select a whole group to cover more industries.`
          : 'A group selection matches every prospect in that industry, including categories added later.'}
      </p>
    </div>
  );
}
