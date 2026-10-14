import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser);
const top = () => page.locator('.modal').last();
const main = page.locator('main');
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/contracts'); await settle(page, 900);
await main.getByRole('button', { name: 'Load from Spreadsheet' }).click(); await settle(page, 600);
let m = top();
await shot(page, '04-sheet', { tall: 1100, crop: m, margin: 16, marks: [{ at: m.getByRole('button', { name: 'Download CSV Template' }), n: 1, pos: 'b' }, { at: m.getByText('Choose a file or drag and drop'), n: 2, pos: 'l', pad: 14 }, { at: m.locator('textarea'), n: 3, pos: 'l' }, { at: m.getByRole('button', { name: 'Check the Sheet' }), n: 4, pos: 't' }, { at: m.getByRole('button', { name: 'Load Contracts' }), n: 5, pos: 't' }] });
await page.goto(BASE + '/reia/contract-compliance'); await settle(page, 900);
await shot(page, '04-cc-open', { marks: [{ at: page.getByRole('link', { name: 'Contract Compliance' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const card = (t) => main.getByText(t, { exact: true }).first().locator('xpath=ancestor::div[1]');
await shot(page, '04-cc-list', { marks: [
  { at: card('Not compliant'), n: 1, pos: 'tl' }, { at: card('Action due'), n: 2, pos: 'tl' }, { at: card('In order'), n: 3, pos: 'tl' }, { at: card('Expiring within 90 days'), n: 4, pos: 'tl' },
  { at: main.getByRole('button', { name: 'Everything' }), n: 5, pos: 'b' }, { at: field(main, 'Notice window'), n: 6, pos: 'b' },
  { at: main.locator('tbody tr').first(), n: 7, pos: 'tl', pad: 0 } ] });
await dumpTo(page, 'x-cc');
await main.locator('tbody tr', { hasText: 'PPA/SJVN/2024/001' }).first().click(); await settle(page, 900);
await dumpTo(page, 'x-cc-row', (await page.locator('.modal').count()) ? 'top' : 'main');
await shot(page, '04-cc-detail', { tall: 1500, crop: (await page.locator('.modal').count()) ? top() : 'main', margin: 12 });
await browser.close();
