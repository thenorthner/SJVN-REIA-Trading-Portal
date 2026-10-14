import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const b = await open(browser); const bp = b.page; const btop = () => bp.locator('.modal').last();
await login(bp, 'Buyer'); await bp.goto(BASE + '/buyer/reconciliation'); await settle(bp, 1000);
await bp.locator('main tbody tr').first().locator('td').first().click(); await settle(bp, 1300);
let d = btop(); const Bn = (n) => d.getByRole('button', { name: n });
await shot(bp, '32-brec-top', { tall: 4200, widthOf: d, margin: 8, crop: [d.locator('.modal-header'), d.getByText('Signatures on record')], marks: [{ at: d.getByText('PENDING SIGN OFF').first(), n: 1, pos: 'r' }, { at: d.getByText('Pending your action'), n: 2, pos: 'r', pad: 3 }, { at: Bn('Download statement (PDF)'), n: 3, pos: 't' }] });
await shot(bp, '32-brec-buttons', { tall: 4200, widthOf: d, margin: 8, crop: [d.getByText('Statement snapshot'), Bn('Disagree with the whole statement')], marks: [{ at: Bn('I agree — sign off'), n: 1, pos: 't' }, { at: Bn('Agree with exceptions'), n: 2, pos: 't' }, { at: Bn('Disagree with the whole statement'), n: 3, pos: 't' }] });
await soft('exc', async () => { await Bn('Agree with exceptions').click(); await settle(bp, 600); await dumpTo(bp, 'x-brec-exc', 'top'); await shot(bp, '32-brec-exceptions', { tall: 4200, crop: (await bp.locator('.modal').count()) > 1 ? btop() : [d.getByText('Statement snapshot'), d.locator('button').last()], margin: 16 }); if ((await bp.locator('.modal').count()) > 1) await closeTop(bp); else await d.getByRole('button', { name: 'Cancel' }).first().click(); await settle(bp, 300); });
await Bn('I agree — sign off').click(); await settle(bp, 900);
await dumpTo(bp, 'x-brec-agree', 'top');
if ((await bp.locator('.modal').count()) > 1 || await btop().getByRole('button', { name: /Confirm/ }).count()) {
  const c = btop(); await c.locator('input[type=checkbox]').first().check().catch(() => {});
  await shot(bp, '32-brec-confirm', { crop: c, margin: 20 });
  await c.getByRole('button', { name: /Confirm|Sign/ }).last().click(); await settle(bp, 1400);
}
await dumpTo(bp, 'x-brec-signed', (await bp.locator('.modal').count()) ? 'top' : 'main');
await shot(bp, '32-brec-signed', { tall: 4200, widthOf: btop(), margin: 8, crop: [btop().locator('.modal-header'), btop().getByText('Balance roll-forward')] });
await b.ctx.close();
const { page } = await open(browser); await login(page, 'SJVN Admin'); await page.goto(BASE + '/reia/reconciliation'); await settle(page, 1000); await sidebar(page, false);
await shot(page, '10-rec-list-closed', { tall: 900, crop: 'main', margin: 0, marks: [{ at: page.locator('main tbody tr', { hasText: 'PSA/SJVN/2024/101' }).first().locator('td').nth(6), n: 1, pos: 't' }] });
await browser.close();
