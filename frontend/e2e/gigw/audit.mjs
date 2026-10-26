#!/usr/bin/env node
/**
 * GIGW 3.0 / WCAG 2.1 AA audit — what the STQC / UX4G checkers look at, run here
 * before a release instead of discovered after one.
 *
 *   node e2e/gigw/audit.mjs [baseUrl]        (default http://localhost:4000)
 *   GIGW_EMAIL=… GIGW_PASSWORD=… to audit the signed-in shell as someone else
 *
 * For each page: axe-core (wcag2a, wcag2aa, wcag21a, wcag21aa), then the GIGW
 * structural checks — national identity strip, skip link first in tab order,
 * main landmark, lang attribute, zoom not disabled, footer policy links — and,
 * once, the security headers and that every statutory page answers 200. Then
 * the DBIM v3 (MeitY, Jan 2025) checklist F.1 items a browser can see: one
 * primary colour group with the footer on its key colour, Noto Sans, header 3
 * (search bar, menu, अ | A language control), footer elements and lineage,
 * centred table headings, line height, image and logo sizes, and a cookie
 * banner at the bottom offering accept, reject and customise.
 * Writes e2e/gigw/report.md and exits non-zero when the score is under 95.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || process.env.GIGW_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const EMAIL = process.env.GIGW_EMAIL || 'admin@sjvn.in';
const PASSWORD = process.env.GIGW_PASSWORD || 'password123';

const PUBLIC_PAGES = [
  '/', '/login', '/privacy-policy', '/terms-of-use', '/disclaimer', '/hyperlinking-policy',
  '/copyright-policy', '/cookie-policy', '/security-policy', '/accessibility-statement',
  '/screen-reader-access', '/grievance-redressal', '/contact-us', '/help', '/sitemap',
  '/about-us', '/related-links', '/feedback', '/circulars',
];
const SIGNED_IN_PAGES = ['/', '/reia', '/reia/invoices', '/trading', '/hydro-thermal', '/thermal', '/settings/user-profile'];
const FOOTER_LINKS = ['Privacy Policy', 'Terms of Use', 'Disclaimer', 'Hyperlinking Policy', 'Copyright Policy', 'Accessibility Statement', 'Contact Us / Web Information Manager', 'Sitemap', 'Help', 'Feedback', 'Related Links'];
// DBIM v3 Figure 1: the darkest (key) shade of each primary colour group.
const DBIM_KEY_COLOURS = { Burgundy: 'rgb(108, 19, 64)', Purple: 'rgb(41, 19, 108)', Blue: 'rgb(22, 47, 106)', Green: 'rgb(15, 87, 87)', 'Chrome Yellow': 'rgb(93, 62, 0)', 'Cinnamon Red': 'rgb(119, 29, 29)' };
const HEADERS = {
  'content-security-policy': /default-src/,
  'strict-transport-security': /max-age=\d+/,
  'x-content-type-options': /^nosniff$/,
  'x-frame-options': /^(SAMEORIGIN|DENY)$/i,
  'referrer-policy': /strict-origin-when-cross-origin|no-referrer|same-origin/,
};

const checks = []; // { area, page, name, pass, detail }
const add = (area, page, name, pass, detail = '') => checks.push({ area, page, name, pass: !!pass, detail });
const axeFindings = []; // { page, id, impact, help, nodes }

async function structural(page, url) {
  const r = await page.evaluate(() => {
    const strip = document.querySelector('.gigw-strip');
    const viewport = document.querySelector('meta[name="viewport"]')?.content || '';
    const focusables = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')];
    const first = focusables[0];
    const footer = document.querySelector('footer, [role="contentinfo"]');
    const footerText = footer ? [...footer.querySelectorAll('a')].map((a) => a.textContent.trim()) : [];
    return {
      lang: document.documentElement.lang,
      title: document.title,
      stripText: strip?.textContent || '',
      stripTop: strip ? strip.getBoundingClientRect().top : null,
      sizeButtons: strip ? [...strip.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^A[-+]?$/.test(t)) : [],
      contrast: !!strip?.querySelector('[aria-pressed][class*="contrast"]'),
      langToggle: !!strip && /हिंदी|English/.test(strip.textContent),
      firstFocusable: first ? `${first.tagName.toLowerCase()}[href=${first.getAttribute('href') || ''}] ${first.textContent.trim().slice(0, 40)}` : '',
      skipFirst: !!first && first.getAttribute('href') === '#main-content',
      main: !!document.querySelector('main#main-content, #main-content[role="main"], main'),
      zoomBlocked: /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(viewport),
      footerText,
      indiaLink: !!document.querySelector('a[href*="india.gov.in"]'),
    };
  });
  add('Identity', url, 'National identity strip (Government of India, Ministry of Power)', /Government of India/.test(r.stripText) && /Ministry of Power/.test(r.stripText) && r.stripTop !== null && r.stripTop < 120, `top=${r.stripTop}`);
  add('Identity', url, 'Link to india.gov.in', r.indiaLink);
  add('Accessibility', url, 'Skip to main content is the first focusable element', r.skipFirst, r.firstFocusable);
  add('Accessibility', url, 'Text resizer A- / A / A+ on screen', r.sizeButtons.length === 3, r.sizeButtons.join(' '));
  add('Accessibility', url, 'High contrast toggle on screen', r.contrast);
  add('Bilingual', url, 'Hindi / English switch on screen', r.langToggle);
  add('Accessibility', url, 'Main landmark', r.main);
  add('Accessibility', url, '<html lang> set', /^(en|hi)/.test(r.lang), r.lang);
  add('Accessibility', url, 'Page has a title', r.title.length > 3, r.title);
  add('Accessibility', url, 'Zoom not disabled in viewport meta', !r.zoomBlocked);
  const missing = FOOTER_LINKS.filter((l) => !r.footerText.includes(l));
  add('Policies', url, 'Footer carries the statutory policy links', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
}

// DBIM v3 checklist F.1, the parts visible in the rendered page.
async function dbim(page, url, isPublic) {
  const r = await page.evaluate(() => {
    const footer = document.querySelector('footer.gigw-footer');
    const header = document.querySelector('header[role="banner"], .gigw-public-header');
    const p = document.querySelector('main p');
    const pcs = p ? getComputedStyle(p) : null;
    const ths = [...document.querySelectorAll('main table thead th')].slice(0, 20);
    const imgs = performance.getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'img' || /\.(png|jpe?g|webp|avif|svg)(\?|$)/i.test(e.name))
      .map((e) => ({ name: e.name.split('/').pop().split('?')[0], kb: Math.round((e.decodedBodySize || e.encodedBodySize || 0) / 1024) }));
    return {
      footerBg: footer ? getComputedStyle(footer).backgroundColor : null,
      footerText: footer?.textContent || '',
      font: getComputedStyle(document.body).fontFamily,
      search: !!header?.querySelector('input[type="search"]'),
      menu: header ? [...header.querySelectorAll('nav a')].length : 0,
      langMark: !!document.querySelector('.gigw-strip') && /अ\s*\|\s*A/.test(document.querySelector('.gigw-strip').textContent),
      lineHeight: pcs ? parseFloat(pcs.lineHeight) / parseFloat(pcs.fontSize) : null,
      thLeft: ths.filter((th) => getComputedStyle(th).textAlign !== 'center').length,
      thCount: ths.length,
      imgs,
    };
  });
  const group = Object.entries(DBIM_KEY_COLOURS).find(([, v]) => v === r.footerBg)?.[0];
  add('DBIM', url, 'Footer on the key colour of a DBIM primary group (s.5.6)', !!group, `${r.footerBg}${group ? ` = ${group}` : ''}`);
  add('DBIM', url, 'Typeface is Noto Sans (s.4.1)', /^"?Noto Sans/.test(r.font), r.font.slice(0, 40));
  add('DBIM', url, 'Table headings centred (s.4.1.1)', r.thLeft === 0, `${r.thLeft} of ${r.thCount} not centred`);
  if (r.lineHeight) add('DBIM', url, 'Body line height 1.2–1.5× (s.4.5)', r.lineHeight >= 1.19 && r.lineHeight <= 1.51, r.lineHeight.toFixed(2));
  const big = r.imgs.filter((i) => i.kb > (/logo/i.test(i.name) ? 100 : 500));
  add('DBIM', url, 'Logos ≤ 100 KB, banners and backgrounds ≤ 500 KB (s.5.5, s.6.1.1)', big.length === 0, big.map((i) => `${i.name} ${i.kb} KB`).join(', '));
  if (!isPublic) return;
  add('DBIM', url, 'Header 3: search bar in the header (s.5.4.3, s.9)', r.search);
  add('DBIM', url, 'Header 3: global navigation menu (s.5.4.3)', r.menu >= 4, `${r.menu} links`);
  add('DBIM', url, 'Language control marked अ | A (s.7.5.1)', r.langMark);
  add('DBIM', url, 'Footer: Last Updated On (s.5.6)', /Last Updated On/.test(r.footerText));
  add('DBIM', url, 'Footer: PSU lineage sentence (s.5.6)', /official Website of SJVN Limited.*Public Sector Undertaking of the Government of India under the Ministry of Power/.test(r.footerText));
}

async function cookieBanner(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => {
    const c = document.querySelector('.gigw-cookie');
    if (!c) return null;
    const box = c.getBoundingClientRect();
    return {
      bottom: window.innerHeight - box.bottom < 40,
      bg: getComputedStyle(c).backgroundColor,
      buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim()),
      preTicked: [...c.querySelectorAll('input[type="checkbox"]:not(:disabled)')].some((i) => i.checked),
    };
  });
  add('DBIM', '/', 'Cookie banner shown on a first visit (s.7.6.1)', !!r);
  if (r) {
    add('DBIM', '/', 'Cookie banner at the bottom, on Inclusive White', r.bottom && r.bg === 'rgb(255, 255, 255)', `${r.bg}`);
    add('DBIM', '/', 'Cookie banner offers accept, reject and customise', ['Accept all', 'Reject optional', 'Customise'].every((b) => r.buttons.includes(b)), r.buttons.join(' / '));
    await page.click('.gigw-cookie button:has-text("Customise")');
    const pre = await page.evaluate(() => [...document.querySelectorAll('.gigw-cookie input[type="checkbox"]:not(:disabled)')].map((i) => i.checked));
    add('DBIM', '/', 'No optional category pre-ticked (s.7.6.4)', pre.length > 0 && pre.every((v) => !v), JSON.stringify(pre));
  }
  await ctx.close();
}

async function runAxe(page, url) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // 3-D illustrations draw on canvas with decorative overlays; their figures are in tables beside them.
    .exclude('canvas')
    .analyze();
  for (const v of res.violations) axeFindings.push({ page: url, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') });
  add('WCAG 2.1 AA', url, 'axe-core: no serious or critical violations', !res.violations.some((v) => ['serious', 'critical'].includes(v.impact)),
    res.violations.map((v) => `${v.id}(${v.impact},${v.nodes.length})`).join(' '));
}

async function auditPage(page, url, isPublic = true) {
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  // Charts animate in for about 1.5 s; scanning mid-animation counts nodes that
  // are about to be replaced.
  await page.waitForTimeout(2000);
  await structural(page, url);
  await dbim(page, url, isPublic && url !== '/login');
  await runAxe(page, url);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  // Accept the cookie notice first, so it is not counted on every page.
  await context.addInitScript(() => {
    try { localStorage.setItem('sjvn_cookie_consent_v1', JSON.stringify({ choice: 'essential', version: 'v1', ts: new Date().toISOString() })); } catch { /* ignore */ }
  });
  const page = await context.newPage();

  // Security headers and statutory pages, over HTTP.
  const home = await page.request.get(`${BASE}/`);
  for (const [h, re] of Object.entries(HEADERS)) add('Security', '/', `Header ${h}`, re.test(home.headers()[h] || ''), home.headers()[h] || 'absent');
  add('Security', '/', 'X-Powered-By hidden', !home.headers()['x-powered-by']);
  for (const p of PUBLIC_PAGES) {
    const r = await page.request.get(BASE + p);
    add('Policies', p, 'Answers 200', r.status() === 200, String(r.status()));
  }
  const info = await page.request.get(`${BASE}/api/public/site-info`).then((r) => r.json()).catch(() => null);
  const wim = info?.contacts?.wim || {};
  add('Policies', '/contact-us', 'Web Information Manager named (name, designation, e-mail)', !!(wim.name && wim.designation && wim.email), JSON.stringify(wim));
  for (const role of ['grievance', 'dpo']) {
    const c = info?.contacts?.[role] || {};
    add('Policies', '/grievance-redressal', `${role === 'dpo' ? 'Data Protection Officer' : 'Grievance Officer'} named`, !!(c.name && c.email), JSON.stringify(c));
  }

  await cookieBanner(browser);
  for (const p of PUBLIC_PAGES) await auditPage(page, p);

  // Signed-in shell.
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (login.ok()) {
    const { token, user } = await login.json();
    await context.addInitScript(([t, u]) => { localStorage.setItem('sjvn_token', t); localStorage.setItem('sjvn_user', u); }, [token, JSON.stringify(user)]);
    for (const p of SIGNED_IN_PAGES) await auditPage(page, p, false);
    await page.request.post(`${BASE}/api/auth/logout`, { headers: { Authorization: `Bearer ${token}` }, data: {} });
  } else {
    add('Session', '/login', `Sign in as ${EMAIL} for the signed-in pages`, false, `HTTP ${login.status()}`);
  }
  await browser.close();

  const passed = checks.filter((c) => c.pass).length;
  const score = Math.round((passed / checks.length) * 1000) / 10;
  const failed = checks.filter((c) => !c.pass);
  const byRule = new Map();
  for (const f of axeFindings) {
    const k = `${f.id}`;
    const e = byRule.get(k) || { ...f, pages: [] };
    e.pages.push(`${f.page} (${f.nodes})`);
    byRule.set(k, e);
  }
  const md = [
    `# GIGW 3.0 / DBIM v3 / WCAG 2.1 AA audit`,
    ``,
    `Run ${new Date().toISOString()} against ${BASE}.`,
    ``,
    `**Score: ${score}%** — ${passed} of ${checks.length} checks pass.`,
    ``,
    `## Failing checks`,
    failed.length ? '| Area | Page | Check | Detail |\n|---|---|---|---|\n' + failed.map((c) => `| ${c.area} | ${c.page} | ${c.name} | ${String(c.detail).replace(/\|/g, '\\|').slice(0, 160)} |`).join('\n') : '_None._',
    ``,
    `## axe-core findings by rule`,
    byRule.size ? '| Rule | Impact | What | Pages (nodes) | First node |\n|---|---|---|---|---|\n' + [...byRule.values()].map((r) => `| ${r.id} | ${r.impact} | ${r.help} | ${r.pages.join(', ')} | \`${String(r.sample || '').slice(0, 80)}\` |`).join('\n') : '_None._',
    ``,
  ].join('\n');
  fs.writeFileSync(path.join(here, 'report.md'), md);
  console.log(md);
  process.exit(score >= 95 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
