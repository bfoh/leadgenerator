import { beforeEach, describe, expect, it } from 'vitest';
import { agentStore } from '@/lib/automation/agent-store';
import { proposalGenerationAgent } from '@/lib/automation/agents/proposals';
import type { ToolGateway } from '@/lib/automation/agents/types';
import { processQueue, queueAgent, type EngineContext } from '@/lib/automation/engine';
import { LocalAutomationStore } from '@/lib/automation/local-store';
import { workflowStateOf } from '@/lib/automation/workflow';
import { LocalStore, MemoryStorage } from '@/lib/data/local-store';
import { collectEvidence, writeRuleBasedReport } from '@/lib/data/report-services';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { ARCHETYPES } from '@/lib/domain/archetypes';
import { DEFAULT_CATEGORIES, TRACKS, trackForCategory } from '@/lib/domain/categories';
import { DEFAULT_ADD_ONS, DEFAULT_PACKAGES, PACKAGE_TIER } from '@/lib/domain/packages';
import { addDays, approvalIssues, computeTotals, isExpired, proposalContentSchema, proposalFromPackage, proposalToMarkdown } from '@/lib/domain/proposal';
import { PROPOSAL_TEMPLATES, detectNeeds, planProposal, proposalDraftReadiness } from '@/lib/domain/proposal-templates';
import { generateDeterministicReport, validateReport, type ReportContent } from '@/lib/domain/report';
import type { BusinessForm, PermissionForm, VerificationForm } from '@/lib/domain/schemas';
import { DEFAULT_SETTINGS, orgSettingsSchema, resolveSettings, type OrgSettings } from '@/lib/domain/settings';
import type { Business } from '@/lib/domain/types';

// Phase 6: industry templates, the controlled price list, automatic drafting, expiry and client
// responses. Deterministic throughout: no provider is called and nothing is paid for.

type PlanBusiness = Pick<Business, 'category' | 'websiteStatus' | 'budgetSignal' | 'serviceNeeds'>;
const biz = (overrides: Partial<PlanBusiness> = {}): PlanBusiness => ({ category: 'Fashion boutique', websiteStatus: 'none_found', budgetSignal: 'unknown', serviceNeeds: [], ...overrides });
const settings = (): OrgSettings => structuredClone(DEFAULT_SETTINGS);
const plan = (overrides: Partial<PlanBusiness> = {}, s = settings(), packageKey?: string) => planProposal({ business: biz(overrides), settings: s, packageKey })!;

describe('recorded needs', () => {
  it('reads needs only from what the team recorded, without false matches', () => {
    expect(detectNeeds(['Online catalogue']).needs.map((n) => n.key)).toEqual(['catalogue']);
    expect(detectNeeds(['Bridal lookbook']).needs.map((n) => n.key)).toEqual(['catalogue']);
    expect(detectNeeds(['Book appointments online']).needs.map((n) => n.key)).toEqual(['booking']);
    expect(detectNeeds(['Mobile Money payments', 'Sell online']).needs.map((n) => n.key)).toEqual(['payments', 'ecommerce']);
    expect(detectNeeds(['Facebook page upkeep', ' ']).needs).toEqual([]);
    expect(detectNeeds(['Facebook page upkeep']).unmatched).toEqual(['Facebook page upkeep']);
  });
});

