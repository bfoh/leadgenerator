'use client';

// Searchable, grouped industry picker. The controls are native selects and a search box so the
// native picker still opens on a phone, keyboard and screen-reader behaviour is the browser's, and
// a filtered list never depends on client-side JavaScript beyond the filtering itself.

import { useMemo, useId, useState } from 'react';
import { DEFAULT_CATEGORIES, type CategoryGroup } from '@/lib/domain/categories';
import { Input, Select } from '@/components/ui/field';

const ALIASES = new Map(DEFAULT_CATEGORIES.map((category) => [category.label, [category.searchTerm, ...category.aliases]]));

function matches(text: string, query: string) {
  return text.toLowerCase().includes(query);
}

export function CategorySelector({
  groups,
  value,
  onChange,
  allowGroupScope = true,
  disabled = false,
}: {
  groups: CategoryGroup[];
  value: string;
  onChange: (value: string) => void;
  /** Offer "all industries in this group" as a search target for the whole group. */
  allowGroupScope?: boolean;
  disabled?: boolean;
}) {
  const groupId = useId();
  const searchId = useId();
  const selectId = useId();
  const [groupKey, setGroupKey] = useState('');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const scoped = groupKey ? groups.filter((group) => group.key === groupKey) : groups;
    if (!needle) return scoped;
    return scoped
      .map((group) => {
        const groupHit = matches(group.label, needle) || matches(group.description, needle);
        const categories = group.categories.filter((label) => groupHit || matches(label, needle) || (ALIASES.get(label) ?? []).some((alias) => matches(alias, needle)));
        return { ...group, categories };
      })
      .filter((group) => group.categories.length > 0);
  }, [groups, groupKey, needle]);

  const total = visible.reduce((sum, group) => sum + group.categories.length, 0);
  const shown = visible.some((group) => group.categories.includes(value)) || (allowGroupScope && visible.some((group) => group.label === value));

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={groupId} className="mb-1 block text-xs font-medium text-muted">
            Industry group
          </label>
          <Select id={groupId} value={groupKey} onChange={(e) => setGroupKey(e.target.value)} disabled={disabled}>
            <option value="">All industry groups</option>
            {groups.map((group) => (
              <option key={group.key} value={group.key}>
                {group.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor={searchId} className="mb-1 block text-xs font-medium text-muted">
            Find a category
          </label>
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. waakye, kente, trotro, susu"
            disabled={disabled}
            autoComplete="off"
          />
        </div>
      </div>
      <div>
        <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-muted">
          Category
        </label>
        <Select id={selectId} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required>
          {!shown && <option value={value}>{value || 'Choose a category'}</option>}
          {visible.map((group) => (
            <optgroup key={group.key} label={group.label}>
              {allowGroupScope && (
                <option value={group.label}>{`All ${group.label} industries`}</option>
              )}
              {group.categories.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
          {!total && <option value="">No category matches “{query.trim()}”</option>}
        </Select>
        <p className="mt-1 text-xs text-subtle" aria-live="polite">
          {total
            ? `${total} categor${total === 1 ? 'y' : 'ies'} in ${visible.length} group${visible.length === 1 ? '' : 's'}.`
            : 'Try a shorter word, or clear the search to browse every industry.'}
          {allowGroupScope && ' Choosing a whole group searches that industry broadly.'}
        </p>
      </div>
    </div>
  );
}
