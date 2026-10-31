// Approving several identifications together.
//
// A batch check is a reading, never a write. This module decides which rows a person may approve —
// only an independently supported identity, only while its check is current, and only when renaming
// the record would not duplicate another prospect — and states, per row, what is missing. The screen
// uses the same answer it shows, and the service re-runs the same checks against the record as it
// stands when the approval lands, so a stale review cannot rename anything by itself.

import { restrictedResourceUrl } from './business-resources';
import type { Tone } from './constants';
import { findDuplicates } from './dedupe';
import {
  IDENTITY_NAME_SOURCE_LABELS,
  PLACE_IDENTITY_STATUS_META,
  identityIsStale,
  identityPatch,
  readPlaceIdentity,
  type PlaceIdentityEvidence,
  type PlaceIdentityStatus,
  type IdentityProfile,
} from './place-identity';
import type { ConfidenceBand } from './website-assessment';
import type { Business } from './types';

// ── Decisions ────────────────────────────────────────────────────────────────

export const IDENTITY_APPROVAL_DECISIONS = ['approve', 'reject', 'more_evidence'] as const;
export type IdentityApprovalDecision = (typeof IDENTITY_APPROVAL_DECISIONS)[number];

export const IDENTITY_APPROVAL_DECISION_META: Record<
  IdentityApprovalDecision,
  { label: string; tone: Tone; description: string }
> = {
  approve: {
    label: 'Approve',
    tone: 'success',
    description: 'Rename this prospect from the independent source, once the whole batch is confirmed.',
  },
  reject: {
    label: 'Reject',
    tone: 'danger',
    description: 'Leave this record exactly as it is.',
  },
  more_evidence: {
    label: 'Needs more evidence',
    tone: 'warning',
    description: 'Hold this row and check it again before deciding.',
  },
};

// ── What supports a row ──────────────────────────────────────────────────────

/**
 * How well the row is supported. A Google listing is deliberately absent: matching a Place ID
 * establishes that a place exists, never that this record is named.
 */
export type IdentityVerification = 'supported' | 'stale' | 'conflicting' | 'unverified';

export const IDENTITY_VERIFICATION_META: Record<
  IdentityVerification,
  { label: string; tone: Tone; description: string }
> = {
  supported: {
    label: 'Independently supported',
    tone: 'success',
    description: 'A site of record publishes this name and shows enough ownership evidence to stand for the place.',
  },
  stale: {
    label: 'Check is stale',
    tone: 'warning',
    description: 'The check is more than a week old, so the record must be checked again before it can change.',
  },
  conflicting: {
    label: 'Conflicting evidence',
    tone: 'warning',
    description: 'More than one site could be this business, or the site points elsewhere. A person decides, not the batch.',
  },
  unverified: {
    label: 'Not independently supported',
    tone: 'neutral',
    description: 'No independent source stands for this place yet, so the row cannot be approved.',
  },
};

/** The row's decision, as the server re-reads it. A review may know less, never more. */
export interface IdentityReviewInput {
  businessId: string;
  /** The Place ID the row was checked for; approval never changes it. */
  placeId: string;
  recordName: string;
  /** The name this row was checked for, so the review can say what was searched. */
  searchedName: string;
  profile: IdentityProfile;
  state: string;
  evidence: PlaceIdentityEvidence | null;
  reason: string | null;
}

/** One other prospect that may already be this business. Never merged automatically. */
export interface IdentityDuplicateNotice {
  businessId: string;
  name: string;
  strength: 'exact' | 'likely' | 'possible';
  reasons: string[];
}

const DUPLICATE_STRENGTH_LABEL: Record<IdentityDuplicateNotice['strength'], string> = {
  exact: 'same reference',
  likely: 'likely duplicate',
  possible: 'possible duplicate',
};

