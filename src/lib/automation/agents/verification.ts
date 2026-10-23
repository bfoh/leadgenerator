// Phase 3 research agents: business identity, website verification and digital audit. Decisions
// are deterministic (src/lib/domain/website-assessment.ts, identity.ts, audit.ts); no model reads
// retrieved web content, so a page cannot instruct an agent. Results that need a person stop the
// pipeline at "Needs human review".

import { z } from 'zod';
import * as research from '@/lib/data/research-services';
import { auditFindings } from '@/lib/domain/audit';
import { assessIdentity } from '@/lib/domain/identity';
import { latestVerification } from '@/lib/domain/rescore';
import type { Business, WebsiteVerification } from '@/lib/domain/types';
import { candidateDomains, classifyUrl, domainNameMatch, hostOf, registrableDomain, siteKey } from '@/lib/domain/web-research';
import {
  CLASSIFICATION_META,
  CONFIDENCE_BAND_META,
  assessWebsite,
  judgeCandidate,
  planQueries,
  searchCandidates,
  type AssessBusiness,
  type CandidateCheck,
  type CandidateOrigin,
  type SearchHit,
  type SearchQueryRecord,
} from '@/lib/domain/website-assessment';
import { errorMessage } from '@/lib/utils';
import { hasLimit } from '../budget';
import type { WorkflowState } from '../constants';
import type { AutomationSettings } from '../types';
import { workflowStateOf } from '../workflow';
import { AgentError, type AgentDefinition, type AgentResult, type ToolGateway } from './types';

/** Research states an agent may move a business out of (later states are left alone). */
const RESEARCH_STATES: readonly WorkflowState[] = [
  'discovered',
  'identity_research',
  'website_verification',
  'contact_research',
  'qualification',
  'opportunity_report',
  'research_incomplete',
  'needs_human_review',
  'retry_pending',
  'failed',
];
const inResearch = (b: Business) => RESEARCH_STATES.includes(workflowStateOf(b));
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ── Business Identity ────────────────────────────────────────────────────────

const identityInput = z.object({}).strict();

export const businessIdentityAgent: AgentDefinition<z.infer<typeof identityInput>> = {
  key: 'business_identity',
  name: 'Business Identity',
  version: 'identity-1.0.0',
  description: 'Checks the prospect against existing records (names, alternate names, phone, website, Place ID) and opens duplicate suggestions for a person to decide.',
  phase: 3,
  minimumMode: 'research_only',
  may: 'Record an identity confidence and open duplicate suggestions.',
  never: 'Merge, split or link records — people decide those, and only owners and administrators merge.',
  providers: [],
  needsBusiness: true,
  stepState: 'identity_research',
  timeoutMs: 20_000,
  input: identityInput,
  async run({ business, svc: ctx, tools }) {
    const b = business!;
    if (b.mergedIntoId) throw new AgentError('This prospect was merged into another record; research continues on that record.', 'policy');
    const [all, links] = await Promise.all([ctx.store.listBusinesses(), ctx.store.listIdentityLinks(b.id)]);
    const assessment = assessIdentity(b, all, links);
    const { opened } = await research.recordIdentityCheck(ctx, b, assessment, businessIdentityAgent.version);
    const open = assessment.suggestions.filter((s) => s.strength !== 'possible');
    const names = open.map((s) => `"${s.other.name}"`).slice(0, 3).join(', ');
    const output = { identityConfidence: assessment.confidence, factors: assessment.factors, suggestions: open.map((s) => ({ businessId: s.other.id, strength: s.strength, reasons: s.reasons })), opened: opened.length };
    if (open.length) {
      return {
        summary: `Identity confidence ${assessment.confidence}/100. Possible duplicate of ${names}; a person should decide before research continues.`,
        decision: 'Duplicate suggestion needs a decision',
        confidence: assessment.confidence,
        output,
        transition: inResearch(b) ? { to: 'needs_human_review', reason: `Possible duplicate of ${names}: merge, mark as branch or as a different business` } : null,
      };
    }
    // Deployments without server tools (public demos) cannot check websites; scoring uses what is recorded.
    const checks = tools.research.available;
    return {
      summary: `Identity confidence ${assessment.confidence}/100; no likely duplicates in this workspace.${checks ? '' : ' Website checks are not available on this deployment, so scoring comes next.'}`,
      decision: 'Identity checked',
      confidence: assessment.confidence,
      output,
      transition: inResearch(b) && checks ? { to: 'website_verification', reason: 'Identity checked; website verification next' } : null,
      followUps: [{ agent: checks ? 'website_verification' : 'opportunity_scoring', businessId: b.id, payload: {} }],
    };
  },
};

