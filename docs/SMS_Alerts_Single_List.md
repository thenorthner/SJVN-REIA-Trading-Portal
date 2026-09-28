# SMS Alerts — single list for DLT registration

**Date:** 28 September 2026

All outbound SMS from the SJVN platform. Each row below is one **content template**
that has to be registered on the DLT portal before it can be sent.

- **Total: 30 templates.** All fall under category **Service – Implicit**
  (they arise out of an existing contract or employment relationship, so they
  reach DND numbers too, and no consent template is needed).
- `{#var#}` is the DLT variable placeholder. Fixed text must match exactly.
- **Live** = the code already sends this today. **To be built** = the event exists
  in the platform but currently only raises an in-app notification.

| # | Module | Alert | Message text | Goes to | Status |
|---|---|---|---|---|---|
| 1 | Billing & Invoicing | Invoice sent | SJVN: Invoice {#var#} is available for payment (due {#var#}). View on the portal. | Counterparty (DISCOM / generator) | Live |
| 2 | Billing & Invoicing | Payment received | SJVN: Payment of Rs {#var#} recorded against {#var#}. Status now {#var#}. | SJVN Finance desk | Live |
| 3 | Disputes | SLA breached — management | SJVN: SLA breached on dispute {#var#} - escalated. | SJVN Management | Live |
| 4 | Disputes | SLA breached — owner | SJVN: SLA breached on dispute {#var#} assigned to you. | Assigned SJVN user | Live |
| 5 | Power Trading | NOAR approved | SJVN: NOAR open-access approved for {#var#} ({#var#}). Schedules can now be punched. | SJVN Trading desk | Live |
| 6 | Power Trading | NOAR rejected (single) | SJVN: NOAR application rejected for {#var#} ({#var#}) - {#var#} | SJVN Management | Live |
| 7 | Power Trading | NOAR rejected (bulk) | SJVN: {#var#} NOAR application(s) rejected - {#var#} | SJVN Management | Live |
| 8 | Power Trading | NOAR approval overdue | SJVN: NOAR approval overdue for {#var#} ({#var#}) - {#var#}d pending against a {#var#}d {#var#} target | SJVN Management | Live |
| 9 | Power Trading | NOAR wallet low | SJVN: NOAR wallet balance is Rs {#var#}, below the Rs {#var#} threshold. Recharge before the next open-access charge. | SJVN Trading desk | Live |
| 10 | Billing & Invoicing | Seller invoice submitted | SJVN: Seller invoice {#var#} has been submitted for review. | SJVN REIA desk | To be built |
| 11 | Billing & Invoicing | Invoice approved | SJVN: Invoice {#var#} is approved and ready for despatch. | Counterparty | To be built |
| 12 | Billing & Invoicing | Invoice returned in approval | SJVN: Invoice {#var#} was returned in approval. Reason: {#var#} | Raising party | To be built |
| 13 | Billing & Invoicing | Invoice cancelled | SJVN: Invoice {#var#} has been cancelled. Reason: {#var#} | Counterparty | To be built |
| 14 | Billing & Invoicing | Arrear bill raised | SJVN: Arrear bill raised for contract {#var#} for period {#var#}, amount Rs {#var#}. | Counterparty | To be built |
| 15 | Billing & Invoicing | Supplementary bill raised | SJVN: Supplementary bill raised for contract {#var#} for period {#var#}, amount Rs {#var#}. | Counterparty | To be built |
| 16 | Billing & Invoicing | Payment released to generator | SJVN: Payment of Rs {#var#} released against invoice {#var#}. | Generator (seller) | To be built |
| 17 | Billing & Invoicing | Invoice overdue | SJVN: Invoice {#var#} of Rs {#var#} was due on {#var#} and is outstanding. Late payment surcharge applies. | Counterparty | To be built |
| 18 | Billing & Invoicing | Debit / credit note issued | SJVN: {#var#} note {#var#} of Rs {#var#} has been issued against invoice {#var#}. | Counterparty | To be built |
| 19 | Hydro Billing | Bill pending approval | SJVN: Hydro bill {#var#} for {#var#} is pending your approval. | Named approver (internal) | To be built |
| 20 | Hydro Billing | Bill approved | SJVN: Hydro bill {#var#} for {#var#} has been approved and can be issued. | Maker (internal) | To be built |
| 21 | Hydro Billing | Bill rejected | SJVN: Hydro bill {#var#} was rejected in approval. Reason: {#var#} | Maker (internal) | To be built |
| 22 | Hydro Billing | Bill issued | SJVN: Hydro bill {#var#} for {#var#} is issued. Your share is Rs {#var#}, due {#var#}. | Each beneficiary DISCOM | To be built |
| 23 | Hydro Billing | Bill despatched | SJVN: Hydro bill {#var#} was despatched on {#var#}. Courier reference {#var#}. | Each beneficiary DISCOM | To be built |
| 24 | Hydro Billing | Payment received | SJVN: Payment of Rs {#var#} received against hydro bill {#var#}. Outstanding is now Rs {#var#}. | Beneficiary + SJVN Finance | To be built |
| 25 | Hydro Billing | Late payment surcharge raised | SJVN: Late payment surcharge of Rs {#var#} charged on hydro bill {#var#} as on {#var#}. | Beneficiary DISCOM | To be built |
| 26 | Hydro Billing | Bill cancelled | SJVN: Hydro bill {#var#} for {#var#} has been cancelled. Reason: {#var#} | Beneficiary DISCOM | To be built |
| 27 | Payment Security | Replenishment demanded | SJVN: Payment security against contract {#var#} is short by Rs {#var#}. Replenish by {#var#}. | Counterparty | To be built |
| 28 | Payment Security | Instrument expiring | SJVN: Payment security instrument {#var#} against contract {#var#} expires on {#var#}. | Counterparty | To be built |
| 29 | Payment Security | Instrument invoked | SJVN: Payment security instrument {#var#} has been invoked for Rs {#var#} against contract {#var#}. | Counterparty | To be built |
| 30 | Payment Security | Scheduling on hold | SJVN: Scheduling on contract {#var#} is on hold - payment security is inadequate. | Counterparty | To be built |

---

## Along with the templates, three more registrations are needed

| # | Registration | Note |
|---|---|---|
| 1 | **Principal Entity (PE)** | SJVN registers itself on any one access provider's DLT portal (Jio / Airtel / Vi / BSNL) with PAN, GST, CIN and an authorised signatory. It propagates to the other operators. |
| 2 | **Header (Sender ID)** | 6 alphabetic characters, e.g. `SJVNLT`. Suggest registering a fallback too, since headers are allotted first-come across India. |
| 3 | **Telemarketer chain** | The SMS gateway has to be bound to SJVN as its registered telemarketer. |

## Points to confirm

1. Is SJVN **already** registered as a Principal Entity on any DLT portal for
   another system (HR, payroll, an existing SAP alert)? If yes, the PE and
   possibly the header already exist and only the 30 templates need filing.
2. Which SMS gateway is confirmed? The platform is currently built against
   **TextGuru**, but the telemarketer chain binds to one specific vendor, so if
   there is an empanelled vendor under a GeM / corporate contract that has to be
   settled first.
3. For the Hydro Billing rows (22–26), do the fifteen beneficiary DISCOMs go on
   the platform with contact mobile numbers? There is no number on record for
   them today. Filing the templates does not depend on this; sending does.
4. Should internal alerts (rows 2, 3, 4, 5–9, 19–21) go to individual officers'
   mobiles or to a single ops-desk number? The platform supports both.

*Detailed version with source references and the code changes required:
`docs/TRAI_DLT_SMS_Registration_List.md`*
