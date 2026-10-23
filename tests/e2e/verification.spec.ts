import { expect, test, type Page } from '@playwright/test';

// Phase 3 in demo mode with SIMULATE_EXTERNAL_TOOLS=true: web search, DNS and website checks come
// from the labelled simulated world (src/lib/server/providers/simulated-research.ts). No network
// requests leave the test server and nothing is paid for.

async function addCandidate(page: Page, name: string, extra: { website?: string; category?: string; facebook?: string } = {}) {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill(name);
  await dialog.getByLabel('Category').fill(extra.category ?? 'Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  if (extra.website) await dialog.getByLabel('Official website (if confirmed)').fill(extra.website);
  if (extra.facebook) {
    await dialog.getByRole('button', { name: 'Add profile' }).click();
    await dialog.getByLabel('Profile URL').fill(extra.facebook);
  }
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test('automated verification records evidence, factors and an evidence-backed audit', async ({ page }) => {
  // The recorded Facebook page is linked from the simulated site: independent ownership evidence.
  await addCandidate(page, 'E2E Osu Oven Bakery', { facebook: 'https://www.facebook.com/e2eosuovenbakery' });
  await page.getByRole('tab', { name: 'Website verification' }).click();
  await expect(page.getByText('Simulated providers')).toBeVisible();
  await page.getByRole('button', { name: 'Run automated verification' }).click();
  await expect(page.getByText(/Processed \d+ jobs?/)).toBeVisible();

  const history = page.locator('li', { has: page.getByText('Agent: Website Verification') }).first();
  await expect(history.getByText('Verified official website')).toBeVisible();
  await expect(history.getByText(/Evidence \d+\/100 · (Strong|High) confidence/)).toBeVisible();
  await expect(history.getByText('Current')).toBeVisible();
  await history.getByText(/Evidence and confidence factors/).click();
  await expect(history.getByRole('table', { name: /Factors behind the evidence confidence score/ })).toBeVisible();
  await expect(history.getByText('Independent source agreement')).toBeVisible();
  await expect(history.getByText('Search the exact name and city')).toBeVisible();
  await expect(history.getByText(/simulated providers/)).toBeVisible();
  await expect(page.getByText('Verified official website').first()).toBeVisible();

  // The follow-up audit ran from the same evidence.
  await page.getByRole('tab', { name: /^Digital audit/ }).click();
  await expect(page.getByText(/verified issues? · \d+ growth hypothes/)).toBeVisible();
  const finding = page.locator('li', { has: page.getByRole('heading', { name: 'Evidence' }) }).first();
  await expect(finding.getByText(/Automated check of|Website verification on/).first()).toBeVisible();
  await finding.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('Finding accepted')).toBeVisible();
});

test('an uncertain result waits for review in the queue and a person settles it', async ({ page }) => {
  const name = 'E2E Broken Kente Studio';
  await addCandidate(page, name, { website: 'https://e2ebrokenkentestudio.com' });
  await page.getByRole('tab', { name: 'Website verification' }).click();
  await page.getByRole('button', { name: 'Run automated verification' }).click();
  await expect(page.getByText(/Processed \d+ jobs?/)).toBeVisible();
  await expect(page.getByText('Broken or unavailable website').first()).toBeVisible();
  await expect(page.getByText('1 result awaiting review')).toBeVisible();

  await page.goto('/verification');
  await page.getByRole('radio', { name: /Needs review/ }).click();
  const row = page.locator('li', { hasText: name });
  await expect(row).toContainText('Broken or unavailable website');
  await row.getByRole('link', { name: 'Review' }).click();

  const entry = page.locator('li', { has: page.getByText('Agent: Website Verification') }).first();
  await entry.getByRole('button', { name: 'Confirm' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm this result?' });
  await dialog.getByLabel('Note (optional)').fill('Site returns a server error in the browser too.');
  await dialog.getByRole('button', { name: 'Confirm result' }).click();
  await expect(page.getByText('Result confirmed')).toBeVisible();
  await expect(entry.getByText('Confirmed', { exact: true })).toBeVisible();
});

test('duplicates are merged only by a person, and the merge can be undone', async ({ page }) => {
  await addCandidate(page, 'E2E Adinkra Print House', { category: 'Fashion boutique' });
  await addCandidate(page, 'E2E Adinkra Print House Ltd', { category: 'Fashion boutique' });
  await expect(page.getByText('Possible duplicates')).toBeVisible();
  const suggestion = page.locator('li', { has: page.getByRole('link', { name: 'E2E Adinkra Print House', exact: true }) });
  await suggestion.getByRole('button', { name: 'Merge…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge duplicate prospects' });
  await expect(dialog).toContainText('Nothing is deleted');
  await dialog.getByRole('button', { name: /^Merge into/ }).click();
  await expect(page.getByText(/Merged into E2E Adinkra Print House/)).toBeVisible();

  // The archived duplicate explains itself and can be restored.
  await expect(page.getByText('Merged duplicate')).toBeVisible();
  await page.getByRole('button', { name: 'Undo merge' }).click();
  await expect(page.getByText('Merge undone; this prospect is separate again')).toBeVisible();
  await expect(page.getByText('Merged duplicate')).toHaveCount(0);
});

test('a score override needs a justification and keeps the computed score visible', async ({ page }) => {
  await addCandidate(page, 'E2E Labone Florist', { category: 'Florist' });
  await page.getByRole('tab', { name: 'Score' }).click();
  await page.getByRole('button', { name: 'Override score' }).click();
  const dialog = page.getByRole('dialog', { name: 'Override the opportunity score' });
  await dialog.getByLabel('Opportunity score (0–100)').fill('88');
  await dialog.getByLabel('Justification').fill('Too short');
  await expect(dialog.getByRole('button', { name: 'Save override' })).toBeDisabled();
  await dialog.getByLabel('Justification').fill('Owner asked us for a quote for an online order form.');
  await dialog.getByRole('button', { name: 'Save override' }).click();
  await expect(page.getByText('Score override saved')).toBeVisible();
  await expect(page.getByText('Set by a person')).toBeVisible();
  await expect(page.getByText(/Computed by the rules: \d+\/100/)).toBeVisible();
  await page.getByRole('button', { name: 'Show override history' }).click();
  await expect(page.getByText(/set to 88: Owner asked us/)).toBeVisible();
});
