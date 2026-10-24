// Industry categories and the sector "tracks" that drive deterministic report and proposal
// content. Track content is general industry guidance — never a claim about a specific business.
//
// The catalogue itself lives in `industry-taxonomy.ts` (30 industry groups, 300+ categories, built
// for Ghana's 16 regions). This module keeps the historic public names — `DEFAULT_CATEGORIES`,
// `trackForCategory`, `searchTermForCategory`, `TRACKS` — so every consumer and every saved
// prospect keeps resolving to the same guidance it did before the expansion.

import {
  INDUSTRY_CATEGORIES,
  INDUSTRY_GROUPS,
  categoriesInGroup,
  findIndustryCategory,
  industryGroupByKey,
  industryGroupByLabel,
  industryGroupForCategory,
  type GroupKey,
  type TrackKey,
} from './industry-taxonomy';
import type { PlacesType } from './places-types';

export type { GroupKey, IndustryCategory, IndustryGroup, TrackKey } from './industry-taxonomy';
export { INDUSTRY_CATEGORIES, INDUSTRY_GROUPS, categoriesInGroup, findIndustryCategory, industryGroupByKey, industryGroupByLabel, industryGroupForCategory };

export interface CategoryDefinition {
  /** Stable slug of the label, for references that should not contain spaces. */
  id: string;
  label: string;
  searchTerm: string;
  track: TrackKey;
  /** Industry group key: drives grouped pickers and group-level campaign targeting. */
  group: GroupKey;
  /** Verified Google Places (New) Table A types; empty means the text query is the only search. */
  placesTypes: readonly PlacesType[];
  /** Extra local phrases a category search should match, e.g. "waakye" or "trotro". */
  aliases: readonly string[];
}

export const DEFAULT_CATEGORIES: CategoryDefinition[] = INDUSTRY_CATEGORIES.map(({ id, label, searchTerm, track, group, placesTypes, aliases }) => ({
  id,
  label,
  searchTerm,
  track,
  group,
  placesTypes,
  aliases,
}));

/**
 * The twenty categories the product shipped with. Their labels are part of the data contract:
 * `businesses.category` stores the label, so these strings must never be renamed.
 */
export const LEGACY_CATEGORY_LABELS = [
  'Fashion boutique',
  "Men's suit retailer",
  'Bridal shop',
  'Furniture showroom',
  'Beauty salon',
  'Spa',
  'Hotel',
  'Guesthouse',
  'Restaurant',
  'Bakery',
  'Auto dealership',
  'Event planning',
  'Photography studio',
  'Gym',
  'Training institution',
  'Professional services',
  'Clinic',
  'Hospital',
  'Herbal clinic',
  'Pharmacy',
] as const;

/**
 * Focus categories default to the original twenty. Widening a saved focus list automatically would
 * change every prospect's industry-fit score without anyone asking for it.
 */
export const DEFAULT_FOCUS_CATEGORIES: string[] = [...LEGACY_CATEGORY_LABELS];


