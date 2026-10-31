# REIA Playbook: side quest test plan

Scope: all 23 side quests (`QUESTS` in `index.html`, ids `q1`..`q23`), the engine
they play on, and the three shipped copies (source, offline file, portal copy).

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

## Layer 2 — Labels against the code (automated: `check-labels.mjs --all`)

Every button, refusal and status the quests quote is found in `frontend/src` or `backend/src`.

## Layer 3 — Roles and rules against the code (manual audit, quest by quest)

For each step: the actor really holds the permission (backend guard + frontend button gate),
every "blocked" claim is a real block, every number (days, characters, hours, ₹ bands,
row caps, report counts) matches the code, and status transitions are the code's.

## Layer 4 — In the browser (automated DOM run: `e2e-quests.js` in the page)

Run it on `REIA-Playbook-offline.html`, which declares UTF-8, with saved progress cleared before the
page loads. The raw `index.html` has no charset (Artifact format) and a plain static server sends
none, so the browser can read it as Windows-1252 and the data markers no longer match.

For each of the 23 quests:
- `#qN` opens it; lanes = distinct players; one card per step; hand-off pills = role changes.
- Each step card opens the drawer: title, Log-in line, Where, Press, Fill, Result, Rules, Refuse,
  Block, Next (the next step's title, or the closing line), Previous/Next buttons enabled correctly.
- Play: every step in order, a "Switch player" dialog exactly at each change to a human role,
  Finish dialog with the right step / log-in counts and XP; "Mark done and go to the next" saves
  `q<n>` and opens the next quest; the last quest returns to the board.
- Board: 23 cards under 5 zone headings, done counts, Play and Open buttons; chip nav 1–23.
- Routing: `#q0`, `#q24`, `#qx` fall back safely; back/forward; keyboard (→ ← Esc Enter).
- Players page: each role's quest chips open the right quest. Quiz pool includes quest steps.
- Phone width (375px): lanes stack, no horizontal page scroll. Dark theme. No console errors.

## Layer 5 — Shipped copies

`export.mjs` writes the offline file and the portal copy; the portal copy runs under the portal's
CSP (script from `/reia-playbook/playbook.js`, no inline script) and matches the source.

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
