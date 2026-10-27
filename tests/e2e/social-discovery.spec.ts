import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// Social discovery in demo mode. External tools are simulated in this suite, so the labels must
// make the fiction obvious and no result may be presented as a stored record.

test('searches Google and social sources together and keeps social results clearly transient', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/discover');
  await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible();

  // Both sources are on by default.
  await expect(page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Both' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('group', { name: 'Social platforms' })).toBeVisible();

  await page.getByLabel('Category', { exact: true }).selectOption('Pharmacy');
  await page.getByLabel('Region').selectOption('Ashanti');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  // Google results still arrive, and the social section sits beside them.
  await expect(page.getByText('Fictional address, Ashanti Region').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Social profiles' })).toBeVisible();
  const social = page.getByTestId('social-results');
  await expect(social.getByText('Fictional demo data')).toBeVisible();
  await expect(social.getByText('Public profile results are review material only', { exact: false })).toBeVisible();
  await expect(social.getByText('not stored', { exact: false })).toBeVisible();

  // A profile can be reviewed, and the review dialog says the source is fictional.
  await page.getByRole('button', { name: 'Review & add' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Fictional profile')).toBeVisible();
  await expect(dialog.getByLabel('Business name')).toHaveValue(/fictional demo/);
  expect(errors).toEqual([]);
});

test('searches only social platforms when Google is switched off', async ({ page }) => {
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Social' }).click();

  // The Google provider control disappears and the platform choice takes its place.
  await expect(page.getByLabel('Provider', { exact: true })).toHaveCount(0);

  // One platform can be switched off without losing the others.
  await page.getByRole('group', { name: 'Social platforms' }).getByRole('button', { name: 'TikTok' }).click();
  await expect(page.getByRole('group', { name: 'Social platforms' }).getByRole('button', { name: 'TikTok' })).toHaveAttribute('aria-pressed', 'false');

  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Social profiles' })).toBeVisible();
  // Instagram and Facebook remain selected, so two fictional profiles appear and no TikTok one does.
  const results = page.getByTestId('social-results');
  await expect(results.getByText('Instagram', { exact: true })).toHaveCount(1);
  await expect(results.getByText('Facebook', { exact: true })).toHaveCount(1);
  await expect(results.getByText('TikTok', { exact: true })).toHaveCount(0);
  await expect(results.getByText('(fictional demo)', { exact: false })).toHaveCount(2);
});

test('slides back to Google results only, dropping the transient social list', async ({ page }) => {
  await page.goto('/discover');
  await expect(page.getByRole('group', { name: 'Social platforms' })).toBeVisible();

  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Google' }).click();
  await expect(page.getByRole('group', { name: 'Social platforms' })).toHaveCount(0);
  await expect(page.getByLabel('Provider', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Social profiles' })).toHaveCount(0);
});

test('adds selected social profiles in one batch, links their sources, and exports permitted research', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Social' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const social = page.getByTestId('social-results');
  await expect(social.getByTestId('social-bulk-controls')).toBeVisible();
  await social.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(social.getByText('3 of 3 selected')).toBeVisible();
  await social.getByRole('button', { name: 'Add selected to CRM (3)' }).click();

  const summary = page.getByTestId('social-intake-summary');
  await expect(summary).toContainText('3 added');
  await expect(summary).toContainText('0 existing');

  await summary.getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('fictional demo');
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();

  const research = page.getByTestId('social-research');
  await expect(research).toBeVisible();
  await expect(research.getByRole('heading', { level: 2, name: 'Social sources' })).toBeVisible();
  await expect(research.getByRole('heading', { level: 2, name: 'Social resource intelligence' })).toBeVisible();
  await expect(research.getByText('Observed', { exact: true }).first()).toBeVisible();
  await expect(research.getByText(/does not establish ownership, operating status or permission/).first()).toBeVisible();
  await expect(research.getByText('An independently verified official website.')).toBeVisible();

  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Website Resource Kit' }).click();
  const file = await downloaded;
  const zip = await readFile((await file.path())!);
  const text = zip.toString();
  expect(text).toContain('social-sources.json');
  expect(text).toContain('research-observations.json');
  expect(text).toContain('RESEARCH-BRIEF.md');
  expect(text).toContain('fictional demo');
  expect(text).not.toContain('Fictional address');

  // Retrying the same search reports existing prospects and creates nothing new.
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Social' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const retrySocial = page.getByTestId('social-results');
  await expect(retrySocial.getByTestId('social-bulk-controls')).toBeVisible({ timeout: 15_000 });
  await retrySocial.getByRole('button', { name: 'Select all', exact: true }).click();
  await retrySocial.getByRole('button', { name: 'Add selected to CRM (3)' }).click();
  const retrySummary = page.getByTestId('social-intake-summary');
  await expect(retrySummary).toContainText('0 added');
  await expect(retrySummary).toContainText('3 existing');
});

test('saves no live profile until a lawful retention basis is chosen', async ({ page }) => {
  const live = {
    platform: 'instagram',
    handle: 'permitted.bakery',
    profileUrl: 'https://www.instagram.com/permitted.bakery/',
    displayName: 'Search-only title that must never be stored',
    snippet: 'Search-only snippet that must never be stored',
    sourceQuery: 'site:instagram.com "bakery"',
    location: { region: 'Greater Accra', city: null, country: 'GH' },
    confidence: 0.8,
    verification: 'likely_official',
    evidence: ['Result text mentions “bakery”.'],
    duplicateOf: null,
    simulated: false,
  };
  await page.route('**/api/discover/social', (route) =>
    route.fulfill({ json: { candidates: [live], queries: [], simulated: false, retained: false, usage: null, retrievedAt: new Date().toISOString() } }),
  );
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Social' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const social = page.getByTestId('social-results');
  await social.getByRole('checkbox', { name: 'Select permitted.bakery' }).check();
  await social.getByRole('button', { name: 'Add selected to CRM (1)' }).click();
  const summary = page.getByTestId('social-intake-summary');
  await expect(summary).toContainText('0 added');
  await expect(summary).toContainText('1 need permitted source');
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain('Search-only title');
  expect(persisted).not.toContain('Search-only snippet');

  await social.getByRole('combobox', { name: 'Why may these profile links be kept?' }).selectOption('first_party_observation');
  await social.getByRole('checkbox', { name: 'Select permitted.bakery' }).check();
  await social.getByRole('button', { name: 'Add selected to CRM (1)' }).click();
  await expect(summary).toContainText('1 added');
  const after = await page.evaluate(() => JSON.stringify(localStorage));
  expect(after).not.toContain('Search-only title');
  expect(after).not.toContain('Search-only snippet');
});
