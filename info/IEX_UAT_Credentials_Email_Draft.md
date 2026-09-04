# Email draft — IEX UAT credentials + IP whitelisting request

**Send from your SJVN address** (`@sjvn.nic.in`), not a personal ID — Sandeep specifically asked for the mail to come from an SJVN id.

**To:** sandeep.kumar3@iexindia.com
**Cc:** sudhir.bharti@iexindia.com; _(your reporting officer at SJVN CHQ Shimla)_

**Subject:** Request for IEX UAT API Credentials and IP Whitelisting — SJVN Limited (CHQ Shimla)

---

> **⚠️ Fill these before sending — do not send with placeholders:**
> - `<PUBLIC_IP>` — the **public** egress IP of the server that will call the IEX API. The deploy target in this repo is `192.168.58.63`, which is a private LAN address and **cannot** be whitelisted. Get the public NAT/gateway IP from SJVN IT/Networks. If traffic egresses through more than one gateway, list every IP or IEX will intermittently block us.
> - `<MEMBER_ID>` / `<PARTICIPANT_ID>` — SJVN's existing IEX membership details.
> - `<DESIGNATION>` — your designation.

---

Dear Sandeep Sir,

Further to our telephonic discussion, I am writing from my official SJVN address as requested.

SJVN Limited is developing an in-house Power Trading and Settlement platform, and we require **IEX UAT (test environment) API credentials** to complete and validate our integration before any connection is made to the production environment.

**1. Organisation details**

| | |
|---|---|
| Organisation | SJVN Limited |
| Office | Corporate Headquarters, Shimla |
| IEX Member ID | `<MEMBER_ID>` |
| Participant ID | `<PARTICIPANT_ID>` |
| Requested by | Kshitij Sharma, `<DESIGNATION>` |

**2. Market segments**

We require UAT access for the following segments:

| Segment | Purpose |
|---|---|
| DAM (Day-Ahead Market) | Bid submission, cleared-schedule and PQ result retrieval |
| G-DAM (Green Day-Ahead Market) | Same as above, green obligation tracking |
| RTM (Real-Time Market) | Same as above |
| HP-DAM (High Price Day-Ahead Market) | Same as above |
| REC | Order and trade result retrieval |
| ESCerts | Order and trade result retrieval |

If any of these segments require a separate application or approval, please let us know and we will initiate it.

**3. Public IP for whitelisting**

Please whitelist the following public IP address at the IEX server:

```
<PUBLIC_IP>
```

Kindly confirm once whitelisting is complete, and let us know whether the same IP will need to be re-submitted separately for the production environment when we get there.

**4. Credentials and details required**

To complete the integration we would need the following for UAT:

1. API token / authentication credentials
2. UAT Login User ID and Participant ID
3. UAT API base URL
4. Access to the **Asset Master** API for our segments — we need `OrderPriceDecimal` and `OrderQuantityDecimal`, as quantities and prices are transmitted as scaled integers and an incorrect scaling factor would misstate values by orders of magnitude
5. Confirmation that we are working from the correct specification — we currently hold **IEX CnS API 2.0 for Members**. Please confirm this is the current version for UAT, or share the applicable document.

**5. Scope of testing**

Our UAT usage will be limited to read-only report retrieval and order submission within the test environment only. Bid submission against the production API will not be enabled until UAT validation is signed off and SJVN has issued internal approval, as it commits real positions.

We would be grateful if the credentials could be issued at the earliest so we can begin validation. Please let us know if any additional documentation, undertaking, or formal request on SJVN letterhead is required from our side — we will arrange it immediately.

Thank you for your assistance.

Warm regards,

**Kshitij Sharma**
`<DESIGNATION>`
SJVN Limited, Corporate Headquarters
Shimla, Himachal Pradesh
`<phone>` | `<official SJVN email>`
