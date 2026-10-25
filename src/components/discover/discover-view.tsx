'use client';

import { AlertTriangle, AtSign, Building2, CircleSlash, Compass, ExternalLink, Globe, Info, Loader2, MapPin, Music2, Plus, RotateCw, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { classifyListedLink, type ListedLinkKind } from '@/lib/domain/links';
import { COUNTRIES, citiesFor, findCountry, neighborhoodsFor, regionForCity } from '@/lib/domain/geo';
import { complianceForCategory } from '@/lib/domain/industry-compliance';
import { categoryGroups } from '@/lib/domain/settings';
import {
  SOCIAL_DISCOVERY_LABELS,
  SOCIAL_DISCOVERY_NOTICE,
  SOCIAL_DISCOVERY_PLATFORMS,
  type SocialCandidate,
  type SocialCandidateVerification,
  type SocialDiscoveryPlatform,
} from '@/lib/domain/social-discovery';
import type { UsageInsert } from '@/lib/domain/types';
import { cn, errorMessage, formatDateTime, safeHref } from '@/lib/utils';
import { ApiError, api, recordCharge, useServerStatus, type ProviderInfo, type ServerStatus } from '@/lib/workspace/api';
import { useBusinesses, useUsage } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { BusinessFormDialog } from '@/components/prospects/business-form-dialog';
import { CategorySelector } from '@/components/discover/category-selector';
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

interface SocialSearchResponse {
  candidates: SocialCandidate[];
  simulated: boolean;
  retained: false;
  usage: UsageInsert | null;
  retrievedAt: string;
}

type DiscoverySource = 'google' | 'social' | 'both';

type Filter = 'all' | ListedLinkKind;

const STATUS_LABELS: Record<string, { label: string; tone: 'warning' | 'danger' }> = {
  CLOSED_TEMPORARILY: { label: 'Listed as temporarily closed', tone: 'warning' },
  CLOSED_PERMANENTLY: { label: 'Listed as permanently closed', tone: 'danger' },
};

const DAY_MS = 86_400_000;

const SOURCE_OPTIONS: readonly (readonly [DiscoverySource, string])[] = [
  ['google', 'Google'],
  ['social', 'Social'],
  ['both', 'Both'],
];

export function DiscoverView() {
  const status = useServerStatus();
  if (status.isLoading) return <PageSkeleton />;
  if (status.error || !status.data) {
    return <EmptyState icon={AlertTriangle} title="Could not load discovery providers" description={errorMessage(status.error)} action={<Button onClick={() => status.refetch()}>Retry</Button>} />;
  }
  return (
    <Discover
      providers={status.data.discovery}
      social={status.data.socialDiscovery}
      serverTools={status.data.serverTools}
      quota={status.data.quotas.discovery}
    />
  );
}

function Discover({
  providers,
  social,
  serverTools,
  quota,
}: {
  providers: ProviderInfo[];
  social?: ServerStatus['socialDiscovery'];
  serverTools: boolean;
  quota: number;
}) {
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

  // Social discovery: which public platforms to look at, and the transient results of the last run.
  const [source, setSource] = useState<DiscoverySource>('both');
  const [platforms, setPlatforms] = useState<SocialDiscoveryPlatform[]>([...SOCIAL_DISCOVERY_PLATFORMS]);
  const [socialResults, setSocialResults] = useState<SocialCandidate[] | null>(null);
  const [socialRetrievedAt, setSocialRetrievedAt] = useState<string | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialError, setSocialError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [socialTracking, setSocialTracking] = useState<SocialCandidate | null>(null);
  const socialRequestId = useRef(0);

  const [results, setResults] = useState<DiscoveryResult[] | null>(null);
  const [lastQuery, setLastQuery] = useState<SearchBody | null>(null);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [retrievedAt, setRetrievedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState<'search' | 'more' | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean; retry: () => void } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [tracking, setTracking] = useState<DiscoveryResult | null>(null);
  /** Fictional practice results store no Place ID, so the row keeps its own link to the new record. */
  const [trackedDemo, setTrackedDemo] = useState<Record<string, string>>({});
  const requestId = useRef(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  const tracked = useMemo(() => new Map(businesses.filter((b) => b.placesPlaceId).map((b) => [b.placesPlaceId!, b])), [businesses]);
  const metered = provider && !provider.capabilities.isDemo;
  const usedToday = (usage.data ?? []).filter((u) => u.operation === 'discovery_search' && u.provider === providerId).length;
  const spentToday = (usage.data ?? []).filter((u) => u.provider === providerId).reduce((s, u) => s + u.estimatedCostUsd, 0);
  const quotaLeft = Math.max(0, quota - usedToday);
  // Which sources this search will use. "Both" skips a source the server cannot serve, with a
  // notice, rather than blocking the search entirely.
  const showGoogle = source !== 'social';
  const showSocial = source !== 'google';
  const googleReady = Boolean(serverTools && provider?.configured) && (!metered || quotaLeft > 0);
  const socialEnabled = social?.enabled ?? false;
  const socialMetered = Boolean(social && !social.simulated);
  const socialUsedToday = (usage.data ?? []).filter((u) => u.operation === 'social_discovery_search').reduce((s, u) => s + u.units, 0);
  const socialQuota = social?.quota ?? 0;
  const socialQuotaLeft = Math.max(0, socialQuota - socialUsedToday);
  const socialReady = Boolean(serverTools && socialEnabled) && (!socialMetered || socialQuotaLeft > 0);
  const searchGoogle = showGoogle && googleReady;
  const searchSocial = showSocial && socialReady;
  const canSearch = searchGoogle || searchSocial;
  const groups = categoryGroups(settings);
  // Activities that need a licence before trading get a plain note, so a search is never mistaken
  // for encouragement to operate unlawfully.
  const complianceNote = complianceForCategory(category);
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

  async function runSocial() {
    if (!platforms.length) return;
    const id = ++socialRequestId.current;
    setSocialLoading(true);
    setSocialError(null);
    try {
      const res = await api.post<SocialSearchResponse>('/api/discover/social', {
        country,
        region: region || null,
        city: city.trim() || null,
        category: category.trim(),
        terms: terms.trim() || null,
        platforms,
        limit: 20,
      });
      if (id !== socialRequestId.current) return;
      await recordCharge(store, res.usage);
      setSocialResults(res.candidates);
      setSocialRetrievedAt(res.retrievedAt);
    } catch (e) {
      if (id !== socialRequestId.current) return;
      const retryable = e instanceof ApiError ? [0, 429, 502, 503, 504].includes(e.status) : true;
      setSocialError({ message: errorMessage(e), retryable });
      setSocialResults(null);
    } finally {
      if (id === socialRequestId.current) setSocialLoading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((!city.trim() && !region) || !category.trim()) return setError({ message: 'Choose a region or a city / town, and a category.', retryable: false, retry: () => undefined });
    if (showSocial && !platforms.length) return setError({ message: 'Choose at least one social platform.', retryable: false, retry: () => undefined });
    setFilter('all');
    setSocialResults(null);
    setSocialError(null);
    if (searchGoogle) {
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
    } else {
      setResults(null);
      setNextPageToken(null);
    }
    if (searchSocial) void runSocial();
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
                <Field label="Discovery sources">
                  {() => (
                    <div role="radiogroup" aria-label="Discovery sources" className="grid grid-cols-3 gap-1 rounded-md border border-border p-1">
                      {SOURCE_OPTIONS.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={source === value}
                          onClick={() => {
                            setSource(value);
                            setResults(null);
                            setSocialResults(null);
                            setError(null);
                            setSocialError(null);
                          }}
                          className={cn('rounded px-2 py-1.5 text-xs font-medium', source === value ? 'bg-foreground text-background' : 'text-muted hover:bg-surface-hover')}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
                {showSocial && (
                  <Field label="Social platforms" hint={social ? undefined : 'Not reported by this server'}>
                    {() => (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Social platforms">
                        {SOCIAL_DISCOVERY_PLATFORMS.map((platform) => {
                          const active = platforms.includes(platform);
                          return (
                            <button
                              key={platform}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setPlatforms((prev) => (active ? prev.filter((p) => p !== platform) : [...prev, platform]))}
                              className={cn(
                                'rounded-full border border-border px-2.5 py-0.5 text-xs',
                                active ? 'border-accent bg-accent-soft text-accent-strong' : 'text-muted hover:bg-surface-hover',
                              )}
                            >
                              {SOCIAL_DISCOVERY_LABELS[platform]}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </Field>
                )}
                {showGoogle && (
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
                )}
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
                <div className="sm:col-span-2">
                  <CategorySelector groups={groups} value={category} onChange={setCategory} />
                  {complianceNote && (
                    <p className="mt-2 text-xs text-subtle" data-testid="compliance-note">
                      <span className="font-medium text-muted">Licensing:</span> {complianceNote.regulator}. {complianceNote.note}
                    </p>
                  )}
                </div>
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
                {showGoogle && !googleReady && (
                  <Notice tone="warning" className="px-3 py-2 text-xs" title="Google discovery unavailable">
                    {!serverTools
                      ? 'Discovery is disabled on this deployment.'
                      : !provider?.configured
                        ? 'Set GOOGLE_PLACES_API_KEY on the server.'
                        : 'The daily Google discovery quota is used up.'}
                  </Notice>
                )}
                {showSocial && !socialReady && (
                  <Notice tone="warning" className="px-3 py-2 text-xs" title="Social discovery unavailable">
                    {!serverTools
                      ? 'Discovery is disabled on this deployment.'
                      : !social
                        ? 'This server does not report social discovery.'
                        : !social.enabled
                          ? social.searchConfigured
                            ? 'Social discovery is switched off on the server.'
                            : 'Set BRAVE_SEARCH_API_KEY and SOCIAL_DISCOVERY_ENABLED=true on the server.'
                          : 'The daily social discovery quota is used up.'}
                  </Notice>
                )}
                <Button type="submit" variant="primary" className="w-full justify-center" loading={loading === 'search' || socialLoading} disabled={!canSearch}>
                  <Search /> Search
                </Button>
              </form>
            </CardBody>
          </Card>
          {showGoogle && provider && <ProviderPanel provider={provider} usedToday={usedToday} quota={quota} spentToday={spentToday} />}
          {showSocial && <SocialProviderPanel social={social} usedToday={socialUsedToday} quotaLeft={socialQuotaLeft} />}
        </div>

        <div ref={resultsRef} className="min-w-0 scroll-mt-16 space-y-4">
          {showGoogle && error && (
            <Notice tone="danger" icon={AlertTriangle} title="Search failed">
              <p>{error.message}</p>
              {error.retryable && (
                <Button size="sm" className="mt-2" onClick={error.retry} loading={loading != null}>
                  <RotateCw /> Try again
                </Button>
              )}
            </Notice>
          )}

          {showGoogle && (loading === 'search' ? (
            <ResultsSkeleton />
          ) : results == null ? (
            showSocial && (socialLoading || socialResults != null) ? null : (
              <Card>
                <EmptyState
                  icon={Compass}
                  title="Search for candidate businesses"
                  description="Choose a region or a town, and a category. A missing website in a listing is a research lead, not proof the business has no website."
                />
              </Card>
            )
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
                      trackedId={tracked.get(r.externalId)?.id ?? trackedDemo[r.externalId] ?? null}
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
          ))}
          {!showGoogle && !socialLoading && socialResults == null && (
            <Card>
              <EmptyState
                icon={Compass}
                title="Search for public business profiles"
                description="Choose a region or a town, a category and at least one platform. Most small businesses have no indexed profile; a result is a lead to check, not a confirmed account."
              />
            </Card>
          )}
          {showSocial && socialError && (
            <Notice tone="danger" icon={AlertTriangle} title="Social search failed">
              <p>{socialError.message}</p>
              {socialError.retryable && (
                <Button size="sm" className="mt-2" onClick={() => void runSocial()} loading={socialLoading}>
                  <RotateCw /> Try again
                </Button>
              )}
            </Notice>
          )}
          {showSocial && socialLoading && <ResultsSkeleton />}
          {showSocial && !socialLoading && socialResults != null && (
            <SocialResults
              candidates={socialResults}
              simulated={Boolean(social?.simulated)}
              retrievedAt={socialRetrievedAt}
              canTrack={can('prospects.write')}
              onReview={setSocialTracking}
            />
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
          onSaved={(b) => {
            if (tracking) setTrackedDemo((m) => ({ ...m, [tracking.externalId]: b.id }));
            setTracking(null);
          }}
        />
      )}

      {socialTracking && (
        <BusinessFormDialog
          open
          onOpenChange={(o) => !o && setSocialTracking(null)}
          initial={{
            name: socialTracking.displayName,
            category,
            country,
            region,
            city,
            neighborhood,
            sourceKind: 'manual',
          }}
          requireIndependentSource
          notice={
            <Notice
              tone={socialTracking.simulated ? 'warning' : 'info'}
              icon={Info}
              title={socialTracking.simulated ? 'Fictional profile' : `Found as “${socialTracking.handle}” on ${SOCIAL_DISCOVERY_LABELS[socialTracking.platform]}`}
            >
              {socialTracking.simulated ? (
                'This business does not exist. Add it only to practise the workflow.'
              ) : (
                <>
                  A social profile is not an independent business record, and search results are not saved. Confirm the name, location and contact details from the
                  business’s own website, signboard or a directory, add that source link, and keep this profile as a research note only.
                </>
              )}
            </Notice>
          }
          onSaved={() => setSocialTracking(null)}
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

/**
 * What the social path will do and what it costs. The platforms have no licensed keyword-search
 * API, so this path reads a public web index and never crawls a profile page.
 */
function SocialProviderPanel({ social, usedToday, quotaLeft }: { social: ServerStatus['socialDiscovery']; usedToday: number; quotaLeft: number }) {
  const usedPct = social && social.quota > 0 ? Math.min(100, ((social.quota - quotaLeft) / social.quota) * 100) : 100;
  return (
    <Card>
      <CardBody className="space-y-3 text-xs">
        <p className="text-sm font-medium">Social profiles</p>
        {!social ? (
          <p className="text-subtle">This server does not report social discovery.</p>
        ) : social.simulated ? (
          <p className="text-subtle">Simulated results. Fictional profiles, no network calls, no cost.</p>
        ) : !social.enabled ? (
          <Notice tone="warning" className="text-xs">
            {social.searchConfigured
              ? 'Social discovery is switched off. Set SOCIAL_DISCOVERY_ENABLED=true to allow paid searches.'
              : 'Social discovery needs BRAVE_SEARCH_API_KEY on the server.'}
          </Notice>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-subtle">Searches in the last 24 h</span>
              <span className="tabular">
                {usedToday} / {social.quota}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
              role="meter"
              aria-label="Daily social discovery quota used"
              aria-valuenow={usedToday}
              aria-valuemin={0}
              aria-valuemax={social.quota}
            >
              <div className={cn('h-full rounded-full', usedPct >= 90 ? 'bg-danger' : 'bg-accent')} style={{ width: `${usedPct}%` }} />
            </div>
            <p className="text-subtle">
              ≈ US${social.costPerQueryUsd.toFixed(3)} per platform per search · up to {social.maxQueries} queries. Results are not stored.
            </p>
          </div>
        )}
        <div className="space-y-1 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 font-medium text-muted">
            <CircleSlash className="size-3.5" aria-hidden /> Data use
          </p>
          <p className="text-subtle">
            This searches a public web index for profile links. It never calls a platform’s own search API and never copies profile content into the workspace.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

const VERIFICATION_LABELS: Record<SocialCandidateVerification, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  likely_official: { label: 'Likely official', tone: 'success' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  possible_duplicate: { label: 'Possible duplicate', tone: 'warning' },
  wrong_business: { label: 'Looks like another business', tone: 'danger' },
};

function SocialResults({
  candidates,
  simulated,
  retrievedAt,
  canTrack,
  onReview,
}: {
  candidates: SocialCandidate[];
  simulated: boolean;
  retrievedAt: string | null;
  canTrack: boolean;
  onReview: (candidate: SocialCandidate) => void;
}) {
  const reviewable = candidates.filter((c) => c.verification !== 'wrong_business').length;
  return (
    <Card className="overflow-hidden" data-testid="social-results">
      <CardBody className="space-y-1.5 border-b border-border">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Social profiles</h2>
          <Badge tone="neutral">{candidates.length} found</Badge>
          {reviewable < candidates.length && <Badge tone="danger">{candidates.length - reviewable} excluded</Badge>}
          {simulated && <Badge tone="warning">Fictional demo data</Badge>}
          <span className="ml-auto text-xs text-subtle">Retrieved {formatDateTime(retrievedAt)} · not stored</span>
        </div>
        <p className="text-xs text-subtle">{SOCIAL_DISCOVERY_NOTICE}</p>
      </CardBody>
      {candidates.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No public profiles found"
          description="Try a broader category, another town or a different platform. Most small businesses have no indexed profile."
        />
      ) : (
        <ul className="divide-y divide-border" aria-live="polite">
          {candidates.map((c) => (
            <SocialResultRow key={c.profileUrl} candidate={c} canTrack={canTrack} onReview={() => onReview(c)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function SocialResultRow({ candidate: c, canTrack, onReview }: { candidate: SocialCandidate; canTrack: boolean; onReview: () => void }) {
  const badge = VERIFICATION_LABELS[c.verification];
  const Icon = c.platform === 'instagram' ? AtSign : c.platform === 'facebook' ? Users : Music2;
  const blocked = c.verification === 'wrong_business';
  const profile = safeHref(c.profileUrl);
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-subtle" aria-hidden />
          <p className="break-words font-medium">{c.displayName || c.handle}</p>
          <Badge tone="neutral">{SOCIAL_DISCOVERY_LABELS[c.platform]}</Badge>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          {c.simulated && <Badge tone="warning">Fictional</Badge>}
        </div>
        <p className="break-all font-mono text-xs text-subtle">{c.handle}</p>
        {c.snippet && <p className="text-sm text-muted">{c.snippet}</p>}
        <ul className="space-y-0.5 text-xs text-subtle">
          {c.evidence.map((e) => (
            <li key={e} className="break-words">
              · {e}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span className="text-subtle">Confidence {Math.round(c.confidence * 100)}%</span>
          {profile && (
            <a href={profile} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-accent-strong hover:underline">
              Open profile <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          <span className="break-words text-subtle">
            Search: <span className="font-mono">{c.sourceQuery}</span>
          </span>
        </div>
      </div>
      <div className="shrink-0">
        {blocked ? (
          <span className="text-xs text-subtle">Not this business</span>
        ) : canTrack ? (
          <Button size="sm" onClick={onReview}>
            <Plus /> Review &amp; add
          </Button>
        ) : null}
      </div>
    </li>
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
