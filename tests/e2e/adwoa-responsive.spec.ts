import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const slug of ['home', 'house', 'rooms', 'day', 'cape-coast', 'stay']) {
  test(`Adwoa ${slug} is composed at phone, tablet and desktop widths`, async ({ page }) => {
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto(`/showcase/adwoas-house${slug === 'home' ? '' : `/${slug}`}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('[class*="heroLead"]').first()).toHaveCSS('opacity', '1');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${slug}/${width}`).toBeLessThanOrEqual(0);
      const clipped = await page.locator('[class*="heroLineMask"]').evaluateAll((lines) => lines.filter((line) => line.scrollWidth > line.clientWidth + 1 || line.scrollHeight > line.clientHeight + 1).map((line) => line.textContent));
      expect(clipped, `${slug}/${width}: heading clipping`).toEqual([]);
      if (width === 390 || width === 1440) {
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')).map((violation) => `${violation.id}: ${violation.nodes[0]?.target}`), `${slug}/${width}`).toEqual([]);
      }
    }
  });
}

test('phone arrival uses its portrait source and the menu returns keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/showcase/adwoas-house');
  await expect(page.locator('[data-kind="hero"] img')).toHaveJSProperty('complete', true);
  expect(await page.locator('[data-kind="hero"] img').evaluate((image) => (image as HTMLImageElement).currentSrc)).toContain('arrival-mobile');
  await expect(page.locator('[data-variant="scroll-story"]')).not.toHaveAttribute('data-story-ready');
  const button = page.getByRole('button', { name: 'Menu', exact: true });
  await button.click();
  await expect(page.getByRole('dialog', { name: /Adwoa.*menu/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(page.getByRole('button', { name: 'Above the garden' })).toBeEnabled();
});
