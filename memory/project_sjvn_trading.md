---
name: sjvn_trading_platform_context
description: SJVN Power Trading Platform — real data structure, schema gaps, and verified business rules from ledger
metadata:
  type: project
---

## What this project is

SJVN Ltd is running a power trading desk (ISET — Internal SJVN Energy Trading). The platform tracks:
- **Bilateral open-access transactions** (seller ↔ buyer via SJVN intermediary)
- **Real transaction data** from April–July 2026 (439 applications, ₹40M+ settlement)
- **Multi-leg settlement:** energy price → OA charges (ISTS, STU, RLDC, SLDC, application fee) → TDS (194Q on energy, 194C on charges)
- **CERC monthly market data ingestion** (DAM/GDAM/RTM prices, DSM, REC, volumes) for market intelligence dashboard

Current state: Schema mostly complete, feature coverage ~60%. **Major gap: no real trading workflow data yet** — running on demo/test transactions. Power Trading Ledger Excel (439 rows + 16 sheets) is the single source of truth for operational workflow and rate structures.

---

## Verified Business Rules (from FY 2026-27 Ledger)

### Trading Margin (Core Economic Rule)
- **Invariant:** Sale Rate - Purchase Rate = **exactly ₹0.030/kWh**, 100% of the time (76 energy settlement rows, zero exceptions)
- Purchase rate floats daily: ₹1.184–₹3.373 (linked to NTPC Renewable Energy tariff, market-linked)
- Sale rate = purchase + margin
- **Design implication:** `bilateral_transactions` needs separate `purchase_rate`, `sale_rate`, `trading_margin` columns; current single `tariff_per_unit` is wrong architecture

### ISTS Charges (Variable by Date & Route)
- Range: ₹359–₹509/MWh across the ledger
- Not a single hardcoded value
- **Need:** effective-dated rate master with start/end validity

### OA Charges (Multi-component, Bearer Rules)
- ISTS: variable (₹359–509/MWh, state pair dependent)
- STU: West Bengal ₹238.4/MWh, Delhi ₹382.54/MWh
- RLDC/SLDC: ₹1,000/day each
- NOAR Application Fee: ₹5,000 flat
- Bearer: in this ledger, ALL OA is buyer-borne (columns for seller are blank); but schema should support both
- **Ledger shows:** OA charges calculated per component, then summed

### TDS Deduction (Two Tax Rules)
- **194Q @ 0.1%** on gross energy invoice amount (not net of margin)
  - Example: Energy invoice ₹671,175 → TDS ₹671 (0.1%)
  - Applies to buyer payment of energy bill
- **194C/194J @ 10%** on ISTS/STU/RLDC/SLDC charges
  - Example: ISTS ₹80,568 → TDS ₹8,057 (10%)
  - Separate deduction per vendor/agency with PAN

### Party Master (Alias Hell)
- GACL appears as **4 spellings:** 
  1. `M/s. GUJARAT ALKALIES ANDCHEMICALS LIMITED -13032` (no space, has ref no)
  2. `M/s Gujarat Alkalies & Chemicals Limited`
  3. `M/s. GUJARAT ALKALIES AND CHEMICALS LIMITED`
  4. `GACL NALCO Alkalies & Chemicals Pvt Ltd Cons.No.63869`
- **Same customer, 4 rows.** Excel handles it, database won't. Need alias resolution + canonical master.
- 9 buyers + 1 seller + 10+ agencies (CTUIL, GRID-INDIA, DTL, WB STU, RLDCs, SLDCs) in a single contract portfolio

### Invoice Numbering (Format is deterministic)
- Energy: `SJVN/ENERGY/KREATE/202605/144` (SJVN / type / client name / YYYYMM / running counter)
- OA: `SJVN/OA/KREATE/202605/263` (separate counter per type)
- Energy and OA invoices are issued monthly, counters are **per-client-per-month independent**

### Application Number (NOAR Format)
- Format: SJVN + DDMMYY + WR + running serial
  - Example: `SJVN010426WR2354` (01 Apr 2026, 2354th application)
  - Approval number: `WR/2026/41024/C/R/0` (year + serial + approval stage code)

### Seller Deviation Pattern
- NTPC Renewable (seller) deviates **regularly** (0–634 MWh shortfalls per day, especially June)
- Buyer (Kreate) deviation: always 0 (disciplined)
- **Implication:** platform needs seller reliability scoring; deviation penalties should be auto-tracked

### Payment Cycle (Two Independent Legs)
- **Inflow:** Buyer pays SJVN **next business day after scheduling** (so day 1 schedule → day 2 payment)
- **Outflow:** SJVN pays seller on their due date (1–3 days after invoice)
- Ledger tracks both separately; net cash position requires aggregation

---

## Data Quality Issues Found (During Import Planning)

1. **CERC Scraper bug (LIVE):** DSM and REC sheets matched by table number → wrong tables parsed for pre-2025-05 reports. DSM rates seeded as 1M+ for 2024-03 (garbage), null or wildly wrong for 2024-04/05. Fix: use sheet title text, not numbers.

