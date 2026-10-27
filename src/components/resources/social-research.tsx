'use client';

// Social sources and the Social Resource Intelligence panel inside the existing Resource Collector.
// Everything shown here is a reference or an observation with a source and a status. No profile page
// is scraped, no image is downloaded, and no social observation is presented as verified by default.

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Notice } from '@/components/ui/misc';
import {
  addSocialSourceToBusiness,
  confirmSocialSource,
  recordResearchObservation,
} from '@/lib/data/social-intake-services';
import { SOCIAL_DISCOVERY_LABELS, parseSocialProfileUrl, type SocialDiscoveryPlatform } from '@/lib/domain/social-discovery';
import {
  RESEARCH_CATEGORY_LABELS,
  RESEARCH_OBSERVATION_CATEGORIES,
  RESEARCH_OBSERVATION_SOURCE_KINDS,
  RESEARCH_SOURCE_LABELS,
  SOCIAL_RETENTION_BASES,
  SOCIAL_RETENTION_BASIS_LABELS,
  SOCIAL_SOURCE_PROVENANCE_LABELS,
  SOCIAL_VERIFICATION_META,
  SOCIAL_VERIFICATION_STATUSES,
  buildSocialResearch,
  canAdvanceVerification,
  provenanceForBasis,
  verificationStatusForBasis,
  type BusinessSocialSource,
  type ResearchObservationCategory,
  type ResearchObservationSourceKind,
  type SocialRetentionBasis,
  type SocialSourceInsert,
  type SocialVerificationStatus,
} from '@/lib/domain/social-research';
import type { Business } from '@/lib/domain/types';
import { safeHref } from '@/lib/utils';
import { useAction, useResearchObservations, useSocialSources } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';

const PLATFORMS: SocialDiscoveryPlatform[] = ['instagram', 'facebook', 'tiktok'];

