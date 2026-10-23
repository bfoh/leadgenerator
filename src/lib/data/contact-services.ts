// Phase 4 contact operations: contact points with provenance, validation results, retention,
// consent records and the suppression list. Both modes go through here so demo and cloud apply the
// same rules. Activity entries carry masked hints, never the contact values themselves.

import { CONSENT_CHANNEL_LABELS, CONTACT_TYPE_LABELS, SUPPRESSION_KIND_LABELS, assertStorable, channelOf, consentFormSchema, contactFormSchema, contactHashes, defaultRetentionUntil, inferScope, maskContact, normalizeContact, sha256Hex, suppressionFormSchema, suppressionKey, suppressionValue, type ConsentForm, type ConsentRecord, type ContactClassification, type ContactForm, type ContactPoint, type ContactPointInsert, type ContactPointPatch, type ContactPurpose, type ContactScope, type ContactSourceType, type ContactType, type ContactValidation, type PhoneKind, type ProviderLicence, type Suppression, type SuppressionForm, UNDOCUMENTED_SOURCE } from '@/lib/domain/contacts';
import { LAWFUL_BASIS_LABELS } from '@/lib/domain/constants';
import { scoreFields } from '@/lib/domain/rescore';
import type { Business } from '@/lib/domain/types';
import { log, type ServiceContext } from './services';
import { CONTACTS_MIGRATION_REQUIRED, StoreError } from './store';

const now = () => new Date().toISOString();

export async function requireContactSchema(ctx: ServiceContext) {
  if (!(await ctx.store.contactSchemaAvailable())) throw new StoreError(CONTACTS_MIGRATION_REQUIRED, 'unavailable');
}

export interface ContactDraft {
  type: ContactType;
  value: string;
  sourceType: ContactSourceType;
  sourceUrl?: string | null;
  sourceProvider?: string | null;
  sourceLicence?: string | null;
  sourceNote?: string | null;
  scope: ContactScope;
  label?: string | null;
  personName?: string | null;
  personRole?: string | null;
  purpose?: ContactPurpose;
  agentVersion?: string | null;
  jobId?: string | null;
}

/** Normalizes, hashes and checks a draft. Throws for restricted sources and missing provenance. */
export async function buildContactPoint(ctx: ServiceContext, business: Business, draft: ContactDraft, licence?: ProviderLicence | null): Promise<ContactPointInsert> {
  try {
    assertStorable(draft, licence);
  } catch (e) {
    throw new StoreError((e as Error).message, 'invalid');
  }
  const n = normalizeContact(draft.type, draft.value);
  if (!n.ok) throw new StoreError(`${CONTACT_TYPE_LABELS[draft.type]}: ${n.error}.`, 'invalid');
  const at = now();
  const hashes = await contactHashes(draft.type, n.normalized);
  return {
    businessId: business.id,
    type: draft.type,
    value: draft.value.trim().slice(0, 320),
    normalizedValue: n.normalized,
    ...hashes,
    hint: maskContact(draft.type, n.normalized),
    scope: draft.scope,
    label: draft.label ?? null,
    personName: draft.personName ?? null,
    personRole: draft.personRole ?? null,
    phoneKind: n.phoneKind ?? null,
    sourceType: draft.sourceType,
    sourceUrl: draft.sourceUrl ?? null,
    sourceProvider: draft.sourceProvider ?? null,
    sourceLicence: draft.sourceLicence ?? null,
    sourceNote: draft.sourceNote ?? null,
    acquiredAt: at,
    acquiredBy: ctx.userId,
    agentVersion: draft.agentVersion ?? null,
    jobId: draft.jobId ?? null,
    purpose: draft.purpose ?? 'research',
    classification: 'unverified',
    validation: null,
    validatedAt: null,
    lastSeenAt: draft.agentVersion ? at : null,
    retentionUntil: defaultRetentionUntil(at, ctx.settings.contactRetentionDays),
    lastReviewedAt: null,
    reviewNote: null,
  };
}

/** A person adds a contact detail with its source. */
export async function addContact(ctx: ServiceContext, business: Business, form: ContactForm) {
  await requireContactSchema(ctx);
  const f = contactFormSchema.parse(form);
  const draft = await buildContactPoint(ctx, business, f);
  const existing = await ctx.store.listContactPoints(business.id);
  if (existing.some((p) => p.type === draft.type && p.normalizedValue === draft.normalizedValue)) throw new StoreError('This contact detail is already recorded for the prospect.', 'conflict');
  const [point] = await ctx.store.createContactPoints([draft]);
  await log(ctx, business.id, 'system', `${CONTACT_TYPE_LABELS[point.type]} recorded (${point.hint}), source: ${point.sourceType.replace(/_/g, ' ')}`, { contactPointId: point.id });
  return point;
}

