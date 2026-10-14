import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser); const main = page.locator('main'); const top = () => page.locator('.modal').last();
await login(page, 'SJVN Admin'); await page.goto(BASE + '/reia/payment-security'); await settle(page, 1000);
await shot(page, '11-ps-open', { marks: [{ at: page.getByRole('link', { name: 'Payment Security' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const card = (t) => main.getByText(t, { exact: true }).first().locator('xpath=ancestor::div[1]');
const B = (n) => main.getByRole('button', { name: n });
await shot(page, '11-ps-top', { marks: [
  { at: B('+ Instrument'), n: 1, pos: 'b' }, { at: B('Run Alerts'), n: 2, pos: 'b' }, { at: B('Download register (Excel)'), n: 3, pos: 'b' }, { at: main.getByRole('tablist').first(), n: 4, pos: 'r' },
  { at: card('Total security'), n: 5, pos: 'tl' }, { at: card('Avg coverage'), n: 6, pos: 'tl' }, { at: card('Shortfalls'), n: 7, pos: 'tl' }, { at: card('Expiring 30/60/90'), n: 8, pos: 'tl' }, { at: card('Invocations'), n: 9, pos: 'tl' } ] });
await shot(page, '11-ps-shortfall', { tall: 1400, crop: [main.getByText('Coverage shortfall'), B('Record override').first()], widthOf: 'main', margin: 14, marks: [{ at: B('Record override').first(), n: 1, pos: 't' }] });
await B('+ Instrument').click(); await settle(page, 600); let m = top();
await field(m, 'Contract').selectOption({ label: 'PSA/SJVN/2024/101 (PSA)' }); await field(m, 'Mechanism').selectOption({ label: 'Letter of credit' }); await field(m, 'Limit').fill('70000000'); await field(m, 'Issuing bank').fill('Punjab National Bank, Chandigarh'); await field(m, 'Validity start').fill('2026-10-01'); await field(m, 'Validity end').fill('2027-09-30');
await m.locator('input[type=checkbox]').check(); await field(m, 'Remarks').fill('Revolving LC as per Article 6.5 of the PSA');
await settle(page, 400); await dumpTo(page, 'x-ps-new2', 'top');
await shot(page, '11-ps-new', { tall: 1300, crop: m, margin: 16, marks: [{ at: field(m, 'Contract'), n: 1, pos: 'l' }, { at: field(m, 'Mechanism'), n: 2, pos: 'l' }, { at: field(m, 'Limit'), n: 3, pos: 'l' }, { at: field(m, 'Issuing bank'), n: 4, pos: 'l' }, { at: field(m, 'Validity start'), n: 5, pos: 'l' }, { at: field(m, 'Validity end'), n: 6, pos: 'r' }, { at: m.locator('input[type=checkbox]'), n: 7, pos: 'l' }, { at: m.getByRole('button', { name: 'Save' }), n: 8, pos: 'b' }] });
await m.getByRole('button', { name: 'Save' }).click(); await settle(page, 1400);
await dumpTo(page, 'x-ps-after');
const table = main.locator('table').last();
await shot(page, '11-ps-table', { tall: 1500, crop: [main.locator('select').first(), table], widthOf: 'main', margin: 12 });
const row = main.locator('tbody tr', { hasText: 'PS/LC/' }).first();
await row.getByText(/PS\/LC\//).first().click(); await settle(page, 1300);
let d = top(); const Bn = (n) => d.getByRole('button', { name: n });
await shot(page, '11-inst-top', { tall: 4600, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), Bn('Request release')], marks: [{ at: d.getByText('Available', { exact: true }), n: 1, pos: 'l', pad: 3 }, { at: d.getByText('Required', { exact: true }), n: 2, pos: 'l', pad: 3 }, { at: d.getByText('Coverage (contract)'), n: 3, pos: 'l', pad: 3 }, { at: Bn('Utilize'), n: 4, pos: 'b' }, { at: Bn('Request release'), n: 5, pos: 'b' }] });
await shot(page, '11-inst-mid', { tall: 4600, widthOf: d, margin: 8, crop: [d.getByText('Bank confirmation (SFMS)'), d.getByText('Payment Security Documents')], marks: [{ at: Bn('Record SFMS advice'), n: 1, pos: 'r' }, { at: d.locator('input[type=file]').first(), n: 2, pos: 'r' }, { at: Bn('Record an amendment'), n: 3, pos: 'r' }] });
for (const [b, k] of [['Utilize', 'utilize'], ['Request release', 'release'], ['Record SFMS advice', 'sfms'], ['Record an amendment', 'amend']]) {
  await soft(k, async () => {
    await Bn(b).click(); await settle(page, 700); await dumpTo(page, `x-ps-${k}`, 'top');
    const multi = (await page.locator('.modal').count()) > 1;
    const vis = d.locator('input:visible:not([type=file]), select:visible, textarea:visible');
    await shot(page, `11-inst-${k}`, { tall: 4600, widthOf: multi ? undefined : d, crop: multi ? top() : [vis.first(), vis.last(), d.getByRole('button', { name: /^(Confirm|Record confirmation|Record amendment)$/ }).first()], margin: multi ? 12 : 40 });
    if (multi) await closeTop(page); else await d.getByRole('button', { name: 'Cancel' }).first().click().catch(() => {});
    await settle(page, 300);
  });
}
await closeTop(page);
await soft('override', async () => { await B('Record override').first().click(); await settle(page, 600); await dumpTo(page, 'x-ps-override', (await page.locator('.modal').count()) ? 'top' : 'main'); await shot(page, '11-ps-override', { tall: 1400, crop: (await page.locator('.modal').count()) ? top() : [main.getByText('Coverage shortfall'), main.locator('select').first()], margin: 14 }); if (await page.locator('.modal').count()) await closeTop(page); });
await soft('waterfall', async () => { const w = main.getByText('Start waterfall invocation'); await w.scrollIntoViewIfNeeded(); await shot(page, '11-ps-waterfall', { tall: 1700, crop: [w, B('Invoke waterfall')], widthOf: 'main', margin: 14, marks: [{ at: field(main, 'Contract'), n: 1, pos: 'b' }, { at: field(main, 'Amount (optional)'), n: 2, pos: 'b' }, { at: B('Invoke waterfall'), n: 3, pos: 't' }] }); });
await soft('lc', async () => { await main.getByRole('tab', { name: 'LCs to sellers' }).click(); await settle(page, 800); await shot(page, '11-ps-lc-tab', { crop: 'main', margin: 0, marks: [{ at: B('+ Record an LC'), n: 1, pos: 'r' }] }); await B('+ Record an LC').click(); await settle(page, 600); await dumpTo(page, 'x-ps-lcnew', (await page.locator('.modal').count()) ? 'top' : 'main'); await shot(page, '11-ps-lc-new', { tall: 1400, crop: (await page.locator('.modal').count()) ? top() : 'main', margin: 14 }); });
await browser.close();
