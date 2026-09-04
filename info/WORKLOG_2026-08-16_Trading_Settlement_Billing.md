# Worklog — 16 Aug 2026  
## Trading Settlement & Billing (ISET desks)

**Branch:** `feat/trading-settlement-billing`  
**Key commit:** `870de9a` — *Settle and bill what the trading desks actually traded*  
**Earlier same-day context:** ISET menu/screens parity (`cf571cf` and related trading UI work)

---

## Problem (jo aaj solve kiya)

Trading desks pe contracts, schedules, bids aur certificates record ho rahe the, aur `view_bill_invoices` mein bills dikhte the — **lekin beech mein join nahi tha**. Har ISET View Bill row mostly hand-entered / seed sample thi. Kai lifecycle columns schema mein vocabulary rakhte the, code kabhi default se aage nahi badhta tha.

Aaj ka kaam: **jo trade hua usi se settle karo, usi se bill raise karo.**

---

## 1. Bilateral desk — end-to-end settlement + billing

### Backend
- **`bilateralSettlement.js`** — 15-min blocks → billable quantum  
  - curtailment net off  
  - metered actuals schedule se preferred  
  - losses injection point tak gross-up  
- Bills: **Energy / Open Access / SLDC Consent** → `view_bill_invoices`
- `open_access_status` / `schedule_status` ab schedules + approvals se **derive**
- Zero volume pe flat/per-day OA bill silent nahi — **reject**, unless `allow_zero_volume: true`
- Shared insert path: **`billingRegister.js`**

### Frontend
- **`Bilateral.jsx`** — detail panel mein **Settlement & Billing**  
  - supply period, settled position, teen raise buttons  
  - Energy tab tak disabled jab tak OA APPROVED/PARTIAL na ho  
- View Bills ledgers pe payment / update / cancel pehle se wired (claim verify kiya — “view-only” galat tha)

### Bidding → Contract
- `POST /bilateral-bidding/:id/contract`
- Applications screen: **Create contract** / **Open contract**
- **Design call:** auto-create nahi — ISET format form pe rate nahi hota; rate desk maangta hai (warna ₹0 contract → silent zero bill)

---

## 2. Exchange desk — same pattern

### Backend
- **`exchangeSettlement.js`** — cleared `bid_blocks` @ market clearing price (bid price pe nahi)
- Buyer/Seller side ke hisaab se margin direction
- Exchange transaction fee rate-master pe
- Bills: **EXCHANGE_ENERGY / EXCHANGE_OA / TRADING_MARGIN**
- Bids ab `contract_id` se agreement se judte hain (purane unlinked: client + product + window match)
- Contract create ab **`DRAFT`**; pehla live bid → **`ACTIVE`**
- Zero-volume OA guard (bilateral jaisa)

### Frontend / API
- Client: `exchangeContracts.settlement` / `invoices` / `generateInvoice`
- **Unified billing UI:** Bill Generation form client-first se teeno exchange bills bhi raise kar sakta hai
- Contract detail pe Bilateral-jaisa dedicated settlement panel — abhi secondary path (billing hub primary)

---

## 3. REC desk — certificate movement + settlement register

### Backend
- **`recTrading.js`** + `/api/rec-trading` lifecycle  
  - bid → maker-checker approve → **execute**
- **Sell:** FIFO oldest vintage → ledger draw → **`rec_orders`** auto
- **Buy:** naya issued lot
- Sell stock check: live **held − committed open bids** (static `rec_registry_available` alone pe depend nahi)
- Sale reverse: lot txn reverse ke saath bid / order restatement (revenue overstated na rahe)

### Frontend
- Bid Entry: inventory strip, approve / execute actions wired

---

## 4. Unified Billing hub

- **`/api/billing`** — client choose → bill type → contract resolve → preview → generate
- **`BillGenerationForm.jsx`** / **`BillOfSupplyForm.jsx`** — mockup (`console.log`) se live API
- Bill of Supply register + report live read
- Teeno desks ke invoice inserts **`billingRegister.js`** se

---

## 5. ISET screen surface (same day / branch pe)

Trading menu ISET layout ke hisaab se; screens jismein kaam aaya / land hua:

| Area | Examples |
|------|----------|
| Bilateral | Create, Summary, Bidding, Applications, Energy/OA/SLDC invoices |
| Exchange | Contracts, Bidding, Applications, Energy settlement invoice, Update Charges |
| REC / ESCert | Bid Entry, Order, Order Report, ESCert bid |
| View Bills | Ledger (payment / edit / cancel) |
| Reports / uploads | ISET report pages, PXIL, IEX bid book, CSV/MMR uploaders, Daily Schedule Entry |

Live portal seed rows **`backend/src/data/live/`** (gitignored) — clone pe code chalta hai, private counterparty data remote pe nahi jaati.

---

## 6. Safety / ops incident (important)

| Event | Action |
|-------|--------|
| Test suite galti se **repo root** se chali → `setup.js` load nahi → DELETE commands **`platform.db`** pe | Partial recovery via app seeders |
| Users / entities / trading_clients mostly intact | Transactional demo tables (contracts, invoices, payments, …) seed skip ke wajah se wapas nahi aaye |
| Guard | `VITEST` set + `SJVN_DB_PATH` missing → **real DB open refuse** (`db/index.js`) |

**Full reseed** (seed ke ~9 accounts) — **user call**; bina pooche nahi chalaya.

Always: `cd backend && npm test`

---

## 7. Tests

New / expanded suites on this workstream:

- `bilateralLifecycle` / `bilateralSettlement` / `bilateralBiddingContract`
- `exchangeLifecycle` / `exchangeSettlement`
- `recLifecycle` / `recTrading`
- `billing`

Suite size order ~700 tests on this branch (run from `backend/`).

---

## 8. Ab bhi bahar / pending (jaan-bujh ke nahi kiya)

| Gap | Why |
|-----|-----|
| Live WBES / NOAR / IEX / PXIL APIs | Credentials + vendor contracts |
| ERP push | Target ERP API contract |
| DSM frequency-linked slabs | Abhi simplified flat; CERC notification ke bina guess nahi |
| Mid-period revisions / multi-buyer splits | Scope expansion |
| Dev DB full demo reseed | Explicit user decision |

---

## 9. Verdict (seedhi baat)

| Desk | Platform-internal settle → bill |
|------|----------------------------------|
| Bilateral | Wired (desk + API) |
| Exchange | Wired (API + billing hub; desk panel optional polish) |
| REC | Wired (execute → ledger → order register) |
| View Bills | Real register + payment lifecycle |

**“Zero lack / go-live with live Grid + ERP” nahi** — lekin pehle wala “registers fill, bills seed-only” gap **band** ho chuka hai.

---

## Quick pointers (code)

| Piece | Path |
|-------|------|
| Bilateral settlement | `backend/src/services/bilateralSettlement.js` |
| Exchange settlement | `backend/src/services/exchangeSettlement.js` |
| REC trading | `backend/src/services/recTrading.js` |
| Shared invoice insert | `backend/src/services/billingRegister.js` |
| Billing API | `backend/src/routes/billing.js` |
| Bilateral desk UI | `frontend/src/pages/trading/Bilateral.jsx` |
| Bill generation UI | `frontend/src/pages/trading/BillGenerationForm.jsx` |
| Vitest DB guard | `backend/src/db/index.js` |

---

_Generated for internal handoff — 16 Aug 2026._