/** Details already on the profile become tracked contact points (source: existing CRM record). */
export async function importProfileContacts(ctx: ServiceContext, business: Business, by: { agentVersion?: string | null; jobId?: string | null } = {}) {
  await requireContactSchema(ctx);
  const existing = await ctx.store.listContactPoints(business.id);
  const source = business.contactSource?.trim() || null;
  const sourceUrl = source && /^https?:\/\/\S+$/i.test(source) ? source.slice(0, 500) : null;
  const drafts: ContactPointInsert[] = [];
  for (const [type, value] of [
    ['phone', business.phone],
    ['email', business.email],
  ] as const) {
    if (!value?.trim()) continue;
    const n = normalizeContact(type, value);
    if (n.ok && existing.some((p) => (p.type === type || (type === 'phone' && p.type === 'whatsapp')) && p.normalizedValue === n.normalized)) continue;
    if (!n.ok) continue; // An unparseable profile value stays on the profile for a person to correct.
    drafts.push(
      await buildContactPoint(ctx, business, {
        type,
        value,
        sourceType: 'crm_record',
        sourceUrl,
        sourceNote: sourceUrl ? null : (source?.slice(0, 500) ?? UNDOCUMENTED_SOURCE),
        scope: 'business',
        agentVersion: by.agentVersion ?? null,
        jobId: by.jobId ?? null,
      }),
    );
  }
  const created = drafts.length ? await ctx.store.createContactPoints(drafts) : [];
  if (created.length) await log(ctx, business.id, 'system', `Tracked ${created.length} contact detail${created.length === 1 ? '' : 's'} from the profile with provenance`, { contactPointIds: created.map((p) => p.id) });
  return created;
}

export interface ResearchedContact {
  type: ContactType;
  value: string;
  pageUrl: string;
  via: string;
}

/**
 * Stores what the Contact Research agent found on the business's own website. Details found again
 * are marked as seen; website details no longer on a page that was read successfully become
 * outdated (they are kept for the record, not deleted).
 */