export function SocialResearchPanel({ business, editable, available }: { business: Business; editable: boolean; available: boolean }) {
  const { data: sources = [] } = useSocialSources(business.id);
  const { data: observations = [] } = useResearchObservations(business.id);
  const research = buildSocialResearch(business, sources, observations);

  return (
    <div className="space-y-6" data-testid="social-research">
      {!available && (
        <Notice title="Social sources need migration 017" tone="warning">
          The Asset Vault, Google previews and independent entries keep working. No migration is applied automatically.
        </Notice>
      )}
      <Card>
        <CardHeader
          title="Social sources"
          description="Known Instagram, Facebook and TikTok profiles, with how each link was obtained and how far it has been verified. A profile link is a reference; it does not prove ownership, operating status or permission to contact."
        />
        <CardBody className="space-y-4">
          {sources.length === 0 ? (
            <p className="text-sm text-subtle">
              No social profile is linked yet. Add one a person already holds, or capture permitted profiles from Discover.
            </p>
          ) : (
            <ul className="space-y-3">
              {sources.map((source) => (
                <SourceRow key={source.id} source={source} editable={editable && available} />
              ))}
            </ul>
          )}
          {editable && available && <AddSourceForm business={business} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Social resource intelligence"
          description="Identity, location, offerings, contact channels and visual references, each with its source and one of three states. Observed material is a lead for verification, not a fact."
        />
        <CardBody className="space-y-5">
          {research.groups.map((group) => (
            <section key={group.key} aria-labelledby={`research-${group.key}`}>
              <h3 id={`research-${group.key}`} className="text-sm font-semibold">
                {group.label}
              </h3>
              {group.items.length === 0 ? (
                <p className="mt-1 text-sm text-subtle">Nothing recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {group.items.map((item) => (
                    <li key={item.key} className="rounded border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="font-medium">{item.label}</strong>
                        <Badge tone={SOCIAL_VERIFICATION_META[item.status].tone}>{SOCIAL_VERIFICATION_META[item.status].label}</Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-muted">{item.value}</p>
                      <p className="mt-1 break-words text-xs text-subtle">
                        Source: {item.sourceLabel}
                        {item.sourceUrl && (
                          <>
                            {' · '}
                            <a href={safeHref(item.sourceUrl) ?? '#'} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline underline-offset-2">
                              open reference ↗
                            </a>
                          </>
                        )}
                      </p>
                      {item.note && <p className="mt-1 text-xs text-subtle">{item.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {editable && available && <AddObservationForm business={business} />}
        </CardBody>
      </Card>
    </div>
  );
}

function nextStatus(current: SocialVerificationStatus): SocialVerificationStatus {
  return SOCIAL_VERIFICATION_STATUSES.find((status) => canAdvanceVerification(current, status)) ?? current;
}

function SourceRow({ source, editable }: { source: BusinessSocialSource; editable: boolean }) {
  const [status, setStatus] = useState<SocialVerificationStatus>(() => nextStatus(source.verificationStatus));
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirm = useAction((ctx) => confirmSocialSource(ctx, source, status, evidence), {
    success: 'Verification recorded',
    onSuccess: () => {
      setEvidence('');
      setError(null);
    },
  });
  const revoke = useAction((ctx) => ctx.store.revokeSocialSource(source.id), { success: 'Social source revoked; excluded from future kits' });
  const advanceable = SOCIAL_VERIFICATION_STATUSES.filter((option) => canAdvanceVerification(source.verificationStatus, option));
  const profile = safeHref(source.profileUrl);
  return (
    <li className="rounded border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{SOCIAL_DISCOVERY_LABELS[source.platform]}</strong>
        <span className="break-all font-mono text-xs text-subtle">@{source.handle}</span>
        <Badge tone={SOCIAL_VERIFICATION_META[source.verificationStatus].tone}>{SOCIAL_VERIFICATION_META[source.verificationStatus].label}</Badge>
        {source.revokedAt && <Badge tone="danger">Revoked</Badge>}
      </div>
      <p className="mt-1 text-xs text-subtle">
        {SOCIAL_SOURCE_PROVENANCE_LABELS[source.provenance]} · {SOCIAL_RETENTION_BASIS_LABELS[source.retentionBasis]} · captured {source.capturedAt.slice(0, 10)}
      </p>
      {profile && (
        <a href={profile} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 inline-block break-all text-accent underline underline-offset-2">
          Open the public profile ↗
        </a>
      )}
      {source.verificationEvidence && <p className="mt-1 text-xs text-subtle">{source.verificationEvidence}</p>}
      {editable && !source.revokedAt && (
        <div className="mt-2 space-y-2">
          {advanceable.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-medium">Update verification</summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (evidence.trim().length < 15) return setError('Say who confirmed the profile, when and how.');
                  setError(null);
                  void confirm.run();
                }}
              >
                <Field label="New status">
                  {(props) => (
                    <Select {...props} value={status} onChange={(e) => setStatus(e.target.value as SocialVerificationStatus)}>
                      {advanceable.map((option) => (
                        <option key={option} value={option}>
                          {SOCIAL_VERIFICATION_META[option].label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Verification evidence" hint="Who confirmed it, when and how." required>
                  {(props) => <Textarea {...props} value={evidence} minLength={15} maxLength={1000} onChange={(e) => setEvidence(e.target.value)} />}
                </Field>
                <FormError message={error} />
                <Button type="submit" size="sm" loading={confirm.pending}>
                  Save verification
                </Button>
              </form>
            </details>
          )}
          <Button size="sm" variant="ghost" disabled={revoke.pending} onClick={() => void revoke.run()}>
            Revoke source
          </Button>
        </div>
      )}
    </li>
  );
}

function AddSourceForm({ business }: { business: Business }) {
  const { ctx } = useWorkspace();
  const [platform, setPlatform] = useState<SocialDiscoveryPlatform>('instagram');
  const [url, setUrl] = useState('');
  const [basis, setBasis] = useState<SocialRetentionBasis>('owner_supplied');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useAction((service, input: SocialSourceInsert) => addSocialSourceToBusiness(service, input), {
    success: 'Social source linked',
    onSuccess: () => {
      setUrl('');
      setEvidence('');
      setError(null);
    },
  });
  const status = verificationStatusForBasis(basis);
  return (
    <details className="rounded border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Add a known profile</summary>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = parseSocialProfileUrl(url.trim());
          if (!parsed) return setError('Use a public Instagram, Facebook or TikTok profile URL, not a post or share link.');
          if (parsed.platform !== platform) return setError('The platform does not match the profile URL.');
          if (status !== 'observed' && evidence.trim().length < 15) return setError('Say who supplied or confirmed the profile, when and how.');
          setError(null);
          void add.run({
            businessId: business.id,
            platform: parsed.platform,
            handle: parsed.handle.replace(/^@/, '').toLowerCase(),
            profileUrl: parsed.profileUrl,
            provenance: provenanceForBasis(basis),
            retentionBasis: basis,
            verificationStatus: status,
            verificationEvidence: status === 'observed' ? null : evidence.trim(),
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Platform">
            {(props) => (
              <Select {...props} value={platform} onChange={(e) => setPlatform(e.target.value as SocialDiscoveryPlatform)}>
                {PLATFORMS.map((option) => (
                  <option key={option} value={option}>
                    {SOCIAL_DISCOVERY_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="How this link was obtained">
            {(props) => (
              <Select {...props} value={basis} onChange={(e) => setBasis(e.target.value as SocialRetentionBasis)}>
                {SOCIAL_RETENTION_BASES.map((option) => (
                  <option key={option} value={option}>
                    {SOCIAL_RETENTION_BASIS_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Profile URL" required hint="The canonical public profile address is stored; no profile content is copied.">
          {(props) => <Input {...props} type="url" value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/…" />}
        </Field>
        {status !== 'observed' && (
          <Field label="Verification evidence" required hint="Who supplied or confirmed this profile, when and how.">
            {(props) => <Textarea {...props} value={evidence} minLength={15} maxLength={1000} onChange={(e) => setEvidence(e.target.value)} />}
          </Field>
        )}
        <p className="text-xs text-subtle">
          Recorded as <strong>{SOCIAL_VERIFICATION_META[status].label}</strong> from {SOCIAL_RETENTION_BASIS_LABELS[basis].toLowerCase()}.
          {status === 'observed' ? ' A profile seen in passing stays a lead, not an owner-confirmed account.' : ''}
        </p>
        <FormError message={error} />
        <Button type="submit" size="sm" variant="primary" loading={add.pending}>
          Link social source
        </Button>
        <p className="text-xs text-subtle">Signed in as {ctx.userLabel}. Social evidence never changes contact permission.</p>
      </form>
    </details>
  );
}

function AddObservationForm({ business }: { business: Business }) {
  const [category, setCategory] = useState<ResearchObservationCategory>('product_service');
  const [statement, setStatement] = useState('');
  const [sourceKind, setSourceKind] = useState<ResearchObservationSourceKind>('social_profile');
  const [sourceUrl, setSourceUrl] = useState('');
  const [status, setStatus] = useState<SocialVerificationStatus>('observed');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useAction(
    (service) =>
      recordResearchObservation(service, {
        businessId: business.id,
        category,
        statement,
        sourceKind: category === 'missing_information' ? 'research_gap' : sourceKind,
        sourceUrl: category === 'missing_information' ? null : sourceUrl.trim() || null,
        status: category === 'missing_information' ? 'observed' : status,
        evidence: status === 'observed' ? null : evidence.trim() || null,
      }),
    {
      success: 'Research observation recorded',
      onSuccess: () => {
        setStatement('');
        setEvidence('');
        setSourceUrl('');
        setError(null);
      },
    },
  );
  const gap = category === 'missing_information';
  const needsUrl = !gap && sourceKind !== 'business_owner';
  return (
    <details className="rounded border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Record a research observation</summary>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (statement.trim().length < 5) return setError('Describe what was observed in at least five characters.');
          if (needsUrl && !sourceUrl.trim()) return setError('This source needs a link.');
          if (sourceKind === 'social_profile' && sourceUrl.trim() && !parseSocialProfileUrl(sourceUrl.trim())) {
            return setError('Use a public Instagram, Facebook or TikTok profile URL.');
          }
          if (!gap && status !== 'observed' && evidence.trim().length < 15) return setError('Say who confirmed this, when and how.');
          setError(null);
          void add.run();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Observation category">
            {(props) => (
              <Select
                {...props}
                value={category}
                onChange={(e) => {
                  const next = e.target.value as ResearchObservationCategory;
                  setCategory(next);
                  if (next === 'missing_information') {
                    setSourceKind('research_gap');
                    setStatus('observed');
                  } else if (sourceKind === 'research_gap') {
                    setSourceKind('social_profile');
                  }
                }}
              >
                {RESEARCH_OBSERVATION_CATEGORIES.map((option) => (
                  <option key={option} value={option}>
                    {RESEARCH_CATEGORY_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Source type">
            {(props) => (
              <Select {...props} value={sourceKind} disabled={gap} onChange={(e) => setSourceKind(e.target.value as ResearchObservationSourceKind)}>
                {RESEARCH_OBSERVATION_SOURCE_KINDS.filter((option) => option !== 'research_gap' || gap).map((option) => (
                  <option key={option} value={option}>
                    {RESEARCH_SOURCE_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Observation" required hint="Describe only what the source shows. Do not copy search snippets or platform copy.">
          {(props) => <Textarea {...props} value={statement} minLength={5} maxLength={1000} onChange={(e) => setStatement(e.target.value)} />}
        </Field>
        {needsUrl && (
          <Field label={sourceKind === 'social_profile' ? 'Profile URL' : 'Source link'} required>
            {(props) => <Input {...props} type="url" value={sourceUrl} maxLength={2000} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://" />}
          </Field>
        )}
        {!gap && (
          <Field label="Status" hint="Observed is a lead. Independently verified or owner confirmed needs evidence.">
            {(props) => (
              <Select {...props} value={status} onChange={(e) => setStatus(e.target.value as SocialVerificationStatus)}>
                {SOCIAL_VERIFICATION_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {SOCIAL_VERIFICATION_META[option].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {!gap && status !== 'observed' && (
          <Field label="Verification evidence" required hint="Who confirmed it, when and how.">
            {(props) => <Textarea {...props} value={evidence} minLength={15} maxLength={1000} onChange={(e) => setEvidence(e.target.value)} />}
          </Field>
        )}
        <FormError message={error} />
        <Button type="submit" size="sm" variant="primary" loading={add.pending}>
          Save observation
        </Button>
        <p className="text-xs text-subtle">
          Observations are research notes, not assets. Logos and photographs stay references until an authorized original is approved in the Asset Vault.
        </p>
      </form>
    </details>
  );
}
