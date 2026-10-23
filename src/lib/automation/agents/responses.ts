// Response Classification and Follow-Up Planning (phase 9). Every received message is already read by
// the deterministic rules as it arrives; the classification agent reads again the ones that need it
// (recorded before migration 008, or unclear to the rules), optionally with the AI classifier, and the
// planning agent turns the conversation into tasks for people. Neither replies, schedules a message,
// lifts a suppression, closes a prospect or decides commercial terms.

import { z } from 'zod';
import { applyFollowUps, reclassifyReply, requireConversionSchema } from '@/lib/data/response-services';
import { AI_CLASSIFIER_VERSION, AI_MIN_CONFIDENCE, HOT_INTENTS, REPLY_INTENT_META, latestClassifications, type ReplyClassification, type ReplyIntent } from '@/lib/domain/replies';
import type { InboundMessage } from '@/lib/domain/messaging';
import { aiClassifyEstimateUsd } from '../pricing';
import { AgentError, type AgentDefinition, type AgentResult } from './types';

export const RESPONSE_AGENT_VERSION = 'response-classification-1.0.0';
export const FOLLOW_UP_AGENT_VERSION = 'follow-up-planning-1.0.0';

/** At most this many messages are read per run (and paid for, with AI). */
export const MAX_READS_PER_RUN = 3;

const responseInput = z
  .object({
    /** One received message; otherwise the prospect's unhandled messages that need a reading. */
    messageId: z.string().min(1).optional(),
    /** Ask the AI classifier. Off unless a person asks for it. */
    ai: z.boolean().default(false),
  })
  .strict();
type ResponseInput = z.infer<typeof responseInput>;

const usesAi = (input: ResponseInput, tools: { aiConfigured: boolean }) => input.ai && tools.aiConfigured;

/** Messages worth reading again: never a person's correction, and the AI only where the rules were unsure. */
function needsReading(current: ReplyClassification | undefined, ai: boolean) {
  if (!current) return true;
  if (!ai || current.source !== 'rules') return false;
  return current.intent === 'unclear' || current.confidence < AI_MIN_CONFIDENCE + 10;
}