/** One row of the review table: everything a person needs to decide, and why they may not. */
export interface IdentityReviewRow {
  businessId: string;
  placeId: string;
  recordName: string;
  /** The name the check searched for; empty for a row that never ran. */
  searchedName: string;
  proposedName: string;
  /** The site of record that publishes the proposed name, when there is one. */
  site: string;
  sourceUrl: string | null;
  /** Where on the page the name was read: structured data, site name, main heading or title. */
  evidenceFrom: string | null;
  confidence: ConfidenceBand | null;
  verification: IdentityVerification;
  /** Plain-language reasons the evidence does not stand, worst first. */
  conflicts: string[];
  duplicates: IdentityDuplicateNotice[];
  eligible: boolean;
  reason: string | null;
}

/**
 * Other prospects that would match the name this reading proposes. `exact` and `likely` matches block
 * an approval — renaming into them would create the duplicate this workspace's intake refuses to
 * create — while a `possible` match is only shown, because similar names in one town are common.
 */
export function identityDuplicateNotices(
  input: { businessId: string; placeId: string; name: string; city: string; website: string | null },
  existing: Business[],
): IdentityDuplicateNotice[] {
  return findDuplicates(
    {
      id: input.businessId,
      name: input.name,
      city: input.city,
      officialWebsite: input.website,
      placesPlaceId: input.placeId || null,
    },
    existing,
  )
    .filter((match) => !match.record.mergedIntoId)
    .map((match) => ({
      businessId: match.record.id,
      name: match.record.name,
      strength: match.strength,
      reasons: match.reasons,
    }));
}

/** The rows whose duplicate is strong enough to stop a rename. */
export function blockingIdentityDuplicates(duplicates: IdentityDuplicateNotice[]): IdentityDuplicateNotice[] {
  return duplicates.filter((duplicate) => duplicate.strength !== 'possible');
}

const statusOf = (state: string): PlaceIdentityStatus | null =>
  state === 'identified' || state === 'ambiguous' || state === 'not_found' ? state : null;

/**
 * Reads one checked row against the workspace. The rules are re-applied from the evidence rather
 * than trusted from the batch reading, so a row cannot become approvable by editing the screen.
 */
export function identityReviewRow(input: IdentityReviewInput, existing: Business[], now = new Date()): IdentityReviewRow {
  const base: IdentityReviewRow = {
    businessId: input.businessId,
    placeId: input.placeId,
    recordName: input.recordName,
    searchedName: input.searchedName,
    proposedName: '',
    site: '',
    sourceUrl: null,
    evidenceFrom: null,
    confidence: null,
    verification: 'unverified',
    conflicts: [],
    duplicates: [],
    eligible: false,
    reason: null,
  };

  const status = statusOf(input.state);
  if (!status || !input.evidence) {
    return {
      ...base,
      reason: status
        ? PLACE_IDENTITY_STATUS_META[status].description
        : (input.reason ?? 'This record was not checked, so there is nothing to approve.'),
    };
  }

  const reading = readPlaceIdentity(input.evidence);
  const proposal = reading.proposal;
  const duplicates = identityDuplicateNotices(
    {
      businessId: input.businessId,
      placeId: input.placeId,
      name: proposal.name || input.recordName,
      city: proposal.city ?? input.profile.city,
      website: proposal.url || null,
    },
    existing,
  );

  // A Google or social page is a preview or a link, never an independent source of record.
  const independent = Boolean(proposal.url) && !restrictedResourceUrl(proposal.url);
  const stale = identityIsStale(input.evidence, now);
  const verification: IdentityVerification =
    reading.status === 'ambiguous'
      ? 'conflicting'
      : reading.status !== 'identified' || !independent
        ? 'unverified'
        : stale
          ? 'stale'
          : 'supported';

  const patch = reading.status === 'identified' && independent ? identityPatch(input.profile, proposal) : null;
  const changes = patch ? [patch.renames, patch.officialWebsite, patch.category, patch.city].filter(Boolean).length : 0;
  const blocking = blockingIdentityDuplicates(duplicates);

  let reason: string | null = null;
  if (reading.status !== 'identified') reason = PLACE_IDENTITY_STATUS_META[reading.status].description;
  else if (!independent) reason = 'Google and social listings are references, not independent sources, so this name cannot be approved from them.';
  else if (stale) reason = 'This check is more than a week old. Check the record again before approving it.';
  else if (blocking.length)
    reason = `Another prospect already matches this identity (${blocking
      .map((duplicate) => `“${duplicate.name}”`)
      .join(', ')}). Resolve the duplicate first; records are never merged automatically.`;
  else if (changes === 0) reason = 'This record already carries these details, so nothing would change.';

  return {
    ...base,
    proposedName: proposal.name || input.recordName,
    site: proposal.site,
    sourceUrl: proposal.url || null,
    evidenceFrom: proposal.publishedNameFrom ? IDENTITY_NAME_SOURCE_LABELS[proposal.publishedNameFrom] : null,
    confidence: reading.status === 'identified' ? reading.confidence : null,
    verification,
    conflicts: reading.concerns,
    duplicates,
    eligible: reason === null,
    reason,
  };
}

