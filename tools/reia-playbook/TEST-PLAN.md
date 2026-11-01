# REIA Playbook: side quest test plan

Scope: all 26 side quests (`QUESTS` in `index.html`, ids `q1`..`q26`), the engine
they play on, the Full cycle page (`CYCLE`), and the three shipped copies (source, offline file, portal copy).

## Layer 1 — Structure and data (automated: `node tools/reia-playbook/test-quests.mjs`)

| # | Check | Why it matters |
|---|---|---|
| 1.1 | Quest order matches the pinned list: ids are positional and are the progress keys | Inserting a quest renumbers the ones after it: saved progress and "Side quest N" links point at the wrong quest |
| 1.2 | Every quest has zone (one of `QZONES`), short, name, screen, goal, start, end, ≥2 steps, `also` | A missing field renders "undefined" or crashes the view |
| 1.3 | Every step: `who` is a role, `alt` roles are real, not `X`, not `who`, no repeats | A bad key crashes `R[k].c` |
| 1.4 | `res` has `o` and either `t` or `text`; `f` only with `t` | Result line renders half-empty |
| 1.5 | Every status in `res`, `{STATUS}` tokens and backticks: known to `KIND`, backticks balanced | Unknown status renders uncoloured; odd backtick leaks a raw `` ` `` |
| 1.6 | A step's `block` never blocks its own actor (`who` / `alt`) | Self-contradiction |
| 1.7 | "Side quest N" / "Mission N" cross-references point at the quest or mission the sentence means | Wrong link after a reorder |
| 1.8 | REIA-only wording: no trading / hydro / thermal / exchange / other-desk words, no passwords | Beta testers must never learn of other desks |
| 1.9 | Quiz fairness: a step whose text says another role can also do it keeps that role out of the options | A right answer marked wrong |
| 1.10 | No duplicate step titles inside a quest; `opt`/`noquiz` are booleans | Ambiguous quiz questions |
| 1.11 | Full cycle: each stage has a phase from `CPHASES`, a path of real roles, exceptions with `if` and `then` (no `if` twice), `see` ids that exist; every mission and side quest is linked from a stage; 1.5 and 1.8 apply to its text, and it names no mission or quest by number | A stage that links nowhere, or a quest no stage reaches, leaves a hole in the one-page picture |

## Layer 2 — Labels against the code (automated: `check-labels.mjs --all`)

Every button, refusal and status the quests quote is found in `frontend/src` or `backend/src`.

## Layer 3 — Roles and rules against the code (manual audit, quest by quest)

For each step: the actor really holds the permission (backend guard + frontend button gate),
every "blocked" claim is a real block, every number (days, characters, hours, ₹ bands,
row caps, report counts) matches the code, and status transitions are the code's.

## Layer 4 — In the browser (automated DOM run: `e2e-quests.js` in the page)

Run it on `index.html` (the `reia-playbook` preview) or `REIA-Playbook-offline.html`, with saved
progress cleared before the page loads. `index.html` opens with its own `<meta charset="utf-8">`
line, since a plain static server sends no charset; `export.mjs` drops that line from both copies,
which carry their own in the head.

For each of the side quests:
- `#qN` opens it; lanes = distinct players; one card per step; hand-off pills = role changes.
- Each step card opens the drawer: title, Log-in line, Where, Press, Fill, Result, Rules, Refuse,
  Block, Next (the next step's title, or the closing line), Previous/Next buttons enabled correctly.
- Play: every step in order, a "Switch player" dialog exactly at each change to a human role,
  Finish dialog with the right step / log-in counts and XP; "Mark done and go to the next" saves
  `q<n>` and opens the next quest; the last quest returns to the board.
- Board: one card per quest under each zone heading, done counts, Play and Open buttons; chip nav 1–N.
- Routing: `#q0`, `#q<N+1>`, `#qx` fall back safely; back/forward; keyboard (→ ← Esc Enter).
- Players page: each role's quest chips open the right quest. Quiz pool includes quest steps.
- Phone width (375px): lanes stack, no horizontal page scroll. Dark theme. No console errors.
- Each drawer shows the step's number (`Q24.6`). On the portal copy it also links the step's screen
  (none for an automatic step) and `/feedback?from=…` naming the step; the offline copy links neither.
- Find a step: every quest step is found by its title and its quest's name, and the result opens
  it; nonsense finds nothing. My role: each role lists exactly its own steps (missions and quests,
  `alt` counted), lights them in the lanes, is saved, and "Show everyone’s" clears it.
- Print: the print-only copy writes out every step of a mission and of a quest. `/` opens the search.
- Full cycle (`#cycle`): one section per stage, in order, with its title, every path step and exception,
  each refusal quoted as written, and its play links; no raw backticks or `{STATUS}`. Every exception is
  found by the filter under its own stage; nonsense finds nothing; clearing brings all back. A stage chip
  scrolls to its stage below the top bar; a play link opens the quest and Back returns. My role lights
  exactly that role's path steps. The Map's link opens the page.

The portal copy has no e2e file of its own: copy `e2e-quests.js` into `frontend/public/reia-playbook/`
for the run, and delete it after.

## Layer 5 — Shipped copies

`export.mjs` writes the offline file and the portal copy; the portal copy runs under the portal's
CSP (script from `/reia-playbook/playbook.js`, no inline script) and matches the source.

## Results, 1-Nov-2026 (Full cycle)

The Full cycle tab: 15 stages in five phases (once per deal, every month, when a buyer defaults, each
quarter and year, any day), 57 path steps and 144 exceptions, 39 of them with the platform's refusal.

| Layer | Run | Result |
|---|---|---|
| 1 Data | `test-quests.mjs`, with 1.11 | all pass |
| 2 Labels | `check-labels.mjs`, the cycle's labels, statuses and refusals included: 334 | all found |
| 4 Browser | `e2e-quests.js` on `index.html`: 3,626 checks (231 for the cycle) | all pass |
| 4 Phone | offline copy at 375 px, light and dark | no sideways scroll |
| 4 Print | print rules forced on screen | navigation, filter and links hidden; stages print in full |

Found while testing: no stage linked side quests 21 (Audit trail) or 23 (Reports); the any-day stage
links both now and has the audit trail's exceptions, and 1.11 fails a quest no stage links.

## Results, 1-Nov-2026

Three quests added (q24 Role Powers, q25 Holidays & due dates, q26 Alerts & messages), and the
search, my-role, screen-link, report and print features.

| Layer | Run | Result |
|---|---|---|
| 1 Data | `test-quests.mjs`: 26 quests, 122 steps | all pass |
| 2 Labels | `check-labels.mjs`: 308 labels | all found |
| 4 Browser | `e2e-quests.js` on `index.html` (offline): 3,395 checks | all pass |
| 4 Browser | `e2e-quests.js` on the portal copy (beta build, port 5180) | 3,639 checks, all pass (screen and report links included) |
| 4 Links | every step's screen link resolved and read by hand | 3 wrong fallbacks fixed (bill steps, top-bar steps, Compliance Desk tabs) |
| 4 Sign-in | `/masters?tab=holidays` signed out → sign in → lands on the holidays tab | as linked |
| 4 Print | print rules forced on screen, light and dark | dark theme printed dark panels: fixed |

Not run: the browser's own print dialog (page breaks are left to it).

## Results, 31-Oct-2026

| Layer | Run | Before fixes | After |
|---|---|---|---|
| 1 Data | `test-quests.mjs`: 23 quests, 101 steps | 42 failures | all pass |
| 2 Labels | `check-labels.mjs`: 274 labels | all found | all found |
| 3 Code audit | 101 steps against routes and screens | 7 mismatches | fixed or listed below |
| 4 Browser | `e2e-quests.js`: 2,538 checks | 21 failures | all pass |
| 4 Quiz | 800 questions sampled, all 69 quiz steps seen | 5 unfair questions | none |
| 4 Phone | 375 px, all 23 quests and the board | — | lanes stack, no sideways scroll |
| 5 Portal | portal copy against the CSP | — | no inline script, handler or eval; script = source |

Fixed in the playbook:
- CERC Form-IV had been inserted as quest 11, renumbering quests 11–21: saved progress named the
  wrong quests and four "Side quest N" links were wrong. It is quest 22 again; `PINNED` guards the order.
- After an automatic step the drawer said "Log out of Automatic", the switch dialog logged out of
  "Automatic", and an automatic step told the user to log out (Q2, Q7, Q11, Q12, Q13, Q20, Q21, Mission 10).
- The quiz marked a right role wrong: Finance raises and applies notes (Q2); the buyer, maker and
  Finance ask for a security release, Finance releases (Q15).
- SENT, REVERSED and seven mission/lifecycle statuses had no colour.
- Q8: a seller's resubmitted bill goes to UNDER_APPROVAL, not SUBMITTED.
- Q17: the banking cycle follows the PPA's basis, monthly by default (not the financial year), and fills
  itself; a cycle takes entries until the end of the month after it.

Fixed in the platform:
- The REIA maker could file a seller's Form 16A (Q6); Finance alone files it now.
- Q17 could not be played: on the default monthly basis every Bank Energy was refused ("The cycle
  ended on …"), because a month's energy locks only after the month, when its monthly cycle had
  closed; the last month of a seasonal or annual cycle could never be banked either. A cycle now
  takes entries (bank and draw) until the end of the month after it ends, and settles after that; a
  draw recorded after the cycle ended is billed in the cycle's last month. The form had pre-filled a
  financial-year cycle the server refused; it now shows the PPA's own cycle once the month is picked.
  Played on the app 31-Oct: 120 MWh of September banked into M2026-09, 50 MWh drawn (₹1,44,000 to
  the generator, ₹1,47,500 to the buyer, both for 2026-09); the sweep settled nothing that day and,
  run for 1-Nov and rolled back, settled the 70 MWh left (₹1,51,200 and ₹1,54,875).

Fixed in the platform, from the same sweep (31-Oct):
- A seller's Level 2 or admin could push its own SUBMITTED bill, or a draft, into SJVN's approval
  (UNDER_APPROVAL) through the API. A seller now only resubmits a bill SJVN sent back, and it goes to
  SUBMITTED, where a new bill lands; SJVN's maker verifies it and sends it into approval (Q8).
- Any SJVN role, the administrators included, could ask for a security release through the API; now
  the company, the maker or Finance. Whoever asked cannot decide it, so Finance does not release its
  own request (Q15).
- Any SJVN role could ask for a reconciliation period to be reopened; now the maker, the checker or
  Finance. Anyone on a side could attach that side's certificate-signed statement copy; now whoever
  may sign for it (SJVN's checker, a company's checker or admin).

Open: none from this testing.
