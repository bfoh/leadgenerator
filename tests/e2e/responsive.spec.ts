import { expect, test } from '@playwright/test';

const PATHS = ['/', '/discover', '/prospects', '/verification', '/reports', '/proposals', '/automation', '/automation?tab=jobs', '/automation?tab=controls', '/pipeline', '/projects', '/studio', '/library', '/analytics', '/settings', '/settings?tab=packages', '/privacy'];

for (const path of PATHS) {
  test(`${path} fits a phone screen`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('mobile navigation drawer opens and navigates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
});

test('the Creative direction tab fits a phone screen', async ({ page }) => {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill('E2E Mobile Creative Bakery');
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-mobile-creative');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('button', { name: 'Create website concept' }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: 'Creative direction' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Creative direction/ })).toBeVisible();
  await expect(page.getByText('An approved Brand Kit comes first')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the identity review fits a phone screen and offers a decision per record', async ({ page }) => {
  test.setTimeout(150_000);
  const addReference = async (placeId: string) => {
    await page.goto('/prospects?new=1');
    const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
    await dialog.getByRole('radio', { name: /Save Place ID as a research reference/ }).click();
    await dialog.getByLabel('Business name').fill('');
    await dialog.getByLabel('Category').fill('Bakery');
    await dialog.getByLabel('City / town').fill('Accra');
    await dialog.getByLabel('Google Place ID').fill(placeId);
    await dialog.getByRole('button', { name: 'Save reference' }).click();
    await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  };

  await addReference('ChIJrTLr-GyuEmsRBfy61i59si0');
  await addReference('ChIJN1t_tDeuEmsRUsoyG83frY4');

  await page.goto('/prospects');
  await page.getByLabel('Search prospects').fill('Unverified place');
  await page.getByRole('checkbox', { name: 'Select Unverified place I59SI0' }).check();
  await page.getByRole('checkbox', { name: 'Select Unverified place 83FRY4' }).check();
  await page.getByRole('button', { name: 'Identify 2 references' }).click();

  const dialog = page.getByRole('dialog', { name: 'Identify Google references' });
  await dialog.getByLabel('Business name for Unverified place I59SI0').fill('Mobilebakery');
  await dialog.getByLabel('Business name for Unverified place 83FRY4').fill('Mobilechops');
  await dialog.getByRole('checkbox', { name: 'Run these 2 checks now' }).check();
  await dialog.getByRole('button', { name: 'Check 2 records' }).click();

  const review = page.getByTestId('identity-review');
  await expect(review.getByText('2 of 2 checked', { exact: false })).toBeVisible({ timeout: 60_000 });
  // Each row states its source, verification and duplicates in a labelled list, so the same review is
  // readable at phone width without a horizontally scrolling table.
  await expect(review.getByText('Independent supporting source')).toHaveCount(2);
  await expect(review.getByText('Possible CRM duplicates')).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The decision controls are reachable, expose their pressed state and gate the confirmation.
  await dialog.getByRole('button', { name: 'Select all 2 eligible' }).click();
  await expect(dialog.getByRole('button', { name: 'Approve 2 identities' })).toBeEnabled();
  await expect(review.getByRole('button', { name: 'Approve', exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Deselect all' }).click();
  await expect(dialog.getByRole('button', { name: 'Approve 0 identities' })).toBeDisabled();
});

