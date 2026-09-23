# Email draft — IEX UAT: results not published, plus API clarifications

> **STATUS: DRAFT — not sent.**
> Everything below was observed from the whitelisted server (49.50.97.173) on
> 22–23 Sep 2026 with participant `N2DL0SJV0000` / user `SJVA1`, read-only
> calls only. No bids have been placed on UAT.
>
> Evidence scripts: `sjvn-deploy/tools/iex-probe/iex-probe.js` (connectivity),
> `iex-401-check.js` (header variants), `iex-raw.js` and `iex-uat-check.js`
> (raw responses, 16 days of PQ).

**Send from the SJVN address** used for the UAT credentials.

**To:** Sandeep Kumar (Market Operations, IEX)
**Cc:** the IEX API support id on the credentials mail; SJVN Commercial & System Operation

**Subject:** SJVN UAT (N2DL0SJV0000 / SJVA1) — no market results on Alpha, REC 403, and API clarifications

---

Dear Sandeep ji,

Thank you for the UAT credentials and the Front Office API documents. We have
completed the read-only integration for DAM, GDAM, HPDAM and RTM from our
whitelisted server (49.50.97.173) and have verified connectivity, the master
APIs and the delivery-date APIs end to end.

Before we can test the parts that matter for settlement — market clearing
prices and our own schedule — we need your help on the points below. Items 1
and 2 are blocking; items 3 to 9 are clarifications, several of which differ
from the API documents and which we would ask you to confirm so that we do not
carry a wrong assumption into production.

## 1. No market results on the Alpha (UAT) environment — blocking

For every delivery date from **08-Sep-2026 to 23-Sep-2026**, on **all four
segments**, `pqresults` returns an empty list:

```
GET {segment}/api/v2/pqresults/SJVA1,N2DL0SJV0000,{epoch}
→ 200 {"DeliveryDate":0,"LastUpdatedTime":0,"PQDetails":[]}
```

`publishinfo` is also empty on DAM, GDAM and HPDAM:

```
GET dam/api/v2/publishinfo/SJVA1,N2DL0SJV0000   → 200 {"PublishInfo":[]}
```

At the same time `markettimedetails` **does** return live session timings, so
the environment itself is configured — for example, DAM for delivery date
23-Sep-2026 (epoch 1790121600) shows a window of 15:30–22:52 IST on
22-Sep-2026, and RTM returns 15-minute sessions for the same delivery date.

RTM clears every 15 minutes, so sixteen days without a single published result
suggests that clearing is not being run on Alpha rather than that we are asking
for the wrong dates.

Kindly confirm:

- **a.** Are market sessions actually cleared on the Alpha environment? If they
  run to a schedule, please share it (days and times), or name a delivery date
  that definitely has published results so that we can verify our parsing
  against known values.
- **b.** Are market-wide PQ results published to every member irrespective of
  participation, or does a member see results only for a session in which it
  has bid?
- **c.** If test bids from our side are required to generate results, please
  confirm that placing them on Alpha carries no commercial or settlement
  consequence, and tell us any limits we should observe (segment, quantum,
  price band, time window). We have deliberately not placed any so far.

## 2. REC / EC API returns 403 from the same whitelisted IP — blocking

```
GET rec/api/v2/businessconfig/SJVA1,N2DL0SJV0000
Host: alpharecapi.iexindia.com
→ 403 Forbidden (HTML), Transaction ID:
  de77018a3dd533c7788737474753a9f2f8c08337860ab35d4742dca5cf82a3b8
```

The same server, the same second, is served normally by
`alphaidamapi`, `alphahpdamapi` and `alphartmapi`. Kindly confirm:

- **a.** Is `49.50.97.173` whitelisted for the REC/EC host as well? If the REC
  whitelist is maintained separately, please add it.
- **b.** Does REC/EC use the same token as the Front Office API? The token we
  hold carries the claim `system: TradeV2Api`. If REC/EC needs its own token,
  please issue one.
- **c.** Your host table leaves the **production REC host blank**. Please
  confirm the production URL for REC/EC when it is available.

## 3. Token header: the documents say `Authentication`, the gateway accepts only `Authorization`

The header table (DAM 2.2, page 11) specifies:

```
Token   Authentication   Bearer {Authentication Token}
```

Sent that way, every Front Office call returns `401 UnAuthorized User!`. Sent as
the standard `Authorization: Bearer {token}`, with `UserId` and `ParticipantId`
unchanged, the same token is accepted and returns data. We verified this by
sending the same request eight ways (with and without `ParticipantId`, with and
without the `Bearer` prefix, and with a deliberately invalid token as a
control); only `Authorization` succeeded.

Kindly confirm that `Authorization` is the correct header going forward, so that
we do not have to change this at production cutover, and consider correcting the
header table in the documents.

## 4. Token validity: the issued token carries a one-hour expiry

The UAT token issued to us has `iat` 26-Jul-2026 08:51 UTC and `exp`
26-Jul-2026 09:51 UTC — one hour — although your mail states a validity of six
months. The token does work today, so the gateway evidently does not enforce
that claim.

- **a.** Please issue a fresh token whose `exp` reflects the true validity, so
  that our monitoring can rely on it.
- **b.** Please confirm whether the gateway validates `exp` at all, and how a
  genuinely expired token will present itself (401 with which body?).
