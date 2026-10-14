import { chromium, open, login, settle, shot, dumpTo, soft, field, sidebar, closeTop, hscroll, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser); const main = page.locator('main'); const top = () => page.locator('.modal').last();
await login(page, 'SJVN Admin');
const B = (n) => main.getByRole('button', { name: n });
// generic: open page, shot with menu link, then hidden-sidebar shot; click each button → dump + shot
async function screen(key, route, link, buttons = [], opts = {}) {
  await sidebar(page, true).catch(() => {});
  await page.goto(BASE + route); await settle(page, 1100);
  await soft(key + '-open', async () => shot(page, `${key}-open`, { marks: [{ at: page.getByRole('link', { name: link }).last(), n: 1, pos: 'r', pad: 2 }] }));
  await sidebar(page, false);
  await dumpTo(page, `x-${key}`);
  const marks = []; let n = 1;
  for (const b of buttons) marks.push({ at: B(b).first(), n: n++, pos: 'b' });
  await shot(page, `${key}-top`, { marks, tall: opts.tall });
  for (const b of buttons) {
    if (opts.skip?.includes(b)) continue;
    const k = b.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    await soft(`${key}-${k}`, async () => {
      await B(b).first().click({ timeout: 5000 }); await settle(page, 800);
      const has = await page.locator('.modal').count();
      await dumpTo(page, `x-${key}-${k}`, has ? 'top' : 'main');
      await shot(page, `${key}-${k}`, { tall: 1500, crop: has ? top() : 'main', margin: has ? 16 : 0 });
      if (has) await closeTop(page); else { await page.goto(BASE + route); await settle(page, 900); await sidebar(page, false); }
    });
  }
}
await screen('12-dsm', '/reia/deviation', 'Deviation Settlement (DSM)', ['Raise from NRPC statement', 'Upload official NRPC DSA', 'Add manual estimate']);
await screen('13-div', '/reia/power-diversion', 'Power Diversion', ['+ Record Diversion']);
await screen('14-bank', '/reia/energy-banking', 'Energy Banking', ['+ Bank Energy', 'Settle Closed Cycles'], { skip: ['Settle Closed Cycles'] });
await screen('15-led', '/reia/seller-ledgers', 'Counterparty Ledgers & TDS', []);
await soft('ledger', async () => { await main.locator('select').last().selectOption({ label: 'Sunrise Solar Pvt Ltd' }); await settle(page, 1300); await dumpTo(page, 'x-15-led-seller'); await shot(page, '15-led-seller', { tall: 2600, crop: 'main', margin: 0 }); });
await screen('16-gen', '/reia/generation-performance', 'Generation Performance', ['Apply'], { skip: ['Apply'], tall: 1300 });
await screen('17-dash', '/reia', 'REIA Dashboard', ['Download PDF Snapshot', 'Billing Reports'], { skip: ['Download PDF Snapshot', 'Billing Reports'], tall: 2600 });
await screen('18-rep', '/reia/reports', 'REIA Dashboard', ['Refresh Preview', 'Export CSV', 'Download PDF Report'], { skip: ['Refresh Preview', 'Export CSV', 'Download PDF Report'], tall: 1500 });
await screen('19-cerc', '/reia/cerc-compliance', 'CERC Compliance', ['Prepare Form-IV', 'Annexures', 'Excel'], { skip: ['Excel'] });
await soft('cerc-lic', async () => { await main.getByRole('tab', { name: /Licence fee/ }).click(); await settle(page, 900); await dumpTo(page, 'x-19-cerc-lic'); await shot(page, '19-cerc-lic', { tall: 1700, crop: 'main', margin: 0 }); });
await screen('20-fin', '/reia/finance-posting', 'REIA Dashboard', []);
await screen('23-users', '/admin/users', 'SJVN Users', ['Add User', 'Export'], { skip: ['Export'] });
await soft('users-roles', async () => { await main.getByRole('tab', { name: /Roles and what/ }).click(); await settle(page, 800); await dumpTo(page, 'x-23-users-roles'); await shot(page, '23-users-roles', { tall: 2200, crop: 'main', margin: 0 }); });
await screen('24-nb', '/notification-board', 'Notification Board', ['Alert settings'], {});
await screen('25-qc', '/mail', 'Quick Connect', ['New Message', 'Disclaimer'], {});
await screen('26-audit', '/audit-logs', 'Audit Trail', ['Verify full chain'], { skip: [] });
await browser.close();
