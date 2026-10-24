import { expect, test } from '@playwright/test';

// Discover in demo mode (fictional results, no paid calls): a whole region can be searched
// without a town, and the health categories are offered.

test('searches a whole region when no town is given, and needs a region or a town', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/discover');
  await expect(page.getByRole('heading', { level: 1, name: 'Discover' })).toBeVisible();

  const category = page.getByLabel('Category');
  for (const c of ['Clinic', 'Hospital', 'Herbal clinic', 'Pharmacy']) await expect(category.locator('option', { hasText: new RegExp(`^${c}$`) })).toHaveCount(1);
  await category.selectOption('Pharmacy');

  // No place is preselected. Kumasi is in Ashanti, so choosing Volta clears the town and the search
  // covers the region.
  await expect(page.getByLabel('Region')).toHaveValue('');
  await expect(page.getByLabel('City / town')).toHaveValue('');
  await page.getByLabel('Region').selectOption('Ashanti');
  await page.getByLabel('City / town').fill('Kumasi');
  await page.getByLabel('Region').selectOption('Volta');
  await expect(page.getByLabel('City / town')).toHaveValue('');
  await expect(page.getByText('Leave empty to search the whole region.')).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Fictional address, Volta Region').first()).toBeVisible();

  // A town in the chosen region narrows the search to that town; the region's main towns are offered.
  await page.getByRole('group', { name: 'Main towns in Volta' }).getByRole('button', { name: 'Hohoe' }).click();
  await expect(page.getByLabel('City / town')).toHaveValue('Hohoe');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Fictional address, Hohoe').first()).toBeVisible();

  await page.getByLabel('City / town').fill('');
  await page.getByLabel('Region').selectOption('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Choose a region or a city / town, and a category.')).toBeVisible();
  expect(errors).toEqual([]);
});
