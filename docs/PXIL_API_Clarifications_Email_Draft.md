# Reply draft — PXIL API integration clarifications

**To:** gaurav.tiwari@pxil.co.in
**Cc:** it@pxil.co.in; avadheshkumar.bari@pxil.co.in
**Subject:** Re: PXIL API Documentation — clarifications before Phase 1 integration

---

Dear Gaurav,

Thank you for the API documentation and access details. We have completed a detailed review of all six Phase 1 documents (TAM-GTAM, TAM-GTAM Slot-Wise, Format-D, Member DOR, Reverse Auction L1 Summary and Trade Margin) and have built our integration layer against the documented request and response shapes.

Before we point it at your environment, we need clarification on the points below. We have numbered them so you can reply inline.

Sections A and B are blocking. Section A prevents us from calling the endpoint at all; Section B would let us call it but post incorrect figures. Sections C and D are needed to finalise the mapping.

---

## A. Blocking — endpoint cannot be called as documented

**A1. The daily TAM-GTAM document prints the slot-wise URL**

`TAMGTAM_API_Document.pdf` and `TAMGTAM_Slot_Wise_API_Document.pdf` both give the same API URL:

> `https://dashboard.pxil.in/PXILPublish/api/tam-gtam-slot-wise/`

We assume this is a copy-paste error in the daily document. Please confirm the correct path for the daily/aggregate TAM-GTAM API — is it `/PXILPublish/api/tam-gtam/`?

**A2. Two different authentication mechanisms are documented**

| API | Documented auth |
|---|---|
| TAM-GTAM, TAM-GTAM Slot-Wise, Format-D, Trade Margin | `Authorization: Bearer <token>` header |
| Member DOR, Reverse Auction L1 Summary | `APITokenNo` as a **query parameter** |

Please confirm whether this is intentional.

If the gateway accepts the Bearer header on all six, we would prefer to standardise on it. A token in a query string is written into web-server access logs, proxy logs and any intermediate monitoring on both sides, which is a credential-exposure risk we would rather avoid. If the query parameter is mandatory for those two endpoints, please confirm and we will isolate them with request logging suppressed.

**A3. Which environment is the issued token valid for?**

Your email gives the API URL as `https://dashboard.pxil.in/`, but the example request in `Member DOR API Doc.pdf` is against a different host:

> `https://stagingmypratyaydashboard.pxil.in/PXILPublish/api/member-dor/`

Please confirm:

- Is the token you shared valid for production (`dashboard.pxil.in`), for staging, or for both?
- We would prefer to complete first-pass validation against **staging**. Could you confirm the staging base URL for all six Phase 1 APIs, and issue a staging token if it differs from the one already shared?

**A4. Does our server IP need to be whitelisted?**

None of the documents mention IP whitelisting, but it is common for exchange APIs. Please confirm whether access is restricted by source IP.

If it is, kindly whitelist our server:

```
49.50.97.173
```

Please also confirm whether staging and production require separate whitelisting requests, and the typical turnaround.

We are raising this now because if whitelisting is required and not in place, our first call will fail as a connection timeout rather than a clear authorisation error, which is slow to diagnose from our side.

**A5. Trailing slash on the endpoint paths**

The documented URLs are inconsistent on this point:

| API | Documented URL ends with |
|---|---|
| TAM-GTAM, TAM-GTAM Slot-Wise, Format-D, Member DOR | a trailing slash — e.g. `/api/format-d/` |
| Trade Margin | no trailing slash — `/api/trade-margin` |
| Reverse Auction L1 Summary | no trailing slash — `/api/reverse-auction/l1-summary` |

Please confirm the exact path for each, and whether the gateway redirects when the trailing slash is wrong.

This matters more than it may appear: if a missing or extra slash produces a 301 redirect, some HTTP clients drop the `Authorization` header when following it, which would surface as an intermittent 401 that is hard to attribute.

---

## B. Blocking for correctness — figures would be wrong

**B1. Member DOR — `Total` does not equal the sum of its own `Category`**

In the sample response:

