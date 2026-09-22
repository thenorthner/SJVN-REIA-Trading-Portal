# Browser tests (Playwright)

The API suite in `backend/tests` checks what the server answers. It can't see a form that never sends a required field, a table running past its box, or a PDF with a blank page. These tests open the real app in Chromium and check those things.

## Run

```bash
cd frontend
npm run test:e2e              # the whole suite, about 40 seconds
npx playwright test disputes  # one spec
npm run test:e2e:report       # open the HTML report from the last run
```

First time on a new machine: `npx playwright install chromium`.

Each run:

1. builds the UI into `e2e/.dist`,
2. seeds a **fresh** database at `e2e/.data/e2e.db` (`prepare.mjs`, fixtures in `fixtures.js`),
3. starts the backend on port 4100, serving that build the way production does,
4. signs in and raises a dispute, its evidence and a reconciliation through the API (`fixtures.setup.js`),
5. runs the specs.

The server never touches your development database, `backend/uploads`, the tracked CERC reports, or `backend/.env`. Its database, evidence, backups, CERC folder and outbox all stay under `e2e/.data`, and SMTP, IEX and PXIL are off. `prepare.mjs` refuses to run unless it is pointed at `e2e/.data`.

If a test fails, `e2e/.results/<test>/` has a screenshot, the page snapshot and a trace (`npx playwright show-trace <trace.zip>`).

## What it covers

| Spec | Checks |
|---|---|
| `reia-screens` | Every screen in the REIA menu opens with no error screen, no uncaught exception, no 5xx behind a panel, and nothing running out of its box. The list comes from the sidebar, so a new menu entry is covered automatically. |
| `header-menus` | The bell and account menus close on an outside click or Escape, and only one is open at a time. |
| `disputes` | The evidence box lists only this dispute's own files and fits inside its box. Upload and View work. |
| `reconciliation` | Every statement note can be read in full, with no sideways scroll. |
| `contracts` | Amend asks for Effective From within the tenure and files version 2 with that date. New Contract offers Hydro and can create a hydro PPA. |
| `pdf-reports` | Every REIA report downloaded from its button has no blank page. |
| `login` | The login form signs in and refuses a wrong password. |

Each check was confirmed to fail when the bug it guards against is put back.

## The button audit

```bash
cd frontend
npm run test:audit    # about an hour; the report is written to e2e/.audit-report/REPORT.md
AUDIT_ONLY='^/reia/disputes$' npx playwright test --project=audit audit/3-buttons   # one screen
```

The audit opens every routed screen (read from `App.jsx`) as a role allowed to see it and presses everything clickable: first on the screen, then inside any dialog or panel a press opens. Each press starts from a fresh load and gets a verdict: OK, BROKEN, REFUSED, PLACEHOLDER, DEAD, SILENT or SKIPPED. [AUDIT_PLAN.md](AUDIT_PLAN.md) explains each one. It also signs in as each of the 9 demo roles and opens every link in that role's sidebar.

It runs on the same throwaway server as the specs, with the internet cut off (`offline.cjs`), so no button can reach CERC, IEX, PXIL, NOAR or a mail relay. A screen's test fails only when something on it is BROKEN. The other verdicts go in the report for review.

## Adding a test

- Use a record of your own when the test changes data (see the `beforeEach` in `contracts.spec.js`). The suite has to pass twice in a row: `npx playwright test --repeat-each=2`.
- Find things the way a user does: by role, label or visible text. Clickable table rows are `page.locator('tbody tr', { hasText })`.
- For layout, `horizontalOverflow(locator)` in `support.js` lists anything whose content spills out of its box. Deliberate sideways scrolling and `…` truncation are allowed.
