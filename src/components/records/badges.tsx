import {
  CONTACT_PERMISSION_META,
  PROJECT_STATUS_META,
  PROPOSAL_STATUS_META,
  STAGE_LABELS,
  WEBSITE_STATUS_META,
  type ContactPermission,
  type ProjectStatus,
  type ProposalStatus,
  type Stage,
  type Tone,
  type WebsiteStatus,
} from '@/lib/domain/constants';
import { BAND_META, bandFor } from '@/lib/domain/scoring';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const STAGE_TONE: Partial<Record<Stage, Tone>> = {
  qualified: 'info',
  introduction_requested: 'warning',
  contact_authorized: 'info',
  discovery_meeting: 'info',
  proposal_draft: 'accent',
  proposal_sent: 'accent',
  negotiation: 'accent',
  won: 'success',
  lost: 'danger',
};

export function WebsiteStatusBadge({ status, outdated }: { status: WebsiteStatus; outdated?: boolean }) {
  const meta = WEBSITE_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot title={meta.description}>
      {meta.label}
      {outdated ? ' · outdated' : ''}
    </Badge>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONE[stage] ?? 'neutral'}>{STAGE_LABELS[stage]}</Badge>;
}

export function PermissionBadge({ permission }: { permission: ContactPermission }) {
  const meta = CONTACT_PERMISSION_META[permission];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  const meta = PROPOSAL_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const meta = PROJECT_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const BAND_CLASS = {
  high: 'text-success',
  qualify: 'text-info',
  research: 'text-warning',
  low: 'text-subtle',
} as const;

/** Opportunity score with its band; confidence shown separately because they mean different things. */
export function ScorePill({ score, confidence, className }: { score: number | null; confidence?: number | null; className?: string }) {
  if (score == null) return <span className="text-xs text-subtle">Not scored</span>;
  const band = bandFor(score);
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 tabular', className)} title={`${BAND_META[band].label} (${BAND_META[band].range})${confidence != null ? ` · confidence ${confidence}%` : ''}`}>
      <span className={cn('text-sm font-semibold', BAND_CLASS[band])}>{score}</span>
      {confidence != null && <span className="text-[11px] text-subtle">{confidence}% conf.</span>}
    </span>
  );
}

export function ScoreBar({ value, className, label }: { value: number; className?: string; label: string }) {
  const band = bandFor(value);
  const fill = { high: 'bg-success', qualify: 'bg-info', research: 'bg-warning', low: 'bg-subtle' }[band];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-muted', className)} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', fill)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}
