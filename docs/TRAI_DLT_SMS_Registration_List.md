# TRAI / DLT registration list — SMS alerts from the SJVN platform

**Prepared:** 28 September 2026
**Scope:** every alert the platform sends, or is designed to send, to a mobile number.
**Count:** 50 content templates — the flat, forwardable version is `docs/SMS_Alerts_Single_List.md`.
**Modules covered:** REIA Commercial Hydro Billing, Billing & Invoicing, and the
remaining modules that already carry an SMS path (Disputes, NOAR / Power Trading).

---

## 1. What "TRAI permission" actually is

There is no single permission to ask TRAI for. Outbound commercial SMS in India is
governed by **TCCCPR 2018** (Telecom Commercial Communications Customer Preference
Regulations), and TRAI does not itself issue the approval — it is granted on the
**DLT (Distributed Ledger Technology) platform** operated by each access provider
(Jio TrueConnect, Airtel, Vi VilPower, BSNL, Tata/PingConnect). Registering on one
propagates to the others.

Four separate registrations are needed, in this order:

| # | Registration | Who does it | Granted by | Typical time |
|---|---|---|---|---|
| 1 | **Principal Entity (PE)** — SJVN registers itself, with PAN / GST / CIN and an authorised signatory | SJVN | DLT portal of any one access provider | 1–3 working days |
| 2 | **Header (Sender ID)** — the 6-character string the SMS appears from | SJVN | DLT portal, per category | 1–2 working days |
| 3 | **Content templates** — every distinct message body, with variables marked `{#var#}` | SJVN | DLT portal, per template | 1–2 working days each, batch submission allowed |
| 4 | **Telemarketer chain binding** — linking the gateway (currently **TextGuru**) to SJVN as its registered telemarketer (RTM) | SJVN + TextGuru | DLT portal | same day once both sides confirm |

**The list in Section 4 is what goes into registration #3.** That is the part that
has to be enumerated, and it is the part this document exists for.

### Categories, and which one each of our alerts falls into

| Category | What it covers | Delivered to a DND number? |
|---|---|---|
| **Transactional** | OTP only, and only for entities registered with RBI / SEBI / IRDAI / PFRDA | Yes |
| **Service – Implicit** | Messages arising out of an existing customer / contractual relationship: a bill raised, a payment received, a due-date reminder | Yes |
| **Service – Explicit** | Service content that needs a separately registered consent (e.g. to someone who is not a counterparty) | Only with registered consent |
| **Promotional** | Marketing | No, unless consent |

**Every alert in this document is `Service – Implicit`.** They all arise out of a
live PPA / PSA / bilateral contract or out of the recipient's own employment at
SJVN. None are promotional, and **none are Transactional** — the platform has no
OTP flow (verified: no OTP code path exists in the codebase), and in any case
SJVN is not an RBI/SEBI/IRDAI/PFRDA-registered entity, so the Transactional
category is not available to it.

**Consequence worth knowing:** because these are Service – Implicit, a DISCOM
officer who has set DND still receives them. No consent template is required.

---

## 2. Header (Sender ID) to register

One header covers every template below. Non-promotional headers are **6 alphabetic
characters**.

| Proposed header | Category | Used by |
|---|---|---|
| `SJVNLT` | Service – Implicit | all templates in Section 4 |

Suggest registering a **second header as a fallback** (e.g. `SJVNPW`) in case the
first is already taken by another entity — headers are allotted first-come across
all of India.

Configured in the platform at: Masters → `textguru_sender_id`
(or the `TEXTGURU_SENDER` environment variable).

---

## 3. Summary — how many templates

**50 templates, filed as one batch.** Registering a template does not make it
send: which events actually use SMS is set per event in the platform's master
data (`notification_channel_policy`). The list is therefore deliberately broader
than what is switched on today, because approval is per template and going back
for one more costs another cycle.

