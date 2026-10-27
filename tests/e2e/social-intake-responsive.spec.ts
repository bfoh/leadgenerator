import { expect, test } from '@playwright/test';

// Bulk social intake on a phone: selection, the batch summary and the research panel must stay
// inside the viewport, with no horizontal scrolling at any phone width.

test('bulk social intake and its research panel fit a phone', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Social' }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const social = page.getByTestId('social-results');
  await expect(social).toBeVisible({ timeout: 15_000 });
  await expect(social.getByTestId('social-bulk-controls')).toBeVisible({ timeout: 15_000 });
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }

  await social.getByRole('button', { name: 'Select all', exact: true }).click();
  await social.getByRole('button', { name: 'Add selected to CRM (3)' }).click();
  const summary = page.getByTestId('social-intake-summary');
  await expect(summary).toContainText('3 added');

  await page.setViewportSize({ width: 390, height: 844 });
  await summary.getByRole('link').first().click();
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();
  await expect(page.getByTestId('social-research')).toBeVisible();
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});