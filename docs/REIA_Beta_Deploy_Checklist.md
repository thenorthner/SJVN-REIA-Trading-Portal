# REIA beta deploy checklist (test.sjvn.co.in)

Server: Windows VM 192.168.0.2 · Apache:80 → Node:4000 · IIS:443 placeholder (no TLS yet).

## A. Before deploy (local)
- [x] Backend tests: 239 files / 2874 tests green (26-Oct)
- [ ] Frontend `vite build` passes
- [ ] Golden-path manual run: `docs/qa-prompts/reia-00-overall-end-to-end.md`
- [x] Decided 29-Oct: the beta sign-in has a Quick Demo Login with every REIA role, SJVN Admin included (shared seeded password). Anyone who opens the beta URL can sign in as SJVN Admin, so share the URL with beta testers only
- [ ] Decide: "Send email" stays OFF by default; SMS blocked (DLT)
- [ ] Untracked stray files (banner.png, test-login-*.png, src/shots) intentionally not committed

## B. On the server
1. [ ] Stop Node service
2. [ ] **Backup** `backend/src/db/platform.db` (+ `uploads/`) to a dated folder
3. [ ] Pull/copy code (branch `feat/trading-settlement-billing`), `npm ci` in backend
4. [ ] Build frontend: `npm run build` in `frontend/` (the REIA beta is the default via `frontend/.env.production`; "/" opens the REIA-only home, sign-in shows REIA only). Node serves `frontend/dist`. Never `npm run build:full` on the beta server: that is the full portal
5. [ ] Confirm `.env` present (JWT secret, NOAR key/secret — never regenerate NOAR key)
   - [ ] `REIA_BETA=1` in `backend/.env`: the API then leaves the hydro and thermal stations, the other desks' users, their audit entries and their alerts out of every answer. Without it the beta screens still list them
6. [ ] Start Node (DB migrations run on boot); check log for errors
7. [ ] Apache proxy still forwards :80 → :4000

## C. Smoke test (5 min)
- [ ] Home/public page loads, circulars + feedback pages open
- [ ] Login as each role (maker, checker, approver L3, admin) from Quick Demo Login
- [ ] As SJVN Admin: no Power Trading, Hydro, Thermal or Commercial anywhere (sidebar, search, bell, Users, Audit log, Masters)
- [ ] Open an invoice, download PDF
- [ ] Create + approve one invoice (maker ≠ checker ≠ approver enforced)
- [ ] Dashboard numbers match invoice list
- [ ] Dark theme + small screen readable

## D. Rollback
- Stop Node → restore backed-up `platform.db` and `uploads/` → redeploy previous commit (`4cb5aa0`) → start Node.

## E. Tell beta users
- HTTP only for now (TLS pending on IIS:443)
- PXIL / WBES / SMS integrations not live: "no data" there is expected
- Say nothing of other desks: the beta is the REIA portal alone
- Feedback channel: (fill in)
