import { expect, test, type Page } from '@playwright/test';

// Naming several Google references at once, in demo mode with SIMULATE_EXTERNAL_TOOLS=true: every
// search and page read comes from the labelled simulated world, so nothing leaves the test server and
// nothing is billed. A batch run writes nothing — it returns a reading per record — and the readings are
// written only when a person approves a reviewed selection and confirms it.

/** Saves a Place ID reference, the way an operator creates one from a listing they cannot store. */
async function addReference(page: Page, placeId: string) {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /Save Place ID as a research reference/ }).click();
  await dialog.getByLabel('Business name').fill('');
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  await dialog.getByLabel('Google Place ID').fill(placeId);
  await dialog.getByRole('button', { name: 'Save reference' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
}

test('names two Google references in one batch, and writes nothing on its own', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await addReference(page, 'ChIJrTLr-GyuEmsRBfy61i59si0');
  await addReference(page, 'ChIJN1t_tDeuEmsRUsoyG83frY4');

  await page.goto('/prospects');
  await page.getByLabel('Search prospects').fill('Unverified place');
  await expect(page.getByRole('checkbox', { name: /^Select Unverified place/ })).toHaveCount(2);
  await page.getByRole('checkbox', { name: 'Select Unverified place I59SI0' }).check();
  await page.getByRole('checkbox', { name: 'Select Unverified place 83FRY4' }).check();

  // The plan comes first: which name each check searches for, and what the run may spend.
  await page.getByRole('button', { name: 'Identify 2 references' }).click();
  const dialog = page.getByRole('dialog', { name: 'Identify Google references' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Simulated searches: nothing leaves this machine and nothing is billed.');
  // A reference label is not a business name, so the run cannot start until both are named.
  await expect(dialog.getByRole('button', { name: 'Check 0 records' })).toBeDisabled();

  await dialog.getByLabel('Business name for Unverified place I59SI0').fill('E2E Identity Bakery');
  await dialog.getByLabel('Business name for Unverified place 83FRY4').fill('E2E Chale Chops');
  await dialog.getByRole('checkbox', { name: 'Run these 2 checks now' }).check();
  await dialog.getByRole('button', { name: 'Check 2 records' }).click();

  // Both checks answer with a reading, and the row says which name was searched for.
  const batch = page.getByTestId('identity-batch');
  await expect(batch.getByText('2 of 2 checked', { exact: false })).toBeVisible({ timeout: 60_000 });
  await expect(batch.getByText('searched “E2E Identity Bakery”')).toBeVisible();
  await expect(batch.getByText('searched “E2E Chale Chops”')).toBeVisible();
  await expect(batch.getByText('Waiting')).toHaveCount(0);
  await expect(batch.getByText('Checking')).toHaveCount(0);

  // Nothing was written: the reference still carries only its Place ID and its own label.
  // The footer button and the icon button are both named "Close"; the footer one ends the dialog.
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel('Search prospects').fill('Unverified place I59SI0');
  await page.getByRole('link', { name: 'Unverified place I59SI0', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Unverified place I59SI0' })).toBeVisible();
  await expect(page.getByText('Only the Place ID is stored.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('approves two independently supported identities in one confirmed action', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await addReference(page, 'ChIJrTLr-GyuEmsRBfy61i59si0');
  await addReference(page, 'ChIJN1t_tDeuEmsRUsoyG83frY4');

  await page.goto('/prospects');
  await page.getByLabel('Search prospects').fill('Unverified place');
  await page.getByRole('checkbox', { name: 'Select Unverified place I59SI0' }).check();
  await page.getByRole('checkbox', { name: 'Select Unverified place 83FRY4' }).check();
  await page.getByRole('button', { name: 'Identify 2 references' }).click();

  const dialog = page.getByRole('dialog', { name: 'Identify Google references' });
  await expect(dialog).toBeVisible();
  // A single-token name is what the simulated world publishes about itself, so the reading is a real
  // identification rather than a namesake: the source page is the only site that stands for the place.
  await dialog.getByLabel('Business name for Unverified place I59SI0').fill('Adwoabakery');
  await dialog.getByLabel('Business name for Unverified place 83FRY4').fill('Chalechops');
  await dialog.getByRole('checkbox', { name: 'Run these 2 checks now' }).check();
  await dialog.getByRole('button', { name: 'Check 2 records' }).click();

  // The review names the source and the evidence for each row, and offers a decision on each.
  const review = page.getByTestId('identity-review');
  await expect(review.getByText('2 of 2 checked', { exact: false })).toBeVisible({ timeout: 60_000 });
  await expect(review.getByText('Independently supported', { exact: true })).toHaveCount(2);
  await expect(review.getByText('adwoabakery.com')).toBeVisible();

  // Nothing is approved until the person selects it.
  await expect(dialog.getByRole('button', { name: 'Approve 0 identities' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Select all 2 eligible' }).click();
  await expect(dialog.getByRole('button', { name: 'Approve 2 identities' })).toBeEnabled();

  // The confirmation names exactly the records that will change, with their Place IDs.
  await dialog.getByRole('button', { name: 'Approve 2 identities' }).click();
  const confirm = page.getByTestId('identity-approval-confirm');
  await expect(confirm).toContainText('Unverified place I59SI0');
  await expect(confirm).toContainText('Adwoabakery');
  await expect(confirm).toContainText('Chalechops');
  await expect(confirm).toContainText('Place ID …i59si0');
  await dialog.getByRole('button', { name: 'Approve 2 and update the CRM' }).click();

  // Per-record results, with a link to each updated prospect.
  const results = page.getByTestId('identity-approval-result');
  await expect(results.getByText('2 changed', { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(results.getByText('Approved')).toHaveCount(2);
  await expect(results.getByRole('link', { name: 'Open the updated prospect' })).toHaveCount(2);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // The records really changed, and each still carries its Place ID.
  await page.goto('/prospects');
  await page.getByLabel('Search prospects').fill('Adwoabakery');
  await page.getByRole('link', { name: 'Adwoabakery', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Adwoabakery' })).toBeVisible();
  await expect(page.getByText('Only the Place ID is stored.')).toBeVisible();
  await expect(page.getByText('ChIJrTLr-GyuEmsRBfy61i59si0')).toBeVisible();
  expect(errors).toEqual([]);
});

