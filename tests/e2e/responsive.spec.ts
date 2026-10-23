import { expect, test } from '@playwright/test';

const PATHS = ['/', '/discover', '/prospects', '/verification', '/reports', '/proposals', '/automation', '/automation?tab=jobs', '/automation?tab=controls', '/pipeline', '/projects', '/library', '/analytics', '/settings', '/settings?tab=packages', '/privacy'];

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
