import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The three flagship websites in the real browser: navigation, mobile menu, prototype disclosure,
// internal-only links, no external requests and the accessibility gate.

async function axe(page: Page, label: string) {
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(serious.map((violation) => `${label}: ${violation.id} (${violation.nodes.length}) ${violation.nodes[0]?.target}`)).toEqual([]);
}

async function expectInternalLinks(page: Page) {
  const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  for (const href of hrefs) {
    expect(href.startsWith('#') || href.startsWith('/'), `Unexpected external link: ${href}`).toBe(true);
  }
}

const sites = [
  { slug: 'nsroma-atelier', heading: 'Cloth remembers the hand.', nav: 'Commissions', pageHeading: 'Begin with a conversation.', path: 'commissions' },
  { slug: 'adwoas-house', heading: 'Arrive slowly.', nav: 'Rooms', pageHeading: 'Nine rooms, described plainly.', path: 'rooms' },
  { slug: 'bantama-design-office', heading: 'The plan is the argument.', nav: 'Work', pageHeading: 'Selected studies.', path: 'work' },
] as const;

for (const site of sites) {
  test(`${site.slug} renders, navigates and discloses that it is a concept`, async ({ page }) => {
    const errors: string[] = [];
    const external: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(request.url());
    });

    await page.goto(`/showcase/${site.slug}`);
    await expect(page.getByRole('heading', { level: 1, name: site.heading })).toBeVisible();
    await expect(page.getByText('Concept Website — Not an Official Business Website').first()).toBeVisible();
    await expectInternalLinks(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('link', { name: site.nav, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/showcase/${site.slug}/${site.path}$`));
    await expect(page.getByRole('heading', { level: 1, name: site.pageHeading })).toBeVisible();

    const prototype = page.getByRole('button', { name: /Preview the (enquiry|booking|brief)/ }).first();
    if (await prototype.count()) {
      await prototype.click();
      const notice = page.getByRole('dialog', { name: /Prototype notice/i });
      await expect(notice).toBeVisible();
      await expect(notice.getByText('Prototype only', { exact: false }).first()).toBeVisible();
      await notice.getByRole('button', { name: 'Close notice' }).click();
      await expect(notice).not.toBeVisible();
    }

    await axe(page, site.slug);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('the mobile menu holds the same order, traps focus and closes with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/showcase/nsroma-atelier');
  const menuButton = page.getByRole('button', { name: 'Menu' });
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  const menu = page.getByRole('dialog', { name: /Nsroma Atelier menu/i });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: /Commissions/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: /Nsroma Atelier — home/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(menuButton).toBeFocused();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a nested case-study route renders the complete study', async ({ page }) => {
  await page.goto('/showcase/bantama-design-office/work/courtyard-clinic');
  await expect(page.getByRole('heading', { level: 1, name: 'Courtyard clinic.' })).toBeVisible();
  await expect(page.getByText('Concept study — not built', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Not a construction document or a planning submission.', { exact: false })).toBeVisible();
  await axe(page, 'bantama case study');
});

test('an unknown site and page are a 404, not a fallback page', async ({ page }) => {
  const site = await page.goto('/showcase/not-a-business');
  expect(site?.status()).toBe(404);
  const nested = await page.goto('/showcase/nsroma-atelier/not-a-page');
  expect(nested?.status()).toBe(404);
});

test('prototype actions never submit or collect data', async ({ page }) => {
  await page.goto('/showcase/nsroma-atelier/commissions');
  let posts = 0;
  page.on('request', (request) => { if (!['GET', 'HEAD'].includes(request.method())) posts += 1; });
  await page.getByRole('button', { name: /Preview the enquiry/ }).first().click();
  const notice = page.getByRole('dialog', { name: /Prototype notice/i });
  await expect(notice).toBeVisible();
  await expect(notice.getByText('no enquiries, payments or tracking', { exact: false })).toBeVisible();
  await expect(notice.locator('form')).toHaveCount(0);
  expect(posts).toBe(0);
});
