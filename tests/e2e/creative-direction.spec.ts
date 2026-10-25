import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Milestone 3C.3 in demo mode: an approved kit, a confirmed brief, three structural concepts,
// feedback, an edit saved as a new immutable version, and a named approval. No network, no model.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

async function axe(page: Page, label: string) {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${label} (${scheme}): ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function startConcept(page: Page, name: string, siteUrl: string) {
  await page.goto('/prospects?new=1');
  const dialog = page.getByRole('dialog', { name: 'Add research candidate' });
  await dialog.getByLabel('Business name').fill(name);
  await dialog.getByLabel('Category').fill('Bakery');
  await dialog.getByLabel('City / town').fill('Accra');
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-creative');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('button', { name: 'Create website concept' }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  await page.getByLabel('Website address').fill(siteUrl.replace(/^https?:\/\//, ''));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
}

async function uploadLogo(page: Page) {
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an asset' });
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'nsroma-logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(dialog.getByText('image/png · 1×1')).toBeVisible();
  await dialog.getByLabel('Permission evidence').fill('Email from the owner, 21 Oct 2026: these are our own files.');
  await dialog.getByRole('button', { name: 'Add to vault' }).click();
  await expect(page.getByText('nsroma-logo.png', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('nsroma-logo.png — Approved for this concept.')).toBeVisible();
}

async function approveKit(page: Page) {
  await page.getByRole('tab', { name: 'Brand Kit' }).click();
  await page.getByRole('checkbox', { name: /nsroma-logo\.png/ }).check();
  await page.getByRole('button', { name: 'Colour', exact: true }).click();
  await page.getByRole('button', { name: 'Colour', exact: true }).click();
  await page.getByLabel('Colour 1 name').fill('Ink');
  await page.getByLabel('Hex').nth(0).fill('#1B2A41');
  await page.getByLabel('Role').nth(0).fill('Text');
  await page.getByLabel('Colour 2 name').fill('Kente red');
  await page.getByLabel('Hex').nth(1).fill('#7A1F3D');
  await page.getByLabel('Role').nth(1).fill('Accent');
  await page.getByRole('button', { name: 'Typeface' }).click();
  await page.getByLabel('Role').nth(2).fill('Display');
  await page.getByLabel('Family').fill('Fraunces');
  await page.getByLabel('Weights').fill('400–700');
  await page.getByLabel('Web licence').fill('SIL Open Font License 1.1');
  await page.getByLabel('Personality').fill('Quietly confident, exacting, warm');
  await page
    .getByLabel('Visual direction')
    .fill('Editorial and unhurried: a warm off-white ground, one deep kente red used sparingly, and photography given room to breathe. Type does the talking.');
  await page.getByLabel('Summary').fill('Plain, precise and proud of the craft; short sentences, no exclamation marks.');
  await page.getByLabel('Always').fill('Name the fabric and the finish');
  await page.getByLabel('Never').fill('Best in Ghana\nEmoji in body copy');
  await page.getByRole('button', { name: 'Save as version 1' }).click();
  await expect(page.getByText('Version 1', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const approve = page.getByRole('dialog', { name: 'Approve Brand Kit version 1?' });
  await approve.getByLabel('What was approved, and why').fill('Agreed with the owner on 25 October; the kente red is final.');
  await approve.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Version 1 approved')).toBeVisible();
}

test('creative direction: brief, three concepts, an edit and a named approval', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startConcept(page, 'E2E Creative Bakery', 'https://e2ecreativebakery.com');
  await page.getByRole('tab', { name: /Asset vault/ }).click();
  await uploadLogo(page);
  await approveKit(page);

  await page.getByRole('tab', { name: 'Creative direction' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Creative direction/ })).toBeVisible();
  await page.getByRole('button', { name: 'Build the brief' }).click();
  await expect(page.getByText('Creative Direction Brief').first()).toBeVisible();
  await expect(page.getByText('Creative suggestion', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Approved asset', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Missing information')).toBeVisible();

  await page.getByRole('button', { name: 'Confirm brief' }).click();
  const confirm = page.getByRole('dialog', { name: /Confirm brief version 1/ });
  await confirm.getByLabel('What are you confirming, and why').fill('Reviewed with the owner: the kit, the evidence and the open questions are recorded correctly.');
  await confirm.getByRole('button', { name: 'Confirm brief' }).click();
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Propose three directions' }).click();
  await expect(page.getByText('Direction version 1')).toBeVisible();
  await expect(page.getByText('Compare the three concepts')).toBeVisible();
  await expect(page.getByText('A direction study, not a website')).toBeVisible();
  await expect(page.getByText('Direction board', { exact: false })).toBeVisible();
  await expect(page.getByText('Advisory only.', { exact: false }).first()).toBeVisible();

  // Three cards, each with its own Review action. The first is enough for this journey.
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(3);
  await page.getByRole('button', { name: 'Review', exact: true }).first().click();
  const feedback = page.getByRole('dialog', { name: /Review / });
  await feedback.getByLabel('Note').fill('The territory is right; the photography treatment needs a lower-light frame.');
  await feedback.getByRole('button', { name: 'Record decision' }).click();
  await expect(page.getByText(/photography treatment needs a lower-light frame/)).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const edit = page.getByRole('dialog', { name: /Edit / });
  await edit.getByLabel('Concept name').fill('E2E Archive Study');
  await edit.getByLabel('Why this version').fill('The team asked for a clearer archive name.');
  await edit.getByRole('button', { name: 'Save as new version' }).click();
  await expect(page.getByText('Direction version 2')).toBeVisible();
  await expect(page.getByText('E2E Archive Study').first()).toBeVisible();

  await page.getByRole('button', { name: 'Approve', exact: true }).first().click();
  const approve = page.getByRole('dialog', { name: /Approve / });
  await approve.getByLabel('Approval note').fill('Approved by the design lead: this is the territory we will build.');
  await approve.getByRole('button', { name: 'Approve concept' }).click();
  await expect(page.getByText('This direction has an approved concept')).toBeVisible();
  await expect(page.getByText('Approved by the design lead', { exact: false }).first()).toBeVisible();

  await axe(page, 'creative direction');
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByText('Direction board', { exact: false })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

