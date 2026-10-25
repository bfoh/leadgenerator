import { expect, test } from '@playwright/test';

// Real-browser motion tests. These assert that the blueprint's scene plan reached the DOM and that
// the browser is actually running the declared animation / scroll behaviour, not merely that a JSON
// field exists. The reduced-motion and no-JavaScript cases are first-class compositions.

test('Adwoa’s arrival plays a masked title, copy entrance and image reveal', async ({ page }) => {
  await page.goto('/showcase/adwoas-house');
  await page.waitForFunction(() => document.querySelector('[data-motion]')?.getAttribute('data-motion') === 'ready');
  const line = page.locator('[class*="heroLineInner"]').first();
  const state = await line.evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    animationDuration: getComputedStyle(element).animationDuration,
    runningAnimations: element.getAnimations().length,
    heroAnimation: getComputedStyle(document.querySelector('[data-motion-scene="arrival"] [class*="heroMedia"]')!).animationName,
    copyAnimation: getComputedStyle(document.querySelector('[class*="heroLead"]')!).animationName,
  }));
  expect(state.animationName).toContain('heroLineReveal');
  expect(state.animationDuration).not.toBe('0s');
  expect(state.runningAnimations).toBeGreaterThan(0);
  expect(state.heroAnimation).toContain('heroFrameReveal');
  expect(state.copyAnimation).toContain('heroCopyEnter');
  await expect
    .poll(async () => line.evaluate((element) => getComputedStyle(element).transform), { timeout: 2500 })
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
});

test('scroll progression and the sticky room register are observable', async ({ page }) => {
  await page.goto('/showcase/adwoas-house');
  const sequence = page.locator('section[data-kind="sequence"]').first();
  await sequence.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const first = await sequence.evaluate((element) => ({
    progress: element.style.getPropertyValue('--scene-progress'),
    y: element.style.getPropertyValue('--scene-y'),
    scene: element.getAttribute('data-motion-scene'),
    scroll: element.getAttribute('data-motion-scroll'),
  }));
  expect(first.scene).toBe('sequence');
  expect(first.scroll).toBe('drift');
  expect(Number(first.progress)).toBeGreaterThan(0);
  await page.evaluate(() => scrollBy(0, 700));
  await page.waitForTimeout(400);
  const second = await sequence.evaluate((element) => element.style.getPropertyValue('--scene-progress'));
  expect(Number(second)).toBeGreaterThan(Number(first.progress));

  const register = page.locator('section[data-kind="index"]').first();
  await register.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const sticky = await page.locator('[class*="indexPreview"]').first().evaluate((element) => ({
    position: getComputedStyle(element).position,
    frames: [...element.querySelectorAll('[class*="indexPreviewFrame"]')].map((frame) => frame.hasAttribute('data-active')),
  }));
  expect(sticky.position).toBe('sticky');
  expect(sticky.frames).toEqual([true, false, false]);
  await page.locator('ol[class*="indexList"] > li').nth(1).hover();
  await page.waitForTimeout(300);
  const afterHover = await page.locator('[class*="indexPreviewFrame"]').evaluateAll((frames) => frames.map((frame) => frame.hasAttribute('data-active')));
  expect(afterHover).toEqual([false, true, false]);
});

test('navigation arrives as a new scene and keeps the motion layer page-scoped', async ({ page }) => {
  await page.goto('/showcase/adwoas-house');
  await page.getByRole('link', { name: 'Rooms', exact: true }).first().click();
  await expect(page).toHaveURL(/\/showcase\/adwoas-house\/rooms$/);
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-site-page') === 'rooms');
  const state = await page.evaluate(() => ({
    page: document.querySelector('main')?.getAttribute('data-site-page'),
    animation: getComputedStyle(document.querySelector('main')!).animationName,
    motion: document.querySelector('[data-motion]')?.getAttribute('data-motion'),
    masks: document.querySelectorAll('[class*="heroLineMask"]').length,
  }));
  expect(state.page).toBe('rooms');
  expect(state.animation).toContain('pageVeil');
  expect(state.motion).toBe('ready');
  expect(state.masks).toBe(2);
});

test('reduced motion exposes a complete static composition with no running animation', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/showcase/adwoas-house');
  // The engine attaches on hydration. Wait for the attribute so the measurement is of the settled
  // reduced-motion state, not of the few milliseconds before the client effect has run.
  await expect(page.locator('[data-family]')).toHaveAttribute('data-motion', 'static');
  const state = await page.evaluate(() => {
    const root = document.querySelector('[data-motion]');
    const line = document.querySelector('[class*="heroLineInner"]');
    const hero = document.querySelector<HTMLElement>('[data-motion-scene="arrival"]');
    return {
      motion: root?.getAttribute('data-motion'),
      lineAnimation: line ? getComputedStyle(line).animationName : null,
      lineTransform: line ? getComputedStyle(line).transform : null,
      animations: line ? line.getAnimations().length : null,
      progress: hero ? hero.style.getPropertyValue('--scene-progress') : null,
      heading: document.querySelector('h1')?.getAttribute('aria-label'),
      lead: getComputedStyle(document.querySelector('[class*="heroLead"]')!).opacity,
    };
  });
  expect(state.motion).toBe('static');
  expect(state.lineAnimation).toBe('none');
  expect(state.lineTransform).toBe('none');
  expect(state.animations).toBe(0);
  expect(state.progress).toBe('');
  expect(state.heading).toBe('Arrive slowly.');
  expect(state.lead).toBe('1');
  await context.close();
});

test('the complete design is visible without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/showcase/adwoas-house');
  const state = await page.evaluate(() => ({
    h1: document.querySelector('h1')?.getAttribute('aria-label'),
    // The site root is addressed by its family attribute: asserting that the motion engine never
    // attached must not depend on the attribute whose absence is being asserted.
    motion: document.querySelector('[data-family]')?.getAttribute('data-motion') ?? null,
    lineTransform: getComputedStyle(document.querySelector('[class*="heroLineInner"]')!).transform,
    lineOpacity: getComputedStyle(document.querySelector('[class*="heroLineMask"]')!).opacity,
    images: document.querySelectorAll('main img').length,
  }));
  expect(state.h1).toBe('Arrive slowly.');
  expect(state.motion).toBeNull();
  expect(state.lineTransform).toBe('none');
  expect(state.lineOpacity).toBe('1');
  expect(state.images).toBeGreaterThanOrEqual(6);
  await context.close();
});

test('representative widths have no overflow or clipped hero lines', async ({ page }) => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.goto('/showcase/adwoas-house');
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => {
      const lines = [...document.querySelectorAll('[class*="heroLineMask"]')];
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        h1: Math.round(document.querySelector('h1')?.getBoundingClientRect().width ?? 0),
        clipped: lines
          .filter((line) => line.scrollWidth > line.clientWidth + 1 || line.scrollHeight > line.clientHeight + 1)
          .map((line) => line.textContent),
      };
    });
    expect(state.overflow, `width ${width}: document overflow`).toBeLessThanOrEqual(0);
    expect(state.h1, `width ${width}: hero width`).toBeLessThanOrEqual(width);
    expect(state.clipped, `width ${width}: clipped hero lines`).toEqual([]);
  }
});
