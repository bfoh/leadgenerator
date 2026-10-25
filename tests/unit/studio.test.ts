import { describe, expect, it } from 'vitest';
import {
  countClassifications,
  decisionOf,
  groupByClassification,
  intelligenceSummary,
  latestObservations,
  latestRunNumber,
  observationsOfRun,
  runsOf,
  studioObservationProblems,
  studioReviewProblems,
  verificationOf,
  buildBrandIntelligence,
  type BrandObservationDraft,
  type StudioObservation,
  type StudioReview,
} from '@/lib/domain/studio';
import { FASHION_BUSINESS, SITE_URL, TODAY, fashionFacts, silentFacts } from './studio-fixtures';

// Business brand intelligence: what a homepage reading may and may not become. The interesting cases
// are the absent ones — a page that is silent must produce questions, not confident copy.

const analyse = (facts = fashionFacts()) =>
  buildBrandIntelligence({ business: FASHION_BUSINESS, facts, siteUrl: SITE_URL, today: TODAY });

const keysOf = (drafts: BrandObservationDraft[], classification: BrandObservationDraft['classification']) =>
  drafts.filter((draft) => draft.classification === classification).map((draft) => draft.key);

/** Drafts as stored rows, so the same validators the stores run can be applied. */
function asRows(drafts: BrandObservationDraft[], runNumber: number): StudioObservation[] {
  return drafts.map((draft, index) => ({
    ...draft,
    id: `obs-${runNumber}-${index}`,
    organizationId: 'org-1',
    projectId: 'project-1',
    runNumber,
    observedAt: TODAY,
    createdBy: null,
    createdAt: TODAY,
  }));
}

describe('brand intelligence from a readable homepage', () => {
  const drafts = analyse();

  it('records the identity, contact and selling routes it can see', () => {
    expect(drafts.map((draft) => draft.key)).toEqual(
      expect.arrayContaining([
        'identity.name',
        'identity.location',
        'contact.routes',
        'commerce.routes',
        'identity.social',
        'navigation.sections',
        'palette.declared',
        'typography.fonts',
        'platform.generator',
        'content.copyright',
      ]),
    );
    const name = drafts.find((draft) => draft.key === 'identity.name');
    expect(name?.classification).toBe('verified_fact');
    expect(name?.detail).toContain('Nsroma Atelier');
    expect(name?.sourceUrl).toBe(SITE_URL);
  });

  it('agrees with the CRM record on the city and quotes the declared palette', () => {
    const location = drafts.find((draft) => draft.key === 'identity.location');
    expect(location?.confidence).toBe(90);
    expect(location?.detail).toContain('The CRM record agrees (Accra)');
    expect(drafts.find((draft) => draft.key === 'palette.declared')?.detail).toContain('#7a1f3d');
  });

  it('flags a stale footer as a placeholder rather than carrying the copy forward', () => {
    const stale = drafts.find((draft) => draft.key === 'placeholder.stale');
    expect(stale?.classification).toBe('placeholder');
    expect(stale?.detail).toContain('2021');
    // The template itself is not detected here, so no template placeholder is claimed.
    expect(drafts.some((draft) => draft.key === 'placeholder.template')).toBe(false);
  });

  it('keeps every logo, photograph and third-party host as a restricted reference', () => {
    const restricted = drafts.filter((draft) => draft.classification === 'restricted');
    expect(restricted.length).toBeGreaterThan(0);
    for (const draft of restricted) {
      // File references may be looked at but not published; statement restrictions may not be reused at all.
      expect(draft.sourceKind).toBe('website_page');
      if (draft.assetUrl) {
        expect(draft.reusePermission).toBe('reference_only');
        expect(draft.assetKind).not.toBeNull();
      } else {
        expect(draft.reusePermission).toBe('prohibited');
      }
    }
    // Assets on static.wixstatic.com are not on the business's own domain.
    const thirdParty = drafts.find((draft) => draft.key === 'restriction.third_party_assets');
    expect(thirdParty?.detail).toContain('static.wixstatic.com');
    expect(thirdParty?.reusePermission).toBe('prohibited');
    expect(drafts.find((draft) => draft.key === 'restriction.site_copy')?.reusePermission).toBe('prohibited');
    expect(drafts.find((draft) => draft.key === 'asset.image.2')?.assetUrl).toContain('kaba-set.jpg');
  });

  it('marks its own ideas as suggestions with no page as their source', () => {
    const suggestions = drafts.filter((draft) => draft.classification === 'creative_suggestion');
    expect(keysOf(drafts, 'creative_suggestion')).toEqual(
      expect.arrayContaining(['suggestion.hero', 'suggestion.contact', 'suggestion.imagery', 'suggestion.palette', 'suggestion.typography', 'suggestion.trust']),
    );
    for (const suggestion of suggestions) {
      expect(suggestion.sourceKind).toBe('system');
      expect(suggestion.sourceUrl).toBeNull();
    }
    // A mobile-first rebuild is only proposed when the page has no viewport.
    expect(drafts.some((draft) => draft.key === 'suggestion.mobile_first')).toBe(false);
  });

  it('produces rows that pass the storage contract for their run', () => {
    for (const row of asRows(drafts, 1)) expect(studioObservationProblems(row)).toEqual([]);
  });

  it('is deterministic: the same reading always yields the same evidence', () => {
    expect(analyse()).toEqual(drafts);
    expect(JSON.stringify(analyse())).toBe(JSON.stringify(drafts));
  });

  it('will not claim a business name the page never uses', () => {
    const stranger = analyse(fashionFacts({ title: 'Home', siteName: 'Another Studio', schemaNames: ['Another Studio'] }));
    const name = stranger.find((draft) => draft.key === 'unknown.name');
    expect(name?.classification).toBe('unknown');
    expect(stranger.some((draft) => draft.key === 'identity.name')).toBe(false);
  });

  it('notes a city mismatch instead of overwriting what the CRM holds', () => {
    const moved = analyse(fashionFacts({ schemaLocality: 'Kumasi' }));
    const location = moved.find((draft) => draft.key === 'identity.location');
    expect(location?.confidence).toBe(75);
    expect(location?.detail).toContain('confirm which is current');
  });
});

