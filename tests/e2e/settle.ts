import type { Page } from '@playwright/test';

/**
 * Waits for running CSS transitions to finish. Switching the colour scheme starts colour
 * transitions on many elements (`transition-colors`); axe measures contrast from the current
 * computed colours, so checking mid-fade reports contrast failures that no settled page has.
 */
export async function settleTransitions(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== 'running'));
}
