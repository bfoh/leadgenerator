// Local, credential-free creative evidence. Start a demo production server first.
// node scripts/review-adwoa.mjs capture|motion|performance http://127.0.0.1:3110
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const mode = process.argv[2] ?? 'capture';
const origin = process.argv[3] ?? 'http://127.0.0.1:3110';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Evidence runs only against localhost.');
const output = 'docs/evidence/creative-excellence';
await mkdir(join(output, mode), { recursive: true });
const browser = await chromium.launch();
const route = (slug) => `${origin}/showcase/adwoas-house${slug === 'home' ? '' : `/${slug}`}`;
const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('main h1').waitFor();
  await page.waitForTimeout(1400);
};
const sweep = async (page) => {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      scrollTo({ top: y, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 85));
    }
    scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(500);
};

try {
  if (mode === 'capture') {
    const records = [];
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
      const page = await context.newPage();
      for (const slug of ['home', 'house', 'rooms', 'day', 'cape-coast', 'stay']) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto(route(slug));
        await settle(page);
        await page.screenshot({ path: join(output, mode, `${slug}-${width}-arrival.jpg`), type: 'jpeg', quality: 83 });
        await sweep(page);
        const record = await page.evaluate(({ slug, width }) => ({
          slug, width, liveHeight: document.documentElement.scrollHeight,
          overflow: document.documentElement.scrollWidth - innerWidth,
          sections: [...document.querySelectorAll('main section')].map((section) => ({
            kind: section.dataset.kind, variant: section.dataset.variant,
            height: Math.round(section.getBoundingClientRect().height),
          })),
        }), { slug, width });
        // A full-page stitch cannot represent a sticky scene. Capture the complete static variant
        // separately and label it; live intermediate frames and recordings are in motion/.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await sweep(page);
        record.staticHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.screenshot({ path: join(output, mode, `${slug}-${width}-static-full.jpg`), fullPage: true, type: 'jpeg', quality: 75 });
        records.push(record);
      }
      await context.close();
    }
    await writeFile(join(output, mode, 'measurements.json'), JSON.stringify(records, null, 2) + '\n');
    console.log(records.map(({ slug, width, liveHeight, staticHeight, overflow }) => ({ slug, width, liveHeight, staticHeight, overflow })));
  } else if (mode === 'motion') {
    const records = [];
    for (const width of [1440, 390]) {
      const viewport = { width, height: width === 390 ? 844 : 900 };
      const context = await browser.newContext({ viewport, recordVideo: { dir: '/tmp/dof-creative-videos', size: viewport } });
      const page = await context.newPage();
      const startedAt = Date.now();
      await page.goto(route('home'));
      await settle(page);
      for (let i = 0; i < 11; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(100); }
      if (width === 1440) {
        const headingY = await page.locator('[data-story-step] h3').nth(1).evaluate((heading) => heading.getBoundingClientRect().top + scrollY);
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), headingY - (viewport.height * 0.78 - progress * viewport.height * 0.42));
          await page.waitForTimeout(450);
          records.push({ width, chapter: 2, progress, elapsedMs: Date.now() - startedAt, frames: await page.locator('[data-story-frame]').evaluateAll((frames) => frames.map((frame) => getComputedStyle(frame).clipPath)) });
          await page.screenshot({ path: join(output, mode, `story-${progress * 100}.jpg`), type: 'jpeg', quality: 85 });
        }
        // Explicit seeks exercise the third image and reverse both wipes. Merely bringing a
        // heading into view can leave it below the reveal boundary and miss the last frame.
        for (const [chapter, progress] of [[3, 1], [3, 0.5], [3, 0], [2, 0.5], [2, 0]]) {
          const absoluteY = await page.locator('[data-story-step] h3').nth(chapter - 1).evaluate((heading) => heading.getBoundingClientRect().top + scrollY);
          await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), absoluteY - (viewport.height * 0.78 - progress * viewport.height * 0.42));
          await page.waitForTimeout(650);
          records.push({ width, chapter, progress, elapsedMs: Date.now() - startedAt, frames: await page.locator('[data-story-frame]').evaluateAll((frames) => frames.map((frame) => getComputedStyle(frame).clipPath)) });
          if (chapter === 3) await page.screenshot({ path: join(output, mode, `story-third-${progress * 100}.jpg`), type: 'jpeg', quality: 85 });
        }
      }
      for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, width === 390 ? 210 : 260); await page.waitForTimeout(95); }
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForTimeout(450);
      await page.evaluate(() => scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      await page.waitForTimeout(450);
      const video = page.video();
      await context.close();
      await video.saveAs(join(output, mode, `adwoa-${width === 390 ? 'mobile' : 'desktop'}.webm`));
    }
    await writeFile(join(output, mode, 'frame-observations.json'), JSON.stringify(records, null, 2) + '\n');
    console.log('Saved actual Chromium scroll recordings, forward/reverse mask frames and seek timestamps.');
  } else if (mode === 'performance') {
    const records = [];
    for (const profile of ['desktop', 'mobile-4g-cpu4']) {
      for (let sample = 1; sample <= 3; sample++) {
        const mobile = profile !== 'desktop';
        const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 2 : 1 });
        await context.addInitScript(() => {
          window.__creativeMetrics = { lcp: 0, lcpCandidate: null, shifts: [], events: [], tasks: [] };
          for (const [type, callback] of [
            ['largest-contentful-paint', (entries) => entries.forEach((entry) => { window.__creativeMetrics.lcp = entry.startTime; window.__creativeMetrics.lcpCandidate = { tag: entry.element?.tagName, url: entry.url ? new URL(entry.url).pathname : null, renderTime: entry.renderTime, loadTime: entry.loadTime }; })],
            ['layout-shift', (entries) => entries.filter((entry) => !entry.hadRecentInput).forEach((entry) => window.__creativeMetrics.shifts.push({ time: entry.startTime, value: entry.value }))],
            ['event', (entries) => entries.filter((entry) => entry.interactionId).forEach((entry) => window.__creativeMetrics.events.push(entry.duration))],
            ['longtask', (entries) => entries.forEach((entry) => window.__creativeMetrics.tasks.push(entry.duration))],
          ]) {
            if (PerformanceObserver.supportedEntryTypes.includes(type)) new PerformanceObserver((list) => callback(list.getEntries())).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
          }
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        if (mobile) {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
        }
        await page.goto(route('home'));
        await page.waitForTimeout(2500);
        const initial = await page.evaluate(() => ({ ...window.__creativeMetrics,
          fcp: performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint')?.startTime,
          resources: performance.getEntriesByType('resource').map((entry) => ({ name: new URL(entry.name).pathname, bytes: entry.encodedBodySize, startTime: Math.round(entry.startTime), responseEnd: Math.round(entry.responseEnd) })),
        }));
        await page.getByRole('button', { name: 'Concept Website — Not an Official Business Website' }).click();
        await page.getByRole('button', { name: 'Close notice' }).click();
        await page.waitForTimeout(250);
        const eventDurations = await page.evaluate(() => window.__creativeMetrics.events);
        const frames = await page.evaluate(async () => {
          const intervals = []; let last = performance.now();
          for (let i = 0; i < 60; i++) await new Promise((resolve) => requestAnimationFrame((time) => { intervals.push(time - last); last = time; scrollTo({ top: 1500 + i * 30, behavior: 'instant' }); resolve(); }));
          return intervals.slice(1).sort((a, b) => a - b);
        });
        let cls = 0, session = 0, first = 0, previous = 0;
        for (const shift of initial.shifts) { if (shift.time - previous > 1000 || shift.time - first > 5000) { session = 0; first = shift.time; } session += shift.value; cls = Math.max(cls, session); previous = shift.time; }
        records.push({ profile, sample, lcpMs: Math.round(initial.lcp), fcpMs: Math.round(initial.fcp), cls,
          lcpCandidate: initial.lcpCandidate,
          initialTbtMs: Math.round(initial.tasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0)),
          observedInteractionMs: Math.max(0, ...eventDurations),
          scrollFrameP95Ms: Number(frames[Math.floor(frames.length * 0.95)].toFixed(1)),
          scrollFrameMaxMs: Number(frames.at(-1).toFixed(1)),
          initialResourceBytes: initial.resources.reduce((sum, entry) => sum + entry.bytes, 0),
          fonts: initial.resources.filter((entry) => entry.name.endsWith('.woff2')), resources: initial.resources,
        });
        console.log(JSON.stringify(records.at(-1)));
        await context.close();
      }
    }
    await writeFile(join(output, mode, 'lab-results.json'), JSON.stringify({ note: 'Local Chromium lab samples, not field Core Web Vitals or a Lighthouse score. Interaction duration samples are not a field INP estimate. No recording, axe or test suite ran during measurement.', records }, null, 2) + '\n');
  } else throw new Error('Choose capture, motion or performance.');
} finally { await browser.close(); }
