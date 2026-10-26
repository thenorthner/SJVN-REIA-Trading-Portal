import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import fs from 'fs';
import path from 'path';
import DialogHost from './DialogHost.jsx';
import { showAlert, askConfirm, askText } from '../lib/dialogs.js';

// The platform asks in its own popup, never in the browser's: a native alert,
// confirm or prompt blocks the page and any assistive or automated browser on it.

let host, root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root.render(<DialogHost />); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

describe('the in-page dialogs', () => {
  it('confirms, and cancels', async () => {
    let yes;
    await act(async () => { askConfirm('Cancel INV-1?', { okLabel: 'Cancel the bill' }).then((v) => { yes = v; }); });
    expect(document.body.textContent).toContain('Cancel INV-1?');
    await act(async () => { button('Cancel the bill').click(); });
    expect(yes).toBe(true);

    let no;
    await act(async () => { askConfirm('Delete?').then((v) => { no = v; }); });
    await act(async () => { button('Cancel').click(); });
    expect(no).toBe(false);
  });

  it('asks for text, and will not take a blank answer when one is needed', async () => {
    let why;
    await act(async () => { askText('Why is this note rejected?').then((v) => { why = v; }); });
    expect(button('OK').disabled).toBe(true);
    const input = document.querySelector('.modal input');
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, 'Wrong period');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('OK').click(); });
    expect(why).toBe('Wrong period');
  });

  it('shows one message at a time, in order', async () => {
    await act(async () => { showAlert('First'); showAlert('Second'); });
    expect(document.body.textContent).toContain('First');
    expect(document.body.textContent).not.toContain('Second');
    await act(async () => { button('OK').click(); });
    expect(document.body.textContent).toContain('Second');
    await act(async () => { button('OK').click(); });
  });
});

describe('the source', () => {
  it('uses no native alert, confirm or prompt anywhere', () => {
    const src = path.resolve(__dirname, '..');
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) && !p.endsWith(path.join('lib', 'dialogs.js'))) {
          fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            if (/(^|[^.\w$])(window\.)?(alert|confirm|prompt)\((?!s\))/.test(line)) hits.push(`${path.relative(src, p)}:${i + 1}`);
          });
        }
      }
    };
    walk(src);
    expect(hits).toEqual([]);
  });
});
