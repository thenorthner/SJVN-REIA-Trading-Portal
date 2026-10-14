import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const ev = await samplePdf(browser, 'PSPCL-meter-statement-Sep-2026.pdf', 'Energy statement — September 2026', ['As per PSPCL records: 19,858 MWh']);
// ── Buyer raises a dispute ──
const b = await open(browser); const bp = b.page; const bmain = bp.locator('main'); const btop = () => bp.locator('.modal').last();
await login(bp, 'Buyer'); await bp.goto(BASE + '/buyer/disputes'); await settle(bp, 1000);
await shot(bp, '31-bdisp-list', { marks: [{ at: bp.getByRole('link', { name: 'My Disputes' }), n: 1, pos: 'r', pad: 2 }, { at: bmain.getByRole('button', { name: '+ Raise Dispute' }), n: 2, pos: 'b' }] });
await bmain.getByRole('button', { name: '+ Raise Dispute' }).click(); await settle(bp, 700);
let m = btop();
await m.locator('input[type=checkbox]').first().check(); await settle(bp, 500);
await dumpTo(bp, 'x-bdisp-ticked', 'top');
await field(m, 'Charge line').selectOption({ label: 'Energy charges' });
await field(m, 'Reason code').selectOption({ label: 'Energy data mismatch (metered vs billed)' });
await soft('amt', async () => { await m.locator('input[type=number]').first().fill('50000'); });
await field(m, 'Issue Description').fill('Energy billed is 19,872 MWh. As per our records the energy received is 19,858 MWh. Difference of 14 MWh, about Rs 50,000, is disputed.');
await m.locator('input[type=file]').setInputFiles(ev);
await shot(bp, '31-bdisp-form', { tall: 1500, crop: m, margin: 16, marks: [{ at: m.locator('input[type=checkbox]').first(), n: 1, pos: 'l' }, { at: m.locator('input[type=number]').first(), n: 2, pos: 'l' }, { at: field(m, 'Charge line'), n: 3, pos: 'l' }, { at: field(m, 'Reason code'), n: 4, pos: 'l' }, { at: field(m, 'Issue Description'), n: 5, pos: 'l' }, { at: m.locator('input[type=file]'), n: 6, pos: 'l' }, { at: m.getByRole('button', { name: 'Submit Dispute' }), n: 7, pos: 'b' }] });
await m.getByRole('button', { name: 'Submit Dispute' }).click(); await settle(bp, 1400);
await dumpTo(bp, 'x-bdisp-after', (await bp.locator('.modal').count()) ? 'top' : 'main');
await sidebar(bp, false);
await shot(bp, '31-bdisp-raised', { crop: 'main', margin: 0, marks: [{ at: bmain.locator('tbody tr').first(), n: 1, pos: 'tl', pad: 0 }] });
await b.ctx.close();
// ── SJVN: Dispute Management ──
const { page } = await open(browser); const main = page.locator('main'); const top = () => page.locator('.modal').last();
await login(page, 'SJVN Admin'); await page.goto(BASE + '/reia/disputes'); await settle(page, 1000);
await shot(page, '09-dis-open', { marks: [{ at: page.getByRole('link', { name: 'Dispute Management' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const card = (t) => main.getByText(t, { exact: true }).first().locator('xpath=ancestor::*[self::div or self::button][1]');
await shot(page, '09-dis-list', { tall: 1000, marks: [
  { at: main.getByRole('button', { name: '+ Raise Dispute' }), n: 1, pos: 'b' }, { at: main.getByRole('button', { name: 'Download PDF Report' }), n: 2, pos: 'b' },
  { at: card('Open'), n: 3, pos: 'tl' }, { at: card('Exposure'), n: 4, pos: 'tl' }, { at: card('SLA Breached'), n: 5, pos: 'tl' }, { at: card('Waiting on SJVN'), n: 6, pos: 'tl' },
  { at: main.locator('select').first(), n: 7, pos: 'b' }, { at: main.locator('tbody tr').first(), n: 8, pos: 'tl', pad: 0 } ] });
await main.locator('tbody tr').first().locator('td').first().click(); await settle(page, 1300);
let d = top();
const T = (t) => d.getByText(t, { exact: true }).first();
const Bn = (n) => d.getByRole('button', { name: n });
await shot(page, '09-det-top', { tall: 4200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), Bn('Assign to me')], marks: [{ at: T('ACKNOWLEDGED'), n: 1, pos: 'r' }, { at: T('Disputed'), n: 2, pos: 'l', pad: 3 }, { at: d.getByText(/^SJVN has \d+ days left/), n: 3, pos: 'l', pad: 3 }, { at: Bn('Export dispute dossier (ZIP)'), n: 4, pos: 't' }, { at: Bn('Start Review'), n: 5, pos: 'b' }, { at: Bn('Request Info'), n: 6, pos: 'b' }, { at: Bn('Assign to me'), n: 7, pos: 'b' }] });
await shot(page, '09-det-evidence', { tall: 4200, widthOf: d, margin: 8, crop: [d.getByText('Dispute Evidence & Resolution Notes'), d.getByText('Audit trail'), d.getByText(/Evidence uploaded by/)], marks: [{ at: d.getByText('View', { exact: true }).first(), n: 1, pos: 't' }, { at: d.locator('textarea').last(), n: 2, pos: 'l' }, { at: d.locator('input[type=checkbox]').last(), n: 3, pos: 'l' }, { at: Bn('Post'), n: 4, pos: 'r' }] });
await Bn('Start Review').click(); await settle(page, 1000);
await soft('assign', async () => { await Bn('Assign to me').click({ timeout: 4000 }); await settle(page, 800); });
await dumpTo(page, 'x-dis-review', 'top');
await shot(page, '09-det-review', { tall: 4200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), T('Resolve')], marks: [{ at: T('UNDER REVIEW'), n: 1, pos: 'r' }, { at: T('Assignee'), n: 2, pos: 'l', pad: 3 }] });
await soft('comment', async () => { await d.locator('textarea').last().fill('Meter data re-checked with the JMR. A difference of 5.8 MWh is found on the buyer side meter.'); await Bn('Post').click(); await settle(page, 800); });
await field(d, 'Outcome').selectOption({ label: 'Resolved – Accepted (partial credit)' });
await field(d, 'Accepted / credit amount').fill('20000');
await field(d, 'Resolution reasoning').fill('On re-check with the JMR, 5.8 MWh is accepted as excess billing. Credit of Rs 20,000 allowed. The balance of the claim is not supported by the meter data.');
await shot(page, '09-det-resolve', { tall: 4200, widthOf: d, margin: 8, crop: [T('Resolve'), Bn('Confirm Resolution')], marks: [{ at: field(d, 'Outcome'), n: 1, pos: 'l' }, { at: field(d, 'Accepted / credit amount'), n: 2, pos: 'l' }, { at: field(d, 'Resolution reasoning'), n: 3, pos: 'l' }, { at: field(d, 'LPS / interest on settlement'), n: 4, pos: 'l' }, { at: Bn('Confirm Resolution'), n: 5, pos: 'r' }] });
await Bn('Confirm Resolution').click(); await settle(page, 1500);
await dumpTo(page, 'x-dis-resolved', (await page.locator('.modal').count()) ? 'top' : 'main');
await shot(page, '09-det-resolved-full', { tall: 4200, crop: (await page.locator('.modal').count()) ? top() : 'main', margin: 10 });
await closeTop(page);
await shot(page, '09-dis-list-resolved', { tall: 1000, crop: 'main', margin: 0 });
await soft('raise', async () => { await main.getByRole('button', { name: '+ Raise Dispute' }).click(); await settle(page, 700); await dumpTo(page, 'x-dis-raise', 'top'); await shot(page, '09-dis-raise', { tall: 1500, crop: top(), margin: 16 }); await closeTop(page); });
// ── Buyer answers the resolution ──
const b2 = await open(browser); const p2 = b2.page;
await login(p2, 'Buyer'); await p2.goto(BASE + '/buyer/disputes'); await settle(p2, 1000); await sidebar(p2, false);
await p2.locator('main tbody tr').first().locator('td').first().click(); await settle(p2, 1300);
await dumpTo(p2, 'x-bdisp-detail', (await p2.locator('.modal').count()) ? 'top' : 'main');
await shot(p2, '31-bdisp-detail-full', { tall: 4200, crop: (await p2.locator('.modal').count()) ? p2.locator('.modal').last() : 'main', margin: 10 });
await soft('accept', async () => { await p2.getByRole('button', { name: /Accept resolution/ }).click(); await settle(p2, 1400); await dumpTo(p2, 'x-bdisp-accepted', (await p2.locator('.modal').count()) ? 'top' : 'main'); });
await p2.goto(BASE + '/buyer/disputes'); await settle(p2, 900);
await shot(p2, '31-bdisp-closed', { crop: 'main', margin: 0 });
await p2.goto(BASE + '/buyer/invoices'); await settle(p2, 900);
await shot(p2, '31-binv-after-dispute', { crop: 'main', margin: 0 });
await browser.close();
