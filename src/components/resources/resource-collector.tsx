'use client';
/* eslint-disable @next/next/no-img-element -- Official Google photo previews must load directly; Next image optimization would rehost/cache restricted content. */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Notice, PageSkeleton } from '@/components/ui/misc';
import { StudioAssetVault } from '@/components/studio/asset-vault';
import { addResourceEntry, downloadWebsiteResourceKit, openResourceVault } from '@/lib/data/resource-services';
import { RESOURCE_CATEGORIES, resourceConflicts, websiteResourceCandidates, type GoogleResourceListing, type ResourceEntry, type ResourceEntryInsert, type WebsiteResources } from '@/lib/domain/business-resources';
import type { Business } from '@/lib/domain/types';
import { errorMessage, safeHref } from '@/lib/utils';
import { api } from '@/lib/workspace/api';
import { useAction, useBusiness, useResourceCollectorSchema, useResourceEntries, useStudioProjects } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';

type GoogleStatus = { enabled: boolean; simulated: boolean; detailsMaxUsd: number; searchMaxUsd: number; photoMaxUsd: number };
type PlaceChoice = { id: string; name: string; address: string | null };
function SourceLink({ url, children }: { url: string | null; children: React.ReactNode }) {
  const href = url ? safeHref(url) : null;
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline underline-offset-2">{children} ↗</a> : <span>{children}</span>;
}
function download(zip: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(zip)], { type: 'application/zip' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ResourceCollector({ id }: { id: string }) {
  const { data: business, isLoading } = useBusiness(id);
  if (isLoading) return <PageSkeleton />;
  if (!business) return <Notice title="Prospect not found">This prospect is unavailable in your workspace.</Notice>;
  return <Workspace business={business} />;
}
function Workspace({ business }: { business: Business }) {
  const [website, setWebsite] = useState<WebsiteResources | null>(null);
  const { can } = useWorkspace();
  const { data: projects = [] } = useStudioProjects(business.id);
  const { data: entries = [] } = useResourceEntries(business.id);
  const schema = useResourceCollectorSchema();
  const project = projects.find((p) => p.status !== 'archived') ?? null;
  const open = useAction((ctx) => openResourceVault(ctx, business));
  const exportKit = useAction((ctx) => downloadWebsiteResourceKit(ctx, business.id, project), { onSuccess: (result) => download(result.zip, result.filename) });
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><Link href={`/prospects/${business.id}`} className="text-sm text-accent">← Prospect profile</Link><h1 className="mt-2 text-xl font-semibold">Collect Business Resources</h1><p className="mt-1 text-sm text-subtle">{business.name} · Google listing, independent sources and authorized files.</p></div>
      {can('data.export') && <Button variant="primary" loading={exportKit.pending} onClick={() => void exportKit.run()}>Download Website Resource Kit</Button>}
    </div>
    <Notice title="Build manually or continue in Studio" tone="info">Collect and export resources without a Brand Kit, creative direction or generated website. Google previews stay out of the download; only approved files and independently verified entries with export rights are included.</Notice>
    <GoogleViewer business={business} entries={entries} website={website} editable={can('studio.write')} />
    <WebsiteViewer business={business} editable={can('studio.write')} onResult={setWebsite} />
    {schema.data === false && <Notice title="Independent resource ledger unavailable" tone="warning">Migration 016 is needed to save independent entries. Google viewing and the existing Asset Vault remain available. No migration is applied automatically.</Notice>}
    <ResourceEntries business={business} entries={entries} editable={can('studio.write') && schema.data === true} />
    <section aria-label="Authorized assets">
      {project ? <StudioAssetVault project={project} editable={can('studio.write')} canDelete={can('records.delete')} canExport={can('data.export')} businessName={business.name} allowAuthorizedImport /> : <Card><CardHeader title="Authorized files" description="Supply owner-authorized uploads or independently licensed originals. Candidates must be approved before download." /><CardBody><Button loading={open.pending} disabled={!can('studio.write')} onClick={() => void open.run()}>Add authorized files</Button><p className="mt-2 text-xs text-subtle">No Brand Kit or website generation is required. Google and social-platform images cannot be imported from their preview links.</p></CardBody></Card>}
    </section>
  </div>;
}

/**
 * Google's required attribution when Places content is displayed without a Google map. The asset is
 * Google's official, unmodified Google Maps logo from Google_Maps_Attribution_Assets.zip
 * (developers.google.com/maps/documentation/places/web-service/policies): the non-outlined variant
 * for a plain background, 18px high (16-19dp allowed), clear space 10dp at the sides and top and
 * 5dp below, with an accessible label reading "Google Maps".
 */
function GoogleAttribution() {
  return <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs"><span className="inline-flex items-center rounded bg-white pb-[5px] pl-[10px] pr-[10px] pt-[10px]"><img src="/brand/google-maps-attribution.svg" alt="Google Maps" width={98} height={18} className="h-[18px] w-auto" /></span><Link href="/terms" className="underline">Terms</Link><Link href="/privacy" className="underline">Privacy</Link><span>Preview only · excluded from downloads</span></div>;
}
function GoogleViewer({ business, entries, website, editable }: { business: Business; entries: ResourceEntry[]; website: WebsiteResources | null; editable: boolean }) {
  const generation = useRef(0);
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [placeId, setPlaceId] = useState(business.placesPlaceId ?? '');
  const [query, setQuery] = useState(`${business.name} ${business.city}`);
  const [choices, setChoices] = useState<PlaceChoice[]>([]);
  const [listing, setListing] = useState<GoogleResourceListing | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveId = useAction((ctx) => ctx.store.updateBusiness(business.id, { placesPlaceId: placeId }), { success: 'Place ID saved; no Google content stored' });
  useEffect(() => { let active = true; void api.get<GoogleStatus>('/api/resources').then((v) => { if (active) setStatus(v); }).catch((e) => { if (active) setError(errorMessage(e)); }); return () => { active = false; }; }, []);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!listing && !choices.length) return;
    const timer = setTimeout(() => { generation.current++; setListing(null); setChoices([]); setPhotos({}); }, 5 * 60_000);
    return () => clearTimeout(timer);
  }, [listing, choices]);
  async function run(action: 'search' | 'details' | 'photo', photoName?: string) {
    const requestGeneration = action === 'photo' ? generation.current : ++generation.current;
    setPending(photoName ?? action); setError(null);
    try {
      if (action === 'search') { const r = await api.post<{ results: PlaceChoice[] }>('/api/resources', { action, businessId: business.id, query, country: business.country, authorized: true }); if (requestGeneration !== generation.current) return; setChoices(r.results); setListing(null); setPhotos({}); if (!r.results.length) setError('No matching places returned. Refine the name and location.'); }
      if (action === 'details') { setListing(null); setPhotos({}); const r = await api.post<{ listing: GoogleResourceListing }>('/api/resources', { action, businessId: business.id, placeId, authorized: true }); if (requestGeneration !== generation.current) return; setListing(r.listing); setChoices([]); }
      if (action === 'photo' && photoName) { const r = await api.post<{ uri: string }>('/api/resources', { action, businessId: business.id, name: photoName, authorized: true }); if (requestGeneration === generation.current) setPhotos((v) => ({ ...v, [photoName]: r.uri })); }
    } catch (e) { setError(errorMessage(e)); } finally { setPending(null); }
  }
  const cost = (n: number | undefined) => status?.simulated ? 'simulated · no charge' : `billable · budget estimate up to $${(n ?? 0.05).toFixed(2)}`;
  return <Card><CardHeader title="Google Business listing" description="Official Places API (New). Current-view preview only; reload after expiry. No Google listing content is saved or used to generate a website." /><CardBody className="space-y-4">
    {status && !status.enabled && <Notice title="Live lookup is disabled" tone="warning">Configure the server-side Places key and enable resource lookup after reviewing billing and applicable Google terms. You can still collect independent resources below.</Notice>}
    {status?.simulated && <Notice title="Fictional test responses" tone="info">No Google API call is made. The photo stand-in is an original test illustration.</Notice>}
    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"><Field label="Google Place ID">{(p) => <Input {...p} value={placeId} onChange={(e) => setPlaceId(e.target.value)} />}</Field><Button disabled={!editable || !status?.enabled || !placeId || Boolean(pending)} loading={pending === 'details'} onClick={() => void run('details')}>Load Google listing</Button></div>
    <p className="text-xs text-subtle">Listing request: {cost(status?.detailsMaxUsd)}. Each photo preview is requested separately. No background polling or automatic paid requests.</p>
    <details><summary className="cursor-pointer text-sm font-medium">Find a Place ID</summary><div className="mt-3 space-y-3"><Field label="Business name and location">{(p) => <Input {...p} value={query} onChange={(e) => setQuery(e.target.value)} />}</Field><Button disabled={!editable || !status?.enabled || Boolean(pending)} loading={pending === 'search'} onClick={() => void run('search')}>Search Google Places</Button><p className="text-xs text-subtle">One page, up to three choices · {cost(status?.searchMaxUsd)}.</p></div></details>
    <FormError message={error} />
    {pending && <p role="status" className="text-sm text-subtle">Loading {pending === 'search' ? 'Google matches' : pending === 'details' ? 'listing' : 'photo preview'}…</p>}
    {choices.map((v) => <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3 text-sm"><span>{v.name}<small className="block text-subtle">{v.address}</small></span><Button size="sm" onClick={() => { setPlaceId(v.id); setChoices([]); }}>Choose listing</Button></div>)}
    {listing && <div className="space-y-4 rounded-lg border border-border bg-surface-hover p-4" data-testid="google-listing">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{listing.name}</h3><p className="text-xs text-subtle">{listing.status} {listing.simulated ? '· Simulated' : ''}</p></div><Button size="sm" disabled={!editable || saveId.pending || placeId !== listing.id} onClick={() => void saveId.run()}>Save Place ID only</Button></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-subtle">Address</dt><dd>{listing.address ?? 'Not supplied'}</dd></div><div><dt className="text-xs text-subtle">Phone</dt><dd>{listing.phone ?? 'Not supplied'}</dd></div><div><dt className="text-xs text-subtle">Website field</dt><dd>{listing.website ? <SourceLink url={listing.website}>{listing.website}</SourceLink> : 'Not supplied — independently verify website status'}</dd></div><div><dt className="text-xs text-subtle">Opening hours</dt><dd>{listing.hours.length ? listing.hours.map((v) => <p key={v}>{v}</p>) : 'Not supplied'}</dd></div></dl>
      <div className="flex flex-wrap gap-4 text-sm"><SourceLink url={listing.mapsUri}>View listing source</SourceLink>{listing.directionsUri && <SourceLink url={listing.directionsUri}>Directions at Google Maps</SourceLink>}</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{listing.photos.map((p, i) => <div key={p.name} className="min-w-0 space-y-2 rounded border border-border p-3">{photos[p.name] ? <img src={photos[p.name]} alt={`Business photo preview ${i + 1}`} width={800} height={500} className="aspect-[8/5] w-full object-contain" referrerPolicy="no-referrer" onError={() => setError('Photo expired or unavailable. Reload the listing for a fresh reference.')} /> : <Button disabled={Boolean(pending)} onClick={() => void run('photo', p.name)}>Preview photo {i + 1}</Button>}<p className="text-xs text-subtle">{cost(status?.photoMaxUsd)} · preview only</p>{p.authors.map((a, j) => <p key={j} className="flex items-center gap-2 text-xs">{a.photoUri && <img src={a.photoUri} alt="" width={24} height={24} className="size-6 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />}<SourceLink url={a.uri}>{a.name}</SourceLink></p>)}<SourceLink url={p.googleMapsUri ?? listing.mapsUri}>View this photo on Google Maps</SourceLink></div>)}</div>
      {!listing.photos.length && <p className="text-sm text-subtle">No supported photos returned.</p>}
      {listing.attributions.map((v, i) => <p key={i} className="text-xs"><SourceLink url={v.uri}>{v.provider}</SourceLink></p>)}
      {resourceConflicts(listing, entries, website).map((v) => <Notice key={v} title="Conflicting details" tone="warning">{v}</Notice>)}
    </div>}
    <GoogleAttribution />
  </CardBody></Card>;
}

function WebsiteViewer({ business, editable, onResult }: { business: Business; editable: boolean; onResult: (result: WebsiteResources | null) => void }) {
  const [url, setUrl] = useState(business.officialWebsite ?? '');
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState<WebsiteResources | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function inspect() {
    setPending(true); setError(null); setReading(null); onResult(null);
    try { const result = await api.post<WebsiteResources>('/api/resources', { action: 'website', businessId: business.id, url, independentlyVerified: verified }); setReading(result); onResult(result); } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
  }
  const facts = reading?.facts;
  return <Card><CardHeader title="Independent website and social sources" description="One guarded homepage read: logos, favicon, image references, contacts and branding. Files are candidates until the owner supplies export-authorized originals." /><CardBody className="space-y-4">
    <Field label="Official website to analyze">{(p) => <Input {...p} placeholder="https://business.example" value={url} onChange={(e) => { setUrl(e.target.value); setVerified(false); }} />}</Field>
    <Checkbox label="I independently verified that this website belongs to this business" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
    <Button disabled={!editable || !verified || !url} loading={pending} onClick={() => void inspect()}>Analyze official website</Button><FormError message={error ?? reading?.error} />
    <div className="flex flex-wrap gap-3 text-sm"><SourceLink url={`https://www.google.com/search?q=${encodeURIComponent(`${business.name} ${business.city} official website social profiles`)}`}>Find independent sources</SourceLink>{business.socialProfiles.map((s, i) => <SourceLink key={i} url={s.url}>{s.platform} (recorded profile)</SourceLink>)}</div>
    {!business.officialWebsite && !reading && <p className="text-sm text-subtle">No official website recorded. Confirm owner-controlled social links and ask the owner for logos, original photos and a service list. No social platform is scraped.</p>}
    {reading && <div className="space-y-4" data-testid="website-resources">
      {reading.simulated && <Notice title="Simulated website reading" tone="info">Fictional data for local testing; no website was fetched.</Notice>}
      <p className="text-sm"><SourceLink url={reading.url}>Analyzed source</SourceLink> · {facts?.siteName ?? facts?.title ?? 'No readable page'}</p>
      <div className="grid gap-4 md:grid-cols-2"><div><h3 className="text-sm font-semibold">Logo, favicon and image candidates</h3><ul className="mt-2 space-y-2 text-sm">{websiteResourceCandidates(reading).map((v) => <li key={v.url}><span className="mr-2 text-xs text-subtle">{v.kind} · reference only</span><SourceLink url={v.url}>{v.label}</SourceLink></li>)}</ul><p className="mt-2 text-xs text-subtle">Open source links for review. To import, obtain authorized originals and add them in the vault below; no remote image is silently copied.</p></div>
      <div className="space-y-3 text-sm"><div><h3 className="font-semibold">Branding references</h3><p>Colors: {facts?.colors.join(', ') || 'Not found'}</p><p>Typography: {facts?.fonts.join(', ') || 'Not found'} — font licences need confirmation.</p></div><div><h3 className="font-semibold">Products and services</h3>{reading.offerings?.map((v) => <div key={`${v.kind}:${v.name}`} className="mt-2"><strong>{v.name}</strong><p>{v.description}</p><small className="text-subtle">{v.kind} · source reference; reuse unconfirmed</small></div>)}{facts?.navLinks.filter((v) => ['products', 'services'].includes(v.category)).map((v) => <p key={v.url}><SourceLink url={v.url}>{v.label}</SourceLink></p>)}<p className="text-xs text-subtle">Descriptions need owner confirmation and reuse rights.</p></div><div><h3 className="font-semibold">Contacts and linked social profiles</h3><p>Location hint: {facts?.schemaLocality ?? 'Not found — confirm with owner'}</p>{reading.contacts?.phones.map((v) => <p key={v.normalized}>{v.normalized} · website candidate</p>)}{reading.contacts?.emails.map((v) => <p key={v.normalized}>{v.normalized} · website candidate</p>)}{facts?.socialLinks.map((v) => <p key={v.url}><SourceLink url={v.url}>{v.platform} · linked from website</SourceLink></p>)}</div></div></div>
    </div>}
  </CardBody></Card>;
}

function ResourceEntries({ business, entries, editable }: { business: Business; entries: ResourceEntry[]; editable: boolean }) {
  const [category, setCategory] = useState<ResourceEntryInsert['category']>('identity');
  const [kind, setKind] = useState<ResourceEntryInsert['sourceKind']>('business_owner');
  const [label, setLabel] = useState(''); const [value, setValue] = useState(''); const [source, setSource] = useState(''); const [evidence, setEvidence] = useState('');
  const [verified, setVerified] = useState(false); const [allowed, setAllowed] = useState(false);
  const add = useAction((ctx) => addResourceEntry(ctx, { businessId: business.id, category, label, value, sourceKind: kind, sourceUrl: source, evidence, independentlyVerified: true, exportPermission: allowed ? 'granted' : 'denied' }), { success: 'Independent resource saved', onSuccess: () => { setLabel(''); setValue(''); setEvidence(''); setVerified(false); setAllowed(false); } });
  const revoke = useAction((ctx, id: string) => ctx.store.revokeResourceEntry(id), { success: 'Resource revoked; excluded from future kits' });
  return <Card><CardHeader title="Independent, permissioned resources" description="Record facts, social/directions links, services, brand colors, typography references and a development brief. Do not copy Google results. Entries require independent source and permission evidence." /><CardBody className="space-y-4">
    <ul className="space-y-3">{entries.map((v) => <li key={v.id} className="rounded border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{v.label}</strong><span className="text-xs text-subtle">{v.revokedAt ? 'Revoked' : v.exportPermission === 'granted' ? 'Export permitted' : 'Excluded from download'}</span></div><p className="mt-1 whitespace-pre-wrap break-words">{v.value}</p><p className="mt-2 text-xs"><SourceLink url={v.sourceUrl}>Independent source</SourceLink> · {v.sourceKind} · {v.evidence}</p>{editable && !v.revokedAt && <Button size="sm" className="mt-2" disabled={revoke.pending} onClick={() => void revoke.run(v.id)}>Revoke {v.label}</Button>}</li>)}</ul>
    {editable && <details><summary className="cursor-pointer text-sm font-medium">Add independent resource</summary><form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); if (verified) void add.run(); }}>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Resource category">{(p) => <Select {...p} value={category} onChange={(e) => setCategory(e.target.value as ResourceEntryInsert['category'])}>{RESOURCE_CATEGORIES.map((v) => <option key={v}>{v}</option>)}</Select>}</Field><Field label="Independent source type">{(p) => <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as ResourceEntryInsert['sourceKind'])}><option value="business_owner">Business owner</option><option value="official_website">Official website</option><option value="licensed_original">Licensed original</option></Select>}</Field></div>
      <Field label="Resource label" required>{(p) => <Input {...p} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}</Field><Field label="Resource value" required>{(p) => <Textarea {...p} value={value} maxLength={2000} onChange={(e) => setValue(e.target.value)} />}</Field>
      <Field label="Independent source URL" hint="Use the owner's website, consent record or licensed-original evidence. Google and platform URLs are not independent source records." required>{(p) => <Input {...p} type="url" value={source} onChange={(e) => setSource(e.target.value)} />}</Field>
      <Field label="Verification and permission evidence" required>{(p) => <Textarea {...p} minLength={15} maxLength={1000} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Who confirmed this, when, and which reuse rights were granted?" />}</Field>
      <Checkbox label="Independently verified; not copied from Google content" checked={verified} onChange={(e) => setVerified(e.target.checked)} /><Checkbox label="The recorded evidence grants export rights for this entry" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
      <Button type="submit" variant="primary" loading={add.pending} disabled={!verified}>Save independent resource</Button>
    </form></details>}
    <p className="text-xs text-subtle">Publication rights remain separate. A public phone number is not consent to contact the business.</p>
  </CardBody></Card>;
}
