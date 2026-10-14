# User manuals (Word, with screenshots)

Builds the step-by-step user manuals. Screenshots are taken from a sandbox copy
of the platform, never from the development database.

- `capture/*.mjs` — Playwright scripts that walk the screens and save marked-up
  screenshots into `shots/` (red numbered call-outs are drawn by `lib/browser.mjs`).
- `content/*.mjs` — the manual's text, written with the small vocabulary in
  `lib/doc.mjs` (chapter, step, fig, tip, fields, trouble …).
- `node build.mjs` — writes the `.docx` into `out/`; `./pdf.sh out/<file>.docx`
  renders it through Pages to check the layout.
- `run-part1.sh` — re-takes every Part 1 screenshot from a clean seeded database.

The sandbox: a fresh database seeded with `backend/src/db/seed.js`, served with
a production build of the front end on port 4100 (`MANUAL_BASE_URL` overrides),
started with `frontend/e2e/offline.cjs` so no email or outside call can leave it.

## Re-taking the screenshots

The capture scripts change the sandbox data as they go (they walk one month,
September 2026, through the whole cycle), so they run in this order, each from
the database snapshot the one before left behind:

`01-login`, `01b-account` → `02-stakeholders` → `03-users-docs` → `03b-desk` →
`04-contracts`, `04b-compliance` → `05-energy` → `06-billing` → `07-payments`,
`07b-extras` → `09-disputes` → `10-recon`, `10b-recon-buyer` → `11-security` →
`12-others`, `12b-forms` → `20-portals`, `21-portal-forms`.

Then `./optimise.sh` (smaller copies in `shots-opt/`), `node build.mjs`, and
`./pdf.sh out/SJVN_REIA_User_Manual.docx 30` to check the layout.
