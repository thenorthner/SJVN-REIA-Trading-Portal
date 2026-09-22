import { test, expect } from '@playwright/test';
import { LOGINS } from './routes.js';
import { contextFor } from './session.js';
import { collect, openScreen, watch, press, OUTCOME } from './clicker.js';
import { append } from './results.js';

// The top bar is outside every screen's content area, so the button pass does
// not reach it. This presses the bell and the account menu, and every item in
// each, as every demo role — the menus are the same component for all of them,
// but where their items lead is not.

for (const role of Object.keys(LOGINS)) {
  test(`header menus as ${role}`, async ({ browser, request, baseURL }) => {
    const context = await contextFor(browser, request, baseURL, role);
    const page = await context.newPage();
    const { rec, stop } = watch(page, context);
    const broken = [];
    const record = (row) => {
      append('buttons.jsonl', { route: `(header as ${role})`, url: '/', role, ...row });
      if (row.outcome === OUTCOME.BROKEN) broken.push(`${row.parent ? `${row.parent} → ` : ''}${row.key}: ${row.detail}`);
    };

    await openScreen(page, '/', rec.inflight);
    const toggles = await collect(page, 'header');
    const baseKeys = new Set(toggles.map((x) => x.key));
    for (const toggle of toggles) {
      await openScreen(page, '/', rec.inflight);
      const res = await press(page, rec, 'header', toggle.key, baseKeys);
      record({ level: 1, key: toggle.key, kind: toggle.kind, outcome: res.outcome, detail: res.detail });
      if (!res.childKeys?.length) continue;
      for (const itemKey of res.childKeys) {
        await openScreen(page, '/', rec.inflight);
        await press(page, rec, 'header', toggle.key, baseKeys);
        const item = await press(page, rec, 'header', itemKey, null, { menuItem: true });
        // An item that opens a screen the role may not use is not working either.
        if (item.outcome === OUTCOME.OK && await page.getByText('Access restricted').count()) {
          item.outcome = OUTCOME.BROKEN;
          item.detail = `${item.detail} — and that screen says "Access restricted" for ${role}`;
        }
        record({ level: 2, parent: toggle.key, key: itemKey, outcome: item.outcome, detail: item.detail });
      }
    }
    stop();
    await context.close();
    expect.soft(broken, `header menus as ${role}`).toEqual([]);
  });
}
