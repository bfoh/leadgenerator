'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { acceptPlaceIdentity } from '@/lib/data/identity-services';
import {
  PLACE_IDENTITY_STATUS_META,
  identityPatch,
  identityProfileOf,
  looksLikePlaceholderName,
  type PlaceIdentityEvidence,
  type PlaceIdentityReading,
} from '@/lib/domain/place-identity';
import type { Business } from '@/lib/domain/types';
import { CONFIDENCE_BAND_META, VERDICT_LABELS } from '@/lib/domain/website-assessment';
import { errorMessage } from '@/lib/utils';
import { api } from '@/lib/workspace/api';
import { useAction } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';

interface CheckResponse {
  evidence: PlaceIdentityEvidence;
  reading: PlaceIdentityReading;
  simulated: boolean;
  retrievedAt: string;
}

/**
 * Names a Place-ID-only reference from independent public sources. The search runs on the server and
 * its results are never stored: what comes back is a shortlist of sites, the name each one publishes
 * and the evidence behind it. A person reads it and decides; nothing changes on its own.
 */
export function IdentifyBusiness({ business }: { business: Business }) {
  const { can } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!can('prospects.write')) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Search /> Identify this business
      </Button>
      {open && <IdentifyDialog business={business} onClose={() => setOpen(false)} />}
    </>
  );
}

function IdentifyDialog({ business, onClose }: { business: Business; onClose: () => void }) {
  // The record as the check will compare it: sent in demo mode, re-read from the store when signed in.
  const profile = useMemo(() => identityProfileOf(business), [business]);
  const [name, setName] = useState(() => (looksLikePlaceholderName(business.name) ? '' : business.name));
  const [check, setCheck] = useState<CheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setError(null);
    try {
      setCheck(await api.post<CheckResponse>('/api/prospects/identity', { businessId: business.id, name, profile }));
    } catch (e) {
      setCheck(null);
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  const reading = check?.reading ?? null;
  const patch = reading?.status === 'identified' ? identityPatch(profile, reading.proposal) : null;
  const changes = patch
    ? [
        patch.renames ? { label: 'Name', from: profile.name, to: patch.name } : null,
        patch.officialWebsite ? { label: 'Website', from: profile.website || 'Not recorded', to: patch.officialWebsite } : null,
        patch.category ? { label: 'Category', from: profile.category || 'Not recorded', to: patch.category } : null,
        patch.city ? { label: 'Town', from: profile.city || 'Not recorded', to: patch.city } : null,
      ].filter((c): c is { label: string; from: string; to: string } => c !== null)
    : [];

  const accept = useAction((ctx) => acceptPlaceIdentity(ctx, business, check!.evidence), {
    success: (r) => `Identified as ${r.business.name}`,
    onSuccess: onClose,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="lg"
      title="Identify this business"
      description="Searches public sources for the name, reads the business's own site, and proposes a name and website. Nothing is saved until you accept it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={accept.pending} disabled={!patch || changes.length === 0} onClick={() => void accept.run()}>
            <Search /> Use this name and website
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Business name to search for" hint="The name you are looking for, not the reference label." className="min-w-56 flex-1">
            {(p) => (
              <Input
                {...p}
                value={name}
                maxLength={200}
                autoFocus
                placeholder={business.city ? `e.g. a business in ${business.city}` : 'e.g. Adom Bridal House'}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim().length >= 3 && !pending) void run();
                }}
              />
            )}
          </Field>
          <Button loading={pending} disabled={name.trim().length < 3} onClick={() => void run()}>
            <Search /> {check ? 'Search again' : 'Search'}
          </Button>
        </div>

        {error && (
          <Notice tone="danger" title="The search could not run">
            {error}
          </Notice>
        )}

        {check?.simulated && (
          <Notice tone="info" className="text-xs">
            Test data: the simulated search world answered, so these sites are fixtures rather than the public web.
          </Notice>
        )}

        {check && reading && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={PLACE_IDENTITY_STATUS_META[reading.status].tone} dot>
                {PLACE_IDENTITY_STATUS_META[reading.status].label}
              </Badge>
              <Badge tone="neutral">{CONFIDENCE_BAND_META[reading.confidence].label}</Badge>
              <span className="text-xs text-subtle">
                {reading.queryCount} of {check.evidence.queries.length} searches returned results · {reading.checks.length}{' '}
                {reading.checks.length === 1 ? 'site read' : 'sites read'}
              </span>
            </div>
            <p className="text-xs text-subtle">{PLACE_IDENTITY_STATUS_META[reading.status].description}</p>

            {reading.status === 'identified' && changes.length > 0 && (
              <section aria-labelledby="identity-proposal">
                <h3 id="identity-proposal" className="mb-1.5 text-xs font-semibold text-muted">
                  What would change
                </h3>
                <ul className="space-y-1.5 rounded-md border border-border p-3">
                  {changes.map((c) => (
                    <li key={c.label} className="grid grid-cols-[5.5rem_1fr] gap-2 text-xs">
                      <span className="text-subtle">{c.label}</span>
                      <span>
                        <span className="text-subtle line-through">{c.from}</span> → <strong className="font-medium">{c.to}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-subtle">
                  Everything else on the record stays as it is, and this site is recorded as the source of the change.
                </p>
              </section>
            )}

            {reading.concerns.length > 0 && (
              <section aria-labelledby="identity-concerns">
                <h3 id="identity-concerns" className="mb-1.5 text-xs font-semibold text-muted">
                  Check before relying on this
                </h3>
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
                  {reading.concerns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </section>
            )}

            {reading.checks.length > 0 && (
              <section aria-labelledby="identity-checks">
                <h3 id="identity-checks" className="mb-1.5 text-xs font-semibold text-muted">
                  Sites that were read
                </h3>
                <ul className="space-y-2">
                  {reading.checks.map((c) => (
                    <li key={c.site} className="rounded-md border border-border p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{c.site}</span>
                        <Badge tone={c.verdict === 'owned' ? 'success' : c.verdict === 'probable' ? 'info' : 'neutral'}>{VERDICT_LABELS[c.verdict]}</Badge>
                        {c.nameMatch > 0 && <span className="font-mono text-[11px] text-subtle">name {Math.round(c.nameMatch * 100)}%</span>}
                      </div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-subtle">
                        {c.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {check.evidence.corroboration.length > 0 && (
              <p className="text-xs text-subtle">
                Also named by {check.evidence.corroboration.map((c) => c.host).join(', ')}. Those pages are not used as a source.
              </p>
            )}

            <p className="text-[11px] text-subtle">
              Checked {check.retrievedAt.slice(0, 10)}. Search results are held in memory only; the workspace keeps the site that stood for this
              place and the evidence behind it — never Google&apos;s listing, and never the result pages.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
