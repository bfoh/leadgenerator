import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Google Places bulk intake in demo mode (fictional results, no paid calls): one selection, one
// action, and a per-result answer. The Add research candidate dialog is checked too, because a
// Place ID reference and an independently supported candidate are different things.

async function noSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
}

async function search(page: Page, source: 'Google' | 'Social' | 'Both') {
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: source, exact: true }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test('adds a Google batch in one action, then repeats it without creating duplicates', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await search(page, 'Google');

  const controls = page.getByTestId('places-bulk-controls');
  await expect(controls).toBeVisible({ timeout: 15_000 });
  // Twenty results are offered; the demo provider returns its ten fictional rows.
  await expect(page.getByRole('checkbox', { name: /^Select DEMO · / })).toHaveCount(10);

  await controls.getByRole('button', { name: 'Select all', exact: true }).click();
  await controls.getByRole('button', { name: 'Add selected to CRM (10)' }).click();

  const summary = page.getByTestId('places-intake-summary');
  await expect(summary).toBeVisible({ timeout: 20_000 });
  await expect(summary).toContainText('10 added');
  // Every added row links to the prospect it created, so the research workflow is one click away.
  await expect(summary.getByRole('link')).toHaveCount(10);
  await noSeriousViolations(page, 'google intake results');

  // Running the same batch again is idempotent: nothing new is written.
  await controls.getByRole('button', { name: 'Select all', exact: true }).click();
  await controls.getByRole('button', { name: 'Add selected to CRM (10)' }).click();
  await expect(page.getByTestId('places-intake-summary')).toContainText('0 added');
  await expect(page.getByTestId('places-intake-summary')).toContainText('10 existing');

  // A created reference opens the permitted research workflow.
  await page.getByTestId('places-intake-summary').getByRole('link').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Collect Business Resources' })).toBeVisible();
  expect(errors).toEqual([]);
});


test('a combined Google and social selection is one batch with one result line', async ({ page }) => {
  test.setTimeout(120_000);
  await search(page, 'Both');

  const combined = page.getByTestId('combined-bulk-controls');
  await expect(combined).toBeVisible({ timeout: 20_000 });
  const googleRows = page.getByRole('checkbox', { name: /^Select DEMO · / });
  const socialRows = page.getByRole('checkbox', { name: /^Select (?!DEMO)/ });
  await expect(googleRows.first()).toBeVisible();
  await expect(socialRows.first()).toBeVisible({ timeout: 20_000 });

  await googleRows.first().check();
  await socialRows.first().check();
  await combined.getByRole('button', { name: 'Add selected to CRM (2)' }).click();

  await expect(page.getByTestId('places-intake-summary')).toContainText('1 added');
  await expect(page.getByTestId('social-intake-summary')).toContainText('1 added');
  const batch = page.getByTestId('combined-intake-summary');
  await expect(batch).toContainText('Batch result (2 results)');
  await expect(batch).toContainText('2 added');
});

test('the Add research candidate dialog separates a Place ID reference from independent details', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await expect(dialog).toBeVisible();

  // Independent mode is the default: it asks for the source it can cite.
  await expect(dialog.getByLabel('Source URL')).toBeVisible();
  await dialog.getByLabel('Business name').fill('E2E Provenance Bakery');
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Kumasi');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(dialog.getByText(/Source URL: Add the page where you confirmed these details/)).toBeVisible();
  await expect(dialog.getByText('Check the highlighted fields.')).toHaveCount(0);

  // Reference mode asks for the Place ID instead, and never for a non-Google URL.
  await dialog.getByRole('radio', { name: /Save Place ID as a research reference/ }).click();
  await expect(dialog.getByLabel('Source URL')).toHaveCount(0);
  await expect(dialog.getByText(/no Google request is made/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save reference' }).click();
  await expect(dialog.getByText(/Google Place ID: Paste the Google Place ID/)).toBeVisible();

  await dialog.getByLabel('Google Place ID').fill('Adwoa Boutique, Kumasi');
  await dialog.getByRole('button', { name: 'Save reference' }).click();
  await expect(dialog.getByText(/Google Place ID: Paste the Google Place ID/)).toBeVisible();

  // A reference needs no invented name: the placeholder is derived from the Place ID itself.
  await dialog.getByLabel('Business name').fill('');
  await dialog.getByLabel('Google Place ID').fill('ChIJrTLr-GyuEmsRBfy61i59si0');
  await dialog.getByRole('button', { name: 'Save reference' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Unverified place I59SI0' })).toBeVisible();
  await expect(page.getByText('Only the Place ID is stored.')).toBeVisible();
  await expect(page.getByText('ChIJrTLr-GyuEmsRBfy61i59si0', { exact: true })).toBeVisible();
  // The listing name the operator typed is never kept as a business detail.
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText('Adwoa Boutique, Kumasi');
  await noSeriousViolations(page, 'place id reference profile');
});
