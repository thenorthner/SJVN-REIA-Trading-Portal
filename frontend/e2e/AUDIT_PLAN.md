# Frontend button audit: plan and checklist

**Goal:** open every screen as every role that uses it, press every button, and record whether it works.

**Scale:** 200 routes, about 176 screens and components, about 820 buttons in the source. A hand-written test per button isn't practical. Instead, an automated clicker presses each button on a fresh page and records what happened. Real bugs it finds then get a proper regression test.

**What "works" means for one click.** The clicker records what the click did:

- **OK:** something visible happened: a page change, a dialog, a download, a new tab, an API call that succeeded, a change on screen, or the form blocked an empty submit.
- **BROKEN:** a crash (uncaught exception), the "This screen failed to load" page, or a 5xx from the server.
- **REFUSED:** the server answered 4xx. The button may be fine (validation), but the user must be told why.
- **PLACEHOLDER:** a demo stub, such as an `alert()` saying "opened!", "coming soon" or "not implemented".
- **DEAD:** nothing happened at all: no request, no navigation, no dialog, no screen change.
- **SILENT:** does nothing, with no message, until its fields are filled in. It works once they are, but the user gets no feedback.
- **SKIPPED:** not pressed, with the reason: Log out, an external link, a disabled button, or a control that isn't there on a fresh load.

**Limit:** the clicker proves a button responds and doesn't break. It doesn't prove the number it produces is right. That's the job of the backend tests and the flow specs.

---

## Phase 0: make it safe to press everything

- [x] 0.1 Seed rich data: the project's own demo seed (`backend/src/db/seed.js`, a user for every role, contracts, invoices, trading desks), then the suite's fixtures, into the throwaway database.
- [x] 0.2 Cut the test server off from the internet, so buttons like "Fetch from CERC", "Submit to IEX" or "Sync NOAR" can't reach a real system.
- [x] 0.3 Browser guard rails: block requests that leave the machine, accept every confirm() and prompt() so the action behind it runs against the throwaway database, record its text, and never press Log out.
- [x] 0.4 The existing 23 specs still pass on the richer data.

## Phase 1: inventory (the list)

- [x] 1.1 Read every route and its role gate out of `App.jsx` into a route table.
- [x] 1.2 Open each route as a role allowed to see it and record every clickable thing in the content area: buttons, links, tabs, the first row of each table, and other clickable elements.
- [x] 1.3 Record detail pages (`/:id`) the same way, reached by clicking into them.
- [x] 1.4 Write the inventory as a readable list, screen by screen.

  **Result:** 197 screens (192 routes plus 5 detail pages) and 1,431 clickable things before opening any dialog: 649 buttons, 639 other clickable elements (mostly sortable column headers), 56 checkboxes, 52 links, 24 tabs, 11 table rows. 19 screens have nothing to press; most are read-only dashboards and portal views.

## Phase 2: every screen for every role

- [x] 2.1 Sign in as each of the 9 roles and open every link in that role's sidebar. Check for no error page, no crash and no 5xx.
- [x] 2.2 Open a screen the role must not reach and check it's refused cleanly, not a crash or a blank page.

  **Result:** 9 roles, 652 menu screens opened between them, none broken, and every role refused cleanly from a screen outside its reach. It found two refusals nobody could see: `/api/bids/standing-clearance` on **every** screen for five roles (the bell asked for it on everyone's behalf), and `/api/masters/lookups` for a trading user, which left the Bilateral Desk's NOAR rejection-reason dropdown empty. Both fixed.

## Phase 3: press every button

- [x] 3.1 Clicker: fresh page, click, then record the outcome as defined above.
- [x] 3.2 Go one level deeper: the buttons inside any dialog or tab that a click opened.
- [x] 3.3 Report: counts per outcome, and every non-OK button with its screen, label and what happened.

  **Result (after the fixes):** 2,115 presses on 187 screens — 1,974 OK, 36 DEAD, 12 PLACEHOLDER, 93 SKIPPED, **0 BROKEN**. Five broken buttons were found and fixed along the way (see 4.1). Report: `e2e/.audit-report/REPORT.md` and `button-audit.html`.

## Phase 4: triage and fix

- [x] 4.1 BROKEN: fix each one and add a spec that fails without the fix.

  Fixed: Reconciliation "Regenerate statement" (wrote to a column that does not exist); the IEX bid-book and bidding-detail **Excel** exports (crashed on an empty report); the DAM/GDAM **Create Bid** dialog (could not be closed at all); "Fetch Latest CERC MMC Report" (always fetched January 2026, and showed a bare 500 when the site was unreachable). Each has a test that fails without its fix.
- [x] 4.2 REFUSED: check the screen tells the user why, and fix the ones that fail silently.

  The clicker now checks whether the server's reason reaches the screen. One did not: the seller's "Validate vs System" showed only a "NO COUNTERPART" badge; it now says what that means and what to do. The dispute comment "Post" ignored an empty box in silence — it is disabled until something is typed (seller and buyer screens too).
- [x] 4.3 DEAD and PLACEHOLDER: list them for a product decision (wire them up or remove them).

  36 DEAD and 12 PLACEHOLDER remain, none of them a fault in code that exists: about half are tabs and filters that were already the selected one (they mark the choice with colour alone, so neither a screen reader nor the audit can tell — worth fixing for accessibility), and the rest are buttons never wired to anything: "Edit Details", "Change Password" (no password-change API exists), "+ Compose Mail" (a stub alert), the Billing Settlement / REC Hub / Inbox search and export buttons, REC Hub row Edit and Delete, Inbox "Open all" / "Close all", and the DOR exports. They need a decision, not a guess: build, or remove.
- [x] 4.4 Rerun everything: e2e, the audit, backend and unit tests, and the build.

  Backend 1,565 · frontend unit 189 · browser specs 39 · audit 413 tests, 0 failed · build clean.

## Phase 5: keep it

- [x] 5.1 `npm run test:audit` to repeat the audit at any time, with results in the README.
