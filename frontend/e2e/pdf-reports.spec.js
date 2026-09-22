import { test, expect } from '@playwright/test';
import { pdfPages } from './support.js';

// Every report came out with a blank page after each real one: the footer was
// drawn below the page margin, and the PDF library started a new page for it.
// This downloads each REIA report the way a user does — from its button — and
// looks at every page.

const REPORTS = [
  { screen: '/reia', button: 'Download PDF Snapshot' },
  { screen: '/reia/contracts', button: 'Download PDF Report' },
  { screen: '/reia/energy-data', button: 'Download PDF Report' },
  { screen: '/reia/disputes', button: 'Download PDF Report' },
  { screen: '/reia/reconciliation', button: 'Download PDF Report' },
  { screen: '/reia/reports', button: 'Download PDF Report' },
];

for (const { screen, button } of REPORTS) {
  test(`${screen} — "${button}" has no blank pages`, async ({ page }) => {
    await page.goto(screen);
    await page.waitForLoadState('networkidle');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).first().click();
    const file = await download;
    const buffer = Buffer.from(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c)));

    const pages = pdfPages(buffer);
    expect(pages.length, 'the PDF has pages').toBeGreaterThan(0);
    // A real page draws its header, title and data; the blank one drew only the
    // page number that created it.
    pages.forEach((p, i) => expect.soft(p.textOps, `page ${i + 1} of ${pages.length} is blank`).toBeGreaterThan(3));
  });
}
