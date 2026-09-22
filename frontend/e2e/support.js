import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');

/** Ids the setup project created — the dispute, the reconciliation, the session token. */
export function runtime() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'runtime.json'), 'utf8'));
}

/**
 * Collects what a user would see as "the screen broke": an uncaught exception
 * in the page, and any API call the server answered with a 5xx. Call
 * `problems.length = 0` between screens to start a fresh list.
 */
export function watchForBreakage(page) {
  const problems = [];
  page.on('pageerror', (err) => problems.push(`uncaught error: ${err.message}`));
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (url.pathname.startsWith('/api/') && res.status() >= 500) {
      problems.push(`${res.status()} from ${res.request().method()} ${url.pathname}`);
    }
  });
  return problems;
}

/**
 * Elements under `root` whose content is wider than the element itself and
 * spills out of it or is cut off — the "dates outside the box" and "notes read
 * No en" kind of fault. An element that scrolls sideways on purpose
 * (overflow-x auto/scroll) is left alone; its own width is what the layout gave
 * it, and a scrollbar is a choice rather than a defect.
 */
export async function horizontalOverflow(root) {
  return root.evaluate((rootEl) => {
    const skip = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'svg', 'SVG', 'IMG', 'CANVAS', 'IFRAME']);
    const found = [];
    const walk = (el) => {
      if (skip.has(el.tagName)) return;
      const style = getComputedStyle(el);
      const scrolls = style.overflowX === 'auto' || style.overflowX === 'scroll';
      // An ellipsis is truncation by design (the full text sits in a tooltip),
      // not text lost to a box that was too small.
      if (style.textOverflow === 'ellipsis') return;
      // clientWidth of 1 is the visually-hidden pattern (.sr-only): text kept
      // for screen readers inside a 1px clip, hidden on purpose.
      if (!scrolls && el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1) {
        const label = (el.getAttribute('class') || el.tagName.toLowerCase()).split(' ')[0];
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        found.push(`<${el.tagName.toLowerCase()} ${label}> ${el.scrollWidth}px of content in ${el.clientWidth}px: "${text}"`);
        return; // its children are the same overflow, reported once
      }
      for (const child of el.children) walk(child);
    };
    walk(rootEl);
    return found;
  });
}

/** True when the element scrolls sideways — content wider than the box that holds it. */
export async function scrollsSideways(locator) {
  return locator.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
}

/**
 * Pages of a PDFKit document with the number of text-drawing operators on each.
 *
 * A report page carries a header band, a title and its data — dozens of text
 * operations. The blank page this suite guards against carried one: the page
 * number that pushed it into existence. Reading the counts off the content
 * streams says which pages have nothing on them without a PDF library.
 */
export function pdfPages(buffer) {
  const src = buffer.toString('latin1');
  if (!src.startsWith('%PDF-')) throw new Error('not a PDF');
  const contentsOf = [...src.matchAll(/\/Type \/Page\b(?!s)[\s\S]*?\/Contents (\d+) 0 R/g)].map((m) => Number(m[1]));
  return contentsOf.map((objNo) => {
    const start = src.search(new RegExp(`(^|\\n)${objNo} 0 obj`));
    const streamAt = src.indexOf('stream', start) + 'stream'.length;
    const dataStart = src[streamAt] === '\r' ? streamAt + 2 : streamAt + 1;
    const dataEnd = src.indexOf('endstream', dataStart);
    let raw = buffer.subarray(dataStart, dataEnd);
    const dict = src.slice(start, streamAt);
    if (/\/FlateDecode/.test(dict)) raw = zlib.inflateSync(raw);
    const ops = raw.toString('latin1').match(/\bT[jJ]\b/g) || [];
    return { textOps: ops.length };
  });
}
