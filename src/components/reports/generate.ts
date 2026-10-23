'use client';

import * as svc from '@/lib/data/services';
import type { ServiceContext } from '@/lib/data/services';
import { collectEvidence, writeRuleBasedReport } from '@/lib/data/report-services';
import type { ReportContent, ReportValidation } from '@/lib/domain/report';
import type { Business, ReportUsage, UsageInsert } from '@/lib/domain/types';
import { api, recordCharge } from '@/lib/workspace/api';

/** Rule-based report from stored evidence. Works offline and costs nothing. */
export async function generateRuleBasedReport(ctx: ServiceContext, business: Business) {
  return writeRuleBasedReport(ctx, business, await collectEvidence(ctx, business));
}

/** AI-assisted draft. The server grounds it in the evidence pack and re-validates citations. */
export async function generateAiReport(ctx: ServiceContext, business: Business) {
  const pack = await collectEvidence(ctx, business);
  const res = await api.post<{ content: ReportContent; validation: ReportValidation; model: string; usage: ReportUsage; charge: UsageInsert }>('/api/reports/generate', { pack });
  await recordCharge(ctx.store, res.charge);
  return svc.saveReport(ctx, business, { content: res.content, generator: 'ai', model: res.model, pack, validation: res.validation, usage: res.usage });
}
