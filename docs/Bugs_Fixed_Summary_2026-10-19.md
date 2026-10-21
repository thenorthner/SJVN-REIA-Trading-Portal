# SJVN Energy Platform – Summary of Bug Fixes & System Hardening
**Period:** 15 – 19 October 2026  
**Status:** Successfully Resolved & Tested (Production-Ready)  
**Target Desks:** Hydro Desk, Thermal Desk, REIA Desk, Finance (FI), Ledger & KYC  

---

### Executive Summary

Over the last 3–4 days, comprehensive end-to-end QA audits and stress testing were conducted across all operational desks (**Hydro, Thermal, and REIA**). Over **25+ critical defects** were identified and resolved, eliminating major financial exposure risks, compliance violations, and data leakages.

#### Key Highlights & Financial Risks Mitigated:
* **Prevented False Advances & Surcharges:** Fixed an LPS issue charging 15 months of unaccrued surcharge (**₹93.9 Lakh**) and capped TDS deductions preventing erroneous **₹47 Crore** advance balances.
* **Eliminated Duplicate Accounting in Finance:** Resolved duplicate ledger entries for revised/final bills and introduced a dedicated `NOTES` posting category so approved credit/debit notes accurately reflect in sales figures.
* **Strict Maker-Checker Governance:** Closed loopholes where Admin or single roles could raise and approve their own bills, or cross-desk users (e.g. Buyer/REIA) could approve Hydro/Thermal invoices.
* **CERC Compliance Enforced:** Set CERC statutory rebate tiers (1% within 30 days) as the mandatory floor for all station contracts, preventing under-allowance of rebates.
* **Multi-Tenant Vertical Isolation:** Fully isolated DSM weeks, REA register, and KYC stakeholder management so each desk works strictly within its own vertical without data leakage.

---

### Module-Wise Detailed Breakdown of Bugs Fixed

#### 1. Hydro Desk – Billing, Arrears & Approvals (QA Runs 1 to 16)
* **Approval Chain Governance:**
  * Fixed role leakage where unauthorized roles (REIA officers, external buyers) could sign Hydro/Thermal invoices.
  * Enforced strict **Maker-Checker** rules across all roles (even SJVN Admin cannot self-approve; a user cannot sign twice at consecutive levels).
* **Allocation Sheet Overlap:**
  * Fixed an issue where submitting a new allocation sheet left previous sheets open, causing overlapping active sheets and locking the month's bill generation.
  * Added validation for unique beneficiary per sheet, 100% total share validation, and single home-state rule.
* **Arrear Bill Compounding Error:**
  * Fixed a bug where a 2nd arrear on a month recalculated against the base bill without subtracting previously issued arrears, duplicating capacity and energy charges across all 15 line items.
* **Supplementary & PTC Billing:**
  * Blocked supplementary bills from being created for future or unbilled months.
  * Removed PTC trades from single-bill monthly constraints while adding overlap prevention to ensure clean multi-trade billing per month.
* **Credit & Debit Note Limits:**
  * Added validation ensuring credit notes cannot exceed the balance owed on the target bill (prevented an actual scenario that generated a ₹58.8 Lakh false advance).
  * Prevented issuing notes on bills that have already been paid in full or dated with future dates.

---

#### 2. Payments, LPS, TDS & Receivables
* **Late Payment Surcharge (LPS) Accrual:**
  * Restricted LPS postings strictly up to the current date (IST). Previously, future `as_of` dates allowed posting up to 15 months of unaccrued surcharge (₹93.9 Lakh).
* **TDS Over-Deduction & Register Reversal:**
  * Capped TDS entry to the maximum amount owed by a beneficiary on that station (prevented cases where ₹50 Cr TDS was accepted against a ₹2.94 Cr bill).
  * Reversing a TDS credit on the ledger now correctly updates the tax register to `REVERSED` rather than leaving it in `PENDING_CERTIFICATE`.
* **CERC Rebate Tier Floor:**
  * Fixed station contracts where a 5-day custom rebate term suppressed the statutory 1% CERC rebate on days 6–30. CERC tiers now serve as the mandatory legal floor.
* **Payment Security (LC / BG) Protection:**
  * Prohibited release of active LC/BGs when a beneficiary has overdue outstanding payments (e.g., prevented releasing an LC for Haryana with ₹9.85 Cr overdue).
  * Validated invocation and amendment dates against real calendar days within instrument validity.

---

