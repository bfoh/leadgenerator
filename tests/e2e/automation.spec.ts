import { expect, test } from '@playwright/test';

// Demo mode: the queue runs in the browser over localStorage with simulated tools (no paid calls).

test('research pipeline runs from the Automation Center with an audit trail', async ({ page }) => {
  // Five steps per prospect (identity, verification, audit, scoring, report) for every seeded prospect.
  test.setTimeout(240_000);
  await page.goto('/automation');
  await expect(page.getByRole('heading', { level: 1, name: 'Automation Center' })).toBeVisible();
  const status = page.getByRole('list', { name: 'Automation status' });
  await expect(status).toContainText('Research only');
  await expect(status).toContainText('Emergency stop engaged');

  await page.getByRole('button', { name: /Run research for \d+ open prospects/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Run the research pipeline?' });
  await expect(dialog).toContainText('this run costs nothing');
  await dialog.getByRole('button', { name: 'Queue and process' }).click();
  await expect(page.getByText(/Research pipeline: \d+ queued.*Processed \d+ jobs?/)).toBeVisible();

  // Work through the rest of the queue.
  const tiles = page.getByRole('list', { name: 'Jobs by status' });
  const pending = tiles.getByRole('button', { name: /Pending/ });
  for (let i = 0; i < 40 && !/^0/.test((await pending.textContent()) ?? ''); i++) {
    await page.getByRole('button', { name: 'Process queue now' }).click();
    await expect(page.getByRole('button', { name: 'Process queue now' })).toBeEnabled();
  }
  await expect(tiles.getByRole('button', { name: /Pending/ })).toHaveText(/^0/);
  await expect(tiles.getByRole('button', { name: /Failed/ })).toHaveText(/^0/);

  // Jobs tab: filter, then inspect one job and its run.
  await tiles.getByRole('button', { name: /Succeeded/ }).click();
  await expect(page).toHaveURL(/tab=jobs&status=succeeded/);
  await expect(page.getByRole('radio', { name: 'Succeeded' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /Opportunity Scoring/ }).first().click();
  const inspector = page.getByRole('dialog', { name: 'Opportunity Scoring' });
  await expect(inspector.getByRole('heading', { name: 'Runs' })).toBeVisible();
  await expect(inspector).toContainText(/Scored \d+\/100|score/i);
  await inspector.getByRole('button', { name: 'Close' }).click();

  // Run log lists the runs with their versions.
  await page.getByRole('tab', { name: 'Run log' }).click();
  await expect(page.getByText('scoring-1.0.0').first()).toBeVisible();
});

test('controls keep outreach off and enforce owner policy', async ({ page }) => {
  await page.goto('/automation?tab=controls');
  await expect(page.getByRole('radio', { name: /Research only/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Approval-based outreach/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Eligible automated outreach/ })).toBeDisabled();
  await expect(page.getByText('Engaged', { exact: true })).toBeVisible();

  await page.getByRole('radio', { name: /Research \+ proposals/ }).check();
  await expect(page.getByText('Mode set to Research + proposals')).toBeVisible();

  // Budgets validate before saving.
  const daily = page.getByLabel('Anthropic (AI) daily limit in US dollars');
  await daily.fill('-1');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByText(/Anthropic \(AI\): enter an amount between 0 and 100,000/)).toBeVisible();
  await daily.fill('1.5');
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByText('Budgets saved')).toBeVisible();

  // Pausing stops processing.
  await page.getByRole('button', { name: 'Pause automation' }).click();
  await expect(page.getByRole('list', { name: 'Automation status' })).toContainText('Paused');
  await page.getByRole('button', { name: 'Process queue now' }).click();
  await expect(page.getByText('Automation is paused.')).toBeVisible();
  await page.getByRole('button', { name: 'Resume automation' }).click();
  await expect(page.getByRole('list', { name: 'Automation status' })).toContainText('Running');

  await page.reload();
  await expect(page.getByRole('radio', { name: /Research \+ proposals/ })).toBeChecked();
  await expect(page.getByLabel('Anthropic (AI) daily limit in US dollars')).toHaveValue('1.5');
});

test('a prospect can be researched by agents from its profile', async ({ page }) => {
  await page.goto('/prospects');
  await page.getByRole('link', { name: 'The KingsMen Ghana' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'The KingsMen Ghana' })).toBeVisible();
  await page.getByRole('button', { name: 'Automate research' }).click();
  await expect(page.getByText(/Processed \d+ jobs?/)).toBeVisible();
  await page.getByRole('tab', { name: /Activity/ }).click();
  const history = page.getByRole('heading', { name: 'Workflow and agents' }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  await expect(history).toContainText('Opportunity Scoring');
  await expect(history).toContainText('Workflow history');
});

test('campaigns explain their cloud-only, research-only boundary in demo mode', async ({ page }) => {
  await page.goto('/automation?tab=campaigns');
  await expect(page.getByRole('heading', { level: 1, name: 'Automation Center' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Campaigns' })).toHaveAttribute('aria-selected', 'true');
  // Demo mode has no server queue, so the tab says so instead of pretending campaigns can run.
  await expect(page.getByText('Campaigns need the cloud workspace')).toBeVisible();
  await expect(page.getByText(/nowhere to queue background research/i)).toBeVisible();
});
