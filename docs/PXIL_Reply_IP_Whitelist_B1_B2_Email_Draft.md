# Reply draft — PXIL: IP for whitelisting, and where B1–B2 come from

**To:** gaurav.tiwari@pxil.co.in
**Cc:** it@pxil.co.in; avadheshkumar.bari@pxil.co.in
**Subject:** Re: PXIL API Documentation — clarifications before Phase 1 integration

> **Status.** PXIL (Gaurav Tiwari) has answered A1–A5 by email and asked, against B1–B2, for
> "the exact date or date range for which you are facing these issues". This reply answers that.
>
> **A3 changed.** On the 17 Sep call PXIL asked us to start on staging, and sent a staging URL and
> token. Their written reply supersedes that: staging has no data, so **production**
> (`https://dashboard.pxil.in/`) is the environment to use. Point `PXIL_BASE_URL`/`PXIL_API_TOKEN`
> at production, not at `stagingmypratyaydashboard.pxil.in`.
>
> **Before sending — confirm the outbound IP.** `49.50.97.173` is the public IP IEX whitelisted for
> this server and is the address given to WBES and NOAR as well. Confirm it is still what PXIL will
> see by running `node backend/scripts/pxilProbe.js` on the server (a 403 reports the IP PXIL saw),
> or `curl -s ifconfig.me`. **Do not send `223.31.159.139`** — that is the development Mac, which
> PXIL refused on 17 Sep.

---

Dear Gaurav,

Thank you for the clear responses and for the revised documents. Our integration is updated to match:

- **A1:** the daily report calls `/PXILPublish/api/tam-gtam/`.
- **A2:** TAM-GTAM, TAM-GTAM Slot-Wise, Format-D and Trade Margin use the Bearer token; Member DOR and Reverse Auction L1 Summary pass the token as `APITokenNo` in the query string. We will switch those two over whenever you upgrade them — please let us know when that happens.
- **A3:** understood — we will work directly against production, `https://dashboard.pxil.in/`, and will not use the staging environment.
- **A5:** we use every URL exactly as printed in the revised documents, including the trailing slash.

**A4 — IP to whitelist**

Please whitelist this public IP address on production:

```
49.50.97.173
```

This is the only address our calls will originate from. Once whitelisting is done, please confirm, and we will make a first read-only call on all six APIs the same day.

**B1–B2 — where these come from**

To answer your question directly: these are not issues we hit on live data. We have not been able to call the APIs at all yet, as our IP is not whitelisted. Both points are in the **sample responses printed in your API documents**, and they are still present in the revised documents you have just sent.

- **B1 — Member DOR.** `Member_DOR_API_Document.pdf`, section 4 (page 2). Sample application **`MG320260101WR32983`**, **delivery date 11-01-2026**. The `Total` is 14,42,000.683, but the `Category` values listed in the same sample add up to 13,26,614.363 — a difference of 1,15,386.32.
- **B2 — Reverse Auction L1 Summary.** `Reverse_Auction_L1_Summary_API_Document.pdf`, section 4 (page 2). Sample auction **`AnydaySSC_R/05012026040244`**, `deliveryMonth` **07-01-2026**, `lastUpdate` 06-01-2026. The `L1` is 5.5, while the seller bids shown in the same sample are 89 (Hari Om enterprises, S1042) and 41 (Mahesh Chemicals, S1043).

So the question is about the documents rather than about a particular trading day: are these samples illustrative only, or do they show how the live figures are built? Specifically, what does `Total` include beyond the listed categories, and in what unit is `L1` expressed compared with `bidPrice`?

If it helps your team to check against real data, the identifiers in those samples are application **`MG320260101WR32983`** for delivery date **11-01-2026** (Member DOR) and auction **`AnydaySSC_R/05012026040244`** for delivery **07-01-2026** (Reverse Auction). Once our IP is whitelisted we will run the same check on production ourselves and, if the gap appears in live data too, send you the exact application numbers and delivery dates.

**One small point on the revised documents.** The Member DOR and Reverse Auction L1 Summary documents still state "Auth Type: Bearer Token" while also listing `APITokenNo` as a required query parameter. We are following your email, which says these two do not yet support the Bearer token. You may want to correct the documents so that no one else is caught by this.

The remaining points in our earlier note (B3–B7, C and D) do not block us and can be answered at your convenience. The most useful would be **C1**: a sample `.json` response for each API, which would settle field names and date formats in one go.

A call would be welcome whenever it suits your team.

Warm regards,

Kshitij Sharma
ERP Cell
SJVN Limited, Corporate HQ, Shimla