| Module | Templates | Wired to the gateway today |
|---|---|---|
| Billing & Invoicing | 12 | 2 |
| Hydro Station Billing | 10 | **0 — no notification of any kind exists** |
| Payment Security | 6 | 0 |
| Disputes | 6 | 2 |
| Reconciliation | 2 | 0 |
| Contract & billing calendar | 4 | 0 |
| Scheduling & deviation | 2 | 0 |
| Regulatory | 1 | 0 (in the SMS policy, but no call site) |
| Account security | 2 | 0 |
| Power Trading (NOAR) | 5 | 5 |
| **Total** | **50** | **9** |

Only **9 of the 50** are wired to the gateway today. The rest are events the
platform already raises as in-app notifications, or — for the whole of Hydro
Station Billing — events that raise nothing at all yet. Filing them now is
insurance against a second approval cycle, not a claim that they work.

**The 9 that are live are mandatory immediately**: that code already calls the
gateway and will start failing DLT scrubbing the moment `sms_enabled` is turned
on without registered templates.

The forwardable version of this list, without the source references and code
notes, is `docs/SMS_Alerts_Single_List.md`.

## 4. The templates

Format notes for whoever files these:

- `{#var#}` is the DLT variable placeholder. Default limit is **30 characters per
  variable**; a value longer than that fails scrubbing at send time.
- Fixed text must match **character for character**, including the `SJVN:` prefix,
  spacing and full stops.
- **No URL, phone number, email address or APK link** appears in any template below.
  This is deliberate — TRAI requires every such link to be separately whitelisted on
  the DLT portal, and traffic carrying an unwhitelisted link is dropped. If a portal
  link is ever added to the invoice SMS, the domain must be whitelisted first.
- All bodies use `Rs` and not `₹`. The rupee sign forces the whole SMS into Unicode
  encoding, which cuts the per-segment length from 160 characters to 70 and roughly
  doubles the cost. Keep it that way.
- Two messages that differ by even one word are **two templates**. Several events
  below therefore appear twice.

---

### Part A — Billing & Invoicing (live in code)

| # | Template ID | Event | Recipient | Category |
|---|---|---|---|---|
| A1 | `INVOICE_SENT` | Invoice despatched to counterparty | DISCOM buyer / generator seller | Service – Implicit |
| A2 | `PAYMENT_RECEIVED` | Payment recorded against an invoice | SJVN Finance desk (internal) | Service – Implicit |

**A1 — Invoice available for payment**
```
SJVN: Invoice {#var#} is available for payment (due {#var#}). View on the portal.
```
Variables: 1 = invoice number, 2 = due date (YYYY-MM-DD).
Source: `backend/src/routes/invoices.js:1746`
Sent to: the counterparty's `corporate_phone`, or the first commercial contact with
a phone number, on `POST /api/invoices/:id/send`.

**A2 — Payment recorded**
```
SJVN: Payment of Rs {#var#} recorded against {#var#}. Status now {#var#}.
```
Variables: 1 = amount in Indian format, 2 = invoice number, 3 = invoice status
(`PARTIALLY_PAID` / `PAID`).
Source: `backend/src/routes/invoices.js:1965`

---

### Part B — Disputes (live in code)

| # | Template ID | Event | Recipient | Category |
|---|---|---|---|---|
| B1 | `DISPUTE_SLA_BREACHED_MGMT` | Dispute SLA breached — escalation to management | SJVN Management (internal) | Service – Implicit |
| B2 | `DISPUTE_SLA_BREACHED_ASSIGNEE` | Dispute SLA breached — notice to the owner | Assigned SJVN user (internal) | Service – Implicit |

**B1**
```
SJVN: SLA breached on dispute {#var#} - escalated.
```
**B2**
```
SJVN: SLA breached on dispute {#var#} assigned to you.
```
Variable: dispute number.
Source: `backend/src/routes/disputes.js:176` and `:182`