#### 3. Finance (FI) Integration & General Ledger
* **Bill Revisions Handover:**
  * Fixed double-counting where revised or final bills were booked in Finance at their full gross amount. They are now booked strictly at the incremental difference charged by the ledger.
* **Credit & Debit Notes Handover (`NOTES` Category):**
  * Created a dedicated `NOTES` FI category so approved credit notes (negative sales) and debit notes (positive sales) accurately pass to Finance instead of leaving revenue overstated.
* **Voucher Integrity & Late Bills:**
  * Made voucher numbers mandatory and enforced uniqueness.
  * Added support for posting subsequent late-issued bills for a month that had already been partially posted.

---

#### 4. Thermal Desk – Norms, Tariffs & Calculations (QA Runs 1 to 6)
* **Realistic Coal Station Parameters:**
  * Enforced physical and contractual boundaries: PAFM (0–100%), Scheduled Energy within station capacity $\times$ hours of month, GCV (2,000–7,500 kCal/kg), coal and oil price validation.
* **CVPF & Storage Loss Norms:**
  * Integrated CERC normative storage loss (85 kCal/kg) deduction from received GCV for CVPF calculations in both billing and preview.
* **Resilient Arrear Processing:**
  * Prevented entire arrear runs from aborting if a single historical month could not be rebuilt; the engine now skips that month with a documented audit reason.
  * Restored Thermal AFC calculations in arrear bills (which previously defaulted to 0).
* **Vertical Supplementary Reasons:**
  * Separated vertical supplementary charge reasons: Part-Load Compensation (IEGC) and Fuel Cost Adjustment for Thermal; Beta factor exclusively for Hydro.

---

#### 5. Cross-Desk Multi-Tenancy, KYC & Dashboards
* **KYC & Stakeholder Data Scoping:**
  * Restricted each desk (Hydro, Thermal, REIA) to reviewing, verifying, and editing stakeholders belonging strictly to their own vertical.
* **DSM & REA Access Control:**
  * Fixed cross-vertical edits where Hydro/Thermal officers could edit or delete solar plant DSM weeks.
  * Resolved 403 Forbidden errors when station desks accessed their respective REA station energy records.
* **Live Books Dashboard:**
  * Rebuilt the Hydro and Thermal dashboards to compute directly from live ledger entries, payment clearings, and issued bills, completely removing placeholder data and mock station entries.

---

#### 6. REIA Billing & Settlement (September Golden Run Fixes)
* **PSA Reconciliation:** Updated PSA reconciliations to automatically mark as `FINAL` once all underlying source PPA bills are finalized (previously remained stuck as `PROVISIONAL`).
* **Readiness Board & Duplicate Bills:** Developer invoices are now recognized as valid PPA bills on the readiness board, preventing "Generate All" from duplicating computed bills.
* **Intimations & Outstandings:** Adjusted counterparty views so "Received" excludes credit notes and "Outstanding" accurately reflects allowable rebates.
* **Data Cleanup of Premature Bills:** Successfully reversed prematurely generated October bills (PSPCL, HPPC, NDMC) via full credit notes, releasing energy for correct month-end REA billing.

---

### Summary Table for Management

| Module / Area | Nature of Bugs Fixed | Business & Financial Impact |
| :--- | :--- | :--- |
| **Hydro Billing** | Allocation overlap, arrear compounding, note limits | Prevents duplicate billing lines and false credit advances (₹58.8L+). |
| **Thermal Desk** | Coal norms, CVPF storage loss, arrear AFC | Ensures compliance with CERC thermal tariff regulations. |
| **Payments & LPS** | Future LPS calculation, TDS caps, duplicate UTR | Prevents ₹93.9L unaccrued surcharge and ₹47Cr false TDS advances. |
| **Finance (FI)** | Double-booking of revisions, missing credit notes | Accurate revenue reporting; sales no longer overstated. |
| **Security (LC/BG)** | Premature release with outstanding dues | Secures SJVN cash flow; blocked releasing ₹9.85 Cr cover with dues. |
| **Maker-Checker** | Self-approval by Admin, cross-desk signoffs | Full audit compliance; no single user can approve own bills. |
| **Multi-Tenancy** | Cross-vertical DSM and KYC data leakage | Strict data segregation between Hydro, Thermal, and Solar/REIA. |

---
**Verification & Stability:** All unit, integration, and regression suites are green. System is hardened and ready for live commercial operations.
