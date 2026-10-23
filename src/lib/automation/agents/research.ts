// Scoring (phase 2) and report (phase 5) agents. Both reuse the existing services, so a scored or
// reported business looks exactly as it would if a person had pressed the button.

import { z } from 'zod';
import * as svc from '@/lib/data/services';
import { collectEvidence, writeRuleBasedReport } from '@/lib/data/report-services';
import { NEXT_ACTION_META, reportReadiness } from '@/lib/domain/report';
import { latestVerification } from '@/lib/domain/rescore';
import { BAND_META } from '@/lib/domain/scoring';
import type { Business } from '@/lib/domain/types';
import { hasLimit } from '../budget';
import type { WorkflowState } from '../constants';
import { aiReportEstimateUsd } from '../pricing';
import type { AutomationSettings } from '../types';
import { canResetFrom } from '../workflow';
import { draftReadiness } from './proposals';
import { AgentError, type AgentDefinition, type AgentResult, type ToolGateway } from './types';

export { canResetFrom };

/** A scored prospect worth a report: verified website position, active, and a qualifying band. */
export function readyForReport(b: Business) {
  const band = b.scoreBreakdown?.band;
  const verified = b.websiteStatus !== 'unverified' && b.websiteStatus !== 'insufficient_evidence';
  return Boolean(band) && verified && b.businessStatus !== 'inactive' && (band === 'high' || band === 'qualify');
}

/** A report follow-up, unless one was already written since the latest website check. */
export async function reportFollowUp(ctx: svc.ServiceContext, b: Business): Promise<NonNullable<AgentResult['followUps']>> {
  const [reports, verifications] = await Promise.all([ctx.store.listReports(b.id), ctx.store.listVerifications(b.id)]);
  const lastCheck = latestVerification(verifications)?.checkedAt ?? '';
  return reports.some((r) => r.createdAt >= lastCheck) ? [] : [{ agent: 'opportunity_report', businessId: b.id, payload: { generator: 'auto' } }];
}

// ── Opportunity Scoring ──────────────────────────────────────────────────────

const scoringInput = z.object({ reason: z.string().max(200).optional() }).strict();

export const opportunityScoringAgent: AgentDefinition<z.infer<typeof scoringInput>> = {
  key: 'opportunity_scoring',
  name: 'Opportunity Scoring',
  version: 'scoring-1.0.0',
  description: 'Recomputes the transparent rule-based score from stored evidence and decides whether the prospect is ready for a report.',
  phase: 2,
  minimumMode: 'research_only',
  may: 'Update score fields and move the prospect to qualification.',
  never: 'Use AI for the score, or override a score a person set.',
  providers: [],
  needsBusiness: true,
  stepState: 'qualification',
  timeoutMs: 20_000,
  input: scoringInput,
  async run({ business, svc: ctx }) {
    const updated = await svc.rescoreBusiness(ctx, business!);
    const result = updated.scoreBreakdown;
    if (!result) throw new AgentError('Scoring produced no result.');
    // Inconclusive checks are recorded research but not a verified website position.
    const unchecked = updated.websiteStatus === 'unverified';
    const verified = !unchecked && updated.websiteStatus !== 'insufficient_evidence';
    const inactive = updated.businessStatus === 'inactive';
    const ready = readyForReport(updated);

    // Promising prospects get contact research first (data minimisation: no contact collection for
    // the rest), which then queues the report; without migration 005 the report comes straight away.
    let followUps: NonNullable<AgentResult['followUps']> = [];
    if (ready) {
      followUps = (await ctx.store.contactSchemaAvailable())
        ? [{ agent: 'contact_research', businessId: updated.id, payload: { pipeline: true } }]
        : await reportFollowUp(ctx, updated);
    }

    let transition: { to: WorkflowState; reason: string } | null = null;
    if (canResetFrom(updated)) {
      const scored = `Scored ${result.opportunity}/100 (${BAND_META[result.band].label})`;
      transition = unchecked
        ? { to: 'website_verification', reason: 'Scored before website verification; verification comes next' }
        : !verified
          ? { to: 'website_verification', reason: `${scored}; website checks were inconclusive, so more verification comes next` }
          : inactive
            ? { to: 'needs_human_review', reason: 'Business appears inactive; a person should review it' }
            : result.band === 'research'
              ? { to: 'research_incomplete', reason: `${scored}; confidence is too low to qualify` }
              : { to: 'qualification', reason: scored };
    }

    return {
      summary: `Opportunity ${result.opportunity}/100, confidence ${result.confidence}/100 — ${BAND_META[result.band].label}.`,
      decision: ready ? 'Ready for an opportunity report' : verified ? BAND_META[result.band].label : unchecked ? 'Needs website verification first' : 'Needs more website verification',
      confidence: result.confidence,
      output: { opportunityScore: result.opportunity, confidenceScore: result.confidence, band: result.band, flags: result.flags },
      transition,
      followUps,
    };
  },
};

// ── Opportunity Report ───────────────────────────────────────────────────────

const reportInput = z
  .object({
    generator: z.enum(['auto', 'rule_based', 'ai']).default('auto'),
    /** A person asked for this report explicitly: write it even if research is thin (it says so). */
    force: z.boolean().default(false),
  })
  .strict();
type ReportInput = z.infer<typeof reportInput>;