describe('industry templates and package choice', () => {
  it('covers every sector track, and every template add-on and package exists in the defaults', () => {
    const tracks = new Set(DEFAULT_CATEGORIES.map((c) => c.track));
    for (const t of tracks) expect(PROPOSAL_TEMPLATES[t]).toBeDefined();
    const addOnKeys = new Set(DEFAULT_ADD_ONS.map((a) => a.key));
    const packageKeys = new Set(DEFAULT_PACKAGES.map((p) => p.key));
    for (const t of Object.values(PROPOSAL_TEMPLATES)) {
      expect(packageKeys.has(t.basePackage)).toBe(true);
      for (const a of t.addOns) expect(addOnKeys.has(a.key), `${t.track}: ${a.key}`).toBe(true);
    }
    expect(DEFAULT_ADD_ONS.every((a) => a.unitPrice === null)).toBe(true);
  });

  it('files health businesses under health or pharmacy, and every sector has a library archetype', () => {
    expect(['Clinic', 'Hospital', 'Herbal clinic', 'Pharmacy'].map(trackForCategory)).toEqual(['health', 'health', 'health', 'pharmacy']);
    // Typed categories: health words, without catching care, hospitality or a law clinic.
    expect(['Eye care clinic', 'Maternity home', 'Licensed chemical seller', 'Hospitality', 'Law clinic', 'Car dealership', 'Carpentry'].map(trackForCategory)).toEqual([
      'health',
      'health',
      'pharmacy',
      'hospitality',
      'professional',
      'auto',
      'general',
    ]);
    const archetypes = new Set(ARCHETYPES.map((a) => a.key));
    for (const [track, guidance] of Object.entries(TRACKS)) expect(archetypes.has(guidance.archetype), track).toBe(true);
    expect(PROPOSAL_TEMPLATES.pharmacy.assumptions).toContain('Prescription-only medicines are not sold or advertised through the website.');
  });

  it('includes the brief’s industry recommendations', () => {
    expect(PROPOSAL_TEMPLATES.fashion.recommendations.join(' ')).toMatch(/Collections.*Product management.*WhatsApp.*Mobile Money.*Inventory.*ecommerce.*app roadmap/i);
    expect(PROPOSAL_TEMPLATES.furniture.recommendations).toEqual(['Product catalogue', 'Quote requests', 'Product dimensions and finishes', 'Inventory', 'Delivery enquiries', 'Order management']);
    expect(PROPOSAL_TEMPLATES.beauty.recommendations).toEqual(['Service catalogue', 'Booking calendar', 'Availability', 'Client accounts', 'Payment integration', 'Reminder system']);
    expect(PROPOSAL_TEMPLATES.hospitality.recommendations).toEqual(['Room catalogue', 'Booking engine', 'Availability', 'Payments', 'Guest communications']);
    expect(PROPOSAL_TEMPLATES.food.recommendations).toEqual(['Digital menu', 'Online ordering', 'Reservation requests', 'Customer enquiries']);
  });

  it('never defaults to the largest package: without recorded needs every sector gets a website package', () => {
    for (const c of DEFAULT_CATEGORIES) {
      const p = plan({ category: c.label });
      expect(PACKAGE_TIER[p.pkg.key], c.label).toBeLessThanOrEqual(2);
      expect(p.reasons.join(' ')).toMatch(/No specific needs are recorded/);
    }
    expect(plan().reasons).toContain('Larger packages (Ecommerce Platform, Business Automation, Mobile Application) are not proposed because no recorded need requires them.');
  });

  it('moves up only when a recorded need asks for it, and says which need', () => {
    const store = plan({ serviceNeeds: ['Sell online with Mobile Money checkout'] });
    expect(store.pkg.key).toBe('ecommerce');
    expect(store.reasons.join(' ')).toContain('Recorded need “Sell online with Mobile Money checkout” calls for online selling with checkout.');
    expect(store.covered).toEqual(expect.arrayContaining(['Mobile Money checkout']));
    expect(store.roadmap.some((r) => /online store/i.test(r))).toBe(false);

    const salon = plan({ category: 'Beauty salon', serviceNeeds: ['Online booking with deposits'] });
    expect(salon.pkg.key).toBe('business_plus');
    expect(salon.addOns.filter((a) => a.included).map((a) => a.addOn.key)).toEqual(['booking_calendar', 'payments']);

    const restaurant = plan({ category: 'Restaurant', serviceNeeds: ['Online ordering and delivery'] });
    expect(restaurant.pkg.key).toBe('starter_website');
    expect(restaurant.addOns.filter((a) => a.included).map((a) => a.addOn.key)).toEqual(['online_ordering', 'delivery_enquiries']);
    expect(restaurant.addOns.filter((a) => !a.included).map((a) => a.addOn.key)).toEqual(['digital_menu', 'reservations']);
  });

  it('keeps an app or automation for later until the business has a working website', () => {
    const p = plan({ serviceNeeds: ['Mobile app for customers'] });
    expect(p.pkg.key).toBe('business_plus');
    expect(p.reasons.join(' ')).toMatch(/a website comes first, so an app roadmap is offered/);
    expect(p.addOns.find((a) => a.addOn.key === 'app_roadmap')).toMatchObject({ included: false });
    expect(plan({ serviceNeeds: ['Mobile app for customers'], websiteStatus: 'verified_official' }).pkg.key).toBe('mobile_app');
    const ops = plan({ category: 'Professional services', serviceNeeds: ['CRM dashboard'] });
    expect(ops.pkg.key).toBe('starter_website');
    expect(ops.roadmap).toContain('Workflow automation for the operations the team described');
  });

  it('proposes the smallest package when the budget is recorded as limited', () => {
    const p = plan({ serviceNeeds: ['Sell online'], budgetSignal: 'limited' });
    expect(p.pkg.key).toBe('starter_website');
    expect(p.reasons.join(' ')).toMatch(/budget is recorded as limited/);
    expect(p.roadmap.some((r) => /online store/i.test(r))).toBe(true);
  });

  it('caps optional offers, skips what the package covers, and never invents a missing add-on', () => {
    const furniture = plan({ category: 'Furniture showroom' });
    expect(furniture.addOns.filter((a) => !a.included).map((a) => a.addOn.key)).toEqual(['product_catalogue', 'quote_requests', 'product_details']);
    const s = settings();
    s.addOns = s.addOns.filter((a) => a.key !== 'quote_requests');
    const trimmed = plan({ category: 'Furniture showroom', serviceNeeds: ['Quotation requests'] }, s);
    expect(trimmed.missingAddOns).toEqual(['quote_requests']);
    expect(trimmed.addOns.some((a) => a.addOn.key === 'quote_requests')).toBe(false);
    expect(plan({ serviceNeeds: ['Collection pages'] }).covered).toEqual(['Collection pages']);
  });

  it('shows a person’s package choice next to the recommendation', () => {
    const p = plan({}, settings(), 'mobile_app');
    expect(p.pkg.key).toBe('mobile_app');
    expect(p.recommendedKey).toBe('business_plus');
    expect(p.reasons[0]).toBe('Mobile Application was chosen by a person; the rules recommend Business Website Plus.');
    expect(planProposal({ business: biz(), settings: { ...settings(), packages: [] } })).toBeNull();
  });
});

