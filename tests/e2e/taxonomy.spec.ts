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

test('the prospects filter groups stored categories and honours an analytics deep link', async ({ page }) => {
  await page.goto('/prospects?category=Furniture%20showroom&stage=all');
  await expect(page.getByLabel('Filter by category')).toHaveValue('Furniture showroom');
  // The stored label is offered inside its industry group rather than in one flat list.
  await expect(page.locator('optgroup[label="Furniture, Home & Interiors"]')).toHaveCount(1);
  await expect(page.getByRole('table').getByText('Furniture showroom').first()).toBeVisible();
});

test('discover shows a licensing note for regulated trades and can search a whole group', async ({ page }) => {
  await page.goto('/discover');
  const category = page.getByRole('combobox', { name: 'Category' });

  await category.selectOption('Pharmacy');
  await expect(page.getByTestId('compliance-note')).toContainText('Pharmacy Council');

  await category.selectOption('Furniture showroom');
  await expect(page.getByTestId('compliance-note')).toHaveCount(0);

  // A whole group is a valid search target; the note follows the activity, not the group.
  await category.selectOption({ label: 'All Hotels, Lodging & Tourism industries' });
  await expect(category).toHaveValue('Hotels, Lodging & Tourism');
  await expect(page.getByTestId('compliance-note')).toHaveCount(0);
});
