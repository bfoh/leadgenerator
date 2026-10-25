import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Milestone 3C.1 in demo mode with SIMULATE_EXTERNAL_TOOLS=true: homepage readings come from the
// labelled simulated world (src/lib/server/providers/simulated-research.ts), so nothing leaves the
// test server and nothing is billed. The Studio records what a page shows, keeps every analysis run,
// and never edits recorded evidence.

async function axe(page: Page, label: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // Let theme transitions and reveal animations settle before sampling colours.
    await page.waitForTimeout(600);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label} (${scheme}): ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function addProspect(page: Page, name: string): Promise<string> {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill(name);
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-studio');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop()!;
}

/** Starts the concept from the prospect header, then records the address the analysis will read. */
async function startConcept(page: Page, name: string, siteUrl: string) {
  const businessId = await addProspect(page, name);
  await page.getByRole('button', { name: 'Create website concept' }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  const conceptId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name: `${name} — website concept` })).toBeVisible();
  await expect(page.getByText('No website address yet')).toBeVisible();
  await page.getByLabel('Website address').fill(siteUrl.replace(/^https?:\/\//, ''));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByText('No website address yet')).toHaveCount(0);
  return { businessId, conceptId };
}

test('a prospect becomes one concept whose facts, gaps and our own suggestions stay apart, and every run is kept', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const name = 'E2E Studio Bakery';
  const { businessId, conceptId } = await startConcept(page, name, 'https://e2estudiobakery.com');

  // One live concept per prospect: the prospect now links to it instead of offering another.
  await page.goto(`/prospects/${businessId}`);
  await expect(page.getByRole('link', { name: 'Website concept', exact: true })).toHaveAttribute('href', `/studio/${conceptId}`);

  await page.goto(`/studio/${conceptId}`);
  await page.getByRole('button', { name: 'Analyse the site' }).first().click();

  // A simulated reading says so, and is never presented as evidence about the real site.
  await expect(page.getByText('Simulated reading', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Verified facts/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Unknown/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Creative suggestions/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Placeholders/ })).toBeVisible();
  await expect(page.getByText('Business name on the site', { exact: true })).toBeVisible();
  await expect(page.getByText('Very little content', { exact: true })).toBeVisible();
  await expect(page.getByText('Our suggestions are not their brand')).toBeVisible();
  // The fact points back at the page it came from; page text is never copied into the concept.
  await expect(page.getByRole('link', { name: 'e2estudiobakery.com' }).first()).toHaveAttribute('href', /^https:\/\/e2estudiobakery\.com\/?$/);

  // A person confirms a fact, and rejects one of our suggestions with a reason.
  await page.getByRole('button', { name: 'Confirm Business name on the site' }).click();
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Reject Homepage opening' }).click();
  const reject = page.getByRole('dialog', { name: 'Reject this entry' });
  await reject.getByLabel('Why').fill('Too close to the line they already use.');
  await reject.getByRole('button', { name: 'Reject entry' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Decisions/ })).toBeVisible();
  await expect(page.getByText('Rejected · Too close to the line they already use.')).toBeVisible();

  // A second analysis is a new run: the first run's evidence and decisions are still there.
  await page.getByRole('button', { name: 'Analyse again' }).click();
  const runs = page.getByLabel('Analysis run');
  await expect(runs).toBeVisible();
  await expect(runs.locator('option')).toHaveCount(2);
  await expect(runs.locator('option').first()).toHaveText(/Run 2 \(latest\)/);
  await runs.selectOption({ label: 'Run 1' });
  await expect(page.getByText('Rejected · Too close to the line they already use.')).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();

  await axe(page, 'studio concept');
  await page.goto('/studio');
  await expect(page.getByRole('link', { name })).toBeVisible();
  await axe(page, 'studio list');
  expect(errors).toEqual([]);
});


test('an unreadable site is recorded as unreadable, and a concept is archived, restored and deleted', async ({ page }) => {
  test.setTimeout(120_000);
  const name = 'E2E Studio Broken Bakery';
  const { businessId, conceptId } = await startConcept(page, name, 'https://e2estudiobroken.com');

  await page.getByRole('button', { name: 'Analyse the site' }).first().click();
  // No evidence is invented: the concept says the site could not be read, and why.
  await expect(page.getByText('The site could not be read', { exact: true })).toBeVisible();
  await expect(page.getByText(/HTTP 503/).first()).toBeVisible();
  await expect(page.getByText('Evidence unavailable', { exact: true }).first()).toBeVisible();

  // Archiving keeps the concept as history and frees the prospect for a new one.
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByText('Archived concept', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analyse again' })).toHaveCount(0);
  await page.goto(`/prospects/${businessId}`);
  await expect(page.getByRole('button', { name: 'Create website concept' })).toBeVisible();

  await page.goto(`/studio/${conceptId}`);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Archived concept', { exact: true })).toHaveCount(0);

  await page.goto('/studio');
  const row = page.getByRole('row').filter({ hasText: name });
  // Restoring keeps the run that was recorded, so the concept returns as "Intelligence ready"
  // with this site's outcome, not back to an unanalysed draft.
  await expect(row.getByText('Intelligence ready', { exact: true })).toBeVisible();
  await expect(row.getByText('Evidence unavailable', { exact: true })).toBeVisible();

  // Deleting removes the concept itself; the prospect stays.
  await page.getByRole('link', { name }).click();
  await page.getByRole('button', { name: 'Delete concept' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByText('No website concepts yet')).toBeVisible();
  await page.goto(`/prospects/${businessId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
});

