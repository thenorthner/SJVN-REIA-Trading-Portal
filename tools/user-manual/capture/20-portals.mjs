import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
async function portal(role, prefix, base, pages) {
  const { ctx, page } = await open(browser); const main = page.locator('main');
  await login(page, role);
  await shot(page, `${prefix}-home`, {});
  await shot(page, `${prefix}-menu`, { crop: 'aside, .sidebar', margin: 0, tall: 900 });
  for (const [slug, link] of pages) {
    await sidebar(page, true).catch(() => {});
    await page.goto(`${BASE}${base}${slug ? '/' + slug : ''}`); await settle(page, 1200);
    const k = `${prefix}-${slug || 'dash'}`;
    await soft(k, async () => shot(page, `${k}-open`, { marks: [{ at: page.getByRole('link', { name: link }).last(), n: 1, pos: 'r', pad: 2 }] }));
    await sidebar(page, false);
    await dumpTo(page, `x-${k}`);
    await shot(page, `${k}-top`, {});
    await shot(page, `${k}-full`, { tall: 2400, crop: 'main', margin: 0 });
    await soft(k + '-how', async () => { if (slug === '') { await main.getByRole('button', { name: 'How it works' }).first().click({ timeout: 3000 }); await settle(page, 700); await dumpTo(page, `x-${k}-how`); await shot(page, `${k}-how`, { tall: 1800, crop: 'main', margin: 0 }); } });
  }
  await ctx.close();
}
await portal('Seller', '40', '/seller', [['', 'My Dashboard'], ['team', 'My Team'], ['documents', 'My Documents & KYC'], ['contracts', 'My Contracts (PPAs)'], ['energy-data', 'Energy Data'], ['invoices', 'My Invoices'], ['payments', 'Payments & Ledger'], ['disputes', 'My Disputes'], ['payment-security', 'Payment Security'], ['reconciliation', 'Reconciliation']]);
await portal('Buyer', '50', '/buyer', [['', 'My Dashboard'], ['team', 'My Team'], ['documents', 'My Documents & KYC'], ['contracts', 'My PSAs'], ['energy-data', 'Energy Allocation'], ['invoices', 'Payable Invoices'], ['payments', 'Payment Ledger'], ['disputes', 'My Disputes'], ['payment-security', 'Payment Security'], ['reconciliation', 'Reconciliation']]);
await browser.close();