| Field | Value |
|---|---|
| Charges | 0 |
| Fees | 4,760.35 |
| IGST | 856.863 |
| CGST | 0.0 |
| SGST | 0.0 |
| CP | 13,20,997.15 |
| **Sum of the above** | **13,26,614.363** |
| **`Total` as printed** | **14,42,000.683** |
| **Difference** | **1,15,386.320** |

The document annotates `Charges` as `APPLICATION + OPERATING + TRANSMISSION` and leaves it at 0.

Is `Charges: 0` a placeholder that should have carried the ₹1,15,386.32 difference, or does `Total` include a component that is not listed under `Category`?

Please also confirm the exact definition of `Total` — specifically whether it is inclusive of GST and of `CP` (Cost of Power). We cannot post an obligation to our books until the composition of this figure is confirmed.

**B2. Reverse Auction — `L1` is lower than every bid in the same response**

The sample shows:

> `"L1": 5.5` with `sellerData` containing `bidPrice: 89` and `bidPrice: 41`

In a reverse auction L1 should be the lowest seller bid, which would be 41 here, not 5.5.

Please confirm:

- What unit is `bidPrice` in, and what unit is `L1` in? (₹/kWh, ₹/MWh, or ₹ lakh/MW/month?)
- If they are in the same unit, why is `L1` below the minimum bid shown?
- Is `L1` the current lowest bid, or a reserve/ceiling price set by the buyer?

**B3. Reverse Auction — `remainingTime` does not agree with the other timestamps**

The same sample carries:

> `"remainingTime": "07:39:34"`, `"lastUpdate": "06-01-2026 16:44:59.529"`, `"auctionCloseTime": "07-01-2026 20:00"`, and a response `"timestamp": "13-01-2026 12:54:07"`

The gap between `lastUpdate` and `auctionCloseTime` is roughly 27 hours, not 7h 39m, and the response `timestamp` is a week after both.

Which clock is `remainingTime` measured against — the response `timestamp`, `lastUpdate`, or the server's current time at the moment of the call? We need this to know whether an auction is still open at the time we read the response.

**B4. Trade Margin — `TotalTrades` does not match the applications returned**

The sample declares:

> `"TotalTrades": 10` and `"NumberOfPortfolios": 1`

but contains only **one** application under the single portfolio.

Is the sample truncated for readability, or does `TotalTrades` count something other than applications (for example individual matched trades that are aggregated into one application)? We reconcile portfolio and entity totals against the rows underneath them, so we need to know what this figure is counting.

**B5. Trade Margin — units are not stated for `Price` and `TradedQty`**

The TAM-GTAM documents name their fields explicitly (`PriceRsMWh`, `TradedQtyMWh`). Trade Margin uses bare `Price`, `TradedQty` and `QtyforSchedule`.

From the sample, `Price 4500.00 × TradedQty 100.00 = TradeValue 450000.00`, which is consistent with ₹/MWh and MWh. Please confirm this is correct, and confirm the unit of `QtyforSchedule`.

**B6. The daily TAM-GTAM response omits two margin fields the other endpoints carry**

The daily TAM-GTAM sample ends its application object with:

> `TotalPayinPayout`, `ApplicableMargin`, `BalanceMargin`, `MarginRelease`

The slot-wise sample additionally carries `InitialMargin(Post-Trade Margin)` and `DeliveryMargin`, and the Trade Margin API carries both as well.

Does the daily TAM-GTAM endpoint actually return `InitialMargin` and `DeliveryMargin`, or are those genuinely absent from that response? If absent, we cannot reconcile daily billing margins against the Trade Margin report without also calling the slot-wise endpoint.

**B7. Confirmation of the margin relationship**

In the Trade Margin sample, `InitialMargin 50,000 + DeliveryMargin 200,000 = ApplicableMargin 250,000 = TotalMargin 250,000`.

Please confirm whether `ApplicableMargin = InitialMargin + DeliveryMargin` and `TotalMargin = ApplicableMargin` hold as general rules, or whether that is a coincidence of this sample. Also please define `BalanceMargin` and `MarginRelease`, which appear in the billing responses but are not explained in any document.

---

## C. Field-level confirmations

