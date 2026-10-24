'use client';

import { AlertTriangle, AtSign, Building2, CircleSlash, Compass, ExternalLink, Globe, Info, Loader2, MapPin, Plus, RotateCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { classifyListedLink, type ListedLinkKind } from '@/lib/domain/links';
import { COUNTRIES, citiesFor, findCountry, neighborhoodsFor, regionForCity } from '@/lib/domain/geo';
import { allCategories } from '@/lib/domain/settings';
import type { UsageInsert } from '@/lib/domain/types';
import { cn, errorMessage, formatDateTime, safeHref } from '@/lib/utils';
import { ApiError, api, recordCharge, useServerStatus, type ProviderInfo } from '@/lib/workspace/api';
import { useBusinesses, useUsage } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { BusinessFormDialog } from '@/components/prospects/business-form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { EmptyState, Notice, PageHeader, PageSkeleton, Skeleton } from '@/components/ui/misc';

interface DiscoveryResult {
  providerId: string;
  externalId: string;
  name: string;
  address: string | null;
  websiteUri: string | null;
  mapsUri: string | null;
  businessStatus: string | null;
  primaryType: string | null;
  isDemo: boolean;
}

interface SearchBody {
  providerId: string;
  country: string;
  region: string | null;
  /** Null searches the whole region. */
  city: string | null;
  neighborhood: string | null;
  category: string;
  terms: string | null;
  limit: number;
  pageToken: string | null;
  websitePreference: 'any';
}

interface SearchResponse {
  results: DiscoveryResult[];
  nextPageToken: string | null;
  usage: UsageInsert | null;
  retrievedAt: string;
}

type Filter = 'all' | ListedLinkKind;

const STATUS_LABELS: Record<string, { label: string; tone: 'warning' | 'danger' }> = {
  CLOSED_TEMPORARILY: { label: 'Listed as temporarily closed', tone: 'warning' },
  CLOSED_PERMANENTLY: { label: 'Listed as permanently closed', tone: 'danger' },
};

const DAY_MS = 86_400_000;

export function DiscoverView() {
  const status = useServerStatus();
  if (status.isLoading) return <PageSkeleton />;
  if (status.error || !status.data) {
    return <EmptyState icon={AlertTriangle} title="Could not load discovery providers" description={errorMessage(status.error)} action={<Button onClick={() => status.refetch()}>Retry</Button>} />;
  }
  return <Discover providers={status.data.discovery} serverTools={status.data.serverTools} quota={status.data.quotas.discovery} />;
}

function Discover({ providers, serverTools, quota }: { providers: ProviderInfo[]; serverTools: boolean; quota: number }) {
  const { settings, store, can } = useWorkspace();
  const { data: businesses = [] } = useBusinesses();
  const [since] = useState(() => new Date(Date.now() - DAY_MS).toISOString());
  const usage = useUsage(since);

  const defaultProvider = providers.find((p) => p.configured && !p.capabilities.isDemo) ?? providers.find((p) => p.configured) ?? providers[0];
  const [providerId, setProviderId] = useState(defaultProvider?.id ?? 'demo');
  const provider = providers.find((p) => p.id === providerId) ?? defaultProvider;

  const [country, setCountry] = useState('GH');
  // No default place: searches cover whichever of the sixteen regions (or towns) the user picks.
  const [city, setCity] = useState('');
  const [region, setRegion] = useState<string>('');
  const [neighborhood, setNeighborhood] = useState('');
  const [category, setCategory] = useState('Furniture showroom');
  const [terms, setTerms] = useState('');
  const [limit, setLimit] = useState(20);

  const [results, setResults] = useState<DiscoveryResult[] | null>(null);
  const [lastQuery, setLastQuery] = useState<SearchBody | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<'search' | 'more' | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean; retry: () => void } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [tracking, setTracking] = useState<DiscoveryResult | null>(null);
  const requestId = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  const tracked = useMemo(() => new Map(businesses.filter((b) => b.placesPlaceId).map((b) => [b.placesPlaceId!, b])), [businesses]);
  const metered = provider && !provider.capabilities.isDemo;
  const usedToday = (usage.data ?? []).filter((u) => u.operation === 'discovery_search' && u.provider === providerId).length;
  const spentToday = (usage.data ?? []).filter((u) => u.provider === providerId).reduce((s, u) => s + u.estimatedCostUsd, 0);
  const quotaLeft = Math.max(0, quota - usedToday);
  const categories = allCategories(settings);
  const countryInfo = findCountry(country);

  async function run(body: SearchBody, mode: 'search' | 'more') {
    const id = ++requestId.current;
    setLoading(mode);
    setError(null);
    try {
      const res = await api.post<SearchResponse>('/api/discover', body);
      if (id !== requestId.current) return;
      await recordCharge(store, res.usage);
      setResults((prev) => (mode === 'more' && prev ? [...prev, ...res.results.filter((r) => !prev.some((p) => p.externalId === r.externalId))] : res.results));
      setNextPageToken(res.nextPageToken);
      setRetrievedAt(res.retrievedAt);
      setLastQuery({ ...body, pageToken: null });
      // On narrow screens the results sit below the form; bring them into view.
      if (mode === 'search' && window.matchMedia('(max-width: 1279px)').matches) {
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
      if (metered) void usage.refetch();
    } catch (e) {
      if (id !== requestId.current) return;
      const retryable = e instanceof ApiError ? [0, 429, 502, 503, 504].includes(e.status) : true;
      setError({ message: errorMessage(e), retryable, retry: () => run(body, mode) });
    } finally {
      if (id === requestId.current) setLoading(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((!city.trim() && !region) || !category.trim()) return setError({ message: 'Choose a region or a city / town, and a category.', retryable: false, retry: () => undefined });
    setFilter('all');
    run(
      {
        providerId,
        country,
        region: region || null,
        city: city.trim() || null,
        neighborhood: neighborhood.trim() || null,
        category: category.trim(),
        terms: terms.trim() || null,
        limit,
        pageToken: null,
        websitePreference: 'any',
      },
      'search',
    );
  }

  const kinds = useMemo(() => {
    const counts = { website: 0, social: 0, none: 0 };
    for (const r of results ?? []) counts[classifyListedLink(r.websiteUri)]++;
    return counts;
  }, [results]);
  const shown = (results ?? []).filter((r) => filter === 'all' || classifyListedLink(r.websiteUri) === filter);

  return (
    <>
      <PageHeader
        title="Discover"
        description="Find candidate businesses through official provider APIs. Results are shown for this session only and are not saved. Track a business to research it, with details confirmed from an independent source."
      />

      {!serverTools && (
        <Notice tone="warning" title="Discovery is disabled on this deployment" className="mb-4">
          Discovery calls run on the server. Configure Supabase sign-in, or set DEMO_SERVER_TOOLS=true on a private deployment.
        </Notice>
      )}

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardBody>
              <form onSubmit={submit} className="space-y-4" noValidate>
                <Field label="Provider">
                  {(p) => (
                    <Select {...p} value={providerId} onChange={(e) => (setProviderId(e.target.value), setResults(null), setError(null))}>
                      {providers.map((pr) => (
                        <option key={pr.id} value={pr.id} disabled={!pr.configured}>
                          {pr.name}
                          {pr.configured ? '' : ' — not configured'}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Country">
                    {(p) => (
                      <Select {...p} value={country} onChange={(e) => setCountry(e.target.value)}>
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Region">
                    {(p) => (
                      <Select
                        {...p}
                        value={region}
                        onChange={(e) => {
                          const next = e.target.value;
                          setRegion(next);
                          // A town from another region would contradict the choice; clearing it searches the whole region.
                          const home = regionForCity(city, country);
                          if (next && home && home !== next) {
                            setCity('');
                            setNeighborhood('');
                          }
                        }}
                      >
                        <option value="">Any</option>
                        {countryInfo?.regions.map((r) => (
                          <option key={r.name}>{r.name}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="City / town" hint={region ? 'Leave empty to search the whole region.' : undefined}>
                    {(p) => (
                      <>
                        <Input
                          {...p}
                          list="discover-cities"
                          value={city}
                          placeholder={region ? 'Whole region' : undefined}
                          onChange={(e) => {
                            setCity(e.target.value);
                            const r = regionForCity(e.target.value, country);
                            if (r) setRegion(r);
                          }}
                        />
                        <datalist id="discover-cities">
                          {citiesFor(country, region || null).map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      </>
                    )}
                  </Field>
                  <Field label="Neighbourhood">
                    {(p) => (
                      <>
                        <Input {...p} list="discover-neighborhoods" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Optional" />
                        <datalist id="discover-neighborhoods">
                          {neighborhoodsFor(city, country).map((n) => (
                            <option key={n} value={n} />
                          ))}
                        </datalist>
                      </>
                    )}
                  </Field>
                </div>
                {region && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Main towns in ${region}`}>
                    {citiesFor(country, region).map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={city === c}
                        onClick={() => {
                          setCity(city === c ? '' : c);
                          setNeighborhood('');
                        }}
                        className={cn('rounded-full border border-border px-2.5 py-0.5 text-xs', city === c ? 'border-accent bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-hover')}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                )}
                <Field label="Category" required>
                  {(p) => (
                    <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Custom search terms" hint="Optional. Replaces the category’s default search phrase.">
                  {(p) => <Input {...p} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. office furniture" />}
                </Field>
                <Field label="Results per page">
                  {(p) => (
                    <Select {...p} value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))}>
                      {[10, 20].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button type="submit" variant="primary" className="w-full justify-center" loading={loading === 'search'} disabled={!serverTools || !provider?.configured || (metered && quotaLeft === 0)}>
                  <Search /> Search
                </Button>
              </form>
            </CardBody>
          </Card>
          {provider && <ProviderPanel provider={provider} usedToday={usedToday} quota={quota} spentToday={spentToday} />}
        </div>

        <div ref={resultsRef} className="min-w-0 scroll-mt-16 space-y-4">
          {error && (
            <Notice tone="danger" icon={AlertTriangle} title="Search failed">
              <p>{error.message}</p>
              {error.retryable && (
                <Button size="sm" className="mt-2" onClick={error.retry} loading={loading != null}>
                  <RotateCw /> Try again
                </Button>
              )}
            </Notice>
          )}

          {loading === 'search' ? (
            <ResultsSkeleton />
          ) : results == null ? (
            <Card>
              <EmptyState
                icon={Compass}
                title="Search for candidate businesses"
                description="Choose a region or a town, and a category. A missing website in a listing is a research lead, not proof the business has no website."
              />
            </Card>
          ) : results.length === 0 ? (
            <Card>
              <EmptyState icon={Search} title="No businesses found" description="Try a broader category, another neighbourhood or custom search terms." />
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Filter results by listed website">
                {(
                  [
                    ['all', `All ${results.length}`],
                    ['none', `No website listed ${kinds.none}`],
                    ['social', `Social profile only ${kinds.social}`],
                    ['website', `Website listed ${kinds.website}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={filter === value}
                    onClick={() => setFilter(value)}
                    className={cn('rounded-full border border-border px-3 py-1 text-xs font-medium', filter === value ? 'border-foreground bg-foreground text-background' : 'bg-surface text-muted hover:bg-surface-hover')}
                  >
                    {label}
                  </button>
                ))}
                <span className="ml-auto text-xs text-subtle">
                  Retrieved {formatDateTime(retrievedAt)} · {provider?.attribution.text}
                </span>
              </div>

              <Card className="overflow-hidden">
                <ul className="divide-y divide-border" aria-live="polite">
                  {shown.map((r) => (
                    <ResultRow
                      key={r.externalId}
                      result={r}
                      trackedId={tracked.get(r.externalId)?.id ?? null}
                      canTrack={can('prospects.write')}
                      onTrack={() => setTracking(r)}
                    />
                  ))}
                  {shown.length === 0 && <li className="px-4 py-8 text-center text-sm text-subtle">No results in this filter.</li>}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                  <p className="text-xs text-subtle">
                    {provider?.capabilities.isDemo ? 'Fictional demo data — these businesses do not exist.' : <GoogleAttribution provider={provider} />}
                  </p>
                  {nextPageToken && lastQuery && (
                    <Button size="sm" onClick={() => run({ ...lastQuery, pageToken: nextPageToken }, 'more')} loading={loading === 'more'} disabled={metered && quotaLeft === 0}>
                      Load more{metered ? ` (≈ US$${provider!.estimatedCostUsd.search.toFixed(3)})` : ''}
                    </Button>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      {tracking && (
        <BusinessFormDialog
          open
          onOpenChange={(o) => !o && setTracking(null)}
          initial={{
            name: tracking.isDemo ? tracking.name : '',
            category,
            country,
            region,
            city,
            neighborhood,
            sourceKind: tracking.isDemo ? 'manual' : 'places_reference',
            placesPlaceId: tracking.isDemo ? '' : tracking.externalId,
            notes: tracking.isDemo ? 'Created from a fictional demo discovery result (practice only).' : '',
          }}
          requireIndependentSource={!tracking.isDemo}
          notice={
            tracking.isDemo ? (
              <Notice tone="warning" title="Fictional result">
                This business does not exist. Track it only to practise the workflow.
              </Notice>
            ) : (
              <Notice tone="info" icon={Info} title={`Listed on Google Maps as “${tracking.name}”`}>
                Google’s terms allow storing only the Place ID. Enter the name and any details as confirmed from an independent source — such as the business’s own social page, signboard or a directory — and add that source’s link. You can view live Google details from the prospect’s profile at any time.
              </Notice>
            )
          }
          onSaved={() => setTracking(null)}
        />
      )}
    </>
  );
}

function GoogleAttribution({ provider }: { provider: ProviderInfo | undefined }) {
  return (
    <span>
      <span className="font-medium text-muted" translate="no">
        Google Maps
      </span>{' '}
      · display only, not stored ·{' '}
      {provider?.retention.policyUrl && (
        <a href={provider.retention.policyUrl} target="_blank" rel="noopener noreferrer" className="underline">
          data policy
        </a>
      )}
    </span>
  );
}

function ResultRow({ result: r, trackedId, canTrack, onTrack }: { result: DiscoveryResult; trackedId: string | null; canTrack: boolean; onTrack: () => void }) {
  const kind = classifyListedLink(r.websiteUri);
  const website = safeHref(r.websiteUri);
  const maps = safeHref(r.mapsUri);
  const closed = r.businessStatus ? STATUS_LABELS[r.businessStatus] : undefined;
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{r.name}</p>
          {r.primaryType && <span className="text-xs text-subtle">{r.primaryType}</span>}
          {r.isDemo && <Badge tone="warning">Fictional</Badge>}
          {closed && <Badge tone={closed.tone}>{closed.label}</Badge>}
        </div>
        {r.address && (
          <p className="flex items-start gap-1.5 text-sm text-muted">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
            {r.address}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          {kind === 'none' && (
            <Badge tone="success" dot title="The listing has no website field. This is not proof the business has no website — verify before relying on it.">
              No website listed
            </Badge>
          )}
          {kind === 'social' && (
            <Badge tone="warning" dot title="The listing’s website field points to a social profile, not an official website.">
              Social profile listed, no website
            </Badge>
          )}
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-center gap-1 text-accent-strong hover:underline">
              {kind === 'social' ? <AtSign className="size-3.5 shrink-0" aria-hidden /> : <Globe className="size-3.5 shrink-0" aria-hidden />}
              <span className="truncate">{website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 60)}</span>
            </a>
          )}
          {maps && (
            <a href={maps} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground hover:underline">
              View on Google Maps <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>
        {kind === 'none' && <p className="text-xs text-subtle">Not proof that no website exists — verify before relying on it.</p>}
      </div>
      <div className="shrink-0">
        {trackedId ? (
          <Link href={`/prospects/${trackedId}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-hover">
            <Building2 className="size-3.5" aria-hidden /> In CRM
          </Link>
        ) : canTrack ? (
          <Button size="sm" onClick={onTrack}>
            <Plus /> Track as candidate
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ProviderPanel({ provider, usedToday, quota, spentToday }: { provider: ProviderInfo; usedToday: number; quota: number; spentToday: number }) {
  const metered = !provider.capabilities.isDemo;
  const pct = quota > 0 ? Math.min(100, (usedToday / quota) * 100) : 100;
  return (
    <Card>
      <CardBody className="space-y-3 text-xs">
        <p className="text-sm font-medium">{provider.name}</p>
        {!provider.configured && (
          <Notice tone="warning" className="text-xs">
            Set GOOGLE_PLACES_API_KEY in the server environment (Vercel environment variables, then redeploy; .env.local when running locally) and enable “Places API (New)” for the key’s project.
          </Notice>
        )}
        {metered ? (
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-subtle">Searches in the last 24 h</span>
              <span className="tabular">
                {usedToday} / {quota}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted" role="meter" aria-label="Daily discovery quota used" aria-valuenow={usedToday} aria-valuemin={0} aria-valuemax={quota}>
              <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-danger' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-subtle">
              ≈ US${provider.estimatedCostUsd.search.toFixed(3)} per search page · ≈ US${spentToday.toFixed(3)} today (estimate). The server enforces the daily quota.
            </p>
          </div>
        ) : (
          <p className="text-subtle">No cost. Results are fictional.</p>
        )}
        <div className="space-y-1 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 font-medium text-muted">
            <CircleSlash className="size-3.5" aria-hidden /> Data use
          </p>
          <p className="text-subtle">{provider.retention.notes}</p>
          <p className="text-subtle">
            Stored if tracked: <span className="font-mono">Place ID</span> only.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function ResultsSkeleton() {
  return (
    <Card className="divide-y divide-border" role="status" aria-label="Searching">
      <p className="flex items-center gap-2 px-4 py-3 text-sm text-subtle">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
      </p>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-2 px-4 py-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </Card>
  );
}
