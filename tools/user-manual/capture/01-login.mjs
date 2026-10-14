import { chromium, open, settle, shot, dump, BASE } from '../lib/browser.mjs';
const browser = await chromium.launch();
const { page } = await open(browser);
const soft = async (label, fn) => { try { await fn(); } catch (e) { console.warn(`  !! ${label}: ${e.message.split('\n')[0]}`); } };

await page.goto(`${BASE}/login`); await settle(page);
await shot(page, '01-login-page');
const email = page.locator('input[type=email], input[placeholder*="sjvn"]').first();
const pass = page.locator('input[type=password]').first();
await shot(page, '01-login-marked', { tall: 980, marks: [
  { at: email, n: 1, pos: 'l' }, { at: pass, n: 2, pos: 'l' },
  { at: page.getByRole('button', { name: /sign in/i }), n: 3, pos: 'l' },
  { at: page.getByText('Forgot Password?'), n: 4, pos: 'r' },
  { at: page.getByRole('button', { name: 'SJVN Admin', exact: true }).locator('xpath=ancestor::div[1]'), n: 5, pos: 'tl' },
] });
// wrong password
await email.fill('reia@sjvn.in'); await pass.fill('wrong-password');
await page.getByRole('button', { name: /sign in/i }).click(); await settle(page, 800);
await shot(page, '01-login-error', { crop: [page.getByText('Invalid credentials'), page.getByRole('button', { name: /sign in/i })], margin: 34, marks: [{ at: page.getByText('Invalid credentials'), n: 1, pos: 'l', pad: 10 }] });
await pass.fill('password123');
await shot(page, '01-login-filled', { crop: 'form', margin: 30, marks: [{ at: email, n: 1, pos: 'l' }, { at: pass, n: 2, pos: 'l' }, { at: page.locator('input[type=password] ~ button, input[type=password] + button').first(), n: 3, pos: 'r', box: true }, { at: page.getByRole('button', { name: /sign in/i }), n: 4, pos: 'l' }] });
await soft('forgot', async () => { await page.getByText('Forgot Password?').click(); await settle(page, 400); await shot(page, '01-forgot', { crop: page.getByRole('button', { name: 'Send Reset Link' }).locator('xpath=ancestor::div[2]'), margin: 30 }); await page.keyboard.press('Escape'); });
await page.goto(`${BASE}/login`); await settle(page);
await page.getByRole('button', { name: 'REIA Ops', exact: true }).click();
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith('/login')); await settle(page, 1200);
console.log('landed', page.url());
await shot(page, '01-home-reia');
await shot(page, '01-layout', { marks: [
  { at: 'aside, .sidebar', n: 1, pos: 'r', pad: -3 },
  { at: page.getByRole('button', { name: 'Toggle Sidebar' }), n: 2, pos: 'r' },
  { at: page.locator('button[title^="Quick Connect"], button[aria-label^="Quick Connect"]').first(), n: 3, pos: 'b' },
  { at: page.getByRole('button', { name: 'Notifications' }), n: 4, pos: 'b' },
  { at: page.getByText('Welcome,').locator('xpath=ancestor::*[self::button or self::div][1]'), n: 5, pos: 'b' },
  { at: page.locator('main h1, main h2').first(), n: 6, pos: 'r', pad: 6 },
] });
await soft('bell', async () => { await page.getByRole('button', { name: 'Notifications' }).click(); await settle(page, 500); await shot(page, '01-bell-open', { crop: [page.getByRole('button', { name: 'Notifications' }), page.locator('.notif-dropdown')], margin: 30, marks: [{ at: page.getByRole('button', { name: 'Notifications' }), n: 1, pos: 'l' }, { at: page.getByText('Mark all read'), n: 2, pos: 'l' }] }); await page.keyboard.press('Escape'); await page.mouse.click(700, 500); });
await browser.close();
