import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, sidebar, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser);
const top = () => page.locator('.modal').last();
const main = page.locator('main');
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/document-desk'); await settle(page, 900);
await shot(page, '03-desk-open', { marks: [{ at: page.getByRole('link', { name: 'Documents & KYC Desk' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const row = main.locator('tr', { hasText: 'Sunrise Solar' }).first();
const card = (t) => main.getByText(t, { exact: true }).first().locator('xpath=ancestor::div[1]');
await shot(page, '03-desk-queue', { marks: [
  { at: card('Waiting for review'), n: 1, pos: 'tl' }, { at: card('Expired'), n: 2, pos: 'tl' }, { at: card('Expiring in 30 days'), n: 3, pos: 'tl' },
  { at: main.getByRole('tablist').first(), n: 4, pos: 'tl' }, { at: main.locator('input[type=search]'), n: 5, pos: 'r' },
  { at: row.getByText('View', { exact: true }), n: 6, pos: 't' }, { at: row.getByRole('button', { name: 'Review' }), n: 7, pos: 't' }, { at: row.getByRole('button', { name: 'Verify' }), n: 8, pos: 't' },
  { at: main.getByRole('button', { name: '+ Direct Upload Document' }), n: 9, pos: 'l' },
] });
await row.getByRole('button', { name: 'Review' }).click(); await settle(page, 900);
let m = top();
await shot(page, '03-desk-review', { crop: m, margin: 24, marks: [
  { at: m.getByRole('button', { name: 'View file' }), n: 1, pos: 'r' }, { at: m.getByText(/^Read from the file/), n: 2, pos: 'tl' },
  { at: field(m, 'If rejecting'), n: 3, pos: 'l' }, { at: field(m, 'Remark for the company'), n: 4, pos: 'l' },
  { at: m.getByRole('button', { name: 'Reject' }), n: 5, pos: 'b' }, { at: m.getByRole('button', { name: 'Verify & Approve' }), n: 6, pos: 'b' } ] });
await m.getByRole('button', { name: 'Verify & Approve' }).click(); await settle(page, 1000);
await shot(page, '03-desk-after-verify', { crop: 'main', margin: 0 });
await main.getByRole('tab', { name: 'KYC status' }).click(); await settle(page, 600);
await dumpTo(page, '03-desk-kyc');
await shot(page, '03-desk-kyc', { tall: 1100, crop: 'main', margin: 0 });
await soft('kyc-row', async () => { await main.locator('tr', { hasText: 'Sunrise Solar' }).first().click(); await settle(page, 700); await dumpTo(page, '03-desk-kyc-row', (await page.locator('.modal').count()) ? 'top' : 'main'); await page.screenshot({ path: 'survey/x-kycrow.png' }); if (await page.locator('.modal').count()) await page.keyboard.press('Escape'); });
await soft('direct', async () => {
  await main.getByRole('button', { name: '+ Direct Upload Document' }).click(); await settle(page, 500);
  m = top(); await dumpTo(page, '03-desk-direct', 'top');
  await shot(page, '03-desk-direct', { crop: m, margin: 24, tall: 1000 });
});
await browser.close();
