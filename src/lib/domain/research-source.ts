// What a research candidate's provenance requires. The "Add research candidate" form and its tests
// share these rules: a Google Place ID is a permitted reference on its own, while every other source
// kind must carry evidence a person can check. Ownership is never assumed from a source kind.

import { googleHostedUrl, socialHostedUrl } from './business-resources';
import { SOURCE_KINDS, type SourceKind } from './constants';
import { normalizePlaceId } from './places-intake';

export type IndependentSourceKind = Exclude<SourceKind, 'places_reference'>;

/** Every other kind describes independently obtained business details. */
export const INDEPENDENT_SOURCE_KINDS = SOURCE_KINDS.filter((kind): kind is IndependentSourceKind => kind !== 'places_reference');

export interface SourceEvidenceRule {
  /** `required` unless the kind carries its evidence elsewhere (`contact`, `notes`). */
  url: 'required' | 'optional';
  evidence: 'none' | 'contact' | 'notes';
}

export const SOURCE_EVIDENCE_RULES: Record<IndependentSourceKind, SourceEvidenceRule> = {
  manual: { url: 'required', evidence: 'none' },
  directory: { url: 'required', evidence: 'none' },
  search: { url: 'required', evidence: 'none' },
  direct_submission: { url: 'optional', evidence: 'contact' },
  referral: { url: 'optional', evidence: 'notes' },
  provider_discovery: { url: 'required', evidence: 'none' },
  social_profile: { url: 'required', evidence: 'none' },
  legacy_seed: { url: 'optional', evidence: 'none' },
};

/** The two things a person can save, kept apart so the form cannot blur them. */
export const SAVE_MODES = ['place_reference', 'independent'] as const;
export type SaveMode = (typeof SAVE_MODES)[number];

export function saveModeFor(kind: SourceKind): SaveMode {
  return kind === 'places_reference' ? 'place_reference' : 'independent';
}

/** Switching modes never silently claims ownership: the independent default is plain research. */
export function sourceKindForMode(mode: SaveMode, current: SourceKind): SourceKind {
  if (mode === 'place_reference') return 'places_reference';
  return current === 'places_reference' ? 'manual' : current;
}

export interface SourceEvidenceInput {
  sourceKind: SourceKind;
  sourceUrl: string;
  placesPlaceId: string;
  contactSource: string;
  notes: string;
  /** Discover opens this form from a Google result, so a non-Google citation is then mandatory. */
  requireIndependentSource?: boolean;
}

export type SourceEvidenceField = 'sourceUrl' | 'placesPlaceId' | 'contactSource' | 'notes';

export interface SourceEvidenceIssue {
  field: SourceEvidenceField;
  message: string;
}

const URL_REQUIRED = 'Add the page where you confirmed these details — the business’s own site, a licensed directory or the submission record.';
const GOOGLE_URL = 'A Google listing page cannot be cited as an independent source. Use “Save Place ID as a research reference”, or link the business’s own page, a directory or the owner’s submission.';

/** Returns one actionable issue per field; an empty list means the provenance is supported. */
export function sourceEvidenceIssues(input: SourceEvidenceInput): SourceEvidenceIssue[] {
  const issues: SourceEvidenceIssue[] = [];
  const url = input.sourceUrl.trim();
  const notes = input.notes.trim();

  if (input.sourceKind === 'places_reference') {
    // The Place ID is the whole record: no non-Google URL is needed to keep a permitted identifier.
    if (!normalizePlaceId(input.placesPlaceId)) {
      issues.push({
        field: 'placesPlaceId',
        message: 'Paste the Google Place ID — it usually starts with “ChIJ” and appears in the place’s Maps URL. Only the ID is saved.',
      });
    }
    return issues;
  }

  const rule = SOURCE_EVIDENCE_RULES[input.sourceKind as IndependentSourceKind];
  const urlRequired = rule.url === 'required' || input.requireIndependentSource === true;
  if (urlRequired && !url) {
    issues.push({ field: 'sourceUrl', message: URL_REQUIRED });
  } else if (url && googleHostedUrl(url)) {
    issues.push({ field: 'sourceUrl', message: GOOGLE_URL });
  } else if (url && input.sourceKind === 'directory' && socialHostedUrl(url)) {
    issues.push({
      field: 'sourceUrl',
      message: 'A social profile is not a business directory. Link the directory entry, or choose “Observed social profile” if that is what you checked.',
    });
  } else if (url && input.sourceKind === 'social_profile' && !socialHostedUrl(url)) {
    issues.push({
      field: 'sourceUrl',
      message: 'That link is not a social profile page. Choose the source type that matches the page you checked.',
    });
  }

  if (rule.evidence === 'contact' && input.contactSource.trim().length < 8 && notes.length < 20) {
    issues.push({
      field: 'contactSource',
      message: 'Record how the business supplied these details (for example “Owner email, 12 Nov”) and keep the message as evidence.',
    });
  }
  if (rule.evidence === 'notes' && notes.length < 15) {
    issues.push({ field: 'notes', message: 'Say who referred the business and when, in the research notes.' });
  }
  if (input.placesPlaceId.trim() && !normalizePlaceId(input.placesPlaceId)) {
    issues.push({
      field: 'placesPlaceId',
      message: 'That is not a Google Place ID. Clear the field, or paste the ID from the place’s Maps URL.',
    });
  }

  return issues;
}