describe('drafting from a plan', () => {
  const report = (): ReportContent => {
    const draft = generateDeterministicReport({
      business: { id: 'b1', name: 'Kente Couture', category: 'Fashion boutique', city: 'Accra', neighborhood: 'Osu', region: 'Greater Accra', country: 'GH', websiteStatus: 'none_found', officialWebsite: null },
      items: [{ id: 'E1', kind: 'verification', statement: 'Website verification on 2026-10-20: outcome "No official website found".', source: null, recordedAt: '2026-10-20T00:00:00Z', userSupplied: true }],
      unknowns: [],
      generatedAt: '2026-10-23T00:00:00Z',
    } as never);
    const content = validateReport(draft, { business: { id: 'b1', name: 'Kente Couture', category: 'Fashion boutique', websiteStatus: 'none_found' }, items: [{ id: 'E1' }], unknowns: [] } as never).content;
    content.websiteFindings.statements.push(
      { kind: 'verified_fact', text: 'Digital audit — verified issue (Security, high, confidence 90/100): The site is not served over HTTPS. Observed: http only.', evidenceIds: ['E1'] },
      { kind: 'verified_fact', text: 'Website verification on 2026-10-20: outcome "No official website found". Evidence summary: «owner said call me on 024»', evidenceIds: ['E1'] },
    );
    content.limitations.push({ item: 'No business contact detail is recorded from a permitted source.', howToConfirm: '' }, { item: 'Budget and decision-making process.', howToConfirm: '' });
    return content;
  };

  it('takes every price from the configured packages and price list, and nothing else', () => {
    const s = settings();
    s.agency.name = 'Matrix Multitech';
    s.packages = s.packages.map((p) => (p.key === 'business_plus' ? { ...p, lineItems: p.lineItems.map((l, i) => ({ ...l, defaultUnitPrice: i === 0 ? 12000 : null })) } : p));
    s.addOns = s.addOns.map((a) => (a.key === 'momo_checkout' ? { ...a, unitPrice: 2500 } : a));
    const p = plan({ serviceNeeds: ['Mobile Money payments'] }, s);
    const content = proposalFromPackage({ pkg: p.pkg, businessName: 'Kente Couture', settings: s, plan: p, today: '2026-10-23' });
    const configured = new Set([...s.packages.flatMap((pk) => pk.lineItems.map((l) => l.defaultUnitPrice)), ...s.addOns.map((a) => a.unitPrice)]);
    expect(content.lineItems.every((l) => configured.has(l.unitPrice))).toBe(true);
    expect(content.lineItems.find((l) => l.description === 'Mobile Money checkout')).toMatchObject({ kind: 'one_time', unitPrice: 2500 });
    expect(computeTotals(content).oneTimeSubtotal).toBe(14500);
    // Optional offers stay out of the totals and do not block approval; unpriced required lines do.
    expect(content.lineItems.filter((l) => l.kind === 'optional').map((l) => l.description)).toEqual(['Additional business integration', 'Product-level WhatsApp enquiries', 'Mobile app roadmap']);
    expect(approvalIssues(content)).toEqual(['Price 3 required line item(s) or mark them optional.']);
    expect(proposalContentSchema.safeParse(content).success).toBe(true);
  });

  it('writes an evidence-based problem statement without internal research records', () => {
    const p = plan();
    const content = proposalFromPackage({ pkg: p.pkg, businessName: 'Kente Couture', settings: settings(), report: report(), plan: p, today: '2026-10-23' });
    expect(content.currentSituation).toContain('Documented checks did not find an official website for Kente Couture. This is not proof that none exists.');
    expect(content.currentSituation).toContain('Verified issue: The site is not served over HTTPS.');
    expect(content.currentSituation).not.toMatch(/Website verification on|Evidence summary|024/);
    expect(content.assumptions).toContain('To confirm in discovery: Budget and decision-making process.');
    expect(content.assumptions.join(' ')).not.toMatch(/contact detail|permitted source/);
    expect(content.recommendedSolution).toMatch(/^We recommend the Business Website Plus\./);
    expect(content.recommendedSolution).toContain('For a later phase (not quoted here):');
    expect(content.exclusions).toContain('Product photography and styling unless quoted');
  });

  it('builds the timeline only from configured phase durations', () => {
    const p = plan();
    const untimed = proposalFromPackage({ pkg: p.pkg, businessName: 'X', settings: settings(), plan: p, today: '2026-10-23' });
    expect(untimed.timeline).not.toMatch(/\d/);
    const timedPkg = { ...p.pkg, phases: p.pkg.phases.map((ph, i) => ({ ...ph, duration: `${i + 1} week${i ? 's' : ''}` })) };
    const timed = proposalFromPackage({ pkg: timedPkg, businessName: 'X', settings: settings(), plan: { ...p, pkg: timedPkg }, today: '2026-10-23' });
    expect(timed.timeline).toMatch(/^Indicative timeline: Discovery — 1 week; Design — 2 weeks; Build — 3 weeks; Launch — 4 weeks\./);
  });

  it('keeps the plan’s reasons as internal provenance, out of the client document', () => {
    const p = plan();
    const content = proposalFromPackage({
      pkg: p.pkg,
      businessName: 'Kente Couture',
      settings: settings(),
      plan: p,
      today: '2026-10-23',
      provenance: { source: 'agent', generator: 'proposal-1.0.0', reportId: null, reportVersion: null, preparedAt: '2026-10-23T10:00:00Z' },
    });
    expect(content.basis).toMatchObject({ source: 'agent', generator: 'proposal-1.0.0', template: 'Fashion retail', packageKey: 'business_plus' });
    const md = proposalToMarkdown('T', 'approved', content);
    expect(md).not.toMatch(/Larger packages|rules recommend|proposal-1\.0\.0/);
  });

  it('flags expired and inconsistent validity dates', () => {
    const p = plan();
    const content = proposalFromPackage({ pkg: p.pkg, businessName: 'X', settings: settings(), plan: p, today: '2026-10-01' });
    expect(content.validUntil).toBe(addDays('2026-10-01', 30));
    expect(isExpired(content, '2026-10-31')).toBe(false);
    expect(isExpired(content, '2026-11-01')).toBe(true);
    expect(approvalIssues(content, '2026-11-01')).toContain('The validity date has passed; set a new “Valid until” date.');
    expect(approvalIssues({ ...content, validUntil: '2026-09-30' })).toContain('The validity date is before the proposal date.');
  });

  it('accepts settings saved before add-ons and branding existed', () => {
    const legacy = { agency: { name: 'Studio', email: '', phone: '', website: '', address: '', defaultTerms: '' }, packages: DEFAULT_PACKAGES };
    const resolved = resolveSettings(legacy);
    expect(resolved.agency).toMatchObject({ name: 'Studio', accentColor: '', logoDataUrl: '' });
    expect(resolved.addOns).toEqual(DEFAULT_ADD_ONS);
    expect(orgSettingsSchema.shape.agency.safeParse({ ...resolved.agency, logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }).success).toBe(false);
    expect(orgSettingsSchema.shape.agency.safeParse({ ...resolved.agency, accentColor: 'red' }).success).toBe(false);
  });
});