export async function saveResearchedContacts(ctx: ServiceContext, business: Business, found: ResearchedContact[], meta: { agentVersion: string; jobId: string | null; pagesRead: string[] }) {
  await requireContactSchema(ctx);
  const existing = await ctx.store.listContactPoints(business.id);
  const at = now();
  const drafts: ContactPointInsert[] = [];
  const seen = new Set<string>();
  for (const f of found) {
    const n = normalizeContact(f.type, f.value);
    if (!n.ok) continue;
    const key = `${f.type}|${n.normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (existing.some((p) => p.type === f.type && p.normalizedValue === n.normalized)) continue;
    drafts.push(
      await buildContactPoint(ctx, business, {
        type: f.type,
        value: f.value,
        sourceType: 'business_website',
        sourceUrl: f.pageUrl,
        sourceNote: `Found by ${meta.agentVersion} (${f.via.replace(/_/g, ' ')})`,
        scope: inferScope(f.type, n.normalized),
        agentVersion: meta.agentVersion,
        jobId: meta.jobId,
      }),
    );
  }
  const created = drafts.length ? await ctx.store.createContactPoints(drafts) : [];
  let refreshed = 0;
  let outdated = 0;
  for (const p of existing.filter((x) => x.sourceType === 'business_website')) {
    if (seen.has(`${p.type}|${p.normalizedValue}`)) {
      await ctx.store.updateContactPoint(p.id, { lastSeenAt: at, ...(p.classification === 'outdated' ? { classification: 'unverified' as const } : {}) });
      refreshed++;
    } else if (p.sourceUrl && meta.pagesRead.includes(p.sourceUrl) && p.classification !== 'outdated') {
      await ctx.store.updateContactPoint(p.id, { classification: 'outdated', reviewNote: `No longer on ${p.sourceUrl} when checked ${at.slice(0, 10)}.` });
      outdated++;
    }
  }
  return { created, refreshed, outdated };
}

/** Stores validation results, and fills empty profile phone/email from a verified business channel. */
export async function saveValidations(ctx: ServiceContext, business: Business, results: { point: ContactPoint; validation: ContactValidation; classification: ContactClassification; phoneKind: PhoneKind | null }[]) {
  await requireContactSchema(ctx);
  const updated: ContactPoint[] = [];
  for (const r of results) {
    updated.push(
      await ctx.store.updateContactPoint(r.point.id, {
        validation: r.validation,
        validatedAt: r.validation.checkedAt,
        classification: r.classification,
        ...(r.phoneKind ? { phoneKind: r.phoneKind } : {}),
      }),
    );
  }
  return { updated, profile: await syncProfileContacts(ctx, business, await ctx.store.listContactPoints(business.id)) };
}

/** CRM integration: empty profile phone/email fields take the best verified business channel. */
export async function syncProfileContacts(ctx: ServiceContext, business: Business, points: ContactPoint[]) {
  const best = (type: ContactType) =>
    points.find((p) => p.type === type && p.scope === 'business' && p.classification === 'verified_business_channel') ?? null;
  const patch: Partial<Business> = {};
  const phone = !business.phone ? best('phone') : null;
  const email = !business.email ? best('email') : null;
  if (phone) patch.phone = phone.normalizedValue;
  if (email) patch.email = email.normalizedValue;
  if (!phone && !email) return null;
  const sources = [...new Set([phone, email].flatMap((p) => (p?.sourceUrl ? [p.sourceUrl] : [])))];
  if (!business.contactSource && sources.length) patch.contactSource = `Published by the business: ${sources.join(', ')}`.slice(0, 500);
  const next = { ...business, ...patch };
  const row = await ctx.store.updateBusiness(business.id, { ...patch, ...scoreFields(next, await ctx.store.listVerifications(business.id), ctx.settings) });
  await log(ctx, business.id, 'system', `Profile contact details filled from verified business channels (${[phone?.hint, email?.hint].filter(Boolean).join(', ')})`);
  return row;
}

export async function reviewContact(ctx: ServiceContext, point: ContactPoint, patch: Pick<ContactPointPatch, 'scope' | 'label' | 'personName' | 'personRole' | 'purpose' | 'classification'>, note: string) {
  await requireContactSchema(ctx);
  if (patch.scope === 'person' && (!(patch.personName ?? point.personName) || !(patch.personRole ?? point.personRole) || (patch.purpose ?? point.purpose) === 'research')) {
    throw new StoreError('A personal work contact needs a name, a role and a purpose other than research.', 'invalid');
  }
  if (patch.classification && !['outdated', 'unverified'].includes(patch.classification)) throw new StoreError('Validation sets the classification; a person can only mark a detail outdated or ask for review.', 'invalid');
  // A scope change means the classification must be worked out again by the next validation.
  const reclassify = patch.scope && patch.scope !== point.scope ? { classification: 'unverified' as const, validatedAt: null } : {};
  const updated = await ctx.store.updateContactPoint(point.id, { ...patch, ...reclassify, lastReviewedAt: now(), reviewNote: note.trim().slice(0, 1000) || null });
  await log(ctx, point.businessId, 'system', `Contact detail reviewed (${point.hint})`, { contactPointId: point.id, ...patch });
  return updated;
}

export async function extendRetention(ctx: ServiceContext, point: ContactPoint, until: string, reason: string) {
  await requireContactSchema(ctx);
  if (reason.trim().length < 10) throw new StoreError('Explain why it should be kept longer (at least 10 characters).', 'invalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= now().slice(0, 10)) throw new StoreError('Choose a future date.', 'invalid');
  const max = new Date(Date.now() + 1095 * 86_400_000).toISOString().slice(0, 10);
  if (until > max) throw new StoreError('Retention can be extended by at most three years at a time.', 'invalid');
  const updated = await ctx.store.updateContactPoint(point.id, { retentionUntil: until, lastReviewedAt: now(), reviewNote: `Kept until ${until}: ${reason.trim()}`.slice(0, 1000) });
  await log(ctx, point.businessId, 'system', `Retention of a contact detail (${point.hint}) extended to ${until}`, { contactPointId: point.id });
  return updated;
}

/** Owners/admins. Consent history and suppression entries survive (without the value). */
export async function deleteContacts(ctx: ServiceContext, points: ContactPoint[], reason: string) {
  await requireContactSchema(ctx);
  if (!points.length) return 0;
  await ctx.store.deleteContactPoints(points.map((p) => p.id));
  const byBusiness = new Map<string, ContactPoint[]>();
  for (const p of points) byBusiness.set(p.businessId, [...(byBusiness.get(p.businessId) ?? []), p]);
  for (const [businessId, list] of byBusiness) {
    await log(ctx, businessId, 'system', `Deleted ${list.length} contact detail${list.length === 1 ? '' : 's'} (${reason})`, { hints: list.map((p) => p.hint) });
  }
  return points.length;
}

// ── Consent ──────────────────────────────────────────────────────────────────

/**
 * Records consent or its withdrawal (people only; agents have no access). A grant also records the
 * business-level permission when none was recorded yet; a withdrawal with optOutAll opts the business
 * out entirely. The database adds suppression entries for a withdrawal.
 */
export async function recordConsent(ctx: ServiceContext, business: Business, form: ConsentForm & { optOutAll?: boolean }) {
  await requireContactSchema(ctx);
  const f = consentFormSchema.parse(form);
  const points = f.contactPointId ? await ctx.store.listContactPoints(business.id) : [];
  const point = f.contactPointId ? points.find((p) => p.id === f.contactPointId) : null;
  if (f.contactPointId && !point) throw new StoreError('That contact detail is no longer recorded.', 'not_found');
  if (point && channelOf(point.type) !== f.channel) throw new StoreError(`That contact detail is not a ${CONSENT_CHANNEL_LABELS[f.channel].toLowerCase()} channel.`, 'invalid');
  if (f.status === 'granted' && business.contactPermission === 'opted_out') {
    throw new StoreError('This business is recorded as opted out. Change the business-level permission first, with the evidence that it asked to hear from you again.', 'invalid');
  }
  const record = await ctx.store.createConsentRecord({
    businessId: business.id,
    contactPointId: point?.id ?? null,
    contactHint: point?.hint ?? null,
    channel: f.channel,
    status: f.status,
    lawfulBasis: f.status === 'granted' ? f.lawfulBasis : null,
    purpose: f.purpose,
    scope: f.scope,
    evidence: f.evidence,
    capturedVia: f.capturedVia,
    capturedAt: new Date(f.capturedAt).toISOString(),
    wording: f.wording,
    expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
    recordedByName: ctx.userLabel,
  });
  const what = `${CONSENT_CHANNEL_LABELS[f.channel]}${point ? ` (${point.hint})` : ''}`;
  await log(ctx, business.id, 'permission', f.status === 'granted' ? `Consent recorded: ${what}` : `Consent withdrawn: ${what}; suppressed`, { consentRecordId: record.id });

  let updated = business;
  if (f.status === 'granted' && (business.contactPermission === 'unknown' || business.contactPermission === 'introduction_requested')) {
    const at = now();
    updated = await ctx.store.updateBusiness(business.id, {
      contactPermission: 'granted',
      lawfulBasis: f.lawfulBasis,
      permissionEvidence: `${CONSENT_CHANNEL_LABELS[f.channel]} consent (${LAWFUL_BASIS_LABELS[f.lawfulBasis!]}): ${f.evidence}`.slice(0, 1000),
      permissionRecordedAt: at,
      ...scoreFields({ ...business, contactPermission: 'granted' }, await ctx.store.listVerifications(business.id), ctx.settings),
    });
    await log(ctx, business.id, 'permission', 'Contact permission: Permission granted (from a consent record)', { from: business.contactPermission, to: 'granted', consentRecordId: record.id });
  }
  if (f.status === 'withdrawn' && form.optOutAll && business.contactPermission !== 'opted_out') {
    const at = now();
    updated = await ctx.store.updateBusiness(business.id, {
      contactPermission: 'opted_out',
      optedOutAt: at,
      permissionRecordedAt: at,
      permissionEvidence: f.evidence.slice(0, 1000),
      nextAction: 'Do not contact (opted out)',
      ...scoreFields({ ...business, contactPermission: 'opted_out' }, await ctx.store.listVerifications(business.id), ctx.settings),
    });
    await log(ctx, business.id, 'permission', 'Contact permission: Opted out — do not contact (from a consent withdrawal)', { from: business.contactPermission, to: 'opted_out', consentRecordId: record.id });
  }
  return { record, business: updated };
}

// ── Suppression ──────────────────────────────────────────────────────────────

/** Anyone who works on prospects can add an entry; suppression always wins over everything else. */
export async function addSuppression(ctx: ServiceContext, form: SuppressionForm) {
  await requireContactSchema(ctx);
  const f = suppressionFormSchema.parse(form);
  const value = suppressionValue(f);
  const valueHash = await sha256Hex(suppressionKey(f.kind, value));
  const existing = (await ctx.store.listSuppressions()).find((s) => !s.liftedAt && s.kind === f.kind && s.valueHash === valueHash && (s.channel ?? null) === f.channel);
  if (existing) throw new StoreError('This contact is already on the suppression list.', 'conflict');
  return ctx.store.createSuppression({
    kind: f.kind,
    valueHash,
    businessId: null,
    channel: f.channel,
    hint: maskContact(f.kind, value),
    reason: f.reason,
    source: 'manual',
    consentRecordId: null,
    note: f.note,
  });
}

/** Owners/admins only, against a consent record made after the entry (checked again by the database). */
export async function liftSuppression(ctx: ServiceContext, suppression: Suppression, consent: ConsentRecord, reason: string) {
  await requireContactSchema(ctx);
  if (reason.trim().length < 10) throw new StoreError('Explain why the suppression is lifted (at least 10 characters).', 'invalid');
  const lifted = await ctx.store.liftSuppression(suppression.id, { reason, consentId: consent.id });
  await log(ctx, consent.businessId, 'permission', `Suppression lifted (${SUPPRESSION_KIND_LABELS[suppression.kind].toLowerCase()} ${suppression.hint}) against a new consent record`, {
    suppressionId: suppression.id,
    consentRecordId: consent.id,
  });
  return lifted;
}
