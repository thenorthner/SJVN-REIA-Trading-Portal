# Decisions on the REIA QA open questions — 17 Oct 2026

The run-1 reports (`docs/qa-prompts/reia-*-run-1-report.md`) ended with "Decisions for you" sections. On 17-Oct-2026 the instruction was to decide them on regulation, logic and industry practice, and implement. This file records each decision, its basis and where it lives in the code.

**Status:** implemented on the working tree (not committed). Backend: 2,529 tests pass, including the new `tests/reia/s60-decisions-2026-10-17.test.js`. Frontend: it builds, and the same 18 tests in 4 files fail as before.

**Real-database data changes are not made.** They are listed at the end and wait for a go-ahead.

Changed master defaults are moved once, and only where the parameter still holds the old default (`migrateDecisions20261017` in `backend/src/db/index.js`).

## Billing & Invoicing (reia-10)

| # | Question | Decision | Basis |
|---|---|---|---|
| 1 | Who signs which level | **Enforce roles per level** (L1 REIA, L2 Finance, L3 Management/Admin). This was already in place. A different person at each level is now **on by default** (`invoice_approval_distinct_approvers` = 1). | Delegation of powers and the four-eyes principle. |
| 2 | Double margin on INV-PSA/2026/000001 | Credit note of ₹5,72,880 to the DISCOM. | **Real DB: waits for go-ahead.** |
| 3 | GST on trading margin | **No GST.** `gst_rate_percent` stays 0. | Electricity is exempt goods (HSN 2716). A trader sells electricity at the PSA tariff, and the margin is part of that price, not a separate service. Finance can switch it on if a tax opinion says otherwise. |
| 4 | 45 working or calendar days | **Calendar days**, rolled forward to the next working day if the due date is a holiday. Surcharge is also counted on calendar days. | The LPS Rules 2022 and most PSAs count calendar days. |
| 5 | CUF penalty uncapped, full tariff | Assessed **yearly** (already decided). It is now priced at the **PPA's own compensation %** (new field `cuf_shortfall_comp_pct`), falling back to the master factor. | SECI RfS uses 50% of tariff; some state PPAs use 25%. The contract decides, not a platform default. |
| 6 | Rebate for buyers | **Only where the PSA itself grants one** (`rebate_pct` on the PSA). SJVN's master tiers are never applied to buyers. | Back-to-back PSAs commonly mirror the PPA rebate, but only on terms the buyer actually signed. |
| 7 | Deemed generation on a PSA | Billed at the **pass-through (generator) rate, with no trading margin**. | The margin is earned on energy actually traded. |
| 8 | Admin bypass of the "seller bill disagrees" check | **Bypass removed.** Admins waive with a reason, like everyone else. | Audit trail. |
| 9 | October 2026 (current month) locked energy and bills | Clean-up. | **Real DB: waits for go-ahead.** |

## Dispute Management (reia-11)

| # | Decision | Basis |
|---|---|---|
| 1 | An amount **contested at a forum stays held** until the forum decides. If SJVN wins, surcharge runs from the original due date. | Standard dispute clause: the undisputed amount is payable, the disputed amount waits. |
| 2 | The invoice now returns `settlement` (cash vs credit notes) with a label such as "Paid (part by credit note)", and the screen shows the split. | Clarity for Finance. |
| 3 | **No auto-acknowledge.** A dispute starts as RAISED. Acknowledge is a desk button, and the first desk action (review, info request, resolve) also counts as acknowledgement, in that officer's name. | The 2-day acknowledge SLA must be measured against a person. |
| 4 | Old rewritten bills and negative supplementary bills are **left as history**. | Booked history is not rewritten. |
| 5 | **Reason codes stay** as they are (`ENERGY_DATA_MISMATCH`, `TARIFF_RATE_ERROR`). | Renaming would break existing data and reports. |

## Payment Security (reia-12)

