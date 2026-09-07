# Email draft — IEX Front Office API clarifications

**Send from your SJVN address** (@sjvn.nic.in)

**To:** sandeep.kumar3@iexindia.com
**Cc:** sudhir.bharti@iexindia.com

**Subject:** IEX FO API (UAT/Alpha) — base URL, token validity and REC/ESCerts documents — SJVN Limited (N2DL0SJV0000)

---

> **Why this email exists**
>
> The integration is built and tested against the four FO API documents IEX
> supplied (DAM 2.2, GDAM 2.0, HPDAM 2.0, RTM 2.0). It cannot make its first
> live call until questions 1 and 2 are answered — neither is in any document
> we hold. Questions 3–5 are correctness issues that would produce plausible
> but wrong numbers if we guessed.

---

Dear Sandeep Sir,

Thank you for the UAT credentials and for whitelisting our IP (49.50.97.173).
We have completed the client-side implementation for DAM, GDAM, HPDAM and RTM
against the Front Office API documents. Before we begin UAT testing, we need
the following clarifications:

**1. API base URL (blocking)**

None of the four API documents states the host name. They give paths only, e.g.
`dam/api/v2/pqresults/{LoginUserId},{ParticipantId},{DeliveryDate}`. Please
confirm the full base URL for:

- UAT (Alpha):
- Production (Live):

**2. Token validity and renewal (blocking)**

The UAT token issued to us (User ID `SJVA1`) carried a one-hour validity
(`iat` 26-07-2026 08:51 UTC, `exp` 26-07-2026 09:51 UTC). The API documents
describe the token only as "as provided by Exchange" and define no login or
token-refresh endpoint, while the CnS document defines error `CNSAPI-509 Token
is expired`. Please confirm:

- a. Is there a login/authentication endpoint that issues a fresh token
  programmatically? If yes, please share its URL, request body and headers.
- b. If not, what is the intended validity period of a member token in UAT and
  in production, and what is the process for renewal?
- c. Please issue a currently-valid UAT token so we can begin testing.

**3. Delivery date — which midnight?**

`DeliveryDate` is documented as "Value in seconds from 01-01-1970". Please
confirm whether these seconds represent midnight **IST** or midnight **UTC**
for the delivery day. The two differ by 5 hours 30 minutes, which is enough to
address the neighbouring trading day.

*(Our client currently reads the epoch values returned by the Delivery Date
API and uses those verbatim, falling back to IST midnight only when that API
cannot be reached. A confirmation would let us remove the fallback.)*

**4. Decimal scaling in the Portfolio Schedule Report**

Bid and trade fields carry an explicit note — "Refer Price tick and Order Price
Decimal at Asset Master API". The Portfolio Schedule Report fields
(`AreaPrice`, `AreaBuyQty`, `AreaSellQty`, and `Quantity` / `SingleBidQty` /
`BlockBidQty` under `ScheduleDetails`) carry no such note. Please confirm which
Asset Master factors apply to them — the **Trade** decimals
(`TradePriceDecimal` / `TradeQtyDecimal`) or the **Order** decimals.

**5. REC and ESCerts API documents**

Our UAT entitlement covers REC, and our original request also covered ESCerts,
but we have not received Front Office API documents for either segment. Kindly
share them so we can extend the integration.

**6. Confirmation of scope**

For our records, please confirm the segments enabled for `N2DL0SJV0000` in UAT.
Your mail of 04-09-2026 lists "iDAM, HPDAM, RTM & REC". Please confirm whether
**iDAM** is served by the DAM 2.2 API document (`dam/api/v2/...`) or has a
separate document, and whether **G-DAM** is included.

Kindly let us know if any additional formality is required from our side.

Regards,

Kshitij Sharma
ERP Cell
SJVN Corporate HQ, Shimla
