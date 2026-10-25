import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

for (const withSite of [false, true]) test(`Google-first collection and authorized manual kit ${withSite ? 'with' : 'without'} an existing website`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/prospects?new=1');
  const form = page.getByRole('dialog', { name: 'Add research candidate' });
  await form.getByLabel('Business name').fill(`Fictional Collector ${withSite ? 'Redesign' : 'New Site'}`);
  await form.getByLabel('Category').fill('Bakery');
  await form.getByLabel('City / town').fill('Cape Coast');
  await form.getByLabel('Source URL').fill('https://owner.example.org/authorization');
  if (withSite) await form.getByLabel('Official website (if confirmed)').fill('https://resource-bakery.example.org');
  await form.getByRole('button', { name: 'Add candidate' }).click();
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();
  await expect(page).toHaveURL(/\/prospects\/[a-f0-9-]+\/resources$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Collect Business Resources');
  await expect(page.getByText('Fictional test responses', { exact: true })).toBeVisible();
  await page.getByLabel('Google Place ID').fill(withSite ? 'fictional_place_with_website' : 'fictional_place_no_website');
  const response = page.waitForResponse((r) => r.url().endsWith('/api/resources') && r.request().postDataJSON()?.action === 'details');
  await page.getByRole('button', { name: 'Load Google listing' }).click();
  expect((await response).headers()['cache-control']).toBe('no-store');
  const listing = page.getByTestId('google-listing');
  await expect(listing.getByRole('heading', { name: 'Fictional Coast Bakery' })).toBeVisible();
  await expect(listing).toContainText('12 Sample Lane, Cape Coast');
  if (withSite) await expect(listing.getByRole('link', { name: 'https://resource-bakery.example.org' })).toBeVisible();
  else await expect(listing).toContainText('Not supplied — independently verify website status');
  await page.getByRole('button', { name: 'Save Place ID only' }).click();
  // Exercise the real CSP with an official image-host URL; bytes are a local authorized fixture.
  await page.route('**/api/resources', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'photo') return route.fulfill({ json: { uri: 'https://lh3.googleusercontent.com/collector-fixture' }, headers: { 'Cache-Control': 'no-store' } });
    return route.continue();
  });
  await page.route('https://lh3.googleusercontent.com/collector-fixture', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.getByRole('button', { name: 'Preview photo 1' }).click();
  const img = listing.getByRole('img', { name: 'Business photo preview 1' });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(listing).toContainText('Original test illustration — simulated photo');
  const local = await page.evaluate(() => JSON.stringify(localStorage));
  expect(local).toContain(withSite ? 'fictional_place_with_website' : 'fictional_place_no_website');
  expect(local).not.toContain('12 Sample Lane'); expect(local).not.toContain('fictional_sample'); expect(local).not.toContain('lh3.googleusercontent');
  if (withSite) {
    await page.getByRole('checkbox', { name: 'I independently verified that this website belongs to this business' }).check();
    await page.getByRole('button', { name: 'Analyze official website' }).click();
    await expect(page.getByTestId('website-resources')).toContainText('Simulated website reading');
    await expect(page.getByRole('heading', { name: 'Logo, favicon and image candidates' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bakery logo' })).toBeVisible();
    await expect(page.getByTestId('website-resources')).toContainText('Celebration baking');
    await expect(page.getByText('Phone: the website candidates and Google differ. Confirm the current number with the owner.')).toBeVisible();
  } else await expect(page.getByText(/No official website recorded/)).toBeVisible();
  await page.getByText('Add independent resource', { exact: true }).click();
  await page.getByLabel('Resource category').selectOption('service');
  await page.getByLabel('Resource label').fill('Service description');
  await page.getByLabel('Resource value').fill('Original owner supplied bread menu');
  await page.getByLabel('Independent source URL').fill('https://owner.example.org/authorization');
  await page.getByLabel('Verification and permission evidence').fill('The owner independently confirmed and authorized this description for export on 25 October.');
  await page.getByRole('checkbox', { name: 'Independently verified; not copied from Google content' }).check();
  await page.getByRole('checkbox', { name: 'The recorded evidence grants export rights for this entry' }).check();
  await page.getByRole('button', { name: 'Save independent resource' }).click();
  await expect(page.getByText('Export permitted', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add authorized files' }).click();
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  const asset = page.getByRole('dialog', { name: 'Add an asset' });
  const fileName = withSite ? 'authorized-original.png' : 'owner-logo.png';
  if (withSite) {
    await asset.getByText('Import an authorized original', { exact: true }).click();
    await asset.getByLabel('Original image URL').fill('https://owner.example.org/owner-logo.png');
    await asset.getByLabel('Original permission evidence').fill('Original owner file independently verified with inspection, storage and export rights, 25 October.');
    await asset.getByRole('checkbox', { name: 'I verified this independent source and the owner’s inspection and storage rights' }).check();
    await asset.getByRole('button', { name: 'Read authorized original' }).click();
    await expect(asset.getByText(/Simulated original loaded/)).toBeVisible();
    await expect(asset.getByLabel('Export', { exact: true })).toHaveValue('unknown');
    await asset.getByLabel('Export', { exact: true }).selectOption('granted');
  } else {
    await asset.locator('input[type=file]').setInputFiles({ name: fileName, mimeType: 'image/png', buffer: PNG });
    await asset.getByLabel(/^Permission evidence/).fill('Original owner file supplied with written export permission, 25 October.');
  }
  await asset.getByRole('button', { name: 'Add to vault' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText(`${fileName} — Approved for this concept.`)).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Website Resource Kit' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/website-resource-kit.zip$/);
  const zip = await readFile((await file.path())!); const text = zip.toString();
  expect(text).toContain(fileName); expect(text).toContain('Original owner supplied bread menu'); expect(text).toContain('DEVELOPMENT-BRIEF.md'); expect(text).toContain('MISSING-RESOURCES.md');
  expect(text).not.toContain('12 Sample Lane'); expect(text).not.toContain('fictional_sample'); expect(text).not.toContain('collector-fixture');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `docs/evidence/resource-collector/desktop-${withSite ? 'redesign' : 'no-website'}.jpg`, fullPage: true, type: 'jpeg', quality: 75 });
  await page.clock.fastForward(5 * 60_000 + 1);
  await expect(page.getByTestId('google-listing')).toHaveCount(0);
  await page.clock.resume();
  // The same collector is prominent inside the existing Studio, without any design approval.
  await page.goto('/studio');
  await page.getByRole('link', { name: new RegExp(`Fictional Collector ${withSite ? 'Redesign' : 'New Site'}`) }).first().click();
  await expect(page.getByRole('link', { name: 'Collect Business Resources' })).toBeVisible();
  await page.getByRole('link', { name: 'Collect Business Resources' }).click();
  await expect(page.getByTestId('google-listing')).toHaveCount(0);
  await expect(page.getByText('Original owner supplied bread menu', { exact: true })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? '')).map((v) => v.id)).toEqual([]);
  expect(errors).toEqual([]);
});

test('collector routes reject cross-origin actions, unsafe websites and invalid photo paths', async ({ request }) => {
  const businessId = '00000000-0000-4000-8000-000000000001';
  expect((await request.post('/api/resources', { headers: { origin: 'https://evil.example.org' }, data: { action: 'details', businessId, placeId: 'fictional_place_no_website', authorized: true } })).status()).toBe(403);
  for (const url of ['http://127.0.0.1/private', 'https://maps.google.com/place/test']) expect((await request.post('/api/resources', { data: { action: 'website', businessId, url, independentlyVerified: true } })).status()).toBe(400);
  expect((await request.post('/api/resources', { data: { action: 'photo', businessId, name: 'https://evil.example.org/image', authorized: true } })).status()).toBe(400);
  expect((await request.post('/api/resources/original', { data: { projectId: businessId, sourceUrl: 'https://lh3.googleusercontent.com/photo', ownerName: 'Someone', permissionEvidence: 'This cannot grant Google photo export rights.', sourceVerified: true, inspectAuthorized: true, storeAuthorized: true } })).status()).toBe(400);
});
