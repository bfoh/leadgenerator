'use client';

import { Globe, History, Pencil, Search, ShieldAlert, Wrench } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import * as svc from '@/lib/data/services';
import { latestVerification } from '@/lib/domain/rescore';
import { VERIFICATION_METHOD_LABELS, type VerificationMethod } from '@/lib/domain/constants';
import { manualSearchLinks } from '@/lib/domain/search-links';
import type { Business, TechnicalCheck, UsageInsert, WebsiteVerification } from '@/lib/domain/types';
import { errorMessage, formatDateTime } from '@/lib/utils';
import { api, recordCharge, useServerStatus } from '@/lib/workspace/api';
import { useAction, useAuditEvents, useVerifications } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { WebsiteStatusBadge } from '@/components/records/badges';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { EmptyState, Notice } from '@/components/ui/misc';
import { ExternalLinkText } from './overview-tab';
import { AgentReview, AutomatedVerificationCard, ClassificationBadge, EvidenceConfidenceBadge, EvidenceDetails, ReviewStatusBadge } from './agent-verification';
import { VerificationFields, emptyVerification, useVerificationDraft, verificationToDraft } from './verification-form';

interface DomainProbe {
  domain: string;
  resolves: boolean;
  note: string;
}
interface SearchHit {
  title: string;
  url: string;
  description: string;
}

