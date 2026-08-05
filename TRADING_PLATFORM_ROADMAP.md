# SJVN Trading Platform — 10-15 Item Backlog

**Legend:** ⏱️ = time estimate | 🎯 = impact (high/medium/low) | 🔴 = blocker status

---

## PHASE 1: URGENT FIXES (Today)

### 1. **Fix CERC DSM/REC Sheet Matching Bug** 🔴 BLOCKER
- **Problem:** Sheet numbers change yearly (Table 32 is REC in 2024-03, region-summary in 2024-08). Current regex matches wrong tables → garbage DSM rates seeded (1M+ for 2024-03, wrong for 2024-04-2025-03).
- **Impact:** Market Intelligence page DSM chart is corrupt. Affects rate forecasting dashboard.
- **Work:**
  - Replace table-number matching with **title-text matching** in `cercScraper.js:290-291`
  - DSM: `/VOLUME AND CHARGES UNDER DSM/i`
  - REC: `/RENEWABLE ENERGY CERTIFICATES/i`
  - Remove greedy regex patterns `|.*(?:42|41|33|32|30|28).*`
  - Re-seed cerc_monthly_summary (DELETE records pre-2025-05, re-run autoSeedLocalReports)
- **Time:** ⏱️ 20 min
- **Priority:** 🎯 HIGH — data integrity issue live
- **File:** `backend/src/services/cercScraper.js` (lines 260-300)

---

