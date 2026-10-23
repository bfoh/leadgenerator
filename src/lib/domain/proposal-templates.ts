// Industry proposal templates and the deterministic plan behind a proposal draft: which package,
// which add-ons, and why. The plan follows the needs the team recorded and the verified website
// position, not the largest package, and every choice carries a reason a person can check. Prices
// never come from here: they come from the agency's packages and add-on price list.

import { trackForCategory, type TrackKey } from './categories';
import { CLOSED_STAGES, type ProposalStatus, type WebsiteStatus } from './constants';
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
  track: TrackKey,
  template: ProposalTemplate,
  needs: DetectedNeed[],
  packages: ServicePackage[],
): { key: string; why: string | null; reasons: string[] } {
  const has = (k: NeedKey) => needs.find((n) => n.key === k);
  const exists = (k: string) => packages.some((p) => p.key === k);
  const reasons: string[] = [];
  const siteWorks = business.websiteStatus === 'verified_official';
  const commerce = ['fashion', 'furniture', 'food', 'bridal', 'auto'].includes(track);

  let key = template.basePackage;
  let why: string | null = null;
  const ecommerce = has('ecommerce') ?? (commerce && has('ordering') && has('payments') ? has('ordering') : undefined);
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
}): ProposalPlan | null {
  const { business, settings } = input;
  if (!settings.packages.length) return null;
  const track = trackForCategory(business.category);
  const template = PROPOSAL_TEMPLATES[track];
  const { needs, unmatched } = detectNeeds(business.serviceNeeds);
  const recommended = pickPackage(business, track, template, needs, settings.packages);
  const chosen = settings.packages.find((p) => p.key === input.packageKey) ?? settings.packages.find((p) => p.key === recommended.key)!;

  const websiteReason = WEBSITE_REASON[business.websiteStatus];
  const reasons = [...(websiteReason ? [websiteReason] : []), ...recommended.reasons];
  const stated = [...new Set(needs.map((n) => n.source))];
  const clientRationale = [
    ...(websiteReason ? [websiteReason] : []),
    chosen.key === recommended.key && recommended.why
      ? recommended.why.replace(/^Recorded need/, 'Your stated need')
      : stated.length
        ? `It is built around the needs you described (${stated.map(quote).join(', ')}); anything not quoted now is listed for a later phase.`
        : `The scope follows what ${template.label.toLowerCase()} businesses usually need first; optional items can be added after we confirm your priorities.`,
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
