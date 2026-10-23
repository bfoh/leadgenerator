'use client';

import { ArrowDownUp, Building2, ChevronDown, Download, Plus, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import * as svc from '@/lib/data/services';
import { STAGES, STAGE_LABELS, WEBSITE_STATUSES, WEBSITE_STATUS_META, type Stage, type WebsiteStatus } from '@/lib/domain/constants';
import { BAND_META, bandFor, type ScoreBand } from '@/lib/domain/scoring';
import type { Business } from '@/lib/domain/types';
import { cn, relativeTime, formatDate, todayIso } from '@/lib/utils';
import { useAction, useBusinesses } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { BulkAutomateResearch } from '@/components/automation/prospect-automation';
import { PermissionBadge, ScorePill, StageBadge, WebsiteStatusBadge } from '@/components/records/badges';
import { ExportDialog } from '@/components/records/export-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from '@/components/ui/menu';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/ui/misc';
import { BusinessFormDialog } from './business-form-dialog';

type SortKey = 'score' | 'name' | 'updated' | 'due';

const SORTS: Record<SortKey, { label: string; compare: (a: Business, b: Business) => number }> = {
  score: { label: 'Opportunity score', compare: (a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1) || a.name.localeCompare(b.name) },
  name: { label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  updated: { label: 'Recently updated', compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
  due: { label: 'Next action due', compare: (a, b) => (a.nextActionDue ?? '9999').localeCompare(b.nextActionDue ?? '9999') },
};

export function ProspectsView() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useWorkspace();
  const { data: businesses, isLoading } = useBusinesses();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [website, setWebsite] = useState<WebsiteStatus | ''>((params.get('website') as WebsiteStatus) ?? '');
  const [stage, setStage] = useState<Stage | 'open' | ''>('open');
  const [band, setBand] = useState<ScoreBand | ''>('');
  const [sort, setSort] = useState<SortKey>('score');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [exporting, setExporting] = useState(false);
  const [skipped, setSkipped] = useState<{ business: Business; reason: string }[]>([]);

  const bulk = useAction(svc.bulkChangeStage, {
    onSuccess: ({ moved, skipped }) => {
      setSelected(new Set());
      if (moved.length) toast.success(`Moved ${moved.length} record${moved.length === 1 ? '' : 's'}`);
      if (skipped.length) setSkipped(skipped);
    },
  });

  const all = useMemo(() => businesses ?? [], [businesses]);
  const cities = useMemo(() => [...new Set(all.map((b) => b.city))].sort(), [all]);
  const categories = useMemo(() => [...new Set(all.map((b) => b.category))].sort(), [all]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((b) => {
        if (q && ![b.name, b.category, b.city, b.neighborhood ?? '', b.notes].some((s) => s.toLowerCase().includes(q))) return false;
        if (city && b.city !== city) return false;
        if (category && b.category !== category) return false;
        if (website && b.websiteStatus !== website) return false;
        if (stage === 'open' && ['lost', 'archived'].includes(b.stage)) return false;
        if (stage && stage !== 'open' && b.stage !== stage) return false;
        if (band && (b.opportunityScore == null || bandFor(b.opportunityScore) !== band)) return false;
        return true;
      })
      .sort(SORTS[sort].compare);
  }, [all, query, city, category, website, stage, band, sort]);

  const selectedRecords = filtered.filter((b) => selected.has(b.id));
  const allSelected = filtered.length > 0 && selectedRecords.length === filtered.length;
  const filtersActive = Boolean(query || city || category || website || band || stage !== 'open');
  const today = todayIso();

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (isLoading) return <PageSkeleton />;

  return (
    <>
      <PageHeader
        title="Prospects"
        description="Research candidates and qualified businesses. Scores are explainable and unknown facts stay unknown."
        actions={
          <>
            {can('data.export') && (
              <Button onClick={() => setExporting(true)} disabled={!filtered.length}>
                <Download /> Export
              </Button>
            )}
            {can('prospects.write') && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus /> Add candidate
              </Button>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" aria-hidden />
          <Input aria-label="Search prospects" placeholder="Search name, category, notes…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Filter by stage" value={stage} onChange={(e) => setStage(e.target.value as Stage | 'open' | '')} className="w-auto">
          <option value="open">Open (excl. lost/archived)</option>
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by website status" value={website} onChange={(e) => setWebsite(e.target.value as WebsiteStatus | '')} className="w-auto">
          <option value="">Any website status</option>
          {WEBSITE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {WEBSITE_STATUS_META[s].label}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by city" value={city} onChange={(e) => setCity(e.target.value)} className="w-auto">
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto max-w-48">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select aria-label="Filter by score band" value={band} onChange={(e) => setBand(e.target.value as ScoreBand | '')} className="w-auto">
          <option value="">Any score</option>
          {(Object.keys(BAND_META) as ScoreBand[]).map((k) => (
            <option key={k} value={k}>
              {BAND_META[k].range} · {BAND_META[k].label}
            </option>
          ))}
        </Select>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost">
              <ArrowDownUp /> {SORTS[sort].label}
            </Button>
          </MenuTrigger>
          <MenuContent align="start">
            {(Object.keys(SORTS) as SortKey[]).map((k) => (
              <MenuItem key={k} onSelect={() => setSort(k)}>
                {SORTS[k].label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        {filtersActive && (
          <Button
            variant="ghost"
            onClick={() => {
              setQuery('');
              setCity('');
              setCategory('');
              setWebsite('');
              setBand('');
              setStage('open');
            }}
          >
            <X /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-subtle" aria-live="polite">
          {filtered.length} of {all.length}
        </span>
      </div>

      {selectedRecords.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium">{selectedRecords.length} selected</span>
          {can('prospects.write') && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" loading={bulk.pending}>
                  Move to stage <ChevronDown />
                </Button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuLabel>Gates still apply per record</MenuLabel>
                {STAGES.filter((s) => s !== 'lost').map((s) => (
                  <MenuItem key={s} onSelect={() => bulk.run(selectedRecords, s)}>
                    {STAGE_LABELS[s]}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          <BulkAutomateResearch businesses={selectedRecords} onDone={() => setSelected(new Set())} />
          {can('data.export') && (
            <Button size="sm" onClick={() => setExporting(true)}>
              <Download /> Export selected
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={all.length ? 'No prospects match these filters' : 'No prospects yet'}
            description={all.length ? 'Try clearing a filter.' : 'Add a research candidate or run a discovery search.'}
            action={
              !all.length && can('prospects.write') ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus /> Add candidate
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-border bg-surface-muted/60 text-xs text-subtle">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      className="size-4 accent-[var(--accent)]"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((b) => b.id)))}
                    />
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">Business</th>
                  <th scope="col" className="px-3 py-2 font-medium">Website</th>
                  <th scope="col" className="px-3 py-2 font-medium">Score</th>
                  <th scope="col" className="px-3 py-2 font-medium">Stage</th>
                  <th scope="col" className="px-3 py-2 font-medium">Permission</th>
                  <th scope="col" className="px-3 py-2 font-medium">Next action</th>
                  <th scope="col" className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((b) => (
                  <tr key={b.id} className={cn('group hover:bg-surface-hover/60', selected.has(b.id) && 'bg-accent-soft/40')}>
                    <td className="px-3 py-2.5">
                      <input type="checkbox" aria-label={`Select ${b.name}`} className="size-4 accent-[var(--accent)]" checked={selected.has(b.id)} onChange={() => toggle(b.id)} />
                    </td>
                    <td className="max-w-72 px-3 py-2.5">
                      <Link href={`/prospects/${b.id}`} className="block truncate font-medium hover:underline">
                        {b.name}
                      </Link>
                      <span className="block truncate text-xs text-subtle">
                        {b.category} · {b.neighborhood ? `${b.neighborhood}, ` : ''}
                        {b.city}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <WebsiteStatusBadge status={b.websiteStatus} outdated={b.websiteOutdated} />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScorePill score={b.opportunityScore} confidence={b.confidenceScore} />
                    </td>
                    <td className="px-3 py-2.5">
                      <StageBadge stage={b.stage} />
                    </td>
                    <td className="px-3 py-2.5">
                      <PermissionBadge permission={b.contactPermission} />
                    </td>
                    <td className="max-w-56 px-3 py-2.5">
                      {b.nextAction ? (
                        <>
                          <span className="block truncate">{b.nextAction}</span>
                          {b.nextActionDue && (
                            <span className={cn('text-xs', b.nextActionDue < today ? 'font-medium text-danger' : 'text-subtle')}>
                              {b.nextActionDue < today ? 'Overdue · ' : 'Due '}
                              {formatDate(b.nextActionDue)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs text-subtle">{relativeTime(b.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {creating && (
        <BusinessFormDialog
          open={creating}
          onOpenChange={(o) => {
            setCreating(o);
            if (!o && params.get('new')) router.replace('/prospects');
          }}
          onSaved={(b) => router.push(`/prospects/${b.id}`)}
        />
      )}
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        businesses={selectedRecords.length ? selectedRecords : filtered}
        scope={selectedRecords.length ? 'selected records' : filtersActive ? 'current filter' : 'all open records'}
      />
      <Dialog
        open={skipped.length > 0}
        onOpenChange={(o) => !o && setSkipped([])}
        title={`${skipped.length} record${skipped.length === 1 ? ' was' : 's were'} not moved`}
        description="Stage gates protect verification and contact-permission requirements."
        footer={<Button onClick={() => setSkipped([])}>Close</Button>}
      >
        <ul className="divide-y divide-border text-sm">
          {skipped.map(({ business, reason }) => (
            <li key={business.id} className="py-2">
              <Link href={`/prospects/${business.id}`} className="font-medium hover:underline">
                {business.name}
              </Link>
              <p className="text-subtle">{reason}</p>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
