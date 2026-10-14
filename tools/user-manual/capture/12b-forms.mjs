import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser); const main = page.locator('main'); const top = () => page.locator('.modal').last();
await login(page, 'SJVN Admin'); const B = (n) => main.getByRole('button', { name: n });
const go = async (r) => { await page.goto(BASE + r); await settle(page, 1100); await sidebar(page, false); };
const marksFor = (m, labels, btn) => [...labels.map((l, i) => ({ at: field(m, l), n: i + 1, pos: 'l' })), { at: m.getByRole('button', { name: btn, exact: true }), n: labels.length + 1, pos: 'b' }];
// DSM manual estimate
await go('/reia/deviation');
await soft('dsm', async () => {
  await B('Add manual estimate').click(); await settle(page, 600); const m = top();
  const v = { 'Contract': null, 'Plant Code': 'SUN01', 'Plant Name': 'SUNRISE SOLAR 150 MW', 'Period (Month)': '2026-09', 'Week No.': '25', 'Week Date': '2026-09-21', 'Target (Scheduled MWh)': '5800', 'Delivered (Actual MWh)': '5725', 'Deviation Rate': '3200', 'Notes': 'Estimate, pending NRPC DSA week 25' };
  await field(m, 'Contract').selectOption({ label: 'PPA/SJVN/2024/001 (Solar)' });
  for (const [k, val] of Object.entries(v)) if (val) await field(m, k).fill(val);
  await settle(page, 400);
  await shot(page, '12-dsm-manual', { tall: 1500, crop: m, margin: 16, marks: marksFor(m, ['Contract', 'Plant Code', 'Period (Month)', 'Week No.', 'Entry Type', 'Target (Scheduled MWh)', 'Delivered (Actual MWh)', 'Deviation Rate'], 'Add Week') });
  await m.getByRole('button', { name: 'Add Week', exact: true }).click(); await settle(page, 1300);
  await dumpTo(page, 'x-dsm-after');
  await shot(page, '12-dsm-after', { tall: 1100, crop: 'main', margin: 0 });
  await soft('row', async () => { await main.locator('tbody tr').first().locator('td').first().click(); await settle(page, 900); await dumpTo(page, 'x-dsm-row', (await page.locator('.modal').count()) ? 'top' : 'main'); await shot(page, '12-dsm-row', { tall: 1700, crop: (await page.locator('.modal').count()) ? top() : 'main', margin: 10 }); if (await page.locator('.modal').count()) await closeTop(page); });
});
// Diversion
await go('/reia/power-diversion');
await soft('div', async () => {
  await B('+ Record Diversion').click(); await settle(page, 600); const m = top();
  await field(m, 'PSA Contract').selectOption({ index: 1 }); await field(m, 'Period').fill('2026-09'); await field(m, 'Reason').selectOption({ label: 'Power not requisitioned' }); await field(m, 'Quantum Diverted').fill('500'); await field(m, 'Exchange').selectOption({ label: 'IEX' }); await field(m, 'Sale Rate').fill('4100'); await field(m, 'Expenses').fill('1850000'); await field(m, 'Notes').fill('Buyer did not requisition on 14-15 Sept 2026');
  await settle(page, 400);
  await shot(page, '13-div-form', { tall: 1400, crop: m, margin: 16, marks: marksFor(m, ['PSA Contract', 'Period', 'Reason', 'Quantum Diverted', 'Exchange', 'Sale Rate', 'Expenses'], 'Record') });
  await m.getByRole('button', { name: 'Record', exact: true }).click(); await settle(page, 1300);
  await dumpTo(page, 'x-div-after'); await shot(page, '13-div-after', { tall: 1000, crop: 'main', margin: 0 });
});
// Banking
await go('/reia/energy-banking');
await soft('bank', async () => {
  await field(main, 'PPA Contract').selectOption({ index: 3 }); await settle(page, 900);
  await B('+ Bank Energy').click(); await settle(page, 600); const m = top();
  await field(m, 'Banking Cycle').fill('FY2026-27'); await field(m, 'Cycle Ends On').fill('2027-03-31'); await field(m, 'Period').fill('2026-09'); await field(m, 'Energy Banked').fill('300'); await field(m, 'Tariff').fill('2.55'); await settle(page, 400);
  await shot(page, '14-bank-form', { tall: 1300, crop: m, margin: 16, marks: marksFor(m, ['Banking Cycle', 'Cycle Ends On', 'Period', 'Energy Banked', 'Tariff'], 'Bank Energy') });
  await m.getByRole('button', { name: 'Bank Energy', exact: true }).click(); await settle(page, 1300);
  await dumpTo(page, 'x-bank-after'); await shot(page, '14-bank-after', { tall: 1000, crop: 'main', margin: 0, marks: [{ at: field(main, 'PPA Contract'), n: 1, pos: 'b' }, { at: B('+ Bank Energy'), n: 2, pos: 'b' }, { at: B('Settle Closed Cycles'), n: 3, pos: 'b' }] });
});
// Ledger tabs
await go('/reia/seller-ledgers');
await soft('led', async () => {
  const sels = main.locator('select');
  await shot(page, '15-led-choose', { marks: [{ at: sels.nth(0), n: 1, pos: 'b' }, { at: sels.nth(1), n: 2, pos: 'b' }] });
  await sels.nth(1).selectOption({ label: 'Sunrise Solar Pvt Ltd' }); await settle(page, 1300);
  await shot(page, '15-led-top', { marks: [{ at: sels.nth(0), n: 1, pos: 'b' }, { at: sels.nth(1), n: 2, pos: 'b' }, { at: sels.nth(2), n: 3, pos: 'b' }, { at: sels.nth(3), n: 4, pos: 'b' }, { at: B('Statement (PDF)'), n: 5, pos: 'b' }, { at: B('Statement (Excel)'), n: 6, pos: 'b' }, { at: main.getByRole('tablist').first(), n: 7, pos: 'r' }] });
  for (const [t, k] of [['Outstanding & ageing', 'ageing'], ['Ledger', 'ledger'], [/^Payments/, 'payments'], ['TDS certificates', 'tds']]) {
    await main.getByRole('tab', { name: t }).click(); await settle(page, 800); await dumpTo(page, `x-led-${k}`);
    await shot(page, `15-led-${k}`, { tall: 1900, crop: [main.getByRole('tablist').first(), main.locator('table, .card').last()], widthOf: 'main', margin: 12 });
  }
});
// Dashboard with marks
await go('/reia');
await soft('dash', async () => {
  const H = (t) => main.getByText(t).first().locator('xpath=ancestor::div[2]');
  await shot(page, '17-dash-marked', { tall: 1250, marks: [{ at: main.getByText(/^Waiting on SJVN/).first(), n: 1, pos: 'l', pad: 3 }, { at: main.getByText(/^Coming up/).first(), n: 2, pos: 'l', pad: 3 }, { at: main.getByText('Active Contracts').first(), n: 3, pos: 'l', pad: 3 }, { at: B('Download PDF Snapshot'), n: 4, pos: 'b' }, { at: B('Billing Reports'), n: 5, pos: 'b' }, { at: main.getByText('Open →').first(), n: 6, pos: 't', pad: 3 }] });
  await shot(page, '17-dash-lower', { tall: 2700, crop: [main.getByText('Outstanding by age').first(), main.getByText('Invoices by Status').first().locator('xpath=ancestor::div[2]')], widthOf: 'main', margin: 12 });
});
await browser.close();
