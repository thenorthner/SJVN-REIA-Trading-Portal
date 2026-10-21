# Hydro & Thermal parity with REIA — plan

Goal: every REIA Billing & Settlement screen that applies to a station desk exists on the Hydro and Thermal desks too, built on the station bills and beneficiary ledger (no separate data).

## REIA screen → station desk mapping

| REIA screen | Hydro / Thermal | Status |
|---|---|---|
| REIA Dashboard | Hydro / Thermal Dashboard | Exists; thermal rebuilt to hydro depth (wave 3) |
| Stakeholders & KYC Desk | Stakeholders & KYC Desk | Exists |
| Company Users | Beneficiary portal users | Wave 3, only if beneficiaries get portal logins |
| Contracts (PPA/PSA) | Beneficiary PPAs & Allocation register | **Done (wave 2)** |
| Compliance Desk | Regulatory Desk: petitions, true-ups, reviews, appeals, CERC fees, filings | **Done (wave 2)** |
| Energy Data & Validation | REA Register & Validation per station-month | **Done (wave 2)** |
| Billing & Invoicing | Monthly Bills & Approval | Exists |
| Month-Close Board | Month-Close Board | **Done (wave 1)** |
| Developer Release Planner | — | Not applicable: no developer to pay back-to-back |
| Notes for Approval | Approvals Inbox (bills, notes, FI postings) | **Done (wave 1)** |
| Invoice Verification | — | Not applicable: station desks issue bills, they do not receive them |
| Payment Monitoring | Payment Monitoring (Ageing) | Exists |
| Generation Performance | Generation Performance (PAFM vs NAPAF, energy vs design) | **Done (wave 1)**; thermal PLF / norms / fuel — done (wave 3) |
| Dispute Management | Dispute Management | Exists |
| Counterparty Ledgers & TDS | Account Display + TDS | Exists |
| Payment Security | Payment Security (LC / BG) | Exists |
| Power Diversion | Regulation of Power Supply register (LPS Rules 2022) | **Done (wave 3)** |
| Advances & Unapplied Receipts | Advances & Unapplied Receipts | **Done (wave 1)** |
| Energy Banking | — | Not applicable (RE banking) |
| Reconciliation | Reconciliation | Exists |
| Deviation Settlement (DSM) | Deviation Settlement (DSM) | Exists |
| — (hydro only) | Stations & Tariff page (thermal has one) | **Done (wave 3)** |

## Wave 1 — done 18-Oct-2026

- `backend/src/services/stationDesk.js` — month-close board, approvals queue, advances register, generation performance; read-only over existing tables.
- `/api/hydro-desk/month-close | approvals | advances | generation-performance`, desk-scoped (a hydro officer sees hydro, thermal sees thermal).
- Pages in `frontend/src/pages/hydro-thermal/desk/Station*.jsx`, routed under `/hydro-thermal/*` and `/thermal/*`, in both sidebars.

## Wave 2 — done 18-Oct-2026

- Tables `station_beneficiary_ppas`, `station_regulatory_items` (schema.sql); service `backend/src/services/stationRegisters.js`.
- Beneficiary PPAs & Allocation: share billed (REA allocation) beside the PPA in force, 180-day expiry warning, stakeholder onboarding, LC held vs PPA cover, outstanding. Add / edit / terminate; refuses a beneficiary the station does not supply and overlapping PPAs.
- Regulatory Desk: petitions, true-ups, reviews, appeals, CERC fees, filings; overdue / due-in-30 / hearing-in-30 flags; an issued tariff order stays flagged until marked implemented, with links to the tariff and arrear screens.
- REA Register & Validation: provisional vs final REA and bills per month, final-vs-provisional movement, revisions, and flags for bill ≠ REA (>1 MWh), REA in but not billed, final REA awaited > 90 days.
- Tests: `backend/tests/hydro/h17-station-desk.test.js` (13), whole hydro suite green (399).

## Wave 3 — in progress

1. **Done 18-Oct-2026** — Regulation of Power Supply: table `station_power_regulations`; candidates from the ageing (dues > `power_regulation_trigger_days`, default 60) or security short of the PPA; notice → regulate (not before notice + `power_regulation_notice_days`, default 15; RLDC intimation ref required) → restore / withdraw; energy withheld read off the bill lines. The bill's regulation panel shows the register's cases for the month and warns on a deduction with no case behind it. Tests in h17 (16 total). Defaults to be confirmed by Commercial.
2. **Done 18-Oct-2026** — Hydro Stations & Tariff (`/hydro-thermal/stations`): stations and readiness, what the next bill of the year is computed on (FY tariff over contract), tariff by FY with order reference, stale-bill warning pointing to arrears, and open CERC orders not yet in the bills. Thermal Generation Performance: PLF (ex-bus grossed up by normative aux) against the `thermal_plf_incentive_norm_pct` master (85%), GHR / aux / SFC norms, GCV / CVPF, landed coal and oil, coal on norms, ECR. Actual heat rate and actual aux are not captured on the platform — a follow-up if Commercial wants actual-vs-norm.
3. **Done 18-Oct-2026** — Thermal dashboard: figures from the bills and ledger via `buildDashboard` (now reading `thermal_station_tariffs` for thermal AFC/NAPAF and REA share where there is no free-power column), PLF / ECR / fuel trend, receivables ageing, PAFM vs NAPAF per station, beneficiary shares and settlement, pipeline, and a "desk today" strip from the registers (`deskStatus`). Test in h17 (18).
4. **Done 19-Oct-2026** — Hydro dashboard data-driven: loads the hydro desk only, FY label from the data, one PAFM line per station, a NAPAF reference per distinct norm (NJHPS 87%, RHPS 83%), fitted axis, free-power share and home state from the stations; same "desk today" strip as thermal.
5. beneficiary portal users if beneficiaries are given logins; user-manual chapters for the new screens.
