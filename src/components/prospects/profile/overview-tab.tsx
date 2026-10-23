'use client';

import { Check, CircleDashed, ExternalLink, MapPin, X } from 'lucide-react';
import { useState } from 'react';
import { BUDGET_LABELS, BUSINESS_STATUS_LABELS, INTEREST_LABELS, SOURCE_KIND_LABELS } from '@/lib/domain/constants';
import { countryName } from '@/lib/domain/geo';
import { qualificationChecklist } from '@/lib/domain/pipeline';
import { formatMoney } from '@/lib/domain/proposal';
import type { Business } from '@/lib/domain/types';
import { cn, errorMessage, formatDate, formatDateTime, safeHref } from '@/lib/utils';
import { api, recordCharge, useServerStatus } from '@/lib/workspace/api';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DefinitionList, Notice } from '@/components/ui/misc';
import { IdentityCard } from './identity-card';

export function ExternalLinkText({ href, children }: { href: string | null | undefined; children?: React.ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return href ? <span className="break-all">{href}</span> : null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-accent-strong underline-offset-2 hover:underline">
      {children ?? safe.replace(/^https?:\/\//, '').replace(/\/$/, '')}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

export function OverviewTab({ business, onTab }: { business: Business; onTab: (tab: string) => void }) {
  const checklist = qualificationChecklist(business);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <DefinitionList
              items={[
                { label: 'Category', value: business.category },
                { label: 'Operating status', value: BUSINESS_STATUS_LABELS[business.businessStatus] },
                { label: 'Location', value: [business.neighborhood, business.city, business.region, countryName(business.country)].filter(Boolean).join(', ') },
                { label: 'Address or landmark', value: business.address },
                { label: 'Official website', value: business.officialWebsite ? <ExternalLinkText href={business.officialWebsite} /> : null },
                {
                  label: 'Social profiles (business-declared)',
                  value: business.socialProfiles.length ? (
                    <ul className="space-y-0.5">
                      {business.socialProfiles.map((s) => (
                        <li key={s.url}>
                          <span className="mr-1 text-subtle capitalize">{s.platform.replace('_', ' ')}:</span>
                          <ExternalLinkText href={s.url} />
                        </li>
                      ))}
                    </ul>
                  ) : null,
                },
                { label: 'Source', value: SOURCE_KIND_LABELS[business.sourceKind] },
                { label: 'Source URL', value: business.sourceUrl ? <ExternalLinkText href={business.sourceUrl} /> : null },
                { label: 'Added', value: formatDateTime(business.createdAt) },
                { label: 'Last updated', value: formatDateTime(business.updatedAt) },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Business contact details" description="Published business contact points. Recording them is not permission to market." />
          <CardBody>
            <DefinitionList
              items={[
                { label: 'Enquiry channel', value: business.enquiryChannel },
                { label: 'Phone', value: business.phone },
                { label: 'Email', value: business.email },
                { label: 'Where published', value: business.contactSource },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Commercial" description="Only what the business has stated." />
          <CardBody>
            <DefinitionList
              items={[
                { label: 'Interest', value: INTEREST_LABELS[business.interestLevel] },
                { label: 'Budget signal', value: BUDGET_LABELS[business.budgetSignal] },
                { label: 'Service needs', value: business.serviceNeeds.length ? business.serviceNeeds.join(', ') : null },
                { label: 'Estimated value', value: business.estimatedValue != null ? formatMoney(business.estimatedValue) : null },
                { label: 'Expected close', value: business.expectedCloseDate ? formatDate(business.expectedCloseDate) : null },
                { label: 'Next action', value: business.nextAction ? `${business.nextAction}${business.nextActionDue ? ` (due ${formatDate(business.nextActionDue)})` : ''}` : null },
              ]}
            />
          </CardBody>
        </Card>

        {business.notes.trim() && (
          <Card>
            <CardHeader title="Research notes" />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{business.notes}</p>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Qualification checklist" />
          <CardBody>
            <ul className="space-y-2.5">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-start gap-2 text-sm">
                  {c.passed ? (
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />
                  ) : c.required ? (
                    <X className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Required, not done" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-subtle" aria-label="Optional, not done" />
                  )}
                  <span className={cn(!c.passed && 'text-muted')}>
                    {c.label}
                    {c.required && !c.passed && <span className="ml-1 text-xs text-danger">required</span>}
                  </span>
                </li>
              ))}
            </ul>
            {business.websiteStatus === 'unverified' && (
              <Button className="mt-4 w-full justify-center" onClick={() => onTab('verification')}>
                Open verification workbench
              </Button>
            )}
          </CardBody>
        </Card>
        <IdentityCard business={business} />
        {business.placesPlaceId && <PlacesReference business={business} />}
      </div>
    </div>
  );
}

interface PlaceDetails {
  name: string;
  address: string | null;
  websiteUri: string | null;
  mapsUri: string | null;
  businessStatus: string | null;
  phone: string | null;
}

/** Live, display-only Google Places details. Nothing here is written to the CRM. */
function PlacesReference({ business }: { business: Business }) {
  const { store } = useWorkspace();
  const status = useServerStatus();
  const provider = status.data?.discovery.find((p) => p.id === 'google_places');
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    setPending(true);
    setError(null);
    try {
      const res = await api.get<{ result: PlaceDetails | null; usage: Parameters<typeof recordCharge>[1] }>(
        `/api/discover?provider=google_places&id=${encodeURIComponent(business.placesPlaceId!)}`,
      );
      await recordCharge(store, res.usage);
      if (!res.result) setError('Google Places has no details for this reference.');
      setDetails(res.result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Google Places reference" description="Only the Place ID is stored." />
      <CardBody className="space-y-3">
        <p className="break-all font-mono text-xs text-subtle">{business.placesPlaceId}</p>
        {!provider?.configured ? (
          <p className="text-xs text-subtle">Live details need GOOGLE_PLACES_API_KEY on the server.</p>
        ) : (
          <Button size="sm" onClick={load} loading={pending}>
            <MapPin /> {details ? 'Refresh live details' : 'Show live details'}
          </Button>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        {details && (
          <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3 text-sm">
            <p className="font-medium">{details.name}</p>
            {details.address && <p className="text-muted">{details.address}</p>}
            {details.phone && <p className="text-muted">{details.phone}</p>}
            {details.websiteUri && <ExternalLinkText href={details.websiteUri} />}
            {details.businessStatus && <p className="text-xs text-subtle">Listing status: {details.businessStatus.replace(/_/g, ' ').toLowerCase()}</p>}
            {details.mapsUri && <ExternalLinkText href={details.mapsUri}>Open in Google Maps</ExternalLinkText>}
            <p className="text-[11px] text-subtle">{provider?.attribution.text}. Display only — not saved. A listing website is a lead for verification, not proof.</p>
          </div>
        )}
        {!details && (
          <Notice tone="neutral" className="text-xs">
            Google&apos;s terms allow storing the Place ID only. Details are fetched on demand and never saved.
          </Notice>
        )}
      </CardBody>
    </Card>
  );
}
