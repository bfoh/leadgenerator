import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Phase 9 in demo mode: a reply is read by the rules and becomes an interested-lead alert, the
// prospect's Next steps tab plans follow-ups and opens the meeting brief, a client's request to
// change an issued proposal waits for an owner's decision, acceptance stays blocked until the
// agreed change is approved into a revised proposal, and the won client becomes a project. Replies
// are simulated in the browser; no AI key is configured on the test server and nothing is sent.

/** Thursday 22 October 2026, 10:00 in Accra. */
const THURSDAY_MORNING = new Date('2026-10-22T10:00:00Z');
const NAME = 'E2E Osu Tailors';
const EMAIL = 'hello@e2eosutailors.com';

async function agencyIdentity(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Agency name (on proposals)').fill('E2E Sandbox Agency');
  await page.getByLabel('Address').fill('12 Example Street, Accra');
  await page.getByRole('button', { name: 'Save agency settings' }).click();
  await expect(page.getByText(/^Agency settings saved/).first()).toBeVisible();
}

/** A prospect with an email address it gave us and written consent for it. */
async function consentingProspect(page: Page) {
  await page.goto('/prospects?new=1');
  const add = page.getByRole('dialog', { name: 'Add research candidate' });
  await add.getByLabel('Business name').fill(NAME);
  await add.getByLabel('Category').fill('Tailor');
  await add.getByLabel('City / town').fill('Accra');
  await add.getByLabel('Source URL').fill('https://example.org/directory/e2e-conversion');
  await add.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  const url = page.url();

  await page.getByRole('tab', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'Add contact detail' }).click();
  const contact = page.getByRole('dialog', { name: 'Add a contact detail' });
  await contact.getByLabel('Value').fill(EMAIL);
  await contact.getByRole('combobox', { name: 'Source', exact: true }).selectOption({ label: 'Given to us directly' });
  await contact.getByLabel('Source note').fill('Given at the agency open day');
  await contact.getByRole('button', { name: 'Save contact detail' }).click();
  await expect(page.getByText('Contact detail recorded with its source')).toBeVisible();

  const point = page.getByTestId('contact-point').filter({ hasText: EMAIL });
  await point.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Record consent…' }).click();
  const consent = page.getByRole('dialog', { name: 'Record consent' });
  await consent.getByLabel('How it was given').selectOption({ label: 'Email from them' });
  await consent.getByLabel('Evidence').fill('Wrote to us on 20 Oct asking for a proposal by email.');
  await consent.getByLabel(/Wording they agreed to/).fill('Yes, please email me your proposal.');
  await consent.getByRole('button', { name: 'Record consent' }).click();
  await expect(page.getByText('Consent recorded', { exact: true })).toBeVisible();
  return url;
}

async function simulateReply(page: Page, text: string) {
  await page.goto('/outreach?tab=inbox');
  await page.getByRole('button', { name: 'Simulate or log a reply' }).click();
  const dialog = page.getByRole('dialog', { name: 'Simulate or log a reply' });
  const from = dialog.getByLabel('From');
  await from.selectOption((await from.locator('option', { hasText: NAME }).getAttribute('value'))!);
  await dialog.getByLabel('Reply text').fill(text);
  await dialog.getByRole('button', { name: 'Record reply' }).click();
  await expect(page.getByText('Reply recorded and read')).toBeVisible();
}

