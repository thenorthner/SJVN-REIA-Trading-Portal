import { chromium, open, login, settle, shot, dumpTo, soft, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser);
await login(page, 'REIA Ops');
const chip = page.locator('.user-chip');
await chip.click(); await settle(page, 300);
const dd = page.locator('.notif-dropdown');
await shot(page, '01-user-menu', { crop: [chip, dd], margin: 40, marks: [{ at: chip, n: 1, pos: 'l' }, { at: dd.getByText('My Account'), n: 2, pos: 'l', pad: 0 }, { at: dd.getByText('Change Password'), n: 3, pos: 'l', pad: 0 }, { at: dd.getByText('Log out'), n: 4, pos: 'l', pad: 0 }] });
await dd.getByText('Change Password').click(); await settle(page, 400);
const m = page.locator('.modal');
await shot(page, '01-change-password', { crop: m, margin: 30, marks: [{ at: m.locator('input').nth(0), n: 1, pos: 'l' }, { at: m.locator('input').nth(1), n: 2, pos: 'l' }, { at: m.locator('input').nth(2), n: 3, pos: 'l' }, { at: m.getByRole('button', { name: /change|update|save/i }).last(), n: 4, pos: 'b' }] });
await dumpTo(page, '01-changepw', '.modal');
await m.getByRole('button', { name: 'Cancel' }).click();
await chip.click(); await dd.getByText('My Account').click(); await settle(page, 800);
await shot(page, '01-my-account'); await dumpTo(page, '01-my-account');
// sidebar: sections collapsed / opened
await page.goto(BASE + '/reia'); await settle(page, 800);
const side = page.locator('aside, .sidebar').first();
await shot(page, '01-sidebar-open', { crop: side, margin: 0, tall: 1000, marks: [{ at: side.getByText('REIA Billing & Settlement'), n: 1, pos: 'r' }, { at: side.getByRole('link', { name: 'REIA Dashboard' }).last(), n: 2, pos: 'r', pad: 2 }] });
await page.getByRole('button', { name: 'Toggle Sidebar' }).click(); await settle(page, 500);
await shot(page, '01-sidebar-hidden', { marks: [{ at: page.getByRole('button', { name: 'Toggle Sidebar' }), n: 1, pos: 'r' }] });
await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
// logout
await chip.click(); await dd.getByText('Log out').click(); await settle(page, 600);
console.log('after logout', page.url());
await browser.close();
