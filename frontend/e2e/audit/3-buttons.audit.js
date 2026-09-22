import { test, expect } from '@playwright/test';
import { readRoutes } from './routes.js';
import { contextFor, concretePath, healLogins } from './session.js';
import { collect, openScreen, watch, press, OUTCOME, MAX_PER_SCREEN, MAX_CHILDREN } from './clicker.js';
import { append } from './results.js';

// Phase 3 — press every button. For each screen: every clickable thing in its
// content area is pressed on a freshly loaded page, and so is everything inside
// the dialog (or newly shown panel) that press opened. Each press is recorded;
// the screen's test fails only if something on it is BROKEN.

const routes = readRoutes().filter((r) => !r.redirect);

// Screens are independent of each other, so they are spread across workers
// (npm run test:audit runs four). Each worker signs in on its own.
test.describe.configure({ mode: 'parallel' });
const only = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null;

for (const route of routes.filter((r) => !only || only.test(r.path))) {
  test(`buttons ${route.path}`, async ({ browser, request, baseURL }) => {
    test.setTimeout(20 * 60 * 1000);
    const url = concretePath(route);
    if (!url) {
      append('buttons.jsonl', { route: route.path, level: 0, key: '(screen)', outcome: OUTCOME.SKIPPED, detail: 'no record to open this detail page with' });
      return;
    }
    let context = await contextFor(browser, request, baseURL, route.role);
    let page = await context.newPage();
    let watcher = watch(page, context);
    const broken = [];

    const record = (row) => {
      append('buttons.jsonl', { route: route.path, url, role: route.role, ...row });
      if (row.outcome === OUTCOME.BROKEN) broken.push(`${row.parent ? `${row.parent} → ` : ''}${row.key}: ${row.detail}`);
    };
    // A press that ends the session (a "deactivate" on the admin, say) is a
    // finding; put the login back and carry on with a fresh one.
    const recoverIfSignedOut = async (res) => {
      if (res.outcome !== OUTCOME.BROKEN || !res.detail.startsWith('the session was lost')) return;
      healLogins();
      watcher.stop();
      await context.close();
      context = await contextFor(browser, request, baseURL, route.role);
      page = await context.newPage();
      watcher = watch(page, context);
    };

    await openScreen(page, url, watcher.rec.inflight);
    const loadProblems = [
      ...watcher.rec.errors.map((e) => `uncaught error: ${e}`),
      ...watcher.rec.api.filter((c) => c.status >= 500).map((c) => `${c.status} from ${c.method} ${c.path}`),
    ];
    if (loadProblems.length) record({ level: 0, key: '(screen load)', outcome: OUTCOME.BROKEN, detail: loadProblems.join('; ') });

    const items = (await collect(page, 'main')).slice(0, MAX_PER_SCREEN);
    const baseKeys = new Set(items.map((x) => x.key));
    let fresh = true;

    for (const item of items) {
      if (!fresh) await openScreen(page, url, watcher.rec.inflight);
      fresh = false;
      const res = await press(page, watcher.rec, 'main', item.key, baseKeys);
      record({ level: 1, key: item.key, kind: item.kind, outcome: res.outcome, detail: res.detail, consoleErrors: res.consoleErrors });
      await recoverIfSignedOut(res);
      if (!res.childScope) continue;

      const childKeys = res.childScope === 'dialog'
        ? (await collect(page, 'dialog')).map((x) => x.key)
        : res.childKeys;
      for (const childKey of childKeys.slice(0, MAX_CHILDREN)) {
        await openScreen(page, url, watcher.rec.inflight);
        const again = await press(page, watcher.rec, 'main', item.key, baseKeys);
        if (again.childScope !== res.childScope) {
          record({ level: 2, parent: item.key, key: childKey, outcome: OUTCOME.SKIPPED, detail: `"${item.key}" did not open the same thing a second time` });
          await recoverIfSignedOut(again);
          continue;
        }
        const child = await press(page, watcher.rec, res.childScope, childKey);
        record({ level: 2, parent: item.key, key: childKey, outcome: child.outcome, detail: child.detail, consoleErrors: child.consoleErrors });
        await recoverIfSignedOut(child);
      }
    }

    watcher.stop();
    await context.close();
    expect.soft(broken, `${route.path}: buttons that broke`).toEqual([]);
  });
}
