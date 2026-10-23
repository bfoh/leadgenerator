import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Accessibility review (phase 10), beyond the page sweep in navigation.spec.ts: every tab of a
// prospect profile, the proposal editor and the print views, in light and dark; keyboard use (skip
// link, dialogs that trap and return focus, tabs by arrow keys); and reduced motion. WCAG 2.1 AA.

async function axe(page: Page, label: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label} (${scheme}): ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function newProspect(page: Page) {
  await page.goto('/prospects?new=1');
  const add = page.getByRole('dialog', { name: 'Add research candidate' });
  await add.getByLabel('Business name').fill('E2E Access Bakery');
  await add.getByLabel('Category').fill('Bakery');
  await add.getByLabel('City / town').fill('Accra');
  await add.getByLabel('Source URL').fill('https://example.org/directory/e2e-access');
  await add.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Access Bakery' })).toBeVisible();
  return page.url();
}

test('every prospect profile tab, the proposal editor and the print views pass axe in light and dark', async ({ page }) => {
  // Twelve views, two themes each: more than the default minute when the suite runs in parallel.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = await newProspect(page);
  for (const tab of ['overview', 'verification', 'audit', 'score', 'contacts', 'next', 'reports', 'proposals', 'activity']) {
    await page.goto(`${url}?tab=${tab}`);
    await expect(page.getByRole('tab', { selected: true })).toBeVisible();
    await axe(page, `profile ${tab}`);
  }

  await page.goto(`${url}?tab=proposals`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}$/);
  const proposalId = new URL(page.url()).pathname.split('/').pop();
  await expect(page.getByLabel(/unit price$/).first()).toBeVisible();
  await axe(page, 'proposal editor');
  await page.goto(`/print/proposals/${proposalId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await axe(page, 'proposal print');
  await page.goto(`/print/meetings/${new URL(url).pathname.split('/').pop()}`);
  await expect(page.getByTestId('meeting-brief')).toBeVisible();
  await axe(page, 'meeting brief');
  expect(errors).toEqual([]);
});

test('keyboard: the skip link reaches the content, dialogs keep and return focus, tabs move by arrow keys', async ({ page }) => {
  await page.goto('/prospects');
  await expect(page.getByRole('heading', { level: 1, name: 'Prospects' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  // A dialog opened from the keyboard takes focus, keeps Tab inside, closes on Escape and gives focus back.
  const open = page.getByRole('button', { name: 'Add candidate' }).first();
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  // Tabs follow the ARIA pattern: arrow keys move between them.
  await newProspect(page);
  const first = page.getByRole('tab', { name: 'Overview' });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Website verification' })).toBeFocused();
});

test('reduced motion turns animations and transitions off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const durations = await page.evaluate(() =>
    [...document.querySelectorAll('body *')].slice(0, 400).flatMap((el) => {
      const s = getComputedStyle(el);
      return [s.animationDuration, s.transitionDuration].flatMap((d) => d.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000)));
    }),
  );
  expect(Math.max(0, ...durations.filter((d) => !Number.isNaN(d)))).toBeLessThanOrEqual(0.01);
});
