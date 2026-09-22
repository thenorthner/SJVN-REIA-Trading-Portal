import { test, expect } from '@playwright/test';
import { readRoutes, LOGINS } from './routes.js';
import { contextFor, concretePath } from './session.js';
import { openScreen, watch } from './clicker.js';
import { append } from './results.js';

// Phase 2 — every screen for every role. Signs in as each demo role, opens
// every link its sidebar offers, and checks each opens cleanly. Then opens one
// screen the role must not reach and checks it is refused, not crashed.

const routes = readRoutes().filter((r) => !r.redirect && !r.hasParam);

async function sidebarLinks(page) {
  // Open every collapsed section and sub-group, then read the links.
  for (let pass = 0; pass < 4; pass += 1) {
    const closed = page.locator('.nav-section-title, .nav-subgroup-title').filter({ hasText: '▶' });
    const n = await closed.count();
    if (!n) break;
    for (let i = n - 1; i >= 0; i -= 1) await closed.nth(i).click().catch(() => {});
  }
  return page.locator('.sidebar a.nav-link').evaluateAll((as) => as.map((a) => ({
    href: a.getAttribute('href'),
    label: a.innerText.replace(/\s+/g, ' ').trim(),
    soon: /\bsoon\b/.test(a.innerText),
  })));
}

for (const role of Object.keys(LOGINS)) {
  test(`${role} — every sidebar screen opens, and a forbidden one is refused`, async ({ browser, request, baseURL }) => {
    // The internal roles have some sixty menu screens each.
    test.setTimeout(10 * 60 * 1000);
    const context = await contextFor(browser, request, baseURL, role);
    const page = await context.newPage();
    const { rec, stop } = watch(page, context);
    await openScreen(page, '/', rec.inflight);
    const links = [...new Map((await sidebarLinks(page)).map((l) => [l.href, l])).values()];
    expect(links.length, `${role} has a sidebar`).toBeGreaterThan(0);
    const problems = [];

    for (const link of links) {
      rec.errors.length = 0; rec.api.length = 0;
      await openScreen(page, link.href, rec.inflight);
      const text = await page.locator('main.content').innerText().catch(() => '');
      const issues = [
        ...rec.errors.map((e) => `uncaught error: ${e}`),
        ...rec.api.filter((c) => c.status >= 500).map((c) => `${c.status} from ${c.method} ${c.path}${c.error ? ` — ${c.error}` : ''}`),
        ...(text.includes('This screen failed to load') ? ['shows "This screen failed to load"'] : []),
        ...(text.includes('Access restricted') ? ['the menu offers it, but the screen says "Access restricted"'] : []),
        ...(page.url().includes('/login') ? ['sent back to the login page'] : []),
      ];
      const refused = rec.api.filter((c) => c.status === 403).map((c) => `403 from ${c.method} ${c.path}${c.error ? ` — ${c.error}` : ''}`);
      append('roles.jsonl', { role, href: link.href, label: link.label, soon: link.soon, issues, refused });
      if (issues.length) problems.push(`${link.href}: ${issues.join('; ')}`);
    }

    // One screen outside the role's reach, opened by typing its address.
    const forbidden = routes.find((r) => r.roles && !r.roles.includes(role));
    if (forbidden) {
      rec.errors.length = 0;
      await openScreen(page, concretePath(forbidden), rec.inflight);
      const text = await page.locator('body').innerText();
      const refusedCleanly = text.includes('Access restricted') || !page.url().includes(forbidden.path);
      const issues = [
        ...rec.errors.map((e) => `uncaught error: ${e}`),
        ...(refusedCleanly ? [] : ['opened a screen this role is not allowed']),
      ];
      append('roles.jsonl', { role, href: forbidden.path, label: '(forbidden check)', forbiddenCheck: true, issues, refused: [] });
      if (issues.length) problems.push(`${forbidden.path} (forbidden): ${issues.join('; ')}`);
    }

    stop();
    await context.close();
    expect.soft(problems, `${role}: screens that broke`).toEqual([]);
  });
}
