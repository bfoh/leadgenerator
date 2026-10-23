import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Phases 7–8 in demo mode: templates, message policies, the eligibility gateway, approval, the
// queue, quiet hours and the pause switch, the Outreach Drafting agent, the simulated provider,
// received messages with opt-out detection, and the audit trail. Demo dispatch is simulated in the
// browser; provider credentials are blank on the test server, so nothing can be sent. The browser
// clock is fixed so the sending window does not depend on when the suite runs.

const SANDBOX = 'e2e.sandbox.owner@gmail.com';
/** Thursday 22 October 2026, 10:00 in Accra: inside the default sending window. */
const THURSDAY_MORNING = new Date('2026-10-22T10:00:00Z');
const PROSPECT = 'orders@e2ekwamecrafts.com';

async function agencyIdentity(page: Page) {
  await page.goto('/settings');
  await page.getByLabel('Agency name (on proposals)').fill('E2E Sandbox Agency');
  await page.getByLabel('Address').fill('12 Example Street, Accra');
  await page.getByRole('button', { name: 'Save agency settings' }).click();
  await expect(page.getByText(/^Agency settings saved/).first()).toBeVisible();
}

async function emailTemplate(page: Page) {
  await page.goto('/outreach?tab=templates');
  await page.getByRole('button', { name: 'New template' }).click();
  const dialog = page.getByRole('dialog', { name: 'New template' });
  await dialog.getByLabel('Template name').fill('E2E Introduction');
  await dialog.getByLabel('Subject').fill('Ideas for {{business_name}}');
  await dialog
    .getByLabel('Message')
    .fill('Hello {{business_name}} team,\n\nThank you for agreeing to hear from us. I am {{sender_name}} from {{agency_name}}.\n\nWould a short call next week suit you? If not, just reply and we will not follow up.');
  await dialog.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Template saved as a draft')).toBeVisible();
  const row = page.getByTestId('message-template').filter({ hasText: 'E2E Introduction' });
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Approve template' }).click();
  await expect(row.getByText('Approved', { exact: true })).toBeVisible();
}

/** An owner's standing approval for the template, which every non-reply message needs. */
async function messagePolicy(page: Page, template: string) {
  await page.goto('/outreach?tab=policies');
  await page.getByRole('button', { name: 'New policy' }).click();
  const dialog = page.getByRole('dialog', { name: 'New message policy' });
  const select = dialog.getByLabel('Template');
  await select.selectOption((await select.locator('option', { hasText: template }).getAttribute('value'))!);
  await expect(dialog.getByLabel('Policy name')).toHaveValue(`${template} (v1)`);
  await dialog.getByRole('button', { name: 'Approve policy' }).click();
  await expect(page.getByText('Message policy active')).toBeVisible();
  await expect(page.getByTestId('message-policy').filter({ hasText: template }).getByText('Active', { exact: true })).toBeVisible();
}

async function sandboxRecipient(page: Page) {
  await page.goto('/outreach?tab=setup');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('textbox', { name: 'Test addresses and numbers 1' }).fill(SANDBOX);
  await page.getByRole('button', { name: 'Save test recipients' }).click();
  await expect(page.getByText('Sandbox test recipients saved')).toBeVisible();
}

/** A prospect with a validated email point and written consent for it. */
async function consentingProspect(page: Page, name: string, email: string) {
  await page.goto('/prospects?new=1');
  const add = page.getByRole('dialog', { name: 'Add research candidate' });
  await add.getByLabel('Business name').fill(name);
  await add.getByLabel('Category').fill('Crafts');
  await add.getByLabel('City / town').fill('Accra');
  await add.getByLabel('Source URL').fill('https://example.org/directory/e2e-outreach');
  await add.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page.getByRole('tab', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'Add contact detail' }).click();
  const contact = page.getByRole('dialog', { name: 'Add a contact detail' });
  await contact.getByLabel('Value').fill(email);
  await contact.getByRole('combobox', { name: 'Source', exact: true }).selectOption({ label: 'Given to us directly' });
  await contact.getByLabel('Source note').fill('Given at the agency open day');
  await contact.getByRole('button', { name: 'Save contact detail' }).click();
  await expect(page.getByText('Contact detail recorded with its source')).toBeVisible();

  const point = page.getByTestId('contact-point').filter({ hasText: email });
  await point.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Record consent…' }).click();
  const consent = page.getByRole('dialog', { name: 'Record consent' });
  await consent.getByLabel('How it was given').selectOption({ label: 'Email from them' });
  await consent.getByLabel('Evidence').fill('Wrote to us on 20 Oct asking for website ideas by email.');
  await consent.getByLabel(/Wording they agreed to/).fill('Yes, please email me your website ideas.');
  await consent.getByRole('button', { name: 'Record consent' }).click();
  await expect(page.getByText('Consent recorded', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText(/Processed 1 job: 1 succeeded/)).toBeVisible();
  await expect(point.getByText('Verified business channel', { exact: true })).toBeVisible();
  return point;
}

