# Reply draft — PXIL: IP for whitelisting, and dates for B1–B2

**To:** gaurav.tiwari@pxil.co.in
**Cc:** it@pxil.co.in; avadheshkumar.bari@pxil.co.in
**Subject:** Re: PXIL API Documentation — clarifications before Phase 1 integration

> **17 Sep update:** on a call PXIL asked us to work on staging first. Over WhatsApp they confirmed the staging URL `https://stagingmypratyaydashboard.pxil.in/` (same paths), sent a staging token, and said staging needs its own IP whitelisting, which they will confirm once done. A3 and A4 below have been rewritten to match.
>
> **Before sending:** confirm the server's outbound IP. The simplest way is to run `node backend/scripts/pxilProbe.js` on the server: PXIL's 403 shows the IP it saw. `curl -s ifconfig.me` works too. The app servers are on private addresses (10.10.237.60 / 192.168.58.63), so PXIL sees a NAT address. IEX whitelisted `49.50.97.173`, but that has not been proven to be our outbound address. **Do not send `223.31.159.139`.** That is the development Mac, which PXIL staging refused on 17 Sep.

---

Dear Gaurav,

Thank you for the quick and clear reply, and for the revised documents. We have updated our integration to match:

- **A1:** the daily report now calls `/PXILPublish/api/tam-gtam/`.
- **A2:** TAM-GTAM, TAM-GTAM Slot-Wise, Format-D and Trade Margin use the Bearer token. Member DOR and Reverse Auction L1 Summary pass the token as `APITokenNo` in the query string. Please let us know when those two support the Bearer token, and we will switch them over.
- **A3:** as agreed on the call, we will start on staging (`https://stagingmypratyaydashboard.pxil.in/`) with the staging token, then run the same calls on production (`https://dashboard.pxil.in/`) to reconcile actual figures.
- **A5:** we use every URL exactly as it appears in the revised documents, with the trailing slash.

**A4 — IP to whitelist**

Please whitelist this public IP address on **both staging and production**:

```
49.50.97.173
```

This is the only address our calls will come from. Please let us know once staging is done, and we will make a first read-only call on all six APIs the same day.

**Staging data.** You mentioned that staging data is stale. Could you tell us which dates it covers? We will query within that range, so an empty response is not mistaken for a failure.

**One small point on the revised documents.** The Member DOR and Reverse Auction L1 Summary documents still say "Auth Type: Bearer Token", but they also list `APITokenNo` as a required query parameter. We are following your email, which says these two do not support the Bearer token yet. You may want to correct the documents so no one else is confused.

**B1–B2 — dates**

B1 and B2 do not come from live data. We have not called the APIs yet because our IP was not whitelisted. Both issues are in the **sample responses printed in the API documents**, and the revised documents you sent still contain them:

- **B1:** `Member_DOR_API_Document.pdf`, section 4 (page 2), application `MG320260101WR32983`, delivery date 11-01-2026. `Total` is 14,42,000.683, but the listed `Category` values add up to 13,26,614.363, which is 1,15,386.32 less.
- **B2:** `Reverse_Auction_L1_Summary_API_Document.pdf`, section 4 (page 2), auction `AnydaySSC_R/05012026040244`. `L1` is 5.5, but the seller bids are 89 and 41.

So the question is about the documents: are these samples illustrative only, or do they show how the live figures are built? In particular, what does `Total` include beyond the listed categories, and what unit is `L1` in compared with `bidPrice`?

Once our IP is whitelisted, we will run the same check on staging, and then on production. If the gap appears there too, we will send you the exact application numbers and delivery dates.

The remaining points in our earlier note (B3–B7, C and D) do not block us, and you can answer them whenever convenient. The one that would help most is **C1**: a sample `.json` response for each API, which would settle field names and date formats.

A call would be welcome whenever it suits your team.

Warm regards,

Kshitij Sharma
ERP Cell
SJVN Limited, Corporate HQ, Shimla
