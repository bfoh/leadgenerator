import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The visual asset acceptance fixture: one fictional hotel, one independently verified official
// website, one authorized logo, three authorized photographs and two third-party references that
// never receive permission. The exported kit must contain exactly the four authorized files.

const SITE = 'https://resource-hotel.example.org';

async function createHotel(page: import('@playwright/test').Page, name = 'Fictional Harbour Hotel') {
  await page.goto('/prospects?new=1');
  const form = page.getByRole('dialog', { name: 'Add research candidate' });
  await form.getByLabel('Business name').fill(name);
  await form.getByLabel('Category').fill('Hotel');
  await form.getByLabel('City / town').fill('Cape Coast');
  await form.getByLabel('Source URL').fill('https://owner.example.org/hotel-authorization');
  await form.getByLabel('Official website (if confirmed)').fill(SITE);
  await form.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();
  await expect(page).toHaveURL(/\/prospects\/[a-f0-9-]+\/resources$/);
}

async function analyze(page: import('@playwright/test').Page) {
  await page.getByRole('checkbox', { name: 'I independently verified that this website belongs to this business' }).check();
  await page.getByRole('button', { name: 'Analyze official website' }).click();
  await expect(page.getByTestId('website-resources')).toContainText('Fictional Harbour Hotel');
}

function card(page: import('@playwright/test').Page, label: string) {
  return page.getByTestId('visual-assets').getByRole('listitem').filter({ hasText: label }).first();
}

async function authorize(page: import('@playwright/test').Page, label: string, evidence: string) {
  await card(page, label).getByRole('button', { name: 'Authorize and import' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`Authorize “${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}”`) });
  await dialog.getByLabel('Rights evidence').fill(evidence);
  await dialog.getByRole('checkbox', { name: /own verified website/ }).check();
  await dialog.getByRole('button', { name: 'Read and store a copy' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('visual-assets')).toContainText(label);
}

test('collects a hotel’s authorized logo and photographs into the kit, and keeps references out', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await createHotel(page);
  await analyze(page);

  const panel = page.getByTestId('visual-assets');
  await panel.getByRole('button', { name: 'Find visual assets' }).click();
  const awaiting = panel.getByRole('region', { name: /Awaiting a rights decision/ });
  await expect(awaiting.getByRole('heading', { name: 'Awaiting a rights decision (6)' })).toBeVisible();
  await expect(awaiting).toContainText('Being published is not permission to reuse it.');
  await expect(awaiting).toContainText('Reference only');
  // The hotel checklist names the images this category is expected to provide.
  await expect(panel).toContainText('Room or suite photograph');
  await expect(panel).toContainText('Exterior photograph');

  // A thumbnail of the business's own site loads; the third party's file is not previewed at all.
  const preview = card(page, 'Harbour Hotel logo').getByRole('img', { name: 'Preview of Harbour Hotel logo' });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(card(page, 'Guest lounge photograph by Kofi Mensah')).toContainText('Preview withheld');
  await expect(card(page, 'Guest lounge photograph by Kofi Mensah').getByRole('button', { name: 'Upload authorized original' })).toBeVisible();

  const evidence = 'Verified homepage read on 31 October 2026; the hotel publishes this photograph itself and permits export.';
  await authorize(page, 'Harbour Hotel logo', evidence);
  await authorize(page, 'Hotel exterior at dusk', evidence);
  await authorize(page, 'Deluxe suite bedroom', evidence);
  await authorize(page, 'Jollof rice served in the hotel restaurant', evidence);

  const queue = panel.getByRole('region', { name: /Approval queue/ });
  await expect(queue.getByRole('heading', { name: 'Approval queue (4)' })).toBeVisible();
  await panel.getByRole('checkbox', { name: 'Select all 4 awaiting review' }).check();
  await panel.getByRole('button', { name: 'Approve selected (4)' }).click();
  await expect(queue.getByText('Export permitted')).toHaveCount(4);

  // A reference that never receives permission stays a reference, with the request on record.
  await card(page, 'Guest lounge photograph by Kofi Mensah').getByRole('button', { name: 'Request authorization' }).click();
  const request = page.getByRole('dialog', { name: /Request authorization/ });
  await request.getByLabel('Authorization request note').fill('Emailed the hotel manager on 31 October 2026 asking for the photographer’s permission.');
  await request.getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Guest lounge photograph by Kofi Mensah')).toContainText('Authorization requested');
  await expect(queue.getByRole('heading', { name: 'Approval queue (4)' })).toBeVisible();

  // The kit's manifest and assets/ folder contain exactly the four authorized files.
  await page.getByRole('button', { name: 'Download Website Resource Kit' }).click();
  const review = page.getByRole('dialog', { name: 'Download Website Resource Kit' });
  const downloaded = page.waitForEvent('download');
  await review.getByRole('button', { name: /Download (incomplete )?kit/ }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/website-resource-kit\.zip$/);
  const text = (await readFile((await file.path())!)).toString('latin1');
  const paths = [...new Set([...text.matchAll(/assets\/\d{3}-[A-Za-z0-9._-]+?\.(?:png|jpe?g|webp|gif)/gi)].map((m) => m[0]))];
  expect(paths).toHaveLength(4);
  expect(paths.some((p) => /harbour-hotel-logo/.test(p))).toBe(true);
  expect(paths.some((p) => /hotel-exterior/.test(p))).toBe(true);
  expect(paths.some((p) => /suite-bedroom/.test(p))).toBe(true);
  expect(paths.some((p) => /restaurant-dish/.test(p))).toBe(true);
  expect(text).not.toContain('guest-lounge');
  expect(text).not.toContain('pool.jpg');
  expect(text).toContain('"googlePreviewsExported": 0');
  expect(text).toContain('"socialImagesExported": 0');

  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'docs/evidence/resource-collector/visual-assets-desktop.jpg', fullPage: true, type: 'jpeg', quality: 75 });
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test('refuses Google, social and off-site previews at the route boundary', async ({ request }) => {
  const website = encodeURIComponent(SITE);
  for (const url of ['https://lh3.googleusercontent.com/places/photo', 'https://scontent.cdninstagram.com/photo.jpg', 'https://cdn.example.net/photo.jpg']) {
    const response = await request.get(`/api/resources/preview?url=${encodeURIComponent(url)}&website=${website}`);
    expect(response.status()).toBe(400);
  }
  const original = await request.post('/api/resources/candidates/original', {
    data: {
      sourceUrl: 'https://cdn.example.net/photo.jpg',
      pageUrl: SITE,
      businessWebsite: SITE,
      permissionEvidence: 'A third party file that cannot be downloaded by this route.',
      confirmed: true,
    },
  });
  expect(original.status()).toBe(400);
});

