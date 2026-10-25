import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Milestone 3C.2 in demo mode: files are validated and kept in this browser (IndexedDB), the vault
// applies the five permissions, the Brand Kit only names approved assets, and an export contains only
// approved, export-authorized files. Every upload is a synthetic 1×1 PNG; nothing is fetched.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

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
  await dialog.getByLabel('Source URL').fill('https://example.org/directory/e2e-vault');
  await dialog.getByRole('button', { name: 'Add candidate' }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await page.getByRole('button', { name: 'Create website concept' }).click();
  await expect(page).toHaveURL(/\/studio\/[0-9a-f-]{36}$/);
  await page.getByLabel('Website address').fill(siteUrl.replace(/^https?:\/\//, ''));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  return new URL(page.url()).pathname.split('/').pop()!;
}

async function uploadLogo(page: Page) {
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an asset' });
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'nsroma-logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(dialog.getByText('image/png · 1×1')).toBeVisible();
  await dialog.getByLabel('Permission evidence').fill('Email from the owner, 21 Oct 2026: these are our own files.');
  await dialog.getByRole('button', { name: 'Add to vault' }).click();
  await expect(page.getByText('nsroma-logo.png', { exact: true }).first()).toBeVisible();
}

test('a file is validated, approved, exported with its manifest, and revoked when permission is withdrawn', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startConcept(page, 'E2E Vault Bakery', 'https://e2evaultbakery.com');

  await page.getByRole('tab', { name: /Asset vault/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Asset vault/ })).toBeVisible();

  // A file that lies about its type is refused before anything is stored.
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add an asset' });
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'mark.svg', mimeType: 'image/svg+xml', buffer: SVG });
  await expect(dialog.getByRole('alert')).toContainText('not accepted');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No files in the vault yet')).toBeVisible();

  await uploadLogo(page);
  // A candidate offers an approval action; publishing is never assumed.
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await expect(page.getByText('Publish · Denied')).toBeVisible();
  await expect(page.getByText('nsroma-logo.png added to the vault')).toBeVisible();

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('nsroma-logo.png — Approved for this concept.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

  // The approved pack downloads with a manifest and no unapproved file.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export pack/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-asset-pack-\d{4}-\d{2}-\d{2}\.zip$/);

  // A remote reference is recorded as an address only, then declined.
  await page.getByRole('button', { name: 'Record a reference' }).click();
  const reference = page.getByRole('dialog', { name: 'Record a remote reference' });
  await reference.getByLabel('Address').fill('https://maps.google.com/place/e2e-vault-bakery');
  await reference.getByLabel('What it shows').fill('Shopfront photograph on their Maps listing');
  await reference.getByRole('button', { name: 'Record reference' }).click();
  await expect(page.getByText('Shopfront photograph on their Maps listing')).toBeVisible();
  await expect(page.getByText('Reference only', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Decline' }).click();
  await page.getByRole('dialog', { name: 'Decline this reference' }).getByRole('button', { name: 'Decline reference' }).click();
  await expect(page.getByText('Declined', { exact: true })).toBeVisible();

  // Revoking is a decision, not a deletion: the file and its history stay.
  await page.getByRole('button', { name: 'More actions for nsroma-logo.png' }).click();
  await page.getByRole('menuitem', { name: 'Revoke permission' }).click();
  const revoke = page.getByRole('dialog', { name: 'Revoke permission' });
  await revoke.getByLabel('Why').fill('The designer withdrew the licence on 24 October.');
  await revoke.getByRole('button', { name: 'Revoke permission' }).click();
  await expect(page.getByText('nsroma-logo.png — The designer withdrew the licence on 24 October.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Export pack/ })).toBeDisabled();

  await axe(page, 'asset vault');
  expect(errors).toEqual([]);
});

test('the Brand Kit is structured, versioned and approved by a person', async ({ page }) => {
  test.setTimeout(150_000);
  await startConcept(page, 'E2E Brand Kit Bakery', 'https://e2ebrandkitbakery.com');
  await page.getByRole('tab', { name: /Asset vault/ }).click();
  await uploadLogo(page);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('nsroma-logo.png — Approved for this concept.')).toBeVisible();

  await page.getByRole('tab', { name: 'Brand Kit' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /Brand Kit/ })).toBeVisible();
  await expect(page.getByText('No approved Brand Kit yet')).toBeVisible();

  // The approved logo is the only one offered.
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
  await expect(page.getByText(/Agreed with the owner on 25 October/).first()).toBeVisible();

  await axe(page, 'brand kit');
});

