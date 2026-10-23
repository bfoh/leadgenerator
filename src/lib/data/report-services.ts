// Evidence collection and report generation shared by the Reports UI and the Opportunity Report
// agent, so a report looks the same whoever asked for it.

import { buildEvidencePack, type EvidencePack } from '@/lib/domain/evidence';
import { generateDeterministicReport, validateReport } from '@/lib/domain/report';
import type { Business } from '@/lib/domain/types';
import * as svc from './services';
import type { ServiceContext } from './services';

/** Everything recorded about the business that may ground a report (audit and contacts when their migrations are applied). */
export async function collectEvidence(ctx: ServiceContext, business: Business, now = new Date()): Promise<EvidencePack> {
  const [verifications, research, contacts] = await Promise.all([ctx.store.listVerifications(business.id), ctx.store.researchSchemaAvailable(), ctx.store.contactSchemaAvailable()]);
  const [findings, points, consents, suppressions] = await Promise.all([
    research ? ctx.store.listAuditFindings(business.id) : [],
    contacts ? ctx.store.listContactPoints(business.id) : [],
    contacts ? ctx.store.listConsentRecords(business.id) : [],
    contacts ? ctx.store.listSuppressions() : [],
  ]);
  return buildEvidencePack(business, verifications, now, { findings, contacts: contacts ? { points, consents, suppressions } : null });
}

/** Rule-based report from the evidence pack. Works offline and costs nothing. */
export async function writeRuleBasedReport(ctx: ServiceContext, business: Business, pack: EvidencePack) {
  const { content, validation } = validateReport(generateDeterministicReport(pack), pack);
  return svc.saveReport(ctx, business, { content, generator: 'deterministic', model: null, pack, validation, usage: null });
}
