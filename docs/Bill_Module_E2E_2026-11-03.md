# Power Trading › Bill — end-to-end test, 3 November 2026

**Screens:** Generate Bill · Supply Bill Entry · Report of Supply Bill · Trading Billing & Settlement · Generator Billing & Settlement
**Branch:** `feat/trading-settlement-billing` (not committed)
**Run on:** local `platform.db` (dummy data), backend on :4060, frontend on :5186

---

## How it was tested

- **API:** every route on the five screens was called as each role that can reach it: trading user, trading admin, Finance, management, SJVN admin, REIA maker, REIA checker and a trading client. The calls covered good input, bad input, duplicates, overlaps, the wrong role and the wrong client.
- **Browser:** each screen was driven by hand. The note was raised from the UI, an invoice was issued, a Bill of Supply was cancelled with a reason, the supply report was read, and a generator bill was generated as the REIA maker.
- **Regression:** a scripted live run of 54 checks passes. The full backend suite passes too: 261 files and 3,267 tests.
- **Frontend suite:** 335 of 344 tests pass. The 9 failures are in `HydroThermal3DPipelines`, `IntradayMarketTab` and a dashboard test (a `recharts` mock with no `Area` export). They also fail with this change taken out, so they predate it and are not part of this module.

---

## Bugs found and fixed

### Generate Bill (bilateral / exchange → View Bills register)

| # | What was wrong | What it does now |
|---|---|---|
| 1 | A one-off fee was charged again on every bill under the same contract. This covers the NOAR application fee, client registration and SLDC consent. | It is billed once per contract and bill type. A later bill says where the fee was billed. If nothing else is left, the screen says "Nothing left to bill". |
| 2 | GST was charged on the value of the energy. | Electricity is exempt (HSN 2716), so a bilateral energy bill has no GST. On an exchange energy bill only the trading margin is taxed. Fee bills are taxed in full. |
| 3 | TDS was worked out on the value including GST. | TDS is on the value excluding GST (CBDT Circulars 23/2017 and 13/2021). |
| 4 | A period before the contract started, or after it ended, could be billed. | Such a period is refused. A blank period defaults to the contract term. |
| 5 | Impossible dates such as 2026-02-30 were accepted. | They are refused. The same check applies on every screen below. |
| 6 | Two active bills could cover the same days, so the client was billed twice. | An overlapping bill is refused (409). A FINAL bill still replaces the PROVISIONAL bill for the exact same period. |
| 7 | OA and SLDC fee bills could not be raised until the OA was approved. That is backwards, because the fee is due on applying. | Fee bills can be raised at any time. An energy bill still needs the OA approved or partly approved. |
| 8 | `invoice_date` and `credit_days` were not checked. | The invoice date must be a real date. Credit days must be a whole number from 0 to 365. |
| 9 | With no volume, the screen could not bill the flat and per-day charges. | A checkbox appears: "Bill the flat and per-day charges anyway", with an Undo link. |
| 10 | A failure while raising the invoice came back as a 500. | It comes back as 409 or 400, with the reason. |

### Supply Bill Entry / Report of Supply Bill

| # | What was wrong | What it does now |
|---|---|---|
| 11 | The amount could be typed over quantity × rate. Bills went in at −₹4,90,000 and ₹0.98. | The amount is always quantity × rate. |
| 12 | An invoice could be dated before the supply started, and a due date could fall before the invoice date. | Both are refused. The date pickers also carry these limits. |
| 13 | The unit was free text, and one bill went in as "ba…". | The unit must be MWh, kWh or MU. |
| 14 | A client or bilateral contract that does not exist caused a 500. | It returns a 400 that names the missing record. |
| 15 | The same client, contract and period could be billed twice. | The second bill is refused (409), and the refusal gives the existing bill number. |
| 16 | After a hand-given bill number, the next automatic number could collide with it. | The next number is the highest so far plus one, and it is checked to be free. |
| 17 | A bill could be cancelled with no reason, and cancelled twice. | A reason is required, and it is stored with who cancelled and when. A second cancel is refused (409). |
| 18 | The report added MU to MWh as if they were the same unit, so a 1 MU bill counted as 1 MWh. Cancelled bills were also mishandled. | Energy is converted to MWh, so 1 MU shows as 1,000 MWh. Cancelled bills are listed with their status but left out of the totals. |

### Trading Billing & Settlement (invoices, notes, ledger)

