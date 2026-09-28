# Email draft — NOAR: questions the live data raised (whitelisting NOT needed)

> **STATUS: DRAFT — not sent. RE-SCOPED 28-Sep-2026, read this first.**
>
> **The whitelisting request this file used to contain is no longer needed.** We
> called the live registry from an ordinary, unregistered ISP address and
> `external.noar.in` answered **NOAR-200 with 134 real applications**. Production
> does not filter by IP the way PXIL and IEX do, so there is nothing to ask for
> and no reason to tell them which address we call from. Asking would only invite
> a restriction that does not exist today.
>
> The same credentials get a bare **401 on `devdr.noar.in:84`**, so the key is
> production-only and the "which environment" question is answered too.
>
> What remains are three things the live data raised, all of which need PwC as
> much as Grid India. They belong with the existing questions in
> `docs/NOAR_Trader_API_Clarifications_Email_Draft.md` — send them together rather
> than as a mail of their own, and **do not quote the key or the secret**.

**To:** noar@grid-india.in
**Cc:** in_noar_support_pwc@pwc.com; dattagadekar@grid-india.in; kiran.a.kumari@pwc.com

**Subject:** NOAR Trader API — three observations from live data — SJVN Limited

---

Dear Team,

We are now reading SJVN's own open-access applications through the Trader API, and
the responses have raised three points on which we would value your confirmation.
Our observations are from **422 applications returned over a four-month range**.

## 1. Does this report ever return an application that was not approved?

Every one of the 422 records carried `Status` 50, `PaymentStatus` 50, `BidStatus` 0,
`CongestionStatus` 0, an `ApprovalNo`, and a non-zero `ApprovedMWH`. Not one was
pending, rejected, or approved short of what was applied for.

Kindly confirm whether **`ApplicantBilateralApplicationData` returns approved
applications only**. It matters because we had intended to use this feed to notice
an application that is still pending or has been rejected — and if the feed cannot
express those states, we will keep tracking them on the portal instead of relying
on it.

## 2. `isRejected` appears to have no effect

For the same date range, `isRejected: true` and `isRejected: false` returned the
**identical 134 records**, matched by `Id`. Kindly confirm what this flag is
intended to do, and how a member is expected to retrieve rejected applications.

## 3. The numeric status codes

Because there is no variation in live data, we still cannot infer the meaning of
`Status`, `BidStatus`, `CongestionStatus` and `PaymentStatus`. Kindly share the
enumeration for each. Our platform deliberately does **not** act on these codes
today — it reconciles only on the approval number and the MWh figures, which are
plain values — and we would rather keep it that way than guess at a code that
drives an approval workflow.

## For your information

The one-month maximum stated for this report does not appear to be enforced: a
120-day request returned 422 records rather than an error. We nevertheless keep our
requests inside 31 days, in case that changes.

Thanks and regards,

`<YOUR_NAME>`
`<DESIGNATION>`, ERP Cell
SJVN Limited, Corporate HQ, Shimla
`<phone>`
kshitij.sharma@sjvn.nic.in