// ── Services and the agent ───────────────────────────────────────────────────

const form = (overrides: Partial<BusinessForm> = {}): BusinessForm => ({
  name: 'Kente Couture',
  category: 'Fashion boutique',
  country: 'GH',
  region: 'Greater Accra',
  districtCode: null,
  city: 'Accra',
  neighborhood: 'Osu',
  address: null,
  businessStatus: 'active',
  officialWebsite: null,
  socialProfiles: [{ platform: 'instagram', url: 'https://instagram.com/kentecouture' }],
  enquiryChannel: 'Instagram direct messages',
  phone: null,
  email: null,
  contactSource: null,
  interestLevel: 'unknown',
  budgetSignal: 'unknown',
  serviceNeeds: ['Collection pages'],
  estimatedValue: null,
  expectedCloseDate: null,
  nextAction: null,
  nextActionDue: null,
  notes: '',
  sourceUrl: 'https://example.org/directory/kente',
  sourceKind: 'directory',
  placesPlaceId: null,
  ...overrides,
});

const noneFound: VerificationForm = {
  status: 'none_found',
  methods: ['exact_name_search', 'name_variation_search', 'domain_probe', 'social_profile_review'],
  domain: null,
  sourceUrl: null,
  evidenceSummary: 'Exact-name and variation searches, candidate domains and the Instagram profile found no official site.',
  confidence: 'high',
  websiteOutdated: false,
  nextCheckAt: null,
};

