# Email draft — NOAR Trader API clarifications

> **STATUS: DRAFT — not sent.**
> The integration is built and passing against a recorded-shape mock
> (`backend/src/services/noarTraderService.js`, `backend/tests/noarTraderApi.test.js`).
> It cannot make its first real call until items 1 and 2 are settled. Items 3–6
> are correctness questions: each one, answered wrongly, produces numbers that
> look plausible on screen and are wrong.

**Send from your SJVN address** (@sjvn.nic.in)

**To:** noar@grid-india.in
**Cc:** in_noar_support_pwc@pwc.com; kiran.a.kumari@pwc.com; dattagadekar@grid-india.in

**Subject:** NOAR Trader API — key issue, IP whitelisting and field clarifications — SJVN Limited

---

Dear Sir / Madam,

Thank you for the Trader API Implementation Guide and the Postman collection
(mail of 15-Sep-2026, with production `external.noar.in` and test
`devdr.noar.in:84`). We have built the integration against
`Report/ApplicantBilateralApplicationData` and are ready to test. Seven points
before we can call the test environment:

1. **API key and secret.** Clause 1.1 of the guide has the trader generate the
   pair from their own NOAR login under *API Integration*. Please confirm that
   SJVN's existing NOAR trader login carries that menu, and that a key
   generated on the production portal is also valid at `devdr.noar.in:84` — or
   tell us which login to use on the test environment.

2. **IP whitelisting.** Clause 1.5 requires mutual IP whitelisting. Please
   confirm the address SJVN should register for outbound calls and whether
   Grid India needs anything from our side to complete it. Also, is there a
   separate whitelist for the test host?

3. **Status codes.** The response carries `Status`, `BidStatus`,
   `CongestionStatus` and `PaymentStatus` as bare integers (the guide's example
   shows `Status: 50`, `CongestionStatus: 30`). The guide does not define these
   enumerations. Please share the code lists. Until then we store the values
   as received and do not act on them — our open-access workflow status is not
   driven by them.

4. **Date range limit.** Is there a maximum span for `FromDate`–`ToDate` on
   this report, and a maximum number of applications returned in one response?
   We currently request in windows of one month, following your example.

5. **`isRejected`.** We read it as: `false` returns live applications and
   `true` returns rejected ones only — so a full picture needs both calls.
   Please confirm, and confirm whether a rejected application still carries its
   `ApprovalNo` and `ApprovedMWH`.

6. **Date formats in the response.** `FromDate`/`ToDate` on the application
   come back as `DD/MM/YYYY`, while the same fields inside
   `ApplicationApprovedSummary` / `ApplicationAppliedSummary` come back as the
   integer `YYYYMMDD`. Please confirm this is intended and stable, as we parse
   both.

7. **One key, two systems.** The *Create API Key* dialog in the guide (page 9)
   states: "Existing API key, if created any earlier, will be deactivated and
   you should update your integration with this new key." So a login holds one
   active key at a time. SJVN's existing ISET application may already use a key
   from this login, and generating one for the new platform would cut it off.
   Please confirm (a) that this one-active-key rule still applies on the
   current portal, and (b) that the same key pair may be used from two servers
   — ISET's and the new platform's — provided both IPs are whitelisted.

One further request: are any other trader endpoints published on this gateway —
in particular anything covering NOAR charges/payments or application submission?
The guide documents only the bilateral application data report.

Thanks and regards,

Kshitij Sharma
SJVN Limited
