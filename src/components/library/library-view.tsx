'use client';

import { Copy, Download, ExternalLink, Info } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { ARCHETYPES, archetypeByKey, designBrief, type Archetype } from '@/lib/domain/archetypes';
import { TRACKS, trackForCategory } from '@/lib/domain/categories';
import { isOpenStage } from '@/lib/domain/pipeline';
import { cn, download, safeHref, slug } from '@/lib/utils';
import { useBusinesses } from '@/lib/workspace/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/field';
import { Notice, PageHeader } from '@/components/ui/misc';

const COMPLEXITY_TONE = { Low: 'success', Medium: 'warning', High: 'danger' } as const;

const archetypeFor = (category: string) => TRACKS[trackForCategory(category)].archetype;

export function LibraryView() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = archetypeByKey(params.get('archetype') ?? '') ?? ARCHETYPES[0];
  const businessId = params.get('business') ?? '';
  const { data: businesses = [] } = useBusinesses();
  const business = businesses.find((b) => b.id === businessId) ?? null;

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const b of businesses) if (isOpenStage(b.stage)) out.set(archetypeFor(b.category), (out.get(archetypeFor(b.category)) ?? 0) + 1);
    return out;
  }, [businesses]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/library?${next}`, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Website solution library"
        description="Reusable starting points for proposals and concept builds. Each one describes a typical structure — tailor it to what the business has actually confirmed."
      />
      <div role="radiogroup" aria-label="Archetype" className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {ARCHETYPES.map((a) => (
          <button
            key={a.key}
            type="button"
            role="radio"
            aria-checked={a.key === selected.key}
            onClick={() => setParam('archetype', a.key)}
            className={cn(
              'rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-border-strong',
              a.key === selected.key && 'border-accent ring-1 ring-accent',
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">{a.name}</span>
              <Badge tone={COMPLEXITY_TONE[a.complexity]} className="shrink-0">
                {a.complexity}
              </Badge>
            </span>
            <span className="mt-1 block text-xs text-subtle">{a.targetBusiness}</span>
            {counts.get(a.key) ? <span className="mt-1.5 block text-xs text-muted">{counts.get(a.key)} open prospects in matching categories</span> : null}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ArchetypeDetail archetype={selected} />
        <BriefCard
          archetype={selected}
          business={business}
          options={businesses}
          onBusiness={(id) => {
            const next = new URLSearchParams(params);
            if (id) next.set('business', id);
            else next.delete('business');
            router.replace(`/library?${next}`, { scroll: false });
          }}
        />
      </div>
    </>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium text-muted">{title}</h3>
      <ul className="list-disc space-y-0.5 pl-4 text-sm marker:text-subtle">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function ArchetypeDetail({ archetype: a }: { archetype: Archetype }) {
  const ref = a.reference ? safeHref(a.reference.url) : null;
  return (
    <Card>
      <CardHeader title={a.name} description={`For ${a.targetBusiness.toLowerCase()}`} actions={<Badge tone={COMPLEXITY_TONE[a.complexity]}>{a.complexity} complexity</Badge>} />
      <CardBody className="space-y-5">
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted">Design direction</h3>
          <p className="text-sm leading-relaxed">{a.designDirection}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <ListBlock title="Pages" items={a.pages} />
          <ListBlock title="Features" items={a.features} />
          <ListBlock title="Integrations" items={a.integrations} />
          <ListBlock title="Needed from the client" items={a.clientAssets} />
        </div>
        <div>
          <h3 className="mb-1.5 text-xs font-medium text-muted">Typical phases</h3>
          <ol className="flex flex-wrap gap-1.5 text-xs">
            {a.phases.map((p, i) => (
              <li key={p} className="rounded-md border border-border bg-surface-muted px-2 py-1">
                <span className="text-subtle">{i + 1}.</span> {p}
              </li>
            ))}
          </ol>
        </div>
        {a.reference && (
          <Notice tone="warning" icon={Info} title="Creative reference — not a client">
            <p>
              {a.reference.label}. {a.reference.note}
            </p>
            {ref && (
              <a href={ref} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-medium underline underline-offset-2">
                View prototype <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </Notice>
        )}
      </CardBody>
    </Card>
  );
}

function BriefCard({
  archetype,
  business,
  options,
  onBusiness,
}: {
  archetype: Archetype;
  business: { id: string; name: string; category: string; city: string; serviceNeeds: string[] } | null;
  options: { id: string; name: string; category: string; stage: Parameters<typeof isOpenStage>[0]; contactPermission: string }[];
  onBusiness: (id: string) => void;
}) {
  const brief = designBrief(archetype, business ? { name: business.name, category: business.category, city: business.city, needs: business.serviceNeeds } : undefined);
  const sorted = options
    .filter((b) => b.contactPermission !== 'opted_out')
    .map((b) => ({ ...b, match: archetypeFor(b.category) === archetype.key }))
    .sort((a, b) => Number(b.match) - Number(a.match) || a.name.localeCompare(b.name));
  const mismatch = business && archetypeFor(business.category) !== archetype.key;

  async function copy() {
    try {
      await navigator.clipboard.writeText(brief);
      toast.success('Design brief copied');
    } catch {
      toast.error('Could not copy. Use Download instead.');
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Design brief"
        description="Markdown ready for a concept build in Claude Code. Uses only recorded facts; everything else stays a labelled placeholder."
      />
      <CardBody className="flex flex-1 flex-col gap-3">
        <Field label="Tailor to a prospect" hint="Adds the business name, category, city and confirmed service needs.">
          {(p) => (
            <Select {...p} value={business?.id ?? ''} onChange={(e) => onBusiness(e.target.value)}>
              <option value="">Generic brief</option>
              {sorted.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.match ? ' · suggested' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {mismatch && (
          <p className="text-xs text-warning">
            {business.category} usually maps to “{archetypeByKey(archetypeFor(business.category))?.name}”. Check this archetype fits before using the brief.
          </p>
        )}
        <pre className="max-h-[28rem] min-h-48 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-muted p-3 font-mono text-xs leading-relaxed" tabIndex={0} aria-label="Design brief preview">
          {brief}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={copy}>
            <Copy className="size-4" aria-hidden /> Copy brief
          </Button>
          <Button variant="secondary" onClick={() => download(`brief-${slug(business?.name ?? archetype.key)}.md`, brief, 'text/markdown;charset=utf-8')}>
            <Download className="size-4" aria-hidden /> Download .md
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
