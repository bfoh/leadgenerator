import 'server-only';

import type { ToolGateway } from '@/lib/automation/agents/types';
import { aiClassifyEstimateUsd, aiNoteEstimateUsd, aiReportEstimateUsd } from '@/lib/automation/pricing';
import { generateOutreachNote } from '../ai/outreach-note';
import { classifyReplyWithAi } from '../ai/reply-classifier';
import { generateAiReport, isAiConfigured } from '../ai/report-generator';
import type { RequestContext } from '../context';
import { serverEnv } from '../env';
import { researchToolStatus, runContactPage, runDomainProbes, runInspection, runMxLookups, runWebSearch } from '../research-tools';
import { enforceQuota, paidCall, tokenCharge } from '../usage';

/** Privileged tools for agents running on the server: same quotas and usage records as the routes. */
export function serverToolGateway(ctx: RequestContext): ToolGateway {
  return {
    aiConfigured: isAiConfigured(),
    aiModel: isAiConfigured() ? serverEnv.anthropicModel() : null,
    async aiReport(pack, { jobId }, signal) {
      await enforceQuota(ctx, 'ai_report', serverEnv.quota.aiReports());
      const spec = { provider: 'anthropic', operation: 'ai_report', maxCostUsd: aiReportEstimateUsd(serverEnv.anthropicModel()), metadata: { jobId }, signal };
      const { result, charge } = await paidCall(ctx, spec, () => generateAiReport(pack, signal), tokenCharge);
      return { ...result, call: { provider: 'anthropic', operation: 'ai_report', units: 1, estimatedCostUsd: charge.estimatedCostUsd, ok: true } };
    },
    async aiOutreachNote(pack, { jobId }, signal) {
      await enforceQuota(ctx, 'ai_note', serverEnv.quota.aiNotes());
      const spec = { provider: 'anthropic', operation: 'ai_note', maxCostUsd: aiNoteEstimateUsd(serverEnv.anthropicModel()), metadata: { jobId }, signal };
      const { result, charge } = await paidCall(ctx, spec, () => generateOutreachNote(pack, signal), tokenCharge);
      return { ...result, call: { provider: 'anthropic', operation: 'ai_note', units: 1, estimatedCostUsd: charge.estimatedCostUsd, ok: true } };
    },
    async aiClassifyReply(message, { jobId }, signal) {
      await enforceQuota(ctx, 'ai_classify', serverEnv.quota.aiClassifications());
      const spec = { provider: 'anthropic', operation: 'ai_classify', maxCostUsd: aiClassifyEstimateUsd(serverEnv.anthropicModel()), metadata: { jobId }, signal };
      const { result, charge } = await paidCall(ctx, spec, () => classifyReplyWithAi(message, signal), tokenCharge);
      return { ...result, call: { provider: 'anthropic', operation: 'ai_classify', units: 1, estimatedCostUsd: charge.estimatedCostUsd, ok: true } };
    },
    research: { available: true, ...researchToolStatus() },
    async webSearch(query, { jobId, purpose }, signal) {
      signal.throwIfAborted();
      const { hits, provider, usage } = await runWebSearch(ctx, query, { jobId, purpose });
      return { hits, provider, call: { provider: usage.provider, operation: 'web_search', units: 1, estimatedCostUsd: usage.estimatedCostUsd, ok: true } };
    },
    async probeDomains(domains, signal) {
      signal.throwIfAborted();
      return (await runDomainProbes(ctx, domains)).results;
    },
    async inspectWebsite(url, signal) {
      signal.throwIfAborted();
      const { check, facts, robots } = await runInspection(ctx, url);
      return { check, facts, robots };
    },
    contacts: { available: true, simulated: serverEnv.simulateExternalTools() },
    async readContactPage(url, signal) {
      signal.throwIfAborted();
      const { check, robots, contacts } = await runContactPage(ctx, url);
      return { check, robots, contacts };
    },
    async lookupMx(domains, signal) {
      signal.throwIfAborted();
      return (await runMxLookups(ctx, domains)).results;
    },
  };
}
