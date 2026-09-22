import { test } from '@playwright/test';
import { readRoutes } from './routes.js';
import { contextFor, concretePath } from './session.js';
import { collect, openScreen, watch } from './clicker.js';
import { append } from './results.js';

// Phase 1 — the list. Opens every routed screen as a role allowed to see it and
// records every clickable thing in its content area, without pressing anything.

const only = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null;
const routes = readRoutes().filter((r) => !r.redirect && (!only || only.test(r.path)));

// Screens are independent of each other, so they are spread across workers
// (npm run test:audit runs four). Each worker signs in on its own.
test.describe.configure({ mode: 'parallel' });

for (const route of routes) {
  test(`inventory ${route.path}`, async ({ browser, request, baseURL }) => {
    const url = concretePath(route);
    if (!url) {
      append('inventory.jsonl', { route: route.path, role: route.role, skipped: 'no record to open this detail page with' });
      return;
    }
    const context = await contextFor(browser, request, baseURL, route.role);
    const page = await context.newPage();
    const { rec, stop } = watch(page, context);
    const t0 = Date.now();
    await openScreen(page, url, rec.inflight);
    const t1 = Date.now();
    const items = await collect(page, 'main');
    const t2 = Date.now();
    const text = await page.locator('main.content').innerText().catch(() => '');
    append('inventory.jsonl', {
      route: route.path,
      url,
      role: route.role,
      guard: route.guard,
      // Read, not waited for: a screen with no heading would otherwise hold the
      // test for the whole action timeout.
      title: (await page.evaluate(() => document.querySelector('main.content h1, main.content h2')?.innerText || '')).slice(0, 80),
      restricted: text.includes('Access restricted'),
      errorScreen: text.includes('This screen failed to load'),
      loadErrors: [...rec.errors],
      loadServerErrors: rec.api.filter((c) => c.status >= 500),
      ms: { open: t1 - t0, collect: t2 - t1 },
      items: items.map(({ key, kind, label, disabled, href }) => ({ key, kind, label, disabled, href })),
    });
    stop();
    await context.close();
  });
}
