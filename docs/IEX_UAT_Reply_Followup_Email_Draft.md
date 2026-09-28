# Email draft — IEX UAT: reply to Sandeep's answers of 25-Sep-2026

> **STATUS: DRAFT — not sent.**
> This answers IEX's point-by-point reply on the thread *RE: IEX FO API
> (UAT/Alpha) — base URL, token validity and REC/ESCerts documents — SJVN
> Limited (N2DL0SJV0000)*. Reply **in that thread** so the whole record stays
> attached.
>
> Everything marked "implemented" below is in `backend/src/services/iexService.js`
> and covered by tests; see `docs/WORKLOG_2026-09-25_IEX_Reply.md`.

**To:** Sandeep.Kumar3@iexindia.com
**Cc:** Sudhir.Bharti@iexindia.com; Kunal.Bhat@iexindia.com; Kapil.Saini@iexindia.com;
nikhil.sharma34@sjvn.nic.in; praveen.kalta@sjvn.nic.in — same list as the thread.

---

Dear Sandeep ji,

Thank you for the detailed answers. They close almost everything we had open,
and we have already made the changes at our end. Below is first what we have
taken as settled, then the four things we still need from you — the first of
which is the test window you asked us to propose.

## A. Test window on Alpha — our proposal

Since clearing on Alpha is manual, we would be grateful if you could schedule
the following. It is two consecutive working days and covers all four segments:

| Segment | Trading day | Delivery date | What we would like run |
|---|---|---|---|
| DAM, GDAM, HPDAM | Tue 29-Sep-2026 | Wed 30-Sep-2026 | Final calculation and publish after the session closes |
| RTM | Wed 30-Sep-2026 | Wed 30-Sep-2026 | Four consecutive sessions, 31 to 34 (15:00–17:00 IST) |

Please confirm the slot and the session timings you will keep open, and the name
of the person who will run it, so we can be on the call while it happens. If
another day suits your team better, any two consecutive working days are fine
for us — we only ask for a little notice.

Two points on what that window will and will not prove:

- **Market results (`pqresults`, `publishinfo`, `markettimedetails`)** need no
  bid from us, since you have confirmed results are published to every member
  irrespective of participation. A cleared session alone validates our parsing.
- **The Portfolio Schedule Report** is our own scheduled quantum, so it stays
  empty unless a bid of ours clears. Bid submission is deliberately not wired up
  in our system pending a controlled window, so please advise which you prefer:

  - **(i)** we enable submission for that window only and place a token bid —
    in which case please confirm the acceptable segment, quantum, price band and
    the exact bid window for 29-Sep, and we will keep it to the minimum
    tradeable quantity on one portfolio; or
  - **(ii)** we place the test bid through the Alpha web terminal instead, if
    our UAT credentials permit that login — please confirm the URL; or
  - **(iii)** your team places a token bid for `N2DL0SJV0000` from your side.

  Any of the three works for us. We note your confirmation that the Alpha
  environment carries no settlement obligation.

## B. REC / EC on UAT — whitelisting request

You have confirmed that `49.50.97.173` is **not** whitelisted for REC in UAT,
which explains the 403 exactly. **Kindly add 49.50.97.173 to the whitelist for
`alpharecapi.iexindia.com`** and let us know when it is in place; our REC/EC
client is written and tested and is waiting only on this. We also note the
production host `recapi.iexindia.com` — thank you.

## C. C&S back office — token and document

You have confirmed C&S needs a token of its own and no IP whitelisting.

- **Kindly issue the C&S API token** for `N2DL0SJV0000` / `SJVA1` (UAT first).
- We hold **IEX_CnS_API_2.0_For_Members**. Please confirm this is the current
  version and is the right document for settlement reconciliation — i.e. the
  trade/obligation and payment reports — or share the correct one.

## D. Production cut-over

Understood that a separate mail is required. Before we send it, please confirm:

- **a.** What the mail must state, so it is right the first time: the IP
  (`49.50.97.173`), the participant (`N2DL0SJV0000`), the segments, and the user
  id to be created. Should it be addressed to you or to a different desk?
