import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStore, MemoryStorage, DEMO_KEY, LEGACY_DEMO_KEY } from '@/lib/data/local-store';
import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { buildEvidencePack } from '@/lib/domain/evidence';
import { generateDeterministicReport, reportSummary, validateReport } from '@/lib/domain/report';
import { DEFAULT_SETTINGS } from '@/lib/domain/settings';
import type { BusinessForm } from '@/lib/domain/schemas';

function form(overrides: Partial<BusinessForm> = {}): BusinessForm {
  return {
    name: 'Asante Furniture Gallery',
    category: 'Furniture showroom',
    country: 'GH',
    region: 'Ashanti',
    city: 'Kumasi',
    neighborhood: 'Santasi',
    address: null,
    businessStatus: 'active',
    officialWebsite: null,
    socialProfiles: [{ platform: 'facebook', url: 'https://facebook.com/asantefurniture' }],
    enquiryChannel: 'Showroom front desk',
    phone: null,
    email: null,
    contactSource: null,
    interestLevel: 'unknown',
    budgetSignal: 'unknown',
    serviceNeeds: ['Online catalogue'],
    estimatedValue: null,
    expectedCloseDate: null,
    nextAction: null,
    nextActionDue: null,
    notes: '',
    sourceUrl: 'https://example.org/directory/asante',
    sourceKind: 'directory',
    placesPlaceId: null,
    ...overrides,
  };
}

let storage: MemoryStorage;
let ctx: ServiceContext;

beforeEach(() => {
  storage = new MemoryStorage();
  ctx = { store: new LocalStore(storage), settings: structuredClone(DEFAULT_SETTINGS), userId: 'demo-user', userLabel: 'Demo user' };
});

describe('demo store', () => {
  it('seeds the 20 research records with scores and imported verification history', async () => {
    const businesses = await ctx.store.listBusinesses();
    expect(businesses).toHaveLength(20);
    expect(businesses.every((b) => typeof b.opportunityScore === 'number')).toBe(true);
    expect(await ctx.store.listVerifications()).toHaveLength(20);
    expect(storage.getItem(DEMO_KEY)).toBeTruthy();
  });

  it('migrates v6 browser data on first load', async () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_DEMO_KEY, JSON.stringify([{ id: 'CUSTOM-1', name: 'My v6 lead', city: 'Accra', sector: 'Bridal', websiteStatus: 'Unverified', confidence: 'low', priority: 50, phone: '', email: '', source: '', notes: 'mine', suggestion: '', stage: 'Qualified', consent: 'Unknown' }]));
    const businesses = await new LocalStore(s).listBusinesses();
    expect(businesses).toHaveLength(1);
    expect(businesses[0].name).toBe('My v6 lead');
    expect(businesses[0].stage).toBe('qualified');
  });

  it('rolls back state when an operation fails', async () => {
    const before = (await ctx.store.listBusinesses()).length;
    await expect(ctx.store.updateBusiness('missing', { name: 'x' })).rejects.toThrow();
    expect((await ctx.store.listBusinesses()).length).toBe(before);
  });
});

