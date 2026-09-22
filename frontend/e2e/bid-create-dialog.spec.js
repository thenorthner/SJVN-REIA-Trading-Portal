import { test, expect } from '@playwright/test';

// On the DAM and GDAM screens the "Create Bid" tab held its dialog open by
// itself, so Close, Cancel, Escape and a click on the backdrop did nothing — and
// the backdrop covered everything else, leaving a reload as the only way out.
// Found by the button audit.

for (const screen of ['/trading/dam', '/trading/gdam']) {
  test.describe(screen, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(screen);
      await page.getByRole('button', { name: 'Create Bid', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    test('Cancel closes the Create Bid dialog and returns to Manage Bids', async ({ page }) => {
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Create Bid', exact: true })).toBeVisible();
    });

    test('Escape closes it too', async ({ page }) => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    });
  });
}
