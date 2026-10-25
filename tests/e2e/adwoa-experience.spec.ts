import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the image story paints reversible masks at actual scroll positions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/showcase/adwoas-house');
  await page.evaluate(() => document.fonts.ready);
  // Page arrival briefly transforms the containing block. Measure absolute story geometry only
  // after that entrance settles, otherwise a subpixel offset looks like a non-reversible mask.
  await expect(page.locator('[class*="heroLead"]').first()).toHaveCSS('opacity', '1');
  const story = page.locator('[data-variant="scroll-story"]');
  const second = story.locator('[data-story-step] h3').nth(1);
  const top = await second.evaluate((element) => element.getBoundingClientRect().top + scrollY);
  const seek = async (y: number) => {
    await page.evaluate((position) => scrollTo(0, position), y);
    await page.waitForTimeout(100);
    return story.locator('[data-story-frame]').evaluateAll((frames) => frames.map((frame) => getComputedStyle(frame).clipPath));
  };
  const first = await seek(top - 900);
  const middle = await seek(top - 540);
  const end = await seek(top);
  expect(first[1]).toContain('100%');
  expect(middle[1]).not.toEqual(first[1]);
  expect(middle[1]).not.toEqual(end[1]);
  expect(end[1]).toContain('0%');
  expect(await seek(top - 540)).toEqual(middle);
  expect(await story.locator('[data-story-stage]').evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
  const bounds = await story.locator('[data-story-stage]').boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(80);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  expect(await seek(top - 540)).toEqual(middle);
  await story.getByRole('link', { name: 'Skip the image story' }).click();
  await expect(page).toHaveURL(/#the-rhythm-of-the-house-end$/);
});

test('room selection is an explicit keyboard control', async ({ page }) => {
  await page.goto('/showcase/adwoas-house');
  const select = page.getByRole('button', { name: 'Above the garden' });
  await select.focus();
  await page.keyboard.press('Enter');
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[class*="indexPreviewFrame"][data-active] img')).toHaveAttribute('src', /room-upper/);
});

test('the photographic gallery supports arrows, Escape and focus return', async ({ page }) => {
  await page.goto('/showcase/adwoas-house/rooms');
  const opener = page.getByRole('button', { name: /Enlarge photograph 1/ });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Look a little closer photographs' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByText('2 / 3', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.getByText('1 / 3', { exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')).map((item) => item.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('changing the motion preference disposes the sticky timeline and restores it cleanly', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/showcase/adwoas-house');
  const story = page.locator('[data-variant="scroll-story"]');
  await expect(story).toHaveAttribute('data-story-ready', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-family]')).toHaveAttribute('data-motion', 'static');
  await expect(story).not.toHaveAttribute('data-story-ready');
  expect(await story.locator('[data-story-frame]').evaluateAll((frames) => frames.map((frame) => (frame as HTMLElement).style.getPropertyValue('--frame-reveal')))).toEqual(['', '', '']);
  await expect(story.locator('[data-story-step] img').first()).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(story).toHaveAttribute('data-story-ready', '');
});

test('a failed concept image leaves a labelled fallback and working navigation', async ({ page }) => {
  await page.route('**/concept-v2/arrival-*', (route) => route.abort());
  await page.goto('/showcase/adwoas-house');
  await expect(page.getByRole('heading', { level: 1, name: 'Arrive slowly.' })).toBeVisible();
  await expect(page.locator('[data-kind="hero"]').getByText('Image pending', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Rooms', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Room to exhale.' })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`contrast remains readable at every home-page section (${width}px)`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/showcase/adwoas-house');
    await expect(page.locator('[class*="heroLead"]').first()).toHaveCSS('opacity', '1');
    for (const section of await page.locator('main > section, footer').all()) {
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? '')).map((item) => `${item.id}: ${item.nodes[0]?.target}`)).toEqual([]);
    }
  });
}
