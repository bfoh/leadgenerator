import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Phase 6 in demo mode: template-driven drafts priced only from the workspace's own price list.
// Nothing leaves the machine and nothing is sent.

test('a draft follows the industry template, uses only configured prices and explains its choices', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Agency name (on proposals)').fill('E2E Matrix Studio');
  await page.getByRole('button', { name: 'Save agency settings' }).click();
  await expect(page.getByText('Agency settings saved')).toBeVisible();

  // Controlled price list: set one add-on price.
  await page.goto('/settings?tab=packages');
  await expect(page.getByRole('group', { name: 'Add-ons' })).toBeVisible();
  await page.getByLabel('Quote request builder · to be quoted — Price (GHS)').fill('1500');
  await page.getByRole('button', { name: 'Save packages' }).click();
  await expect(page.getByText('Packages saved')).toBeVisible();

  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill('E2E Takoradi Furniture House');
  await dialog.getByLabel('Category').fill('Furniture showroom');
  await dialog.getByLabel('City / town').fill('Takoradi');
  await dialog.getByLabel('Service needs').fill('Quote requests');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-proposals');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);

  await page.getByRole('tab', { name: /^Proposals/ }).click();
  await expect(page.getByLabel('Service package')).toHaveValue('business_plus');
  await expect(page.getByRole('option', { name: 'Business Website Plus (recommended)' })).toBeAttached();
  const planBox = page.getByTestId('proposal-plan');
  await expect(planBox).toContainText('Furniture showroom template · recommended package');
  await expect(planBox).toContainText('Quote request builder');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}$/);

  const basis = page.getByTestId('proposal-basis');
  await expect(basis).toContainText('Created by a person · Furniture showroom template');
  await expect(basis).toContainText('Quote request builder · in scope');
  await expect(basis).toContainText('Larger packages');

  await page.getByRole('tab', { name: 'Preview' }).click();
  const doc = page.getByTestId('proposal-document');
  await expect(doc.getByRole('row', { name: /Quote request builder/ })).toContainText('1,500.00');
  await expect(doc).toContainText('Prepared by E2E Matrix Studio.');
  await expect(doc).toContainText('We recommend the Business Website Plus.');
  // The team-only reasoning is not part of the client document.
  await expect(doc).not.toContainText('Larger packages');
  await expect(doc).not.toContainText('rules recommend');

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('the Proposal Generation agent is available and limited to drafts', async ({ page }) => {
  await page.goto('/automation?tab=agents');
  const available = page.getByRole('heading', { name: 'Available now' }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  await expect(available).toContainText('Proposal Generation');
  await expect(available).toContainText('Invent or change prices, approve, send or decide a proposal');
  await expect(available).toContainText('Needs mode: Research + proposals · No paid providers');
});
