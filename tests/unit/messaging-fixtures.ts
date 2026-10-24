// Shared set-up for the phase 7–8 messaging tests: a demo workspace with a prospect, a validated
// email contact point, written consent, and an approved email template covered by a message policy.
// Everything runs in the in-memory LocalStore; nothing is sent.

import * as contacts from '@/lib/data/contact-services';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import * as messaging from '@/lib/data/messaging-services';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { validateContactPoint, type ConsentForm, type ContactPoint } from '@/lib/domain/contacts';
import type { MessageTemplate } from '@/lib/domain/messaging';
import { DEFAULT_SENDING_POLICY } from '@/lib/domain/sending-policy';
import type { BusinessForm } from '@/lib/domain/schemas';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { Business } from '@/lib/domain/types';

/** The agency's own sandbox address (configured as a test recipient). */
export const TEST_EMAIL = 'owner@agency-sandbox.com';
/** A prospect's address: never a test recipient. */
export const PROSPECT_EMAIL = 'info@kofibakes.com';

export const INTRO_BODY = `Hello {{business_name}} team,

Thank you for agreeing to hear from us. I'm {{sender_name}} from {{agency_name}}. We noted a few ideas that could help customers find you online.

Would a 15-minute call next week suit you? If not, just reply and we will not follow up.`;

export function demoContext(): ServiceContext {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.agency = { ...settings.agency, name: 'Sandbox Agency', address: '12 Example Street, Accra', email: 'hello@agency-sandbox.com' };
  settings.messagingTestRecipients = [TEST_EMAIL];
  return { store: new LocalStore(new MemoryStorage()), settings, userId: 'demo-user', userLabel: 'Ama Mensah' };
}

const form = (overrides: Partial<BusinessForm> = {}): BusinessForm => ({
  name: 'Kofi Bakes',
  category: 'Bakery',
  country: 'GH',
  region: 'Greater Accra',
  districtCode: null,
  city: 'Accra',
  neighborhood: 'Osu',
  address: null,
  businessStatus: 'active',
  officialWebsite: null,
  socialProfiles: [],
  enquiryChannel: null,
  phone: null,
  email: null,
  contactSource: null,
  interestLevel: 'unknown',
  budgetSignal: 'unknown',
  serviceNeeds: ['Online ordering'],
  estimatedValue: null,
  expectedCloseDate: null,
  nextAction: null,
  nextActionDue: null,
  notes: '',
  sourceUrl: 'https://example.org/directory/kofi',
  sourceKind: 'directory',
  placesPlaceId: null,
  ...overrides,
});

export const grant = (overrides: Partial<ConsentForm> = {}): ConsentForm => ({
  channel: 'email',
  contactPointId: null,
  status: 'granted',
  lawfulBasis: 'consent',
  purpose: 'direct_marketing',
  scope: null,
  evidence: 'Signed the agency open-day sign-up sheet (scan kept in Drive).',
  capturedVia: 'web_form',
  capturedAt: new Date().toISOString(),
  wording: 'Yes, email me about website services.',
  expiresAt: null,
  ...overrides,
});

export interface Prospect {
  business: Business;
  point: ContactPoint;
  template: MessageTemplate;
}

/** A prospect with a validated email point, optional consent and an approved introduction template. */
export async function prospect(ctx: ServiceContext, opts: { email?: string; consent?: Partial<ConsentForm> | false; name?: string } = {}): Promise<Prospect> {
  const email = opts.email ?? TEST_EMAIL;
  const b = await svc.createBusiness(ctx, form({ name: opts.name ?? 'Kofi Bakes' }));
  const added = await contacts.addContact(ctx, b, {
    type: 'email',
    value: email,
    sourceType: 'directly_provided',
    sourceUrl: null,
    sourceNote: 'Given at the agency open day',
    scope: 'business',
    label: null,
    personName: null,
    personRole: null,
    purpose: 'research',
  });
  const domain = email.split('@')[1];
  const mx = new Map([[domain, { domain, status: 'found' as const, hosts: [`mail.${domain}`] }]]);
  const [point] = (await contacts.saveValidations(ctx, b, [{ point: added, validation: validateContactPoint(added, { mx, others: [], now: new Date() }), classification: 'verified_business_channel', phoneKind: null }])).updated;
  if (opts.consent !== false) await contacts.recordConsent(ctx, (await ctx.store.getBusiness(b.id))!, grant({ contactPointId: point.id, ...opts.consent }));
  return { business: (await ctx.store.getBusiness(b.id))!, point, template: await introTemplate(ctx) };
}

/** The workspace's approved email introduction (created once), covered by a message policy. */
export async function introTemplate(ctx: ServiceContext): Promise<MessageTemplate> {
  const existing = (await ctx.store.listTemplates()).find((t) => t.name === 'Introduction');
  if (existing) return existing;
  const t = await messaging.saveTemplate(ctx, { channel: 'email', name: 'Introduction', purpose: 'introduction', language: 'en', subject: 'Ideas for {{business_name}}', body: INTRO_BODY, providerTemplateName: '' });
  const approved = await messaging.setTemplateStatus(ctx, t, 'approved');
  await cover(ctx, approved);
  return approved;
}

/** An owner's standing approval for the template's current version. */
export async function cover(ctx: ServiceContext, template: MessageTemplate, dailyCap = 10) {
  return messaging.createPolicy(ctx, { templateId: template.id, name: `${template.name} policy`, dailyCap, days: 90, note: '' }, [template]);
}

export const SENDING_CONTROLS: messaging.SendingControls = { mode: 'research_only', outboundStopped: true, sendingPolicy: DEFAULT_SENDING_POLICY, sendingPaused: false };

export const demoEnv = (ctx: ServiceContext, controls: Partial<messaging.SendingControls> = {}) => messaging.demoMessagingEnv(ctx, { ...SENDING_CONTROLS, ...controls });

/** Drafts an introduction for the prospect, approves it as an owner and queues it. */
export async function queued(ctx: ServiceContext, p: Prospect) {
  const draft = await messaging.draftMessage(ctx, { business: p.business, point: p.point, purpose: 'introduction', template: p.template });
  const approval = await messaging.approveMessage(ctx, draft, await demoEnv(ctx), 'owner');
  if (!approval.approved) throw new Error(`Not approved: ${approval.result.reasons.join(' ')}`);
  return messaging.queueMessage(ctx, approval.message);
}
