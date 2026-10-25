import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { settleTransitions } from './settle';

const PAGES = [
  ['/', 'Overview'],
  ['/discover', 'Discover'],
  ['/prospects', 'Prospects'],
  ['/verification', 'Verification queue'],
  ['/contacts', 'Contacts'],
  ['/reports', 'Opportunity reports'],
  ['/proposals', 'Proposals'],
  ['/outreach', 'Outreach'],
  ['/outreach?tab=inbox', 'Outreach'],
  ['/outreach?tab=templates', 'Outreach'],
  ['/outreach?tab=policies', 'Outreach'],
  ['/outreach?tab=setup', 'Outreach'],
  ['/outreach?tab=audit', 'Outreach'],
  ['/automation', 'Automation Center'],
  ['/automation?tab=controls', 'Automation Center'],
  ['/pipeline', 'Sales pipeline'],
  ['/projects', 'Projects'],
  ['/studio', 'Website concepts'],
  ['/library', 'Website solution library'],
  ['/analytics', 'Analytics'],
  ['/settings', 'Settings'],
  ['/privacy', 'Privacy and data protection'],
] as const;

for (const [path, heading] of PAGES) {
  test(`${path} renders without errors and has no serious accessibility violations`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await settleTransitions(page);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${scheme}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}

test('every sidebar link leads to a page', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible(); // the sidebar renders after the workspace loads
  const hrefs = await nav.locator('a[href^="/"]').evaluateAll((links) => links.map((a) => a.getAttribute('href')!));
  expect(hrefs.length).toBeGreaterThanOrEqual(11);
  for (const href of hrefs) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test('command palette searches prospects and pages', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Search/ }).first().click();
  const palette = page.getByRole('dialog');
  await palette.getByRole('combobox').fill('analytics');
  await palette.getByRole('option', { name: /Analytics/ }).first().click();
  await expect(page).toHaveURL(/\/analytics$/);
});
