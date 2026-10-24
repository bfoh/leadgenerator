// Industry proposal templates and the deterministic plan behind a proposal draft: which package,
// which add-ons, and why. The plan follows the needs the team recorded and the verified website
// position, not the largest package, and every choice carries a reason a person can check. Prices
// never come from here: they come from the agency's packages and add-on price list.

import { trackForCategory, type TrackKey } from './categories';
import { CLOSED_STAGES, type ProposalStatus, type WebsiteStatus } from './constants';
import { COMPLIANCE_ASSUMPTION, complianceForCategory } from './industry-compliance';
import { PACKAGE_TIER, type AddOn, type ServicePackage } from './packages';
import { NEXT_ACTION_META, type NextAction } from './report';
import type { OrgSettings } from './settings';
import type { Business, OpportunityReport, Proposal } from './types';

export const TEMPLATE_VERSION = 'templates-1';

// ── Recorded needs ───────────────────────────────────────────────────────────

export const NEED_KEYS = [
  'ecommerce',
  'payments',
  'booking',
  'catalogue',
  'inventory',
  'quotes',
  'delivery',
  'ordering',
  'content',
  'automation',
  'app',
  'reminders',
  'accounts',
  'whatsapp',
] as const;
export type NeedKey = (typeof NEED_KEYS)[number];

const NEED_PATTERNS: Record<NeedKey, RegExp> = {
  ecommerce: /e-?commerce|online (store|shop|sales|selling)|sell(ing)? online|check-?out|shopping cart/i,
  payments: /payment|mobile money|\bmomo\b|pay online|deposit/i,
  booking: /\bbook|appointment|reserv|calendar|schedul|availability/i,
  catalogue: /catalog|collection|product|listing|lookbook|menu|rooms?\b/i,
  inventory: /inventory|stock/i,
  quotes: /\bquot/i,
  delivery: /deliver/i,
  ordering: /\border/i,
  content: /\bcms\b|content|blog|update (the |our )?(site|website)/i,
  automation: /automat|dashboard|\bcrm\b|workflow|reporting/i,
  app: /\bapps?\b|android|\bios\b/i,
  reminders: /remind/i,
  accounts: /account|log-?in|member/i,
  whatsapp: /whatsapp/i,
};

export interface DetectedNeed {
  key: NeedKey;
  /** The recorded need that matched, quoted back in reasons. */
  source: string;
}

/** Maps the team's free-text service needs onto need keys. Only recorded text counts as a need. */
export function detectNeeds(serviceNeeds: readonly string[]): { needs: DetectedNeed[]; unmatched: string[] } {
  const needs: DetectedNeed[] = [];
  const unmatched: string[] = [];
  for (const raw of serviceNeeds) {
    const text = raw.trim();
    if (!text) continue;
    const keys = NEED_KEYS.filter((k) => NEED_PATTERNS[k].test(text));
    if (!keys.length) unmatched.push(text);
    for (const key of keys) if (!needs.some((n) => n.key === key)) needs.push({ key, source: text });
  }
  return { needs, unmatched };
}

// ── Templates ────────────────────────────────────────────────────────────────

interface TemplateAddOn {
  key: string;
  /** Recorded needs that put the add-on in scope as a quoted line. */
  needs: NeedKey[];
  /** Offered as an optional line when no recorded need matches. */
  offer?: boolean;
}

export interface ProposalTemplate {
  track: TrackKey;
  label: string;
  /** The routine package for the sector when no recorded need asks for more. */
  basePackage: string;
  /** Industry recommendations considered for the sector (shown in the recommended solution). */
  recommendations: string[];
  addOns: TemplateAddOn[];
  /** Suggested for later phases and not quoted, unless the chosen package already covers them. */
  roadmap: { text: string; unless?: string[] }[];
  assumptions: string[];
  exclusions: string[];
}

const PHOTO_ASSUMPTION = 'Product or service photos and descriptions are supplied by the business unless photography or copywriting is quoted.';