- **c.** There is no login or refresh endpoint in the documents. Please confirm
  the renewal process and the notice period before a token lapses.

## 5. Delivery date API returns two different shapes

```
DAM / GDAM / HPDAM → {"DeliveryDateId":"T+1","DeliveryDate":1790121600}
RTM                → {"DeliveryDates":[{"DeliveryDateId":"T","DeliveryDate":1790035200},
                                       {"DeliveryDateId":"T+1","DeliveryDate":1790121600},
                                       {"DeliveryDateId":"T-1","DeliveryDate":1789948800}]}
```

The documents show only the field names, not the envelope. We now read both,
but please confirm that this difference is intentional and stable, and whether
DAM can ever return more than one open delivery date (in which case we expect
the wrapped form there too).

We also confirm from these values that `DeliveryDate` is **UTC midnight**
(1790121600 = 23-Sep-2026 00:00 UTC, exactly divisible by 86400) and not IST
midnight. Please confirm, as a 5½-hour error would address the neighbouring
trading day.

## 6. Portfolio Schedule Report: `ALL` is not accepted as a Bid Area

```
GET dam/api/v2/portfolioschedulereport/SJVA1,N2DL0SJV0000,{epoch},ALL,ALL
→ 200 "Invalid Bid Area Id"
```

The document states `'ALL'` only for `PortfolioId`, so we now call the report
once per bid area from the Bid Area Master (13 on UAT) and merge the results.
Kindly confirm:

- **a.** Is calling it per bid area the intended usage, or is there a value that
  returns all areas in one call?
- **b.** Should a member call every area in the master, or only the areas mapped
  to its own portfolios? If the latter, which API returns that mapping? (The
  User Portfolio Mapping API returns our two portfolios but no bid area, and the
  User Master returns `BidAreaId: ""` for SJVA1.)
- **c.** Refusals are returned as **HTTP 200 with a bare JSON string**
  (`"Invalid Bid Area Id"`). A distinct HTTP status, or an error object with a
  code, would let us tell "your request was wrong" from "there is no data for
  that day". Please consider this for a future revision, and in the meantime
  share the list of such string messages so we can recognise them.

## 7. Header usage for a user login vs a participant login

The header table says `ParticipantId` is to be left **blank in case of
Participant login**. The User Master shows `SJVA1` as `UserCategory 4` with
`BidAreaId: ""`, and the User Portfolio Mapping shows two portfolios
(`E1BR0SJV0001` and one more).

Please confirm that for our login we should continue to send
`UserId: SJVA1` and `ParticipantId: N2DL0SJV0000` on every call (which is what
works today), and tell us what changes if we later use a portfolio-level login.

## 8. Scaling factors — confirming the asymmetry

From the Asset Master on UAT: `OrderQtyDecimal 10`, `OrderPriceDecimal 1`,
`TradeQtyDecimal 100`, `TradePriceDecimal 100`.

We have implemented: results and the schedule report are divided by the **trade**
decimals (100), i.e. quantity in MW and price in Rs/MWh; and, per your earlier
mail, bid submission will multiply quantity by **10** (5.3 MW → 53).

Please confirm both, since a wrong assumption here is a silent factor-of-ten
error that no error message would reveal:

- **a.** Divide by the decimal value itself (100), not by 10^100 — i.e. the
  value is the divisor, as the document's own worked example implies.
- **b.** The submit side uses the **order** decimals and the result side the
  **trade** decimals.
- **c.** Price: `TradePriceDecimal 100` gives Rs/MWh, and we convert to Rs/kWh
  ourselves. Please confirm the unit returned is Rs/MWh.

## 9. `markettimedetails` and `publishinfo` — code lists

```
DAM   {"DeliveryDate":1790121600,"TradingDate":1790035200,
       "StartTime":1790071200,"EndTime":1790097720,"Market":2,"Status":"E"}
RTM   ... "Market":4,"Status":"N","Session":1 ...   (GDAM Market 5, HPDAM Market 6)
```

- **a.** Please share the enumerations for `Market` and `Status` (we see `E` and
  `N`), and the meaning of `Session` for RTM.
- **b.** `rtm/api/v2/publishinfo/{user},{participant}` returns **404** while the
  same path exists on DAM, GDAM and HPDAM. Is publish info not available for
  RTM, or is the path different there?
- **c.** Please confirm what `PublishInfo` carries once results exist, so we can
  use it as the trigger to pull PQ results rather than polling.

## 10. Operational points before production

- **a.** Rate limits or throttling on these read APIs, and the expected polling
  frequency for PQ results and the schedule report. (The documents fix the
  response timeout at 40 seconds, which we honour.)
- **b.** Pagination defaults and maximums on the bid book, trade book and
  portfolio bid status APIs.
- **c.** For production cutover: confirmation of the production hosts
  (`idamapi`, `hpdamapi`, `rtmapi`, and REC), whether a **separate token** is
  issued for production, and whether the IP whitelist has to be requested again
  for the production gateway. Our outbound IP will remain 49.50.97.173.
- **d.** Any sandbox or contact window for a supervised first live call.

We are ready to test as soon as results are available on Alpha, or as soon as
you confirm that we should place test bids there. Our integration is read-only
today: bid submission, order entry and cancellation are deliberately not wired
up pending a controlled test window with you.

Thanks and regards,

Kshitij Sharma
SJVN Limited
Commercial & System Operation Department
