import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Phone layout of the visual acquisition queue: discovery, one authorized import, one reference-only
// card and the requirements list, at three widths, with no horizontal overflow.

const SITE = 'https://resource-hotel.example.org';

test('visual asset collection fits a phone', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/prospects?new=1');
  const form = page.getByRole('dialog', { name: 'Add research candidate' });
  await form.getByLabel('Business name').fill('Phone Harbour Hotel');
  await form.getByLabel('Category').fill('Hotel');
  await form.getByLabel('City / town').fill('Cape Coast');
  await form.getByLabel('Source URL').fill('https://owner.example.org/phone-hotel-authorization');
  await form.getByLabel('Official website (if confirmed)').fill(SITE);
  await form.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();
  await page.getByRole('checkbox', { name: 'I independently verified that this website belongs to this business' }).check();
  await page.getByRole('button', { name: 'Analyze official website' }).click();
  await expect(page.getByTestId('website-resources')).toContainText('Fictional Harbour Hotel');

  const panel = page.getByTestId('visual-assets');
  await panel.getByRole('button', { name: 'Find visual assets' }).click();
  await expect(panel.getByRole('heading', { name: 'Awaiting a rights decision (6)' })).toBeVisible();

  await panel.getByRole('listitem').filter({ hasText: 'Harbour Hotel logo' }).first().getByRole('button', { name: 'Authorize and import' }).click();
  const dialog = page.getByRole('dialog', { name: /Authorize “Harbour Hotel logo”/ });
  await dialog.getByLabel('Rights evidence').fill('Verified homepage read on 31 October 2026; the hotel publishes its own logo.');
  await dialog.getByRole('checkbox', { name: /own verified website/ }).check();
  await dialog.getByRole('button', { name: 'Read and store a copy' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel).toContainText('Approval queue (1)');

  for (const width of [360, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'docs/evidence/resource-collector/visual-assets-phone.jpg', fullPage: true, type: 'jpeg', quality: 75 });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
});
