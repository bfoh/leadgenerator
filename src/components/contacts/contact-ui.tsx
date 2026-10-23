'use client';

// Contact intelligence UI shared by the prospect Contacts tab and the Contacts page. Every view keeps
// "we found this detail" apart from "we may message it": status badges combine source, validation,
// consent and suppression, and outreach eligibility is shown separately with its reasons.

import { Ban, CheckCircle2, ChevronDown, Clock, ExternalLink, FileText, Globe, Mail, MessageCircle, MoreHorizontal, Pencil, Phone, Send, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import * as contacts from '@/lib/data/contact-services';
import {
  CAPTURE_METHODS,
  CAPTURE_METHOD_LABELS,
  CLASSIFICATION_LABELS,
  CONSENT_CHANNELS,
  CONSENT_CHANNEL_LABELS,
  CONSENT_PURPOSES,
  CONSENT_PURPOSE_LABELS,
  CONTACT_PURPOSES,
  CONTACT_PURPOSE_LABELS,
  CONTACT_SCOPES,
  CONTACT_SCOPE_LABELS,
  CONTACT_SOURCES,
  CONTACT_SOURCE_TYPES,
  CONTACT_STATUS_META,
  CONTACT_TYPES,
  CONTACT_TYPE_LABELS,
  PHONE_KIND_LABELS,
  RESTRICTED_CONTACT_SOURCES,
  SUPPRESSION_REASONS,
  SUPPRESSION_REASON_LABELS,
  SUPPRESSION_SOURCE_LABELS,
  WRITTEN_CAPTURE,
  channelEligibility,
  channelOf,
  consentFor,
  consentFormSchema,
  contactFormSchema,
  contactStatus,
  dataRights,
  retentionDue,
  suppressionFor,
  suppressionFormSchema,
  type CaptureMethod,
  type ConsentChannel,
  type ConsentPurpose,
  type ConsentRecord,
  type ContactPoint,
  type ContactPurpose,
  type ContactScope,
  type ContactSourceType,
  type ContactStatus,
  type ContactType,
  type DataRights,
  type Suppression,
  type SuppressionReason,
} from '@/lib/domain/contacts';
import { LAWFUL_BASES, LAWFUL_BASIS_LABELS, type LawfulBasis, type Tone } from '@/lib/domain/constants';
import { fieldErrors } from '@/lib/domain/schemas';
import type { Business } from '@/lib/domain/types';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { useAction, useMessagingSchema } from '@/lib/workspace/hooks';
import { useWorkspace } from '@/lib/workspace/workspace-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { Notice } from '@/components/ui/misc';
import { DraftMessageDialog } from '@/components/outreach/message-ui';

export interface ContactState {
  points: ContactPoint[];
  consents: ConsentRecord[];
  suppressions: Suppression[];
}

const TYPE_ICONS: Record<ContactType, React.ComponentType<{ className?: string }>> = { email: Mail, phone: Phone, whatsapp: MessageCircle, contact_page: Globe, contact_form: FileText };
const RIGHTS_META: Record<DataRights, { label: string; tone: Tone; description: string }> = {
  permitted: { label: 'Data rights: permitted', tone: 'success', description: 'The source allows keeping this detail for the recorded purpose. This is not consent to message it.' },
  restricted: { label: 'Data rights: restricted', tone: 'danger', description: 'The source’s terms limit how this detail may be used.' },
  unknown: { label: 'Data rights: unknown', tone: 'warning', description: 'Where this came from, or whose detail it is, still needs a person to confirm.' },
};

const RIGHTS_SHORT: Record<DataRights, string> = { permitted: 'Permitted', restricted: 'Restricted', unknown: 'Unknown' };

const today = () => new Date().toISOString().slice(0, 10);
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  const meta = CONTACT_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
    </Badge>
  );
}

