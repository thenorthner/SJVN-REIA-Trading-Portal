# Reply draft — PXIL API integration clarifications

**To:** gaurav.tiwari@pxil.co.in
**Cc:** it@pxil.co.in
**Subject:** Re: PXIL API Documentation — clarifications before Phase 1 integration (Billing, Format-D, Obligation Report, Reverse Auction, Trade Margin)

---

Dear Gaurav,

Thank you for the API documentation and access details. We have completed a full review of the five Phase 1 modules and have begun implementation against the documented request/response shapes.

Before we point the integration at your environment, we need clarification on the following points. Items 1–4 are blocking; items 5–9 are needed to finalise parsing and avoid silent data errors.

## Blocking

**1. TAM-GTAM (daily) endpoint URL appears to be incorrect**

Both `TAMGTAM_API_Document.pdf` and `TAMGTAM_Slot_Wise_API_Document.pdf` list the same API URL:

```
https://dashboard.pxil.in/PXILPublish/api/tam-gtam-slot-wise/
```

We assume this is a copy-paste error in the daily document. Could you confirm the correct path for the daily/aggregate TAM-GTAM API — is it `/PXILPublish/api/tam-gtam/`?

**2. Two different authentication mechanisms across the five APIs**

- TAM-GTAM, TAM-GTAM Slot-Wise, Format-D, Trade Margin — documented as `Authorization: Bearer <token>` (header)
- Member DOR, Reverse Auction L1 Summary — documented as `APITokenNo` passed as a **query parameter**

Could you confirm this is intentional? If the gateway accepts the Bearer header on all five, we would prefer to standardise on the header. Passing the token in a query string means it is recorded in web-server access logs, proxy logs and browser/referrer history, which is a credential-handling risk on both sides. If the query parameter is mandatory for those two endpoints, please confirm and we will handle them separately with logging suppressed.

**3. Environment for the issued token**

Your email lists the API URL as `https://dashboard.pxil.in/`, but the example request in `Member DOR API Doc.pdf` is against:

```
https://stagingmypratyaydashboard.pxil.in/PXILPublish/api/member-dor/
```

Please confirm:
- Is the token you shared valid for production (`dashboard.pxil.in`), staging, or both?
- We would prefer to complete first-pass integration and validation against **staging**. Could you confirm the staging base URL for all five Phase 1 APIs and issue a staging token if it differs?

**4. Member DOR sample response — Total does not equal the sum of Category**

In the sample response, the `Category` values sum as follows:

| Field | Value |
|---|---|
| Charges | 0 |
| Fees | 4,760.35 |
| IGST | 856.863 |
| CGST | 0.0 |
| SGST | 0.0 |
| CP | 13,20,997.15 |
| **Sum** | **13,26,614.363** |
| **`Total` as stated** | **14,42,000.683** |
| **Difference** | **1,15,386.320** |

The document annotates `Charges` as `APPLICATION + OPERATING + TRANSMISSION`. Is `Charges: 0` a placeholder in the sample that should have carried the ₹1,15,386.32 difference, or does `Total` include a component not listed under `Category`?

This directly affects how we reconcile obligations against our books, so we need the exact composition of `Total` confirmed.

## Needed to finalise parsing

**5. Reverse Auction L1 Summary has no date parameters**

The parameter table lists only `APITokenNo`. We understand this returns the current live auction state rather than a historical range.

- Is there any date or auction-ID filter available for retrieving past auctions? Without one we cannot backfill or restate history.
- If the endpoint must be polled, what polling interval is acceptable to you? We would work from `remainingTime` / `auctionCloseTime` and back off outside auction windows, but we do not want to breach any rate limit. Please confirm if a rate limit exists on any of the five APIs.

**6. Format-D sample response contains no populated values**

Every field in the sample is `""` or `0`. Could you share one populated sample response so we can confirm value formats — particularly `Product`, `ApplicationNo`, and how `TransactionPrice` and `TransactionRate` differ (units and basis for each).

**7. Date formats differ between request and response, and between APIs**

Requests are consistently `YYYY-MM-DD`. Responses are not:

- TAM-GTAM: `"Date": "06-11-2025"`, `"DeliveryDate": "01-02-2026"` — appears to be DD-MM-YYYY
- Format-D: documented as `DD-MM-YYYY`
- Member DOR: `"delivery_date_from": "2026-01-11"` — YYYY-MM-DD
- Reverse Auction: `"deliveryMonth": "07-01-2026"`, `"lastUpdate": "06-01-2026 16:44:59.529"`

Please confirm that all response dates other than Member DOR are **DD-MM-YYYY**. A misread here silently swaps day and month for the first twelve days of any month, which would corrupt settlement periods without raising an error.

Also, `deliveryMonth` in the Reverse Auction response carries a full date (`07-01-2026`) rather than a month. Could you confirm what this field represents?

**8. Response envelope differs across the three document sets**

- TAM-GTAM / Format-D / Trade Margin: `ResponseStatus.Code` (`"CNSAPI-200"`, string) and `ResponseStatus.Message`, with payload under `ResponseBody`
- Member DOR: `ResponseStatus.StatusCode` (`"200"`) and `ResponseStatus.StatusMessage`
- Reverse Auction: flat `message` / `statuscode` (integer `200`) / `data` / `timestamp`, with no `ResponseStatus` or `ResponseBody` wrapper

We will normalise these on our side. Please confirm the above is accurate and stable, and share the full list of possible `Code` values (e.g. any `CNSAPI-4xx` / `CNSAPI-5xx` equivalents) so we can distinguish "no data for this range" from a genuine failure. This matters because a 200 response with an empty body is a normal outcome for a non-trading day, and we must not treat it as an error.

**9. Slot-wise details — block numbering and field naming**

- The sample shows the first slot as `{"fromTime": "00:15", "toTime": "00:30"}`. Should a full day contain 96 slots beginning at `00:00`–`00:15`, or is the first block `00:15`–`00:30`? Please confirm whether slots are labelled by start time or end time.
- The margin field is spelled `"InitialMargin(PostTradeMargin)"` in the daily and Trade Margin documents but `"InitialMargin(Post-Trade Margin)"` in the slot-wise document. Could you confirm the exact key as emitted by the API?
- The slot-wise document header lists JSON only as output, while the other four list JSON/EXCEL. Is `reportType=EXCEL` supported on the slot-wise endpoint?

## Next steps from our side

We have built the integration layer against the documented shapes and it is running in stub mode, so once the above are confirmed we can switch to your environment and begin validation immediately. Our suggested sequence:

1. You confirm the above and, if applicable, issue staging credentials.
2. We run a read-only pull for an agreed historical date range on staging and share the reconciliation output with you.
3. On sign-off, we repeat against production and confirm Phase 1 complete.
4. We then begin the DAM and RTM WebSocket modules, for which we will need a session token generated in staging as you mentioned.

One note on DAM/RTM for when we get there: the staging endpoint is listed as `ws://apieastern.pxil.in/`, which is unencrypted. Please confirm whether a `wss://` endpoint is available, as we would not want session tokens or order data traversing an unencrypted connection even in staging.

A team call would be helpful to close items 1–4 quickly. We are available at your convenience this week.

Warm regards,

Kshitij Sharma
SJVN Energy Platform
