// Outreach Drafting (phase 8). Chooses a contact point and an approved, policy-covered template
// with the eligibility gateway's own checks, and writes one draft for a person to review. The
// optional AI step only fills {{personal_note}} with one evidence-grounded sentence. The agent
// never approves, queues or sends (the agent store refuses it), and a draft it writes still goes
// through the full gateway at approval and again at dispatch.

import { z } from 'zod';
import { collectEvidence } from '@/lib/data/report-services';
import { channelForPoint, draftMessage, requireMessagingSchema, usesPersonalNote } from '@/lib/data/messaging-services';
import type { ContactPoint } from '@/lib/domain/contacts';
import {
  MESSAGE_PURPOSE_LABELS,
  OPEN_MESSAGE_STATUSES,
  checkEligibility,
  type GatewayCheck,
  type MessageTemplate,
} from '@/lib/domain/messaging';
import { aiNoteEstimateUsd } from '../pricing';
import { AgentError, type AgentDefinition } from './types';

const outreachInput = z
  .object({
    purpose: z.enum(['introduction', 'follow_up', 'proposal']).default('introduction'),
    contactPointId: z.string().uuid().optional(),
    templateId: z.string().uuid().optional(),
    /** Ask the AI model for the personal note. Off unless a person asks for it. */
    ai: z.boolean().default(false),
  })
  .strict();
type OutreachInput = z.infer<typeof outreachInput>;

export const OUTREACH_AGENT_VERSION = 'outreach-drafting-1.0.0';

/** The checks that decide whether a draft is worth writing now. Timing, sender and approval are for later stages. */
const DRAFT_CHECKS: readonly GatewayCheck['key'][] = ['business', 'suppression', 'consent', 'contact', 'template', 'policy', 'frequency'];

const usesAi = (input: OutreachInput, tools: { aiConfigured: boolean }) => input.ai && tools.aiConfigured;

interface Candidate {
  point: ContactPoint;
  template: MessageTemplate;
  failures: string[];
  needsNote: boolean;
}