/** The review table for a finished batch, in the order the person selected the records. */
export function identityReviewRows(inputs: IdentityReviewInput[], existing: Business[], now = new Date()): IdentityReviewRow[] {
  return inputs.map((input) => identityReviewRow(input, existing, now));
}

/** Rows a person can select for approval: independently supported, current, and free of duplicates. */
export function eligibleIdentityRows(rows: IdentityReviewRow[]): IdentityReviewRow[] {
  return rows.filter((row) => row.eligible);
}

/** How a duplicate match reads in the review table. */
export function duplicateNoticeLabel(duplicate: IdentityDuplicateNotice): string {
  return `${DUPLICATE_STRENGTH_LABEL[duplicate.strength]}: ${duplicate.reasons.join(' · ')}`;
}

/** What a batch approval would change, before it is confirmed. */
export interface IdentityApprovalPreview {
  /** Rows whose decision is `approve` and which may still change the record. */
  selected: IdentityReviewRow[];
  /** Rows the person held back or refused. */
  setAside: IdentityReviewRow[];
  /** Eligible rows nobody has decided on yet. */
  undecided: IdentityReviewRow[];
}

export function identityApprovalPreview(
  rows: IdentityReviewRow[],
  decisions: Record<string, IdentityApprovalDecision | undefined>,
): IdentityApprovalPreview {
  const selected = rows.filter((row) => row.eligible && decisions[row.businessId] === 'approve');
  const setAside = rows.filter(
    (row) => row.eligible && (decisions[row.businessId] === 'reject' || decisions[row.businessId] === 'more_evidence'),
  );
  const undecided = eligibleIdentityRows(rows).filter((row) => !decisions[row.businessId]);
  return { selected, setAside, undecided };
}

/** Selects every eligible row, leaving a rejection the person already made in place. */
export function selectAllEligible(
  rows: IdentityReviewRow[],
  decisions: Record<string, IdentityApprovalDecision>,
): Record<string, IdentityApprovalDecision> {
  const next = { ...decisions };
  for (const row of eligibleIdentityRows(rows)) {
    if (next[row.businessId] !== 'reject' && next[row.businessId] !== 'more_evidence') next[row.businessId] = 'approve';
  }
  return next;
}

/** Clears every decision, so nothing is approved by an earlier click. */
export function deselectAll(): Record<string, IdentityApprovalDecision> {
  return {};
}

/** Rows held back as "needs more evidence": the ones a re-check would usefully run. */
export function rowsNeedingMoreEvidence(
  rows: IdentityReviewRow[],
  decisions: Record<string, IdentityApprovalDecision>,
): string[] {
  return rows.filter((row) => decisions[row.businessId] === 'more_evidence').map((row) => row.businessId);
}