| # | Decision | Basis |
|---|---|---|
| 1 | Release while the contract is live is refused unless the cover left still meets the requirement, or it is a **PBG after full COD**. | Security runs for the life of the contract. SECI returns the PBG after commissioning. |
| 2 | Adequacy is measured against **max(required, exposure)**, e.g. 1.1 months of LC. | The contract's own requirement is the floor. |
| 3 | Funds stay **per contract**, drawn last. The "pooled" wording is corrected. | SJVN runs no portfolio-wide PSF today. |
| 4 | The bid gate is **not loosened**. Only **Management or Admin** can give an override, with a reason of at least 15 characters, for **at most 90 days**. | The desk that wants the bid is not the one that waives the cover behind it. |
| 5 | A seller's draw on SJVN's LC is an **event** (date, bank reference, bill), and so is a revolving LC's reinstatement. The amount drawn can no longer be typed in on amendment. | Audit trail. |

## Deviation Settlement — DSM (reia-13)

| # | Decision | Basis |
|---|---|---|
| 1 | DSM bills go in a **series of their own, `DSM-POOL`**, settled with the NRPC pool. They are never shown to the contract's seller or buyer. Finance books them in a new **POOL** category. | The money moves with the regional pool, not the developer. |
| 2 | **No negative bills.** A recoverable week is a receivable; a payable week, or a revision that lowers the figure, is a payable. The amount is always positive. | Billing never issues negative bills. |
| 3 | The due date is **the one printed on the NRPC statement**, else bill date + `dsm_pool_payment_days` (10). | NRPC sets the pool's due date. |
| 4 | A week **never billed and more than 3 years old is not raised** (`dsm_bill_age_limit_days` = 1095). Revisions of weeks already billed are still settled. | Limitation Act: 3 years for a money claim. |
| 5 | The **`/submit` step is removed**. A week is raised from CALCULATED and the bill goes through approval. | Dead step. |

## Payment Monitoring (reia-14)

| # | Decision | Basis |
|---|---|---|
| 1 | **Only Finance** (`FINANCE_USER`) confirms a bank credit or records a receipt. | Segregation of duties. |
| 2 | Sending a bill already sets its due date. The three PSA bills sent with no due date need a data fix. | **Real DB: waits for go-ahead.** |
| 3 | The "more than the bill has left" flag is judged **against the bill alone**. | Other intimations still in the queue no longer flag a correct one. |
| 4 | New **advances / unapplied receipts ledger** (`unapplied_receipts`, `/api/advances`, page *REIA › Advances & Unapplied Receipts*). An excess payment can be confirmed with the excess held as the buyer's advance. Finance applies it to a later bill or refunds it. | Money is never refused or lost. |

## Reconciliation (reia-15)

| # | Decision | Basis |
|---|---|---|
| 1 | The 10 empty September statements. | **Real DB: waits for go-ahead.** |
| 2 | Above **₹1 crore billed** (`recon_finance_signoff_above`), **Finance concurs** before the desk signs for SJVN. | Value-based delegation of powers. |
| 3 | Accepting a counterparty's exception **drafts the credit or debit note** automatically, for Finance to approve. | An agreement should change the books. |
| 4 | A dispute raised from a reconciliation line goes through the normal dispute path: line cap, presented-bill rule and **dispute window**. It is recorded as raised by the SJVN officer. | No side door around the dispute rules. |
| 5 | An unpaid bill **not yet due** is left out of the billed-vs-paid exception, and the note says so. | It is not an exception yet. |

## Verification Queue (reia-16)

| # | Decision |
|---|---|
| 2 | Monthly CUF is a running indicator; the penalty is assessed yearly (as decided earlier). |
| 3 | **The verifier cannot approve L1** of the same bill (tracked by user id). |
| 4 | **A developer cannot enter a penalty** on its own bill. The manual form and the sheet upload refuse it, the column is gone from the seller template, and a desk-entered penalty is subtracted. |
| 5 | The seller can read its checklist through the API. A seller screen for it is not built yet; it is listed under follow-up below. |

## Generation Performance (reia-17)

| # | Decision | Basis |
|---|---|---|
| 2 | CUF is **worked out from the energy**. The meter's rounded figure is used only when there is no energy figure. | A rounded figure moved money by thousands of rupees. |
| 3 | An **RE PPA cannot go ACTIVE without its own minimum CUF**. | The true-up is priced on it. |
| 4 | **Deemed generation counts toward CUF.** | SECI-model PPAs do not penalise generation the grid refused (curtailment, backing down, unavailability). |

