import { expect, test } from '@playwright/test';

const PATHS = ['/', '/discover', '/prospects', '/verification', '/reports', '/proposals', '/automation', '/automation?tab=jobs', '/automation?tab=controls', '/pipeline', '/projects', '/studio', '/library', '/analytics', '/settings', '/settings?tab=packages', '/privacy'];

for (const path of PATHS) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('mobile navigation drawer opens and navigates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
});

test('the Creative direction tab fits a phone screen', async ({ page }) => {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill('E2E Mobile Creative Bakery');
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-mobile-creative');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('button', { name: 'Create website concept' }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: 'Creative direction' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Creative direction/ })).toBeVisible();
  await expect(page.getByText('An approved Brand Kit comes first')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
