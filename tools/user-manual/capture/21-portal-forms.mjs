import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
async function modalShot(page, name, opener, { close = true } = {}) {
  await soft(name, async () => {
    await opener(); await settle(page, 800);
    const has = await page.locator('.modal').count();
    await dumpTo(page, `x-${name}`, has ? 'top' : 'main');
    await shot(page, name, { tall: 1700, crop: has ? page.locator('.modal').last() : 'main', margin: has ? 16 : 0 });
    if (has && close) await closeTop(page);
  });
}
{ // Seller
  const { ctx, page } = await open(browser); const main = page.locator('main'); await login(page, 'Seller');
  const go = async (r) => { await page.goto(BASE + r); await settle(page, 1100); await sidebar(page, false); };
  await go('/seller/documents'); await modalShot(page, '41-sdoc-upload', () => main.getByRole('button', { name: 'Upload Document' }).click());
  await go('/seller/team'); await modalShot(page, '41-steam-add', () => main.getByRole('button', { name: 'Add Team Member' }).click());
  await soft('who', async () => { await main.getByRole('tab', { name: 'Who can do what' }).click(); await settle(page, 500); await shot(page, '41-steam-who', { tall: 1300, crop: 'main', margin: 0 }); });
  await go('/seller/contracts'); await modalShot(page, '41-scon-wf', () => main.locator('tbody tr').first().locator('td').first().click(), { close: false });
  for (const t of ['Milestones', 'Guarantee (PBG)', 'Requests', 'Notices']) await soft(t, async () => { const w = page.locator('.modal').last(); await w.getByRole('tab', { name: t }).or(w.getByRole('button', { name: t, exact: true })).first().click(); await settle(page, 600); const k = t.split(' ')[0].toLowerCase(); await dumpTo(page, `x-41-scon-${k}`, 'top'); await shot(page, `41-scon-${k}`, { tall: 1400, crop: w, margin: 16 }); });
  await soft('req', async () => { const w = page.locator('.modal').last(); await w.getByRole('tab', { name: 'Requests' }).or(w.getByRole('button', { name: 'Requests', exact: true })).first().click(); await settle(page, 400); await w.getByRole('button', { name: /request/i }).first().click(); await settle(page, 600); await dumpTo(page, 'x-41-scon-reqform', 'top'); await shot(page, '41-scon-reqform', { tall: 1500, crop: page.locator('.modal').last(), margin: 16 }); });
  await go('/seller/invoices'); await modalShot(page, '41-sinv-detail', () => main.locator('tbody tr', { hasText: 'SS/INV/2026/09/001' }).first().locator('td').nth(1).click());
  await modalShot(page, '41-sinv-sheet', () => main.getByRole('button', { name: 'Raise from a Sheet' }).click());
  await go('/seller/payment-security'); await modalShot(page, '41-sps-newbg', () => main.getByRole('button', { name: '+ Submit a new BG' }).click());
  for (const [t, k] of [[/SJVN LCs/, 'lc'], ['Required vs held', 'req']]) await soft(k, async () => { await main.getByRole('tab', { name: t }).click(); await settle(page, 700); await dumpTo(page, `x-41-sps-${k}`); await shot(page, `41-sps-${k}`, { tall: 1200, crop: 'main', margin: 0 }); });
  await go('/seller/reconciliation'); await modalShot(page, '41-srec-detail', () => main.locator('tbody tr').first().locator('td').first().click());
  await go('/seller/disputes'); await modalShot(page, '41-sdisp-raise', () => main.getByRole('button', { name: '+ Raise Dispute' }).click());
  await go('/seller/payments'); for (const [t, k] of [['Ledger', 'ledger'], ['TDS certificates', 'tds']]) await soft(k, async () => { await main.getByRole('tab', { name: t }).click(); await settle(page, 700); await shot(page, `41-spay-${k}`, { tall: 1700, crop: 'main', margin: 0 }); });
  await ctx.close();
}
{ // Buyer
  const { ctx, page } = await open(browser); const main = page.locator('main'); await login(page, 'Buyer');
  const go = async (r) => { await page.goto(BASE + r); await settle(page, 1100); await sidebar(page, false); };
  for (const r of ['payment-security', 'energy-data', 'payments', 'documents', 'contracts']) { await go('/buyer/' + r); await dumpTo(page, `x-51-b${r}`); }
  await go('/buyer/payment-security');
  const btns = await main.getByRole('button').allInnerTexts(); console.log('buyer PS buttons:', btns.join(' | ').slice(0, 400));
  await modalShot(page, '51-bps-new', () => main.getByRole('button', { name: /^\+/ }).first().click());
  await modalShot(page, '51-bps-inst', () => main.locator('tbody tr').first().locator('td').first().click());
  await go('/buyer/contracts'); await modalShot(page, '51-bcon-wf', () => main.locator('tbody tr').first().locator('td').first().click());
  await go('/buyer/payments'); await soft('tds', async () => { await main.getByRole('tab', { name: 'TDS certificates' }).click(); await settle(page, 700); await dumpTo(page, 'x-51-bpay-tds'); await shot(page, '51-bpay-tds', { tall: 1400, crop: 'main', margin: 0 }); await modalShot(page, '51-bpay-tds-file', () => main.getByRole('button', { name: /File a certificate/ }).click()); });
  await ctx.close();
}
await browser.close();