**C1. Exact JSON key casing**

JSON keys are case-sensitive, and a key we read with the wrong casing returns zero silently rather than raising an error. The documents are internally inconsistent, so we need the exact casing as emitted by the API:

| Observation | Where |
|---|---|
| `TradedQtyMWh` (lower-case *h*) alongside `SchedulingRequestedInvoiceQtyMWH`, `TotalScheduledAcceptedInvoiceQtyMWH`, `RealTimeCurtailmentMWH`, `FinalscheduledQtyMWH` (upper-case *H*) | Same object, slot-wise |
| `FinalscheduledQtyMWH` (lower-case *s*) vs `TotalScheduledAcceptedInvoiceQtyMWH` (upper-case *S*) | Slot-wise |
| `InitialMargin(PostTradeMargin)` vs `InitialMargin(Post-Trade Margin)` | Daily/Trade Margin vs slot-wise |
| `PortfolioId` vs `PortfolioID` | TAM-GTAM vs Member DOR |
| `delivery_date_from`, `delivery_date_to` in snake_case inside an otherwise PascalCase object | Member DOR |
| `fromTime`, `toTime`, `Mw`, `Mwh` in the slot objects, PascalCase in the parent | Slot-wise |
| `QtyforSchedule` (lower-case *f*) | Trade Margin |
| `auctionID` vs `sellerId` | Reverse Auction |

A machine-readable sample response for each endpoint (a `.json` file rather than a PDF) would settle all of these at once and would be the single most useful thing you could send us.

**C2. Date format and time zone**

Requests are consistently `YYYY-MM-DD`. Responses are not:

- TAM-GTAM: `"Date": "06-11-2025"`, `"DeliveryDate": "01-02-2026"`
- Format-D: documented as `DD-MM-YYYY`
- Member DOR: `"delivery_date_from": "2026-01-11"` — `YYYY-MM-DD`
- Reverse Auction: `"lastUpdate": "06-01-2026 16:44:59.529"`

Please confirm that every response date **other than Member DOR** is `DD-MM-YYYY`. Misreading this silently swaps day and month for the first twelve days of every month, which would corrupt settlement periods without producing any error.

Please also confirm the time zone for all timestamps (we assume IST), as it is not stated in any document.

**C3. Reverse Auction — `deliveryMonth` carries a full date**

The field is named `deliveryMonth` but the sample value is `"07-01-2026"`, a complete date. Does this represent a delivery month, a specific delivery date, or the auction date?

**C4. Format-D — a populated sample, and the two price fields**

Every field in the Format-D sample is `""` or `0`, so we have no example of real values.

Could you share one populated response? In particular we need to know:

- How `TransactionPrice` and `TransactionRate` differ — what unit and basis each uses
- The unit of `ScheduledVolume` (MW or MWh)
- Whether `EndTime` for a full day is rendered as `"24:00"` or `"00:00"`

**C5. Slot-wise — block numbering**

The sample's first slot is `{"fromTime": "00:15", "toTime": "00:30"}`.

- Does a full delivery day contain 96 slots beginning `00:00`–`00:15`, or does the first slot begin at `00:15`?
- Are slots labelled by their start time or their end time?
- How is the final slot of the day rendered — `23:45`–`24:00` or `23:45`–`00:00`?

We have deliberately not renumbered slots onto block indices, because guessing wrong would shift every block by fifteen minutes.

**C6. `BuySell` convention across endpoints**

Member DOR states `B = Buyer`, `S = Seller`. Please confirm the same convention applies in TAM-GTAM, Slot-Wise and Trade Margin, and that the value is always a single character.

---

## D. Operational

**D1. Response codes and the error envelope**

The three document sets wrap their payload three different ways:

| APIs | Envelope |
|---|---|
| TAM-GTAM, Slot-Wise, Format-D, Trade Margin | `ResponseStatus.Code` (`"CNSAPI-200"`) + `ResponseStatus.Message`, payload under `ResponseBody` |
| Member DOR | `ResponseStatus.StatusCode` (`"200"`) + `ResponseStatus.StatusMessage` |
| Reverse Auction | flat `message` / `statuscode` (integer) / `data` / `timestamp`, no wrapper |

