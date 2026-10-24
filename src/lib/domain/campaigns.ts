// Research campaign rules, shared by the browser and the server. A campaign is a saved scope,
// schedule, quota and budget for the existing research agents. It selects only prospects the
// workspace already tracks and never searches a discovery provider itself (see
// discovery-providers.ts for what a campaign provider must permit).

import { z } from 'zod';
import { industryGroupByLabel, industryGroupForCategory } from './categories';
import { DISTRICTS, findDistrict } from './districts';
import { campaignProviderBlocker } from './discovery-providers';
import type { Tone } from './constants';
import type { Business } from './types';

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, { label: string; description: string; tone: Tone }> = {
  draft: { label: 'Draft', description: 'Saved but not running. Nothing is queued.', tone: 'neutral' },
  active: { label: 'Active', description: 'The background worker starts research for matching prospects on the schedule.', tone: 'success' },
  paused: { label: 'Paused', description: 'No new prospects start; jobs already queued finish.', tone: 'warning' },
  completed: { label: 'Completed', description: 'The scope was researched to the end. Reopen by creating a new campaign.', tone: 'neutral' },
  cancelled: { label: 'Cancelled', description: 'Stopped permanently; its history stays readable.', tone: 'danger' },
};

/** What the campaign is doing right now, as distinct from its saved status. */
export const CAMPAIGN_PHASES = ['draft', 'waiting', 'researching', 'completed', 'no_prospects', 'paused', 'failed', 'cancelled'] as const;
export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number];
export const CAMPAIGN_PHASE_META: Record<CampaignPhase, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  waiting: { label: 'Waiting for next run', tone: 'neutral' },
  researching: { label: 'Research in progress', tone: 'info' },
  completed: { label: 'Research completed', tone: 'success' },
  no_prospects: { label: 'No eligible prospects', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  failed: { label: 'Research failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

export const CAMPAIGN_FREQUENCIES = ['manual', 'daily', 'weekly', 'monthly'] as const;
export type CampaignFrequency = (typeof CAMPAIGN_FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<CampaignFrequency, string> = {
  manual: 'Only when someone runs it',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};
export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const CAMPAIGN_TARGET_STATES = ['queued', 'researching', 'researched', 'qualified', 'skipped', 'failed'] as const;
export type CampaignTargetState = (typeof CAMPAIGN_TARGET_STATES)[number];
export const TARGET_STATE_META: Record<CampaignTargetState, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  researching: { label: 'Researching', tone: 'info' },
  researched: { label: 'Researched', tone: 'accent' },
  qualified: { label: 'Qualified', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** A genuine opportunity for the agency's offer; below this the prospect stays "researched". */
export const QUALIFIED_SCORE = 50;
export const MAX_BATCH_SIZE = 50;
export const MAX_DAILY_TARGETS = 500;
/** Ghana has no daylight saving: Africa/Accra is UTC all year, so schedule maths is plain UTC. */
export const CAMPAIGN_TIMEZONE = 'Africa/Accra';

export interface CampaignSchedule {
  frequency: CampaignFrequency;
  /** 0–23, Africa/Accra (UTC). */
  hour: number;
  /** 0 = Sunday … 6 = Saturday, for weekly schedules. */
  weekday: number | null;
  /** 1–28, for monthly schedules (28 keeps every month). */
  day: number | null;
}

export interface CampaignScope {
  /** Empty means every region. Otherwise region names from GHANA_REGIONS. */
  regions: string[];
  /** District P-codes from districts.ts. Empty means every district in the chosen regions. */
  districtCodes: string[];
  /** Town or neighbourhood names, matched exactly (case-insensitive). Empty means every town. */
  towns: string[];
  /** Industry categories, matched exactly (case-insensitive). Empty means every category. */
  categories: string[];
}

export interface ResearchCampaign {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  providerKey: string;
  scope: CampaignScope;
  batchSize: number;
  dailyTargetLimit: number;
  monthlyBudgetUsd: number | null;
  schedule: CampaignSchedule;
  /** Close the campaign automatically once every matching prospect has been researched. */
  autoComplete: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: 'succeeded' | 'failed' | 'skipped' | null;
  lastRunNote: string | null;
  pausedReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignTarget {
  id: string;
  organizationId: string;
  campaignId: string;
  businessId: string;
  state: CampaignTargetState;
  matchReason: string | null;
  source: 'tracked' | 'provider' | 'manual';
  jobId: string | null;
  note: string | null;
  addedBy: string | null;
  addedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface CampaignRun {
  id: string;
  organizationId: string;
  campaignId: string;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  startedAt: string;
  finishedAt: string | null;
  targetsEnqueued: number;
  targetsCompleted: number;
  jobsOpen: number;
  spendUsd: number;
  note: string | null;
  createdAt: string;
}

export interface CampaignTargetCounts extends Record<CampaignTargetState, number> {
  total: number;
  /** researched + qualified */
  completed: number;
}

export interface CampaignSummary extends ResearchCampaign {
  counts: CampaignTargetCounts;
  spendUsd: number;
}

/** Ghana's sixteen regions, with the ADM1 P-code prefix used by every district code. */
export const GHANA_REGIONS: readonly { code: string; name: string }[] = (() => {
  const byName = new Map<string, string>();
  for (const d of DISTRICTS) byName.set(d.region, d.code.slice(0, 4));
  return [...byName].map(([name, code]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
})();

export const GHANA_REGION_NAMES: readonly string[] = GHANA_REGIONS.map((r) => r.name);

// ─── Input schemas ───────────────────────────────────────────────────────────────────────────────

const textList = (maxItems: number, maxLength = 80) =>
  z
    .array(z.string().trim().min(1).max(maxLength))
    .max(maxItems)
    .default([])
    .transform((list) => [...new Set(list)]);

/**
 * The scope cap counts entries, so "Fashion boutique" and "fashion boutique" must not occupy two of
 * the 50 slots. The first spelling is kept because that is what the person picked.
 */
const caseInsensitiveUnique = (list: string[]) => {
  const seen = new Map<string, string>();
  for (const entry of list) if (!seen.has(entry.toLowerCase())) seen.set(entry.toLowerCase(), entry);
  return [...seen.values()];
};

export const campaignScopeSchema = z
  .object({
    regions: textList(16, 80),
    districtCodes: textList(261, 20),
    towns: textList(50, 80),
    categories: textList(50, 80).transform(caseInsensitiveUnique),
  })
  .superRefine((scope, ctx) => {
    for (const region of scope.regions) {
      if (!GHANA_REGION_NAMES.includes(region)) ctx.addIssue({ code: 'custom', path: ['regions'], message: `${region} is not a region of Ghana.` });
    }
    for (const code of scope.districtCodes) {
      const district = findDistrict(code);
      if (!district) ctx.addIssue({ code: 'custom', path: ['districtCodes'], message: `${code} is not a district code.` });
      else if (scope.regions.length && !scope.regions.includes(district.region)) {
        ctx.addIssue({ code: 'custom', path: ['districtCodes'], message: `${district.name} is not in the selected region(s).` });
      }
    }
  });
export type CampaignScopeInput = z.input<typeof campaignScopeSchema>;

const scheduleFields = z.object({
  frequency: z.enum(CAMPAIGN_FREQUENCIES).default('manual'),
  hour: z.number().int().min(0).max(23).default(6),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  day: z.number().int().min(1).max(28).nullable().default(null),
});

export const campaignScheduleSchema = scheduleFields.superRefine((schedule, ctx) => {
  if (schedule.frequency === 'weekly' && schedule.weekday == null) {
    ctx.addIssue({ code: 'custom', path: ['weekday'], message: 'Choose the day of the week.' });
  }
  if (schedule.frequency === 'monthly' && schedule.day == null) {
    ctx.addIssue({ code: 'custom', path: ['day'], message: 'Choose the day of the month (1–28).' });
  }
});

export const campaignFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Give the campaign a name').max(120),
  description: z.string().trim().max(1000).nullable().default(null),
  providerKey: z.string().trim().min(1).max(60).default('tracked_records'),
  scope: campaignScopeSchema,
  batchSize: z.number().int().min(1).max(MAX_BATCH_SIZE).default(10),
  dailyTargetLimit: z.number().int().min(1).max(MAX_DAILY_TARGETS).default(50),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).nullable().default(null),
  schedule: campaignScheduleSchema,
  autoComplete: z.boolean().default(true),
});

/** A new campaign. The provider must permit unattended discovery and CRM processing. */
export const campaignInputSchema = campaignFieldsSchema.superRefine((value, ctx) => {
  const blocker = campaignProviderBlocker(value.providerKey);
  if (blocker) ctx.addIssue({ code: 'custom', path: ['providerKey'], message: blocker });
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

/** A change to a saved campaign, plus the status move. Provider and scope are re-checked on save. */
export const campaignPatchSchema = campaignFieldsSchema.partial().extend({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  pausedReason: z.string().trim().max(500).nullable().optional(),
});
export type CampaignPatch = z.infer<typeof campaignPatchSchema>;

export const campaignScopeOnlySchema = z.object({ scope: campaignScopeSchema });

// ─── Matching and eligibility ────────────────────────────────────────────────────────────────────

const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

/** The prospect fields campaign matching and eligibility read, from a record or an API projection. */
export interface CampaignBusiness {
  id: string;
  region: string | null;
  districtCode?: string | null;
  city: string | null;
  neighborhood: string | null;
  category: string;
  contactPermission: string;
  mergedIntoId?: string | null;
  stage: string;
  businessStatus: string;
  createdAt: string;
  opportunityScore?: number | null;
}

/** The region a prospect is in, from its own field or its district. */
export function regionOfBusiness(business: Pick<CampaignBusiness, 'region' | 'districtCode'>): string | null {
  const own = business.region?.trim();
  if (own) return own;
  return findDistrict(business.districtCode ?? undefined)?.region ?? null;
}

/**
 * Whether research may run for this prospect. Consent and record integrity come first: an opt-out,
 * a merged record, an archived record and a business recorded as inactive are never targeted.
 */
export function campaignIneligibility(business: Pick<CampaignBusiness, 'contactPermission' | 'mergedIntoId' | 'stage' | 'businessStatus'>): string | null {
  if (business.contactPermission === 'opted_out') return 'The business opted out.';
  if (business.mergedIntoId) return 'The record was merged into another prospect.';
  if (business.stage === 'archived') return 'The prospect is archived.';
  if (business.businessStatus === 'inactive') return 'The business is recorded as inactive.';
  return null;
}

export interface CampaignMatch {
  matched: boolean;
  /** Human-readable reason, also stored on the target when it is added. */
  reason: string;
}

/** Whether a prospect is inside the campaign's scope. Region, district, town and category all narrow it. */
export function campaignScopeMatch(business: Pick<CampaignBusiness, 'region' | 'districtCode' | 'city' | 'neighborhood' | 'category'>, scope: CampaignScope): CampaignMatch {
  const region = regionOfBusiness(business);
  const district = findDistrict(business.districtCode ?? undefined);
  if (scope.regions.length && (!region || !scope.regions.includes(region))) return { matched: false, reason: 'Outside the selected region(s).' };
  if (scope.districtCodes.length && (!business.districtCode || !scope.districtCodes.includes(business.districtCode))) {
    return { matched: false, reason: 'Outside the selected district(s).' };
  }
  if (scope.towns.length) {
    const towns = new Set(scope.towns.map(norm));
    if (!towns.has(norm(business.city)) && !towns.has(norm(business.neighborhood))) return { matched: false, reason: 'Outside the selected town(s).' };
  }
  if (scope.categories.length) {
    const categories = new Set(scope.categories.map(norm));
    // An entry that names an industry group (for example "Agriculture & Crop Farming") selects every
    // prospect in that group, so a campaign can cover a whole sector without listing 12 categories.
    // Category labels are exact: choosing "Fashion boutique" does not widen to the fashion group.
    const groups = new Set(scope.categories.map((entry) => industryGroupByLabel(entry)?.key).filter(Boolean));
    const ownGroup = industryGroupForCategory(business.category)?.key ?? null;
    if (!categories.has(norm(business.category)) && !(ownGroup && groups.has(ownGroup))) {
      return { matched: false, reason: 'Outside the selected industry / category.' };
    }
  }
  const narrowed = scope.districtCodes.length > 0 || scope.towns.length > 0 || scope.categories.length > 0;
  const parts = [scope.regions.length || narrowed ? region : 'Nationwide', district?.name ?? null, business.city?.trim() || business.neighborhood?.trim() || null, business.category];
  return { matched: true, reason: parts.filter(Boolean).join(' · ') };
}

/** Eligible prospects in scope, oldest record first. */
export function campaignCandidates<T extends CampaignBusiness>(businesses: T[], scope: CampaignScope): { business: T; reason: string }[] {
  return businesses
    .filter((b) => !campaignIneligibility(b))
    .map((business) => ({ business, match: campaignScopeMatch(business, scope) }))
    .filter((entry) => entry.match.matched)
    .sort((a, b) => a.business.createdAt.localeCompare(b.business.createdAt))
    .map(({ business, match }) => ({ business, reason: match.reason }));
}

// ─── Scheduling (Africa/Accra, which is UTC all year) ───────────────────────────────────────────

const atHour = (year: number, month: number, day: number, hour: number) => new Date(Date.UTC(year, month, day, hour, 0, 0, 0));

/** The next time the schedule should run after `from`, or null for a manual campaign. */
export function nextRunAt(schedule: CampaignSchedule, from: Date = new Date()): string | null {
  if (schedule.frequency === 'manual') return null;
  const after = from.getTime();
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  const day = from.getUTCDate();
  if (schedule.frequency === 'daily') {
    let candidate = atHour(year, month, day, schedule.hour);
    if (candidate.getTime() <= after) candidate = atHour(year, month, day + 1, schedule.hour);
    return candidate.toISOString();
  }
  if (schedule.frequency === 'weekly') {
    const weekday = schedule.weekday ?? 0;
    for (let add = 0; add <= 7; add += 1) {
      const candidate = atHour(year, month, day + add, schedule.hour);
      if (candidate.getUTCDay() === weekday && candidate.getTime() > after) return candidate.toISOString();
    }
    return null;
  }
  const dayOfMonth = schedule.day ?? 1;
  let candidate = atHour(year, month, dayOfMonth, schedule.hour);
  if (candidate.getTime() <= after) candidate = atHour(year, month + 1, dayOfMonth, schedule.hour);
  return candidate.toISOString();
}

export function isCampaignDue(campaign: Pick<ResearchCampaign, 'status' | 'schedule' | 'nextRunAt'>, now: Date = new Date()): boolean {
  if (campaign.status !== 'active' || campaign.schedule.frequency === 'manual' || !campaign.nextRunAt) return false;
  return campaign.nextRunAt <= now.toISOString();
}

const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function campaignStatusTransitionAllowed(from: CampaignStatus, to: CampaignStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function describeSchedule(schedule: CampaignSchedule): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:00 GMT`;
  if (schedule.frequency === 'manual') return FREQUENCY_LABELS.manual;
  if (schedule.frequency === 'daily') return `Every day at ${time}`;
  if (schedule.frequency === 'weekly') return `Every ${WEEKDAY_LABELS[schedule.weekday ?? 0]} at ${time}`;
  return `Day ${schedule.day ?? 1} of every month at ${time}`;
}

export function describeScope(scope: CampaignScope): string {
  const parts: string[] = [scope.regions.length ? scope.regions.join(', ') : 'Nationwide (all 16 regions)'];
  if (scope.districtCodes.length) parts.push(`${scope.districtCodes.length} district${scope.districtCodes.length === 1 ? '' : 's'}`);
  if (scope.towns.length) parts.push(scope.towns.slice(0, 3).join(', ') + (scope.towns.length > 3 ? ` +${scope.towns.length - 3}` : ''));
  const industries = scope.categories.slice(0, 3).map((entry) => (industryGroupByLabel(entry) ? `${entry} (whole group)` : entry));
  parts.push(
    scope.categories.length
      ? industries.join(', ') + (scope.categories.length > 3 ? ` +${scope.categories.length - 3}` : '')
      : 'all industries',
  );
  return parts.join(' · ');
}

// ─── Progress ───────────────────────────────────────────────────────────────────────────────────

export function campaignTargetCounts(targets: Pick<CampaignTarget, 'state'>[]): CampaignTargetCounts {
  const counts: CampaignTargetCounts = { queued: 0, researching: 0, researched: 0, qualified: 0, skipped: 0, failed: 0, total: 0, completed: 0 };
  for (const target of targets) {
    counts[target.state] += 1;
    counts.total += 1;
  }
  counts.completed = counts.researched + counts.qualified;
  return counts;
}

export function campaignProgress(counts: CampaignTargetCounts): { done: number; total: number; percent: number } {
  return { done: counts.completed, total: counts.total, percent: counts.total ? Math.round((counts.completed / counts.total) * 100) : 0 };
}

// ─── What the campaign is doing now ─────────────────────────────────────────────────────────────

export interface CampaignPhaseInfo {
  phase: CampaignPhase;
  label: string;
  description: string;
  tone: Tone;
}

/**
 * A single, human answer to "what is this campaign doing?", so an empty audience, a future run, a
 * batch in progress, a finished scope, a pause and a failure are never shown as the same thing.
 * The saved status still governs what may happen; this only describes it.
 */
export function campaignPhase(
  campaign: Pick<ResearchCampaign, 'status' | 'schedule' | 'nextRunAt' | 'lastRunAt' | 'lastRunStatus' | 'lastRunNote'>,
  counts: CampaignTargetCounts,
): CampaignPhaseInfo {
  const meta = CAMPAIGN_PHASE_META;
  if (campaign.status === 'cancelled') {
    return { phase: 'cancelled', ...meta.cancelled, description: 'Stopped permanently. Its prospects and history stay readable.' };
  }
  if (campaign.status === 'paused') {
    return { phase: 'paused', ...meta.paused, description: 'No new prospects start. Jobs already queued finish.' };
  }
  if (campaign.status === 'draft') {
    return { phase: 'draft', ...meta.draft, description: 'Saved but not running. Activate it to queue the first batch.' };
  }
  if (campaign.status === 'completed') {
    return { phase: 'completed', ...meta.completed, description: 'The campaign was closed. Its run log and prospect history stay readable.' };
  }
  if (counts.researching > 0 || counts.queued > 0) {
    return {
      phase: 'researching',
      ...meta.researching,
      description:
        counts.researching > 0
          ? `${counts.researching} prospect(s) are being researched now.`
          : `${counts.queued} prospect(s) are queued and will start on the next tick.`,
    };
  }
  if (campaign.lastRunStatus === 'failed') {
    return { phase: 'failed', ...meta.failed, description: campaign.lastRunNote ?? 'The last background attempt failed. Review the target notes, then run it again.' };
  }
  const emptyScope = campaign.lastRunAt !== null && counts.total === 0 && /no untargeted prospect|no eligible|nothing matches/i.test(campaign.lastRunNote ?? '');
  if (emptyScope) {
    return { phase: 'no_prospects', ...meta.no_prospects, description: 'No tracked prospect currently matches this scope. Add prospects, or widen the scope.' };
  }
  if (counts.failed > 0 && counts.completed === 0) {
    return { phase: 'failed', ...meta.failed, description: 'No prospect in this campaign has completed research. Review the failed targets and run it again.' };
  }
  if (counts.total > 0) {
    return {
      phase: 'completed',
      ...meta.completed,
      description: `${counts.completed} researched${counts.qualified ? `, ${counts.qualified} qualified` : ''}${counts.skipped ? `, ${counts.skipped} skipped` : ''}.`,
    };
  }
  return {
    phase: 'waiting',
    ...meta.waiting,
    description:
      campaign.schedule.frequency === 'manual'
        ? 'Ready. Nothing starts until someone presses Run now.'
        : campaign.nextRunAt
          ? 'The first batch starts on the schedule.'
          : 'Waiting for the next scheduled run.',
  };
}

// ─── Editing a saved campaign ───────────────────────────────────────────────────────────────────

/** The work the API has to know about before it can allow a structural change. */
export interface CampaignActivity {
  researching: number;
  openJobs: number;
}

export interface CampaignEditAccess {
  name: boolean;
  scope: boolean;
  schedule: boolean;
  quotas: boolean;
  budget: boolean;
  autoComplete: boolean;
  status: boolean;
  /** Set when nothing at all may change (a completed or cancelled campaign). */
  reason: string | null;
  /** Set when scope and schedule are locked because research is running. */
  scopeReason: string | null;
}

/** Whether two scopes select the same records, ignoring array order and duplicates. */
export function campaignScopeEquals(a: CampaignScope, b: CampaignScope): boolean {
  const same = (left: string[], right: string[]) => {
    const l = new Set(left.map((value) => value.trim().toLowerCase()));
    const r = new Set(right.map((value) => value.trim().toLowerCase()));
    return l.size === r.size && [...l].every((value) => r.has(value));
  };
  return same(a.regions, b.regions) && same(a.districtCodes, b.districtCodes) && same(a.towns, b.towns) && same(a.categories, b.categories);
}

/** Whether two schedules mean the same thing (a field that does not apply is ignored). */
export function campaignScheduleEquals(a: CampaignSchedule, b: CampaignSchedule): boolean {
  if (a.frequency !== b.frequency) return false;
  if (a.frequency === 'manual') return true;
  if (a.hour !== b.hour) return false;
  if (a.frequency === 'weekly') return a.weekday === b.weekday;
  if (a.frequency === 'monthly') return a.day === b.day;
  return true;
}

/**
 * Name, quotas, budget and the auto-complete preference are safe at any time while the campaign is
 * not finished. Scope and schedule are not: a change during a batch would make the saved scope and
 * the in-flight membership disagree, and a schedule change races the worker's next-run claim.
 */
export function campaignEditAccess(status: CampaignStatus, activity: CampaignActivity): CampaignEditAccess {
  if (status === 'completed' || status === 'cancelled') {
    const reason = `A ${status} campaign cannot be changed. Its history is kept as it ran; create a new campaign to research the same scope again.`;
    return { name: false, scope: false, schedule: false, quotas: false, budget: false, autoComplete: false, status: false, reason, scopeReason: reason };
  }
  const busy = activity.researching > 0 || activity.openJobs > 0;
  const scopeReason = busy
    ? 'Research is still running for this campaign. You can change the name, quotas and budget now; change the scope, industries or schedule when the current batch finishes.'
    : null;
  return {
    name: true,
    scope: !busy,
    schedule: !busy,
    quotas: true,
    budget: true,
    autoComplete: true,
    status: true,
    reason: null,
    scopeReason,
  };
}

/**
 * Whether a finite campaign may close itself. Only when work has actually finished (at least one
 * researched prospect, no failure), nothing is queued or running, and no untargeted or busy
 * prospect remains in scope. A campaign with no audience stays open so a new prospect can be picked
 * up; a failed campaign stays open so it can be retried.
 */
export function campaignShouldAutoComplete(
  campaign: Pick<ResearchCampaign, 'status' | 'autoComplete'>,
  counts: CampaignTargetCounts,
  remaining: { untargeted: number; busy: number },
): boolean {
  return (
    campaign.status === 'active' &&
    campaign.autoComplete &&
    counts.completed > 0 &&
    counts.failed === 0 &&
    counts.queued === 0 &&
    counts.researching === 0 &&
    remaining.untargeted === 0 &&
    remaining.busy === 0
  );
}

/** Start of the current day in Africa/Accra (UTC), for the campaign's daily target quota. */
export function startOfCampaignDay(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function campaignBudgetReached(campaign: Pick<ResearchCampaign, 'monthlyBudgetUsd'>, spendUsd: number): boolean {
  return campaign.monthlyBudgetUsd != null && spendUsd >= campaign.monthlyBudgetUsd;
}

/** Whether the prospect is ready to be counted as a genuine opportunity. */
export function isQualifiedProspect(business: Pick<Business, 'opportunityScore'>): boolean {
  return (business.opportunityScore ?? 0) >= QUALIFIED_SCORE;
}

/** The job fields reconciliation reads. */
export interface CampaignJobLike {
  status: 'pending' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled';
  lastError?: string | null;
}

/**
 * What a campaign membership becomes once its research chain stops, or null while a job is still
 * open (or when there is nothing to change). The campaign worker applies this; keeping it here makes
 * the rule testable without a database.
 */
export function resolveTargetState(jobs: CampaignJobLike[], opportunityScore: number | null): { state: CampaignTargetState; note: string } | null {
  if (jobs.some((job) => job.status === 'pending' || job.status === 'running' || job.status === 'awaiting_approval')) return null;
  if (!jobs.length) return { state: 'queued', note: 'No research job was found for this target; it was queued again.' };
  const failed = jobs.find((job) => job.status === 'failed');
  if (failed) return { state: 'failed', note: failed.lastError ?? 'The research job failed.' };
  const cancelled = jobs.find((job) => job.status === 'cancelled');
  if (cancelled) return { state: 'skipped', note: cancelled.lastError ?? 'The research job was cancelled.' };
  if (jobs.some((job) => job.status === 'succeeded')) {
    return isQualifiedProspect({ opportunityScore })
      ? { state: 'qualified', note: `Opportunity score ${opportunityScore ?? 0}/100: report-ready.` }
      : { state: 'researched', note: `Research finished; opportunity score ${opportunityScore ?? 0}/100.` };
  }
  return null;
}