describe('brand intelligence from a silent page', () => {
  const drafts = analyse(silentFacts());

  it('turns every gap into a question for the business', () => {
    expect(keysOf(drafts, 'unknown')).toEqual(
      expect.arrayContaining([
        'unknown.name',
        'unknown.description',
        'unknown.location',
        'unknown.contact',
        'unknown.offering',
        'unknown.navigation',
        'unknown.palette',
        'unknown.logo',
        'unknown.imagery',
      ]),
    );
  });

  it('cites no evidence it does not have', () => {
    expect(keysOf(drafts, 'verified_fact')).toEqual(['accessibility.viewport_missing']);
    expect(drafts.some((draft) => draft.classification === 'restricted')).toBe(false);
    for (const unknown of drafts.filter((draft) => draft.classification === 'unknown')) {
      expect(unknown.reusePermission).toBe('unknown');
      expect(unknown.assetUrl).toBeNull();
    }
  });

  it('treats a 24-word page as a placeholder and proposes a mobile-first build', () => {
    expect(drafts.find((draft) => draft.key === 'placeholder.thin')?.detail).toContain('24 words');
    expect(drafts.find((draft) => draft.key === 'suggestion.mobile_first')?.classification).toBe('creative_suggestion');
  });
});

describe('a parked domain', () => {
  it('records one placeholder and stops, because there is nothing to build from', () => {
    const drafts = analyse(fashionFacts({ parked: true }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ key: 'placeholder.parked', classification: 'placeholder', reusePermission: 'prohibited' });
  });
});

describe('run helpers', () => {
  const rows = [...asRows(analyse(), 1), ...asRows(analyse(fashionFacts({ themeColor: null, colors: [] })), 2)];

  it('follow the newest run and list runs newest first', () => {
    expect(latestRunNumber(rows)).toBe(2);
    expect(latestRunNumber([])).toBe(0);
    expect(runsOf(rows)).toEqual([2, 1]);
    expect(latestObservations(rows).every((row) => row.runNumber === 2)).toBe(true);
    expect(observationsOfRun(rows, 1).every((row) => row.runNumber === 1)).toBe(true);
  });

  it('show facts before references, and count each class', () => {
    const latest = latestObservations(rows);
    const order = groupByClassification(latest).map((group) => group.classification);
    expect(order).toEqual(['verified_fact', 'unknown', 'placeholder', 'creative_suggestion', 'restricted']);
    const counts = countClassifications(latest);
    expect(counts.total).toBe(latest.length);
    expect(intelligenceSummary(counts)).toContain('verified fact');
  });
});

describe('reviews', () => {
  const review = (over: Partial<StudioReview>): StudioReview => ({
    id: 'review-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    observationId: 'obs-1',
    decision: 'confirm',
    note: '',
    reviewerId: 'user-1',
    createdAt: TODAY,
    ...over,
  });

  it('read the newest review and the latest real decision', () => {
    const reviews = [review({ id: 'new', decision: 'note', note: 'Checked the shop sign' }), review({ id: 'old', decision: 'reject', note: 'Wrong number', createdAt: '2026-10-24T09:00:00.000Z' })];
    expect(verificationOf('obs-1', reviews)?.note).toBe('Checked the shop sign');
    expect(decisionOf('obs-1', reviews)).toBe('reject');
    expect(decisionOf('obs-2', reviews)).toBeNull();
  });

  it('confirm without a note, but explain a rejection', () => {
    expect(studioReviewProblems({ projectId: 'project-1', observationId: 'obs-1', decision: 'confirm', note: '' })).toEqual([]);
    expect(studioReviewProblems({ projectId: 'project-1', observationId: 'obs-1', decision: 'reject', note: ' ' })).toEqual(['Explain the decision in a few words.']);
    expect(studioReviewProblems({ projectId: 'project-1', observationId: null, decision: 'note', note: 'x'.repeat(1001) })).toContain(
      'A review note is limited to 1,000 characters.',
    );
  });
});
