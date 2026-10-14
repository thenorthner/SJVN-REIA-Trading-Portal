import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, sidebar, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const pdf = await samplePdf(browser, 'PPA-Himalaya-Wind-signed.pdf', 'Power Purchase Agreement', ['Between SJVN Limited and Himalaya Wind Energy Pvt Ltd', '50 MW Wind — Tariff Rs 3.10 per kWh']);
const { page } = await open(browser);
const top = () => page.locator('.modal').last();
const main = page.locator('main');
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/contracts'); await settle(page, 900);
const sel = main.locator('select');
await shot(page, '04-con-open', { marks: [{ at: page.getByRole('link', { name: 'Contracts (PPA/PSA)' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
await shot(page, '04-con-list', { marks: [
  { at: main.locator('input').first(), n: 1, pos: 'b' },
  { at: main.getByRole('button', { name: '+ New Contract' }), n: 2, pos: 'b' },
  { at: main.getByRole('button', { name: 'Load from Spreadsheet' }), n: 3, pos: 'b' },
  { at: main.getByRole('button', { name: 'Download PDF Report' }), n: 4, pos: 'b' },
  { at: sel.nth(0), n: 5, pos: 'b' }, { at: sel.nth(1), n: 6, pos: 'b' },
  { at: main.locator('tr', { hasText: 'PPA/SJVN/2024/001' }), n: 7, pos: 'tl', pad: 0 },
  { at: main.locator('tr', { hasText: 'PPA/SJVN/2024/001' }).getByText('Working file'), n: 8, pos: 'b' },
] });
await sidebar(page, true);
await main.getByRole('button', { name: '+ New Contract' }).click(); await settle(page, 600);
const m = top();
const f = (l) => field(m, l);
const sec = (t) => m.getByText(t, { exact: true });
await f('Contract No.').fill('PPA/SJVN/2026/014');
await f('Contract Type').selectOption({ index: 0 });
await f('Seller').selectOption({ label: 'Himalaya Wind Energy Pvt Ltd (Parent)' });
await f('Project Type').selectOption({ label: 'Wind' });
await shot(page, '04-new-s1', { tall: 2200, widthOf: m, margin: 8, crop: [m.locator('.modal-header'), f('Project Type')], marks: [{ at: f('Contract No.'), n: 1, pos: 'l' }, { at: f('Contract Type'), n: 2, pos: 'r' }, { at: f('Seller'), n: 3, pos: 'l' }, { at: f('Project Type'), n: 4, pos: 'r' }] });
await f('Total Capacity (MW)').fill('50');
await f('Tariff Type').selectOption({ index: 0 });
await f('Base Tariff').fill('3.10');
await f('Billing Cycle').selectOption({ label: 'Monthly' });
await shot(page, '04-new-s2', { tall: 2200, widthOf: m, margin: 8, crop: [sec('2. Capacity & Tariff Structure'), f('Billing Cycle'), f('Base Tariff')], marks: [{ at: f('Total Capacity (MW)'), n: 1, pos: 'l' }, { at: f('Tariff Type'), n: 2, pos: 'r' }, { at: f('Base Tariff'), n: 3, pos: 'l' }, { at: f('Billing Cycle'), n: 4, pos: 'r' }] });
await f('Tenure Start').fill('2026-11-01'); await f('Tenure End').fill('2051-10-31');
await f('PBG / Security Amount').fill('7500000'); await f('Security Type').fill('BG');
await shot(page, '04-new-s3', { tall: 2200, widthOf: m, margin: 8, crop: [sec('3. Tenure & Payment Security'), f('Security Type'), f('PBG / Security Amount')], marks: [{ at: f('Tenure Start'), n: 1, pos: 'l' }, { at: f('Tenure End'), n: 2, pos: 'r' }, { at: f('PBG / Security Amount'), n: 3, pos: 'l' }, { at: f('Security Type'), n: 4, pos: 'r' }] });
const s4 = sec('4. Billing & Regulatory Rules (CERC)');
const nums = m.locator('xpath=.//*[normalize-space(text())="4. Billing & Regulatory Rules (CERC)"]/following::input[@type="number"]');
await dumpTo(page, 'x-con-s4', 'top');
await soft('s4', async () => {
  await nums.nth(0).fill('30'); await nums.nth(1).fill('2'); await nums.nth(2).fill('5'); await nums.nth(3).fill('15'); await nums.nth(4).fill('0');
  const psm = m.locator('select', { hasText: 'Letter of Credit' });
  await psm.selectOption({ label: 'Bank Guarantee (BG)' });
  await shot(page, '04-new-s4', { tall: 2200, widthOf: m, margin: 8, crop: [s4, psm], marks: [{ at: nums.nth(0), n: 1, pos: 'b' }, { at: nums.nth(1), n: 2, pos: 'b' }, { at: nums.nth(2), n: 3, pos: 'b' }, { at: m.locator('select', { hasText: 'bill date' }), n: 4, pos: 'r' }, { at: nums.nth(3), n: 5, pos: 'b' }, { at: nums.nth(4), n: 6, pos: 'b' }, { at: psm, n: 7, pos: 'r' }] });
});
await f('Min / Guaranteed CUF').fill('30');
await m.locator('input[type=file]').setInputFiles(pdf);
const create = m.getByRole('button', { name: 'Create Draft Contract' });
await shot(page, '04-new-s5', { tall: 2200, widthOf: m, margin: 8, crop: [sec('4b. CUF Performance Threshold'), create], marks: [{ at: f('Min / Guaranteed CUF'), n: 1, pos: 'l' }, { at: f('Peak window from'), n: 2, pos: 'l' }, { at: m.locator('input[type=file]'), n: 3, pos: 'l' }, { at: create, n: 4, pos: 't' }] });
await create.click(); await settle(page, 1200);
const row = () => main.locator('tr', { hasText: 'PPA/SJVN/2026/014' });
if (await page.locator('.modal').count()) { await page.keyboard.press('Escape'); await settle(page, 300); }
await sidebar(page, false);
await shot(page, '04-con-created', { crop: [main.locator('table').first()], widthOf: 'main', margin: 12, marks: [{ at: row(), n: 1, pos: 'tl', pad: 0 }, { at: row().getByText('DRAFT'), n: 2, pos: 't' }] });
await sidebar(page, true);
await row().locator('td').first().click(); await settle(page, 900);
let c = top();
await shot(page, '04-cw', { tall: 1500, crop: c, margin: 16, marks: [
  { at: c.getByRole('button', { name: 'Open working file' }), n: 1, pos: 'r' }, { at: c.getByText('DRAFT').first(), n: 2, pos: 'r' },
  { at: c.getByRole('button', { name: '+ Map PSA to PPA' }), n: 3, pos: 'r' }, { at: c.getByRole('button', { name: 'Update Lifecycle Stage' }), n: 4, pos: 't' }, { at: c.getByRole('button', { name: 'Amend Contract' }), n: 5, pos: 't' } ] });
const lifeBtn = () => top().getByRole('button', { name: 'Update Lifecycle Stage' });
await lifeBtn().click(); await settle(page, 500);
let u = top();
await field(u, 'New Status').selectOption({ label: 'SIGNED' }); await field(u, 'Remarks').fill('PPA signed on 20 Oct 2026');
await shot(page, '04-life-signed', { crop: u, margin: 24, marks: [{ at: u.getByText(/^Current stage/), n: 1, pos: 'l' }, { at: field(u, 'New Status'), n: 2, pos: 'l' }, { at: field(u, 'Remarks'), n: 3, pos: 'l' }, { at: u.getByRole('button', { name: 'Update Status' }), n: 4, pos: 'b' }] });
await u.getByRole('button', { name: 'Update Status' }).click(); await settle(page, 900);
await lifeBtn().click(); await settle(page, 500); u = top();
await field(u, 'New Status').selectOption({ label: 'ACTIVE' }); await field(u, 'Remarks').fill('All approvals in place');
await shot(page, '04-life-active', { crop: u, margin: 24, marks: [{ at: field(u, 'New Status'), n: 1, pos: 'l' }, { at: u.getByRole('button', { name: 'Update Status' }), n: 2, pos: 'b' }] });
await u.getByRole('button', { name: 'Update Status' }).click(); await settle(page, 900);
await dumpTo(page, 'x-life-active-after', 'top');
c = top();
await shot(page, '04-cw-active', { tall: 1500, crop: [c.locator('.modal-header'), c.getByText('Commercials')], widthOf: c, margin: 10, marks: [{ at: c.getByText('ACTIVE').first(), n: 1, pos: 'r' }] });
await soft('life3', async () => { await lifeBtn().click(); await settle(page, 500); await dumpTo(page, 'x-life-3', 'top'); await shot(page, '04-life-next', { crop: top(), margin: 24 }); await top().getByRole('button', { name: 'Cancel' }).click(); await settle(page, 300); });
await soft('amend', async () => {
  await top().getByRole('button', { name: 'Amend Contract' }).click(); await settle(page, 500); const a = top();
  await field(a, 'Effective From').fill('2027-04-01'); await field(a, 'Tariff').fill('3.05'); await field(a, 'Amendment Reason').fill('Tariff revised as per CERC order dated 15 Mar 2027');
  await shot(page, '04-amend', { tall: 1600, crop: a, margin: 24, marks: [{ at: field(a, 'Effective From'), n: 1, pos: 'l' }, { at: field(a, 'Tariff'), n: 2, pos: 'l' }, { at: field(a, 'Amendment Reason'), n: 3, pos: 'l' }, { at: a.getByRole('button', { name: /Submit Amendment/ }), n: 4, pos: 'b' }] });
  await a.getByRole('button', { name: 'Cancel' }).click(); await settle(page, 300);
});
await soft('map', async () => {
  const cw = top(); await cw.getByRole('button', { name: '+ Map PSA to PPA' }).click(); await settle(page, 500);
  await field(cw, 'Select PSA').selectOption({ index: 1 }); await field(cw, 'Allocation %').fill('100'); await field(cw, 'Effective From').fill('2026-11-01');
  await shot(page, '04-map', { tall: 1600, widthOf: cw, margin: 10, crop: [cw.getByText('PSA Allocations (Energy Split)'), cw.getByRole('button', { name: 'Save Map' })], marks: [{ at: field(cw, 'Select PSA'), n: 1, pos: 'b' }, { at: field(cw, 'Allocation %'), n: 2, pos: 'b' }, { at: field(cw, 'Effective From'), n: 3, pos: 'b' }, { at: cw.getByRole('button', { name: 'Save Map' }), n: 4, pos: 'r' }] });
  await cw.getByRole('button', { name: 'Cancel' }).click(); await settle(page, 300);
});
// working file of the new contract: milestones and a notice
await soft('wf-new', async () => {
  await top().getByRole('button', { name: 'Open working file' }).click(); await settle(page, 1000); const w2 = top();
  await w2.getByRole('tab', { name: 'Milestones' }).or(w2.getByRole('button', { name: 'Milestones', exact: true })).first().click(); await settle(page, 600);
  await shot(page, '04-wf-ms-empty', { crop: w2, margin: 16, marks: [{ at: w2.getByRole('button', { name: /Add Financial Closure/ }), n: 1, pos: 'r' }] });
  await w2.getByRole('button', { name: /Add Financial Closure/ }).click(); await settle(page, 900);
  await shot(page, '04-wf-ms-added', { tall: 1300, crop: w2, margin: 16, marks: [{ at: w2.getByRole('button', { name: 'Edit' }).first(), n: 1, pos: 't' }, { at: w2.getByRole('button', { name: 'Remove' }).first(), n: 2, pos: 't' }, { at: w2.getByRole('button', { name: '+ Add a milestone' }), n: 3, pos: 'r' }] });
  await soft('ms-edit', async () => {
    await w2.getByRole('button', { name: 'Edit' }).first().click(); await settle(page, 500);
    await field(w2, 'Due date').fill('2027-03-31'); await field(w2, 'Remarks').fill('As per Article 3.1 of the PPA');
    await shot(page, '04-wf-ms-edit', { tall: 1300, crop: w2, margin: 16, marks: [{ at: field(w2, 'Due date'), n: 1, pos: 'b' }, { at: field(w2, 'Achieved on'), n: 2, pos: 'b' }, { at: field(w2, 'Remarks'), n: 3, pos: 'b' }, { at: w2.getByRole('button', { name: 'Save' }), n: 4, pos: 'r' }] });
    await w2.getByRole('button', { name: 'Save' }).click(); await settle(page, 700);
  });
  await soft('notice', async () => { await w2.getByRole('tab', { name: 'Notices' }).or(w2.getByRole('button', { name: 'Notices', exact: true })).first().click(); await settle(page, 600); await w2.getByRole('button', { name: '+ Issue a notice' }).click(); await settle(page, 600); await dumpTo(page, 'x-wf-notice', 'top'); await shot(page, '04-wf-notice', { tall: 1300, crop: top(), margin: 16 }); });
});
// working file of a contract that has history
await page.goto(BASE + '/reia/contracts'); await settle(page, 900);
await main.locator('tr', { hasText: 'PPA/SJVN/2024/001' }).getByText('Working file').click(); await settle(page, 1000);
const w = top();
for (const t of ['Overview', 'Documents', 'Milestones', 'Guarantee (PBG)', 'Requests', 'Notices', 'History']) {
  await soft(t, async () => { await w.getByRole('tab', { name: t }).or(w.getByRole('button', { name: t, exact: true })).first().click(); await settle(page, 700); const k = t.split(' ')[0].toLowerCase(); await dumpTo(page, `x-wf-${k}`, 'top'); await shot(page, `04-wf-${k}`, { tall: 1300, crop: w, margin: 16 }); });
}
await browser.close();
