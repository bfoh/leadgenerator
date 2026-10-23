import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Phase 5 in demo mode: rule-based reports only (no API key on the test server), so nothing is paid
// for and no request leaves the machine.

const SECTIONS = [
  'Business overview',
  'Research summary',
  'Website verification findings',
  'Contact channel assessment',
  'Current digital presence',
  'Identified opportunities',
  'Recommended website or software solution',
  'Suggested implementation phases',
  'Expected business benefits',
  'Limitations and uncertainties',
  'Evidence references',
  'Recommended next commercial action',
];

async function addVerifiedCandidate(page: Page, name: string) {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill(name);
  await dialog.getByLabel('Category').fill('Hair salon');
  await dialog.getByLabel('City / town').fill('Tema');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-reports');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);

  await page.getByRole('tab', { name: 'Reports' }).click();
  await expect(page.getByText('Research is not complete enough for an automatic report')).toBeVisible();
  await expect(page.getByText('The website position has not been verified yet.')).toBeVisible();

  await page.getByRole('tab', { name: 'Website verification' }).click();
  await page.getByRole('radio', { name: /No official website found/ }).check();
  await page.getByLabel('Evidence summary').fill('Searched the exact name with Tema and checked likely domains; nothing official found.');
  await page.getByLabel('Searched exact business name + city').check();
  await page.getByLabel('Checked candidate domains').check();
  await page.getByRole('button', { name: 'Record verification' }).click();
  await expect(page.getByText('No official website found').first()).toBeVisible();
}

test('a rule-based report has twelve labelled sections, a confidence summary and a next action limited by research and permission', async ({ page }) => {
  await addVerifiedCandidate(page, 'E2E Tema Hair Studio');
  await page.getByRole('tab', { name: 'Reports' }).click();
  await page.getByRole('button', { name: 'Rule-based report' }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);

  for (const [i, title] of SECTIONS.entries()) {
    await expect(page.getByRole('heading', { level: 2, name: `${i + 1}. ${title}` })).toBeVisible();
  }
  await expect(page.getByTestId('report-confidence')).toContainText('Website verification:');
  await expect(page.getByTestId('report-statement').filter({ hasText: 'Documented checks did not find an official website' }).getByText('Evidence-supported finding')).toBeVisible();
  await expect(page.locator('[data-testid="report-statement"][data-kind="verified_fact"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="report-statement"][data-kind="assumption"]').first()).toBeVisible();
  // Two documented checks leave research confidence low, so the report asks for more research rather
  // than any commercial step (and never suggests contacting a business with no permission on file).
  await expect(page.getByTestId('report-next-action')).toContainText('Complete the research');
  await expect(page.getByTestId('report-next-action')).not.toContainText(/proposal|discovery conversation/i);
  await expect(page.getByText('No revenue or sales figures are estimated or promised.')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('editing saves a new version and removes invented business facts', async ({ page }) => {
  await addVerifiedCandidate(page, 'E2E Ashaiman Barbers');
  await page.getByRole('tab', { name: 'Reports' }).click();
  await page.getByRole('button', { name: 'Rule-based report' }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Edit' }).click();
  const overview = page.getByRole('group', { name: '1. Business overview' }).getByRole('group', { name: 'Statements' });
  await overview.getByRole('button', { name: 'Add' }).click();
  await overview.getByLabel(/— Label$/).last().selectOption('verified_fact');
  await overview.getByLabel(/— Evidence IDs$/).last().fill('E1');
  await overview.getByLabel(/— Statement$/).last().fill('The barbershop serves 600 customers a week.');
  await page.getByRole('button', { name: 'Save as new version' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Report v2' })).toBeVisible();
  await expect(page.getByText('1 unsupported statement was removed', { exact: true })).toBeVisible();
  await page.getByText('Show what was removed').click();
  await expect(page.getByTestId('removed-statements')).toContainText('The barbershop serves 600 customers a week.');
  await expect(page.getByTestId('report-statement').filter({ hasText: '600 customers' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^v1/ })).toBeVisible();
});

test('the workspace sets the research confidence needed for automatic reports', async ({ page }) => {
  await page.goto('/settings');
  const field = page.getByLabel('Minimum research confidence (0–100)');
  await expect(field).toHaveValue('50');
  await field.fill('70');
  await page.getByRole('button', { name: 'Save agency settings' }).click();
  await expect(page.getByText('Agency settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Minimum research confidence (0–100)')).toHaveValue('70');
});