export function VerificationTab({ business }: { business: Business }) {
  const { can, store } = useWorkspace();
  const status = useServerStatus();
  const { data: verifications = [] } = useVerifications(business.id);
  const { draft, setDraft, errors, validate, reset } = useVerificationDraft(emptyVerification({ domain: business.officialWebsite ?? '' }));
  const [technical, setTechnical] = useState<TechnicalCheck | null>(null);
  const [checkUrl, setCheckUrl] = useState(business.officialWebsite ?? '');
  const pickWebsite = (url: string) => {
    setCheckUrl(url);
    setDraft((d) => ({ ...d, domain: url }));
  };
  const writable = can('verification.write');
  const serverTools = status.data?.serverTools ?? false;

  const record = useAction((ctx, form: Parameters<typeof svc.recordVerification>[2]) => svc.recordVerification(ctx, business, form, technical), {
    success: 'Verification recorded',
    onSuccess: () => {
      reset(emptyVerification());
      setTechnical(null);
    },
  });

  const suggest = (...methods: VerificationMethod[]) =>
    setDraft((d) => ({ ...d, methods: [...new Set([...((d.methods ?? []) as VerificationMethod[]), ...methods])] }));

  const sorted = [...verifications].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  const current = latestVerification(verifications);

  return (
    <div className="space-y-5">
      <Notice tone="neutral" icon={ShieldAlert}>
        A missing website in a directory or search result is not proof that none exists. Record each check you make; “No official website found” needs at least two documented methods.
      </Notice>
      <AutomatedVerificationCard business={business} verifications={verifications} />
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader title="1. Search manually" description="Opens in your browser. Nothing is fetched by the server." as="h3" />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {manualSearchLinks(business.name, business.city).map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => suggest(l.label.startsWith('Exact') ? 'exact_name_search' : l.label.includes('Facebook') || l.label.includes('Instagram') ? 'social_profile_review' : 'name_variation_search')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface-hover"
                  >
                    <Search className="size-3 text-subtle" aria-hidden /> {l.label}
                  </a>
                ))}
              </div>
              <p className="mt-3 text-xs text-subtle">Opening a link ticks the matching method in the form. Untick it if you did not actually complete the search.</p>
            </CardBody>
          </Card>

          {!serverTools ? (
            <Notice tone="info" title="Automated checks are off on this deployment">
              Website checks, domain probes and web search run on the server. Enable Supabase sign-in, or set DEMO_SERVER_TOOLS=true on a private deployment.
            </Notice>
          ) : (
            <>
              <WebSearchCard business={business} configured={status.data?.webSearch.configured ?? false} disabled={!writable} onCheck={pickWebsite} onSource={(url) => setDraft((d) => ({ ...d, sourceUrl: url }))} onSearched={() => suggest('exact_name_search')} />
              <DomainProbeCard business={business} disabled={!writable} onUse={pickWebsite} onProbed={() => suggest('domain_probe')} />
              <WebsiteCheckCard
                url={checkUrl}
                onUrlChange={setCheckUrl}
                disabled={!writable}
                attached={technical}
                onResult={(check) => {
                  setTechnical(check);
                  suggest('http_check', ...(check.redirects.length ? (['redirect_check'] as const) : []), ...(check.ok ? (['technical_health'] as const) : []));
                  setDraft((d) => ({ ...d, domain: d.domain || check.url }));
                }}
                onCharge={(usage) => recordCharge(store, usage)}
              />
            </>
          )}
        </div>

        <Card className="self-start">
          <CardHeader title="2. Record the outcome" description="Saved with your name and time. Corrections keep an audit trail." as="h3" />
          <CardBody>
            {!writable ? (
              <p className="text-sm text-subtle">Your role can view verifications but not record them.</p>
            ) : (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = validate();
                  if (form) record.run(form);
                }}
                className="space-y-5"
              >
                <VerificationFields draft={draft} setDraft={setDraft} errors={errors} idPrefix="new-verification" />
                {technical && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
                    <span>
                      Attaching website check of <strong className="break-all">{technical.finalUrl ?? technical.url}</strong>
                    </span>
                    <button type="button" className="text-subtle underline" onClick={() => setTechnical(null)}>
                      Remove
                    </button>
                  </div>
                )}
                <Button type="submit" variant="primary" loading={record.pending}>
                  Record verification
                </Button>
              </form>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Verification history"
          description="Newest first. The record marked Current sets the website status: the newest one made or confirmed by a person, or an agent result that needed no review. Rejected results never count."
        />
        {sorted.length === 0 ? (
          <EmptyState icon={History} title="No verifications yet" description="Website status stays “Not yet verified” until one is recorded." />
        ) : (
          <ol className="divide-y divide-border">
            {sorted.map((v) => (
              <VerificationEntry key={v.id} v={v} business={business} latest={v.id === current?.id} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function VerificationEntry({ v, business, latest }: { v: WebsiteVerification; business: Business; latest: boolean }) {
  const { can } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const audit = useAuditEvents(showAudit ? v.id : null);
  const { draft, setDraft, errors, validate } = useVerificationDraft(verificationToDraft(v));
  const correct = useAction((ctx, form: Parameters<typeof svc.editVerification>[3]) => svc.editVerification(ctx, business, v, form), {
    success: 'Correction saved',
    onSuccess: () => setEditing(false),
  });

  const agent = v.actorType === 'agent';
  return (
    <li className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {v.classification ? <ClassificationBadge classification={v.classification} /> : <WebsiteStatusBadge status={v.status} />}
        {v.confidenceScore != null && <EvidenceConfidenceBadge score={v.confidenceScore} />}
        <ReviewStatusBadge v={v} />
        {latest && <Badge tone="accent">Current</Badge>}
        <span className="text-xs text-subtle">
          {formatDateTime(v.checkedAt)} · {agent ? `Agent: ${v.reviewerName ?? 'Website Verification'}` : (v.reviewerName ?? 'Unknown reviewer')}
          {v.confidenceScore == null ? ` · ${v.confidence} confidence` : ''}
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShowAudit((s) => !s)} aria-expanded={showAudit}>
            <History /> Audit
          </Button>
          {agent ? (
            <AgentReview business={business} v={v} />
          ) : (
            can('verification.write') && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil /> Correct
              </Button>
            )
          )}
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm">{v.evidenceSummary}</p>
      {agent && v.reviewStatus !== 'pending' && v.reviewStatus !== 'not_required' && (
        <p className="text-xs text-subtle">
          {v.reviewStatus === 'confirmed' ? 'Confirmed' : 'Rejected'}
          {v.reviewedAt ? ` ${formatDateTime(v.reviewedAt)}` : ''}
          {v.reviewNote ? `: ${v.reviewNote}` : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
        {v.domain && (
          <span>
            Website: <ExternalLinkText href={/^https?:/.test(v.domain) ? v.domain : `https://${v.domain}`}>{v.domain}</ExternalLinkText>
          </span>
        )}
        {v.sourceUrl && (
          <span>
            Evidence: <ExternalLinkText href={v.sourceUrl} />
          </span>
        )}
        {v.nextCheckAt && <span>Re-check {v.nextCheckAt}</span>}
      </div>
      <ul className="flex flex-wrap gap-1">
        {v.methods.map((m) => (
          <li key={m}>
            <Badge>{VERIFICATION_METHOD_LABELS[m]}</Badge>
          </li>
        ))}
      </ul>
      {v.technical && <TechnicalSummary check={v.technical} />}
      {agent && <EvidenceDetails v={v} />}
      {showAudit && (
        <div className="rounded-md border border-border bg-surface-muted p-3 text-xs">
          {audit.isLoading ? (
            <p className="text-subtle">Loading audit trail…</p>
          ) : !audit.data?.length ? (
            <p className="text-subtle">No audit events recorded.</p>
          ) : (
            <ul className="space-y-2">
              {audit.data.map((e) => (
                <li key={e.id}>
                  <span className="font-medium capitalize">{e.action}</span> · {formatDateTime(e.createdAt)}
                  {e.changes && (
                    <ul className="mt-1 space-y-0.5 pl-3 text-subtle">
                      {Object.entries(e.changes).map(([field, c]) => (
                        <li key={field} className="break-words">
                          {field}: <span className="line-through">{JSON.stringify(c.old)}</span> → {JSON.stringify(c.new)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        size="lg"
        title="Correct verification"
        description={`Originally recorded ${formatDateTime(v.checkedAt)}. The previous values stay in the audit trail.`}
        footer={
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={correct.pending}
              onClick={() => {
                const form = validate();
                if (form) correct.run(form);
              }}
            >
              Save correction
            </Button>
          </>
        }
      >
        <VerificationFields draft={draft} setDraft={setDraft} errors={errors} idPrefix={`edit-${v.id}`} />
      </Dialog>
    </li>
  );
}

export function TechnicalSummary({ check }: { check: TechnicalCheck }) {
  const rows: [string, React.ReactNode][] = [
    ['Result', check.ok ? <span className="text-success">Responded (HTTP {check.status})</span> : <span className="text-danger">{check.error ?? `HTTP ${check.status}`}</span>],
    ['Final address', check.finalUrl ? <span className="break-all">{check.finalUrl}</span> : '—'],
    ['HTTPS', check.https ? 'Yes' : 'No'],
    ['Response time', check.responseMs != null ? `${check.responseMs} ms` : '—'],
    ['Page title', check.title ?? '—'],
    ['Mobile viewport tag', check.hasViewport == null ? '—' : check.hasViewport ? 'Present' : 'Missing'],
    ['Generator', check.generator ?? '—'],
    ['Redirects', check.redirects.length ? check.redirects.map((r) => `${r.status} ${r.url}`).join(' → ') : 'None'],
  ];
  return (
    <details className="rounded-md border border-border text-xs">
      <summary className="cursor-pointer px-3 py-2 font-medium">Website check · {formatDateTime(check.checkedAt)}</summary>
      <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-border px-3 py-2">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-subtle">{k}</dt>
            <dd className="min-w-0 break-words">{val}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function WebsiteCheckCard({
  url,
  onUrlChange,
  disabled,
  attached,
  onResult,
  onCharge,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  disabled: boolean;
  attached: TechnicalCheck | null;
  onResult: (check: TechnicalCheck) => void;
  onCharge: (usage: UsageInsert | null) => void;
}) {
  const [result, setResult] = useState<TechnicalCheck | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return setError('Enter a website address.');
    setPending(true);
    setError(null);
    try {
      const res = await api.post<{ check: TechnicalCheck; usage: UsageInsert | null }>('/api/verify/website', { url: url.trim() });
      onCharge(res.usage);
      setResult(res.check);
      onResult(res.check);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Check a website" description="One request to the homepage: status, redirects, HTTPS, title and mobile viewport. No crawling." as="h3" />
      <CardBody className="space-y-3">
        <form onSubmit={run} className="flex gap-2">
          <Input aria-label="Website address to check" value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="example.com.gh" disabled={disabled} />
          <Button type="submit" loading={pending} disabled={disabled}>
            <Globe /> Check
          </Button>
        </form>
        {error && <p className="text-xs text-danger">{error}</p>}
        {result && <TechnicalSummary check={result} />}
        {result && attached === result && <p className="text-xs text-subtle">Attached to the verification form. A responding site is not proof of ownership — confirm it belongs to this business.</p>}
      </CardBody>
    </Card>
  );
}

function DomainProbeCard({ business, disabled, onUse, onProbed }: { business: Business; disabled: boolean; onUse: (domain: string) => void; onProbed: () => void }) {
  const { store } = useWorkspace();
  const [results, setResults] = useState<DomainProbe[] | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    try {
      const res = await api.post<{ results: DomainProbe[]; usage: UsageInsert | null }>('/api/verify/domains', { name: business.name, extra: [] });
      await recordCharge(store, res.usage);
      setResults(res.results);
      onProbed();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Probe likely domains"
        description="DNS lookups for names derived from the business name. A resolving domain may belong to someone else."
        as="h3"
        actions={
          <Button size="sm" onClick={run} loading={pending} disabled={disabled}>
            <Wrench /> Probe
          </Button>
        }
      />
      {results && (
        <ul className="divide-y divide-border text-sm">
          {results.map((r) => (
            <li key={r.domain} className="flex items-center gap-3 px-4 py-2">
              <span className={r.resolves ? 'font-medium' : 'text-subtle'}>{r.domain}</span>
              <span className="flex-1 text-xs text-subtle">{r.note}</span>
              {r.resolves && (
                <Button size="sm" variant="ghost" onClick={() => onUse(r.domain)}>
                  Use
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WebSearchCard({
  business,
  configured,
  disabled,
  onCheck,
  onSource,
  onSearched,
}: {
  business: Business;
  configured: boolean;
  disabled: boolean;
  onCheck: (url: string) => void;
  onSource: (url: string) => void;
  onSearched: () => void;
}) {
  const { store } = useWorkspace();
  const [query, setQuery] = useState(`"${business.name}" ${business.city}`);
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <Notice tone="neutral" title="Web search API not configured">
        Set BRAVE_SEARCH_API_KEY on the server to search from here. The manual links above work without it.
      </Notice>
    );
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await api.post<{ results: SearchHit[]; usage: UsageInsert | null }>('/api/verify/search', { query });
      await recordCharge(store, res.usage);
      setResults(res.results);
      onSearched();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Web search" description="Results are shown for this session only and are not stored." as="h3" />
      <CardBody className="space-y-3">
        <form onSubmit={run} className="flex gap-2">
          <Input aria-label="Search query" value={query} onChange={(e) => setQuery(e.target.value)} disabled={disabled} />
          <Button type="submit" loading={pending} disabled={disabled}>
            <Search /> Search
          </Button>
        </form>
        {error && <p className="text-xs text-danger">{error}</p>}
        {results && !results.length && <p className="text-xs text-subtle">No results. That alone does not show the business lacks a website.</p>}
        {results && results.length > 0 && (
          <ul className="space-y-3">
            {results.map((r) => (
              <li key={r.url} className="text-sm">
                <ExternalLinkText href={r.url}>{r.title || r.url}</ExternalLinkText>
                <p className="line-clamp-2 text-xs text-subtle">{r.description}</p>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onCheck(r.url)}>
                    Use as website
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onSource(r.url)}>
                    Use as evidence link
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
