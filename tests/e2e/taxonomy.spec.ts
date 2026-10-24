import { expect, test } from '@playwright/test';

// Milestone 3A: the Ghana-wide catalogue is reachable from both pickers, and a workspace can still
// file a business under a category the product does not ship.

test('the settings category tab lists the grouped catalogue and filters it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/settings?tab=categories');
  await expect(page.getByText(/focus categor/)).toBeVisible();

  await page.getByLabel('Industry group').selectOption({ label: 'Food, Drink & Catering (16)' });
  await expect(page.getByRole('checkbox', { name: 'Waakye joint' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Pharmacy' })).toHaveCount(0);

  await page.getByLabel('Industry group').selectOption('');
  await page.getByLabel('Find a category').fill('susu');
  await expect(page.getByRole('checkbox', { name: 'Susu collection & savings' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Waakye joint' })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the prospect form offers the grouped catalogue and accepts a custom category', async ({ page }) => {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  const options = dialog.locator('#category-options');

  // Local trading terms are offered, grouped by industry.
  await expect(options.locator('option[value="Waakye joint"]')).toHaveCount(1);
  await expect(options.locator('option[value="Galamsey"]')).toHaveCount(0);
  await expect(options.locator('optgroup[label="Agriculture & Crop Farming"]')).toHaveCount(1);

  // A custom category is still accepted, because the field is free text.
  await dialog.getByLabel('Business name').fill('Auntie Ama Waakye');
  await dialog.getByLabel('Category').fill('Waakye joint');
  await dialog.getByLabel('City / town').fill('Tamale');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-taxonomy');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Waakye joint').first()).toBeVisible();
});
