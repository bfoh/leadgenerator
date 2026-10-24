import { expect, test } from '@playwright/test';

// Milestone 3A.1: Analytics reports every industry group, and each group drills down to the exact
// stored category labels behind it.

test('analytics groups prospects by industry and drills into the stored category', async ({ page }) => {
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Industry performance' })).toBeVisible();

  const groups = page.getByTestId('industry-group');
  await expect(groups.first()).toBeVisible();
  // Thirty catalogue groups, plus a bucket only if a workspace label outside the catalogue exists.
  expect(await groups.count()).toBeGreaterThanOrEqual(30);

  const furniture = groups.filter({ hasText: 'Furniture, Home & Interiors' });
  await expect(furniture).toContainText('open');
  await furniture.locator('summary').click();

  const category = furniture.getByRole('link', { name: 'Furniture showroom', exact: true });
  await expect(category).toBeVisible();
  await category.click();

  await expect(page).toHaveURL(/\/prospects\?category=Furniture%20showroom&stage=all$/);
  await expect(page.getByLabel('Filter by category')).toHaveValue('Furniture showroom');
  // The filtered table shows the records; the same text inside the select is not visible.
  await expect(page.getByRole('table').getByText('Furniture showroom').first()).toBeVisible();
});
