// Default service packages. Prices are deliberately null: the agency sets its own pricing in
// Settings → Packages, and unpriced items render as "To be quoted".

import { z } from 'zod';
import { PROJECT_TYPES } from './constants';

export const LINE_ITEM_KINDS = ['one_time', 'monthly', 'annual', 'optional'] as const;
export type LineItemKind = (typeof LINE_ITEM_KINDS)[number];
export const LINE_ITEM_KIND_LABELS: Record<LineItemKind, string> = {
  one_time: 'One-time',
  monthly: 'Monthly',
  annual: 'Annual',
  optional: 'Optional',
};

export const LINE_ITEM_CATEGORIES = ['development', 'maintenance', 'hosting', 'domain', 'integration', 'other'] as const;
export type LineItemCategory = (typeof LINE_ITEM_CATEGORIES)[number];

export const packageLineItemSchema = z.object({
  kind: z.enum(LINE_ITEM_KINDS),
  category: z.enum(LINE_ITEM_CATEGORIES),
  description: z.string().min(1).max(300),
  quantity: z.number().positive().max(10000),
  defaultUnitPrice: z.number().nonnegative().max(100_000_000).nullable(),
});

export const phaseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  duration: z.string().max(60),
});

export const servicePackageSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(80),
  summary: z.string().max(500),
  projectType: z.enum(PROJECT_TYPES),
  features: z.array(z.string().min(1).max(200)).max(50),
  exclusions: z.array(z.string().min(1).max(200)).max(30),
  phases: z.array(phaseSchema).max(12),
  lineItems: z.array(packageLineItemSchema).max(30),
});
export type ServicePackage = z.infer<typeof servicePackageSchema>;

/**
 * Controlled price list of optional add-ons. Proposals draw add-on lines from here only, so a draft
 * never contains a price the agency has not configured. Prices default to null ("To be quoted").
 */
export const addOnSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  kind: z.enum(['one_time', 'monthly', 'annual']),
  category: z.enum(LINE_ITEM_CATEGORIES),
  unitPrice: z.number().nonnegative().max(100_000_000).nullable(),
});
export type AddOn = z.infer<typeof addOnSchema>;

const standardExclusions = [
  'Copywriting, photography and translation unless listed as a deliverable',
  'Third-party subscription, licence and transaction fees',
  'Changes requested after sign-off of each phase, unless agreed in writing',
];

const standardPhases = [
  { name: 'Discovery', description: 'Confirm goals, audience, content inventory and success measures.', duration: '' },
  { name: 'Design', description: 'Agree structure, visual direction and key page designs.', duration: '' },
  { name: 'Build', description: 'Develop, populate content and integrate agreed services.', duration: '' },
  { name: 'Launch', description: 'Testing, client approval, deployment and handover.', duration: '' },
];

export const DEFAULT_PACKAGES: ServicePackage[] = [
  {
    key: 'starter_website',
    name: 'Starter Website',
    summary: 'A professional, mobile-first website that establishes an owned online presence.',
    projectType: 'website',
    features: [
      'Responsive website design',
      'Homepage',
      'About page',
      'Services or collection pages',
      'Contact page',
      'Business location map',
      'WhatsApp enquiry button',
      'Basic on-page SEO',
      'Analytics setup',
    ],
    exclusions: standardExclusions,
    phases: standardPhases,
    lineItems: [
      { kind: 'one_time', category: 'development', description: 'Website design and development', quantity: 1, defaultUnitPrice: null },
      { kind: 'annual', category: 'domain', description: 'Domain registration', quantity: 1, defaultUnitPrice: null },
      { kind: 'annual', category: 'hosting', description: 'Hosting', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'maintenance', description: 'Maintenance and updates', quantity: 1, defaultUnitPrice: null },
    ],
  },
  {
    key: 'business_plus',
    name: 'Business Website Plus',
    summary: 'A content-managed website with structured enquiries and business integrations.',
    projectType: 'website',
    features: [
      'Everything in Starter Website',
      'Content management system',
      'Advanced content management (team roles, scheduled updates)',
      'Enquiry forms routed to the team',
      'Business-specific integrations',
      'Expanded SEO (structured data, local search)',
      'Maintenance plan options',
    ],
    exclusions: standardExclusions,
    phases: standardPhases,
    lineItems: [
      { kind: 'one_time', category: 'development', description: 'Website design, CMS and development', quantity: 1, defaultUnitPrice: null },
      { kind: 'optional', category: 'integration', description: 'Additional business integration', quantity: 1, defaultUnitPrice: null },
      { kind: 'annual', category: 'domain', description: 'Domain registration', quantity: 1, defaultUnitPrice: null },
      { kind: 'annual', category: 'hosting', description: 'Hosting', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'maintenance', description: 'Maintenance and content support', quantity: 1, defaultUnitPrice: null },
    ],
  },
  {
    key: 'ecommerce',
    name: 'Ecommerce Platform',
    summary: 'An online store with catalogue, inventory, checkout and order management.',
    projectType: 'ecommerce',
    features: [
      'Product catalogue with categories and variants',
      'Inventory management',
      'Shopping cart',
      'Secure checkout',
      'Supported payment integrations (subject to merchant approval)',
      'Customer accounts',
      'Order management',
      'Administrative dashboard',
    ],
    exclusions: [...standardExclusions, 'Product photography and data entry beyond the agreed catalogue size'],
    phases: [...standardPhases.slice(0, 3), { name: 'Payments & operations', description: 'Merchant onboarding, test orders and staff training.', duration: '' }, standardPhases[3]],
    lineItems: [
      { kind: 'one_time', category: 'development', description: 'Ecommerce design and development', quantity: 1, defaultUnitPrice: null },
      { kind: 'one_time', category: 'integration', description: 'Payment gateway integration', quantity: 1, defaultUnitPrice: null },
      { kind: 'annual', category: 'domain', description: 'Domain registration', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'hosting', description: 'Hosting and platform services', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'maintenance', description: 'Maintenance and support', quantity: 1, defaultUnitPrice: null },
    ],
  },
  {
    key: 'automation',
    name: 'Business Automation',
    summary: 'Internal dashboards and workflows that reduce manual operations.',
    projectType: 'dashboard',
    features: ['Internal dashboards', 'CRM integrations', 'Booking workflows', 'Inventory processes', 'Reporting', 'Custom automation'],
    exclusions: standardExclusions,
    phases: [
      { name: 'Process mapping', description: 'Document current workflows and agree automation priorities.', duration: '' },
      ...standardPhases.slice(1),
    ],
    lineItems: [
      { kind: 'one_time', category: 'development', description: 'Workflow analysis and implementation', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'hosting', description: 'Hosting and services', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'maintenance', description: 'Support and improvements', quantity: 1, defaultUnitPrice: null },
    ],
  },
  {
    key: 'mobile_app',
    name: 'Mobile Application',
    summary: 'Android and iOS applications on a shared backend.',
    projectType: 'mobile_app',
    features: [
      'Android application',
      'iOS application',
      'Shared backend and admin',
      'Push notifications (with user consent)',
      'Customer accounts',
      'Mobile commerce or business-specific workflows',
    ],
    exclusions: [...standardExclusions, 'Apple and Google developer account fees', 'App store approval timing'],
    phases: [...standardPhases.slice(0, 3), { name: 'Store submission', description: 'Beta testing, store listings and submission.', duration: '' }],
    lineItems: [
      { kind: 'one_time', category: 'development', description: 'App design and development (Android + iOS)', quantity: 1, defaultUnitPrice: null },
      { kind: 'one_time', category: 'development', description: 'Backend and admin development', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'hosting', description: 'Backend hosting', quantity: 1, defaultUnitPrice: null },
      { kind: 'monthly', category: 'maintenance', description: 'App maintenance and OS updates', quantity: 1, defaultUnitPrice: null },
    ],
  },
];