export const PROPOSAL_TEMPLATES: Record<TrackKey, ProposalTemplate> = {
  fashion: {
    track: 'fashion',
    label: 'Fashion retail',
    basePackage: 'business_plus',
    recommendations: ['Collections your team can update', 'Product management', 'WhatsApp enquiries on each product', 'Mobile Money checkout', 'Inventory', 'Premium ecommerce once online selling is confirmed', 'Mobile app roadmap'],
    addOns: [
      { key: 'collections', needs: ['catalogue'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'], offer: true },
      { key: 'inventory', needs: ['inventory'] },
      { key: 'momo_checkout', needs: ['payments'] },
      // A recorded app need also lands here as an optional line: a roadmap is advice, not what was asked for.
      { key: 'app_roadmap', needs: [], offer: true },
    ],
    roadmap: [
      { text: 'An online store with Mobile Money checkout once stock is managed consistently', unless: ['ecommerce'] },
      { text: 'A mobile shopping app after the website shows steady demand', unless: ['mobile_app'] },
    ],
    assumptions: [PHOTO_ASSUMPTION, 'Sizes, variants and stock levels are maintained by the business.'],
    exclusions: ['Product photography and styling unless quoted'],
  },
  bridal: {
    track: 'bridal',
    label: 'Bridal',
    basePackage: 'starter_website',
    recommendations: ['Editorial lookbook', 'Fitting appointment requests', 'WhatsApp enquiries', 'Showroom location and directions'],
    addOns: [
      { key: 'collections', needs: ['catalogue'], offer: true },
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'] },
      { key: 'payments', needs: ['payments'] },
    ],
    roadmap: [{ text: 'A client workflow for fittings and alterations' }],
    assumptions: [PHOTO_ASSUMPTION],
    exclusions: ['Photo shoots and model fees'],
  },
  furniture: {
    track: 'furniture',
    label: 'Furniture showroom',
    basePackage: 'business_plus',
    recommendations: ['Product catalogue', 'Quote requests', 'Product dimensions and finishes', 'Inventory', 'Delivery enquiries', 'Order management'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'product_details', needs: ['catalogue'], offer: true },
      { key: 'delivery_enquiries', needs: ['delivery'], offer: true },
      { key: 'inventory', needs: ['inventory'] },
      { key: 'order_management', needs: ['ordering'] },
    ],
    roadmap: [
      { text: 'Online ordering for stocked items', unless: ['ecommerce'] },
      { text: 'A trade customer portal' },
    ],
    assumptions: [PHOTO_ASSUMPTION, 'Dimensions, finishes and delivery areas are supplied by the business.'],
    exclusions: ['3D models or room visualisers unless quoted'],
  },
  beauty: {
    track: 'beauty',
    label: 'Beauty and wellness',
    basePackage: 'starter_website',
    recommendations: ['Service catalogue', 'Booking calendar', 'Availability', 'Client accounts', 'Payment integration', 'Reminder system'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'client_accounts', needs: ['accounts'] },
      { key: 'reminders', needs: ['reminders'], offer: true },
    ],
    roadmap: [{ text: 'A membership or loyalty programme' }],
    assumptions: ['Service list, durations and staff availability are supplied by the business.', 'Reminders go only to clients who ask for them.'],
    exclusions: ['Messaging provider fees for reminders'],
  },
  hospitality: {
    track: 'hospitality',
    label: 'Hotel and guesthouse',
    basePackage: 'business_plus',
    recommendations: ['Room catalogue', 'Booking engine', 'Availability', 'Payments', 'Guest communications'],
    addOns: [
      { key: 'room_catalogue', needs: ['catalogue'], offer: true },
      { key: 'booking_engine', needs: ['booking'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'guest_communications', needs: ['reminders'], offer: true },
    ],
    roadmap: [{ text: 'Direct-booking reporting' }, { text: 'Returning-guest communications for guests who opt in' }],
    assumptions: ['Room types, rates and policies are supplied by the property.', 'Existing travel-platform listings stay in place unless agreed otherwise.'],
    exclusions: ['Channel manager or travel-platform integration unless quoted'],
  },
  food: {
    track: 'food',
    label: 'Restaurant and food',
    basePackage: 'starter_website',
    recommendations: ['Digital menu', 'Online ordering', 'Reservation requests', 'Customer enquiries'],
    addOns: [
      { key: 'digital_menu', needs: ['catalogue'], offer: true },
      { key: 'reservations', needs: ['booking'], offer: true },
      { key: 'online_ordering', needs: ['ordering'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'delivery_enquiries', needs: ['delivery'] },
    ],
    roadmap: [{ text: 'A loyalty programme' }, { text: 'A mobile ordering app feasibility study', unless: ['mobile_app'] }],
    assumptions: ['Menu items, prices and opening hours are supplied and kept current by the business.'],
    exclusions: ['Delivery rider services and third-party delivery platform fees'],
  },
  auto: {
    track: 'auto',
    label: 'Auto dealership',
    basePackage: 'business_plus',
    recommendations: ['Vehicle listings', 'Test-drive and enquiry forms', 'Inventory', 'Trade-in requests'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'inventory', needs: ['inventory'] },
    ],
    roadmap: [{ text: 'A financing calculator' }],
    assumptions: ['Vehicle details and photos are supplied by the dealership.'],
    exclusions: ['Vehicle data feeds from third parties unless quoted'],
  },
  events: {
    track: 'events',
    label: 'Events',
    basePackage: 'starter_website',
    recommendations: ['Portfolio of past events', 'Service packages', 'Structured event enquiries'],
    addOns: [
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'booking_calendar', needs: ['booking'] },
      { key: 'payments', needs: ['payments'] },
    ],
    roadmap: [{ text: 'A client planning portal' }],
    assumptions: ['Event photos are supplied by the business with permission to publish them.'],
    exclusions: [],
  },
  creative: {
    track: 'creative',
    label: 'Photography and creative studio',
    basePackage: 'starter_website',
    recommendations: ['Portfolio', 'Packages', 'Session booking'],
    addOns: [
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'Client galleries and proofing' }],
    assumptions: ['Portfolio images are supplied by the studio.'],
    exclusions: [],
  },
  fitness: {
    track: 'fitness',
    label: 'Fitness',
    basePackage: 'starter_website',
    recommendations: ['Class schedule', 'Membership enquiries', 'Class booking'],
    addOns: [
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'A member app feasibility study', unless: ['mobile_app'] }],
    assumptions: ['Class times and membership options are supplied by the business.'],
    exclusions: [],
  },
  education: {
    track: 'education',
    label: 'Education and training',
    basePackage: 'starter_website',
    recommendations: ['Course catalogue', 'Application enquiries', 'Online applications'],
    addOns: [
      { key: 'enquiry_forms', needs: ['quotes', 'booking'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'A learning portal feasibility study' }],
    assumptions: ['Course details, fees and accreditation are supplied by the institution.'],
    exclusions: [],
  },
  professional: {
    track: 'professional',
    label: 'Professional services',
    basePackage: 'starter_website',
    recommendations: ['Service pages', 'Team and credentials', 'Consultation requests'],
    addOns: [
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'booking_calendar', needs: ['booking'] },
    ],
    roadmap: [{ text: 'A client portal' }],
    assumptions: ['Credentials and team details are supplied and approved by the firm.'],
    exclusions: [],
  },
  health: {
    track: 'health',
    label: 'Health facility',
    basePackage: 'starter_website',
    recommendations: ['Services and opening hours', 'Appointment requests', 'Directions and emergency contacts', 'WhatsApp enquiries'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'], offer: true },
      { key: 'reminders', needs: ['reminders'] },
      { key: 'payments', needs: ['payments'] },
    ],
    roadmap: [{ text: 'A patient portal feasibility study, after a data protection review' }],
    assumptions: [
      'Services, opening hours and staff details are supplied and approved by the facility.',
      'Health claims on the website are supplied and approved by the facility, which confirms they meet the advertising rules that apply to it.',
      'Website forms collect only what is needed to arrange a visit, never medical history.',
      'Reminders go only to patients who ask for them.',
    ],
    exclusions: ['Electronic medical records or prescription handling unless quoted', 'Messaging provider fees for reminders'],
  },
  pharmacy: {
    track: 'pharmacy',
    label: 'Pharmacy',
    basePackage: 'starter_website',
    recommendations: ['Opening hours and location', 'WhatsApp availability enquiries', 'Product range pages', 'Delivery enquiries'],
    addOns: [
      { key: 'whatsapp_enquiries', needs: ['whatsapp'], offer: true },
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'delivery_enquiries', needs: ['delivery'], offer: true },
      { key: 'reminders', needs: ['reminders'] },
      { key: 'payments', needs: ['payments'] },
    ],
    roadmap: [{ text: 'An online ordering feasibility study, subject to the rules for selling medicines', unless: ['ecommerce'] }],
    assumptions: [
      'Product names, opening hours and services are supplied and kept current by the pharmacy.',
      'Prescription-only medicines are not sold or advertised through the website.',
      'Reminders go only to customers who ask for them.',
    ],
    exclusions: ['Online sale of prescription medicines', 'Stock system integration unless quoted'],
  },
  nonprofit: {
    track: 'nonprofit',
    label: 'Nonprofit or public body',
    basePackage: 'starter_website',
    recommendations: ['Programme pages', 'Impact reporting', 'Volunteer and referral forms', 'Donation enquiries', 'Governance information'],
    addOns: [
      { key: 'enquiry_forms', needs: ['quotes', 'content'], offer: true },
      { key: 'content_management', needs: ['content'], offer: true },
      { key: 'payments', needs: ['payments'] },
      { key: 'app_roadmap', needs: [], offer: true },
    ],
    roadmap: [{ text: 'Beneficiary case management, after a data protection review' }],
    assumptions: ['Programme descriptions, registration details and photographs are supplied by the organisation.', 'Impact figures are published only where the organisation can evidence them.'],
    exclusions: ['Beneficiary data collection beyond a simple enquiry form'],
  },
  environment: {
    track: 'environment',
    label: 'Environmental and water services',
    basePackage: 'starter_website',
    recommendations: ['Services and methods', 'Permits and compliance', 'Coverage', 'Assessment requests', 'Report delivery'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'content_management', needs: ['content'] },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'A client portal for monitoring results', unless: ['automation'] }],
    assumptions: ['Permits, methods and results are supplied and verified by the firm.', 'No environmental claim is published without supporting evidence.'],
    exclusions: ['Laboratory testing and regulatory filing'],
  },
  facilities: {
    track: 'facilities',
    label: 'Facilities and support services',
    basePackage: 'starter_website',
    recommendations: ['Service scope', 'Coverage areas', 'Scheduled and callout requests', 'Vetting and insurance information', 'WhatsApp enquiries'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'Recurring service scheduling for contract clients', unless: ['automation'] }],
    assumptions: ['Service scope, coverage and response times are supplied by the business.', 'Vetting and insurance statements are published only as the business confirms them.'],
    exclusions: ['Background checks and insurance cover'],
  },
  logistics: {
    track: 'logistics',
    label: 'Transport and logistics',
    basePackage: 'business_plus',
    recommendations: ['Coverage and routes', 'Fleet and capacity', 'Booking requests', 'Consignment tracking', 'Proof of delivery'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'delivery_enquiries', needs: ['delivery'], offer: true },
      { key: 'client_accounts', needs: ['accounts'] },
      { key: 'app_roadmap', needs: [], offer: true },
    ],
    roadmap: [{ text: 'Live tracking with driver updates once dispatch data is reliable', unless: ['automation'] }],
    assumptions: ['Routes, rates and vehicle capacity are supplied by the company.', 'Consignment data comes from the company’s dispatch records.'],
    exclusions: ['Vehicle tracking hardware and installation'],
  },
  manufacturing: {
    track: 'manufacturing',
    label: 'Manufacturing and printing',
    basePackage: 'business_plus',
    recommendations: ['Product specifications', 'Production capacity', 'Request-for-quote', 'Order tracking', 'Distributor enquiries'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'order_management', needs: ['ordering'] },
      { key: 'inventory', needs: ['inventory'] },
      { key: 'delivery_enquiries', needs: ['delivery'] },
    ],
    roadmap: [{ text: 'A reorder portal for regular trade customers', unless: ['ecommerce'] }],
    assumptions: ['Specifications, capacities and lead times are supplied by the factory.', 'Certificates are published only where the business holds them.'],
    exclusions: ['Production machinery, ERP licensing and certification audits'],
  },
  mining_energy: {
    track: 'mining_energy',
    label: 'Mining, energy and utilities',
    basePackage: 'starter_website',
    recommendations: ['Services and equipment', 'Licences and safety', 'Coverage', 'Supply and service requests', 'Project evidence'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'enquiry_forms', needs: [], offer: true },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'A service-history portal for equipment clients', unless: ['automation'] }],
    assumptions: ['Licences, equipment and capacity details are supplied by the company.', 'Safety and environmental statements are published only as approved by the company.'],
    exclusions: ['Licensing, permitting and statutory inspections'],
  },
  real_estate: {
    track: 'real_estate',
    label: 'Real estate and property',
    basePackage: 'business_plus',
    recommendations: ['Property listings', 'Search and filters', 'Viewing requests', 'Landlord and tenant information', 'Document checklists'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'booking_calendar', needs: ['booking'], offer: true },
      { key: 'client_accounts', needs: ['accounts'] },
      { key: 'app_roadmap', needs: [], offer: true },
    ],
    roadmap: [{ text: 'Saved searches and alerts for buyers who opt in', unless: ['automation'] }],
    assumptions: ['Property details, prices and availability are supplied by the agency with the owner’s permission.', 'Documents are published only where the agency has verified them.'],
    exclusions: ['Title searches, valuation and legal conveyancing'],
  },
  construction: {
    track: 'construction',
    label: 'Construction and building trades',
    basePackage: 'starter_website',
    recommendations: ['Trades and services', 'Completed projects', 'Licences and insurance', 'Site visit and quote requests', 'Progress updates'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'enquiry_forms', needs: [], offer: true },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'A client project portal with milestone updates', unless: ['automation'] }],
    assumptions: ['Project photographs and trade licences are supplied by the contractor.', 'No completion date is promised before the scope is agreed.'],
    exclusions: ['Drawings, permits and structural certification'],
  },
  ict: {
    track: 'ict',
    label: 'ICT and software services',
    basePackage: 'starter_website',
    recommendations: ['Service pages', 'Case notes', 'Technologies and team', 'Discovery requests', 'Support path'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'content_management', needs: ['content'] },
      { key: 'client_accounts', needs: ['accounts'] },
      { key: 'app_roadmap', needs: [], offer: true },
    ],
    roadmap: [{ text: 'Productised packages with online payment once scope is standardised', unless: ['ecommerce'] }],
    assumptions: ['Case notes are published only with the client’s permission.', 'Technologies listed are those the team actually supports.'],
    exclusions: ['Software licensing, hosting fees and third-party subscriptions'],
  },
  finance: {
    track: 'finance',
    label: 'Financial services',
    basePackage: 'starter_website',
    recommendations: ['Product and terms pages', 'Rate and fee disclosure', 'Branch and agent locator', 'Application or appointment requests', 'Complaints path'],
    addOns: [
      { key: 'service_catalogue', needs: ['catalogue'], offer: true },
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'booking_calendar', needs: ['booking'] },
      { key: 'client_accounts', needs: ['accounts'] },
    ],
    roadmap: [{ text: 'A self-service customer portal, after a security and data protection review', unless: ['automation'] }],
    assumptions: ['Licence details, product terms and fees are supplied and approved by the institution.', 'No financial product is described as guaranteed.'],
    exclusions: ['Core banking integration, KYC tooling and regulatory reporting'],
  },
  wholesale: {
    track: 'wholesale',
    label: 'Wholesale and distribution',
    basePackage: 'business_plus',
    recommendations: ['Trade catalogue', 'Pack sizes and minimum order quantities', 'Account requests', 'Delivery scheduling', 'Price lists for approved buyers'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'order_management', needs: ['ordering'] },
      { key: 'inventory', needs: ['inventory'] },
      { key: 'client_accounts', needs: ['accounts'] },
      { key: 'delivery_enquiries', needs: ['delivery'] },
    ],
    roadmap: [{ text: 'A buyer ordering portal for approved accounts', unless: ['ecommerce'] }],
    assumptions: ['Pack sizes, minimum quantities and trade pricing are supplied by the distributor.', 'Credit terms are agreed by the distributor, not the website.'],
    exclusions: ['Credit assessment, debt collection and warehouse systems'],
  },
  retail: {
    track: 'retail',
    label: 'Retail and general merchandise',
    basePackage: 'business_plus',
    recommendations: ['Product catalogue with prices', 'WhatsApp or form orders', 'Stock status', 'Pickup and delivery options', 'Loyalty follow-up'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'], offer: true },
      { key: 'momo_checkout', needs: ['payments'] },
      { key: 'inventory', needs: ['inventory'] },
      { key: 'delivery_enquiries', needs: ['delivery'] },
      { key: 'order_management', needs: ['ordering'] },
    ],
    roadmap: [{ text: 'An online store with Mobile Money checkout once stock is managed consistently', unless: ['ecommerce'] }],
    assumptions: [PHOTO_ASSUMPTION, 'Prices and stock levels are maintained by the shop.'],
    exclusions: ['Product photography and stocktaking'],
  },
  livestock: {
    track: 'livestock',
    label: 'Livestock and fisheries',
    basePackage: 'starter_website',
    recommendations: ['Stock and breeds', 'Health services', 'Order and visit requests', 'Delivery arrangements', 'WhatsApp enquiries'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'] },
      { key: 'delivery_enquiries', needs: ['delivery'] },
    ],
    roadmap: [{ text: 'Repeat-order reminders for buyers who opt in', unless: ['automation'] }],
    assumptions: ['Stock, breeds and health records are supplied by the farm or clinic.', 'No veterinary advice is published as a substitute for a consultation.'],
    exclusions: ['Veterinary treatment and transport of animals'],
  },
  agriculture: {
    track: 'agriculture',
    label: 'Agriculture and crop farming',
    basePackage: 'starter_website',
    recommendations: ['Produce and seasonality', 'Bulk order enquiries', 'Delivery areas', 'WhatsApp enquiries', 'Buyer records'],
    addOns: [
      { key: 'product_catalogue', needs: ['catalogue'], offer: true },
      { key: 'quote_requests', needs: ['quotes'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'] },
      { key: 'delivery_enquiries', needs: ['delivery'] },
      { key: 'order_management', needs: ['ordering'] },
    ],
    roadmap: [{ text: 'An aggregator portal for outgrower schemes', unless: ['automation'] }],
    assumptions: ['Volumes, seasons and prices are supplied by the farm and change through the year.', 'Photographs show the farm’s own produce.'],
    exclusions: ['Farm photography, certification and input financing'],
  },
  general: {
    track: 'general',
    label: 'General business',
    basePackage: 'starter_website',
    recommendations: ['Services pages', 'Contact and location', 'Structured enquiries'],
    addOns: [
      { key: 'enquiry_forms', needs: ['quotes'], offer: true },
      { key: 'whatsapp_enquiries', needs: ['whatsapp'] },
    ],
    roadmap: [{ text: 'A business automation review' }],
    assumptions: [],
    exclusions: [],
  },
};

/** Add-ons used for a recorded need the sector template does not map. */
const GENERIC_NEED_ADD_ONS: Partial<Record<NeedKey, string>> = {
  whatsapp: 'whatsapp_enquiries',
  payments: 'payments',
  booking: 'booking_calendar',
  reminders: 'reminders',
  accounts: 'client_accounts',
  inventory: 'inventory',
  quotes: 'quote_requests',
  delivery: 'delivery_enquiries',
  catalogue: 'product_catalogue',
  content: 'content_management',
};

/** Add-ons a default package already delivers, so they are not quoted twice. */
const PACKAGE_COVERS: Record<string, string[]> = {
  starter_website: [],
  business_plus: ['content_management', 'enquiry_forms', 'collections', 'service_catalogue'],
  ecommerce: ['product_catalogue', 'collections', 'inventory', 'momo_checkout', 'payments', 'client_accounts', 'order_management', 'online_ordering', 'content_management'],
  automation: ['inventory', 'order_management'],
  mobile_app: ['client_accounts', 'app_roadmap'],
};

const MAX_OFFERS = 3;

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface PlannedAddOn {
  addOn: AddOn;
  /** In scope as a quoted line (a recorded need), or offered as an optional line. */
  included: boolean;
  reason: string;
}

/**
 * What the scope actually rests on. Category templates describe a sector; they are never evidence
 * about a business. A plan measured only by sector guidance says so, so the proposal can present it
 * as something to confirm rather than as a finding.
 */
export interface ProposalEvidence {
  websiteStatus: WebsiteStatus;
  /** True when a documented website check established the position. */
  websiteVerified: boolean;
  /** Needs recorded by the team that the plan quotes. */
  recordedNeeds: string[];
  reportId: string | null;
  reportVersion: number | null;
  reportConfidence: string | null;
  /** True when neither a website check nor a recorded need supports the scope yet. */
  guidanceOnly: boolean;
}

export interface ProposalPlan {
  track: TrackKey;
  template: ProposalTemplate;
  pkg: ServicePackage;
  /** The package the rules recommend; differs from pkg.key when a person chose another. */
  recommendedKey: string;
  /** Every reason behind the plan, for the team. */
  reasons: string[];
  /** The reasons worth telling the client (website position and recorded needs). */
  clientRationale: string[];
  /** What the plan rests on; empty of evidence means sector guidance only. */
  evidence: ProposalEvidence;
  /** Assumptions to print with the proposal, including any licence note for the activity. */
  assumptions: string[];
  addOns: PlannedAddOn[];
  /** Add-on names the package already delivers. */
  covered: string[];
  roadmap: string[];
  needs: DetectedNeed[];
  /** Recorded needs no template rule understood; listed for discovery. */
  unmatchedNeeds: string[];
  /** Template add-ons missing from the price list (skipped, never invented). */
  missingAddOns: string[];
}

const WEBSITE_REASON: Partial<Record<WebsiteStatus, string>> = {
  none_found: 'Documented checks did not find an official website, so the first step is an owned, mobile-first website.',
  unavailable: 'The website identified for the business did not respond, so the proposal provides a dependable replacement.',
  unhealthy: 'The current website has recorded technical issues, so the proposal rebuilds it on a maintained platform.',
  potential_official: 'A possible website was found but its ownership is unconfirmed; confirm it in discovery before relying on this scope.',
  verified_official: 'The business has a verified website, so the scope concentrates on the improvements the research identified.',
};

const quote = (s: string) => `“${s.length > 80 ? `${s.slice(0, 77)}…` : s}”`;

function pickPackage(
  business: Pick<Business, 'websiteStatus' | 'budgetSignal'>,
  template: ProposalTemplate,
  needs: DetectedNeed[],
  packages: ServicePackage[],
): { key: string; why: string | null; reasons: string[] } {
  const has = (k: NeedKey) => needs.find((n) => n.key === k);
  const exists = (k: string) => packages.some((p) => p.key === k);
  const reasons: string[] = [];
  const siteWorks = business.websiteStatus === 'verified_official';

  let key = template.basePackage;
  let why: string | null = null;
  // Only an explicitly recorded online-selling need may choose the ecommerce package. Sector alone
  // is never enough: a boutique that takes phone orders and deposits is not an online store.
  const ecommerce = has('ecommerce');
  const app = has('app');
  const automation = has('automation');
  const managed = has('content') ?? has('catalogue') ?? has('inventory') ?? has('booking') ?? has('quotes') ?? has('accounts');

  if (ecommerce && exists('ecommerce')) {
    key = 'ecommerce';
    why = `Recorded need ${quote(ecommerce.source)} calls for online selling with checkout.`;
  } else if (app && siteWorks && exists('mobile_app')) {
    key = 'mobile_app';
    why = `Recorded need ${quote(app.source)} asks for an app, and the business already has a verified website.`;
  } else if (automation && siteWorks && exists('automation')) {
    key = 'automation';
    why = `Recorded need ${quote(automation.source)} is about internal workflows, and the business already has a verified website.`;
  } else if (managed && (PACKAGE_TIER[key] ?? 0) < (PACKAGE_TIER.business_plus ?? 2) && exists('business_plus')) {
    key = 'business_plus';
    why = `Recorded need ${quote(managed.source)} needs content your team can manage and structured enquiries.`;
  }
  if (why) reasons.push(why);
  else if (needs.length) reasons.push(`The recorded needs fit the routine ${template.label.toLowerCase()} scope.`);
  else reasons.push(`No specific needs are recorded yet, so the routine ${template.label.toLowerCase()} scope is used and extras are offered as optional lines.`);

  if (app && key !== 'mobile_app') reasons.push(`An app was mentioned (${quote(app.source)}); a website comes first, so an app roadmap is offered rather than an app build.`);
  if (automation && key !== 'automation') reasons.push('Workflow automation was mentioned; it is listed for a later phase once the website is in place.');

  if (business.budgetSignal === 'limited' && (PACKAGE_TIER[key] ?? 0) > 1 && exists('starter_website')) {
    reasons.push('The budget is recorded as limited, so the smallest package is proposed and the rest is listed for later phases.');
    key = 'starter_website';
  }

  if (!exists(key)) {
    const fallback = exists(template.basePackage) ? template.basePackage : exists('starter_website') ? 'starter_website' : packages[0].key;
    reasons.push(`The ${key.replace(/_/g, ' ')} package is not in your packages, so ${packages.find((p) => p.key === fallback)!.name} is used instead.`);
    key = fallback;
  }

  // Packages already explained above (an app or automation mentioned) are left out of this line.
  const larger = packages
    .filter((p) => (PACKAGE_TIER[p.key] ?? 0) > (PACKAGE_TIER[key] ?? 99))
    .filter((p) => !(app && p.key === 'mobile_app') && !(automation && p.key === 'automation'))
    .map((p) => p.name);
  if (larger.length) reasons.push(`Larger packages (${larger.join(', ')}) are not proposed because no recorded need requires them.`);
  return { key, why, reasons };
}

/**
 * The deterministic plan for a proposal. `packageKey` is a person's choice; the recommendation and
 * its reasons are still reported so the difference is visible. Returns null without packages.
 */
export function planProposal(input: {
  business: Pick<Business, 'category' | 'websiteStatus' | 'budgetSignal' | 'serviceNeeds'>;
  settings: Pick<OrgSettings, 'packages' | 'addOns'>;
  packageKey?: string | null;
  /** The report the draft leans on, when one exists. */
  report?: Pick<OpportunityReport, 'id' | 'version' | 'content'> | null;
}): ProposalPlan | null {
  const { business, settings } = input;
  if (!settings.packages.length) return null;
  const track = trackForCategory(business.category);
  const template = PROPOSAL_TEMPLATES[track];
  const { needs, unmatched } = detectNeeds(business.serviceNeeds);
  const recommended = pickPackage(business, template, needs, settings.packages);
  const chosen = settings.packages.find((p) => p.key === input.packageKey) ?? settings.packages.find((p) => p.key === recommended.key)!;

  const websiteReason = WEBSITE_REASON[business.websiteStatus];
  const reasons = [...(websiteReason ? [websiteReason] : []), ...recommended.reasons];
  const stated = [...new Set(needs.map((n) => n.source))];
  const websiteVerified = ['none_found', 'unavailable', 'unhealthy', 'verified_official'].includes(business.websiteStatus);
  const guidanceOnly = !websiteVerified && stated.length === 0;
  const evidence: ProposalEvidence = {
    websiteStatus: business.websiteStatus,
    websiteVerified,
    recordedNeeds: stated,
    reportId: input.report?.id ?? null,
    reportVersion: input.report?.version ?? null,
    reportConfidence: input.report?.content.confidence.overall ?? null,
    guidanceOnly,
  };
  if (guidanceOnly) reasons.push('No website check or recorded need supports the scope yet; it is sector guidance to confirm in discovery.');
  const compliance = complianceForCategory(business.category);
  const assumptions = [...template.assumptions];
  if (guidanceOnly) assumptions.push('This scope is a starting point based on the sector. No website check or service need has been recorded yet, so priorities are confirmed in discovery.');
  if (compliance) assumptions.push(`This activity normally needs a licence from the ${compliance.regulator}. ${COMPLIANCE_ASSUMPTION}`);

  const clientRationale = [
    ...(websiteReason ? [websiteReason] : []),
    chosen.key === recommended.key && recommended.why
      ? recommended.why.replace(/^Recorded need/, 'Your stated need')
      : stated.length
        ? `It is built around the needs you described (${stated.map(quote).join(', ')}); anything not quoted now is listed for a later phase.`
        : 'No website check or service need is recorded yet, so this is a starting point based on the sector; we confirm your priorities in discovery before any work begins.',
  ];
  if (chosen.key !== recommended.key) {
    const rec = settings.packages.find((p) => p.key === recommended.key);
    reasons.unshift(`${chosen.name} was chosen by a person; the rules recommend ${rec?.name ?? recommended.key}.`);
  }

  const covers = new Set(PACKAGE_COVERS[chosen.key] ?? []);
  const priceList = new Map(settings.addOns.map((a) => [a.key, a]));
  const addOns: PlannedAddOn[] = [];
  const covered: string[] = [];
  const missing: string[] = [];
  const satisfied = new Set<NeedKey>();
  const take = (key: string, included: boolean, reason: string) => {
    const addOn = priceList.get(key);
    if (!addOn) {
      if (!missing.includes(key)) missing.push(key);
      return;
    }
    if (covers.has(key)) {
      if (!covered.includes(addOn.name)) covered.push(addOn.name);
      return;
    }
    const existing = addOns.find((a) => a.addOn.key === key);
    if (existing) {
      if (included && !existing.included) Object.assign(existing, { included, reason });
      return;
    }
    addOns.push({ addOn, included, reason });
  };

  for (const t of template.addOns) {
    const need = needs.find((n) => t.needs.includes(n.key));
    if (!need) continue;
    for (const n of needs) if (t.needs.includes(n.key)) satisfied.add(n.key);
    take(t.key, true, `Recorded need ${quote(need.source)}.`);
  }
  for (const need of needs) {
    const key = GENERIC_NEED_ADD_ONS[need.key];
    if (!satisfied.has(need.key) && key) take(key, true, `Recorded need ${quote(need.source)}.`);
  }
  if (needs.some((n) => n.key === 'app') && chosen.key !== 'mobile_app') take('app_roadmap', false, 'An app was mentioned; a roadmap is offered before any app build.');
  let offers = addOns.filter((a) => !a.included).length;
  for (const t of template.addOns) {
    if (offers >= MAX_OFFERS) break;
    if (!t.offer || addOns.some((a) => a.addOn.key === t.key) || covers.has(t.key)) continue;
    const before = addOns.length;
    take(t.key, false, `Common for ${template.label.toLowerCase()}; optional until the business confirms it needs it.`);
    if (addOns.length > before) offers++;
  }

  const roadmap = template.roadmap.filter((r) => !r.unless?.includes(chosen.key)).map((r) => r.text);
  if (needs.some((n) => n.key === 'automation') && chosen.key !== 'automation') roadmap.push('Workflow automation for the operations the team described');

  return {
    track,
    template,
    pkg: chosen,
    recommendedKey: recommended.key,
    reasons,
    clientRationale,
    evidence,
    assumptions,
    addOns,
    covered,
    roadmap,
    needs,
    unmatchedNeeds: unmatched,
    missingAddOns: missing,
  };
}

// ── Automatic drafting readiness ─────────────────────────────────────────────

/** Report next actions that mean the research does not yet support a proposal. */
export const PROPOSAL_BLOCKING_ACTIONS: readonly NextAction[] = ['request_verification', 'complete_research', 'review_manually', 'do_not_pursue'];
const OPEN_PROPOSAL: readonly ProposalStatus[] = ['draft', 'approved', 'sent', 'accepted'];

export interface DraftReadiness {
  ready: boolean;
  blockers: string[];
  /** True when every blocker is one a person's explicit request may override (never opt-outs or duplicates). */
  overridable: boolean;
}

export function proposalDraftReadiness(input: {
  business: Pick<Business, 'contactPermission' | 'businessStatus' | 'stage'>;
  report: Pick<OpportunityReport, 'createdAt' | 'version' | 'content'> | null;
  /** When the latest website verification was recorded. */
  latestCheckAt: string | null;
  /** This business's proposals. */
  proposals: Pick<Proposal, 'status'>[];
  suppressed: boolean;
  hasPackages: boolean;
}): DraftReadiness {
  const { business, report } = input;
  const hard: string[] = [];
  const soft: string[] = [];
  if (business.contactPermission === 'opted_out') hard.push('The business opted out.');
  if (input.suppressed) hard.push('The business is on the suppression list.');
  if (business.businessStatus === 'inactive') hard.push('The business appears inactive.');
  if (CLOSED_STAGES.includes(business.stage)) hard.push(`The prospect is ${business.stage}.`);
  if (!input.hasPackages) hard.push('No service packages are configured.');
  const open = input.proposals.find((p) => OPEN_PROPOSAL.includes(p.status));
  if (open) hard.push(`${open.status === 'accepted' || open.status === 'approved' ? 'An' : 'A'} ${open.status} proposal already exists for this business.`);
  if (!report) hard.push('There is no opportunity report yet.');
  else {
    if (input.latestCheckAt && report.createdAt < input.latestCheckAt) soft.push(`Report v${report.version} predates the latest website check.`);
    const level = report.content.confidence.overall;
    if (level === 'low' || level === 'unknown') soft.push(`Report v${report.version} has ${level} confidence.`);
    const action = report.content.nextAction.action;
    if (PROPOSAL_BLOCKING_ACTIONS.includes(action)) soft.push(`The report's next step is “${NEXT_ACTION_META[action].label.toLowerCase()}”, not a proposal.`);
  }
  const blockers = [...hard, ...soft];
  return { ready: blockers.length === 0, blockers, overridable: hard.length === 0 && soft.length > 0 };
}
