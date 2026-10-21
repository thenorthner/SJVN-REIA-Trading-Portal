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
 * once, the security headers and that every statutory page answers 200.
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
];
const SIGNED_IN_PAGES = ['/', '/reia', '/reia/invoices', '/trading', '/hydro-thermal', '/thermal', '/settings/user-profile'];
const FOOTER_LINKS = ['Privacy Policy', 'Terms of Use', 'Disclaimer', 'Hyperlinking Policy', 'Copyright Policy', 'Accessibility Statement', 'Contact Us / Web Information Manager', 'Sitemap'];
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

async function auditPage(page, url) {
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  // Charts animate in for about 1.5 s; scanning mid-animation counts nodes that
  // are about to be replaced.
  await page.waitForTimeout(2000);
  await structural(page, url);
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

  for (const p of PUBLIC_PAGES) await auditPage(page, p);

  // Signed-in shell.
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD } });
  if (login.ok()) {
    const { token, user } = await login.json();
    await context.addInitScript(([t, u]) => { localStorage.setItem('sjvn_token', t); localStorage.setItem('sjvn_user', u); }, [token, JSON.stringify(user)]);
    for (const p of SIGNED_IN_PAGES) await auditPage(page, p);
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
    `# GIGW 3.0 / WCAG 2.1 AA audit`,
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
