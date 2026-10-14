// Shared browser helpers for the manual's screenshot runs.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(here, '../../../frontend/package.json'));
export const { chromium } = require('playwright');

export const BASE = process.env.MANUAL_BASE_URL || 'http://127.0.0.1:4100';
export const VIEWPORT = { width: 1366, height: 820 };

export async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, ...opts });
  const page = await ctx.newPage();
  // Native dialogs would hang a headless run; accept and carry on.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return { ctx, page };
}

export async function settle(page, ms = 600) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

export async function login(page, demoLabel) {
  await page.goto(`${BASE}/login`);
  await settle(page, 300);
  await page.getByRole('button', { name: demoLabel, exact: true }).click();
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await settle(page);
}

const here2 = here;
export const SHOTS = path.resolve(here2, '../shots');

/** Bounding box of a locator / selector in viewport pixels, or null. */
async function boxOf(page, target) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  try { return await loc.boundingBox({ timeout: 4000 }); } catch { return null; }
}

/**
 * Take a screenshot with numbered red call-outs.
 *   marks: [{ at: locator|selector, n: 1, pos: 'tl'|'tr'|'l'|'r'|'t'|'b', pad: 4, box: true }]
 *   crop:  locator|selector|'main'|null  — cut the picture down to that element (plus margin)
 *   tall:  number — temporarily grow the viewport height (to show a long page / modal whole)
 */
export async function shot(page, name, { marks = [], crop = null, widthOf = null, tall = null, wide = null, margin = 14, wait = 250 } = {}) {
  const vp = page.viewportSize();
  if (tall || wide) { await page.setViewportSize({ width: wide || vp.width, height: tall || vp.height }); await page.waitForTimeout(450); }
  if (marks[0]?.scroll !== false && marks[0]) {
    const l = typeof marks[0].at === 'string' ? page.locator(marks[0].at).first() : marks[0].at;
    await l.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
  }
  await page.waitForTimeout(wait);
  const boxes = [];
  for (const m of marks) {
    const b = await boxOf(page, m.at);
    if (!b) { console.warn(`  ! ${name}: mark ${m.n} not found`); continue; }
    boxes.push({ ...b, n: m.n, pos: m.pos || 'tl', pad: m.pad ?? 5, box: m.box !== false });
  }
  await page.evaluate((bs) => {
    const root = document.createElement('div');
    root.id = '__manual_marks';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    for (const b of bs) {
      const x = b.x - b.pad, y = b.y - b.pad, w = b.width + 2 * b.pad, h = b.height + 2 * b.pad;
      if (b.box) {
        const r = document.createElement('div');
        r.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:3px solid #E11D2E;border-radius:8px;box-shadow:0 0 0 3px rgba(225,29,46,.18);`;
        root.appendChild(r);
      }
      if (b.n != null) {
        const S = 28;
        const P = { tl: [x - S / 2, y - S / 2], tr: [x + w - S / 2, y - S / 2], l: [x - S - 4, y + h / 2 - S / 2], r: [x + w + 4, y + h / 2 - S / 2], t: [x + w / 2 - S / 2, y - S - 4], b: [x + w / 2 - S / 2, y + h + 4], bl: [x - S / 2, y + h - S / 2], br: [x + w - S / 2, y + h - S / 2] }[b.pos];
        const c = document.createElement('div');
        c.textContent = String(b.n);
        c.style.cssText = `position:absolute;left:${Math.max(2, P[0])}px;top:${Math.max(2, P[1])}px;width:${S}px;height:${S}px;border-radius:50%;background:#E11D2E;color:#fff;font:700 15px/28px -apple-system,Helvetica,Arial,sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;box-sizing:content-box;`;
        root.appendChild(c);
      }
    }
    document.body.appendChild(root);
  }, boxes);
  let clip;
  if (crop) {
    let cb = null;
    for (const c of [].concat(crop)) {
      const b = await boxOf(page, c);
      if (!b) continue;
      if (!cb) cb = { ...b };
      else { const x2 = Math.max(cb.x + cb.width, b.x + b.width), y2 = Math.max(cb.y + cb.height, b.y + b.height); cb.x = Math.min(cb.x, b.x); cb.y = Math.min(cb.y, b.y); cb.width = x2 - cb.x; cb.height = y2 - cb.y; }
    }
    const v = page.viewportSize();
    if (cb && widthOf) { const wb = await boxOf(page, widthOf); if (wb) { cb.x = wb.x; cb.width = wb.width; } }
    if (cb) {
      const x = Math.max(0, cb.x - margin), y = Math.max(0, cb.y - margin);
      clip = { x, y, width: Math.min(v.width - x, cb.width + 2 * margin), height: Math.min(v.height - y, cb.height + 2 * margin) };
    }
  }
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, clip, animations: 'disabled' });
  await page.evaluate(() => document.getElementById('__manual_marks')?.remove());
  if (tall || wide) { await page.setViewportSize(vp); await page.waitForTimeout(200); }
  console.log('  shot', name);
  return file;
}

