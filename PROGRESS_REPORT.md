# SJVN REIA & Power Trading Platform — Progress Report

_Date: 25 Jul 2026_

This report summarises the work completed on the **Power Trading Dashboard** and, after
the SJVN–UPPCL PSA / REIA workflow documents were received, on the **REIA Commercial,
Billing & Settlement** module. All items below are implemented, verified end-to-end
(API + UI), and pushed to `main`.

---

## A. Power Trading Dashboard

| # | Feature | What it does |
|---|---------|--------------|
| 10 | **Exchange Price Dashboard** | Live snapshot cards for DAM / RTM / GDAM MCP + latest REC sale rate; time-block **MCP-vs-MCV** chart (price line + cleared-volume bars, dual axis). |
| 11 | **Format-D generation + NOAR contract lifecycle** | 15-min block-wise Format-D CSV export for bilateral open-access; NOAR portal status flow (Not Initiated → Format-D Prepared → Contract Created → Submitted → Approved) with contract-no tracking. Also fixed the previously-broken bilateral scheduling (missing DB tables). |
| 12 | **CERC Form-IV auto-populate** | Auto-derives the regulatory Form-IV line items from transaction data. |
| — | **Bilateral scheduling & DSM** | Multi-hop node approvals (Injection SLDC → RLDC → NLDC → Drawee SLDC), curtailment, actuals & DSM-penalty tracking. |
| — | **REC ledger & NOAR analytics** | REC sale/purchase ledger and trading analytics. |

**Deferred to Monday** (need external data / vendor API):
- #13 Power Market Dashboard (all-India stats)
- #14 Live exchange prices (IEX / PXIL API)

---

## B. REIA — Commercial, Billing & Settlement (grounded in PSA Article 6)

After receiving the SJVN–UPPCL PSA and REIA workflow documents, the following were built
to match the actual contract terms:

| # | Feature | Contract basis |
|---|---------|----------------|
| 1 | **Structured Invoice Verification Checklist** | Technical + Commercial verification points. |
| 2 | **Developer Invoice 6-stage pipeline** | Submitted → Under Verification → Commercial Verification → Finance Approval → Approved → Payment Released. |
| 3 | **Pay-when-paid payment release to generator** | Release tied to DISCOM realisation / own fund / payment-security fund. |
| 4 | **Debit / Credit Notes** | First-class adjustment documents (reversible against invoice totals). |
| 5 | **Supplementary-bill explicit triggers** | Change in Law, Revised REA, Transmission, LPS. |
| 6 | **PSA "Other Charges" pass-through** | Transmission / RLDC-SLDC / CTU-STU / open-access line items, correctly **excluded from rebate**. |
| 7 | **LPS payment-adjustment waterfall** | Payment applied to **LPS first**, then oldest bill (FIFO). |
| 8 | **Dispute exactness** | 15-day conclusive window; pay undisputed portion; refund with LPS-rate interest. |
| 9 | **Power diversion on buyer default** | PSA Art. 6.6 — divert power on non-payment. |

**Commercial parameters used** (per the PSA): rebate 1.5% @ 5 days / 1% @ 30 days,
due date 45 days, escalating LPS (SBI MCLR + 5% base, +0.5%/month, cap +3%),
LC = 110% of average monthly billing.

---

## Scope note

The platform is scoped to **REIA** (third-party solar / wind / hybrid / FDRE aggregation
under a back-to-back PPA ↔ PSA model with a trading margin) — **not** SJVN own-generation
(hydro AFC / DSM), which has been kept out of the active workflow.

**Status: Items 1–12 complete. 13–14 planned for Monday.**