export function DataRightsBadge({ rights }: { rights: DataRights }) {
  const meta = RIGHTS_META[rights];
  return (
    <Badge tone={meta.tone} title={meta.description}>
      {meta.label}
    </Badge>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

function SummaryItem({ label, value, tone, children }: { label: string; value: string; tone: Tone; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="mt-1">
        <Badge tone={tone} dot>
          {value}
        </Badge>
        {children}
      </dd>
    </div>
  );
}

/** The brief's contact display: availability, source, rights, outreach eligibility and last validation. */
export function ContactSummary({ business, state }: { business: Business; state: ContactState }) {
  const now = new Date();
  const usable = (types: ContactType[]) => state.points.some((p) => types.includes(p.type) && p.classification !== 'invalid' && p.classification !== 'outdated');
  const email = channelEligibility(business, state.points, 'email', { ...state, now });
  const whatsapp = consentFor(business.id, 'whatsapp', null, state.consents, now);
  const verified = state.points.some((p) => p.classification === 'verified_business_channel' || p.classification === 'source_confirmed');
  const rightsPoint = email.point ?? state.points.find((p) => channelOf(p.type)) ?? null;
  const rights = rightsPoint ? dataRights(rightsPoint) : null;
  const lastValidated = state.points.reduce<string | null>((m, p) => (p.validatedAt && (!m || p.validatedAt > m) ? p.validatedAt : m), null);
  const optedOut = business.contactPermission === 'opted_out';

  return (
    <Card data-testid="contact-summary">
      <CardHeader title="Contact summary" description="Finding a contact detail is not permission to message it. Outreach needs recorded consent for the channel." />
      <dl className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryItem label="Email" value={usable(['email']) ? 'Available' : 'Unavailable'} tone={usable(['email']) ? 'info' : 'neutral'} />
        <SummaryItem label="Phone" value={usable(['phone', 'whatsapp']) ? 'Available' : 'Unavailable'} tone={usable(['phone', 'whatsapp']) ? 'info' : 'neutral'} />
        <SummaryItem label="Source" value={!state.points.length ? 'None recorded' : verified ? 'Verified' : 'Needs review'} tone={!state.points.length ? 'neutral' : verified ? 'success' : 'warning'} />
        <SummaryItem label="Data rights" value={rights ? RIGHTS_SHORT[rights] : 'Unknown'} tone={rights ? RIGHTS_META[rights].tone : 'neutral'} />
        <SummaryItem label="Email outreach" value={email.eligible ? 'Eligible' : 'Blocked'} tone={email.eligible ? 'success' : 'danger'}>
          {!email.eligible && (
            <details className="mt-1 text-xs text-subtle">
              <summary className="cursor-pointer">Why</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {email.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </SummaryItem>
        <SummaryItem
          label="WhatsApp outreach"
          value={optedOut || whatsapp.state === 'withdrawn' ? 'Opted out' : whatsapp.state === 'granted' ? 'Opted in' : 'Not opted in'}
          tone={optedOut || whatsapp.state === 'withdrawn' ? 'danger' : whatsapp.state === 'granted' ? 'success' : 'neutral'}
        />
        <SummaryItem label="Last validation" value={lastValidated ? formatDate(lastValidated) : 'Never'} tone="neutral" />
        <SummaryItem label="Sending to businesses" value="Not available in this version" tone="neutral" />
      </dl>
    </Card>
  );
}

// ── Contact list ─────────────────────────────────────────────────────────────

function sourceLine(p: ContactPoint) {
  const who = p.agentVersion ? `found by ${p.agentVersion}` : 'recorded by a team member';
  return `${CONTACT_SOURCES[p.sourceType].label} · ${who} on ${formatDate(p.acquiredAt)}`;
}

type RowAction = { kind: 'review' | 'consent' | 'withdraw' | 'retention' | 'delete' | 'message'; point: ContactPoint };

function ContactRow({ point, business, state, showBusiness, messaging, onAction }: { point: ContactPoint; business: Pick<Business, 'id' | 'name' | 'contactPermission'>; state: ContactState; showBusiness?: boolean; messaging?: boolean; onAction: (a: RowAction) => void }) {
  const { can } = useWorkspace();
  const now = new Date();
  const status = contactStatus(point, { business, ...state, now });
  const Icon = TYPE_ICONS[point.type];
  const channel = channelOf(point.type);
  const due = retentionDue(point, today());
  const href = point.type === 'contact_page' || point.type === 'contact_form' ? point.normalizedValue : null;
  // Drafting is open to any email or WhatsApp point: the gateway, not the menu, decides whether it can be sent.
  const canMessage = Boolean(messaging) && (point.type === 'email' || point.type === 'whatsapp') && can('outreach.write');

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="contact-point">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-medium hover:underline">
                {point.value}
              </a>
            ) : (
              <span className="break-all font-medium">{point.normalizedValue}</span>
            )}
            <span className="text-xs text-subtle">
              {CONTACT_TYPE_LABELS[point.type]}
              {point.phoneKind ? ` · ${PHONE_KIND_LABELS[point.phoneKind]}` : ''}
              {point.label ? ` · ${point.label}` : ''}
            </span>
          </p>
          {showBusiness && (
            <p className="text-xs">
              <Link href={`/prospects/${business.id}?tab=contacts`} className="text-muted underline-offset-2 hover:underline">
                {business.name}
              </Link>
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <ContactStatusBadge status={status} />
            <DataRightsBadge rights={dataRights(point)} />
            {point.scope !== 'business' && <Badge tone={point.scope === 'person' ? 'info' : 'warning'}>{point.scope === 'person' ? `${point.personName}, ${point.personRole}` : CONTACT_SCOPE_LABELS.unknown}</Badge>}
            {due && <Badge tone="warning">Past retention date</Badge>}
          </div>
          <p className="text-xs text-subtle">
            {sourceLine(point)}
            {point.sourceUrl && (
              <>
                {' · '}
                <a href={point.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">
                  source page <ExternalLink className="size-3" aria-hidden />
                </a>
              </>
            )}
            {point.sourceNote ? ` · ${point.sourceNote}` : ''}
          </p>
          <p className="text-xs text-subtle">
            {point.validatedAt ? `Validated ${formatDate(point.validatedAt)} (${CLASSIFICATION_LABELS[point.classification].toLowerCase()})` : 'Not validated yet'} · Keep until {formatDate(point.retentionUntil)}
            {point.reviewNote ? ` · ${point.reviewNote}` : ''}
          </p>
          {point.validation && (
            <details className="text-xs">
              <summary className="inline-flex cursor-pointer items-center gap-1 text-subtle">
                Checks <ChevronDown className="size-3" aria-hidden />
              </summary>
              <ul className="mt-1 space-y-0.5">
                {point.validation.checks.map((c, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className={cn('font-medium', c.status === 'pass' ? 'text-success' : c.status === 'fail' ? 'text-danger' : c.status === 'warn' ? 'text-warning' : 'text-subtle')}>{c.status}</span>
                    <span className="text-muted">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      {(can('contacts.write') || can('consent.record') || can('contacts.delete') || canMessage) && (
        // Non-modal: the menu opens dialogs, and a modal menu closing under a new dialog can leave
        // the page unclickable.
        <Menu modal={false}>
          <MenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${point.hint}`} className="self-end sm:self-start">
              <MoreHorizontal aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {canMessage && (
              <MenuItem onSelect={() => onAction({ kind: 'message', point })}>
                <Send aria-hidden /> Draft a message…
              </MenuItem>
            )}
            {can('contacts.write') && (
              <MenuItem onSelect={() => onAction({ kind: 'review', point })}>
                <Pencil aria-hidden /> Review details
              </MenuItem>
            )}
            {channel && can('consent.record') && business.contactPermission !== 'opted_out' && (
              <MenuItem onSelect={() => onAction({ kind: 'consent', point })}>
                <ShieldCheck aria-hidden /> Record consent…
              </MenuItem>
            )}
            {channel && can('consent.record') && (
              <MenuItem onSelect={() => onAction({ kind: 'withdraw', point })}>
                <ShieldOff aria-hidden /> Record opt-out…
              </MenuItem>
            )}
            {can('contacts.write') && (
              <MenuItem onSelect={() => onAction({ kind: 'retention', point })}>
                <Clock aria-hidden /> Keep longer…
              </MenuItem>
            )}
            {can('contacts.delete') && (
              <>
                <MenuSeparator />
                <MenuItem danger onSelect={() => onAction({ kind: 'delete', point })}>
                  <Trash2 aria-hidden /> Delete
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      )}
    </li>
  );
}

/** Contact points with their status, source and actions; the dialogs they open live here too. */
export function ContactList({ points, businesses, state, showBusiness, empty }: { points: ContactPoint[]; businesses: Business[]; state: ContactState; showBusiness?: boolean; empty: React.ReactNode }) {
  const [action, setAction] = useState<RowAction | null>(null);
  const { data: messaging } = useMessagingSchema();
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);
  const close = () => setAction(null);
  const target = action ? byId.get(action.point.businessId) : null;
  if (!points.length) return <>{empty}</>;
  return (
    <>
      <ul className="divide-y divide-border">
        {points.map((p) => {
          const b = byId.get(p.businessId);
          return b ? <ContactRow key={p.id} point={p} business={b} state={state} showBusiness={showBusiness} messaging={messaging === true} onAction={setAction} /> : null;
        })}
      </ul>
      {action?.kind === 'review' && <ReviewDialog point={action.point} onClose={close} />}
      {(action?.kind === 'consent' || action?.kind === 'withdraw') && target && (
        <ConsentDialog business={target} points={state.points.filter((p) => p.businessId === target.id)} initial={{ channel: channelOf(action.point.type)!, contactPointId: action.point.id, status: action.kind === 'consent' ? 'granted' : 'withdrawn' }} onClose={close} />
      )}
      {action?.kind === 'retention' && <RetentionDialog point={action.point} onClose={close} />}
      {action?.kind === 'delete' && <DeleteContactsDialog points={[action.point]} onClose={close} />}
      {action?.kind === 'message' && target && <DraftMessageDialog business={target} point={action.point} onClose={close} />}
    </>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

const MANUAL_SOURCES = CONTACT_SOURCE_TYPES.filter((s) => CONTACT_SOURCES[s].manual);

export function AddContactDialog({ business, onClose }: { business: Business; onClose: () => void }) {
  const [type, setType] = useState<ContactType>('email');
  const [value, setValue] = useState('');
  const [sourceType, setSourceType] = useState<ContactSourceType>('business_website');
  const [sourceUrl, setSourceUrl] = useState(business.officialWebsite ?? '');
  const [sourceNote, setSourceNote] = useState('');
  const [scope, setScope] = useState<ContactScope>('business');
  const [label, setLabel] = useState('');
  const [personName, setPersonName] = useState('');
  const [personRole, setPersonRole] = useState('');
  const [purpose, setPurpose] = useState<ContactPurpose>('research');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useAction(contacts.addContact, { success: 'Contact detail recorded with its source', onSuccess: onClose });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = contactFormSchema.safeParse({ type, value, sourceType, sourceUrl, sourceNote, scope, label, personName, personRole, purpose });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    await add.run(business, parsed.data);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add a contact detail"
      description="Record where it came from. Adding a detail does not make it eligible for outreach."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-contact" loading={add.pending}>
            Save contact detail
          </Button>
        </>
      }
    >
      <form id="add-contact" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" required>
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as ContactType)}>
              {CONTACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONTACT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={type === 'contact_page' || type === 'contact_form' ? 'Page address' : 'Value'} required error={errors.value} hint={type === 'whatsapp' ? 'Only a number the business itself gives as its WhatsApp channel.' : undefined}>
          {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} maxLength={320} inputMode={type === 'phone' || type === 'whatsapp' ? 'tel' : type === 'email' ? 'email' : 'url'} />}
        </Field>
        <Field label="Source" required error={errors.sourceType} hint={CONTACT_SOURCES[sourceType].description} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={sourceType} onChange={(e) => setSourceType(e.target.value as ContactSourceType)}>
              {MANUAL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_SOURCES[s].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Source page" required={CONTACT_SOURCES[sourceType].requires === 'source_url'} error={errors.sourceUrl} hint="The page where the business published it.">
          {(p) => <Input {...p} type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} maxLength={500} placeholder="https://" />}
        </Field>
        <Field label="Source note" error={errors.sourceNote} hint="e.g. “Owner’s business card, trade fair 12 Oct”.">
          {(p) => <Input {...p} value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} maxLength={500} />}
        </Field>
        <Field label="Whose detail is it?" required>
          {(p) => (
            <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as ContactScope)}>
              {CONTACT_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Label" hint="Optional, e.g. “Orders”.">
          {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />}
        </Field>
        {scope === 'person' && (
          <>
            <Field label="Person’s name" required error={errors.personName}>
              {(p) => <Input {...p} value={personName} onChange={(e) => setPersonName(e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Role at the business" required error={errors.personRole}>
              {(p) => <Input {...p} value={personRole} onChange={(e) => setPersonRole(e.target.value)} maxLength={120} />}
            </Field>
          </>
        )}
        <Field label="Why we keep it" required error={errors.purpose} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as ContactPurpose)}>
              {CONTACT_PURPOSES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_PURPOSE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Notice tone="neutral" icon={Ban} title="Not accepted as sources" className="sm:col-span-2">
          <ul className="list-disc space-y-0.5 pl-4">
            {Object.values(RESTRICTED_CONTACT_SOURCES).map((m) => (
              <li key={m}>{m}</li>
            ))}
            <li>Private home addresses, personal mobile numbers and private email accounts are never collected. Never guess an address.</li>
          </ul>
        </Notice>
      </form>
    </Dialog>
  );
}

export function ConsentDialog({
  business,
  points,
  initial,
  onClose,
}: {
  business: Business;
  points: ContactPoint[];
  initial: { channel: ConsentChannel; contactPointId: string | null; status: 'granted' | 'withdrawn' };
  onClose: () => void;
}) {
  const [channel, setChannel] = useState<ConsentChannel>(initial.channel);
  const [contactPointId, setContactPointId] = useState<string>(initial.contactPointId ?? '');
  const [status, setStatus] = useState(initial.status);
  const [lawfulBasis, setLawfulBasis] = useState<LawfulBasis | ''>('consent');
  const [purpose, setPurpose] = useState<ConsentPurpose>('direct_marketing');
  const [capturedVia, setCapturedVia] = useState<CaptureMethod>('email');
  const [capturedAt, setCapturedAt] = useState(localNow());
  const [wording, setWording] = useState('');
  const [evidence, setEvidence] = useState('');
  const [scope, setScope] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [optOutAll, setOptOutAll] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction(contacts.recordConsent, { success: status === 'granted' ? 'Consent recorded' : 'Opt-out recorded; the contact is suppressed', onSuccess: onClose });
  const onChannel = points.filter((p) => channelOf(p.type) === channel);
  const written = WRITTEN_CAPTURE.includes(capturedVia);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = consentFormSchema.safeParse({
      channel,
      contactPointId: contactPointId || null,
      status,
      lawfulBasis: status === 'granted' ? lawfulBasis || null : null,
      purpose,
      scope,
      evidence,
      capturedVia,
      capturedAt: capturedAt ? new Date(capturedAt).toISOString() : '',
      wording,
      expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : '',
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    await save.run(business, { ...parsed.data, optOutAll: status === 'withdrawn' && optOutAll });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={status === 'granted' ? 'Record consent' : 'Record an opt-out'}
      description={status === 'granted' ? 'Only consent the business actually gave. Approving a campaign is not consent from the recipient.' : 'Takes effect immediately: the contact goes on the suppression list.'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={status === 'granted' ? 'primary' : 'danger'} type="submit" form="consent-form" loading={save.pending}>
            {status === 'granted' ? 'Record consent' : 'Record opt-out'}
          </Button>
        </>
      }
    >
      <form id="consent-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Channel" required>
          {(p) => (
            <Select
              {...p}
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as ConsentChannel);
                setContactPointId('');
              }}
            >
              {CONSENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CONSENT_CHANNEL_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Contact detail" hint="Or the whole channel for this business.">
          {(p) => (
            <Select {...p} value={contactPointId} onChange={(e) => setContactPointId(e.target.value)}>
              <option value="">Every {CONSENT_CHANNEL_LABELS[channel].toLowerCase()} contact of this business</option>
              {onChannel.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.normalizedValue}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Record" required className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value as 'granted' | 'withdrawn')}>
              <option value="granted">They agreed to be contacted</option>
              <option value="withdrawn">They asked us to stop (opt-out)</option>
            </Select>
          )}
        </Field>
        {status === 'granted' && (
          <Field label="Lawful basis" required error={errors.lawfulBasis}>
            {(p) => (
              <Select {...p} value={lawfulBasis} onChange={(e) => setLawfulBasis(e.target.value as LawfulBasis | '')}>
                <option value="">Select…</option>
                {LAWFUL_BASES.map((b) => (
                  <option key={b} value={b}>
                    {LAWFUL_BASIS_LABELS[b]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Purpose" required className={status === 'granted' ? undefined : 'sm:col-span-2'}>
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}>
              {CONSENT_PURPOSES.map((c) => (
                <option key={c} value={c}>
                  {CONSENT_PURPOSE_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="How it was given" required error={errors.capturedVia} hint={status === 'granted' && purpose === 'direct_marketing' && lawfulBasis === 'consent' && !written ? 'Direct marketing needs prior written consent (Act 843 s.40).' : undefined}>
          {(p) => (
            <Select {...p} value={capturedVia} onChange={(e) => setCapturedVia(e.target.value as CaptureMethod)}>
              {CAPTURE_METHODS.map((c) => (
                <option key={c} value={c}>
                  {CAPTURE_METHOD_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="When" required error={errors.capturedAt}>
          {(p) => <Input {...p} type="datetime-local" value={capturedAt} onChange={(e) => setCapturedAt(e.target.value)} />}
        </Field>
        <Field label="Evidence" required error={errors.evidence} hint="Who, when, and where the proof is kept — e.g. “Reply from info@ on 12 Oct, saved in the shared inbox”." className="sm:col-span-2">
          {(p) => <Textarea {...p} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={2000} />}
        </Field>
        <Field label="Wording they agreed to" required={status === 'granted' && purpose === 'direct_marketing' && lawfulBasis === 'consent'} error={errors.wording} className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={2} value={wording} onChange={(e) => setWording(e.target.value)} maxLength={2000} />}
        </Field>
        {status === 'granted' ? (
          <>
            <Field label="Scope" hint="Optional limits, e.g. “Website proposals only”.">
              {(p) => <Input {...p} value={scope} onChange={(e) => setScope(e.target.value)} maxLength={300} />}
            </Field>
            <Field label="Expires" error={errors.expiresAt} hint="Optional.">
              {(p) => <Input {...p} type="date" min={today()} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />}
            </Field>
          </>
        ) : (
          <Checkbox className="sm:col-span-2" label="They asked not to be contacted at all" description="Opts the business out of every channel and stops all automation for it." checked={optOutAll} onChange={(e) => setOptOutAll(e.target.checked)} />
        )}
      </form>
    </Dialog>
  );
}

function ReviewDialog({ point, onClose }: { point: ContactPoint; onClose: () => void }) {
  const [scope, setScope] = useState<ContactScope>(point.scope);
  const [label, setLabel] = useState(point.label ?? '');
  const [personName, setPersonName] = useState(point.personName ?? '');
  const [personRole, setPersonRole] = useState(point.personRole ?? '');
  const [purpose, setPurpose] = useState<ContactPurpose>(point.purpose);
  const [outdated, setOutdated] = useState(point.classification === 'outdated');
  const [note, setNote] = useState('');
  const save = useAction(contacts.reviewContact, { success: 'Contact detail reviewed', onSuccess: onClose });
  const classification = outdated !== (point.classification === 'outdated') ? (outdated ? ('outdated' as const) : ('unverified' as const)) : undefined;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Review ${point.normalizedValue}`}
      description="Where it came from cannot be changed. If it is wrong, record a corrected detail and delete this one."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={() =>
              void save.run(point, { scope, label: label.trim() || null, personName: personName.trim() || null, personRole: personRole.trim() || null, purpose, ...(classification ? { classification } : {}) }, note)
            }
          >
            Save review
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Whose detail is it?" className="sm:col-span-2" hint="Changing it sends the detail back for validation.">
          {(p) => (
            <Select {...p} value={scope} onChange={(e) => setScope(e.target.value as ContactScope)}>
              {CONTACT_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {scope === 'person' && (
          <>
            <Field label="Person’s name" required>
              {(p) => <Input {...p} value={personName} onChange={(e) => setPersonName(e.target.value)} maxLength={120} />}
            </Field>
            <Field label="Role at the business" required>
              {(p) => <Input {...p} value={personRole} onChange={(e) => setPersonRole(e.target.value)} maxLength={120} />}
            </Field>
          </>
        )}
        <Field label="Label">{(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />}</Field>
        <Field label="Why we keep it">
          {(p) => (
            <Select {...p} value={purpose} onChange={(e) => setPurpose(e.target.value as ContactPurpose)}>
              {CONTACT_PURPOSES.map((s) => (
                <option key={s} value={s}>
                  {CONTACT_PURPOSE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox className="sm:col-span-2" label="Outdated" description="No longer used by the business." checked={outdated} onChange={(e) => setOutdated(e.target.checked)} />
        <Field label="Review note" className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
        </Field>
      </div>
    </Dialog>
  );
}

function RetentionDialog({ point, onClose }: { point: ContactPoint; onClose: () => void }) {
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const save = useAction(contacts.extendRetention, { success: 'Retention extended', onSuccess: onClose });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Keep this detail longer"
      description={`Currently kept until ${formatDate(point.retentionUntil)}. Keep contact details only while there is a reason to.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} onClick={() => void save.run(point, until, reason)}>
            Keep until {until ? formatDate(until) : '…'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Keep until" required>
          {(p) => <Input {...p} type="date" min={today()} value={until} onChange={(e) => setUntil(e.target.value)} className="w-48" />}
        </Field>
        <Field label="Reason" required hint="e.g. “Active enquiry about a booking website”.">
          {(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        </Field>
      </div>
    </Dialog>
  );
}

export function DeleteContactsDialog({ points, onClose, reason: fixedReason }: { points: ContactPoint[]; onClose: () => void; reason?: string }) {
  const [reason, setReason] = useState(fixedReason ?? '');
  const del = useAction(contacts.deleteContacts, { success: (n) => `Deleted ${n} contact detail${n === 1 ? '' : 's'}`, onSuccess: onClose });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={points.length === 1 ? `Delete ${points[0].normalizedValue}?` : `Delete ${points.length} contact details?`}
      description="This cannot be undone. Consent history and suppression entries are kept (without the value), so opt-outs keep working."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={del.pending} disabled={reason.trim().length < 3} onClick={() => void del.run(points, reason.trim())}>
            Delete
          </Button>
        </>
      }
    >
      <Field label="Reason" required hint="Recorded in the activity log.">
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. wrong number, retention period ended" />}
      </Field>
    </Dialog>
  );
}

// ── Consent history ──────────────────────────────────────────────────────────

export function ConsentHistory({ consents }: { consents: ConsentRecord[] }) {
  const now = new Date().toISOString();
  if (!consents.length) return <p className="px-4 py-3 text-sm text-subtle">No consent recorded. Without it, no channel is eligible for outreach.</p>;
  return (
    <ol className="divide-y divide-border">
      {consents.map((c) => {
        const expired = c.status === 'granted' && c.expiresAt && c.expiresAt <= now;
        return (
          <li key={c.id} className="space-y-1 px-4 py-3 text-sm" data-testid="consent-record">
            <p className="flex flex-wrap items-center gap-2">
              <Badge tone={c.status === 'withdrawn' ? 'danger' : expired ? 'neutral' : 'success'} dot>
                {c.status === 'withdrawn' ? 'Withdrawn' : expired ? 'Expired' : 'Granted'}
              </Badge>
              <span className="font-medium">{CONSENT_CHANNEL_LABELS[c.channel]}</span>
              <span className="text-xs text-subtle">{c.contactHint ?? 'every contact on the channel'}</span>
            </p>
            <p className="text-xs text-muted">
              {CONSENT_PURPOSE_LABELS[c.purpose]}
              {c.lawfulBasis ? ` · ${LAWFUL_BASIS_LABELS[c.lawfulBasis]}` : ''} · {CAPTURE_METHOD_LABELS[c.capturedVia]} on {formatDateTime(c.capturedAt)}
              {c.expiresAt ? ` · expires ${formatDate(c.expiresAt)}` : ''}
            </p>
            <p className="text-xs">{c.evidence}</p>
            {c.wording && <p className="text-xs italic text-muted">“{c.wording}”</p>}
            <p className="text-xs text-subtle">
              Recorded by {c.recordedByName} on {formatDateTime(c.createdAt)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ── Suppression ──────────────────────────────────────────────────────────────

export function AddSuppressionDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<'email' | 'phone' | 'email_domain'>('email');
  const [value, setValue] = useState('');
  const [channel, setChannel] = useState<ConsentChannel | ''>('');
  const [reason, setReason] = useState<SuppressionReason>('opted_out');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useAction(contacts.addSuppression, { success: 'Added to the suppression list', onSuccess: onClose });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = suppressionFormSchema.safeParse({ kind, value, channel: channel || null, reason, note });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    await add.run(parsed.data);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add to the suppression list"
      description="Blocks the value across the whole workspace, for every prospect. Only a one-way hash and a masked hint are kept."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="suppression-form" loading={add.pending}>
            Suppress
          </Button>
        </>
      }
    >
      <form id="suppression-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="What" required>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="email">Email address</option>
              <option value="phone">Phone number (also WhatsApp)</option>
              <option value="email_domain">Email domain</option>
            </Select>
          )}
        </Field>
        <Field label="Value" required error={errors.value}>
          {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} maxLength={320} placeholder={kind === 'email_domain' ? 'example.com' : undefined} />}
        </Field>
        <Field label="Channel">
          {(p) => (
            <Select {...p} value={channel} onChange={(e) => setChannel(e.target.value as ConsentChannel | '')}>
              <option value="">Every channel</option>
              {CONSENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CONSENT_CHANNEL_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" required>
          {(p) => (
            <Select {...p} value={reason} onChange={(e) => setReason(e.target.value as SuppressionReason)}>
              {SUPPRESSION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {SUPPRESSION_REASON_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Note" className="sm:col-span-2" hint="Optional. Do not paste the person’s message.">
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
        </Field>
      </form>
    </Dialog>
  );
}

/** Granted, current consent records made after the entry that cover what it suppresses. */
export function liftCandidates(s: Suppression, state: ContactState) {
  const now = new Date().toISOString();
  return state.consents.filter((c) => {
    if (c.status !== 'granted' || c.createdAt <= s.createdAt || (c.expiresAt && c.expiresAt <= now)) return false;
    if (s.channel && c.channel !== s.channel) return false;
    if (s.kind === 'business') return c.businessId === s.businessId;
    return state.points.some(
      (p) => p.businessId === c.businessId && (!c.contactPointId || c.contactPointId === p.id) && (s.kind === 'email_domain' ? p.domainHash === s.valueHash : p.valueHash === s.valueHash),
    );
  });
}

export function LiftSuppressionDialog({ suppression, state, onClose }: { suppression: Suppression; state: ContactState; onClose: () => void }) {
  const candidates = liftCandidates(suppression, state);
  const [consentId, setConsentId] = useState(candidates[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const lift = useAction(contacts.liftSuppression, { success: 'Suppression lifted', onSuccess: onClose });
  const consent = candidates.find((c) => c.id === consentId);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Lift suppression of ${suppression.hint}?`}
      description="Only when the business has asked, in a way you recorded, to hear from you again. The entry stays in the list as lifted."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={lift.pending} disabled={!consent} onClick={() => consent && void lift.run(suppression, consent, reason)}>
            Lift suppression
          </Button>
        </>
      }
    >
      {candidates.length === 0 ? (
        <Notice tone="warning" title="No consent record allows this">
          Lifting needs a current consent record, made after this entry, that covers the suppressed contact and channel. Record it on the prospect’s Contacts tab first.
        </Notice>
      ) : (
        <div className="grid gap-4">
          <Field label="Consent record" required>
            {(p) => (
              <Select {...p} value={consentId} onChange={(e) => setConsentId(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {CONSENT_CHANNEL_LABELS[c.channel]} · {CAPTURE_METHOD_LABELS[c.capturedVia]} · {formatDateTime(c.capturedAt)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reason" required hint="At least 10 characters.">
            {(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}
          </Field>
        </div>
      )}
    </Dialog>
  );
}

export function SuppressionList({ state, businesses }: { state: ContactState; businesses: Business[] }) {
  const { can } = useWorkspace();
  const [lifting, setLifting] = useState<Suppression | null>(null);
  const names = new Map(businesses.map((b) => [b.id, b.name]));
  if (!state.suppressions.length) return <p className="px-4 py-6 text-center text-sm text-subtle">Nobody is on the suppression list.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {state.suppressions.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between" data-testid="suppression">
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={s.liftedAt ? 'neutral' : 'danger'} dot>
                  {s.liftedAt ? 'Lifted' : 'Active'}
                </Badge>
                <span className="font-medium">{s.kind === 'business' ? (s.businessId ? (names.get(s.businessId) ?? s.hint) : s.hint) : s.hint}</span>
                <span className="text-xs text-subtle">
                  {s.kind === 'business' ? 'Whole business' : s.kind === 'email_domain' ? 'Email domain' : s.kind === 'email' ? 'Email address' : 'Phone number'}
                  {s.channel ? ` · ${CONSENT_CHANNEL_LABELS[s.channel]} only` : ' · every channel'}
                </span>
              </p>
              <p className="text-xs text-muted">
                {SUPPRESSION_REASON_LABELS[s.reason]} · {SUPPRESSION_SOURCE_LABELS[s.source]} on{' '}
                {formatDateTime(s.createdAt)}
                {s.note ? ` · ${s.note}` : ''}
              </p>
              {s.liftedAt && (
                <p className="text-xs text-subtle">
                  Lifted {formatDateTime(s.liftedAt)}: {s.liftReason}
                </p>
              )}
            </div>
            {!s.liftedAt && can('suppression.lift') && (
              <Button size="sm" onClick={() => setLifting(s)} className="self-end sm:self-start">
                <CheckCircle2 aria-hidden /> Lift…
              </Button>
            )}
          </li>
        ))}
      </ul>
      {lifting && <LiftSuppressionDialog suppression={lifting} state={state} onClose={() => setLifting(null)} />}
    </>
  );
}

/** Whether this business is blocked by a business-level suppression (shown on the Contacts tab). */
export function businessSuppressed(business: Business, suppressions: Suppression[]) {
  return suppressionFor({ businessId: business.id, type: 'contact_page', valueHash: null, domainHash: null }, suppressions);
}
