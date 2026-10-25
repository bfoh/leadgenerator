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