| # | What was wrong | What it does now |
|---|---|---|
| 19 | The screen's role list was written out by hand. It missed trading admin, management, and the client's maker and checker, who could open the screen but saw it empty. | Read access is the whole trading desk plus the trading client roles. Writes go to the trading write roles and Finance. |
| 20 | TDS under section 194C was deducted at 10%. | It is 2% for a company and 1% for an individual or HUF. |
| 21 | An invoice could have a negative charge leg, a total of zero or below, a settlement date before the trade date, or no billing month. | All of these are refused. DSM may still be negative. |
| 22 | A back-dated trade's ledger entry was slotted into the past, which changed balances already reported. | The entry is posted today and carries "(trade date X)" in its description. |
| 23 | An invoice could be "sent" again whatever its status. | Only a DRAFT can be issued. There is now an **Issue** button for DRAFT rows. |
| 24 | A note's billing period could be any text, such as "hello". | It must be YYYY-MM. |
| 25 | A note could be raised for one client against another client's invoice. | This is refused. |
| 26 | A credit note had no cap. One of ₹9,99,99,999 was issued against an invoice of ₹8,850. | A credit note is capped at the invoice value less earlier credits (CGST s.34). |
| 27 | The note form did not ask which invoice the note adjusts, so the API refused every note raised from the screen. | The form has a required "Against Invoice" select, filtered by client. The note's period follows the chosen invoice. |
| 28 | The screen had dead SAP, PDF and Search buttons, no billing month when raising an invoice, no export and no statement view. | The dead buttons are removed. The Billing Month field is added (required), with Export CSV and a Statements of Account tab. |

### Generator Billing & Settlement (CERC two-part tariff, hydro)

| # | What was wrong | What it does now |
|---|---|---|
| 29 | The ECR was worked out on gross design energy. | It is worked out on saleable energy: DE × (1 − aux) × (1 − free energy). For NJHPS 2026-27 that gives ₹1.479/kWh, which matches the Commercial department's figure. |
| 30 | The capacity charge put the whole station's monthly AFC on one beneficiary, ignoring the days in the month. | Capacity charge = AFC × ½ × NDM/NDY × min(PAF/NAPAF, 1) × the beneficiary's share. NDY is counted over April–March, so a leap February counts. |
| 31 | A generator (seller) could be billed as the beneficiary. | This is refused, and the dropdown now lists buyers only. |
| 32 | "nathpa jhakri hps" and "Nathpa Jhakri HPS" counted as two stations, so the same month could be billed twice. | Case and spacing are ignored when looking for a duplicate. |
| 33 | A month that had not begun could be billed. | It is refused. The field is a month picker that defaults to last month. |
| 34 | Negative AFC, a PAF of 250%, a NAPAF of 0 or a share above 100% were accepted. | All are refused with the field named. |
| 35 | A bill's status could jump anywhere, including from PAID back to DRAFT. | It moves only DRAFT → FINAL → PAID, by the checker. Who moved it and when is recorded. |
| 36 | The energy field was labelled "Ex-bus Saleable Energy" and prefilled with 540,000 MWh, which is a station figure. A 12.5% beneficiary was charged ₹79.9 Cr of energy. | The label is now "Energy scheduled to this beneficiary, ex-bus (MWh)", which is its line in the REA. The field starts blank. |

---

## Decisions taken (by regulation and practice)

- **GST on electricity:** exempt (HSN 2716). Only the trading margin and the fee lines are taxable services, at 18%.
- **TDS base:** the value excluding GST (CBDT Circulars 23/2017 and 13/2021).
- **194C rate:** 2% for a company, 1% for an individual or HUF.
- **Credit note cap:** a credit note cannot exceed what is left of the invoice (CGST s.34).
- **One-off fees:** billed once per contract and bill type, not once per bill.
- **Hydro ECR:** AFC × 0.5 / {DE × (1 − AUX) × (1 − FEHS)}. Capacity is pro rata by NDM/NDY and the allocation share. Energy is charged on the energy scheduled to the beneficiary.

## Open, not changed in this run

1. **Exchange contract in DRAFT:** an exchange contract still in DRAFT status counts as billable.
2. **Bilateral bill numbers:** the number takes the generator's code (e.g. TEESTA) although the bill goes to the buyer (NDMC). Also, the code "NEW" comes from "New Delhi…".
3. **TDS ledger seed:** `tdsLedger.js` sets STU and SLDC vendors to 194C at 10%. This is outside this module.
4. **PAF incentive:** when PAF is above NAPAF the capacity charge is capped at full recovery, and no incentive is paid. This was kept as it is.
5. **"SJVN" as a client:** "SJVN" appears in the client list because of a COALESCE in the list query.
6. **Accessibility:** several select labels are not tied to their controls.

## Test data left in the local DB

These records were created by this run:

- Bills of supply SJVN/BOS/202611/0001–0010, 0099–0101 and 202609/0008. Several were raised before the fixes, such as the −₹4,90,000 bill and the 2026-02-30 bill.
- View Bills invoices raised today.
- Trading invoices for Gujarat Alkalies and ELECTROTHERM.
- Notes TDN/TCN, including the ₹9,99,99,999 credit note from before the cap.
- Generator bills GB/2026/000001–000010.

A copy of the database from before the run is in the session scratchpad. It was not restored, because a second backend on :4000 opened the same database during the run.