// ── Website Verification ─────────────────────────────────────────────────────

const verificationInput = z
  .object({
    /** Re-verify even when a person verified the website recently. */
    force: z.boolean().default(false),
  })
  .strict();
type VerificationInput = z.infer<typeof verificationInput>;

export const MAX_QUERIES = 4;
const MAX_INSPECTIONS = 5;
const HUMAN_FRESH_DAYS = 90;

/**
 * Automated search needs the explicit opt-in of a Brave Search budget (the simulated test world
 * excepted). Without it the agent still checks recorded and name-derived domains.
 */
export function searchPlan(tools: Pick<ToolGateway, 'research'>, settings: AutomationSettings): { allowed: boolean; reason: string | null } {
  const r = tools.research;
  if (!r.search.configured) return { allowed: false, reason: 'Web search is not configured on the server (BRAVE_SEARCH_API_KEY), so no search was run.' };
  if (r.simulated) return { allowed: true, reason: null };
  if (!hasLimit(settings.budgets.brave_search)) return { allowed: false, reason: 'No Brave Search budget is set, so automated search was skipped. Set one in Automation Center → Controls.' };
  return { allowed: true, reason: null };
}

/** A person's verification recent enough that an automated re-check would add nothing. */
export function recentHumanVerification(verifications: WebsiteVerification[], now: Date): WebsiteVerification | null {
  const cutoff = new Date(now.getTime() - HUMAN_FRESH_DAYS * 86_400_000).toISOString();
  const today = now.toISOString().slice(0, 10);
  const human = verifications
    .filter((v) => v.reviewStatus !== 'rejected' && ((v.actorType ?? 'user') === 'user' || v.reviewStatus === 'confirmed'))
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  if (!human || human.checkedAt < cutoff) return null;
  if (human.nextCheckAt && human.nextCheckAt <= today) return null;
  return human;
}

const assessable = (b: Business): AssessBusiness => ({
  name: b.name,
  city: b.city,
  region: b.region,
  neighborhood: b.neighborhood,
  category: b.category,
  officialWebsite: b.officialWebsite,
  socialProfiles: b.socialProfiles,
  phone: b.phone,
  email: b.email,
});

