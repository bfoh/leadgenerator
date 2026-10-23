import { expect, test, type Page } from '@playwright/test';

// Demo mode: every test starts with a fresh browser context, so localStorage holds only the
// seeded research records.

async function addCandidate(page: Page, name: string) {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill(name);
  await dialog.getByLabel('Category').fill('Furniture showroom');
  await dialog.getByLabel('City / town').fill('Kumasi');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('research → verification → qualification → report → proposal → CRM', async ({ page }) => {
  const name = 'E2E Kumasi Furniture Works';
  await addCandidate(page, name);
  await expect(page.getByText('Not yet verified').first()).toBeVisible();

  // Qualification is gated on a recorded verification.
  await page.getByRole('button', { name: `Change stage for ${name}` }).click();
  await expect(page.getByRole('menuitem', { name: /Qualified/ })).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');

  // Website verification: "No official website found" needs two documented methods.
  await page.getByRole('tab', { name: 'Website verification' }).click();
  await page.getByRole('radio', { name: /No official website found/ }).check();
  await page.getByLabel('Evidence summary').fill('Searched the exact name with Kumasi and checked likely .com.gh domains; nothing official found.');
  await page.getByRole('button', { name: 'Record verification' }).click();
  await expect(page.getByText(/at least two documented methods/)).toBeVisible();
  await page.getByLabel('Searched exact business name + city').check();
  await page.getByLabel('Checked candidate domains').check();
  await page.getByRole('button', { name: 'Record verification' }).click();
  await expect(page.getByText('No official website found').first()).toBeVisible();

  // Now qualification is allowed, but outreach stays locked until permission is recorded.
  await page.getByRole('button', { name: `Change stage for ${name}` }).click();
  await expect(page.getByRole('menuitem', { name: /Contact authorized/ })).toHaveAttribute('data-disabled', '');
  await page.getByRole('menuitem', { name: /Qualified/ }).click();
  await expect(page.getByText('Moved to Qualified')).toBeVisible();

  // Opportunity report (rule-based, no API key needed).
  await page.getByRole('tab', { name: /^Reports/ }).click();
  await page.getByRole('button', { name: 'Rule-based report' }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/did not find an official website for E2E Kumasi Furniture Works\. This is not proof that none exists/).first()).toBeVisible();

  // Draft proposal from the report: prices are never invented.
  await page.goBack();
  await page.getByRole('tab', { name: /^Proposals/ }).click();
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByText('DRAFT — not approved for sending')).toBeVisible();
  await expect(page.getByText('To be quoted').first()).toBeVisible();

  // CRM: the prospect appears in the pipeline at its new stage.
  await page.goto('/pipeline');
  await expect(page.getByText(name).first()).toBeVisible();
});

test('contact permission unlocks outreach stages and opt-out blocks them', async ({ page }) => {
  const name = 'E2E Accra Bridal House';
  await addCandidate(page, name);
  await page.getByRole('tab', { name: 'Contacts' }).click();
  await page.getByRole('radio', { name: /^Permission granted/ }).check();
  await page.getByRole('button', { name: 'Save permission' }).click();
  await expect(page.getByText('Select the lawful basis for contact')).toBeVisible();
  await page.getByLabel('Lawful basis').selectOption({ index: 1 });
  await page.getByLabel('Evidence').fill('Owner messaged the agency on Instagram asking for a website quote on 20 Oct.');
  await page.getByRole('button', { name: 'Save permission' }).click();
  await expect(page.getByText('Contact permission recorded').last()).toBeVisible();

  await page.getByRole('button', { name: `Change stage for ${name}` }).click();
  await expect(page.getByRole('menuitem', { name: /Contact authorized/ })).not.toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');

  await page.getByRole('radio', { name: /^Opted out/ }).check();
  await page.getByRole('button', { name: 'Save permission' }).click();
  await expect(page.getByText('Contact permission recorded').last()).toBeVisible();
  await page.getByRole('button', { name: `Change stage for ${name}` }).click();
  await expect(page.getByRole('menuitem', { name: /Introduction requested/ })).toHaveAttribute('data-disabled', '');
});

test('projects, settings and the solution library', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('Workspace name').fill('E2E Studio');
  await page.getByRole('button', { name: 'Save agency settings' }).click();
  await expect(page.getByText('Agency settings saved')).toBeVisible();
  await expect(page.getByText('E2E Studio', { exact: true }).first()).toBeVisible();

  await page.goto('/settings?tab=scoring');
  await page.getByRole('button', { name: 'Save and rescore all prospects' }).click();
  await expect(page.getByText(/20 prospects rescored/)).toBeVisible();

  await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await dialog.getByLabel('Client').selectOption({ index: 1 });
  await dialog.getByLabel('Project name').fill('E2E catalogue build');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByLabel('New milestone').fill('Discovery workshop');
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await page.getByRole('button', { name: 'Mark “Discovery workshop” as complete' }).click();
  await expect(page.getByText('1 of 1 complete')).toBeVisible();

  await page.goto('/library?archetype=fashion-editorial');
  await expect(page.getByText('Creative reference — not a client')).toBeVisible();
  await expect(page.getByLabel('Design brief preview')).toContainText('# Design brief — Fashion editorial website');
});