### 2. **Remove Committed Binary CERC Files + Update .gitignore**
- **Problem:** 18 MB of CERC PDFs + XLSXs committed to Git (3.4 MB PDFs alone). Repo bloats on every clone.
- **Work:**
  - Add `backend/cerc_downloads/**` to `.gitignore`
  - `git rm --cached backend/cerc_downloads/` (don't delete local files)
  - Commit `.gitignore` change
- **Time:** ⏱️ 10 min
- **Priority:** 🎯 HIGH — DevOps / deployment speed
- **Note:** Local cache files stay on-disk for offline fallback; just not committed.

---

### 3. **Add TDS Deduction Column to trading_invoices**
- **Problem:** TDS is baked into billingSettlement as demo `margin * 0.1`. Real data: 194Q @ 0.1% (energy), 194C @ 10% (OA charges). Ledger shows actual values (6,71,175 → -671 TDS).
- **Work:**
  - Add `tds_applicable TEXT CHECK (tds_applicable IN ('194Q','194C','NONE'))` to `trading_invoices`
  - Add `tds_rate REAL DEFAULT 0.001` (0.1%) and `tds_amount REAL DEFAULT 0` columns
  - Update invoice creation logic in `tradingInvoices.js` to accept `tds_applicable` param
  - Add to `trading_payments`: link to which TDS was deposited (via challan_no)
- **Time:** ⏱️ 30 min
- **Priority:** 🎯 MEDIUM — unblocks TDS ledger
- **Files:** `backend/src/db/schema.sql`, `backend/src/routes/tradingInvoices.js`

---

## PHASE 2: SCHEMA FOUNDATIONS (Next 2–3 hours)

### 4. **Split Tariff into Purchase + Sale Rate + Margin in bilateral_transactions**
- **Problem:** Currently `tariff_per_unit` is single value. Ledger shows: purchase=₹1.184–3.373, sale=purchase+₹0.03 (margin), always ≠0.03 = alert.
- **Work:**
  - Add columns: `purchase_rate_per_unit REAL`, `sale_rate_per_unit REAL`, `trading_margin_per_unit REAL DEFAULT 0.03`
  - Add validation trigger: `sale_rate - purchase_rate` must equal `trading_margin` (tolerance ±0.001)
  - **Migration:** `UPDATE bilateral_transactions SET purchase_rate_per_unit = tariff_per_unit WHERE 1=1` (keep tariff for backward compat)
  - Add audit log entry for any manual margin override
- **Time:** ⏱️ 45 min (schema + migration + validation)
- **Priority:** 🎯 HIGH — margin is core business rule
- **Files:** `backend/src/db/schema.sql`, migration script, `bilateral.js` route

---

### 5. **Create Effective-Dated Rate Master Table**
- **Problem:** ISTS charge = ₹359–509/MWh across dates. Single row in system_parameters won't work.
- **Work:**
  - New table: `rate_master` (id, rate_type TEXT, charge_name TEXT, rate_value REAL, effective_from, effective_to, updated_by, note)
  - Seed from ledger: WB STU ₹238.4, Delhi STU ₹382.54, ERLDC/NRLDC ₹1000/day, NOAR app fee ₹5000, RLDC ₹1000/day
  - Helper function: `getEffectiveRate(rateName, onDate)` returns applicable rate
  - Frontend: admin panel to create/edit rates with date ranges
- **Time:** ⏱️ 1 hour (schema + helper + API)
- **Priority:** 🎯 MEDIUM — needed for OA estimation
- **Files:** New `backend/src/routes/rateMaster.js`, schema.sql

---

### 6. **Add PAN Master + Party Alias Resolution**
- **Problem:** GACL appears as 4 different names in ledger → 4 different customers if imported as-is. Same for NTPCREL.
- **Work:**
  - Add to `entities`: `legal_name TEXT`, `short_name TEXT`, `gst_no TEXT`, `pan_no TEXT` (pan_no already exists)
  - New table: `entity_aliases` (entity_id, alias_name, active INTEGER)
  - Seed from ledger: map 4 GACL variants to single entity
  - Importer: ON CONFLICT (alias_name) UPDATE entity_id = canonical_id
  - API: GET /entities/:id/aliases → show all known names
- **Time:** ⏱️ 45 min
- **Priority:** 🎯 MEDIUM — data quality for reconciliation
- **Files:** `backend/src/db/schema.sql`, `backend/src/routes/entities.js`

---

## PHASE 3: INVOICE & BILLING SYSTEMS (Next 3–4 hours)

### 7. **Implement Real Invoice Number Generator (SJVN/ENERGY/CLIENT/YYYYMM/SEQ)**
- **Problem:** Current: `TRD/2026/847392` (random). Real format: `SJVN/ENERGY/KREATE/202605/144` (series counter per client+period).
- **Work:**
  - New table: `invoice_counters` (id, series_type TEXT, client_id, billing_month, next_seq INTEGER)
  - Function: `genInvoiceNo(type='ENERGY'|'OA', client, month)` → returns `SJVN/{type}/{CLIENT}/{YYYYMM}/{SEQ}` and increments counter
  - Update `trading_invoices` route to call new generator
  - Backfill existing invoices with properly formatted numbers (or keep old ones, new ones only use format)
- **Time:** ⏱️ 1.5 hours
- **Priority:** 🎯 HIGH — audit-critical, immediately visible
- **Files:** `backend/src/util.js`, `backend/src/routes/tradingInvoices.js`, schema.sql

---

### 8. **Build TDS Ledger Register + Vendor Payment Tracker**
- **Problem:** Ledger has TDS entries per vendor (CTUIL, GRID-INDIA, STU, SLDC), challan tracking is manual. Platform: no TDS record at all.
- **Work:**
  - New table: `tds_ledger` (id, invoice_id, vendor_name, vendor_pan, tds_rate, amount, deducted_by_sjvn, deducted_date, challan_no, challan_date, paid_to_govt_date)
  - API POST /tds/record: record TDS deduction
  - API GET /tds/pending: SUM(amount) WHERE challan_no IS NULL (what needs to be paid)
  - View: TDS register by vendor, by month (Form 26Q pre-fill data)
- **Time:** ⏱️ 1 hour
- **Priority:** 🎯 HIGH — compliance + cash tracking
- **Files:** New `backend/src/routes/tdsLedger.js`, schema.sql

---

### 9. **Add OA Charge Breakdown + Settlement Mode (Seller-bears vs Buyer-bears)**
- **Problem:** Current: OA charges are lump sum. Real: charges are split by ISTS (flex), STU (per state), App Fee, and bearer can be seller or buyer per contract.
- **Work:**
  - Add to `bilateral_transactions`: `oa_ists_bearer`, `oa_stu_bearer` (ENUM 'SELLER'|'BUYER'|'SPLIT')
  - New table: `oa_charge_line_items` (bilateral_id, charge_type, state, rate, quantum, amount, bearer)
  - Calculation: on billing, lookup effective rate, multiply, allocate by bearer
  - Example: WB STU ₹238.4/MWh × 200 MWh = ₹47,680 (if buyer-bears, add to buyer invoice)
- **Time:** ⏱️ 1.5 hours
- **Priority:** 🎯 MEDIUM — affects invoice totals
- **Files:** `backend/src/db/schema.sql`, `backend/src/routes/bilateral.js`

---

## PHASE 4: DATA IMPORT & REAL-WORLD DATA (2–3 hours)

### 10. **Build Power Trading Ledger Importer**
- **Problem:** 439 real bilateral transactions sitting in Excel. Platform empty. Can import instantly.
- **Work:**
  - New endpoint: POST /import/trading-ledger (multipart form, XLSX file)
  - Parser:
    - `Application_Ledger` → bilateral_transactions (ref_no as transaction_id, noar_status_timeline entry, effective rates from ledger)
    - `Daily Schedule` → bilateral_schedules (date, actual_mw, deviation detection)
    - `Bills issued by SJVN` → trading_invoices (SJVN/ENERGY/* numbers)
    - `Bills received` → vendor invoices (payable register)
    - `May TDS 2026` / `April TDS 2026` → tds_ledger entries
    - `ENERGY PAYMENT` → extract purchase/sale rates per day
  - Validation: skip `pass` sheet (has credentials)
  - Output: import report (rows processed, errors, warnings)
- **Time:** ⏱️ 2 hours
- **Priority:** 🎯 HIGH — immediate demo with real data
- **Files:** New `backend/src/routes/imports.js`, reuse cercScraper patterns
- **Data Volume:** 439 applications, 84 energy settlement rows, 16 invoices

---

### 11. **Seed Rate Master + Party Master from Ledger**
- **Problem:** Rate master and entity aliases empty until manually entered. Ledger has all real data.
- **Work:**
  - Before/during importer: extract rates (ISTS ₹359–509, STU ₹238–382, NOAR ₹5000, etc.) → rate_master
  - Extract 9 buyers (GACL, Electrotherm, HPSEB, etc.) + 1 seller (NTPCREL) + 10+ agency entities (CTUIL, GRID-INDIA, SLDCs) → entities
  - Map 4 GACL spellings to one canonical entity via aliases
  - Assign PAN numbers from TDS sheet
- **Time:** ⏱️ 45 min (if #10 importer already built)
- **Priority:** 🎯 MEDIUM — makes importer fully functional
- **Files:** Script in imports.js, seed logic

---

## PHASE 5: RECONCILIATION & REPORTING (Ongoing)

### 12. **Build Deviation Alert Register**
- **Problem:** Ledger shows seller (NVVN) deviates regularly (up to 634 MWh shortfall). Platform tracks deviation_mw in schedules, but no summary view.
- **Work:**
  - Query: GROUP BY transaction_id, SUM(deviation_mw), AVG, MAX, FREQUENCY
  - Alert rule: if counterparty deviation > 5% of scheduled, flag for SLA review
  - Seller scorecard: reliability = (scheduled - total_deviation) / scheduled
  - API: GET /seller/:id/reliability (show trend, incidents)
- **Time:** ⏱️ 45 min
- **Priority:** 🎯 MEDIUM — operational intelligence
- **Files:** New view/API in `backend/src/routes/sellerDashboard.js`

---

### 13. **Build Payment Cycle Dashboard (Payable vs Receivable)**
- **Problem:** Two independent cycles: (1) SJVN pays seller within 1 day (outflow), (2) buyer pays SJVN (inflow). Net cash position opaque.
- **Work:**
  - New dashboard widget:
    - **Inflow:** sum(trading_invoices.total_amount WHERE status='SENT' OR 'PAID') by due_date
    - **Outflow:** sum(vendor_invoices.amount) by due_date (link to seller)
    - **Float:** cumulative (inflow - outflow) by date
    - Chart: daily cash position forecast
  - Highlight: any inflow due > 3 days late
- **Time:** ⏱️ 1 hour (query + frontend chart)
- **Priority:** 🎯 MEDIUM — CFO view
- **Files:** New route endpoint, frontend component (React)

---

### 14. **Build Contract-wise P&L Report**
- **Problem:** No visibility into which contracts are profitable after OA charges, TDS, deviations.
- **Work:**
  - Query: per bilateral_transaction:
    - Revenue = SUM(schedule × sale_rate)
    - COGS = SUM(schedule × purchase_rate)
    - Gross Margin = sum(schedule × 0.03) + sum(OA charges SJVN bears) + sum(TDS float) + DSM penalties
    - Net P&L = Gross Margin - admin overhead
  - Group by: seller, buyer, month, product (renewable vs conventional)
  - Export: CSV for FY P&L roll-up
- **Time:** ⏱️ 1.5 hours
- **Priority:** 🎯 MEDIUM — business intelligence
- **Files:** New `backend/src/routes/tradingReports.js` or extend existing

---

### 15. **Build Application Number Auto-Generator (NOAR Format)**
- **Problem:** Application numbers are manual (SJVN + DDMMYY + WR + serial). Can auto-generate.
- **Work:**
  - On new bilateral creation: derive DDMMYY from start_date, look up next serial for that date
  - Format: SJVN + DDMMYY + WR + SEQ (e.g., SJVN010426WR2354)
  - Store in `bilateral_transactions.application_no`
  - Approval number format: WR/YYYY/SEQ/C/R/0 (already visible in ledger, derive from noar_contract_no)
- **Time:** ⏱️ 30 min
- **Priority:** 🎯 LOW — nice-to-have, manual entry works
- **Files:** `backend/src/routes/bilateral.js`

---

## QUICK REFERENCE: DEPENDENCY CHAIN

```
1 (DSM fix) → independent
2 (gitignore) → independent
3 (TDS column) ← needed by #8
4 (tariff split) ← foundation for margin validation
5 (rate master) ← needed by #9
6 (party aliases) ← needed by #10, #11
7 (invoice number) ← needed by #10
8 (TDS ledger) ← needs #3
9 (OA charges) ← needs #5
10 (ledger importer) ← needs #6, #7, #4, (opt #8, #9)
11 (seed from ledger) ← needs #10
12 (deviation alerts) ← needs data from #10
13 (payment dashboard) ← needs #10
14 (P&L report) ← needs #10, #4, #5, #8, #9
15 (app no generator) ← independent (nice-to-have)
```

---

## SUGGESTED SPRINT ORDER

**Day 1 (Today):**
- ✅ #1 — DSM/REC fix (20 min)
- ✅ #2 — gitignore cleanup (10 min)
- ✅ #3 — TDS column (30 min)
- ✅ #4 — Tariff split (45 min)

**Day 1–2:**
- ✅ #5 — Rate master (1 hr)
- ✅ #6 — Party aliases (45 min)
- ✅ #7 — Invoice numbering (1.5 hr)

**Day 2–3:**
- ✅ #10 — Ledger importer (2 hr) ← **BIG WIN: 439 real txns loaded**
- ✅ #11 — Seed from ledger (45 min)

**Day 3–4 (Polish):**
- ✅ #8 — TDS ledger (1 hr)
- ✅ #9 — OA charges (1.5 hr)
- ✅ #12 — Deviation alerts (45 min)
- ✅ #13 — Payment dashboard (1 hr)

**Follow-up (Week 2):**
- #14 — P&L report
- #15 — App number generator

---

## Success Metrics After Completion

- ✅ CERC data clean (DSM rates pre-2025 fixed)
- ✅ Platform loads 439 real bilateral transactions
- ✅ Invoices numbered in SJVN format with persistent counters
- ✅ TDS tracked per vendor with challan status
- ✅ Margin validation on every transaction (must be ±0.03)
- ✅ Rate master supports date ranges (not hardcoded)
- ✅ OA charges breakdown by state and bearer
- ✅ Cash flow forecast visible (receivables vs payables)
- ✅ Contract profitability visible (P&L per bilateral)

---

**Start with #1 + #2 + #3 today (1 hour total). Then #4 + #5 + #6 + #7 (4.5 hr). Then hit #10 for the big demo.**