const addOn = (key: string, name: string, description: string, category: AddOn['category'] = 'development', kind: AddOn['kind'] = 'one_time'): AddOn => ({
  key,
  name,
  description,
  kind,
  category,
  unitPrice: null,
});

export const DEFAULT_ADD_ONS: AddOn[] = [
  addOn('collections', 'Collection pages', 'Seasonal or themed collection pages managed by your team.'),
  addOn('product_catalogue', 'Product catalogue', 'Browsable products with categories, photos and details (no checkout).'),
  addOn('product_details', 'Dimensions and finishes', 'Structured dimensions, materials and finish options on each product.'),
  addOn('whatsapp_enquiries', 'Product-level WhatsApp enquiries', 'An enquiry button on each product or service that opens WhatsApp with the item named.', 'integration'),
  addOn('momo_checkout', 'Mobile Money checkout', 'Mobile Money and card payments through a supported provider, subject to merchant approval.', 'integration'),
  addOn('payments', 'Online payments', 'Deposits or full payments through a supported provider, subject to merchant approval.', 'integration'),
  addOn('inventory', 'Inventory management', 'Stock levels linked to listings so unavailable items are marked.'),
  addOn('order_management', 'Order management', 'An order dashboard for status, fulfilment and customer details.'),
  addOn('quote_requests', 'Quote request builder', 'Structured quote requests that capture items, quantities and requirements.'),
  addOn('delivery_enquiries', 'Delivery enquiries', 'Delivery areas, lead times and a delivery enquiry form.'),
  addOn('service_catalogue', 'Service catalogue', 'Services with descriptions, durations and starting prices you set.'),
  addOn('booking_calendar', 'Booking calendar', 'Online booking against staff or room availability.', 'integration'),
  addOn('client_accounts', 'Client accounts', 'Sign-in for clients to see bookings, orders or history.'),
  addOn('reminders', 'Reminder system', 'Appointment reminders sent only to clients who ask for them (messaging fees billed by the provider).', 'integration'),
  addOn('room_catalogue', 'Room catalogue', 'Room types with photos, facilities and occupancy.'),
  addOn('booking_engine', 'Booking engine', 'Direct room booking with availability and rates.', 'integration'),
  addOn('guest_communications', 'Guest communications', 'Booking confirmations and pre-arrival information; marketing only with guest consent.', 'integration'),
  addOn('digital_menu', 'Digital menu', 'A menu with categories, photos and availability your team can update.'),
  addOn('online_ordering', 'Online ordering', 'Ordering for pickup or delivery with order notifications.'),
  addOn('reservations', 'Reservation requests', 'Table or event reservation requests routed to your team.'),
  addOn('enquiry_forms', 'Structured enquiry forms', 'Forms that capture the details your team needs to respond.'),
  addOn('content_management', 'Content management', 'Team editing of pages, products and announcements.'),
  addOn('app_roadmap', 'Mobile app roadmap', 'A feasibility review and phased roadmap for a future mobile app (no app build).', 'other'),
];

/** Relative scope of the default packages, used to prefer the smallest package that meets the need. */
export const PACKAGE_TIER: Record<string, number> = { starter_website: 1, business_plus: 2, automation: 3, ecommerce: 3, mobile_app: 4 };
