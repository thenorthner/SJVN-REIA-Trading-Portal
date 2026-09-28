# Work status — 28 Sep 2026

Covers 24–28 Sep 2026 (after the 23-Sep status note). Everything below is on
**http://test.sjvn.co.in** unless stated otherwise.

The short version: **IEX have answered our technical mail and NOAR is now live
with real data.** WBES is the only interface still fully blocked, and that is
one request to Grid India away.

## 1. NOAR is connected and reading SJVN's real applications

Power Trading (O/o CGM, New Delhi) sent the NOAR API key and secret. The
platform is now reading SJVN's own open-access applications from the live
registry — **134 applications for August 2026, 422 over the last four months** —
with the approval number, applied / approved / scheduled MWh and the charge and
TDS details against each.

Three things worth the department's attention:

- **The key must never be regenerated.** NOAR allows one active key per login,
  and creating a new one silently kills the old. The key we were given dates
  from 16-May-2026, so it is the one that was already in use — nothing was
  disturbed by giving it to us, and nothing will be as long as nobody presses
  "create API key" on the portal. It is valid to **16-May-2027**.
- **The key works only on NOAR's live system**, not their test system. So there
  is no practice environment: the first call is a live call. Ours are read-only.
- **The registry does not tell us about applications that were not approved.**
  Every one of the 422 records came back approved, with an approval number and a
  scheduled quantity. We had intended to use this to catch an application still
  pending or rejected; that is not something the interface offers. Pending and
  rejected applications therefore continue to be tracked on the portal as today.
  We have asked NOAR and PwC to confirm this in writing.

We had expected to need our server's IP registered with Grid India first, as
PXIL and IEX both require. NOAR does not enforce it, so **that request is not
needed and has been dropped** — asking for it would only invite a restriction
that does not exist today. The consequence is that the key itself is the only
protection on this data, so it is held in the server's configuration file only,
readable by nobody through the application, and is not in any shared document.

## 2. WBES — two of three details received, still blocked on one request

Grid India supplied the API address and the username (`usr_SJVNL`). The API key
came earlier through Power Trading. **What is still missing is access itself:**
their gateway only answers IP addresses registered with them, and ours is not.
We confirmed this is the sole blocker — from our network the connection is cut
before our request is even sent, so nothing else about it can be tested first.

A mail to Mr. Anupam Kumar (Grid India) is drafted: register **49.50.97.173**,
and confirm one small thing — asked for SJVN's registered utility acronym they
answered "SJVN Limited", which reads as the company's name rather than the short
code their API expects. We have deliberately not guessed it: a wrong code
returns an empty schedule rather than an error, which looks exactly like a day
on which nothing was scheduled, and that would end up in an invoice.

Until this is done, 15-minute block-wise schedule data continues to be keyed in
by hand, as today.

## 3. IEX have answered — nine of eleven points settled

Their reply of 25-Sep answers the technical mail sent on 23-Sep. Where their
answer differed from what we had assumed, the platform has been corrected:

- **The biggest one was invisible.** IEX confirmed that when a request is wrong
  they reply with a *success* code carrying a short message inside it. Our
  platform read that as "the exchange has no data for that day" in several
  places. A refused request and a genuinely empty day now read differently —
  this is the kind of fault that produces a plausible wrong number rather than
  an error.
- Our schedule report now asks only for **SJVN's own two bid areas** instead of
  all thirteen on the exchange, which IEX confirmed is the intended usage.
- IEX allow **four requests a second**; the platform now keeps to it. They
  document no error for exceeding it, so nothing would have warned us.
- The scaling of quantities and prices, the header, the delivery-date behaviour
  and the status codes were all confirmed to be as we had implemented them.
- One fault was **ours**: for RTM we were calling the wrong address for
  "results published?", which their document had stated correctly. Fixed, and
  there is now a screen showing whether the exchange has published results —
  which is what IEX say to use instead of repeatedly asking for the results.

**What is still open with IEX** (mail drafted, ready to send):

- **Their test environment does not clear the market by itself** — that is why
  we saw no results for sixteen days; it was their environment, not our reading
  of it. They have offered to run a session for us on a scheduled day. We have
  proposed **Tue 29-Sep and Wed 30-Sep** and asked them to confirm.
- **REC access** — our server is still not registered on their REC system. They
  have confirmed that is the reason for the refusal, and we have asked them to
  add it.
- **Post-trade reports (C&S)** need a separate token, which they have not yet
  issued.

## 4. Quality

- Automated checks: **1,732 backend tests, all passing** — 43 of them new, for
  the faults above. Front-end builds clean.
- No credential is in the code, in the shared documents or in the project
  history; all of them live only in the server's own configuration.
- Nothing in this period touched edms, commercial, clip or gatepass.

---

## Waiting on others

| Who | What |
|---|---|
| **IEX** | Confirm the market-clearing session on 29/30-Sep; register our server for REC; issue the C&S token and report document |
| **Grid India (WBES)** | Register 49.50.97.173; confirm the short code for SJVN's schedules |
| **NOAR / PwC** | Confirm in writing that the report returns approved applications only, and share the status code list |
| **PXIL** | Reply to our clarifications (IP whitelisting, staging dates) |
| **SJVN IT** | HTTPS for test.sjvn.co.in (needs a brief IIS restart in a maintenance window) |
| **Power Trading** | Confirm whether any existing system uses the same NOAR key, so it is never regenerated |

## Decisions needed

1. **IEX test bids — the one that blocks the 29/30-Sep window.** Market prices
   will come through without us bidding. But *our own* cleared schedule only
   appears if a bid of ours clears, and the platform's bid submission is
   deliberately switched off. Three ways forward, and IEX are content with any:
   enable submission for that window only and place one minimum-size test bid;
   place it through IEX's test website instead; or ask IEX to place a token bid
   for us. **No money or settlement obligation is involved on their test
   system** — they have confirmed this in writing. Please indicate a preference.
2. **Pending / rejected open-access applications.** Since NOAR's interface
   reports only approved applications, should the platform keep a manual status
   field for the rest (as today), or should we drop the intention of tracking
   them automatically altogether?
3. Carried over from 23-Sep, still open: who may approve a debit / credit note,
   and the HTTPS maintenance window.