## Contract Compliance (reia-18)

| # | Decision |
|---|---|
| 1 | New flag `entities.is_sjvn_own`, set for **SEL-NJHPS and SEL-RHPS**. Developer KYC and approval checks do not apply to them. |
| 2 | The requirement counts **only the paying side's instruments**: the buyer's LC and funds on a PSA, the seller's guarantees on a PPA. |
| 3 | A contract **stays SIGNED until its start date**; activating earlier is refused. Amendments are not affected. |

## CERC Compliance (reia-19)

| # | Decision |
|---|---|
| 2 | History is **marked as filed outside the platform**, with CERC's acknowledgement number and date (`POST /api/form-iv/mark-filed-outside`, plus a button on the Form-IV page). |
| 3 | A **late surcharge of 1.25% a month** (`cerc_fee_late_surcharge_pct_month`) is worked out on a licence fee paid after 30 April, and the amount paid is recorded on the year. |
| 4 | The ₹40 L fee and ₹50 Cr net worth defaults are **left unchanged and still unconfirmed**. I could not verify the figures in the 2020 Trading Licence Regulations or the fee notification. Compliance to check them against the gazette text. |

## Secondary Market / Banking (reia-20)

| # | Decision |
|---|---|
| 1 | A diversion **deficit is drafted as a debit note** on the PSA ("Bill the deficit" button), under PSA Art. 6.6. |
| 2 | A **surplus beyond the dues becomes the buyer's advance**. It is no longer kept by SJVN unrecorded. |
| 5 | The banking cycle is **fixed by a basis, not typed**: MONTHLY (default, per the GEOA Rules 2022), SEASONAL or ANNUAL. It is set per PPA (`banking_cycle_basis`) or by the master. |

## Stakeholder Onboarding (reia-21)

| # | Decision |
|---|---|
| 1 | A seller or buyer login can put forward a new company **only as its own group company (SPV)**, of the same kind. It is linked to the requester and waits for the desk. |
| 2 | **Direct admission needs Company Registration and Bank Account Proof verified** first. |
| 3 | Read-only check of the real DB: **no** mandatory clearances are marked NOT_APPLICABLE. |

## Ledgers & Finance Posting (reia-22)

| # | Decision |
|---|---|
| 1 | Adani seed bill INV-ADANI/2026/00101. **Real DB: waits for go-ahead.** |
| 2 | **POOL** posting category for DSM bills (see DSM above). |
| 3 | Banking bills are **left as they are**: booked in the month of the draw or settlement, when the energy actually changes hands. |

## Golden run

- **PSPCL under-secured (₹4 L LC against a ₹2.36 Cr bill):** billing is **not blocked**, because stopping a bill only delays SJVN's own money. The levers are the stricter adequacy rule, the Management-only override, and the existing security acknowledgement at approval.

## Real-database items waiting for a go-ahead

Found read-only on 17-Oct-2026:

1. **INV-PSA/2026/000001** (PAID, ₹2,47,15,680): credit note of ₹5,72,880 for the double margin.
2. **October 2026 LOCKED energy** (PPA/REIA/SOLAR/001, PSA/REIA/DISCOM/001, PPA/REIA/SOLAR/250MW-001) and the bills raised on it: SELLER-INV/2026/000005, INV-PPA/2026/000005, INV-PSA/2026/000001.
3. **INV-PSA/PSPCL/2026/001, INV-PSA/HPPC/2026/001, INV-PSA/NDMC/2026/001**: sent with no due date. Set the due date from the send date and contract terms.
4. **10 PENDING_SIGN_OFF September statements** (RCN/2026/00002, 00003, 00054–00061): regenerate the ones that now have data and cancel the rest.
5. **INV-ADANI/2026/00101** (APPROVED, ₹11.985 Cr, seed data): cancel, or reverse by credit note as was done on QA.

The real DB also has 3,672 foreign-key mismatches. These existed before this work; the migration was run on a copy and added none.

## Not built — follow-up

- A seller screen showing why SJVN is holding the bill (16.5); the API already returns it.
- A switch on the entity screen to mark a station as SJVN's own (the flag is set for NJHPS and RHPS by migration).