> **Note on the dash.** The code currently emits an en-dash (`—`) in B1. An en-dash
> is not in the GSM-7 character set and will push the message to Unicode. Either
> register the template with the en-dash and accept Unicode billing, or change the
> code to a plain hyphen. **Recommend the hyphen** — the template above is written
> with a hyphen and the code should be corrected to match before filing.

---

### Part C — NOAR / Power Trading (live in code)

| # | Template ID | Event | Recipient | Category |
|---|---|---|---|---|
| C1 | `NOAR_APPROVED` | Open-access application approved | SJVN Trading desk | Service – Implicit |
| C2 | `NOAR_REJECTED_SINGLE` | One application rejected | SJVN Management | Service – Implicit |
| C3 | `NOAR_REJECTED_BULK` | Several applications rejected in one action | SJVN Management | Service – Implicit |
| C4 | `NOAR_SLA_BREACHED` | Approval overdue against the internal target | SJVN Management | Service – Implicit |
| C5 | `NOAR_WALLET_LOW` | NOAR wallet below the recharge threshold | SJVN Trading desk | Service – Implicit |

**C1**
```
SJVN: NOAR open-access approved for {#var#} ({#var#}). Schedules can now be punched.
```
**C2**
```
SJVN: NOAR application rejected for {#var#} ({#var#}) - {#var#}
```
**C3**
```
SJVN: {#var#} NOAR application(s) rejected - {#var#}
```
**C4**
```
SJVN: NOAR approval overdue for {#var#} ({#var#}) - {#var#}d pending against a {#var#}d {#var#} target
```
**C5**
```
SJVN: NOAR wallet balance is Rs {#var#}, below the Rs {#var#} threshold. Recharge before the next open-access charge.
```
Sources: `backend/src/routes/bilateral.js:792, :868, :875, :904`;
`backend/src/routes/noar.js:214`

> `NOAR_SLA_AT_RISK` is deliberately **in-app + email only** and needs no template.
> A rejection reason (C2/C3) can easily exceed the 30-character variable limit —
> it must be truncated in code before it is passed to the gateway.

---

### Part D — Billing & Invoicing (to be added)

These events exist and raise an in-app notification today, but do not reach a
mobile. Register the templates now so the channel can be switched on from Masters
without another DLT cycle.

| # | Template ID | Event | Recipient | Category |
|---|---|---|---|---|
| D1 | `INVOICE_SUBMITTED` | Seller bill submitted for SJVN review | SJVN REIA desk | Service – Implicit |
| D2 | `INVOICE_APPROVED` | Invoice cleared the approval chain | Counterparty | Service – Implicit |
| D3 | `INVOICE_REJECTED` | Invoice sent back in approval | Raising party | Service – Implicit |
| D4 | `INVOICE_CANCELLED` | Invoice withdrawn | Counterparty | Service – Implicit |
| D5 | `ARREAR_RAISED` | Arrear recovery bill raised | Counterparty | Service – Implicit |
| D6 | `SUPPLEMENTARY_RAISED` | Supplementary bill raised | Counterparty | Service – Implicit |
| D7 | `PAYMENT_RELEASED` | SJVN released payment to the generator | Generator (seller) | Service – Implicit |
| D8 | `INVOICE_OVERDUE` | Bill past its due date | Counterparty | Service – Implicit |
| D9 | `DC_NOTE_ISSUED` | Debit / credit note issued against a bill | Counterparty | Service – Implicit |

```
D1: SJVN: Seller invoice {#var#} has been submitted for review.
D2: SJVN: Invoice {#var#} is approved and ready for despatch.
D3: SJVN: Invoice {#var#} was returned in approval. Reason: {#var#}
D4: SJVN: Invoice {#var#} has been cancelled. Reason: {#var#}
D5: SJVN: Arrear bill raised for contract {#var#} for period {#var#}, amount Rs {#var#}.
D6: SJVN: Supplementary bill raised for contract {#var#} for period {#var#}, amount Rs {#var#}.
D7: SJVN: Payment of Rs {#var#} released against invoice {#var#}.
D8: SJVN: Invoice {#var#} of Rs {#var#} was due on {#var#} and is outstanding. Late payment surcharge applies.
D9: SJVN: {#var#} note {#var#} of Rs {#var#} has been issued against invoice {#var#}.
```

