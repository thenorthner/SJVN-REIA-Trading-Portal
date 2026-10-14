import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const STAGE = process.env.STAGE || 'all';
// ── Buyer: receives the bill, acknowledges, tells SJVN about a payment ──
const b = await open(browser); const bp = b.page; const bmain = bp.locator('main'); const btop = () => bp.locator('.modal').last();
await login(bp, 'Buyer'); await bp.goto(BASE + '/buyer/invoices'); await settle(bp, 1000);
await shot(bp, '30-binv-open', { marks: [{ at: bp.getByRole('link', { name: 'Payable Invoices' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(bp, false);
await dumpTo(bp, 'x-binv');
const brow = bmain.locator('tbody tr', { hasText: 'INV-PSA/2026' }).first();
await shot(bp, '30-binv-list', { marks: [{ at: brow, n: 1, pos: 'tl', pad: 0 }] });
await brow.locator('td').nth(1).click(); await settle(bp, 1300);
let d = btop();
const ack = d.getByRole('button', { name: 'Acknowledge receipt' });
await shot(bp, '30-binv-detail-top', { tall: 4200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), d.getByText('Invoice Breakdown (CERC Format)')], marks: [{ at: ack, n: 1, pos: 'r' }, { at: d.getByRole('button', { name: 'Download PDF bill' }), n: 2, pos: 'l' }, { at: d.getByText('Due date', { exact: true }), n: 3, pos: 'l', pad: 3 }, { at: d.getByText('Left to pay', { exact: true }), n: 4, pos: 'l', pad: 3 }] });
const tell = d.getByRole('button', { name: 'Tell SJVN about a payment' });
await shot(bp, '30-binv-detail-bottom', { tall: 4200, widthOf: d, margin: 8, crop: [d.getByText('E-invoice (IRN & QR)'), tell, d.getByRole('button', { name: 'Raise a dispute on this bill' })], marks: [{ at: tell, n: 1, pos: 't' }, { at: d.getByRole('button', { name: 'Raise a dispute on this bill' }), n: 2, pos: 't' }] });
await ack.click(); await settle(bp, 1000);
await shot(bp, '30-binv-acked', { tall: 4200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), d.getByText('Status', { exact: true })], marks: [{ at: d.getByText(/Receipt acknowledged/).first(), n: 1, pos: 'r', pad: 3 }] });
await tell.click(); await settle(bp, 700);
const t = btop();
const adv = await samplePdf(browser, 'Payment-advice-PSPCL.pdf', 'RTGS Payment Advice', ['Punjab State Power Corp to SJVN Limited', 'Rs 4,00,00,000 — UTR PUNBR52026101200457']);
await field(t, 'Amount credited').fill('40000000'); await field(t, 'Payment date').fill('2026-10-12');
await field(t, 'Mode').selectOption({ label: 'RTGS' }); await field(t, 'UTR').fill('PUNBR52026101200457');
await t.locator('input[type=file]').last().setInputFiles(adv);
await field(t, 'Remarks').fill('Part payment against Sept 2026 bill');
const send = t.getByRole('button', { name: 'Send to SJVN Finance' });
await shot(bp, '30-binv-tell', { tall: 4200, widthOf: t, margin: 8, crop: [t.getByText(/is left on this bill/), send], marks: [
  { at: field(t, 'Amount credited'), n: 1, pos: 'l' }, { at: field(t, 'Payment date'), n: 2, pos: 'r' }, { at: field(t, 'TDS deducted'), n: 3, pos: 'l' }, { at: field(t, 'Other deduction'), n: 4, pos: 'l' },
  { at: field(t, 'Mode'), n: 5, pos: 'l' }, { at: field(t, 'UTR'), n: 6, pos: 'r' }, { at: t.locator('input[type=file]').last(), n: 7, pos: 'l' }, { at: send, n: 8, pos: 't' } ] });
await send.click(); await settle(bp, 1300);
await dumpTo(bp, 'x-binv-told', 'top');
await shot(bp, '30-binv-told', { tall: 4200, widthOf: t, margin: 8, crop: [t.getByText('Payments', { exact: true }), t.getByRole('button', { name: 'Raise a dispute on this bill' })] });
await closeTop(bp);
await shot(bp, '30-binv-list-after', { crop: 'main', margin: 0 });
await b.ctx.close();
// ── Finance: Payment Monitoring ──
const f = await open(browser); const fp = f.page; const fmain = fp.locator('main'); const ftop = () => fp.locator('.modal').last();
await login(fp, 'Finance'); await fp.goto(BASE + '/reia/payment-monitoring'); await settle(fp, 1000);
await shot(fp, '07-pm-open', { marks: [{ at: fp.getByRole('link', { name: 'Payment Monitoring' }), n: 1, pos: 'r', pad: 2 }] });
await sidebar(fp, false);
const card = (t) => fmain.getByText(t, { exact: true }).first().locator('xpath=ancestor::div[1]');
await shot(fp, '07-pm-top', { marks: [
  { at: fmain.getByRole('tablist').first(), n: 1, pos: 'r' }, { at: fmain.getByRole('button', { name: 'Owed to SJVN (buyers)' }), n: 2, pos: 'b' }, { at: fmain.getByRole('button', { name: 'Owed by SJVN (developers)' }), n: 3, pos: 'b' }, { at: fmain.locator('input[type=checkbox]').first(), n: 4, pos: 'r' },
  { at: card('Outstanding'), n: 5, pos: 'tl' }, { at: card('Past due'), n: 6, pos: 'tl' }, { at: card('Surcharge billed'), n: 7, pos: 'tl' }, { at: card('Surcharge earned, not billed'), n: 8, pos: 'tl' } ] });
await shot(fp, '07-pm-tables', { tall: 1700, crop: [fmain.getByText('How old the outstanding is'), fmain.getByText(/^Showing \d+ of/)], widthOf: 'main', margin: 12 });
await fmain.getByRole('button', { name: 'Owed by SJVN (developers)' }).click(); await settle(fp, 800);
await shot(fp, '07-pm-developers', { tall: 1700, crop: 'main', margin: 0 });
await fmain.getByRole('button', { name: 'Owed to SJVN (buyers)' }).click(); await settle(fp, 500);
await fmain.getByRole('tab', { name: /Payments to confirm/ }).click(); await settle(fp, 800);
const cr = fmain.getByRole('button', { name: 'Confirm receipt' }).first();
await shot(fp, '07-pm-confirm-tab', { crop: 'main', margin: 0, marks: [
  { at: fmain.getByRole('tab', { name: /Payments to confirm/ }), n: 1, pos: 'b' }, { at: fmain.getByText(/^₹4,00,00,000 from/), n: 2, pos: 'l', pad: 3 }, { at: fmain.getByRole('button', { name: 'Bank advice' }), n: 3, pos: 't' }, { at: fmain.getByRole('button', { name: 'Not found' }), n: 4, pos: 't' }, { at: cr, n: 5, pos: 't' } ] });
await cr.click(); await settle(fp, 700);
await field(fmain, 'Value date').fill('2026-10-12'); await field(fmain, 'Note').fill('Seen in SBI collection account statement');
const cf = fmain.getByRole('button', { name: 'Confirm and record the payment' });
await shot(fp, '07-pm-confirm-form', { crop: [fmain.getByText(/^₹4,00,00,000 from/), cf], widthOf: 'main', margin: 14, marks: [{ at: field(fmain, 'Value date'), n: 1, pos: 'b' }, { at: field(fmain, 'Note'), n: 2, pos: 'b' }, { at: cf, n: 3, pos: 't' }] });
await cf.click(); await settle(fp, 1300);
await dumpTo(fp, 'x-pm-confirmed');
await shot(fp, '07-pm-confirmed', { crop: 'main', margin: 0 });
await fmain.getByRole('tab', { name: 'Outstanding' }).click(); await settle(fp, 800);
await shot(fp, '07-pm-after', { tall: 1500, crop: 'main', margin: 0 });
// ── Finance pays the seller from the billing screen ──
await fp.goto(BASE + '/reia/invoices'); await settle(fp, 1000);
await shot(fp, '07-list-after', { crop: 'main', margin: 0 });
await fmain.locator('tbody tr', { hasText: 'SS/INV/2026/09/001' }).first().locator('td').first().click(); await settle(fp, 1400);
d = ftop();
await dumpTo(fp, 'x-rel', 'top');
const rel = d.getByRole('button', { name: 'Release to Generator' });
await field(d, 'Net amount paid').fill('30000000'); await field(d, 'Fund Source').selectOption({ label: 'SJVN Own Fund' }); await field(d, 'Payment Date').fill('2026-10-12'); await field(d, 'Reference').fill('SBINR52026101200981'); await field(d, 'TDS deducted').fill('30000');
await shot(fp, '07-release', { tall: 6400, widthOf: d, margin: 8, crop: [d.getByText(/^Release Payment to Generator/), rel], marks: [
  { at: d.getByText(/^DISCOM realized/), n: 1, pos: 'l', pad: 3 }, { at: field(d, 'Net amount paid'), n: 2, pos: 'b' }, { at: field(d, 'Fund Source'), n: 3, pos: 'b' }, { at: field(d, 'Payment Date'), n: 4, pos: 'b' }, { at: field(d, 'Reference'), n: 5, pos: 'b' }, { at: field(d, 'TDS deducted'), n: 6, pos: 'b' }, { at: rel, n: 7, pos: 'r' } ] });
await rel.click(); await settle(fp, 1500);
await dumpTo(fp, 'x-rel-after', 'top');
await shot(fp, '07-release-after-full', { tall: 6800, crop: ftop(), margin: 10 });
await soft('note', async () => { await ftop().getByRole('button', { name: '+ Raise Note' }).click(); await settle(fp, 600); await dumpTo(fp, 'x-note', 'top'); await shot(fp, '07-note', { tall: 6800, crop: (await fp.locator('.modal').count()) > 1 ? ftop() : [ftop().getByText('Debit / Credit Notes'), ftop().getByRole('button', { name: /Create|Raise|Save/ }).last()], margin: 16 }); });
await browser.close();