We have normalised these on our side. Please confirm the above is accurate and stable, and share the full list of possible `Code` values (for example any `CNSAPI-4xx` / `CNSAPI-5xx` equivalents), together with the body shape returned on a 400 and a 401.

This matters because **a 200 response with an empty body is a normal outcome on a non-trading day**, and we must be able to distinguish it from a genuine failure rather than treating either one as the other.

**D2. Date-range limits and pagination**

- Is there a maximum span for `fromdate`–`todate` on any of the five date-ranged APIs?
- Is any response paginated? Format-D returns `TotalCount`, but no `page`, `offset` or `limit` parameter is documented. If a large range exceeds a page size, how do we retrieve the remainder?

**D3. Rate limits and polling**

The Reverse Auction L1 Summary takes no date parameter, so it returns only the current live state and cannot be backfilled.

- Is there any date or auction-ID filter for retrieving past auctions?
- If the endpoint must be polled, what polling interval is acceptable to you? We would drive it from `remainingTime` and `auctionCloseTime` and back off outside auction windows, but we do not want to breach a limit.
- Please confirm whether any rate limit applies to the other five APIs.

**D4. `reportType=EXCEL`**

- What does the response look like for `reportType=EXCEL` — a binary file body, or a URL to a generated file? What `Content-Type` is returned?
- The slot-wise document lists JSON only as its output while the other five list JSON/EXCEL. Is `reportType=EXCEL` supported on the slot-wise endpoint?

**D5. `portfolioId`**

Three of the APIs accept an optional `portfolioId` (documented examples `KARC10020001` and `PXIL10020001`; the Member DOR sample shows `PortfolioID: "524"`, a plain number).

Could you confirm the portfolio identifier(s) associated with our membership, and the format we should send?

Please also confirm that the token scopes the response to our entity automatically — that is, that we will only ever receive our own data and do not need to pass an entity identifier.

**D6. When does a trade date's data become available, and can it change afterwards?**

Two questions that determine how we schedule our syncs and whether we can treat a figure as final:

- **Availability.** For a given trade or delivery date, at what point is the data complete on each API? Is billing data available the same evening (T+0), the next morning (T+1), or only after a settlement run? If the timings differ between the six APIs, please indicate which.
- **Revisions.** Can figures for a past date be revised after they are first published — for example following a curtailment adjustment, a correction, or a settlement re-run? If so, is there any way to detect that a previously fetched date has changed (a revision number, a last-modified field, or a published-at timestamp)?

If revisions are possible and undetectable, we would need to re-pull a rolling window rather than fetch each date once, so please let us know either way.

**D7. Token lifecycle**

- Does the issued API token expire? If so, what is its validity period and what is the renewal process?
- Is there a rotation procedure we should follow, and will we be notified before a token is invalidated?
- Who should we contact if the API is unavailable during a settlement window, and is there an availability window during which the APIs are down for maintenance?

---

## Next steps

Our integration layer is built and running against the documented shapes, so once the above are confirmed we can switch environments and begin validation immediately. We propose:

1. You confirm the points above and, if applicable, issue staging credentials.
2. We run a read-only pull for an agreed historical date range and share the reconciliation output with you — including the Member DOR `Total` check in B1 and the Trade Margin totals in B4, so any remaining gap is visible to both sides on real data rather than on samples.
3. On your sign-off we repeat against production and confirm Phase 1 complete.
4. We then begin the DAM and RTM modules, for which we will need the session token generated in staging as you mentioned.

One note on DAM/RTM for when we reach it: the staging endpoint is given as `ws://apieastern.pxil.in/`, which is an unencrypted WebSocket. Please confirm whether a `wss://` endpoint is available. We would prefer not to carry session tokens or order data over an unencrypted connection even in a test environment.

If it is easier to answer in stages, **A1 to A5 and B1 to B2 are the ones that hold us up** — the rest can follow. A short team call this week would let us close them quickly, and we are available at your convenience.

Warm regards,

Kshitij Sharma
ERP Cell
SJVN Limited, Corporate HQ, Shimla
