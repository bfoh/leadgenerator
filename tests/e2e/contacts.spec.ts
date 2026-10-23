import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Phase 4 in demo mode with SIMULATE_EXTERNAL_TOOLS=true: website contact pages and MX lookups come
// from the labelled simulated world (src/lib/server/providers/simulated-research.ts). No network
// requests leave the test server and nothing is paid for. Nothing is ever sent to a business.

async function addCandidate(page: Page, name: string, extra: { facebook?: string } = {}) {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill(name);
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  if (extra.facebook) {
    await dialog.getByRole('button', { name: 'Add profile' }).click();
    await dialog.getByLabel('Profile URL').fill(extra.facebook);
  }
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page).toHaveURL(/\/prospects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

const row = (page: Page, text: string | RegExp) => page.getByTestId('contact-point').filter({ hasText: text });

test('contact research records what the official website publishes, with its source, and none of it is permission', async ({ page }) => {
  await addCandidate(page, 'E2E Osu Bread Oven', { facebook: 'https://www.facebook.com/e2eosubreadoven' });
  await page.getByRole('tab', { name: 'Website verification' }).click();
  await page.getByRole('button', { name: 'Run automated verification' }).click();
  await expect(page.getByText(/Processed \d+ jobs?/).first()).toBeVisible();
  await expect(page.getByText('Verified official website').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Contacts' }).click();
  await expect(page.getByText('Simulated providers', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find contact details' }).click();
  await expect(page.getByText(/Processed 2 jobs: 2 succeeded/)).toBeVisible();

  // Published on the business's own site: recorded with the page as source, validated, but not permitted.
  const email = row(page, 'info@e2eosubreadoven.com');
  await expect(email.getByText('Permission required', { exact: true })).toBeVisible();
  await expect(email.getByText('Data rights: permitted', { exact: true })).toBeVisible();
  await expect(email.getByRole('link', { name: /source page/ })).toHaveAttribute('href', 'https://e2eosubreadoven.com/contact');
  await expect(row(page, /^\+23330/).first().getByText('Permission required', { exact: true })).toBeVisible();
  await expect(row(page, 'WhatsApp').getByText(/WhatsApp · Mobile/)).toBeVisible();
  // A web designer's address on another domain is not treated as the business's.
  await expect(row(page, 'hello@pixelstudio.com').getByText('Needs review', { exact: true })).toBeVisible();

  const summary = page.getByTestId('contact-summary');
  await expect(summary.getByText('Available', { exact: true }).first()).toBeVisible();
  await expect(summary.getByText('Verified', { exact: true })).toBeVisible();
  await expect(summary.getByText('Blocked', { exact: true })).toBeVisible();
  await expect(summary.getByText('Not opted in', { exact: true })).toBeVisible();
  await expect(summary.getByText('Not available in this version')).toBeVisible();
  await summary.getByText('Why').click();
  await expect(summary.getByText('No email consent on file.')).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

test('written consent makes email eligible; an opt-out suppresses it workspace-wide', async ({ page }) => {
  await addCandidate(page, 'E2E Akua Fabrics');
  await page.getByRole('tab', { name: 'Contacts' }).click();
  await expect(page.getByText('No contact details recorded')).toBeVisible();

  // Restricted sources are explained and cannot be chosen.
  await page.getByRole('button', { name: 'Add contact detail' }).click();
  const add = page.getByRole('dialog', { name: 'Add a contact detail' });
  await expect(add.getByText(/Google Places contact fields are for display only/)).toBeVisible();
  const source = add.getByRole('combobox', { name: 'Source', exact: true });
  await expect(source.locator('option', { hasText: /Google|search|social/i })).toHaveCount(0);
  await add.getByLabel('Value').fill('Orders@E2EAkuaFabrics.com');
  await source.selectOption({ label: 'Given to us directly' });
  await add.getByRole('button', { name: 'Save contact detail' }).click();
  await expect(add.getByText('Say where this detail came from (a link or a short note).')).toBeVisible();
  await add.getByLabel('Source note').fill('Owner gave it at the Accra trade fair');
  await add.getByRole('button', { name: 'Save contact detail' }).click();
  await expect(page.getByText('Contact detail recorded with its source')).toBeVisible();
  const email = row(page, 'orders@e2eakuafabrics.com');
  await expect(email.getByText('Not validated yet', { exact: false })).toBeVisible();

  // Act 843 s.40: direct marketing needs prior written consent.
  await email.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Record consent…' }).click();
  const consent = page.getByRole('dialog', { name: 'Record consent' });
  await consent.getByLabel('How it was given').selectOption({ label: 'Phone call' });
  await consent.getByLabel('Evidence').fill('Owner agreed on a call on 20 Oct to receive our proposal by email.');
  await consent.getByRole('button', { name: 'Record consent' }).click();
  await expect(consent.getByText(/needs prior written consent \(Act 843 s\.40\)/).first()).toBeVisible();
  await consent.getByLabel('How it was given').selectOption({ label: 'Email from them' });
  await consent.getByLabel(/Wording they agreed to/).fill('Yes, please email me your website proposal and offers.');
  await consent.getByRole('button', { name: 'Record consent' }).click();
  await expect(page.getByText('Consent recorded', { exact: true })).toBeVisible();
  await expect(page.getByTestId('consent-record').first().getByText('Granted')).toBeVisible();

  // Validation completes the contact-level checks; sending to businesses is still unavailable.
  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText(/Processed 1 job: 1 succeeded/)).toBeVisible();
  await expect(email.getByText('Verified business channel', { exact: true })).toBeVisible();
  const summary = page.getByTestId('contact-summary');
  await expect(summary.getByText('Eligible', { exact: true })).toBeVisible();
  await expect(summary.getByText('Not available in this version')).toBeVisible();

  // An opt-out takes effect immediately and wins over the earlier consent.
  await email.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Record opt-out…' }).click();
  const optOut = page.getByRole('dialog', { name: 'Record an opt-out' });
  await optOut.getByLabel('Evidence').fill('Replied “please stop emailing us” on 22 Oct.');
  await optOut.getByRole('button', { name: 'Record opt-out' }).click();
  await expect(page.getByText('Opt-out recorded; the contact is suppressed')).toBeVisible();
  await expect(email.getByText('Suppressed', { exact: true })).toBeVisible();
  await expect(summary.getByText('Blocked', { exact: true })).toBeVisible();

  // The suppression list keeps only a masked hint, and cannot be lifted without newer consent.
  await page.goto('/contacts');
  await expect(page.getByRole('heading', { level: 1, name: 'Contacts' })).toBeVisible();
  await page.getByRole('tab', { name: /Suppression list/ }).click();
  const entry = page.getByTestId('suppression').filter({ hasText: 'from a consent withdrawal' }).first();
  await expect(entry.getByText('Active')).toBeVisible();
  await expect(entry).not.toContainText('orders@e2eakuafabrics.com');
  await entry.getByRole('button', { name: 'Lift…' }).click();
  await expect(page.getByRole('dialog').getByText('No consent record allows this')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Lift suppression' })).toBeDisabled();
});

test('the suppression list takes manual entries and the old permission link still opens the Contacts tab', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByRole('tab', { name: /Suppression list/ }).click();
  await page.getByRole('button', { name: 'Add to suppression list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to the suppression list' });
  await dialog.getByLabel('Value').fill('0244 555 777');
  await dialog.getByLabel('What').selectOption({ label: 'Phone number (also WhatsApp)' });
  await dialog.getByLabel('Reason').selectOption({ label: 'Complaint' });
  await dialog.getByRole('button', { name: 'Suppress' }).click();
  await expect(page.getByText('Added to the suppression list')).toBeVisible();
  const entry = page.getByTestId('suppression').filter({ hasText: 'Complaint' }).first();
  await expect(entry).not.toContainText('555 777');

  await page.getByRole('button', { name: 'Add to suppression list' }).click();
  await dialog.getByLabel('What').selectOption({ label: 'Phone number (also WhatsApp)' });
  await dialog.getByLabel('Value').fill('+233244555777');
  await dialog.getByRole('button', { name: 'Suppress' }).click();
  await expect(page.getByText('This contact is already on the suppression list.')).toBeVisible();

  await addCandidate(page, 'E2E Old Link Prints');
  await page.goto(`${page.url()}?tab=permission`);
  await expect(page.getByRole('tab', { name: 'Contacts', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Business-level permission' })).toBeVisible();
});