---

### Part E — REIA Commercial Hydro Billing (to be added)

**The hydro billing module sends no notification of any kind today** — not in-app,
not email, not SMS. Verified across `routes/hydroBilling.js` and all six
`services/hydro*.js` files. Every template below is new.

This matters more than the other parts: one NJHPS monthly bill splits across
**fifteen beneficiary DISCOMs**, and the whole issue → release → despatch → payment
→ LPS chain currently depends on someone watching a screen.

| # | Template ID | Event | Recipient | Category |
|---|---|---|---|---|
| E1 | `HYDRO_BILL_FOR_APPROVAL` | Station bill sent up the approval chain | Named approver (internal) | Service – Implicit |
| E2 | `HYDRO_BILL_APPROVAL_DONE` | Approval chain completed | Maker (internal) | Service – Implicit |
| E3 | `HYDRO_BILL_REJECTED` | Bill rejected in approval | Maker (internal) | Service – Implicit |
| E4 | `HYDRO_BILL_ISSUED` | Bill issued; beneficiary share now payable | Each beneficiary DISCOM | Service – Implicit |
| E5 | `HYDRO_BILL_DESPATCHED` | Printed bill couriered | Each beneficiary DISCOM | Service – Implicit |
| E6 | `HYDRO_PAYMENT_RECEIVED` | Payment received and applied on the ledger | Beneficiary + SJVN Finance | Service – Implicit |
| E7 | `HYDRO_LPS_RAISED` | Late payment surcharge charged | Beneficiary DISCOM | Service – Implicit |
| E8 | `HYDRO_BILL_CANCELLED` | Issued bill withdrawn and ledger reversed | Beneficiary DISCOM | Service – Implicit |

```
E1: SJVN: Hydro bill {#var#} for {#var#} is pending your approval.
E2: SJVN: Hydro bill {#var#} for {#var#} has been approved and can be issued.
E3: SJVN: Hydro bill {#var#} was rejected in approval. Reason: {#var#}
E4: SJVN: Hydro bill {#var#} for {#var#} is issued. Your share is Rs {#var#}, due {#var#}.
E5: SJVN: Hydro bill {#var#} was despatched on {#var#}. Courier reference {#var#}.
E6: SJVN: Payment of Rs {#var#} received against hydro bill {#var#}. Outstanding is now Rs {#var#}.
E7: SJVN: Late payment surcharge of Rs {#var#} charged on hydro bill {#var#} as on {#var#}.
E8: SJVN: Hydro bill {#var#} for {#var#} has been cancelled. Reason: {#var#}
```

**Before E4–E8 can actually be sent, a data gap has to be closed.** The hydro
beneficiaries are held as names on `hydro_beneficiary_allocations`, not as `entities`
rows with a `corporate_phone`. There is no mobile number on record for the fifteen
DISCOMs in the hydro path. Either link each beneficiary to an `entities` row, or add
a contact number to the allocation master. Filing the templates does not depend on
this — sending does.

---

### Part F — Payment Security (billing-adjacent)

| # | Template ID | Event | Recipient | Category |
|---|---|---|---|---|
| F1 | `SECURITY_REPLENISH_DEMAND` | Payment security fell short; replenishment demanded | Counterparty | Service – Implicit |
| F2 | `SECURITY_EXPIRY` | Bank guarantee / LC nearing expiry | Counterparty | Service – Implicit |
| F3 | `SECURITY_INVOCATION` | Instrument invoked against an unpaid bill | Counterparty | Service – Implicit |
| F4 | `SECURITY_SCHEDULING_HOLD` | Scheduling held for inadequate security | Counterparty | Service – Implicit |