async function lifecycle(page: Page, action: string) {
  await page.getByRole('button', { name: action, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
}

async function priceAll(page: Page, price: string) {
  const prices = page.getByLabel(/unit price$/);
  await expect(prices.first()).toBeVisible();
  const count = await prices.count();
  for (let i = 0; i < count; i++) await prices.nth(i).fill(price);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved').last()).toBeVisible();
}

test('an interested reply becomes an alert, a meeting brief, a negotiated change and a won client', async ({ page }) => {
  await page.clock.install({ time: THURSDAY_MORNING });
  await agencyIdentity(page);
  const prospectUrl = await consentingProspect(page);

  // The rules read the reply as a meeting request: an alert, never an automatic answer.
  await simulateReply(page, 'Yes please. Can we meet on Thursday at the shop?');
  const message = page.getByTestId('inbound-message').first();
  await expect(message.getByText('Meeting request')).toBeVisible();
  await expect(message.getByText(/Next: Agree a time/)).toBeVisible();
  await page.getByRole('button', { name: /^Needs attention/ }).click();
  await expect(page.getByTestId('inbound-message')).toHaveCount(1);

  // A person corrects nothing here, but can see why and change it.
  await message.getByRole('button', { name: 'What does it mean?' }).click();
  const read = page.getByRole('dialog', { name: 'What does this reply mean?' });
  await expect(read.getByLabel('It means')).toHaveValue('meeting_request');
  await expect(read.getByRole('button', { name: 'Read with AI' })).toHaveCount(0);
  await read.getByRole('button', { name: 'Cancel' }).click();

  await page.goto('/');
  const alerts = page.getByTestId('lead-alerts');
  await expect(alerts).toContainText('Interested leads (1)');
  await expect(alerts).toContainText(NAME);
  await alerts.getByRole('link', { name: NAME }).click();
  await expect(page).toHaveURL(/\?tab=next$/);

  // Next steps: the reply, the plan (tasks only) and the meeting brief.
  await expect(page.getByTestId('prospect-replies')).toContainText('Meeting request');
  await expect(page.getByTestId('follow-up-empty')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  const businessId = new URL(prospectUrl).pathname.split('/').pop();
  await page.goto(`/print/meetings/${businessId}`);
  const brief = page.getByTestId('meeting-brief');
  await expect(brief.getByRole('heading', { level: 1 })).toHaveText(`Meeting brief: ${NAME}`);
  await expect(brief).toContainText('Meeting request');
  await expect(brief).toContainText('Do not agree to custom contract terms in the meeting.');
  await expect(brief).toContainText('No proposal yet.');

  // An issued proposal.
  await page.goto(`${prospectUrl}?tab=proposals`);
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}$/);
  await priceAll(page, '1000');
  await lifecycle(page, 'Approve');
  await expect(page.getByText('Proposal approved').last()).toBeVisible();
  await lifecycle(page, 'Mark as sent');
  await expect(page.getByText('Proposal sent').last()).toBeVisible();

  // The client asks for a discount: recorded, not agreed. Acceptance waits.
  await expect(page.getByRole('heading', { name: 'Discussion and change requests' })).toBeVisible();
  const discussion = page.getByTestId('change-request-form');
  await discussion.getByLabel('What they want to change').selectOption({ label: 'Price or discount' });
  await discussion.getByLabel('The request, in their words').fill('10% off if we pay the full amount upfront');
  await discussion.getByRole('button', { name: 'Record change request' }).click();
  await expect(page.getByText('Change request recorded for an owner or admin to decide')).toBeVisible();
  await expect(page.getByTestId('change-requests')).toContainText('Awaiting decision');
  await expect(page.getByRole('button', { name: 'Accepted', exact: true })).toBeDisabled();
  await expect(page.getByText('Decide the open change request before recording acceptance.')).toBeVisible();

  // The owner agrees, with a note; the agreed change still has to go into the proposal.
  await page.getByTestId('change-requests').getByRole('button', { name: 'Agree' }).click();
  const decide = page.getByRole('dialog', { name: 'Agree to this change?' });
  await expect(decide.getByRole('button', { name: 'Agree' })).toBeDisabled();
  await decide.getByLabel(/Why/).fill('Agreed for full payment upfront');
  await decide.getByRole('button', { name: 'Agree' }).click();
  await expect(page.getByText('Change request agreed')).toBeVisible();
  await expect(page.getByTestId('change-requests')).toContainText('Agreed for full payment upfront');
  await expect(page.getByText(/An agreed change is not in the proposal yet/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accepted', exact: true })).toBeDisabled();

  // Revise with the new price, approve and issue again; then acceptance and the project.
  await lifecycle(page, 'Revise as draft');
  await expect(page.getByText('Proposal draft').last()).toBeVisible();
  await page.getByRole('tab', { name: 'Edit' }).click();
  await priceAll(page, '900');
  await lifecycle(page, 'Approve');
  await expect(page.getByText('Proposal approved').last()).toBeVisible();
  await lifecycle(page, 'Mark as sent');
  await expect(page.getByText('Proposal sent').last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accepted', exact: true })).toBeEnabled();
  await lifecycle(page, 'Accepted');
  await expect(page.getByText('Proposal accepted')).toBeVisible();
  await page.getByRole('button', { name: 'Convert to project' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);

  await page.goto(prospectUrl);
  await expect(page.getByText('Won').first()).toBeVisible();
});

test('an opt-out reply cannot be read as anything else', async ({ page }) => {
  await page.clock.install({ time: THURSDAY_MORNING });
  await consentingProspect(page);
  await page.goto('/outreach?tab=inbox');
  await page.getByRole('button', { name: 'Simulate or log a reply' }).click();
  const dialog = page.getByRole('dialog', { name: 'Simulate or log a reply' });
  const from = dialog.getByLabel('From');
  await from.selectOption((await from.locator('option', { hasText: NAME }).getAttribute('value'))!);
  await dialog.getByLabel('Reply text').fill('Interested? No. Please stop messaging me.');
  await dialog.getByRole('button', { name: 'Record reply' }).click();
  await expect(page.getByText('Opt-out recorded; the sender is suppressed')).toBeVisible();
  const message = page.getByTestId('inbound-message').first();
  await message.getByRole('button', { name: 'Why it is an opt-out' }).click();
  const read = page.getByRole('dialog', { name: 'What does this reply mean?' });
  await expect(read.getByText('An opt-out stays an opt-out')).toBeVisible();
  await expect(read.getByLabel('It means')).toHaveCount(0);
  await read.getByRole('button', { name: 'Close' }).last().click();
  await page.getByRole('button', { name: /^Needs attention/ }).click();
  await expect(page.getByTestId('inbound-message')).toHaveCount(0);
});
