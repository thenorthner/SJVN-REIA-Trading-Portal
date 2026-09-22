import { test, expect } from '@playwright/test';
import { watchForBreakage } from './support.js';

// The bid-book and bidding-detail reports export their table as CSV and Excel.
// With no rows, Excel handed the spreadsheet library a bare object instead of a
// list and the page threw "forEach is not a function" — the button did nothing
// but crash. Found by the button audit on the (empty) IEX RTM block report.

const REPORTS = [
  '/trading/exchange/iex-dam-single',
  '/trading/exchange/iex-dam-block',
  '/trading/exchange/iex-rtm-single',
  '/trading/exchange/iex-rtm-block',
  '/trading/exchange/bidding-detail',
];

for (const screen of REPORTS) {
  for (const format of ['CSV', 'Excel']) {
    test(`${screen} — ${format} export downloads, with or without rows`, async ({ page }) => {
      const problems = watchForBreakage(page);
      await page.goto(screen);
      await page.waitForLoadState('networkidle');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: format, exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(format === 'CSV' ? /\.csv$/ : /\.xlsx$/);
      expect(problems).toEqual([]);
    });
  }
}