2. **Excel formula rot:** OA Bills sheet has `#REF!` broken formulas (circular/deleted references). Importer must skip/warn.

3. **Date anomaly:** Daily Schedule has one row with date `27-04-2027` (should be 2026). Parse robustly.

4. **Monthly totals mixed in:** Schedules have "Monthly Total" rows interspersed with daily data. Parser must filter them out.

5. **Credentials in file:** `pass` sheet contains IEX participant ID and live portal credentials. **NEVER commit this file.** Currently `.gitignore` excludes `docs/*` except `.md` (good), but importer must skip this sheet explicitly.

---

## Schema Gaps vs Ledger Reality

| Ledger Concept | Platform Schema | Gap |
|---|---|---|
| Purchase rate + Sale rate | Only `tariff_per_unit` | Need to split into `purchase_rate`, `sale_rate`, validate margin invariant |
| Margin per unit (₹0.03) | Hardcoded in billingSettlement | Should be config field in transaction; part of contract |
| TDS 194Q vs 194C | Hardcoded `margin * 0.1` | Need `tds_applicable` enum, `tds_rate`, `tds_amount` columns; vendor PAN tracking |
| Effective-dated rates (ISTS varies) | Single static value in system_parameters | Need `rate_master` table with start/end dates |
| Party aliases (4 spellings of GACL) | No alias support; `entities.pan_no` field exists but unused | Need `entity_aliases` table; canonical resolution on import |
| OA charge breakdown (ISTS, STU, RLDC separately) | Lump sum in bilateral_transactions | Need `oa_charge_line_items` table; bearer selection per component |
| Invoice numbers (SJVN/ENERGY/CLIENT/YYYYMM/SEQ) | Random in genInvoiceNo() | Need persistent `invoice_counters` table; per-series per-month counters |
| Application numbers (SJVN + DDMMYY + WR + serial) | Not generated; manual field | Could be auto-derived from start_date + counter |
| Seller deviation tracking (reliability score) | Columns exist in bilateral_schedules but no rollup view | Need aggregation query + scorecard widget |
| Two-leg payment cycle (inflow vs outflow) | Separate tables but no unified cash forecast | Need combined dashboard view |

---

## What Worked Lately (Previous Commits)

- ✅ CERC scraper multi-year support (findSheet helper) — **good pattern, but table-matching logic is wrong**
- ✅ autoSeedLocalReports per-period check — changed from `COUNT > 0` to per-period lookup (correct fix)
- ✅ Schema design is solid (bilateral_transactions, schedules, noar_status_timeline, etc.) — just needs rate/TDS/invoice columns added
- ✅ CERC market data seeding works for post-2025-05 data (dates when correct sheets were parsed)

---

## Why the Ledger Matters Now

The ledger is the **business spec** that was locked in CERC/SJVN sign-off. Platform build happened in parallel with abstract schemas. Now that real data exists, we can:

1. **Validate architecture:** Does schema support actual workflows? (Answer: 70% yes, 30% gaps)
2. **Close gaps fast:** Rate master, TDS ledger, alias resolution — all derivable from 16 sheets
3. **Bootstrap with real data:** 439 transactions, ₹40M+ settlement → not a demo, a living system
4. **Measure success:** P&L per contract, cash position, seller reliability — all extractable

---

## Next Phase Strategy

**Immediate (this week):**
- Fix DSM scraper bug (impacts live data display)
- Add TDS + margin columns to schema
- Import ledger as-is into platform (439 txns)

**Then (next week):**
- Rate master + party aliases from ledger
- Real invoice numbering
- OA charge breakdown

**Why this order:**
1. Data quality fix (DSM)
2. Schema closes gaps (TDS, margin, rates)
3. Real data loads (ledger import)
4. Features light up (they work with real txns instead of demo)

If we go feature-first (P&L report, dashboards) before importing real data, they'll look pretty but measure nothing. Import data first, then reports show actual results.

---

## Key Contacts / References

- **Ledger source:** `docs/Power Trading Ledger FY 2026-27 (13).xlsx` (16 sheets, 439 applications)
  - Application_Ledger (noar workflow)
  - Daily Schedule (deviations, defaults)
  - Bills issued by SJVN (energy + OA invoices)
  - May/April TDS 2026 (real TDS entries + PANs)
  - ENERGY PAYMENT (margin verification, daily rates)
  - OA Bills (charge breakdown)
- **CERC data:** `backend/cerc_downloads/` (18 MB, 2024-03 to 2026-02, ~20 monthly reports)
- **Scraper:** `backend/src/services/cercScraper.js` (auto-seeds on startup)

---

## User Context (from session)

- Speaks Hindi + English mix (code, concepts in English; communication in Hinglish)
- Prefers conciseness and direct technical depth over preamble
- Reviews data systematically (parsed ledger yourself, traced CERC bug to exact line)
- Values "acha design" over quick patches (wants margin as config, not hardcoded)
- Builds fast but doesn't cut corners (asking for roadmap prioritization, not just "go code")