/** "auto" uses AI only when it is configured and an Anthropic budget has been set (the explicit opt-in). */
export function reportUsesAi(input: Pick<ReportInput, 'generator'>, settings: AutomationSettings, tools: Pick<ToolGateway, 'aiConfigured'>) {
  if (input.generator === 'ai') return true;
  return input.generator === 'auto' && tools.aiConfigured && hasLimit(settings.budgets.anthropic);
}

const VERIFY_TASK = 'Complete research before an opportunity report';
const isQuotaError = (e: unknown) => (e as { status?: number } | null)?.status === 429;

export const opportunityReportAgent: AgentDefinition<ReportInput> = {
  key: 'opportunity_report',
  name: 'Opportunity Report',
  version: 'report-2.0.0',
  description:
    'Writes a twelve-section report from the evidence pack once research is complete enough, labelling every statement as fact, finding, recommendation, assumption or unknown. Rule-based by default; AI-assisted when an Anthropic budget allows it.',
  phase: 5,
  minimumMode: 'research_only',
  may: 'Save a new report version citing stored evidence; ask a person for more research when evidence is insufficient.',
  never: 'State business facts outside the evidence, estimate revenue or customers, quote prices, claim that no website exists, or recommend messaging without permission.',
  providers: ['anthropic'],
  needsBusiness: true,
  stepState: 'opportunity_report',
  timeoutMs: 120_000,
  input: reportInput,
  estimate: ({ input, settings, tools }) => (reportUsesAi(input, settings, tools) ? { anthropic: aiReportEstimateUsd(tools.aiModel ?? 'claude-opus-5-5') } : {}),
  async run({ input, business, svc: ctx, tools, settings, signal, now, jobId, charge }) {
    const b = business!;
    const pack = await collectEvidence(ctx, b, now);
    const readiness = reportReadiness(pack, ctx.settings.reportMinConfidence);

    // Insufficient evidence: ask for more research instead of writing an analysis around the gaps.
    if (!readiness.ready && !input.force) {
      const tasks = await ctx.store.listTasks();
      if (!tasks.some((t) => t.businessId === b.id && !t.completedAt && t.title === VERIFY_TASK)) {
        await ctx.store.createTask({ businessId: b.id, projectId: null, title: VERIFY_TASK, dueDate: null, completedAt: null, assigneeId: null });
      }
      return {
        summary: `No report written: ${readiness.missing.join(' ')}`,
        decision: 'Needs more research before a report',
        output: { written: false, missing: readiness.missing, evidenceItems: pack.items.length },
        transition: canResetFrom(b) ? { to: 'research_incomplete', reason: `Report postponed: ${readiness.missing[0]}` } : null,
      };
    }

    const wantAi = reportUsesAi(input, settings, tools);
    if (wantAi && !tools.aiConfigured) throw new AgentError('AI reports are not configured on the server (ANTHROPIC_API_KEY).', 'permanent');

    let saved;
    let note: string | null = null;
    let tokens: { model: string | null; input: number | null; output: number | null } = { model: null, input: null, output: null };
    let ai = null;
    if (wantAi) {
      try {
        ai = await tools.aiReport(pack, { jobId }, signal);
      } catch (e) {
        // The daily AI report quota is a hard limit; automatic runs fall back to the free rule-based report.
        if (!(input.generator === 'auto' && isQuotaError(e))) throw e;
        note = 'The daily AI report quota is used up, so a rule-based report was written instead.';
      }
    }
    if (ai) {
      charge(ai.call);
      saved = await svc.saveReport(ctx, b, { content: ai.content, generator: 'ai', model: ai.model, pack, validation: ai.validation, usage: ai.usage });
      tokens = { model: ai.model, input: ai.usage.inputTokens, output: ai.usage.outputTokens };
    } else {
      saved = await writeRuleBasedReport(ctx, b, pack);
    }
    // A report that supports a proposal queues the Proposal Generation agent; the engine records it as
    // skipped when the workspace mode or agent settings do not allow drafting.
    const { readiness: draft } = await draftReadiness(ctx, b, now, saved.id);
    const followUps: NonNullable<AgentResult['followUps']> = draft.ready ? [{ agent: 'proposal_generation', businessId: b.id, payload: { reportId: saved.id } }] : [];
    const dropped = saved.validation?.droppedClaims.length ?? 0;
    const label = saved.generator === 'ai' ? 'AI-assisted' : 'Rule-based';
    return {
      summary: [
        `${label} report v${saved.version} saved from ${pack.items.length} evidence items (${saved.content.evidenceReferences.length} cited)${dropped ? `; ${dropped} unsupported statement${dropped === 1 ? '' : 's'} removed` : ''}.`,
        readiness.ready ? null : `Written on request although research is incomplete: ${readiness.missing.join(' ')}`,
        note,
      ]
        .filter(Boolean)
        .join(' '),
      decision: `${label} draft for review — next: ${NEXT_ACTION_META[saved.content.nextAction.action].label.toLowerCase()}`,
      confidence: pack.signals?.scoreConfidence ?? null,
      output: {
        written: true,
        reportId: saved.id,
        version: saved.version,
        generator: saved.generator,
        evidenceItems: pack.items.length,
        cited: saved.content.evidenceReferences.length,
        droppedClaims: dropped,
        warnings: saved.validation?.warnings.length ?? 0,
        confidence: saved.content.confidence.overall,
        nextAction: saved.content.nextAction.action,
        ...(note ? { note } : {}),
      },
      model: tokens.model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      transition: canResetFrom(b) ? { to: 'opportunity_report', reason: `Report v${saved.version} drafted for review` } : null,
      followUps,
    };
  },
};