/** Print what is on screen (or inside `scope`): headings, fields, buttons. For exploring. */
export async function dump(page, scope = 'main', max = 3500) {
  const info = await page.evaluate((sel) => {
    const root = (sel === 'top' ? [...document.querySelectorAll('.modal')].pop() : document.querySelector(sel)) || document.body;
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
    const fields = [...root.querySelectorAll('input, select, textarea')].filter(vis).map((el) => {
      const lab = el.closest('label')?.innerText || el.closest('.form-group, .field, div')?.querySelector('label')?.innerText || el.getAttribute('aria-label') || el.placeholder || el.name || '';
      const opts = el.tagName === 'SELECT' ? ` {${[...el.options].map((o) => o.text).slice(0, 14).join(' / ')}}` : '';
      return `[${el.tagName.toLowerCase()}${el.type ? ':' + el.type : ''}] ${lab.trim().replace(/\s+/g, ' ').slice(0, 70)}${el.placeholder ? ` (ph: ${el.placeholder})` : ''}${el.required ? ' *' : ''}${opts}`;
    });
    const buttons = [...new Set([...root.querySelectorAll('button, a.btn, [role=tab]')].filter(vis).map((b) => (b.innerText.trim() || b.title || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean))];
    return { fields, buttons, text: root.innerText.replace(/\n{2,}/g, '\n') };
  }, scope);
  console.log(`--- FIELDS\n${info.fields.join('\n')}\n--- BUTTONS\n${info.buttons.join(' | ')}\n--- TEXT\n${info.text.slice(0, max)}\n`);
}

import fsx from 'fs';
/** Like dump(), but into dumps/<name>.txt so a long screen does not flood the console. */
export async function dumpTo(page, name, scope = 'main') {
  const orig = console.log; let buf = '';
  console.log = (...a) => { buf += a.join(' ') + '\n'; };
  try { await dump(page, scope, 20000); } finally { console.log = orig; }
  fsx.writeFileSync(path.resolve(here, `../dumps/${name}.txt`), buf);
}
export const soft = async (label, fn) => { try { await fn(); } catch (e) { console.warn(`  !! ${label}: ${e.message.split('\n')[0]}`); } };
/** A small sample PDF to attach wherever the platform asks for a document. */
export async function samplePdf(browser, file, title, lines = []) {
  const out = path.resolve(here, '../samples', file);
  const pg = await browser.newPage();
  await pg.setContent(`<body style="font-family:Helvetica;padding:60px"><h2>${title}</h2><p style="color:#666">Sample document for the user manual — not a real record.</p>${lines.map((l) => `<p>${l}</p>`).join('')}</body>`);
  await pg.pdf({ path: out, format: 'A4' }); await pg.close();
  return out;
}

/** The input / select / textarea that belongs to the label starting with `label` (wrapped by it, or the next control after it). */
export const field = (scope, label) => {
  const c = '*[self::input or self::select or self::textarea]';
  return scope.locator(`xpath=(.//label[starts-with(normalize-space(.), "${label}")]//${c} | .//*[self::label or self::span or self::div or self::strong][starts-with(normalize-space(text()[1]), "${label}")][not(.//${c})]/following::${c}[1])[1]`);
};
/** The whole <Field> block (label + control) — nicer to box than the bare input. */
export const fieldBox = (scope, label) => scope.locator(`xpath=.//label[contains(@class,"field")][span[contains(@class,"field-label")][starts-with(normalize-space(.), "${label}")]]`).first();

/** Hide / show the left menu, to give a wide table the whole window. */
export async function sidebar(page, show) {
  const visible = await page.locator('aside, .sidebar').first().isVisible().catch(() => false);
  if (visible !== show) { await page.getByRole('button', { name: 'Toggle Sidebar' }).click(); await page.waitForTimeout(450); }
}

/** Close the top-most pop-up window with its ✕. */
export async function closeTop(page) {
  const n = await page.locator('.modal').count();
  if (!n) return;
  await page.locator('.modal').last().locator('.modal-header button').last().click();
  await page.waitForTimeout(350);
}

/**
 * Wide tables sit in a box that scrolls sideways. Move that box to its right end
 * (or back to the start) so the buttons in the last column come into view.
 * Returns a locator for the scrolling box, to crop the picture to.
 */
export async function hscroll(table, where = 'end') {
  await table.evaluate((el, w) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.scrollWidth > n.clientWidth + 4 && getComputedStyle(n).overflowX !== 'visible') { n.scrollLeft = w === 'end' ? n.scrollWidth : 0; n.setAttribute('data-manual-scroll', '1'); return; }
      n = n.parentElement;
    }
    el.parentElement.setAttribute('data-manual-scroll', '1');
  }, where);
  await table.page().waitForTimeout(250);
  return table.locator('xpath=ancestor-or-self::*[@data-manual-scroll="1"][1]');
}
