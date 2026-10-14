import fs from 'fs';
import { chromium, open, login, settle, BASE } from './lib/browser.mjs';

const ROUTES = {
  'SJVN Admin': ['/reia','/reia/entities','/reia/company-users','/reia/document-desk','/reia/contracts','/reia/contract-compliance','/reia/cerc-compliance','/reia/energy-data','/reia/invoices','/reia/verification','/reia/payment-monitoring','/reia/generation-performance','/reia/disputes','/reia/seller-ledgers','/reia/payment-security','/reia/power-diversion','/reia/energy-banking','/reia/reconciliation','/reia/deviation','/reia/reports','/reia/finance-posting','/admin/users','/notification-board','/mail','/audit-logs'],
  'Seller': ['/seller','/seller/team','/seller/documents','/seller/contracts','/seller/energy-data','/seller/invoices','/seller/payments','/seller/disputes','/seller/payment-security','/seller/reconciliation','/notification-board','/mail'],
  'Buyer': ['/buyer','/buyer/team','/buyer/documents','/buyer/contracts','/buyer/energy-data','/buyer/invoices','/buyer/payments','/buyer/disputes','/buyer/payment-security','/buyer/reconciliation'],
};
const only = process.argv[2];
const browser = await chromium.launch();
for (const [role, routes] of Object.entries(ROUTES)) {
  if (only && only !== role) continue;
  const { ctx, page } = await open(browser, { deviceScaleFactor: 1 });
  await login(page, role);
  for (const r of routes) {
    const slug = `${role.replace(/\W+/g, '')}${r.replace(/\//g, '_')}`;
    await page.goto(BASE + r); await settle(page, 1200);
    await page.screenshot({ path: `survey/${slug}.png`, fullPage: false });
    const info = await page.evaluate(() => {
      const vis = (el) => el.offsetParent !== null;
      const t = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((e) => e.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean);
      const main = document.querySelector('main') || document.body;
      return {
        headings: t('main h1, main h2, main h3'),
        buttons: [...new Set(t('main button, main a.btn'))].slice(0, 80),
        th: [...new Set(t('main th'))],
        labels: [...new Set(t('main label'))],
        text: main.innerText.replace(/\n{2,}/g, '\n').slice(0, 6000),
      };
    });
    fs.writeFileSync(`survey/${slug}.txt`, `URL ${r}\nHEADINGS: ${info.headings.join(' | ')}\nBUTTONS: ${info.buttons.join(' | ')}\nTH: ${info.th.join(' | ')}\nLABELS: ${info.labels.join(' | ')}\n\n${info.text}\n`);
    console.log(role, r, info.headings[0] || '(no heading)');
  }
  await ctx.close();
}
await browser.close();