export const websiteVerificationAgent: AgentDefinition<VerificationInput> = {
  key: 'website_verification',
  name: 'Website Verification',
  version: 'website-verification-1.0.0',
  description:
    'Searches licensed web search (when budgeted), probes candidate domains, checks candidate sites (honouring robots.txt), and records a classification with an evidence-confidence score and the factors behind it.',
  phase: 3,
  minimumMode: 'research_only',
  may: 'Record verification evidence and a classification; results that need review stay pending until a person confirms them.',
  never: 'Treat a failed search as proof that no website exists, scrape search result pages, store search snippets, or override a person’s verification.',
  providers: ['brave_search'],
  needsBusiness: true,
  stepState: 'website_verification',
  timeoutMs: 90_000,
  input: verificationInput,
  estimate: ({ settings, tools }) => {
    const plan = searchPlan(tools, settings);
    return plan.allowed && !tools.research.simulated ? { brave_search: MAX_QUERIES * tools.research.search.costPerQueryUsd } : {};
  },
  async run({ input, business, svc: ctx, tools, settings, signal, now, jobId, charge }) {
    const b = business!;
    if (b.mergedIntoId) throw new AgentError('This prospect was merged into another record; research continues on that record.', 'policy');
    const previous = await ctx.store.listVerifications(b.id);
    const human = input.force ? null : recentHumanVerification(previous, now);
    if (human) {
      return {
        summary: `Skipped: ${human.reviewerName ?? 'a person'} verified the website on ${human.checkedAt.slice(0, 10)} (re-check not yet due).`,
        decision: 'Recent verification by a person kept',
        output: { skipped: true, verificationId: human.id },
        followUps: [{ agent: 'digital_audit', businessId: b.id, payload: {} }],
      };
    }
    if (!tools.research.available) {
      throw new AgentError('Website checks run on the server. Enable Supabase sign-in, or set DEMO_SERVER_TOOLS=true on a private deployment.', 'permanent');
    }
    if (!(await ctx.store.researchSchemaAvailable())) throw new AgentError('Apply database migration 004 to record agent verifications.', 'permanent');

    const startedAt = new Date().toISOString();
    const ab = assessable(b);
    const plan = searchPlan(tools, settings);

    // Steps 1–3: name, variation and Ghana-location queries. Results stay in memory only.
    const queries: SearchQueryRecord[] = [];
    const hits: SearchHit[] = [];
    let provider: string | null = plan.allowed ? tools.research.search.provider : null;
    const search = async (query: string, purpose: SearchQueryRecord['purpose']) => {
      signal.throwIfAborted();
      const at = new Date().toISOString();
      try {
        const res = await tools.webSearch(query, { jobId, purpose }, signal);
        charge(res.call);
        provider = res.provider;
        hits.push(...res.hits);
        queries.push({ query, purpose, resultCount: res.hits.length, at, ok: true, error: null });
      } catch (error) {
        if (signal.aborted) throw error;
        queries.push({ query, purpose, resultCount: 0, at, ok: false, error: errorMessage(error).slice(0, 200) });
      }
    };
    if (plan.allowed) for (const q of planQueries(ab)) await search(q.query, q.purpose);

    // Steps 4 and 9: do the recorded website and the name-derived domains resolve?
    const recordedHost = hostOf(b.officialWebsite);
    const derived = candidateDomains(b.name, 6);
    const probes = await tools.probeDomains([...new Set([...(recordedHost ? [recordedHost] : []), ...derived])], signal);
    const resolves = new Map(probes.map((p) => [p.domain, p.resolves]));

    // Step 4 (search): one query for the most plausible resolving domain.
    const officialCandidate = recordedHost ?? derived.find((d) => resolves.get(d));
    if (plan.allowed && officialCandidate && queries.length < MAX_QUERIES) await search(`"${registrableDomain(officialCandidate)}"`, 'official_domain');

    // Step 5: which results and domains are worth one homepage check.
    const targets = new Map<string, { url: string; origins: Set<CandidateOrigin> }>();
    const add = (url: string, origin: CandidateOrigin) => {
      const key = siteKey(url);
      if (!key) return;
      const entry = targets.get(key) ?? { url, origins: new Set<CandidateOrigin>() };
      entry.origins.add(origin);
      targets.set(key, entry);
    };
    if (b.officialWebsite) add(b.officialWebsite, 'recorded_website');
    for (const c of searchCandidates(hits, ab, 3)) add(c.url, 'search_result');
    for (const d of derived.filter((x) => resolves.get(x)).slice(0, 3)) add(`https://${d}/`, 'name_derived');

    // Steps 8–10: inspect each candidate (robots.txt first) and weigh ownership signals.
    const inspect = async (site: string, t: { url: string; origins: Set<CandidateOrigin> }): Promise<CandidateCheck> => {
      const host = hostOf(t.url);
      const dns = host && resolves.has(host) ? (resolves.get(host) ? 'resolves' : 'no_record') : null;
      const page = await tools.inspectWebsite(t.url, signal);
      return judgeCandidate({ site, url: t.url, origins: [...t.origins], dns, robots: page.robots, check: page.check, facts: page.facts }, ab);
    };
    const first = [...targets.entries()].slice(0, MAX_INSPECTIONS);
    const candidates = await Promise.all(first.map(([site, t]) => inspect(site, t)));

    // Step 7: domains the business's own pages link to that spell its name (a builder site linking
    // to the real domain, for example), checked once each.
    const linked = new Map<string, { url: string; origins: Set<CandidateOrigin> }>();
    for (const c of candidates.filter((x) => x.verdict === 'owned' || x.verdict === 'probable')) {
      for (const site of c.facts?.outboundSites ?? []) {
        const kind = classifyUrl(`https://${site}/`)?.kind;
        if (targets.has(site) || linked.has(site) || kind !== 'candidate' || domainNameMatch(b.name, site) < 0.8) continue;
        linked.set(site, { url: `https://${site}/`, origins: new Set(['linked_from_site']) });
      }
    }
    const room = Math.max(0, MAX_INSPECTIONS + 2 - candidates.length);
    candidates.push(...(await Promise.all([...linked.entries()].slice(0, Math.min(2, room)).map(([site, t]) => inspect(site, t)))));

    // Steps 11–13: social presence, contradictions and the confidence assessment.
    const assessment = assessWebsite({
      business: ab,
      agentVersion: websiteVerificationAgent.version,
      startedAt,
      now: new Date(),
      search: { performed: queries.some((q) => q.ok), provider, simulated: tools.research.simulated, skippedReason: plan.reason, queries, hits },
      candidates,
      domainProbes: probes,
      previous,
    });
    const e = assessment.evidence;
    const { business: updated, verification } = await research.recordAgentVerification(ctx, b, assessment, {
      agentName: websiteVerificationAgent.name,
      agentVersion: websiteVerificationAgent.version,
      jobId,
    });

    const label = CLASSIFICATION_META[e.classification].label;
    const output = {
      verificationId: verification.id,
      classification: e.classification,
      confidenceScore: e.confidenceScore,
      band: e.band,
      reviewRequired: e.reviewRequired,
      reviewReasons: e.reviewReasons,
      queries: queries.length,
      candidatesChecked: candidates.length,
      searchSkipped: plan.reason,
      simulated: tools.research.simulated,
    };
    const summary = `${label} — evidence confidence ${e.confidenceScore}/100 (${CONFIDENCE_BAND_META[e.band].label}). ${plural(queries.length, 'search')}, ${plural(candidates.length, 'site')} checked.`;
    if (e.reviewRequired) {
      return {
        summary: `${summary} Needs review: ${e.reviewReasons.join('; ')}.`,
        decision: `${label} — needs review`,
        confidence: e.confidenceScore,
        output,
        transition: inResearch(updated) ? { to: 'needs_human_review', reason: `Website verification needs review: ${e.reviewReasons[0] ?? label}` } : null,
      };
    }
    const result: AgentResult = {
      summary,
      decision: label,
      confidence: e.confidenceScore,
      output,
      followUps: [{ agent: 'digital_audit', businessId: b.id, payload: {} }],
    };
    return result;
  },
};

