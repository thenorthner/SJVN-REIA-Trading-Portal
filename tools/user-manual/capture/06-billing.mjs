import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser);
const top = () => page.locator('.modal').last();
const main = page.locator('main');
// ── the seller raises its invoice first ──
{
  const sx = await open(browser); const sp = sx.page; const smain = sp.locator('main');
  await login(sp, 'Seller'); await sp.goto(BASE + '/seller/invoices'); await settle(sp, 1000);
  await shot(sp, '22-sinv-list', { marks: [{ at: sp.getByRole('link', { name: 'My Invoices' }), n: 1, pos: 'r', pad: 2 }, { at: smain.getByRole('button', { name: '+ Create Invoice' }), n: 2, pos: 'b' }, { at: smain.getByRole('button', { name: 'Raise from a Sheet' }), n: 3, pos: 'b' }, { at: smain.getByRole('button', { name: 'Export CSV' }), n: 4, pos: 'b' }] });
  await smain.getByRole('button', { name: '+ Create Invoice' }).click(); await settle(sp, 800);
  const sm = sp.locator('.modal').last();
  await field(sm, 'Contract (PPA)').selectOption({ index: 1 }); await field(sm, 'Billing Period').fill('2026-09'); await field(sm, 'Your Invoice Ref').fill('SS/INV/2026/09/001'); await settle(sp, 900);
  await shot(sp, '22-sinv-form', { tall: 1500, crop: sm, margin: 16, marks: [{ at: field(sm, 'Contract (PPA)'), n: 1, pos: 'l' }, { at: field(sm, 'Billing Period'), n: 2, pos: 'l' }, { at: sm.getByText('Auto-Calculated from Energy Data'), n: 3, pos: 'l', pad: 3 }, { at: field(sm, 'Your Invoice Ref'), n: 4, pos: 'l' }, { at: field(sm, 'Invoice Type'), n: 5, pos: 'l' }, { at: field(sm, 'Transmission Charges'), n: 6, pos: 'l' }, { at: sm.getByText('TOTAL INVOICE AMOUNT'), n: 7, pos: 'l', pad: 3 }, { at: sm.getByRole('button', { name: 'Submit to SJVN' }), n: 8, pos: 'b' }] });
  await sm.getByRole('button', { name: 'Submit to SJVN' }).click(); await settle(sp, 1500);
  await sidebar(sp, false);
  const sr = smain.locator('tbody tr', { hasText: 'SS/INV/2026/09/001' }).first();
  await shot(sp, '22-sinv-submitted', { marks: [{ at: sr, n: 1, pos: 'tl', pad: 0 }, { at: sr.getByText('SUBMITTED'), n: 2, pos: 't' }] });
  await sx.ctx.close();
}
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/invoices'); await settle(page, 1000);
await shot(page, '06-inv-open', { marks: [{ at: page.getByRole('link', { name: 'Billing & Invoicing' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const B = (n) => main.getByRole('button', { name: n });
await shot(page, '06-inv-list', { marks: [
  { at: B('+ Generate Invoice'), n: 1, pos: 'b' }, { at: B('+ Supplementary'), n: 2, pos: 'b' }, { at: B('+ Arrear Bill'), n: 3, pos: 'b' }, { at: B('Receive Buyer Payment'), n: 4, pos: 'b' }, { at: B('Billing Report'), n: 5, pos: 'b' },
  { at: main.locator('select').nth(0), n: 6, pos: 'b' }, { at: main.locator('select').nth(1), n: 7, pos: 'b' }, { at: main.locator('input[type=month]').first(), n: 8, pos: 'b' },
  { at: main.locator('tbody tr').first(), n: 9, pos: 'tl', pad: 0 } ] });
const gen = async (label, tag) => {
  await B('+ Generate Invoice').click(); await settle(page, 500); const m = top();
  await field(m, 'Contract').selectOption({ label }); await field(m, 'Billing Period').fill('2026-09'); await field(m, 'Invoice Type').selectOption({ label: 'Final' });
  await shot(page, `06-gen-${tag}`, { crop: m, margin: 20, marks: [{ at: field(m, 'Contract'), n: 1, pos: 'l' }, { at: field(m, 'Billing Period'), n: 2, pos: 'l' }, { at: field(m, 'Invoice Type'), n: 3, pos: 'l' }, { at: m.getByRole('button', { name: 'Generate Invoice' }), n: 4, pos: 'b' }] });
  await m.getByRole('button', { name: 'Generate Invoice' }).click(); await settle(page, 1500);
};
await gen('PPA/SJVN/2024/001 (Solar)', 'ppa');
await shot(page, '06-gen-done', { crop: [main.getByText(/generated as a draft/), main.locator('tbody tr').first()], widthOf: 'main', margin: 14, marks: [{ at: main.getByText(/generated as a draft/), n: 1, pos: 'tl' }, { at: main.locator('tbody tr').first().getByText('DRAFT'), n: 2, pos: 't' }] });
await gen('PSA/SJVN/2024/101 (Solar)', 'psa');
await dumpTo(page, 'x-inv-list2');
await soft('dup', async () => { await B('+ Generate Invoice').click(); await settle(page, 500); const m = top(); await field(m, 'Contract').selectOption({ label: 'PSA/SJVN/2024/101 (Solar)' }); await field(m, 'Billing Period').fill('2026-09'); await field(m, 'Invoice Type').selectOption({ label: 'Final' }); await m.getByRole('button', { name: 'Generate Invoice' }).click(); await settle(page, 1200); await dumpTo(page, 'x-inv-dup', (await page.locator('.modal').count()) ? 'top' : 'main'); await shot(page, '06-gen-dup', { crop: (await page.locator('.modal').count()) ? top() : main.locator('tbody tr').first(), margin: 20 }); await closeTop(page); });
// open the PSA bill
const rowOf = (t) => main.locator('tbody tr', { hasText: t }).first();
await rowOf('INV-PSA/2026').locator('td').first().click(); await settle(page, 1400);
let d = top();
const T = (t) => d.getByText(t, { exact: true }).first();
const L = (t) => d.locator(`xpath=.//*[starts-with(normalize-space(text()[1]), "${t}")]`).first();
const sub = d.getByRole('button', { name: 'Submit for SJVN Approval' });
await shot(page, '06-det-top', { tall: 5200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), T('Period Settlement Trail')], marks: [{ at: d.getByRole('button', { name: 'Download PDF Bill' }), n: 1, pos: 'r' }, { at: T('DRAFT'), n: 2, pos: 'r' }, { at: T('Due Date'), n: 3, pos: 'l', pad: 3 }, { at: T('Billing Family Ref'), n: 4, pos: 'l', pad: 3 }] });
await shot(page, '06-det-trail', { tall: 5200, widthOf: d, margin: 8, crop: [T('Period Settlement Trail'), T('Invoice Breakdown (CERC Format)')] });
await shot(page, '06-det-breakdown', { tall: 5200, widthOf: d, margin: 8, crop: [T('Invoice Breakdown (CERC Format)'), T('Total Base Amount')] });
await shot(page, '06-det-totals', { tall: 5200, widthOf: d, margin: 8, crop: [T('Total Base Amount'), L('Balance Payable Now').locator('xpath=ancestor::div[1]')], marks: [{ at: T('Total Base Amount'), n: 1, pos: 'l', pad: 3 }, { at: L('Disputed Amount'), n: 2, pos: 'l', pad: 3 }, { at: L('Late Pay Surcharge (LPS)'), n: 3, pos: 'l', pad: 3 }, { at: L('Settled So Far'), n: 4, pos: 'l', pad: 3 }, { at: L('Balance Payable Now'), n: 5, pos: 'l', pad: 3 }] });
await shot(page, '06-det-actions', { tall: 5200, widthOf: d, margin: 8, crop: [d.getByText(/^Documents on this contract/), d.getByRole('button', { name: 'Edit Charges' })], marks: [{ at: d.getByRole('button', { name: 'Upload Document' }), n: 1, pos: 'l' }, { at: sub, n: 2, pos: 't' }, { at: d.getByRole('button', { name: 'Cancel Invoice' }), n: 3, pos: 't' }, { at: d.getByRole('button', { name: 'Edit Charges' }), n: 4, pos: 'l' }] });
await soft('charges', async () => {
  await d.getByRole('button', { name: 'Edit Charges' }).click(); await settle(page, 500);
  await d.getByRole('button', { name: '+ Add charge' }).click(); await settle(page, 400);
  await dumpTo(page, 'x-inv-charges', 'top');
  await shot(page, '06-charges', { tall: 5200, widthOf: d, margin: 8, crop: [d.getByText('Other / Pass-through Charges'), d.getByRole('button', { name: 'Save Charges' })], marks: [{ at: d.getByRole('button', { name: '+ Add charge' }), n: 1, pos: 't' }, { at: d.getByRole('button', { name: 'Save Charges' }), n: 2, pos: 't' }, { at: d.getByRole('button', { name: 'Close', exact: true }), n: 3, pos: 't' }] });
  await d.getByRole('button', { name: 'Close', exact: true }).click(); await settle(page, 400);
});
d = top();
await sub.click(); await settle(page, 1500);
await dumpTo(page, 'x-inv-submitted', 'top');
await shot(page, '06-submitted-full', { tall: 5200, crop: top(), margin: 10 });
await closeTop(page);
// ── the seller's invoice: verify, validate, submit ──
await shot(page, '06-list-three', { crop: [main.locator('table').first()], widthOf: 'main', margin: 12, marks: [{ at: rowOf('SS/INV/2026/09/001'), n: 1, pos: 'tl', pad: 0 }, { at: rowOf('INV-PPA/2026/0'), n: 2, pos: 'tl', pad: 0 }, { at: rowOf('INV-PSA/2026'), n: 3, pos: 'tl', pad: 0 }] });
await rowOf('SS/INV/2026/09/001').locator('td').first().click(); await settle(page, 1400); d = top();
await shot(page, '06-ppa-full', { tall: 6200, crop: d, margin: 10 });
await shot(page, '06-ppa-top', { tall: 6200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), T('Period Settlement Trail')], marks: [{ at: d.getByText('Developer Invoice Pipeline').locator('xpath=ancestor::div[1]'), n: 1, pos: 'tl' }, { at: T('SUBMITTED'), n: 2, pos: 'r' }, { at: T('Validation'), n: 3, pos: 'l', pad: 3 }] });
await shot(page, '06-ppa-einv', { tall: 6200, widthOf: d, margin: 8, crop: [L('TDS — what to expect'), L('Verification Checklist')], marks: [{ at: d.getByRole('button', { name: 'Add IRN & QR' }), n: 1, pos: 'r' }, { at: d.getByRole('button', { name: 'Attach signed copy' }), n: 2, pos: 'r' }] });
const vsel = d.locator('select').filter({ has: page.locator('option[value="VERIFIED"]') });
const vbtn = d.getByRole('button', { name: 'Validate vs System' });
await shot(page, '06-ppa-checklist', { tall: 6200, widthOf: d, margin: 8, crop: [L('Verification Checklist'), d.getByRole('button', { name: 'Save Verification' })], marks: [{ at: vsel.nth(0), n: 1, pos: 'l' }, { at: d.getByPlaceholder('Note (optional)').nth(0), n: 2, pos: 'r' }, { at: T('Commercial Verification'), n: 3, pos: 'l', pad: 3 }, { at: d.getByRole('button', { name: 'Save Verification' }), n: 4, pos: 'r' }] });
await shot(page, '06-ppa-actions', { tall: 6200, widthOf: d, margin: 8, crop: [d.getByText(/^Documents on this contract/), d.getByRole('button', { name: 'Edit Charges' })], marks: [{ at: vbtn, n: 1, pos: 't' }, { at: d.getByRole('button', { name: 'Submit for SJVN Approval' }), n: 2, pos: 't' }, { at: d.getByRole('button', { name: 'Return to seller' }), n: 3, pos: 't' }, { at: d.getByRole('button', { name: 'Cancel Invoice' }), n: 4, pos: 't' }] });
await vbtn.click(); await settle(page, 1500);
await shot(page, '06-validate', { crop: top(), margin: 16, marks: [{ at: top().getByText('MATCHED').first(), n: 1, pos: 'r' }, { at: top().locator('table').first(), n: 2, pos: 'tl', pad: 0 }] });
await closeTop(page); d = top();
const n = await vsel.count();
for (let i = 0; i < n; i++) await vsel.nth(i).selectOption('VERIFIED');
await d.getByPlaceholder('Note (optional)').nth(6).fill('No curtailment in Sept 2026');
await shot(page, '06-ppa-checklist-done', { tall: 6200, widthOf: d, margin: 8, crop: [L('Verification Checklist'), d.getByRole('button', { name: 'Save Verification' })], marks: [{ at: d.getByRole('button', { name: 'Save Verification' }), n: 1, pos: 'r' }] });
await d.getByRole('button', { name: 'Save Verification' }).click(); await settle(page, 1200);
await dumpTo(page, 'x-inv-verif-saved', 'top');
await shot(page, '06-return', { tall: 6200, widthOf: d, margin: 8, crop: [d.getByPlaceholder('Why it is being sent back'), d.getByRole('button', { name: 'Return to seller' }), d.getByRole('button', { name: 'Save Verification' })], marks: [{ at: d.getByPlaceholder('Why it is being sent back'), n: 1, pos: 'l' }, { at: d.getByRole('button', { name: 'Return to seller' }), n: 2, pos: 'b' }] });
await top().getByRole('button', { name: 'Submit for SJVN Approval' }).click(); await settle(page, 1500);
await dumpTo(page, 'x-inv-ppa-submitted', 'top');
await closeTop(page);
// REIA Ops looks at it
const o = await open(browser); const op = o.page;
await login(op, 'REIA Ops'); await op.goto(BASE + '/reia/invoices'); await settle(op, 1000);
await closeTop(op); await sidebar(op, false);
const wfBlock = (pg) => { const dd = pg.locator('.modal').last(); return [dd.getByText('Approval Workflow', { exact: true }), dd.getByText(/^Documents on this contract/)]; };
const openBill = async (pg, dir) => { if (await pg.locator('.modal').count()) await closeTop(pg); await pg.locator('main tbody tr', { hasText: dir }).first().locator('td').first().click(); await settle(pg, 1400); return pg.locator('.modal').last(); };
const approve = async (pg, dir, level, tag, note) => {
  const dd = await openBill(pg, dir);
  const c = dd.getByPlaceholder('Comments (needed to reject)'); await c.fill(note);
  if (tag) await shot(pg, tag, { tall: 5200, widthOf: dd, margin: 8, crop: wfBlock(pg), marks: [{ at: dd.getByText(`Level ${level}: PENDING`).first(), n: 1, pos: 'l', pad: 3 }, { at: c, n: 2, pos: 'l' }, { at: dd.getByRole('button', { name: 'Approve' }), n: 3, pos: 'b' }, { at: dd.getByRole('button', { name: 'Reject' }), n: 4, pos: 'b' }] });
  await dd.getByRole('button', { name: 'Approve' }).click(); await settle(pg, 1400);
  return dd;
};
let od = await approve(op, 'INV-PSA/2026', 1, '06-appr-l1', 'Energy and tariff checked with PSA');
await dumpTo(op, 'x-inv-after-l1', 'top');
await shot(op, '06-appr-l1-done', { tall: 5200, widthOf: od, margin: 8, crop: wfBlock(op) });
await approve(op, 'SS/INV/2026/09/001', 1, null, 'Energy and tariff checked with PPA');
await o.ctx.close();
// level 2 — REIA Admin
const a2 = await open(browser); await login(a2.page, 'REIA Admin'); await a2.page.goto(BASE + '/reia/invoices'); await settle(a2.page, 1000); await sidebar(a2.page, false);
await shot(a2.page, '06-appr-list-l2', { marks: [{ at: a2.page.locator('main tbody tr', { hasText: 'INV-PSA/2026' }).first().getByText('UNDER APPROVAL'), n: 1, pos: 't' }] });
od = await approve(a2.page, 'INV-PSA/2026', 2, '06-appr-l2', 'Checked. Recommended for approval.');
await approve(a2.page, 'SS/INV/2026/09/001', 2, null, 'Checked. Recommended for approval.');
await a2.ctx.close();
// level 3 — Finance
const a3 = await open(browser); await login(a3.page, 'Finance'); await a3.page.goto(BASE + '/reia/invoices'); await settle(a3.page, 1000); await sidebar(a3.page, false);
od = await approve(a3.page, 'INV-PSA/2026', 3, '06-appr-l3', 'Approved.');
await dumpTo(a3.page, 'x-inv-approved', 'top');
await shot(a3.page, '06-approved-full', { tall: 5600, crop: a3.page.locator('.modal').last(), margin: 10 });
await approve(a3.page, 'SS/INV/2026/09/001', 3, null, 'Approved.');
await dumpTo(a3.page, 'x-inv-ppa-approved', 'top');
await shot(a3.page, '06-ppa-approved-full', { tall: 6600, crop: a3.page.locator('.modal').last(), margin: 10 });
await closeTop(a3.page);
await shot(a3.page, '06-list-approved', { crop: 'main', margin: 0 });
await browser.close();