export const outreachDraftingAgent: AgentDefinition<OutreachInput> = {
  key: 'outreach_drafting',
  name: 'Outreach Drafting',
  version: OUTREACH_AGENT_VERSION,
  description:
    'Writes one message draft for a person to review: it picks a contact with consent on file and an approved template covered by a message policy, using the eligibility gateway’s own checks. Optionally, the AI model writes the one-sentence personal note from recorded evidence.',
  phase: 8,
  minimumMode: 'research_and_proposals',
  may: 'Create message drafts from approved templates, for contacts with consent on file.',
  never: 'Approve, schedule, queue or send a message, change consent or suppressions, set message policies, or write free text outside the personal note.',
  providers: ['anthropic'],
  needsBusiness: true,
  stepState: null,
  timeoutMs: 75_000,
  input: outreachInput,
  estimate: ({ input, tools }) => (usesAi(input, tools) ? { anthropic: aiNoteEstimateUsd(tools.aiModel ?? 'claude-opus-5-5') } : {}),
  async run({ input, business, svc: ctx, tools, settings, signal, now, jobId, charge }) {
    const b = business!;
    await requireMessagingSchema(ctx);
    const purposeLabel = MESSAGE_PURPOSE_LABELS[input.purpose].toLowerCase();
    const none = (decision: string, reasons: string[], extra: Record<string, unknown> = {}) => ({
      summary: `No ${purposeLabel} draft written: ${reasons.join(' ')}`,
      decision,
      output: { drafted: false, reasons, ...extra },
    });

    // Suppression and opt-out come first; nothing else is read for a business that said no.
    if (b.contactPermission === 'opted_out') return none('Not eligible for a message draft', ['The business opted out of all contact.']);

    const [points, templates, policies, consents, suppressions, inbound, history, proposals] = await Promise.all([
      ctx.store.listContactPoints(b.id),
      ctx.store.listTemplates(),
      ctx.store.listMessagePolicies(),
      ctx.store.listConsentRecords(b.id),
      ctx.store.listSuppressions(),
      ctx.store.listInboundMessages(),
      ctx.store.listOutreachMessages(),
      input.purpose === 'proposal' ? ctx.store.listProposals() : Promise.resolve([]),
    ]);

    if (input.purpose === 'proposal' && !proposals.some((p) => p.businessId === b.id && (p.status === 'approved' || p.status === 'sent'))) {
      return none('Waiting for an approved proposal', ['A proposal message needs a proposal that a person has approved or issued.']);
    }
    if (input.contactPointId && !points.some((p) => p.id === input.contactPointId)) throw new AgentError('That contact point does not belong to this business.', 'permanent');
    if (input.templateId && !templates.some((t) => t.id === input.templateId)) throw new AgentError('That template does not exist.', 'permanent');

    const usable = points.filter((p) => channelForPoint(p) && p.valueHash && (!input.contactPointId || p.id === input.contactPointId));
    const fitting = templates.filter((t) => t.status === 'approved' && t.purpose === input.purpose && (!input.templateId || t.id === input.templateId));
    if (!usable.length) return none('Not eligible for a message draft', ['No email address or WhatsApp number is recorded for this business.']);
    if (!fitting.length) return none('No approved template', [`No approved ${purposeLabel} template${input.templateId ? ' matches the one requested' : ''}. Approve one in Outreach → Templates.`]);

    // One draft per contact and purpose at a time: never write a second while one is open.
    const open = history.filter((m) => m.businessId === b.id && m.purpose === input.purpose && OPEN_MESSAGE_STATUSES.includes(m.status));
    const candidates: Candidate[] = [];
    for (const point of usable) {
      if (open.some((m) => m.contactPointId === point.id)) continue;
      const channel = channelForPoint(point)!;
      for (const template of fitting.filter((t) => t.channel === channel)) {
        // The same deterministic gateway, run in memory on what the draft would be.
        const result = checkEligibility(
          {
            id: 'draft-preview',
            businessId: b.id,
            contactPointId: point.id,
            channel,
            purpose: input.purpose,
            templateId: template.id,
            templateVersion: template.version,
            bodyHash: '',
            recipientHash: point.valueHash!,
            status: 'draft',
            approvedBy: null,
            approvedAt: null,
            inReplyTo: null,
            scheduledFor: null,
          },
          {
            stage: 'preview',
            now,
            business: b,
            point,
            template,
            consents,
            suppressions,
            inbound: inbound.filter((m) => m.senderHash === point.valueHash),
            history: history.filter((m) => m.recipientHash === point.valueHash),
            mode: settings.mode,
            outboundStopped: settings.outboundStopped,
            outboundAvailable: false,
            testRecipientHashes: [],
            senderIssues: [],
            sendingPolicy: settings.sendingPolicy,
            sendingPaused: settings.sendingPaused,
            policies,
            outbound: [],
          },
        );
        const failures = result.checks.filter((c) => !c.passed && DRAFT_CHECKS.includes(c.key)).map((c) => c.detail);
        candidates.push({ point, template, failures, needsNote: usesPersonalNote(template) });
      }
    }

    if (!candidates.length) {
      return none(
        open.length ? 'A draft is already open' : 'No template for these channels',
        [open.length ? `A ${purposeLabel} message to this business is already a draft, approved or queued; review that one first.` : `No approved ${purposeLabel} template fits the recorded channels.`],
      );
    }

    const eligible = candidates.filter((c) => !c.failures.length);
    if (!eligible.length) {
      // Report the closest candidate's reasons: what a person would have to fix.
      const closest = [...candidates].sort((x, y) => x.failures.length - y.failures.length)[0];
      return none('Not eligible for a message draft', [...new Set(closest.failures)], { pointHint: closest.point.hint, templateId: closest.template.id });
    }

    const ai = usesAi(input, tools) && typeof tools.aiOutreachNote === 'function';
    // With the AI step, prefer a template that has a personal note; without it, only templates that need none.
    const choice = (ai && eligible.find((c) => c.needsNote)) || eligible.find((c) => !c.needsNote) || null;
    if (!choice) {
      return none('Needs a personal note', [
        input.ai && !tools.aiConfigured
          ? 'The eligible templates need a personal note and AI notes are not configured. Draft the message by hand from the Contacts tab.'
          : 'The eligible templates need a personal note. Run again with the AI note, or draft the message by hand from the Contacts tab.',
      ]);
    }

    let personalNote = '';
    let noteRun: { model: string; evidenceIds: string[]; inputTokens: number; outputTokens: number } | null = null;
    if (choice.needsNote) {
      const pack = await collectEvidence(ctx, b, now);
      const res = await tools.aiOutreachNote!(pack, { jobId }, signal);
      charge(res.call);
      noteRun = { model: res.model, evidenceIds: res.evidenceIds, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens };
      if (!res.note) {
        return {
          ...none('No grounded personal note', [res.reason ?? 'The AI note did not pass the checks.', 'Draft the message by hand from the Contacts tab.']),
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
        };
      }
      personalNote = res.note;
    }

    const message = await draftMessage(ctx, { business: b, point: choice.point, purpose: input.purpose, template: choice.template, agentVersion: OUTREACH_AGENT_VERSION, personalNote });
    return {
      summary: `${choice.template.channel === 'email' ? 'Email' : 'WhatsApp'} ${purposeLabel} draft written for ${choice.point.hint} from “${choice.template.name}”${personalNote ? ', with an AI personal note citing ' + noteRun!.evidenceIds.join(', ') : ''}. Nothing has been sent; an owner or administrator reviews and approves it, and the eligibility gateway checks it again at approval and at dispatch.`,
      decision: 'Draft ready for human review',
      output: {
        drafted: true,
        messageId: message.id,
        templateId: choice.template.id,
        templateVersion: choice.template.version,
        channel: message.channel,
        pointHint: choice.point.hint,
        aiNote: Boolean(personalNote),
        ...(noteRun ? { noteEvidence: noteRun.evidenceIds } : {}),
      },
      model: noteRun?.model ?? null,
      inputTokens: noteRun?.inputTokens ?? null,
      outputTokens: noteRun?.outputTokens ?? null,
    };
  },
};