describe('research → verification → qualification → report → proposal → CRM → project', () => {
  it('runs the full vertical workflow with gating at each step', async () => {
    // 1. Research candidate
    let business = await svc.createBusiness(ctx, form());
    expect(business.websiteStatus).toBe('unverified');
    expect(business.stage).toBe('research_candidate');

    // Cannot qualify before verification
    await expect(svc.changeStage(ctx, business, 'qualified')).rejects.toThrow(/verification/);

    // 2. Verification
    const result = await svc.recordVerification(ctx, business, {
      status: 'none_found',
      methods: ['exact_name_search', 'name_variation_search', 'domain_probe', 'social_profile_review'],
      domain: null,
      sourceUrl: null,
      evidenceSummary: 'Searched exact name + Kumasi, two variations, five candidate domains and the Facebook page about section.',
      confidence: 'high',
      websiteOutdated: false,
      nextCheckAt: null,
    });
    business = result.business;
    expect(business.websiteStatus).toBe('none_found');
    expect(business.opportunityScore).toBeGreaterThan(60);

    // 3. Qualification
    business = await svc.changeStage(ctx, business, 'qualified');
    expect(business.stage).toBe('qualified');

    // Outreach stages are gated on permission
    await expect(svc.changeStage(ctx, business, 'discovery_meeting')).rejects.toThrow(/permission/i);
    await expect(svc.logActivity(ctx, business, { type: 'call', summary: 'Called owner' })).rejects.toThrow(/permission/i);

    // 4. Report
    const verifications = await ctx.store.listVerifications(business.id);
    const pack = buildEvidencePack(business, verifications);
    const { content, validation } = validateReport(generateDeterministicReport(pack), pack);
    const report = await svc.saveReport(ctx, business, { content, generator: 'deterministic', model: null, pack, validation, usage: null });
    expect(report.version).toBe(1);
    const report2 = await svc.saveReport(ctx, business, { content, generator: 'manual_edit', model: null, pack, validation, usage: null });
    expect(report2.version).toBe(2);

    // 5. Proposal
    const pkg = ctx.settings.packages.find((p) => p.key === 'starter_website')!;
    let proposal = await svc.createProposal(ctx, business, pkg, report2);
    business = (await ctx.store.getBusiness(business.id))!;
    expect(business.stage).toBe('proposal_draft');
    // The problem statement starts from the report summary and adds client-safe findings only:
    // verification logs and recorded research fields stay internal.
    expect(proposal.content.currentSituation.startsWith(reportSummary(report2.content))).toBe(true);
    expect(proposal.content.currentSituation).toContain('The business appears to rely on social platforms');
    expect(proposal.content.currentSituation).not.toMatch(/Evidence summary|Website verification on|Social profile recorded/);
    expect(proposal.content.basis).toMatchObject({ source: 'person', template: 'Furniture showroom', packageKey: 'starter_website', recommendedPackageKey: 'business_plus', reportId: report2.id, reportVersion: 2 });
    await expect(svc.transitionProposal(ctx, proposal, business, 'approved')).rejects.toThrow(/Fix before approving/);

    proposal = await svc.saveProposalContent(
      ctx,
      proposal,
      {
        ...proposal.content,
        preparedBy: 'Studio Accra',
        lineItems: proposal.content.lineItems.map((l, i) => ({ ...l, unitPrice: i === 0 ? 8000 : 300 })),
        taxes: [{ id: 'vat', label: 'VAT', ratePercent: 15 }],
      },
      proposal.title,
    );
    // The recorded need "Online catalogue" puts two furniture add-ons in scope as one-time lines:
    // (8000 + 300 + 300) × 1.15 VAT.
    expect(proposal.content.lineItems.filter((l) => l.kind === 'one_time').map((l) => l.description)).toEqual(['Website design and development', 'Product catalogue', 'Dimensions and finishes']);
    expect(proposal.oneTimeTotal).toBe(9890);
    proposal = await svc.transitionProposal(ctx, proposal, business, 'approved');
    await expect(svc.saveProposalContent(ctx, proposal, proposal.content, 'x')).rejects.toThrow(/draft/);
    await expect(svc.transitionProposal(ctx, proposal, business, 'sent')).rejects.toThrow(/permission/);

    // 6. CRM: permission, contact, sending
    await expect(
      svc.recordPermission(ctx, business, { contactPermission: 'granted', lawfulBasis: null, permissionEvidence: null }),
    ).rejects.toThrow();
    business = await svc.recordPermission(ctx, business, {
      contactPermission: 'granted',
      lawfulBasis: 'business_initiated',
      permissionEvidence: 'Owner messaged the agency asking for a quote on 2026-10-20',
    });
    await svc.logActivity(ctx, business, { type: 'meeting', summary: 'Discovery meeting at showroom' });
    proposal = await svc.transitionProposal(ctx, proposal, business, 'sent');
    business = (await ctx.store.getBusiness(business.id))!;
    expect(business.stage).toBe('proposal_sent');
    expect(business.lastInteractionAt).toBeTruthy();

    proposal = await svc.transitionProposal(ctx, proposal, business, 'accepted');
    business = (await ctx.store.getBusiness(business.id))!;
    expect(business.stage).toBe('won');
    expect(business.estimatedValue).toBe(9890);

    // 7. Project
    const project = await svc.convertToProject(ctx, business, proposal);
    expect(project.contractValue).toBe(9890);
    expect((await ctx.store.listMilestones(project.id)).length).toBe(pkg.phases.length);
    expect((await svc.convertToProject(ctx, business, proposal)).id).toBe(project.id);
    await expect(svc.deleteBusiness(ctx, business)).rejects.toThrow(/projects/);

    // History
    const versions = await ctx.store.listProposalVersions(proposal.id);
    expect(versions.map((v) => v.status)).toEqual(['accepted', 'sent', 'approved', 'draft', 'draft']);
    const timeline = await ctx.store.listActivities(business.id);
    expect(timeline.some((a) => a.type === 'stage_change' && a.summary.includes('Won'))).toBe(true);
    const audit = await ctx.store.listAuditEvents(business.id);
    expect(audit.some((e) => e.action === 'update' && e.changes && 'contactPermission' in e.changes)).toBe(true);
  });

  it('blocks outreach for opted-out businesses and keeps the flag visible', async () => {
    let business = await svc.createBusiness(ctx, form({ name: 'Opt Out Ltd' }));
    business = await svc.recordPermission(ctx, business, { contactPermission: 'opted_out', lawfulBasis: null, permissionEvidence: 'Asked not to be contacted' });
    expect(business.optedOutAt).toBeTruthy();
    expect(business.nextAction).toMatch(/Do not contact/);
    expect(business.scoreBreakdown?.flags.join(' ')).toMatch(/Opted out/);
    await expect(svc.changeStage(ctx, business, 'introduction_requested')).rejects.toThrow(/opted out/);
    await expect(svc.logActivity(ctx, business, { type: 'whatsapp', summary: 'x' })).rejects.toThrow(/opted out/);
  });

  it('records verification corrections in the audit trail', async () => {
    let business = await svc.createBusiness(ctx, form({ name: 'Correction Co' }));
    const { verification } = await svc.recordVerification(ctx, business, {
      status: 'insufficient_evidence',
      methods: ['exact_name_search'],
      domain: null,
      sourceUrl: null,
      evidenceSummary: 'First pass found nothing conclusive.',
      confidence: 'low',
      websiteOutdated: false,
      nextCheckAt: null,
    });
    business = (await svc.editVerification(ctx, business, verification, {
      status: 'verified_official',
      methods: ['exact_name_search', 'http_check'],
      domain: 'correction.com.gh',
      sourceUrl: null,
      evidenceSummary: 'Found the official site linked from their Facebook page.',
      confidence: 'high',
      websiteOutdated: true,
      nextCheckAt: null,
    })).business;
    expect(business.websiteStatus).toBe('verified_official');
    expect(business.officialWebsite).toBe('https://correction.com.gh');
    const audit = await ctx.store.listAuditEvents(verification.id);
    expect(audit.find((e) => e.action === 'update')?.changes?.status).toEqual({ old: 'insufficient_evidence', new: 'verified_official' });
  });

  it('requires a lost reason and reports skipped bulk moves', async () => {
    const business = await svc.createBusiness(ctx, form({ name: 'Lost Co' }));
    await expect(svc.changeStage(ctx, business, 'lost')).rejects.toThrow(/lost/);
    const all = await ctx.store.listBusinesses();
    const { moved, skipped } = await svc.bulkChangeStage(ctx, all.slice(0, 3), 'negotiation');
    expect(moved).toHaveLength(0);
    expect(skipped).toHaveLength(3);
  });
});
