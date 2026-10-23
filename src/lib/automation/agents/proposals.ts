// Proposal Generation (phase 6). Deterministic: the sector template, the recorded needs, the latest
// report and the agency's own packages and add-on prices decide the draft. No AI, no invented
// prices, and only ever a draft: approving, issuing and recording the client's decision stay with
// people (the agent store refuses anything else).

import { z } from 'zod';
import * as svc from '@/lib/data/services';
import { collectEvidence } from '@/lib/data/report-services';
import { approvalIssues, computeTotals } from '@/lib/domain/proposal';
import { planProposal, proposalDraftReadiness } from '@/lib/domain/proposal-templates';
import { latestVerification } from '@/lib/domain/rescore';
import type { Business, OpportunityReport } from '@/lib/domain/types';
import { canResetFrom } from '../workflow';
import { AgentError, type AgentDefinition } from './types';

const proposalInput = z
  .object({
    /** The report to build on; the latest one when absent. */
    reportId: z.string().uuid().optional(),
    /** A person asked for this draft: proceed past report-quality blockers (never opt-outs or duplicates). */
    force: z.boolean().default(false),
  })
  .strict();
type ProposalInput = z.infer<typeof proposalInput>;

export const PROPOSAL_AGENT_VERSION = 'proposal-1.0.0';

/** Readiness for an automatic draft, from the same records the agent reads. */
export async function draftReadiness(ctx: svc.ServiceContext, b: Business, now: Date, reportId?: string) {
  const [reports, verifications, proposals, pack] = await Promise.all([
    ctx.store.listReports(b.id),
    ctx.store.listVerifications(b.id),
    ctx.store.listProposals(),
    collectEvidence(ctx, b, now),
  ]);
  const report: OpportunityReport | null = reportId ? (reports.find((r) => r.id === reportId) ?? null) : ([...reports].sort((x, y) => y.version - x.version)[0] ?? null);
  const readiness = proposalDraftReadiness({
    business: b,
    report,
    latestCheckAt: latestVerification(verifications)?.checkedAt ?? null,
    proposals: proposals.filter((p) => p.businessId === b.id),
    suppressed: Boolean(pack.signals?.contacts?.suppressed),
    hasPackages: ctx.settings.packages.length > 0,
  });
  return { report, readiness };
}

export const proposalGenerationAgent: AgentDefinition<ProposalInput> = {
  key: 'proposal_generation',
  name: 'Proposal Generation',
  version: PROPOSAL_AGENT_VERSION,
  description:
    'Drafts an editable proposal once a report supports it: the industry template and recorded needs choose the package and add-ons, prices come only from your packages and price list, and every choice is explained.',
  phase: 6,
  minimumMode: 'research_and_proposals',
  may: 'Create draft proposals using your packages and add-on prices.',
  never: 'Invent or change prices, approve, send or decide a proposal, or draft for a business that opted out or is suppressed.',
  providers: [],
  needsBusiness: true,
  stepState: 'proposal_draft',
  timeoutMs: 30_000,
  input: proposalInput,
  async run({ input, business, svc: ctx, now }) {
    const b = business!;
    if (input.reportId && !(await ctx.store.listReports(b.id)).some((r) => r.id === input.reportId)) {
      throw new AgentError('That report does not belong to this business.', 'permanent');
    }
    const { report, readiness } = await draftReadiness(ctx, b, now, input.reportId);
    const proceed = readiness.ready || (input.force && readiness.overridable);
    if (!proceed || !report) {
      return {
        summary: `No proposal drafted: ${readiness.blockers.join(' ')}`,
        decision: readiness.overridable ? 'Waiting for research that supports a proposal' : 'Not eligible for an automatic proposal',
        output: { drafted: false, blockers: readiness.blockers, overridable: readiness.overridable },
      };
    }

    const plan = planProposal({ business: b, settings: ctx.settings });
    if (!plan) throw new AgentError('No service packages are configured.', 'permanent');
    const proposal = await svc.createProposal(ctx, b, plan.pkg, report, { source: 'agent', generator: PROPOSAL_AGENT_VERSION });
    const totals = computeTotals(proposal.content);
    const issues = approvalIssues(proposal.content, now.toISOString().slice(0, 10));
    const included = plan.addOns.filter((a) => a.included).length;
    const optional = plan.addOns.length - included;
    return {
      summary: [
        `Draft proposal created from report v${report.version}: ${plan.pkg.name} (${plan.template.label} template)`,
        included || optional ? ` with ${included} add-on${included === 1 ? '' : 's'} in scope and ${optional} optional` : '',
        '.',
        totals.unpricedRequired ? ` ${totals.unpricedRequired} required item${totals.unpricedRequired === 1 ? ' is' : 's are'} not priced in your price list yet.` : '',
        input.force && !readiness.ready ? ` Drafted on request despite: ${readiness.blockers.join(' ')}` : '',
        ' A person must review and approve it before it is issued.',
      ].join(''),
      decision: issues.length ? `Draft for review — ${issues.length} item${issues.length === 1 ? '' : 's'} to fix before approval` : 'Draft ready for human approval',
      output: {
        drafted: true,
        proposalId: proposal.id,
        reportId: report.id,
        packageKey: plan.pkg.key,
        recommendedPackageKey: plan.recommendedKey,
        template: plan.track,
        addOnsIncluded: included,
        addOnsOptional: optional,
        unpricedRequired: totals.unpricedRequired,
        approvalIssues: issues.length,
      },
      transition: canResetFrom(b) ? { to: 'proposal_draft', reason: `Proposal drafted (${plan.pkg.name}); awaiting human approval` } : null,
    };
  },
};