async function closeMessage(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByTestId('message-detail')).toHaveCount(0);
}

async function draftIntroduction(page: Page, point: ReturnType<Page['getByTestId']>) {
  await point.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Draft a message…' }).click();
  const draft = page.getByRole('dialog', { name: 'Draft an email' });
  await expect(draft.getByTestId('draft-preview')).toContainText('I am Demo');
  await draft.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved. Nothing has been sent.')).toBeVisible();
  return page.getByTestId('message-detail');
}

test('a consenting sandbox recipient gets an approved, queued, simulated message; a prospect never does', async ({ page }) => {
  await page.clock.install({ time: THURSDAY_MORNING });
  await agencyIdentity(page);
  await emailTemplate(page);
  await messagePolicy(page, 'E2E Introduction');
  await sandboxRecipient(page);

  // A real prospect, with consent and validation: still blocked, because sending to businesses is off.
  const prospectPoint = await consentingProspect(page, 'E2E Kwame Crafts', PROSPECT);
  let detail = await draftIntroduction(page, prospectPoint);
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Not approved: the eligibility gateway blocked it')).toBeVisible();
  await expect(detail.getByText(/Sending to businesses is not available in this version/)).toBeVisible();
  await expect(detail.getByText('Blocked at approval', { exact: false })).toBeVisible();
  await closeMessage(page);

  // The agency's own sandbox address passes every check.
  const sandboxPoint = await consentingProspect(page, 'E2E Sandbox Shop', SANDBOX);
  detail = await draftIntroduction(page, sandboxPoint);
  await page.getByRole('dialog').getByRole('button', { name: 'Check eligibility' }).click();
  await expect(page.getByText('Eligible for approval')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved after the eligibility check')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Queue for sending' }).click();
  await expect(detail.getByText('Demo mode', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate dispatch' }).click();
  await expect(page.getByText('Simulated send — nothing was sent')).toBeVisible();
  await expect(detail.getByText('Simulated delivery — nothing was sent.')).toBeVisible();
  await expect(detail.getByText(/Delivered:/)).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await closeMessage(page);

  // The prospect's Contacts tab and the Outreach page list it.
  await expect(page.getByTestId('outreach-message').first()).toBeVisible();
  await page.goto('/outreach');
  await page.getByRole('button', { name: /^Sent/ }).click();
  await expect(page.getByTestId('outreach-message').filter({ hasText: 'E2E Sandbox Shop' })).toBeVisible();
  await page.getByRole('button', { name: /^Drafts and queue/ }).click();
  await expect(page.getByTestId('outreach-message').filter({ hasText: 'E2E Kwame Crafts' })).toBeVisible();

  // A STOP reply suppresses the sender on every channel, and the next message is blocked.
  await page.getByRole('tab', { name: /Inbox/ }).click();
  await page.getByRole('button', { name: 'Simulate or log a reply' }).click();
  const reply = page.getByRole('dialog', { name: 'Simulate or log a reply' });
  const from = reply.getByLabel('From');
  await from.selectOption((await from.locator('option', { hasText: 'E2E Sandbox Shop' }).getAttribute('value'))!);
  await reply.getByLabel('Reply text').fill('STOP');
  await reply.getByRole('button', { name: 'Record reply' }).click();
  await expect(page.getByText('Opt-out recorded; the sender is suppressed')).toBeVisible();
  await expect(page.getByTestId('inbound-message').first().getByText('Opt-out · suppressed')).toBeVisible();

  await page.goto('/contacts');
  await page.getByRole('tab', { name: /Suppression list/ }).click();
  await expect(page.getByTestId('suppression').filter({ hasText: 'from an opt-out reply' }).first()).toBeVisible();
});

test('quiet hours and the pause switch make a queued message wait; the agent drafts and the audit trail records it all', async ({ page }) => {
  // Thursday 20:30 in Accra: after quiet hours start.
  await page.clock.install({ time: new Date('2026-10-22T20:30:00Z') });
  await agencyIdentity(page);
  await emailTemplate(page);
  await sandboxRecipient(page);

  // Without a message policy the agent writes nothing, and says why.
  await page.goto('/automation?tab=controls');
  await page.getByRole('radio', { name: /Research \+ proposals/ }).check();
  await expect(page.getByText('Mode set to Research + proposals')).toBeVisible();
  await consentingProspect(page, 'E2E Night Bakery', SANDBOX);
  await page.getByRole('button', { name: 'Draft with the agent' }).click();
  let agent = page.getByRole('dialog', { name: 'Draft with the agent' });
  await expect(agent.getByRole('checkbox', { name: /Write the personal note with AI/ })).toBeDisabled();
  await agent.getByRole('button', { name: 'Write the draft' }).click();
  await expect(page.getByText(/No introduction draft written: No active message policy covers/)).toBeVisible();
  const prospectUrl = page.url();

  await messagePolicy(page, 'E2E Introduction');
  // A second run in the same minute is treated as a double click; move past it.
  await page.clock.fastForward('01:00');
  await page.goto(prospectUrl);
  await page.getByRole('tab', { name: 'Contacts' }).click();
  await page.getByRole('button', { name: 'Draft with the agent' }).click();
  agent = page.getByRole('dialog', { name: 'Draft with the agent' });
  await agent.getByRole('button', { name: 'Write the draft' }).click();
  await expect(page.getByText(/Email introduction draft written for .* Nothing has been sent/)).toBeVisible();

  // Approving at night is fine; dispatch waits for the morning.
  await page.getByTestId('outreach-message').first().getByRole('button', { name: /Open message to/ }).click();
  const detail = page.getByTestId('message-detail');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved after the eligibility check')).toBeVisible();
  await expect(detail.getByText(/At dispatch: Outside the sending window/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Queue for sending' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Simulate dispatch' }).click();
  await expect(page.getByText('Not sent yet: it waits until Fri 23 Oct, 08:00 (Accra time) (sending policy).')).toBeVisible();
  await closeMessage(page);

  // Paused overnight: in the morning nothing goes until a person resumes, with a reason.
  await page.goto('/outreach?tab=policies');
  await page.getByLabel('Reason (optional)').fill('Checking the new template wording');
  await page.getByRole('button', { name: 'Pause all sending' }).click();
  await expect(page.getByText('Sending paused. Queued messages wait; nothing is dispatched.')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await page.clock.setSystemTime(new Date('2026-10-23T08:30:00Z'));
  await page.goto('/outreach');
  await page.getByRole('button', { name: /Simulate due messages/ }).click();
  await expect(page.getByText('Sending is paused; nothing was dispatched.')).toBeVisible();

  await page.goto('/outreach?tab=policies');
  await expect(page.getByRole('button', { name: 'Resume sending' })).toBeDisabled();
  await page.getByLabel('Why sending can resume').fill('Wording checked');
  await page.getByRole('button', { name: 'Resume sending' }).click();
  await expect(page.getByText('Sending resumed')).toBeVisible();
  await page.goto('/outreach');
  await page.getByRole('button', { name: /Simulate due messages/ }).click();
  await expect(page.getByText('1 sent (simulated; nothing left the browser)')).toBeVisible();

  await page.goto('/outreach?tab=audit');
  const entries = page.getByTestId('audit-entry');
  await expect(entries.filter({ hasText: /Waiting at dispatch/ }).first()).toBeVisible();
  await expect(entries.filter({ hasText: /Eligible at dispatch/ }).first()).toBeVisible();
  await expect(entries.filter({ hasText: 'Sending paused' }).first()).toContainText('Checking the new template wording');
  await expect(entries.filter({ hasText: 'Sending resumed' }).first()).toBeVisible();
  await expect(entries.filter({ hasText: 'Policy “E2E Introduction (v1)”: approved' })).toBeVisible();
  await page.getByRole('button', { name: 'Gateway decisions' }).click();
  await expect(entries.filter({ hasText: 'Sending paused' })).toHaveCount(0);
});

test('the Outreach setup says plainly that messages to businesses are off', async ({ page }) => {
  await page.goto('/outreach?tab=setup');
  await expect(page.getByText('Messages to businesses are off in this version')).toBeVisible();
  await expect(page.getByText('Simulated in the browser; nothing is sent')).toBeVisible();
  await expect(page.getByText('Before messages to businesses can be enabled')).toBeVisible();
  // The checklist is information, not something to tick off.
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});