// ── Digital Audit ────────────────────────────────────────────────────────────

const auditInput = z.object({}).strict();

export const digitalAuditAgent: AgentDefinition<z.infer<typeof auditInput>> = {
  key: 'digital_audit',
  name: 'Digital Audit',
  version: 'digital-audit-1.0.0',
  description: 'Turns the verification in force into findings that cite their evidence, separating verified issues from growth hypotheses.',
  phase: 3,
  minimumMode: 'research_only',
  may: 'Record findings that cite their evidence; earlier unreviewed findings are superseded.',
  never: 'Report a finding without evidence, or claim poor sales, few customers or low revenue.',
  providers: [],
  needsBusiness: true,
  stepState: 'qualification',
  timeoutMs: 20_000,
  input: auditInput,
  async run({ business, svc: ctx, now, jobId }) {
    const b = business!;
    if (!(await ctx.store.researchSchemaAvailable())) throw new AgentError('Apply database migration 004 to record audit findings.', 'permanent');
    const verification = latestVerification(await ctx.store.listVerifications(b.id));
    const drafts = auditFindings({ business: b, verification, now });
    const { created, kept } = await research.saveAuditFindings(ctx, b, drafts, { verification, jobId, agentVersion: digitalAuditAgent.version });
    const issues = created.filter((f) => f.kind === 'verified_issue').length;
    return {
      summary: verification
        ? `${plural(issues, 'verified issue')} and ${plural(created.length - issues, 'growth hypothesis', 'growth hypotheses')} recorded${kept ? `; ${kept} already reviewed by a person` : ''}.`
        : 'No website verification yet, so there is nothing to audit.',
      decision: verification ? 'Findings recorded for review' : 'Nothing to audit',
      output: { findings: created.length, verifiedIssues: issues, opportunities: created.length - issues, alreadyReviewed: kept, verificationId: verification?.id ?? null },
      followUps: [{ agent: 'opportunity_scoring', businessId: b.id, payload: {} }],
    };
  },
};