- **b.** Whether the whitelisting request should be sent now or nearer go-live,
  and the usual turnaround.
- **c.** That the production token will arrive by mail on the registered id at
  that point, carrying its true validity, and that production REC is
  `recapi.iexindia.com` and C&S is `energx.iexindia.com`.

## E. Taken as settled — implemented at our end

We are recording these so that a wrong assumption cannot survive quietly. No
action is needed on any of them unless something below is not what you meant.

1. **Header** — `Authorization: Bearer {token}`, with `UserId` and
   `ParticipantId` on every call. A correction to the header table in the
   documents (which say `Authentication`) would help the next member.
2. **Token** — no replacement needed for UAT; the `exp` claim there is the typo
   you mentioned and we do not gate requests on it. We understand the gateway
   returns the same `UnAuthorized User` for any incorrect header value, so an
   expired token cannot be told apart from a wrong header; we will rely on the
   claim in the production token instead.
   You asked which mail carried the validity details — it is **your own mail of
   08-Sep-2026, 12:08 IST**, point 2: *"Validity for the token is 6 Month from
   the date of creation … expiry details automatically you will receive via mail
   on your registered mail id, 15 days in advance"*. It is quoted in full below
   in this thread.
3. **Scaling** — exactly as your worked example. Submit: quantity × 10
   (`OrderQtyDecimal`), price × 1 (`OrderPriceDecimal`). Read: quantity ÷ 100,
   price ÷ 100 (`TradeQtyDecimal`, `TradePriceDecimal`), giving MW and Rs/MWh.
   We convert Rs/MWh to Rs/kWh internally.
4. **Delivery dates** — DAM, GDAM and HPDAM return T+1 only; RTM returns T, T+1
   and T-1. Our client reads both shapes and uses your epoch values verbatim.
5. **Bid area** — taken from the first two characters of our own portfolio ids,
   so a schedule-report pull now asks only for our areas (two of them) instead
   of every area in the master. Thank you — that was the answer we could not
   have derived from the documents.
6. **Refusals as HTTP 200** — understood that a bare string such as
   `"Invalid Bid Area Id"` means the request reached IEX and failed validation,
   and that this is market-wide. Our client now treats any bare-string body as a
   refusal and logs it verbatim rather than reading it as a day with no data. If
   a list of these messages does become available, it would still help us label
   them for our operators.
7. **`markettimedetails`** — `Market` 1 main boundary, 2 DAM, 4 RTM, 5 GDAM,
   6 HPDAM; `Status` S start, E end, N not available. RTM `Session`: 96 blocks of
   15 minutes, two blocks to a session, 48 sessions in a day — so session 1 is
   00:00–00:30. Please confirm no further `Market` value appears in production.
8. **RTM publish info** — our 404 was our own path. RTM is
   `rtm/api/v2/getpublishinfo/{LoginUserId},{ParticipantId}`, as section 11.5 of
   the RTM document states; we had been using the DAM spelling on all four
   segments. Corrected, so no log is needed from our side. We will use publish
   info (final / provisional, run count, action P or D) as the trigger to pull PQ
   results rather than polling, per your advice and section 12.8.
9. **Rate limit** — 4 requests per second. Our client now spaces its own calls
   to that limit across all segments, REC included. On pagination we have taken
   it from the documents: `PageNumber` and `PageSize` on the single bid book,
   block bid book, trade book, portfolio bid status and block bid price
   calculation details, with `0` meaning all records and a maximum page size of
   96. Please confirm that passing `0,0` to read a full day is acceptable in
   production, or tell us the page size you would prefer we use.
10. **Live verification** — understood that bids cannot be viewed centrally in
    production and that a member verifies its own bids through the Single/Block
    Bid Book and Bid Details APIs. To be candid about where we stand: our
    integration is read-only today and reads results, so those three are the next
    thing we build, alongside submission, before cut-over. We would like to
    exercise them against Alpha in the same window as item A — they will have our
    own test bid to return.

We are ready for the window whenever it suits your team.

Thanks and regards,

Kshitij Sharma
ERP Cell
SJVN Corporate HQ, Shimla