```
F1: SJVN: Payment security against contract {#var#} is short by Rs {#var#}. Replenish by {#var#}.
F2: SJVN: Payment security instrument {#var#} against contract {#var#} expires on {#var#}.
F3: SJVN: Payment security instrument {#var#} has been invoked for Rs {#var#} against contract {#var#}.
F4: SJVN: Scheduling on contract {#var#} is on hold - payment security is inadequate.
```

---

## 5. Code changes — done

All four gaps this document originally listed as outstanding have been closed
(29 September 2026). They are recorded here because the DLT filing depends on
knowing what the platform will actually put on the wire.

1. **The registered template id now travels with every message.** `sendSms()`
   resolves it from the new `sms_dlt_template_ids` master parameter, keyed by
   event, and every call site passes its event — the invoice despatch, the
   central `dispatch()` fan-out, and the retry sweep. Enter the ids the portal
   returns into that parameter; no code change is needed for them.

2. **A live send with no registered template is refused, not attempted.** This
   matters more than it sounds: the gateway answers 200 for a message the
   operator then scrubs, so the old behaviour would have logged a message that
   reached nobody as SENT. While SMS is still in outbox mode the same case is
   recorded as a warning instead, so the gap is visible before go-live.

3. **Variables are capped and the text is normalised.** `smsVar()` cuts a value
   to 30 characters — a rejection reason, a cancellation reason, a DISCOM's
   full legal name. `sanitizeSmsText()` maps en-dashes, rupee signs, curly
   quotes and non-breaking spaces onto their GSM-7 equivalents, and runs inside
   `sendSms()` so no call site can bypass it. A test walks the SMS bodies in
   the source and fails if a non-GSM-7 character appears in one.

4. **Hydro station billing now has a notification path.** `hydroNotifications.js`
   fires at every stage the module previously passed over in silence: sent for
   approval, approved, rejected, issued, revised, despatched, payment received,
   surcharge raised, cancelled.

**What still blocks the hydro beneficiary messages is data, not code.** A hydro
beneficiary is a name out of the Regional Energy Account; only a beneficiary
linked to a registered entity carries a contact. Unlinked ones are skipped
rather than guessed at, and the issue response reports how many were reached
(`beneficiaries_notified`), so the gap is measurable rather than silent.

## 6. Order of work

1. SJVN registers as Principal Entity on one access provider's DLT portal.
2. Register header `SJVNLT` (plus a fallback) under Service – Implicit.
3. Get TextGuru's RTM registration details and bind the chain.
4. File all 30 content templates in one batch as Service – Implicit.
5. In parallel: fix the four code items in Section 5.
6. Record the returned DLT template IDs against each event in Masters.
7. Turn on `sms_enabled` only after steps 4 and 6 are both complete. Until then the
   platform writes every SMS to `backend/outbox/` and nothing reaches a handset —
   which is the correct and safe state to test in.

---

## 7. Open questions for SJVN

1. Is SJVN already registered as a Principal Entity on any DLT portal for another
   system (HR, payroll, an existing SAP alert)? If so, the PE registration and
   possibly the header already exist and only the templates need filing.
2. Is TextGuru confirmed as the gateway, or is there an existing empanelled SMS
   vendor under a GeM / corporate contract? The telemarketer chain binds to one
   specific RTM.
3. For Part E, do the fifteen hydro beneficiary DISCOMs go on the platform as
   contactable entities with mobile numbers, or does hydro stay internal-only for
   SMS (E1–E3 and the SJVN side of E6) in phase one?
4. Should internal alerts (A2, B1, B2, C1–C5, E1–E3) go to individual officers'
   mobiles, or to a single ops-desk number? The platform supports both —
   `ops_desk_phone` in Masters is the single-number path.
