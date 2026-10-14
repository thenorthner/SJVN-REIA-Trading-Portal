import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const pdf = await samplePdf(browser, 'JMR-Sunrise-Sep-2026.pdf', 'Joint Meter Reading — September 2026', ['Sunrise Solar Pvt Ltd, 150 MW', 'Net export: 24,840 MWh']);
const { page } = await open(browser);
const top = () => page.locator('.modal').last();
const main = page.locator('main');
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/energy-data'); await settle(page, 1000);
await shot(page, '05-en-open', { marks: [{ at: page.getByRole('link', { name: 'Energy Data & Validation' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const card = (t) => main.getByText(t, { exact: true }).first().locator('xpath=ancestor::div[1]');
await shot(page, '05-en-top', { marks: [
  { at: main.getByRole('button', { name: '+ Record Energy Data' }), n: 1, pos: 'b' }, { at: main.getByRole('button', { name: 'Upload JMR / SEA' }), n: 2, pos: 'b' },
  { at: main.getByRole('button', { name: 'Upload REA PDF' }), n: 3, pos: 'b' }, { at: main.getByRole('button', { name: 'Download PDF Report' }), n: 4, pos: 'b' },
  { at: main.getByRole('tablist').first(), n: 5, pos: 'r' },
  { at: card('Objections to answer'), n: 6, pos: 'tl' }, { at: card('Awaiting the counterparty'), n: 7, pos: 'tl' }, { at: card('Still to validate'), n: 8, pos: 'tl' } ] });
const table = main.locator('table').first();
await shot(page, '05-en-table', { tall: 1300, crop: [main.locator('select').first(), table], widthOf: 'main', margin: 12, marks: [
  { at: main.locator('select').nth(0), n: 1, pos: 't' }, { at: main.locator('select').nth(1), n: 2, pos: 't' },
  { at: table.locator('tbody tr').first().locator('td').nth(2), n: 3, pos: 't' } ] });
let box = await hscroll(table, 'end');
await shot(page, '05-en-table-right', { tall: 1300, crop: box, margin: 12, marks: [
  { at: table.locator('tbody tr').first().getByRole('button', { name: 'Trail' }), n: 1, pos: 't' }, { at: table.locator('tbody tr').first().getByRole('button', { name: 'Record' }), n: 2, pos: 't' } ] });
// record
await main.getByRole('button', { name: '+ Record Energy Data' }).click(); await settle(page, 600);
let m = top();
await field(m, 'Contract').selectOption({ label: 'PPA/SJVN/2024/001 (Solar)' });
await field(m, 'Period').fill('2026-09');
await field(m, 'Data Type').selectOption({ label: 'Final' });
await field(m, 'Source').selectOption({ label: 'JMR' });
await field(m, 'Energy (MWh)').fill('24840');
await field(m, 'CUF').fill('23'); await field(m, 'Availability').fill('98.2');
await shot(page, '05-rec-form', { tall: 1000, crop: m, margin: 20, marks: [
  { at: field(m, 'Contract'), n: 1, pos: 'l' }, { at: field(m, 'Period'), n: 2, pos: 'l' }, { at: field(m, 'Data Type'), n: 3, pos: 'l' }, { at: field(m, 'Source'), n: 4, pos: 'l' },
  { at: field(m, 'Energy (MWh)'), n: 5, pos: 'l' }, { at: field(m, 'CUF'), n: 6, pos: 'l' }, { at: field(m, 'Availability'), n: 7, pos: 'l' }, { at: m.getByRole('button', { name: 'Save' }), n: 8, pos: 'b' } ] });
await m.getByRole('button', { name: 'Save' }).click(); await settle(page, 1200);
await dumpTo(page, 'x-en-after-save');
const row = () => table.locator('tbody tr', { hasText: '2026-09' }).first();
await shot(page, '05-rec-draft', { tall: 1300, margin: 12, crop: await hscroll(table, 'end'), marks: [{ at: row().getByText('DRAFT'), n: 1, pos: 't' }, { at: row().getByRole('button', { name: 'Validate' }), n: 2, pos: 't' }] });
await row().getByRole('button', { name: 'Validate' }).click(); await settle(page, 1200);
await dumpTo(page, 'x-en-after-validate');
await shot(page, '05-rec-validated', { tall: 1300, margin: 12, crop: await hscroll(table, 'end'), marks: [{ at: row().getByText('VALIDATED'), n: 1, pos: 't' }] });
// attach source document through Record
await soft('attach', async () => {
  await row().getByRole('button', { name: 'Record' }).click(); await settle(page, 800); m = top();
  await m.locator('input[type=file]').setInputFiles(pdf);
  await shot(page, '05-record-window', { tall: 1200, crop: m, margin: 16, marks: [{ at: m.getByRole('tablist').first(), n: 1, pos: 'tl' }, { at: m.locator('input[type=file]'), n: 2, pos: 'l' }, { at: field(m, 'It is'), n: 3, pos: 'l' }, { at: m.getByRole('button', { name: 'Attach', exact: true }), n: 4, pos: 'r' }] });
  await m.getByRole('button', { name: 'Attach', exact: true }).click(); await settle(page, 1000);
  await shot(page, '05-record-attached', { tall: 1200, crop: m, margin: 16 });
  await m.getByRole('tab', { name: /Counterparty/ }).click(); await settle(page, 500); await dumpTo(page, 'x-en-cp', 'top');
  await shot(page, '05-record-cp', { tall: 1200, crop: m, margin: 16 });
});
await closeTop(page);
// seller accepts
const s = await open(browser); const sp = s.page; const smain = sp.locator('main');
await login(sp, 'Seller');
await sp.goto(BASE + '/seller/energy-data'); await settle(sp, 1000);
await dumpTo(sp, 'x-sen');
await sidebar(sp, false);
const srow = smain.locator('tbody tr', { hasText: '2026-09' }).first();
await shot(sp, '21-sen-list', { tall: 1300, marks: [{ at: srow.getByText('VALIDATED'), n: 1, pos: 't' }, { at: srow.getByRole('button', { name: 'Accept' }), n: 2, pos: 't' }, { at: srow.getByRole('button', { name: 'Object' }), n: 3, pos: 'b' }, { at: srow.getByRole('button', { name: 'Source' }), n: 4, pos: 't' }, { at: srow.getByRole('button', { name: 'Blocks' }), n: 5, pos: 'b' }] });
await soft('object', async () => { await srow.getByRole('button', { name: 'Object' }).click(); await settle(sp, 600); await dumpTo(sp, 'x-sen-object', 'top'); await shot(sp, '21-sen-object', { tall: 1100, crop: sp.locator('.modal').last(), margin: 16 }); });
await closeTop(sp);
await soft('source', async () => { await srow.getByRole('button', { name: 'Source' }).click(); await settle(sp, 700); await dumpTo(sp, 'x-sen-source', 'top'); await shot(sp, '21-sen-source', { tall: 1100, crop: sp.locator('.modal').last(), margin: 16 }); });
await closeTop(sp);
await srow.getByRole('button', { name: 'Accept' }).click(); await settle(sp, 1200);
await dumpTo(sp, 'x-sen-after');
await shot(sp, '21-sen-accepted', { tall: 1300, crop: smain.locator('table').first(), widthOf: 'main', margin: 12, marks: [{ at: smain.locator('tbody tr', { hasText: '2026-09' }).first().getByText('Accepted'), n: 1, pos: 't' }] });
await s.ctx.close();
// lock
await page.reload(); await settle(page, 1000); await sidebar(page, false);
await shot(page, '05-rec-accepted', { tall: 1300, margin: 12, crop: await hscroll(table, 'end'), marks: [{ at: row().getByText('Accepted'), n: 1, pos: 't' }, { at: row().getByRole('button', { name: 'Lock' }), n: 2, pos: 't' }] });
await row().getByRole('button', { name: 'Lock' }).click(); await settle(page, 1200);
await dumpTo(page, 'x-en-after-lock', (await page.locator('.modal').count()) ? 'top' : 'main');
await shot(page, '05-rec-locked', { tall: 1300, margin: 12, crop: await hscroll(table, 'end'), marks: [{ at: row().getByText('LOCKED'), n: 1, pos: 't' }] });
await browser.close();
