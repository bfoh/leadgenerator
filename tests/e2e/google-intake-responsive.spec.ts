import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Google bulk intake on a phone: the selection bar, the per-result answers and the Place ID field
// must stay inside the viewport, with no horizontal scrolling at any phone width.

async function expectNoOverflow(page: import('@playwright/test').Page, widths = [360, 390, 768]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
}

async function expectNoSeriousViolations(page: import('@playwright/test').Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${label}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
}

test('a Google batch and its Place ID reference fit a phone', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/discover');
  await page.getByRole('radiogroup', { name: 'Discovery sources' }).getByRole('radio', { name: 'Google', exact: true }).click();
  await page.getByLabel('Category', { exact: true }).selectOption('Bakery');
  await page.getByLabel('Region').selectOption('Greater Accra');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const controls = page.getByTestId('places-bulk-controls');
  await expect(controls).toBeVisible({ timeout: 20_000 });
  await expectNoOverflow(page);

  await controls.getByRole('button', { name: 'Select all', exact: true }).click();
  await controls.getByRole('button', { name: 'Add selected to CRM (10)' }).click();
  const summary = page.getByTestId('places-intake-summary');
  await expect(summary).toContainText('10 added', { timeout: 30_000 });
  await expectNoOverflow(page);
  await expectNoSeriousViolations(page, 'google intake on a phone');

  await summary.getByRole('link').first().click();
  await expect(page.getByRole('link', { name: 'Collect Business Resources' })).toBeVisible();
  await expectNoOverflow(page);
});

test('the Place ID reference form fits a phone and saves without a source URL', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /Save Place ID as a research reference/ }).click();
  await expect(dialog.getByLabel('Google Place ID')).toBeVisible();
  await expect(dialog.getByLabel('Source URL')).toHaveCount(0);
  await expectNoOverflow(page);

  await dialog.getByLabel('Business name').fill('E2E Mobile Reference Bakery');
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Cape Coast');
  await dialog.getByLabel('Google Place ID').fill('ChIJmOBILEreferenceID0001');
  await dialog.getByRole('button', { name: 'Save reference' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Only the Place ID is stored.')).toBeVisible();
  await expectNoOverflow(page);
});
