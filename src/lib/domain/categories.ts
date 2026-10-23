// Industry categories and the sector "tracks" that drive deterministic report and proposal
// content. Track content is general industry guidance — never a claim about a specific business.

export type TrackKey =
  | 'fashion'
  | 'bridal'
  | 'furniture'
  | 'beauty'
  | 'hospitality'
  | 'food'
  | 'auto'
  | 'events'
  | 'creative'
  | 'fitness'
  | 'education'
  | 'professional'
  | 'health'
  | 'pharmacy'
  | 'general';

export interface CategoryDefinition {
  label: string;
  searchTerm: string;
  track: TrackKey;
}

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  { label: 'Fashion boutique', searchTerm: 'fashion boutique', track: 'fashion' },
  { label: "Men's suit retailer", searchTerm: "men's suit shop", track: 'fashion' },
  { label: 'Bridal shop', searchTerm: 'bridal shop', track: 'bridal' },
  { label: 'Furniture showroom', searchTerm: 'furniture store', track: 'furniture' },
  { label: 'Beauty salon', searchTerm: 'beauty salon', track: 'beauty' },
  { label: 'Spa', searchTerm: 'spa', track: 'beauty' },
  { label: 'Hotel', searchTerm: 'hotel', track: 'hospitality' },
  { label: 'Guesthouse', searchTerm: 'guest house', track: 'hospitality' },
  { label: 'Restaurant', searchTerm: 'restaurant', track: 'food' },
  { label: 'Bakery', searchTerm: 'bakery', track: 'food' },
  { label: 'Auto dealership', searchTerm: 'car dealership', track: 'auto' },
  { label: 'Event planning', searchTerm: 'event planner', track: 'events' },
  { label: 'Photography studio', searchTerm: 'photography studio', track: 'creative' },
  { label: 'Gym', searchTerm: 'gym', track: 'fitness' },
  { label: 'Training institution', searchTerm: 'training institute', track: 'education' },
  { label: 'Professional services', searchTerm: 'consulting firm', track: 'professional' },
  { label: 'Clinic', searchTerm: 'medical clinic', track: 'health' },
  { label: 'Hospital', searchTerm: 'hospital', track: 'health' },
  { label: 'Herbal clinic', searchTerm: 'herbal clinic', track: 'health' },
  { label: 'Pharmacy', searchTerm: 'pharmacy', track: 'pharmacy' },
];

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
];

export function trackForCategory(category: string): TrackKey {
  const exact = DEFAULT_CATEGORIES.find((c) => c.label.toLowerCase() === category.trim().toLowerCase());
  if (exact) return exact.track;
  return KEYWORDS.find(([pattern]) => pattern.test(category))?.[1] ?? 'general';
}

export function searchTermForCategory(category: string): string {
  return DEFAULT_CATEGORIES.find((c) => c.label === category)?.searchTerm ?? category.toLowerCase();
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
