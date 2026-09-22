import { test, expect } from '@playwright/test';
import { watchForBreakage, horizontalOverflow } from './support.js';

// Opens every screen in the REIA sidebar and fails on anything a user would see
// as broken: the error screen, an uncaught exception, a server error behind a
// panel, or content running out of the page sideways. The list comes from the
// sidebar itself, so a screen added to the menu is covered without editing this.

// Reached from the dashboard rather than the menu.
const NOT_IN_MENU = ['/reia/reports'];

test('every REIA screen opens without breaking', async ({ page }) => {
  const problems = watchForBreakage(page);
  await page.goto('/reia');
  const section = page.locator('.nav-section').filter({
    has: page.locator('.nav-section-title', { hasText: 'REIA Billing & Settlement' }),
  });
  const menu = await section.locator('a.nav-link').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(menu.length, 'the REIA section of the sidebar lists its screens').toBeGreaterThan(10);

  for (const href of [...new Set([...menu, ...NOT_IN_MENU])]) {
    await test.step(href, async () => {
      problems.length = 0;
      await page.goto(href);
      await page.waitForLoadState('networkidle');
      await expect.soft(page.getByText('This screen failed to load'), `${href} shows the error screen`).toHaveCount(0);
      expect.soft(problems, `${href} broke while loading`).toEqual([]);
      expect.soft(await horizontalOverflow(page.locator('main.content')), `${href} has content running out of its box`).toEqual([]);
    });
  }
});