const permission: PermissionForm = { contactPermission: 'granted', lawfulBasis: 'consent', permissionEvidence: 'Owner asked for a proposal by email on 2026-10-20.' };

let storage: MemoryStorage;
let now: Date;
let ctx: ServiceContext;
let automation: LocalAutomationStore;

beforeEach(() => {
  storage = new MemoryStorage();
  now = new Date('2026-10-23T10:00:00Z');
  ctx = { store: new LocalStore(storage), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user' };
  ctx.settings.agency.name = 'Matrix Multitech';
  automation = new LocalAutomationStore(storage, { clock: () => now });
});

const tools: ToolGateway = {
  aiConfigured: false,
  aiModel: null,
  async aiReport() {
    throw new Error('not in this test');
  },
  research: { available: false, simulated: false, search: { configured: false, provider: null, costPerQueryUsd: 0 } },
  async webSearch() {
    throw new Error('not in this test');
  },
  async probeDomains() {
    return [];
  },
  async inspectWebsite() {
    throw new Error('not in this test');
  },
  contacts: { available: false, simulated: false },
  async readContactPage() {
    throw new Error('not in this test');
  },
  async lookupMx() {
    return [];
  },
};
const engine = (): EngineContext => ({ automation, svc: ctx, tools, workerId: 'test', clock: () => now, random: () => 1 });

/** A verified prospect whose owner asked for a proposal, so the report recommends one. */
async function readyProspect(overrides: Partial<BusinessForm> = {}) {
  let b = await svc.createBusiness(ctx, form(overrides));
  b = (await svc.recordVerification(ctx, b, noneFound)).business;
  b = await svc.recordPermission(ctx, b, permission);
  return b;
}

describe('proposal lifecycle services', () => {
  it('blocks issuing an expired proposal and records the client’s response', async () => {
    const b = await readyProspect();
    const pkg = ctx.settings.packages.find((p) => p.key === 'starter_website')!;
    let proposal = await svc.createProposal(ctx, b, pkg, null);
    expect(proposal.content.basis).toMatchObject({ source: 'person', recommendedPackageKey: 'business_plus', packageKey: 'starter_website' });
    proposal = await svc.saveProposalContent(ctx, proposal, { ...proposal.content, lineItems: proposal.content.lineItems.map((l) => ({ ...l, unitPrice: 100 })) }, proposal.title);
    proposal = await svc.transitionProposal(ctx, proposal, b, 'approved');
    await expect(svc.recordProposalResponse(ctx, proposal, b, 'Looks good')).rejects.toThrow(/once a proposal has been sent/);

    // Past its validity date it cannot be issued; it has to be revised and approved again.
    const expired = { ...proposal, content: { ...proposal.content, validUntil: '2026-10-22' } };
    await expect(svc.transitionProposal(ctx, expired, b, 'sent')).rejects.toThrow(/expired on 2026-10-22/);

    proposal = await svc.transitionProposal(ctx, proposal, b, 'sent');
    await svc.recordProposalResponse(ctx, proposal, b, 'Asked whether hosting can be paid quarterly.');
    proposal = await svc.transitionProposal(ctx, proposal, b, 'accepted', { response: 'Accepted on a call; deposit next week.' });
    const responses = (await ctx.store.listActivities(b.id)).filter((a) => a.details?.proposalId === proposal.id && a.details?.response);
    expect(responses.map((a) => a.details!.response)).toEqual(expect.arrayContaining(['Asked whether hosting can be paid quarterly.', 'Accepted on a call; deposit next week.']));
    expect(proposal.decidedAt).not.toBeNull();
    const versions = await ctx.store.listProposalVersions(proposal.id);
    expect(versions.map((v) => v.status)).toEqual(expect.arrayContaining(['draft', 'approved', 'sent', 'accepted']));
  });

  it('lets agents create drafts only', async () => {
    const b = await readyProspect();
    const store = agentStore(ctx.store);
    const pkg = ctx.settings.packages[0];
    const draft = await svc.createProposal({ ...ctx, store }, b, pkg, null, { source: 'agent', generator: 'proposal-1.0.0' });
    await expect(store.updateProposal(draft.id, { status: 'approved' })).rejects.toThrow(/may not approve, issue or decide/);
    await expect(store.updateProposal(draft.id, { sentAt: now.toISOString() })).rejects.toThrow(/may not approve/);
    await expect(store.createProposal({ ...draft, status: 'sent' })).rejects.toThrow(/only create draft proposals/);
    await expect(store.updateProposal(draft.id, { title: 'Renamed draft' })).resolves.toMatchObject({ status: 'draft' });
  });
});

describe('the Proposal Generation agent', () => {
  it('drafts automatically after a supporting report in Research + proposals mode, once', async () => {
    await automation.updateSettings({ mode: 'research_and_proposals' });
    const b = await readyProspect();
    const pack = await collectEvidence(ctx, b, now);
    expect(pack.signals?.scoreConfidence ?? 0).toBeGreaterThanOrEqual(50);

    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_report', businessId: b.id, payload: { generator: 'rule_based' } });
    const run = await processQueue(engine(), { maxJobs: 5 });
    expect(run.outcomes.map((o) => [o.agent, o.outcome])).toEqual([
      ['opportunity_report', 'succeeded'],
      ['proposal_generation', 'succeeded'],
    ]);
    const [proposal] = (await ctx.store.listProposals()).filter((p) => p.businessId === b.id);
    expect(proposal).toMatchObject({ status: 'draft', packageKey: 'business_plus', approvedAt: null, sentAt: null });
    expect(proposal.content.basis).toMatchObject({ source: 'agent', generator: 'proposal-1.0.0', template: 'Fashion retail', reportVersion: 1 });
    expect(proposal.content.preparedBy).toBe('Matrix Multitech');
    expect(workflowStateOf((await ctx.store.getBusiness(b.id))!)).toBe('proposal_draft');
    const runs = async () => (await automation.listRuns({ businessId: b.id })).filter((r) => r.agent === 'proposal_generation');
    const [genRun] = await runs();
    expect(genRun.summary).toMatch(/A person must review and approve it before it is issued\.$/);
    expect(genRun.estimatedCostUsd ?? 0).toBe(0);

    // A second request does not create a duplicate.
    await queueAgent(engine(), await automation.getSettings(), { agent: 'proposal_generation', businessId: b.id, idempotencyKey: 'again' });
    await processQueue(engine());
    expect((await ctx.store.listProposals()).filter((p) => p.businessId === b.id)).toHaveLength(1);
    // The clock is frozen, so both runs share a timestamp; look for the second by its summary.
    expect((await runs()).map((r) => r.summary)).toEqual(expect.arrayContaining([expect.stringMatching(/^No proposal drafted: A draft proposal already exists/)]));
  });

  it('records the drafting step as skipped in Research only mode', async () => {
    const b = await readyProspect();
    await queueAgent(engine(), await automation.getSettings(), { agent: 'opportunity_report', businessId: b.id, payload: { generator: 'rule_based' } });
    const [outcome] = (await processQueue(engine())).outcomes;
    expect(outcome.agent).toBe('opportunity_report');
    const job = (await automation.listJobs({ businessId: b.id }))[0];
    expect(JSON.stringify(job.result)).toMatch(/Proposal Generation needs Research \+ proposals mode/);
    expect(await ctx.store.listProposals()).toHaveLength(0);
  });

  it('waits for research that supports a proposal, and never drafts for an opted-out business', async () => {
    const b = await svc.createBusiness(ctx, form({ name: 'Thin Research Boutique' }));
    const report = await writeRuleBasedReport(ctx, b, await collectEvidence(ctx, b, now));
    expect(report.content.nextAction.action).toBe('request_verification');
    const result = await proposalGenerationAgent.run!({
      input: { force: false },
      jobId: 'j1',
      traceId: 't1',
      business: b,
      svc: ctx,
      tools,
      settings: await automation.getSettings(),
      signal: new AbortController().signal,
      now,
      charge: () => {},
    });
    expect(result.output).toMatchObject({ drafted: false, overridable: true });
    expect(result.summary).toMatch(/next step is “complete website verification first”/);

    const forced = await proposalGenerationAgent.run!({ input: { force: true }, jobId: 'j2', traceId: 't2', business: b, svc: ctx, tools, settings: await automation.getSettings(), signal: new AbortController().signal, now, charge: () => {} });
    expect(forced.output).toMatchObject({ drafted: true });
    expect(forced.summary).toMatch(/Drafted on request despite/);

    const readiness = proposalDraftReadiness({ business: { ...b, contactPermission: 'opted_out' }, report, latestCheckAt: null, proposals: [], suppressed: true, hasPackages: true });
    expect(readiness).toMatchObject({ ready: false, overridable: false });
    expect(readiness.blockers).toEqual(expect.arrayContaining(['The business opted out.', 'The business is on the suppression list.']));
  });
});

describe('evidence-based proposal scope', () => {
  it('never treats the sector as an online-selling need', () => {
    // A boutique that takes phone orders and deposits is not an online store: only a recorded
    // online-selling need may choose the ecommerce package.
    const phoneOrders = plan({ category: 'Fashion boutique', serviceNeeds: ['Ordering by phone', 'Payments on delivery'] });
    expect(phoneOrders.pkg.key).not.toBe('ecommerce');
    expect(PACKAGE_TIER[phoneOrders.pkg.key]).toBeLessThanOrEqual(2);
    expect(phoneOrders.addOns.filter((a) => a.included).length).toBeGreaterThan(0);
    expect(phoneOrders.evidence.recordedNeeds).toEqual(['Ordering by phone', 'Payments on delivery']);
    expect(plan({ category: 'Fashion boutique', serviceNeeds: ['Sell online with Mobile Money checkout'] }).pkg.key).toBe('ecommerce');
  });

  it('says when a scope rests on sector guidance rather than evidence', () => {
    const noEvidence = plan({ category: 'Pharmacy', websiteStatus: 'unverified', serviceNeeds: [] });
    expect(noEvidence.evidence).toMatchObject({ websiteVerified: false, guidanceOnly: true, recordedNeeds: [] });
    expect(noEvidence.reasons.join(' ')).toMatch(/sector guidance to confirm in discovery/);
    expect(noEvidence.clientRationale.join(' ')).toMatch(/No website check or service need is recorded yet/);
    expect(noEvidence.assumptions.join(' ')).toMatch(/starting point based on the sector/);

    const checked = plan({ category: 'Pharmacy', websiteStatus: 'none_found', serviceNeeds: [] });
    expect(checked.evidence).toMatchObject({ websiteVerified: true, guidanceOnly: false });
    expect(checked.clientRationale.join(' ')).toMatch(/Documented checks did not find an official website/);
  });

  it('adds the licensing assumption for a regulated activity and records the report it used', () => {
    const regulated = plan({ category: 'Pharmacy' });
    expect(regulated.assumptions.join(' ')).toMatch(/Pharmacy Council/);
    expect(regulated.assumptions.join(' ')).toMatch(/digital services only/);
    expect(plan({ category: 'Furniture showroom' }).assumptions.join(' ')).not.toMatch(/licence from the/);

    const report = { id: 'r1', version: 3, content: { confidence: { overall: 'low' } } } as never;
    const withReport = planProposal({ business: biz(), settings: settings(), report })!;
    expect(withReport.evidence).toMatchObject({ reportId: 'r1', reportVersion: 3, reportConfidence: 'low' });
  });

  it('keeps sector guidance out of the proposal’s opportunities and client rationale', () => {
    const noReport = proposalFromPackage({ pkg: plan().pkg, businessName: 'Kente Couture', settings: settings(), plan: plan() });
    // Opportunities are findings from a report; without one the list stays empty rather than being
    // filled with category copy.
    expect(noReport.opportunities).toEqual([]);

    const guidance = plan({ category: 'Fashion boutique', websiteStatus: 'unverified' });
    const content = proposalFromPackage({ pkg: guidance.pkg, businessName: 'Kente Couture', settings: settings(), plan: guidance });
    expect(content.recommendedSolution).not.toMatch(/usually need first/);
    expect(content.recommendedSolution).toMatch(/No website check or service need is recorded yet/);
    expect(content.assumptions.join(' ')).toMatch(/starting point based on the sector/);
  });
});