const KEYWORDS: [RegExp, TrackKey][] = [
  [/brid|wedding gown/i, 'bridal'],
  [/furn|interior|decor/i, 'furniture'],
  [/fashion|boutique|suit|menswear|cloth|apparel|tailor/i, 'fashion'],
  [/beaut|salon|spa|barber|nail|cosmetic/i, 'beauty'],
  [/hotel|guest|lodge|hostel|resort|hospitality/i, 'hospitality'],
  [/restaurant|bakery|cafe|café|food|catering|bar\b|grill/i, 'food'],
  [/\bauto|\bcars?\b|motor|vehicle/i, 'auto'],
  [/event|planner/i, 'events'],
  [/photo|studio|video|creative/i, 'creative'],
  [/gym|fitness|yoga/i, 'fitness'],
  [/training|school|academy|institut|tutor/i, 'education'],
  [/law|account|consult|professional|agency/i, 'professional'],
  [/pharmac|chemist|chemical (shop|seller)|drug ?store/i, 'pharmacy'],
  [/herbal|clinic|hospital\b|medical|dental|maternity|diagnostic|laborator|health (centre|center|facility)/i, 'health'],
  // Added with the Ghana-wide expansion. These sit after the health rules on purpose: a "law clinic"
  // stays a professional service and "hospitality" stays hospitality.
  [/agri|farm|plantation|crop|maize|rice farm|cassava|yam farm|cocoa|oil palm|shea/i, 'agriculture'],
  [/livestock|poultry|hatchery|\bpig\b|goat|sheep|cattle|fisher|aquacultur|veterinar/i, 'livestock'],
  [/microfinance|susu|credit union|rural bank|savings and loans|insurance|forex|mobile money|payment service/i, 'finance'],
  [/software|ICT|IT support|information technology|cyber|data analytic|hosting|computer|drone|startup|tech hub/i, 'ict'],
  [/construct|civil engineer|\broad\b|mason|block mould|steel fabricat|aluminium|tiling|scaffold/i, 'construction'],
  [/real estate|property (developer|management|investment)|land sales|letting|estate survey|valuation/i, 'real_estate'],
  [/mining|quarry|gold buying|solar energy|generator|LPG|fuel station|petroleum|renewable energy|borehole/i, 'mining_energy'],
  [/manufactur|factory|printing press|packaging|processing plant|bottl|fabrication workshop/i, 'manufacturing'],
  [/transport|haulage|courier|freight|logistic|trotro|taxi|okada|warehous|storage|shipping|fleet/i, 'logistics'],
  [/retail|supermarket|mini-?mart|grocery|provision|\bshop\b|\bstore\b|\bmarket\b|trader|vendor|hawker/i, 'retail'],
  [/wholesal|distributor|import and export|commodity|bulk supplier/i, 'wholesale'],
  [/facilit|cleaning|security serv|pest control|fumigation|janitor|landscap|funeral|laundry|repair service|maintenance/i, 'facilities'],
  [/environment|water treatment|recycling|sanitation|pollution|afforest|green building/i, 'environment'],
  [/non-?profit|\bNGO\b|association|cooperative|charity|foundation|social enterprise|government|library|embassy|community centre/i, 'nonprofit'],
];

/**
 * The track for a stored category. A built-in category id or label wins; next a group label, which
 * is how a whole industry group is targeted; only then the keyword rules, which exist for
 * categories the team typed by hand.
 */
export function trackForCategory(category: string): TrackKey {
  const known = findIndustryCategory(category);
  if (known) return known.track;
  const group = industryGroupByLabel(category);
  if (group) return group.track;
  return KEYWORDS.find(([pattern]) => pattern.test(category))?.[1] ?? 'general';
}

/** The provider search phrase for a category, or the category itself when it is not built in. */
export function searchTermForCategory(category: string): string {
  const known = findIndustryCategory(category);
  if (known) return known.searchTerm;
  const group = industryGroupByLabel(category);
  if (group) return group.searchTerm;
  return category.toLowerCase();
}

/**
 * The first *reference* Google Places type for a category, when the taxonomy records one. This is
 * documentation, not a request filter: Discover only sends a type that `places-filters.ts` has
 * reviewed as safe, because a narrower type silently hides businesses the category covers.
 */
export function placesTypeForCategory(category: string): PlacesType | null {
  return findIndustryCategory(category)?.placesTypes[0] ?? null;
}

export function placesTypesForCategory(category: string): readonly PlacesType[] {
  return findIndustryCategory(category)?.placesTypes ?? [];
}

export interface CategoryGroup {
  key: string;
  label: string;
  description: string;
  /** Phrase used when the whole group is researched. */
  searchTerm: string;
  categories: string[];
}

/** Categories grouped for a picker. Workspace-specific categories appear in a final "Custom" group. */
export function groupCategoryLabels(extraLabels: readonly string[] = []): CategoryGroup[] {
  const known = new Set(DEFAULT_CATEGORIES.map((category) => category.label));
  const groups: CategoryGroup[] = INDUSTRY_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    description: group.description,
    searchTerm: group.searchTerm,
    categories: DEFAULT_CATEGORIES.filter((category) => category.group === group.key).map((category) => category.label),
  }));
  const extra = [...new Set(extraLabels.map((label) => label.trim()).filter((label) => label && !known.has(label)))];
  if (extra.length) {
    groups.push({ key: 'custom', label: 'Custom categories', description: 'Added by this workspace.', searchTerm: 'custom category', categories: extra });
  }
  return groups;
}


