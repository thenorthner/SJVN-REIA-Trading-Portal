import { chromium, open, login, settle, shot, dumpTo, soft, samplePdf, field, sidebar, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const pdf = await samplePdf(browser, 'Generation-Licence.pdf', 'CEA Registration Certificate', ['Sunrise Solar Pvt Ltd — 150 MW Solar', 'Registration No. CEA/RE/2019/04471']);
const { page } = await open(browser);
const top = () => page.locator('.modal').last();
const main = page.locator('main');
await login(page, 'SJVN Admin');
await page.goto(BASE + '/reia/company-users'); await settle(page, 900);
await shot(page, '03-cu-landing', { marks: [
  { at: page.getByRole('link', { name: 'Company Users' }), n: 1, pos: 'r', pad: 2 },
  { at: main.locator('input').first(), n: 2, pos: 'b' },
  { at: main.getByRole('button', { name: /^Sellers/ }), n: 3, pos: 'b' },
  { at: main.getByText('Himalaya Wind Energy Pvt Ltd').first().locator('xpath=ancestor::*[self::button or self::div][2]'), n: 4, pos: 'tr' },
] });
await main.getByText('Himalaya Wind Energy Pvt Ltd').first().click(); await settle(page, 800);
await shot(page, '03-cu-company', { marks: [
  { at: main.getByRole('button', { name: 'Switch Company' }), n: 1, pos: 'b' },
  { at: main.getByRole('button', { name: 'Add Team Member' }), n: 2, pos: 'l' },
  { at: main.getByRole('tablist').first(), n: 3, pos: 'tl' },
] });
await main.getByRole('button', { name: 'Add Team Member' }).click(); await settle(page, 500);
let m = top();
await field(m, 'Full Name').fill('Ritu Verma');
await field(m, 'Email Address').fill('ritu.verma@himalayawind.in');
await field(m, 'Designation').fill('Manager (Accounts)');
await field(m, 'Phone').fill('+91 98160 54321');
await field(m, 'Access Level').selectOption({ label: 'Level 3 — Approver' });
await shot(page, '03-cu-add', { crop: m, margin: 24, marks: [
  { at: field(m, 'Full Name'), n: 1, pos: 'l' }, { at: field(m, 'Email Address'), n: 2, pos: 'l' }, { at: field(m, 'Designation'), n: 3, pos: 'l' },
  { at: field(m, 'Phone'), n: 4, pos: 'l' }, { at: field(m, 'Access Level'), n: 5, pos: 'l' }, { at: m.locator('input[type=checkbox]'), n: 6, pos: 'l' },
  { at: m.getByRole('button', { name: 'Add to team' }), n: 7, pos: 'b' } ] });
await m.getByRole('button', { name: 'Add to team' }).click(); await settle(page, 1000);
await dumpTo(page, '03-cu-added', 'body');
await shot(page, '03-cu-temp-password', { crop: (await page.locator('.modal').count()) ? top() : main, margin: 24 });
await soft('close', async () => { await top().getByRole('button', { name: /Done|Close|OK|✕/ }).last().click({ timeout: 3000 }); });
await settle(page, 500);
await sidebar(page, false);
await shot(page, '03-cu-member-card', { crop: [main.getByRole('tablist').first(), main.getByRole('button', { name: 'Switch off' }).first()], widthOf: 'main', margin: 30, marks: [
  { at: main.getByRole('button', { name: /Edit/ }).first(), n: 1, pos: 't' }, { at: main.getByRole('button', { name: 'Reset password' }).first(), n: 2, pos: 't' },
  { at: main.getByRole('button', { name: 'Activity' }).first(), n: 3, pos: 't' }, { at: main.getByRole('button', { name: 'Switch off' }).first(), n: 4, pos: 'b' } ] });
await sidebar(page, true);
await soft('reset', async () => { await main.getByRole('button', { name: 'Reset password' }).first().click(); await settle(page, 400); await shot(page, '03-cu-reset', { crop: top(), margin: 24, marks: [{ at: top().getByRole('button', { name: 'Reset password' }), n: 1, pos: 'b' }] }); await top().getByRole('button', { name: 'Cancel' }).click(); });
await soft('switchoff', async () => { await main.getByRole('button', { name: 'Switch off' }).first().click(); await settle(page, 400); await dumpTo(page, '03-cu-switchoff', 'top'); await shot(page, '03-cu-switchoff', { crop: top(), margin: 24 }); await top().getByRole('button', { name: 'Cancel' }).click(); });
await soft('edit', async () => { await main.getByRole('button', { name: /Edit/ }).first().click(); await settle(page, 400); await dumpTo(page, '03-cu-edit', 'top'); await shot(page, '03-cu-edit', { crop: top(), margin: 24 }); await top().getByRole('button', { name: 'Cancel' }).click(); });
await soft('who', async () => { await main.getByRole('tab', { name: 'Who can do what' }).click(); await settle(page, 400); await shot(page, '03-cu-who', { tall: 1200, crop: [main.getByRole('tablist').first(), main.locator('table').last()], widthOf: 'main', margin: 16 }); });
await soft('hist', async () => { await main.getByRole('tab', { name: 'Change history' }).click(); await settle(page, 400); await shot(page, '03-cu-history', { crop: [main.getByRole('tablist').first(), main.locator('table, .card').last()], widthOf: 'main', margin: 16 }); });

// ── Seller uploads a KYC document, so the desk has something to review ──
const s = await open(browser); const sp = s.page;
await login(sp, 'Seller');
await sp.goto(BASE + '/seller/documents'); await settle(sp, 900);
await sp.getByRole('button', { name: 'Upload Document' }).click(); await settle(sp, 500);
await dumpTo(sp, '20-sdoc-upload', 'top');
const sm = sp.locator('.modal').last();
await sm.locator('input[type=file]').setInputFiles(pdf);
await soft('type', async () => { await field(sm, 'Document Type').selectOption({ label: 'Generation License' }); });
await field(sm, 'Title').fill('CEA Registration Certificate - 150 MW Solar');
await soft('valid', async () => { await field(sm, 'Valid until').fill('2030-12-31'); });
await sp.screenshot({ path: 'survey/x-sdoc.png' });
await sm.getByRole('button', { name: 'Upload', exact: true }).click(); await settle(sp, 1200);
await dumpTo(sp, '20-sdoc-after');
await s.ctx.close();

// ── Documents & KYC Desk ──
await page.goto(BASE + '/reia/document-desk'); await settle(page, 900);
await dumpTo(page, '03-desk');
await page.screenshot({ path: 'survey/x-desk.png', fullPage: true });
await soft('kyc', async () => { await main.getByRole('tab', { name: 'KYC status' }).click(); await settle(page, 500); await dumpTo(page, '03-desk-kyc'); await page.screenshot({ path: 'survey/x-desk-kyc.png', fullPage: true }); });
await browser.close();
