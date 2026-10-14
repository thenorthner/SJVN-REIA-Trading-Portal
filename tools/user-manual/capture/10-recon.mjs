import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser); const main = page.locator('main'); const top = () => page.locator('.modal').last();
await login(page, 'SJVN Admin'); await page.goto(BASE + '/reia/reconciliation'); await settle(page, 1000);
await shot(page, '10-rec-open', { marks: [{ at: page.getByRole('link', { name: 'Reconciliation' }).last(), n: 1, pos: 'r', pad: 2 }] });
await sidebar(page, false);
const run = async (label, tag) => {
  await main.getByRole('button', { name: '+ Run Reconciliation' }).click(); await settle(page, 600); const m = top();
  await dumpTo(page, 'x-rec-run', 'top');
  await m.locator('select').nth(1).selectOption({ label: await m.locator('select').nth(1).locator('option', { hasText: label }).first().innerText() });
  await field(m, 'Period type').selectOption({ label: 'MONTHLY' }); await m.locator('input[type=month]').fill('2026-09');
  if (tag) await shot(page, tag, { crop: m, margin: 20, marks: [{ at: m.locator('select').nth(0), n: 1, pos: 'l' }, { at: m.locator('select').nth(1), n: 2, pos: 'l' }, { at: field(m, 'Period type'), n: 3, pos: 'l' }, { at: m.locator('input[type=month]'), n: 4, pos: 'l' }, { at: m.getByRole('button', { name: 'Run', exact: true }), n: 5, pos: 'b' }] });
  await m.getByRole('button', { name: 'Run', exact: true }).click(); await settle(page, 1800);
};
await run('PSA/SJVN/2024/101', '10-rec-run');
let d = top();
const T = (t) => d.getByText(t, { exact: true }).first();
const Bn = (n) => d.getByRole('button', { name: n });
const reason = d.getByPlaceholder('Why accepting variance...');
await shot(page, '10-det-top', { tall: 4600, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), T('Three-way / check items')], marks: [{ at: T('NEEDS REVIEW'), n: 1, pos: 'r' }, { at: T('Auto-match'), n: 2, pos: 'l', pad: 3 }, { at: T('Exposure'), n: 3, pos: 'l', pad: 3 }, { at: d.getByText(/Signed Off$/).first(), n: 4, pos: 'l', pad: 3 }] });
await shot(page, '10-det-items', { tall: 4600, widthOf: d, margin: 8, crop: [T('Three-way / check items'), reason], marks: [{ at: Bn('Override').first(), n: 1, pos: 't' }, { at: Bn('→ Dispute').first(), n: 2, pos: 't' }, { at: reason, n: 3, pos: 'l' }] });
await shot(page, '10-det-statement', { tall: 4600, widthOf: d, margin: 8, crop: [T('Reconciliation statement'), T('Balance roll-forward')] });
await shot(page, '10-det-roll', { tall: 4600, widthOf: d, margin: 8, crop: [T('Balance roll-forward'), Bn(/Regenerate statement/)], marks: [{ at: Bn('Download statement (PDF)'), n: 1, pos: 't' }, { at: Bn('Excel'), n: 2, pos: 't' }, { at: Bn(/SJVN Agree & Sign-Off/), n: 3, pos: 'b' }, { at: Bn(/Disagree & Flag Dispute/), n: 4, pos: 'b' }, { at: Bn(/Regenerate statement/), n: 5, pos: 'b' }] });
for (let i = 0; i < 2; i++) {
  await reason.fill(i === 0 ? 'PSA energy is taken from the source PPA record (24,840 MWh x 80%). No separate meter record for the PSA.' : 'Part payment received. Balance is within the due date and is carried forward.');
  if (i === 0) await shot(page, '10-det-override', { tall: 4600, widthOf: d, margin: 8, crop: [T('Three-way / check items'), reason], marks: [{ at: reason, n: 1, pos: 'l' }, { at: Bn('Override').first(), n: 2, pos: 't' }] });
  await Bn('Override').first().click(); await settle(page, 1200);
}
await dumpTo(page, 'x-rec-overridden', 'top');
await shot(page, '10-det-pending-signoff', { tall: 4600, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), reason.or(T('Reconciliation statement')).first()] });
await Bn(/SJVN Agree & Sign-Off/).click(); await settle(page, 900);
{ const c = top(); const rem = c.locator('textarea, input:not([type=checkbox])').first(); await rem.fill('Checked with billing and bank records.').catch(() => {});
  const tick = c.locator('input[type=checkbox]').first(); await tick.check();
  await shot(page, '10-signoff-confirm', { crop: c, margin: 20, marks: [{ at: rem, n: 1, pos: 'l' }, { at: tick, n: 2, pos: 'l' }, { at: c.getByRole('button', { name: /Confirm & Sign Off/ }), n: 3, pos: 'b' }] });
  await c.getByRole('button', { name: /Confirm & Sign Off/ }).click(); await settle(page, 1500); }
await dumpTo(page, 'x-rec-signed', 'top');
await shot(page, '10-det-signed', { tall: 4600, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), T('Three-way / check items')], marks: [{ at: d.getByText(/Signed Off$/).first(), n: 1, pos: 'l', pad: 3 }] });
await closeTop(page);
await run('PPA/SJVN/2024/001', null); await closeTop(page);
await dumpTo(page, 'x-rec-list');
await shot(page, '10-rec-list', { tall: 900, marks: [{ at: main.getByRole('button', { name: '+ Run Reconciliation' }), n: 1, pos: 'b' }, { at: main.getByRole('button', { name: 'Download PDF Report' }), n: 2, pos: 'b' }, { at: main.locator('select').first(), n: 3, pos: 'b' }, { at: main.locator('tbody tr').first(), n: 4, pos: 'tl', pad: 0 }] });
// buyer signs
const b = await open(browser); const bp = b.page;
await login(bp, 'Buyer'); await bp.goto(BASE + '/buyer/reconciliation'); await settle(bp, 1000);
await shot(bp, '32-brec-list', { marks: [{ at: bp.getByRole('link', { name: 'Reconciliation' }).last(), n: 1, pos: 'r', pad: 2 }, { at: bp.locator('main tbody tr').first(), n: 2, pos: 'tl', pad: 0 }] });
await dumpTo(bp, 'x-brec');
await bp.locator('main tbody tr').first().locator('td').first().click(); await settle(bp, 1300);
await dumpTo(bp, 'x-brec-detail', (await bp.locator('.modal').count()) ? 'top' : 'main');
await shot(bp, '32-brec-detail-full', { tall: 4200, crop: (await bp.locator('.modal').count()) ? bp.locator('.modal').last() : 'main', margin: 10 });
await browser.close();
