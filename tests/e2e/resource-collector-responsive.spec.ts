import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for (const withSite of [false, true]) test(`resource collector fits a phone ${withSite ? 'with' : 'without'} a website`, async ({ page }) => {
  await page.goto('/prospects?new=1');
  const form = page.getByRole('dialog', { name: 'Add research candidate' });
  await form.getByLabel('Business name').fill(`Phone Resources ${withSite ? 'Redesign' : 'New'}`);
  await form.getByLabel('Category').fill('Bakery');
  await form.getByLabel('City / town').fill('Cape Coast');
  await form.getByLabel('Source URL').fill('https://owner.example.org/phone');
  if (withSite) await form.getByLabel('Official website (if confirmed)').fill('https://resource-bakery.example.org');
  await form.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();
  await expect(page.getByText('Fictional test responses', { exact: true })).toBeVisible();
  await page.getByText('Find a Place ID', { exact: true }).click();
  await page.getByRole('button', { name: 'Search Google Places' }).click();
  await page.getByRole('button', { name: 'Choose listing' }).nth(withSite ? 1 : 0).click();
  await page.getByRole('button', { name: 'Load Google listing' }).click();
  await expect(page.getByTestId('google-listing')).toBeVisible();
  await page.getByRole('button', { name: 'Preview photo 1' }).click();
  await expect(page.getByRole('img', { name: 'Business photo preview 1' })).toBeVisible();
  if (withSite) {
    await page.getByRole('checkbox', { name: 'I independently verified that this website belongs to this business' }).check();
    await page.getByRole('button', { name: 'Analyze official website' }).click();
    await expect(page.getByTestId('website-resources')).toContainText('Celebration baking');
  }
  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `docs/evidence/resource-collector/phone-${withSite ? 'redesign' : 'no-website'}.jpg`, fullPage: true, type: 'jpeg', quality: 75 });
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
});
