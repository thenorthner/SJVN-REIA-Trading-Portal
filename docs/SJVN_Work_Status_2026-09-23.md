# Work status — 23 Sep 2026

Covers 21–23 Sep 2026 (after the 15-Sep status note). Everything below is
running on **http://test.sjvn.co.in**.

## 1. Platform is live again on the test URL

- The server was restarted at some point and the platform had not come back;
  the site showed the old placeholder page. It is running again, and the
  auto-start on boot has been corrected so it does not repeat.
- The full, current build was deployed: the deployed copy is now the same code
  we develop against, with the real database, users and uploads carried over
  unchanged. A backup of the previous deployment is kept on the server.
- edms, commercial, clip and gatepass were checked before and after every
  change — none of them was touched at any point.

## 2. IEX API — connected and working

- SJVN's UAT connection to IEX is **live for DAM, GDAM, HPDAM and RTM**:
  business configuration, delivery dates, bid areas, asset master and user /
  portfolio masters all return data from the whitelisted server.
- Two integration faults were found and fixed against the live exchange:
  - IEX's document names one authentication header; their gateway accepts a
    different one. Every call was failing on this until it was traced.
  - Their schedule report does not accept "all bid areas"; the platform now
    asks per bid area, as the exchange requires.
- **Open with IEX:** no market results (prices / schedules) are published on
  their test environment for any of the last 16 days, and the REC segment
  refuses our server. A detailed technical mail is drafted and ready to send
  (11 points, with evidence). Until they answer, market data screens will stay
  empty — the platform side is ready.

## 3. Hydro station billing straight from the Regional Energy Account

New in the platform: **Hydro Billing → "Bills from the Regional Energy
Account"**. The desk pastes the REA links from NRPC's site and the platform

- downloads and reads each month's REA (energy, plant availability, and the
  home state's free power from table D2),
- drafts that month's bill for NJHPS and Rampur, oldest month first so the
  financial year's cumulative energy carries correctly,
- refuses to bill a month whose earlier months are not billed yet.

**Checked against SJVN's own bills:** the platform's NJHPS bills for May and
June 2026 match the issued bills **to the rupee** (June: Rs 157,49,26,027).
April–August 2026 are drafted on the server for both stations (10 bills), ready
for review.

NRPC moved its website; the old page stopped at Dec 2025. The new source is now
wired in, and Python was installed on the server for reading the REA PDFs.

## 4. Money-accuracy fixes (billing and recovery)

Found while reviewing LPS, rebate and debit/credit notes against the CERC /
MoP rules, and fixed:

- **Late payment surcharge was under-charged.** When a bill was paid late in
  parts, the surcharge on the part that was paid was being dropped. On a
  Rs 1 lakh bill paid in two late instalments the platform charged Rs 1,253
  instead of Rs 1,870. It is now charged day by day on whatever was actually
  unpaid that day.
- **A bill paid late in full carried no surcharge at all** on the hydro side
  unless someone had raised it before the payment arrived. It is now charged
  whenever it was earned.
- **Payments now go to the surcharge first**, then to the oldest bill, as the
  MoP Late Payment Surcharge Rules 2022 require.
- **Early-payment rebate was over-allowed.** A token payment inside the rebate
  window was buying the discount on the whole bill. Rebate is now earned per
  payment, on the part that payment settles.
- **Hydro bills had no rebate at all.** The CERC rebate (1.5% within five days,
  1% within thirty) is now allowed on beneficiary payments, on station charges
  only, and shown separately on the account.

## 5. Debit and credit notes rebuilt (REIA and trading)

Previously a note changed the bill the moment one person typed it — no
approval, no tax, and an issued bill was rewritten after the fact.

- A note is now a **draft**; it moves no money until **someone other than the
  person who raised it approves it**.
- It carries its **taxable value and tax**, and is numbered in its own
  financial-year series (DN/2026-27/00001).
- An approved **debit note becomes its own bill**, with its own due date and
  its own surcharge — the original bill is left as issued.
- An approved **credit note is set against the bill** and is not counted as
  money received, so collection figures stay honest. Credit the bill cannot
  absorb stays available for another bill of the same contract.
- Issued notes **print as a document (PDF)**.
- On the trading side the same shape now applies, and an issued note finally
  **reaches the client's ledger** — earlier it sat in a register nobody was
  billed from.
- Notes already on file keep behaving exactly as before.

## 6. Quality

- Automated checks: **1,693 backend and 198 front-end tests, all passing**,
  including new tests written from the real REA and the real bills.
- Every change was applied to the server with a full backup of code, screens
  and database, and an automatic rollback if the platform did not come back.

---

## Waiting on others

| Who | What |
|---|---|
| **IEX** | Why no market results on their test environment; REC access for our server; 11 technical confirmations (mail drafted) |
| **PXIL** | Reply to our clarifications (IP whitelisting, staging dates) |
| **NOAR / Grid India** | API key to be generated from SJVN's own NOAR login; IP whitelisting; status code list |
| **SJVN IT** | HTTPS for test.sjvn.co.in (needs a short IIS restart in a maintenance window); keeping the web server's auto-start on boot |
| **WBES** | Credentials — 15-minute block-wise energy data is blocked until then |

## Decisions needed

1. **Who may approve a debit / credit note** — today any second user from REIA
   or Finance. If only Finance should approve, we will restrict it.
2. **HTTPS window** — the change itself is small; it needs permission because
   IIS restarts briefly, which touches the other live sites.
3. **IEX test bids** — if IEX says results appear only for members who bid, do
   we place test bids on their test environment? No money is involved, but the
   platform's bid submission is deliberately switched off today.