export const responseClassificationAgent: AgentDefinition<ResponseInput> = {
  key: 'response_classification',
  name: 'Response Classification',
  version: RESPONSE_AGENT_VERSION,
  description:
    'Reads received messages that need it (interested, meeting request, pricing or proposal question, not now, not interested, opt-out, wrong contact, automatic reply) and turns each reading into a task for a person. The rules read every message as it arrives; the optional AI classifier reads those the rules were unsure about, and can never overrule an opt-out.',
  phase: 9,
  minimumMode: 'research_and_proposals',
  may: 'Record readings of received messages, create tasks, set the interest level and add a suppression when a reply asks to stop.',
  never: 'Reply, treat silence as interest, overrule or lift an opt-out, correct a person’s reading, close a prospect or change a proposal.',
  providers: ['anthropic'],
  needsBusiness: true,
  stepState: null,
  timeoutMs: 120_000,
  input: responseInput,
  estimate: ({ input, tools }) => (usesAi(input, tools) ? { anthropic: aiClassifyEstimateUsd(tools.aiModel ?? 'claude-opus-5-5') * MAX_READS_PER_RUN } : {}),
  async run({ input, business, svc: ctx, tools, signal, jobId, charge }) {
    const b = business!;
    await requireConversionSchema(ctx);
    const ai = usesAi(input, tools) && Boolean(tools.aiClassifyReply);
    const inbound = await ctx.store.listInboundMessages(b.id);
    const latest = latestClassifications(await ctx.store.listReplyClassifications(inbound.map((m) => m.id)));

    let targets: InboundMessage[];
    if (input.messageId) {
      const m = inbound.find((x) => x.id === input.messageId);
      if (!m) throw new AgentError('That received message is not on this prospect.', 'permanent');
      targets = [m];
    } else {
      targets = inbound.filter((m) => !m.handledAt && needsReading(latest.get(m.id), ai)).slice(0, MAX_READS_PER_RUN);
    }

    const intentOf = new Map<string, ReplyIntent>([...latest].map(([id, c]) => [id, c.intent]));
    const read: { messageId: string; intent: ReplyIntent; confidence: number; source: string; suppressed: boolean }[] = [];
    const skipped: { messageId: string; reason: string }[] = [];
    for (const m of targets) {
      signal.throwIfAborted();
      const current = latest.get(m.id);
      if (current?.source === 'person') {
        skipped.push({ messageId: m.id, reason: 'A person already set what it means.' });
        continue;
      }
      // An opt-out stands whatever a classifier says; there is nothing for the AI to add.
      const useAi = ai && !m.optOut && Boolean(m.body?.trim());
      if (!useAi && current) {
        skipped.push({ messageId: m.id, reason: m.optOut ? 'An opt-out; it stays one.' : 'Already read by the rules.' });
        continue;
      }
      let by: Parameters<typeof reclassifyReply>[1]['by'];
      if (useAi) {
        const res = await tools.aiClassifyReply!({ channel: m.channel, subject: m.subject, body: m.body ?? '' }, { jobId }, signal);
        charge(res.call);
        by = { kind: 'ai', result: res.result, model: res.model, actorType: 'agent', version: AI_CLASSIFIER_VERSION };
      } else {
        by = { kind: 'rules', actorType: 'agent' };
      }
      const { reading, suppressed } = await reclassifyReply(ctx, { message: m, by });
      read.push({ messageId: m.id, intent: reading.intent, confidence: reading.confidence, source: reading.source, suppressed });
      intentOf.set(m.id, reading.intent);
    }

    const hot = inbound.some((m) => !m.handledAt && !m.optOut && HOT_INTENTS.includes(intentOf.get(m.id) ?? 'unclear'));
    const result: AgentResult = {
      summary: read.length
        ? `Read ${read.length} repl${read.length === 1 ? 'y' : 'ies'}: ${read.map((r) => `${REPLY_INTENT_META[r.intent].label.toLowerCase()} (${r.source}, ${r.confidence}%)`).join(', ')}.`
        : `No replies needed reading${skipped.length ? ` (${skipped.length} skipped)` : ''}.`,
      decision: hot ? 'Interested reply waiting for an answer' : read.length ? 'Replies read' : 'Nothing to read',
      confidence: read.length ? Math.min(...read.map((r) => r.confidence)) : null,
      output: { read, skipped, ai },
      transition: inbound.length ? (hot ? { to: 'interested', reason: 'A reply shows interest; a person answers it.' } : { to: 'response_monitoring', reason: 'Replies received and read.' }) : null,
      followUps: read.length ? [{ agent: 'follow_up_planning', businessId: b.id, payload: {} }] : [],
    };
    return result;
  },
};

export const followUpPlanningAgent: AgentDefinition<Record<string, never>> = {
  key: 'follow_up_planning',
  name: 'Follow-Up Planning',
  version: FOLLOW_UP_AGENT_VERSION,
  description:
    'Turns the conversation so far into tasks for your team: answer interested replies today, decide on a follow-up after a week of silence (or stop after the policy’s limit), check back after “not now”, arrange a meeting, prepare or issue a proposal, decide open change requests. Deterministic and free.',
  phase: 9,
  minimumMode: 'research_and_proposals',
  may: 'Create tasks for people.',
  never: 'Schedule or send a message, treat silence as interest, or change a proposal or the sales stage.',
  providers: [],
  needsBusiness: true,
  stepState: null,
  timeoutMs: 30_000,
  input: z.object({}).strict(),
  async run({ business, svc: ctx, settings, now }) {
    const b = business!;
    const plan = await applyFollowUps(ctx, b, settings.sendingPolicy, now);
    return {
      summary: plan.length ? `Added ${plan.length} task${plan.length === 1 ? '' : 's'}: ${plan.map((t) => t.title).join('; ')}.` : 'Nothing new to plan: every next step already has an open task.',
      decision: plan.length ? 'Tasks added' : 'Nothing new',
      output: { tasks: plan },
    };
  },
};
