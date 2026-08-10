import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// PDFKit's built-in fonts are encoded WinAnsi. It covers Latin-1 and a handful
// of typographic marks — the em-dash, en-dash, ellipsis, bullet, curly quotes —
// and nothing else. A character outside it is not refused; another glyph is
// substituted silently, so the document renders and reads wrong.
//
// Five characters were doing this across every report in the platform: the rupee
// sign, a rightwards arrow used as a range separator, a left-right arrow, the
// true minus sign, and a Greek delta. A reconciliation report headed
// "June 2026 to July 2026" was going out reading "June 2026 !' July 2026", and a
// KPI labelled "Unreconciled Rs." read "Unreconciled ¹".
//
// The rule is a test rather than a comment because the substitution is invisible
// at the point of writing — the source looks right, and only the rendered page
// is wrong.

const WINANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const renderable = (ch) => ch.codePointAt(0) < 0x100 || WINANSI_EXTRA.has(ch);

const SCRIPTS = path.join(process.cwd(), 'src/scripts');
const pdfScripts = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.js') && /pdf/i.test(f));

/** Source with comments removed — an explanation may name the characters. */
const drawnText = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

describe('S26 Report PDFs only use characters their font can draw', () => {
  it('finds the PDF scripts', () => {
    expect(pdfScripts.length).toBeGreaterThan(5);
  });

  for (const file of pdfScripts) {
    it(`${file} renders every character it writes`, () => {
      const body = drawnText(fs.readFileSync(path.join(SCRIPTS, file), 'utf-8'));
      const offenders = new Map();
      for (const ch of body) {
        if (renderable(ch)) continue;
        offenders.set(ch, (offenders.get(ch) || 0) + 1);
      }
      const described = [...offenders.entries()]
        .map(([c, n]) => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}) x${n}`)
        .join(', ');
      expect(offenders.size,
        `${file} draws characters PDFKit's built-in font cannot render, and will substitute silently: ${described}. `
        + 'Use an ASCII equivalent — "Rs." for the rupee sign, "to" for an arrow, "-" for the minus sign — '
        + 'or embed a Unicode TTF and switch the font calls to it.').toBe(0);
    });
  }
});
