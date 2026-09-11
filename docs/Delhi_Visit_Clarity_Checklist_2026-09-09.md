# Delhi Visit — REIA + Power Trading Clarity Checklist

**For:** Manager's Delhi visit
**Date prepared:** 2026-09-09
**Purpose:** In-house dev ne jo modules bana diye hain (REIA hydro billing/dashboard, Power Trading settlement/billing, disputes, reconciliation, masters), unme kai jagah **assumption laga ke aage badha gaya hai** kyunki committee se koi confirmed answer nahi mila. Ye doc un sab open points ko ek jagah list karta hai taaki Delhi meeting mein point-by-point clarity li ja sake.

Reference: `docs/CP-53-57 REIA Workflow.pdf`, `docs/CP - 58-61 REIA Dashboard.pdf`, `docs/CP -83-85 Power Trading Work flow.pdf`, `docs/CP - 86 Power Tradig Dashboard.pdf`, `docs/CP -62-82 PSA & PPA BILLING AND SCHEDULING.pdf`, `docs/CP -11-43 Final Scope by Committee.pdf`.

---

## A. REIA (Hydro Billing / Dashboard)

1. **Billing formula sign-off** — station-wise hydro bill calculation (energy charge, capacity charge, incentive/disincentive) jo committee ne scope doc mein diya tha, kya usi final version par implementation hui hai, ya koi revision hui hai jo humein nahi mili?
2. **Which stations are in scope** — REIA dashboard sab hydro stations dikhayega ya sirf ek subset? Naye station add hone par process kya hoga (masters mein manually add, ya koi feed/API se)?
3. **Approval workflow** — REIA bill draft → verify → approve chain mein kaun-kaun se roles/designations honge, aur kya ye SJVN ke existing ERP approval hierarchy se match karna zaroori hai?
4. **Data source of truth** — actual generation/energy data REIA billing ke liye kahan se aayega — SCADA feed, manual entry, ya koi third-party (SLDC/RLDC) file upload? Abhi manual/import-based flow bana hai (`backend/src/routes/imports.js`, `backend/src/routes/energyData.js`) — ye confirm karna hai ki yehi final source hai.
5. **Dashboard KPIs** — "CP-58-61 REIA Dashboard" scope mein jo metrics/charts list the, unme se kaun se already-built dashboard (`frontend/src/pages/reia/HydroBilling.jsx`) mein cover ho chuke hain vs kaun reh gaye — ek walkthrough/demo dikha ke confirm karna better rahega.
6. **Statutory formats** — REIA billing invoice format kya SJVN ke standard GST invoice format se match karna hai, ya koi separate regulator-prescribed format hai?

## B. Power Trading (PT) — Settlement, Billing, Scheduling

1. **PSA vs PPA distinction** — dono contract types (Power Sale Agreement / Power Purchase Agreement) ke liye billing/settlement rules alag hain ya same engine reuse ho sakta hai? Scope doc "CP-62-82 PSA & PPA Billing and Scheduling" ke against current implementation confirm karna hai.
7. **Exchange data authority** — IEX aur PXIL dono se data aa raha hai (Front Office API, member reports). Jab dono sources ke numbers mismatch karein (e.g. trade margin, DOR), kaunsa source authoritative maana jaaye?
8. **DSM (Deviation Settlement Mechanism) frequency slabs** — jo slabs implement kiye gaye hain (`docs/WORKLOG_2026-08-25_DSM_Frequency_Slabs.md`), unka latest CERC/regulatory version se match hai ya committee ne koi SJVN-specific variation di thi?
9. **Reconciliation tolerance** — trading ledger reconciliation mein jo mismatch/tolerance thresholds hardcoded hain (`backend/src/reconciliationConstants.js`), inhe committee-approved values maana jaaye ya finance team se separately confirm karna hoga?
10. **Dispute workflow ownership** — disputes module (`backend/src/disputesConstants.js`) mein jo states/categories bane hain, kya wahi categories real-world PT disputes (short-cover, non-delivery, price dispute etc.) cover karte hain? Ek real example dispute walk-through karke confirm karna chahiye.
11. **Payment security instruments** — LC/BG/security deposit ka jo fund/cover logic bana hai (`backend/src/paymentSecurityConstants.js`), kya wo SJVN ke treasury/finance policy se match karta hai, ya koi additional rule (e.g. per-buyer cap, blanket cover) missing hai?
12. **NOAR approval SLA** — NOAR (No Objection / Approval Request?) ke liye jo SLA warning threshold (70%) set hai, kya ye committee-approved number hai ya default guess hai?

## C. Cross-cutting / Integration

13. **PXIL API access** — Staging vs production URL, IP whitelisting, auth mechanism (Bearer vs query token) abhi tak PXIL se unconfirmed hain (`docs/PXIL_API_Clarifications_Email_Draft.md`). Delhi visit mein agar PXIL/committee contact available ho to in-person confirm karna fast track kar dega.
14. **IEX Front Office scope** — jo IEX client bana hai (REC/EC segments), kya sabhi segments (DAM, RTM, TAM, GDAM etc.) scope mein hain ya sirf kuch specific segments chahiye?
15. **Single sign-off on "Final Scope by Committee"** — `docs/CP -11-43 Final Scope by Committee.pdf` ke 3 alag copies hain (naming se lagta hai revisions hain) — konsi latest/final maani jaaye, aur kya usme koi item drop/add hua hai jo dev ko update nahi mila?
16. **User roles & access control** — abhi jo auth/role structure hai (`backend/src/middleware/auth.js`), kya wo SJVN ke actual org hierarchy (trading desk, finance, REIA team, approvers) ke roles se match karta hai — designations confirm karne honge.
17. **Go-live / cutover data** — jab system live hoga, historical data (past bills, past trades) migrate karna hai ya sirf date-X se aage ka fresh data chalega?
18. **Statutory/audit trail requirement** — audit logging jo implement hui hai, kya wo SJVN ke internal audit / CERC compliance requirement ke liye sufficient hai, ya koi specific format/retention period mandate hai?

---

### Kaise use karein
Har point ke against Delhi meeting mein jo answer mile, wahi is doc mein ya ek naye WORKLOG note mein likh dena — taaki agla dev/committee-follow-up isi se continue kar sake.