export interface TrackGuidance {
  customerJourney: string;
  opportunities: { title: string; description: string }[];
  primary: string[];
  secondary: string[];
  future: string[];
  archetype: string;
}

export const TRACKS: Record<TrackKey, TrackGuidance> = {
  fashion: {
    customerJourney: 'Shoppers typically want to browse collections and confirm availability or sizing before visiting or ordering.',
    opportunities: [
      { title: 'Browsable collections', description: 'An editorial catalogue lets customers explore styles before visiting the store.' },
      { title: 'Direct enquiries', description: 'Product-level WhatsApp or form enquiries can shorten the path from interest to sale.' },
      { title: 'Online ordering', description: 'Where stock is managed consistently, ecommerce can extend sales beyond walk-in hours.' },
    ],
    primary: ['Brand-led responsive website', 'Editorial collection pages', 'WhatsApp product enquiries'],
    secondary: ['Product catalogue with variants and stock levels', 'Secure online checkout after merchant onboarding', 'Order administration dashboard'],
    future: ['Customer retention journeys', 'Mobile shopping app feasibility study'],
    archetype: 'fashion-editorial',
  },
  bridal: {
    customerJourney: 'Brides and families research looks well ahead of the event and usually book fitting appointments.',
    opportunities: [
      { title: 'Lookbook showcase', description: 'A visual portfolio helps prospective clients shortlist styles before booking.' },
      { title: 'Appointment booking', description: 'Structured appointment requests reduce back-and-forth scheduling.' },
    ],
    primary: ['Editorial bridal lookbook', 'Appointment request workflow', 'Showroom location and directions'],
    secondary: ['Appointment calendar integration', 'Client enquiry pipeline', 'Rental or purchase catalogue'],
    future: ['Client relationship workflow', 'Mobile app feasibility study'],
    archetype: 'bridal-portfolio',
  },
  furniture: {
    customerJourney: 'Buyers compare pieces, dimensions and finishes, and often request quotes or delivery information.',
    opportunities: [
      { title: 'Online catalogue', description: 'Turning showroom stock into a browsable catalogue extends reach beyond the showroom.' },
      { title: 'Quote requests', description: 'A quote builder captures structured requirements for custom or bulk orders.' },
      { title: 'Inventory visibility', description: 'Linking listings to stock reduces enquiries about unavailable items.' },
    ],
    primary: ['Showroom-focused brand website', 'Furniture category catalogue', 'Quote request builder'],
    secondary: ['Inventory-managed product listings', 'Quote-to-order workflow', 'Delivery-area information'],
    future: ['Trade customer portal', 'Customer follow-up automation'],
    archetype: 'furniture-catalogue',
  },
  beauty: {
    customerJourney: 'Clients look for service menus, prices, portfolio work and easy ways to book.',
    opportunities: [
      { title: 'Online booking', description: 'Self-service booking can reduce missed calls and scheduling friction.' },
      { title: 'Service menu and portfolio', description: 'Clear services and examples of work help clients choose before booking.' },
    ],
    primary: ['Service menu and portfolio', 'Mobile-first branded website', 'Booking requests'],
    secondary: ['Scheduling integration with deposits', 'Staff and service management', 'Appointment reminders (with consent)'],
    future: ['Membership or loyalty workflow', 'Mobile app feasibility study'],
    archetype: 'beauty-booking',
  },
  hospitality: {
    customerJourney: 'Guests compare rooms, facilities, location and price, and increasingly expect to book directly.',
    opportunities: [
      { title: 'Direct booking', description: 'A direct booking path can complement third-party travel platforms.' },
      { title: 'Rich property presentation', description: 'Rooms, facilities and location content support informed booking decisions.' },
    ],
    primary: ['Editorial property website', 'Rooms and facilities showcase', 'Booking enquiries'],
    secondary: ['Booking engine integration', 'Availability management', 'Online payment support'],
    future: ['Returning-guest communications (with consent)', 'Direct-booking analytics'],
    archetype: 'hotel-reservation',
  },
  food: {
    customerJourney: 'Diners check menus, opening hours and location, and often want to order ahead or reserve.',
    opportunities: [
      { title: 'Menu and ordering', description: 'An up-to-date menu with ordering or reservation reduces phone handling.' },
      { title: 'Local discoverability', description: 'Structured location and opening-hours information supports local search.' },
    ],
    primary: ['Menu-led responsive website', 'Location, hours and contact', 'Reservation or order enquiries'],
    secondary: ['Online ordering with delivery or pickup', 'Payment integration', 'Order management dashboard'],
    future: ['Loyalty programme', 'Mobile ordering app feasibility study'],
    archetype: 'restaurant-ordering',
  },
  auto: {
    customerJourney: 'Buyers compare inventory, specifications and financing options before visiting a dealership.',
    opportunities: [
      { title: 'Inventory listings', description: 'Searchable vehicle listings help buyers shortlist before visiting.' },
      { title: 'Lead capture', description: 'Test-drive and enquiry forms create structured, trackable leads.' },
    ],
    primary: ['Dealership website', 'Vehicle inventory listings', 'Test-drive and enquiry forms'],
    secondary: ['Inventory management dashboard', 'CRM integration', 'Trade-in request workflow'],
    future: ['Financing calculator', 'Mobile app feasibility study'],
    archetype: 'auto-dealership',
  },
  events: {
    customerJourney: 'Clients look for past events, service packages and availability for their date.',
    opportunities: [
      { title: 'Portfolio of past events', description: 'Visual case studies help clients trust a planner with their event.' },
      { title: 'Structured enquiries', description: 'Capturing date, guest count and budget upfront speeds up quoting.' },
    ],
    primary: ['Portfolio website', 'Service packages', 'Event enquiry form'],
    secondary: ['Client enquiry pipeline', 'Vendor and booking coordination tools'],
    future: ['Client portal for event planning', 'Mobile app feasibility study'],
    archetype: 'corporate',
  },
  creative: {
    customerJourney: 'Clients choose studios based on portfolio quality, style and availability.',
    opportunities: [
      { title: 'Portfolio presentation', description: 'A curated, fast-loading portfolio showcases quality better than social feeds alone.' },
      { title: 'Session booking', description: 'Package selection and booking requests reduce manual coordination.' },
    ],
    primary: ['Portfolio website', 'Packages and pricing pages', 'Booking requests'],
    secondary: ['Client galleries', 'Booking and deposit integration'],
    future: ['Client proofing workflow'],
    archetype: 'corporate',
  },
  fitness: {
    customerJourney: 'Members compare facilities, class schedules and membership options.',
    opportunities: [
      { title: 'Class schedules and memberships', description: 'Published schedules and membership options support sign-ups.' },
      { title: 'Online sign-up', description: 'Membership sign-up and class booking can reduce front-desk workload.' },
    ],
    primary: ['Gym website', 'Class schedule', 'Membership enquiries'],
    secondary: ['Class booking', 'Membership payments', 'Member management dashboard'],
    future: ['Member app feasibility study'],
    archetype: 'beauty-booking',
  },
  education: {
    customerJourney: 'Prospective students research courses, schedules, fees and accreditation.',
    opportunities: [
      { title: 'Course catalogue', description: 'Structured course information supports enrolment decisions.' },
      { title: 'Online applications', description: 'Application forms create trackable admissions leads.' },
    ],
    primary: ['Institution website', 'Course catalogue', 'Application enquiry form'],
    secondary: ['Online applications and payments', 'Student management dashboard'],
    future: ['Learning portal feasibility study'],
    archetype: 'corporate',
  },
  professional: {
    customerJourney: 'Clients look for expertise, credibility and an easy way to request a consultation.',
    opportunities: [
      { title: 'Credibility and expertise', description: 'Service and team pages establish trust with prospective clients.' },
      { title: 'Consultation requests', description: 'Structured enquiry forms help qualify incoming work.' },
    ],
    primary: ['Corporate website', 'Service pages', 'Consultation request form'],
    secondary: ['CRM integration', 'Client portal'],
    future: ['Workflow automation'],
    archetype: 'corporate',
  },
  health: {
    customerJourney: 'Patients and caregivers look for the services offered, opening hours, location and how to reach the facility, often on a phone and sometimes urgently.',
    opportunities: [
      { title: 'Services, hours and directions', description: 'Current services, opening hours, emergency contacts and directions help people reach the right care quickly.' },
      { title: 'Appointment requests', description: 'A short request form or WhatsApp link can reduce phone queues while collecting only what is needed to arrange a visit.' },
    ],
    primary: ['Mobile-first facility website', 'Services, opening hours and directions', 'Appointment or enquiry requests'],
    secondary: ['Appointment scheduling', 'Doctor and staff profiles (with their consent)', 'Accepted insurance and payment options'],
    future: ['Appointment reminders for patients who opt in', 'Patient portal feasibility study, after a data protection review'],
    archetype: 'health-facility',
  },
  pharmacy: {
    customerJourney: 'Customers check whether a pharmacy is open, where it is and whether it has what they need, often at short notice.',
    opportunities: [
      { title: 'Product range online', description: 'Pages for the over-the-counter range and services let customers check what the pharmacy offers before they travel.' },
      { title: 'Opening hours and location', description: 'Current hours, including late or weekend opening, and directions help people reach the pharmacy when they need it.' },
      { title: 'Availability enquiries', description: 'A WhatsApp or form enquiry lets customers ask about a product before they travel.' },
    ],
    primary: ['Mobile-first pharmacy website', 'Opening hours, location and directions', 'WhatsApp availability enquiries'],
    secondary: ['Product range pages for over-the-counter items', 'Delivery enquiries', 'Accepted insurance and payment options'],
    future: ['Refill reminders for customers who opt in', 'Online ordering feasibility study, subject to the rules for selling medicines'],
    archetype: 'health-facility',
  },
  nonprofit: {
    customerJourney: 'Beneficiaries, donors and partners look for a clear mission, credible governance and an easy way to get involved or ask for help.',
    opportunities: [
      { title: 'Mission and programmes', description: 'Plain descriptions of programmes and reach help people decide whether to engage.' },
      { title: 'Volunteer, donate and referral paths', description: 'Separate, short forms keep each audience’s request out of a shared inbox.' },
    ],
    primary: ['Mission-led website', 'Programmes and impact pages', 'Volunteer, donate and referral forms'],
    secondary: ['Partner and funder reporting', 'Event registration', 'Newsletter with consent'],
    future: ['Beneficiary case management, after a data protection review'],
    archetype: 'nonprofit-mission',
  },
  environment: {
    customerJourney: 'Clients and regulators need evidence of method, permits and measurable outcomes rather than marketing claims.',
    opportunities: [
      { title: 'Method and permits', description: 'Published methods, permits and sampling practice make technical work credible.' },
      { title: 'Assessment requests', description: 'A structured request captures site details for a scoped proposal.' },
    ],
    primary: ['Technical services website', 'Methods, permits and coverage', 'Assessment request form'],
    secondary: ['Report delivery for clients', 'Monitoring schedules', 'Compliance document library'],
    future: ['Client portal for monitoring results'],
    archetype: 'environment-services',
  },
  facilities: {
    customerJourney: 'Facility managers and households compare responsiveness, vetting, insurance and clear scope before booking a service.',
    opportunities: [
      { title: 'Scope and standards', description: 'A clear service list with what is included prevents disputes about scope.' },
      { title: 'Service requests', description: 'Scheduled requests and callout forms make recurring work trackable.' },
    ],
    primary: ['Service company website', 'Services, coverage and standards', 'Service and callout requests'],
    secondary: ['Recurring schedules for clients', 'Staff vetting statements', 'Job completion records'],
    future: ['Client portal for schedules and reports'],
    archetype: 'facilities-services',
  },
  logistics: {
    customerJourney: 'Customers want a price, a collection time and a way to know where a consignment is.',
    opportunities: [
      { title: 'Routes and pricing', description: 'Coverage, vehicle types and indicative pricing remove the first round of calls.' },
      { title: 'Shipment enquiries', description: 'A tracking or enquiry form gives dispatch staff one queue instead of scattered chats.' },
    ],
    primary: ['Logistics company website', 'Coverage, fleet and services', 'Booking and tracking enquiries'],
    secondary: ['Consignment status updates', 'Proof-of-delivery records', 'Account billing for regular customers'],
    future: ['Customer tracking portal with driver updates'],
    archetype: 'logistics-tracking',
  },
  manufacturing: {
    customerJourney: 'Buyers ask what can be produced, at what volume, to which specification and how quickly it can be delivered.',
    opportunities: [
      { title: 'Product and capacity pages', description: 'Specifications, materials and production capacity answer the first trade questions.' },
      { title: 'Quote requests', description: 'A quote form with quantity, material and delivery date makes pricing repeatable.' },
    ],
    primary: ['Manufacturer website', 'Product and capacity pages', 'Request-for-quote form'],
    secondary: ['Order and production tracking for clients', 'Distributor enquiries', 'Quality and certification documents'],
    future: ['Customer order portal and reorder flow'],
    archetype: 'manufacturing-capability',
  },
  mining_energy: {
    customerJourney: 'Buyers and regulators look for licences, safety practice, capacity and evidence that work is done to standard.',
    opportunities: [
      { title: 'Licence and capability', description: 'Permits, equipment and capacity information establish whether a company can be engaged.' },
      { title: 'Service requests', description: 'A structured request for supply, servicing or a site visit replaces informal calls.' },
    ],
    primary: ['Industrial capability website', 'Licences, equipment and services', 'Supply and service requests'],
    secondary: ['Safety and environmental statements', 'Field service scheduling', 'Customer equipment records'],
    future: ['Customer portal for service history'],
    archetype: 'industrial-capability',
  },
  real_estate: {
    customerJourney: 'Buyers, tenants and landlords compare listings, verify documents and want a fast way to arrange a viewing.',
    opportunities: [
      { title: 'Verified listings', description: 'Listings with location, price and clear status save wasted viewings.' },
      { title: 'Viewing requests', description: 'Scheduled viewing requests with contact details replace fragmented chat threads.' },
    ],
    primary: ['Property listing website', 'Listings with location and price', 'Viewing and enquiry requests'],
    secondary: ['Landlord or tenant account area', 'Document checklists', 'Saved searches for buyers who opt in'],
    future: ['Virtual tours for selected properties'],
    archetype: 'property-listing',
  },
  construction: {
    customerJourney: 'Clients judge contractors on completed work, licences, safety record and whether the quote is itemised.',
    opportunities: [
      { title: 'Project evidence', description: 'Photographs of completed work, with permission, answer the “have you done this before?” question.' },
      { title: 'Quote requests', description: 'A structured brief — location, drawings, timeline — makes tendering and quoting faster.' },
    ],
    primary: ['Contractor portfolio website', 'Completed projects and trades', 'Site visit and quote requests'],
    secondary: ['Project progress updates for clients', 'Safety and compliance documents', 'Supplier and subcontractor coordination'],
    future: ['Client project portal with milestone updates'],
    archetype: 'construction-portfolio',
  },
  ict: {
    customerJourney: 'Buyers look for evidence of technical competence, relevant work and a clear way to discuss scope and support.',
    opportunities: [
      { title: 'Capability and proof', description: 'Case notes, technologies and team pages establish competence faster than a price list.' },
      { title: 'Scoping requests', description: 'A short discovery form captures the problem, budget band and timeline before a call.' },
    ],
    primary: ['Technical capability website', 'Service and case pages', 'Discovery request form'],
    secondary: ['Support desk integration', 'Client portal or documentation area', 'Status and uptime information'],
    future: ['Productised service packages with online payment'],
    archetype: 'ict-saas',
  },
  finance: {
    customerJourney: 'Customers weigh trust, licensing, clear terms and how quickly they can speak to a person about savings, credit or claims.',
    opportunities: [
      { title: 'Credibility and terms', description: 'Licence details, product terms and branch information answer the first questions people ask.' },
      { title: 'Application and appointment requests', description: 'Structured requests reduce queues and give staff a record to follow up.' },
    ],
    primary: ['Trust-led institution website', 'Product and terms pages', 'Application or appointment requests'],
    secondary: ['Branch and agent locator', 'Secure document upload after identity checks', 'Rate and fee disclosure'],
    future: ['Customer self-service portal, subject to a security review'],
    archetype: 'finance-services',
  },
  wholesale: {
    customerJourney: 'Trade buyers compare ranges, minimum quantities, credit terms and delivery schedules rather than browsing retail prices.',
    opportunities: [
      { title: 'Trade catalogue', description: 'A range list with pack sizes and minimum order quantities saves a phone call per buyer.' },
      { title: 'Account enquiries', description: 'A trade account request form captures business details for a credit and pricing decision.' },
    ],
    primary: ['B2B website', 'Trade catalogue with pack sizes', 'Account and quote requests'],
    secondary: ['Order history for approved accounts', 'Delivery scheduling', 'Price-list downloads for approved buyers'],
    future: ['Buyer self-service ordering portal'],
    archetype: 'wholesale-b2b',
  },
  retail: {
    customerJourney: 'Shoppers check whether an item is in stock, what it costs and whether they can collect or have it delivered.',
    opportunities: [
      { title: 'Browsable stock', description: 'A catalogue with categories and prices answers the questions that fill a shop’s phone.' },
      { title: 'Reserve or order', description: 'A WhatsApp or form order flow turns interest into a held item without a full ecommerce build.' },
    ],
    primary: ['Mobile-first shop website', 'Product catalogue with prices', 'WhatsApp or form orders'],
    secondary: ['Stock levels', 'Mobile Money checkout when stock control is reliable', 'Delivery or pickup options'],
    future: ['Loyalty and repeat-purchase reminders'],
    archetype: 'retail-storefront',
  },
  livestock: {
    customerJourney: 'Buyers and veterinary clients look for stock, breeds, feed, health services and delivery arrangements.',
    opportunities: [
      { title: 'Stock and service pages', description: 'Clear pages for what the farm or clinic supplies reduce speculative calls.' },
      { title: 'Order and visit requests', description: 'Structured requests for stock or a farm visit make scheduling and pricing easier.' },
    ],
    primary: ['Farm or clinic website', 'Stock, breeds and services', 'Order and visit enquiries'],
    secondary: ['Delivery and transport arrangements', 'Vaccination and health records for clients who opt in'],
    future: ['Buyer repeat-order reminders'],
    archetype: 'agro-catalogue',
  },
  agriculture: {
    customerJourney: 'Buyers — traders, processors and households — need to know what is in season, how much is available and whether the farm can deliver.',
    opportunities: [
      { title: 'Produce and seasonality', description: 'A simple produce page with seasonal availability reduces repeated phone questions.' },
      { title: 'Bulk enquiries', description: 'A structured enquiry form captures quantity, destination and timing for larger orders.' },
    ],
    primary: ['Farm profile website', 'Produce and seasonality pages', 'Bulk order and WhatsApp enquiries'],
    secondary: ['Delivery-area information', 'Buyer list and order tracking', 'Mobile Money payment requests'],
    future: ['Aggregator portal for outgrower schemes'],
    archetype: 'agro-catalogue',
  },
  general: {
    customerJourney: 'Customers typically look for what the business offers, where it is, and how to get in touch.',
    opportunities: [
      { title: 'Professional web presence', description: 'An owned website centralizes business information beyond social platforms.' },
      { title: 'Enquiry capture', description: 'Structured enquiries make follow-up easier to track.' },
    ],
    primary: ['Responsive business website', 'Services pages', 'Contact and location'],
    secondary: ['Content management', 'Enquiry management'],
    future: ['Business automation assessment'],
    archetype: 'corporate',
  },
};
